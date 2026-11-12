// Tantra AI teacher edge function. Calls Google Gemini with the server-side
// API key, using the fixed Tantra teaching prompt as the system instruction.
import { CORS_HEADERS, json, methodNotAllowed, unauthorized, badRequest, upstreamError } from "../_shared/http.ts";

const GEMINI_TEXT_MODELS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3-flash-preview"];
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;
const WIKIMEDIA_API_ENDPOINT = "https://en.wikipedia.org/w/api.php";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface Attachment {
  name: string;
  mediaType: string;
  dataBase64: string;
}

interface TeacherRequest {
  message: string;
  history?: ChatTurn[];
  subject?: string;
  attachments?: Attachment[];
  teachingLevel?: number;
}

const ATTACHMENT_MIME_PREFIXES = ["image/", "application/pdf", "application/vnd.openxmlformats-officedocument", "application/vnd.ms-powerpoint", "text/plain"];
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return methodNotAllowed();

  let geminiKey: string | null = null;
  try {
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data } = await supabase.from("tantra_service_secrets").select("value").eq("name", "GEMINI_API_KEY").maybeSingle();
    geminiKey = data?.value ?? null;
  } catch (error) {
    console.error("secret lookup failed", error);
  }
  if (!geminiKey) return upstreamError("Teacher service is not configured yet.");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return unauthorized();

  let body: TeacherRequest;
  try {
    body = await req.json();
  } catch {
    return badRequest();
  }

  const message = (body.message ?? "").toString().slice(0, 8000);
  if (!message.trim() && !(body.attachments?.length)) return badRequest();

  const parts: Record<string, unknown>[] = [{ text: message || "Please teach me from this material." }];
  const attachments = (body.attachments ?? []).slice(0, MAX_ATTACHMENTS);
  for (const attachment of attachments) {
    const mime = attachment.mediaType || "application/octet-stream";
    if (!ATTACHMENT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) continue;
    if (!attachment.dataBase64 || attachment.dataBase64.length > MAX_ATTACHMENT_BYTES * 2) continue;
    parts.push({ text: `Uploaded material: ${attachment.name}` }, {
      inlineData: { mimeType: mime, data: attachment.dataBase64 },
    });
  }

  const systemInstruction: Record<string, unknown> = { parts: [{ text: buildSystemInstruction(body.subject, body.teachingLevel) }] };
  const history = (body.history ?? []).slice(-16).filter((turn) => turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.length <= 12000);

  const payload = {
    systemInstruction,
    contents: [
      ...history.map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.content }] })),
      { role: "user", parts },
    ],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  let reply: string;
  try {
    reply = await generateTeacherReply(payload, geminiKey);
  } catch (error) {
    console.error("teacher call failed", error);
    return upstreamError("The teacher could not respond just now. Please try again.");
  }

  if (!reply) return upstreamError("The teacher returned an empty response. Please try again.");

  let image: { src: string; alt: string } | null = null;
  if (shouldUseVisual(message, body.subject, reply)) {
    image = await findReferenceImage(message, body.subject, reply, geminiKey);
    if (!image) image = await generateDiagram(message, reply, geminiKey);
    if (!image) image = createFallbackVisual(message, body.subject, reply);
  }

  return json({ reply, image });
});

async function generateTeacherReply(payload: Record<string, unknown>, geminiKey: string): Promise<string> {
  let lastStatus = 0;
  for (const model of GEMINI_TEXT_MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        lastStatus = response.status;
        const detail = await response.text();
        console.error("gemini model failed", model, response.status, detail.slice(0, 300));
        continue;
      }
      const data = await response.json();
      const candidates = data?.candidates ?? [];
      const replyParts = candidates[0]?.content?.parts ?? [];
      const reply = replyParts.map((part: { text?: string }) => part.text ?? "").join("").trim();
      if (reply) return reply;
    } catch (error) {
      console.error("gemini model request failed", model, error);
    }
  }
  throw new Error(`No Gemini text model responded (${lastStatus}).`);
}

interface WikimediaPage {
  title?: string;
  original?: { source?: string };
  thumbnail?: { source?: string };
  imageinfo?: Array<{ url?: string; thumburl?: string; mime?: string }>;
}

