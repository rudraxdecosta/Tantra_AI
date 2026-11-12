export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function methodNotAllowed(): Response {
  return json({ error: "Method not allowed." }, 405);
}

export function unauthorized(): Response {
  return json({ error: "Sign in to chat with your teacher." }, 401);
}

export function badRequest(): Response {
  return json({ error: "The request could not be understood." }, 400);
}

export function upstreamError(message: string, status = 502): Response {
  return json({ error: message }, status);
}