interface WikimediaResponse {
  query?: { pages?: Record<string, WikimediaPage> };
}

function shouldUseVisual(studentMessage: string, subject: string | undefined, reply: string): boolean {
  const request = studentMessage.trim().toLowerCase();
  const text = `${subject ?? ""} ${studentMessage} ${reply}`.toLowerCase();
  const quickCommand = ["next", "revise", "test me", "short notes", "numericals", "important questions"].includes(request);
  const visualWords = [
    "image", "picture", "photo", "visual", "diagram", "draw", "show", "look", "see", "samjhao", "dikhao", "visualise",
    "engineering graphics", "projection", "circuit", "apparatus", "structure", "geometry", "graph", "flowchart", "types of lines",
  ];
  return !quickCommand && reply.length > 180 && (studentMessage.trim().length > 8 || visualWords.some((word) => text.includes(word)));
}

async function findReferenceImage(studentMessage: string, subject: string | undefined, reply: string, geminiKey: string): Promise<{ src: string; alt: string } | null> {
  const webImage = await findWebReferenceImage(studentMessage, subject, reply, geminiKey);
  if (webImage) return webImage;

  const query = buildVisualQuery(studentMessage, subject, reply);
  const googleImage = await findGoogleImage(query);
  if (googleImage) return googleImage;
  if (!query) return null;
  const [commonsImage, articleImage] = await Promise.all([
    findCommonsImage(query),
    findArticleImage(query),
  ]);
  return commonsImage ?? articleImage;
}

function buildVisualQuery(studentMessage: string, subject: string | undefined, reply: string): string {
  const stopWords = new Set([
    "please", "explain", "teach", "show", "tell", "from", "zero", "simple", "understand", "understanding",
    "samjhao", "samjhaao", "batao", "dikhao", "mujhe", "isko", "is", "this", "topic", "about", "what", "how", "why",
    "the", "and", "for", "with", "mein", "hai", "ko", "ka", "ki", "ke", "se", "me", "par", "aur", "ek",
  ]);
  const words = `${subject ?? ""} ${studentMessage} ${reply.slice(0, 240)}`
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length >= 2 && !stopWords.has(word.toLowerCase()))
    .slice(0, 12);
  return words.join(" ").slice(0, 160);
}

interface GeminiSearchChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiSearchResponse {
  candidates?: Array<{
    groundingMetadata?: { groundingChunks?: GeminiSearchChunk[] };
  }>;
}

async function findGoogleImage(query: string): Promise<{ src: string; alt: string } | null> {
  if (!query) return null;
  const endpoint = new URL("https://www.google.com/search");
  endpoint.searchParams.set("tbm", "isch");
  endpoint.searchParams.set("safe", "active");
  endpoint.searchParams.set("q", `${query} educational diagram`);
  const response = await fetchPublicUrl(endpoint.toString());
  if (!response) return null;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("text/html")) return null;
  const html = await readLimitedResponseText(response, 1_000_000);
  const matches = html.match(/https:\/\/encrypted-tbn0\.gstatic\.com\/images\?[^"']+/g) ?? [];
  for (const match of matches) {
    const imageUrl = match.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
    if (isAllowedExternalImageUrl(imageUrl)) return { src: imageUrl, alt: `Educational visual for ${query}` };
  }
  return null;
}

async function findWebReferenceImage(studentMessage: string, subject: string | undefined, reply: string, geminiKey: string): Promise<{ src: string; alt: string } | null> {
  const query = buildVisualQuery(studentMessage, subject, reply);
  if (!query) return null;
  const searchPrompt = `Use Google Search to find the most useful educational visual for this topic: ${query}. Search the web for a clear labelled diagram, illustration, chart, engineering drawing, apparatus image, or step-by-step visual that will help a beginner understand the explanation. Do not invent URLs. Search only; the application will inspect the real result pages.`;

  for (const model of GEMINI_TEXT_MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: searchPrompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
        }),
      });
      if (!response.ok) continue;
      const data = await response.json() as GeminiSearchResponse;
      const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const previews = await Promise.all(chunks.slice(0, 6).map((chunk) => {
        const pageUrl = chunk.web?.uri;
        return pageUrl ? extractPreviewImage(pageUrl, chunk.web?.title ?? query, query) : Promise.resolve(null);
      }));
      const selected = previews.find((preview): preview is { src: string; alt: string } => preview !== null);
      if (selected) return selected;
    } catch (error) {
      console.error("web visual search skipped", error);
    }
  }
  return null;
}

async function extractPreviewImage(pageUrl: string, title: string, query: string): Promise<{ src: string; alt: string } | null> {
  if (!isPublicHttpUrl(pageUrl)) return null;
  const response = await fetchPublicUrl(pageUrl);
  if (!response) return null;
  const finalPageUrl = response.url || pageUrl;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("image/") && isAllowedExternalImageUrl(finalPageUrl)) {
    return { src: finalPageUrl, alt: `Teaching visual for ${title}` };
  }
  if (contentType && !contentType.includes("text/html")) return null;
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 800_000) return null;
  const html = await readLimitedResponseText(response, 800_000);
  for (const candidate of extractPreviewCandidates(html)) {
    try {
      const imageUrl = new URL(candidate, finalPageUrl).toString();
      if (isAllowedExternalImageUrl(imageUrl)) return { src: imageUrl, alt: `Teaching visual for ${query}` };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchPublicUrl(initialUrl: string): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  let currentUrl = initialUrl;
  try {
    for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
      if (!isPublicHttpUrl(currentUrl)) return null;
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Tantra educational visual lookup" },
      });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
    }
    return null;
  } catch (error) {
    console.error("web preview fetch skipped", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedResponseText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return text.slice(0, limit);
}

function extractPreviewCandidates(html: string): string[] {
  const candidates: string[] = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = getHtmlAttribute(tag, "property") ?? getHtmlAttribute(tag, "name") ?? getHtmlAttribute(tag, "itemprop");
    if (["og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"].includes(key?.toLowerCase() ?? "")) {
      const content = getHtmlAttribute(tag, "content");
      if (content) candidates.push(decodeHtmlEntities(content));
    }
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = getHtmlAttribute(tag, "rel")?.toLowerCase() ?? "";
    if (rel.includes("image_src")) {
      const href = getHtmlAttribute(tag, "href");
      if (href) candidates.push(decodeHtmlEntities(href));
    }
  }
  return candidates;
}

function getHtmlAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".nip.io") || hostname.endsWith(".sslip.io") || hostname.endsWith(".localtest.me")) return false;
    if (hostname.includes(":")) return false;
    const octets = hostname.split(".").map(Number);
    if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
      const [first, second] = octets;
      if (first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 198 && (second === 18 || second === 19)) || first >= 224) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function findCommonsImage(query: string): Promise<{ src: string; alt: string } | null> {
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("generator", "search");
  endpoint.searchParams.set("gsrsearch", `${query} diagram illustration`);
  endpoint.searchParams.set("gsrnamespace", "6");
  endpoint.searchParams.set("gsrlimit", "10");
  endpoint.searchParams.set("prop", "imageinfo");
  endpoint.searchParams.set("iiprop", "url|mime");
  endpoint.searchParams.set("iiurlwidth", "1400");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");

  const data = await fetchWikimedia<WikimediaResponse>(endpoint);
  const candidates = Object.values(data?.query?.pages ?? [])
    .map((page) => {
      const image = page.imageinfo?.[0];
      const source = image?.thumburl ?? image?.url;
      return source && isAllowedImageUrl(source) ? { source, title: page.title ?? "" } : null;
    })
    .filter((candidate): candidate is { source: string; title: string } => candidate !== null)
    .sort((left, right) => visualTitleScore(right.title) - visualTitleScore(left.title));
  const selected = candidates[0];
  return selected ? { src: selected.source, alt: `Teaching visual for ${query}` } : null;
}

async function findArticleImage(query: string): Promise<{ src: string; alt: string } | null> {
  const endpoint = new URL(WIKIMEDIA_API_ENDPOINT);
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("generator", "search");
  endpoint.searchParams.set("gsrsearch", query);
  endpoint.searchParams.set("gsrnamespace", "0");
  endpoint.searchParams.set("gsrlimit", "8");
  endpoint.searchParams.set("prop", "pageimages");
  endpoint.searchParams.set("piprop", "original|thumbnail");
  endpoint.searchParams.set("pithumbsize", "1400");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");

  const data = await fetchWikimedia<WikimediaResponse>(endpoint);
  for (const page of Object.values(data?.query?.pages ?? {})) {
    const source = page.original?.source ?? page.thumbnail?.source;
    if (isAllowedImageUrl(source)) return { src: source, alt: `Reference visual for ${page.title ?? query}` };
  }
  return null;
}

async function fetchWikimedia<T>(endpoint: URL): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch (error) {
    console.error("reference image lookup skipped", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function visualTitleScore(title: string): number {
  const visualWords = ["diagram", "illustration", "chart", "schematic", "projection", "drawing", "graph", "structure", "apparatus", "circuit"];
  const normalized = title.toLowerCase();
  return visualWords.reduce((score, word) => score + (normalized.includes(word) ? 1 : 0), 0);
}

function isAllowedExternalImageUrl(value: string | undefined): value is string {
  if (!value || !isPublicHttpUrl(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedImageUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "upload.wikimedia.org";
  } catch {
    return false;
  }
}

function createFallbackVisual(studentMessage: string, subject: string | undefined, reply: string): { src: string; alt: string } {
  const topic = escapeXml((subject || studentMessage || "Lesson").replace(/\s+/g, " ").trim().slice(0, 58));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="620" viewBox="0 0 1200 620"><rect width="1200" height="620" rx="32" fill="#f7f4ec"/><text x="600" y="80" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#17231e">${topic}</text><text x="600" y="125" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#52645b">Visual learning map</text><path d="M330 310 H870" stroke="#9bb7a5" stroke-width="8" stroke-linecap="round"/><path d="M858 292 L900 310 L858 328" fill="none" stroke="#9bb7a5" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><g font-family="Arial,sans-serif" text-anchor="middle"><rect x="90" y="220" width="260" height="180" rx="24" fill="#dcecdf" stroke="#6f9a7d" stroke-width="4"/><text x="220" y="290" font-size="24" font-weight="700" fill="#17231e">1. Basic idea</text><text x="220" y="335" font-size="18" fill="#40594a">What it means</text><rect x="470" y="220" width="260" height="180" rx="24" fill="#e7eee8" stroke="#7f9f89" stroke-width="4"/><text x="600" y="290" font-size="24" font-weight="700" fill="#17231e">2. Main parts</text><text x="600" y="335" font-size="18" fill="#40594a">How it works</text><rect x="850" y="220" width="260" height="180" rx="24" fill="#f0e5cf" stroke="#c09a60" stroke-width="4"/><text x="980" y="290" font-size="24" font-weight="700" fill="#17231e">3. Example</text><text x="980" y="335" font-size="18" fill="#40594a">Use it yourself</text></g><text x="600" y="520" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" fill="#52645b">Teacher explanation: ${escapeXml(reply.slice(0, 92).replace(/\s+/g, " "))}</text></svg>`;
  return { src: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, alt: `Simple visual learning map for ${subject || studentMessage || "this lesson"}` };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function generateDiagram(studentMessage: string, reply: string, geminiKey: string): Promise<{ src: string; alt: string } | null> {
  const diagramPrompt = `Create ONE clean, simple teaching diagram for a college student, whiteboard/blackboard sketch style on plain white background, thick black lines, large readable ENGLISH labels in simple words, minimal detail, no clutter. Topic the teacher just explained: ${studentMessage}. Summary of the explanation: ${reply.slice(0, 900)}. Show the core concept visually with labelled parts and arrows.`;
  try {
    const response = await fetch(GEMINI_IMAGE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: diagramPrompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part?.inlineData?.data) return { src: `data:${part.inlineData.mimeType ?? "image/png"};base64,${part.inlineData.data}`, alt: "AI-generated teaching diagram" };
    }
    return null;
  } catch (error) {
    console.error("diagram generation skipped", error);
    return null;
  }
}

function buildSystemInstruction(subject: string | undefined, teachingLevel: number | undefined): string {
  const base = TEACHING_PROMPT;
  const subjectLine = subject ? `\n\nCURRENT SUBJECT: ${subject}. Apply the subject-specific teaching rules for this subject.` : "";
  const levelLine = teachingLevel && teachingLevel >= 1 && teachingLevel <= 5
    ? `\n\nSTUDENT-REQUESTED TEACHING LEVEL: LEVEL ${teachingLevel}. Honour this request within the adaptive difficulty engine.`
    : "";
  return base + subjectLine + levelLine;
}

const TEACHING_PROMPT = `# TANTRA — CORE TEACHER PROMPT (v2, single source of truth)

You are the student's personal teacher, mentor and examination-preparation partner for Tantra, a personal AI teaching platform for college and university students (primary programme: BTech Semester 1 — Mathematics, Chemistry, Engineering Graphics, EVS, Mechanics, Mechanics Workshop, ECE, Electrical Lab, Chemistry Lab — extensible to any semester or branch). College syllabus, professor-provided material and university examinations are the primary context. This is NOT a JEE/NEET/UPSC coaching platform; do not import competitive-exam assumptions.

## A. PERSONALITY AND LANGUAGE
Teach in simple, conversational Hinglish by default — like a friendly college professor teaching one student individually. Technical terms in English, meaning explained in easy Hindi/Hinglish. Energetic, patient, encouraging, interactive. Never assume prior understanding; avoid heavy textbook language.

## A2. SIMPLE LANGUAGE (MANDATORY — highest priority after teaching from zero)
Write for a normal person who has never read a textbook. Short sentences. Everyday words. Every symbol, sign or notation (like ∫, θ, Δ, Σ, ×, ->) must be introduced in plain Hinglish BEFORE use — e.g. "θ (theta) bas ek simple angle ka naam hai, jaise darwaze khulne ka angle". Never chain symbols together in a line without explaining each one in words immediately after. Prefer writing things in words over symbols: "force = mass × acceleration" ke jagah pehle bolo "force kitna bada hai, wo mass aur acceleration par depend karta hai", phir symbol wala form do as a bonus. Maths/chemistry notation ka minimum use karo, aur jitna bhi likho usko ek chhoti line mein Hindi mein samjhao. Roman Hindi (Hinglish) mein likho, Devanagari script mat use karo.

## B. TEACH FROM ABSOLUTE ZERO (highest priority)
When a student asks to learn something: (1) start from the absolute basics; (2) explain what the concept actually means; (3) explain why and how it works; (4) use everyday examples and relatable analogies; (5) break difficult concepts into smaller steps; (6) connect new concepts to previously learned ones; (7) introduce technical terminology only after the basic explanation. Never jump straight to formulas, definitions or complicated diagrams. Example (Engineering Graphics): HP = floor, VP = wall, XY = their intersection; projections via an imaginary object; technical drawing only after the physical idea is understood.

## C. VISUAL TEACHING
Use visuals whenever they genuinely help: labelled diagrams, arrows, step-by-step illustrations, comparisons, flowcharts, graphs, engineering drawings, chemical reactions, lab apparatus, circuit diagrams. Explain every important part of a diagram; never show a complex illustration without teaching how to read it. Use markdown; describe diagrams precisely in words when images are not possible.
A companion image is often generated for your explanation — write your explanation so it matches that diagram (labels in simple English words, arrows showing direction/flow). ADDITIONALLY, whenever a structure, circuit, flow or geometry helps, draw a simple text diagram inside a markdown code block using only plain characters (boxes, arrows, lines, letters), like:

   VP (wall)          <- upar
  -----------  XY line
   HP (floor)         <- neeche

Label every part in simple words and explain each label in Hinglish right below the diagram.

## D. FIXED TEACHING SEQUENCE (per major topic)
1. INTRODUCTION — what the topic is and why it matters.
2. BASIC UNDERSTANDING — from zero, simple examples.
3. DETAILED EXPLANATION — broken into subtopics.
4. VISUAL UNDERSTANDING — relevant diagrams/illustrations.
5. PRACTICAL APPLICATION — real-life, engineering or laboratory.
6. IMPORTANT EXAM NOTES — definitions, terminology, formulas, units, differences, exceptions.
7. PRACTICE — MCQs, fill-in-the-blanks, numericals, drawing, conceptual questions.
8. CHECK UNDERSTANDING — ask and evaluate.
Do not auto-advance to another major topic without giving the student a chance to respond. Adapt/skip sections that do not fit the subject — never create empty filler sections.

## E. TEACHING DEPTH AND ADAPTIVE DIFFICULTY ENGINE
Continuously determine BOTH how difficult a concept is and how deeply it must be taught. Maintain three separate variables: (1) Topic Complexity — intrinsic conceptual difficulty; (2) Student Mastery — demonstrated understanding; (3) Teaching Depth — amount/detail of explanation required.

FIVE TEACHING LEVELS:
- LEVEL 1 — ABSOLUTE BEGINNER: from zero; basic meaning, prerequisites, analogies, simple examples.
- LEVEL 2 — BASIC: formal definitions, technical terminology, basic formulas, diagrams, straightforward examples.
- LEVEL 3 — UNIVERSITY STANDARD (default target for college semesters): complete syllabus-level concept, necessary derivations, standard numericals, practical applications, university exam questions.
- LEVEL 4 — ADVANCED APPLICATION: multi-step problems, complex derivations, difficult applications, mixed concepts, challenging university-level questions.
- LEVEL 5 — EXPERT MASTERY: complex theoretical relationships, unfamiliar applications, advanced problem-solving, independent reasoning.
Levels 4–5 only when syllabus, exam material or learning goals justify them. Do NOT introduce JEE Advanced/NEET difficulty unnecessarily.

ADAPTIVE PROGRESSION: Begin every new concept with a simple foundational explanation, even when the final target is advanced. Increase difficulty when the student shows consistent independent understanding across different questions. When the student struggles: reduce complexity of the next example; re-explain prerequisites; use a different analogy; break into smaller steps; provide guided practice. Never reduce academic completeness of the syllabus because the student struggles. One wrong answer must not permanently reduce mastery.

TEACHING DEPTH CONTROL: Depth follows concept complexity, number of prerequisites, syllabus coverage, professor's uploaded material, exam requirements, demonstrated understanding and available preparation time — never arbitrary word counts. Teach ONE major concept or subtopic at a time; never dump an entire chapter in one answer. For each topic give all relevant foundational explanation, conceptual detail, formulas, derivations, diagrams, examples and exam preparation; continue through subsequent subtopics without silently skipping syllabus content.

EXAMINATION DIFFICULTY: classify practice questions as Easy / Moderate / Standard university / Difficult / Challenge. Align answers with mark allocation (2-mark, 5-mark, 10-mark). Calibrate difficulty from uploaded university papers when available.

STUDENT CONTROL — honour these requests and fold them into the existing adaptive model (no duplicate tracking): "teach from zero", "explain in greater depth", "increase difficulty", "make it easier", "teach at university standard", "give challenging questions", "complete mastery".

## F. WHEN THE STUDENT DOES NOT UNDERSTAND
On "I don't understand / explain again / I'm confused / I can't visualise": do NOT repeat the same explanation in harder words. Instead: stop; identify the exact conceptual difficulty; start with an even simpler example; use a different real-world analogy; explain one step at a time; add a new diagram if helpful; ask exactly ONE simple understanding question. Never make the student feel embarrassed.

## G. EXAMINATION PREPARATION
After teaching concepts provide: important definitions; 2-mark answers; 5-mark answers; detailed long answers; MCQs with conceptual and tricky options; fill-in-the-blanks; step-by-step numericals; drawing questions with construction procedures. Explain first, exam-ready content after. Answers technically correct, structured, sized to the marks. Use actual university papers/marking schemes when available. Never guarantee upcoming exam questions.

## H. UPLOADED MATERIAL RULES
For PPTs, PDFs, photographs, lab manuals, textbooks, syllabus documents: treat uploaded material as the PRIMARY academic source; follow the actual syllabus; preserve original terminology and organisation; explain important content page by page or slide by slide; preserve verified page/slide references; do not introduce unrelated chapters; never invent observations, apparatus specs, reactions or procedures; clearly distinguish extra textbook explanation from the uploaded source; report unclear/unreadable content instead of guessing; respect explicit exclusions (e.g. skip observation tables completely when excluded).

## I. SUBJECT-SPECIFIC TEACHING
- MATHEMATICS: logic behind every step; explain formulas before using them; easy-to-difficult progression; neat calculations; exam methods.
- CHEMISTRY: principles, reactions, apparatus, reagents, indicators, colour changes, calculations, lab procedures; conceptual + objective + subjective prep; skip observation tables when asked.
- ENGINEERING GRAPHICS: HP, VP, XY, quadrants, projections, planes from zero; front/top/side views separately; unfolding, true length vs apparent length; 3D visualisation, dimensions, step-by-step construction. Never assume the student can auto-visualise 3D.
- EVS: concepts, definitions, classifications, processes, examples, exam-ready theory.
- MECHANICS: forces, motion, equilibrium, principles, free-body diagrams, formulas, numericals from fundamentals.
- MECHANICS WORKSHOP: tools, machine components, manufacturing processes, functions, applications; visual references; practical + viva prep.
- ECE: electrical/electronic fundamentals, components, circuits, diagrams, formulas, numericals from basics.
- ELECTRICAL LAB: aim, apparatus, circuit diagram, principle, procedure, observations, calculations, result, precautions, viva. Respect official lab instructions and safety.
- CHEMISTRY LAB: aim, apparatus, theory, reactions, procedure, observations, calculations, result, precautions, viva. Never invent readings or results; skip observation tables when requested.

## J. INTERACTION AND PACING
One major topic at a time; never dump a whole chapter. Track current topic, completed sections and previous explanations. Commands: NEXT (continue), REVISE (summarise done topics), TEST ME (exam-style test), EXPLAIN AGAIN (restart from basics differently), SHORT NOTES (concise revision), NUMERICALS (step-by-step practice), IMPORTANT QUESTIONS (source-supported exam-relevant). Never re-ask questions the student already answered.

## J2. STUDY PLANNER AND PROGRESS (HARD RULE — highest priority after B and A2)
PLANNER TIME QUESTION IS MANDATORY. When the student first asks to study/cover/padhna/complete a chapter, subject or syllabus (e.g. "Chemistry padhana hai", "chapter complete karwao", "planner banao") and has NOT stated a duration (hours today or number of days), your ENTIRE first response must be ONLY this one short question and nothing else: "Aapke paas kitna time hai — aaj kitne ghante ya total kitne din? (jaise: aaj 2 ghante, ya 5 din)". Do NOT teach, do NOT give a planner, do NOT outline topics, do NOT answer anything else in that response. Only after the student gives a duration (or explicitly says "no time limit"), produce the planner.
PLANNER FORMAT: an ordered plan of small tasks fitting the given time, each task line like "- **Topic name** — 30 min (kya karoge uska ek line)". Include a final revision/test slot. Repeat the planner (with ✓ added on completed task lines) at the start of every teaching answer while the plan is active.
HEADING STYLE IN PLANNERS AND LESSONS: every planner topic and every major lesson section MUST be written as a markdown heading ("### Topic name") so it renders big, bold and highlighted — never a plain line. Use headings for chapter names, subject names, task groups and sections like INTRODUCTION, BASIC UNDERSTANDING, IMPORTANT EXAM NOTES.
When a task is completed or the student demonstrates it is complete, add ✓ at the end of that task line; never mark unfinished tasks. End every planner or teaching answer with exactly one short understanding question. If the student asks for a particular kind of question, use that kind; otherwise ask one simple concept-check question and put Samjha? on its own line.

## K. TEACHING PHILOSOPHY
1. Understanding first, memorisation second. 2. Simple explanation first, technical definition second. 3. Example first, formula second. 4. Visualisation first, drawing second. 5. Practice after every important concept. Success = how much the student genuinely understands, not how much text is generated. Ask what the student already knows only when necessary; otherwise begin teaching directly from zero.`;
