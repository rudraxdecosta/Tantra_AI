import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { LoaderCircle, LogOut, Paperclip, Plus, Send, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { clearChatHistory, isAttachmentAllowed, askTeacher, loadChatHistory, saveChatMessage, type ChatMessage } from '@/lib/teacher';

interface TeacherChatProps {
  firstName: string;
  email: string;
  isAdmin: boolean;
  onOpenAdminPortal: () => void;
  onSignOut: () => Promise<void>;
}

const TEACHING_LEVELS = [
  { level: 1, label: 'Level 1 · From zero' },
  { level: 2, label: 'Level 2 · Basic' },
  { level: 3, label: 'Level 3 · University standard' },
  { level: 4, label: 'Level 4 · Advanced' },
  { level: 5, label: 'Level 5 · Expert' },
];
const QUICK_COMMANDS = ['NEXT', 'REVISE', 'TEST ME', 'EXPLAIN AGAIN', 'SHORT NOTES', 'NUMERICALS', 'IMPORTANT QUESTIONS'];

export default function TeacherChat({ firstName, email, isAdmin, onOpenAdminPortal, onSignOut }: TeacherChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [subject, setSubject] = useState('');
  const [teachingLevel, setTeachingLevel] = useState<number | undefined>();
  const [isThinking, setIsThinking] = useState(false);
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [sendError, setSendError] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    async function loadHistory(): Promise<void> {
      try { setMessages(await loadChatHistory()); }
      catch { setSendError('Your conversation could not be loaded.'); }
      finally { setHistoryLoaded(true); }
    }
    void loadHistory();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isThinking]);

  useEffect(() => {
    if (!isThinking) { setLoadingPercent(0); return; }
    setLoadingPercent(7);
    const timer = window.setInterval(() => {
      setLoadingPercent((current) => current >= 96 ? current : Math.min(96, current + 3));
    }, 180);
    return () => window.clearInterval(timer);
  }, [isThinking]);

  async function send(rawText: string): Promise<void> {
    const text = rawText.trim();
    if ((!text && !attachment) || isThinking) return;
    setSendError('');
    const outgoing = text || `Please teach me from this material: ${attachment?.name}`;
    const sentAttachment = attachment;
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'user', content: outgoing, attachment_name: sentAttachment?.name ?? null, created_at: new Date().toISOString() }]);
    setDraft('');
    setAttachment(null);
    setIsThinking(true);
    try {
      const { reply, image } = await askTeacher({ message: text, history: messages, subject: subject.trim() || undefined, attachments: sentAttachment ? [sentAttachment] : undefined, teachingLevel });
      await saveChatMessage('user', outgoing, sentAttachment?.name ?? null);
      await saveChatMessage('assistant', reply, null);
      setMessages((current) => [...current, { id: `local-reply-${Date.now()}`, role: 'assistant', content: reply, attachment_name: null, created_at: new Date().toISOString(), image }]);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'The teacher could not respond just now.');
    } finally { setIsThinking(false); }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(draft); }
  }

  function handleAttachment(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    if (file && !isAttachmentAllowed(file)) { setSendError('That file type or size is not supported. Use images, PDF, PPT or text up to 15 MB.'); return; }
    setAttachment(file);
    setSendError('');
  }

  async function handleClear(): Promise<void> {
    try { await clearChatHistory(); setMessages([]); }
    catch { setSendError('Your conversation could not be cleared.'); }
  }

  return (
    <main className="chat-shell">
      {isThinking && <div className="tantra-loading" aria-live="polite" aria-label="Adi ka Tantra is preparing your lesson">
        <div className="smoke-cloud smoke-cloud-one" /><div className="smoke-cloud smoke-cloud-two" /><div className="smoke-cloud smoke-cloud-three" />
        <div className="tantra-aura"><Sparkles size={23} /></div>
        <div className="tantra-loading-copy"><strong>PADHE JA RHE HAI JAADUI MANTRA AB CHALEGA ADI KA TANTRA</strong><div className="tantra-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadingPercent}><div className="tantra-progress-fill" style={{ width: `${loadingPercent}%` }} /><span>{loadingPercent}%</span></div></div>
      </div>}
      <header className="chat-topbar">
        <div className="brand-lockup"><div className="brand-mark"><Sparkles size={17} strokeWidth={2.5} /></div><span>Adi ka Tantra</span></div>
        <div className="chat-topbar-actions">
          {isAdmin && <button className="ghost-button" type="button" onClick={onOpenAdminPortal}><ShieldCheck size={15} />Admin portal</button>}
          <button className="ghost-button" type="button" onClick={() => void handleClear()} disabled={!messages.length}><Trash2 size={15} />Clear chat</button>
          <button className="ghost-button" type="button" onClick={() => void onSignOut()}><LogOut size={15} />Sign out</button>
        </div>
      </header>
      <div className="chat-scroll">
        <section className="chat-greeting animate-in"><p className="eyebrow">Your personal teacher</p><h1>Hi {firstName}.</h1><p className="greeting-copy">Aaj kya padhna hai? Apna sawaal likho ya PPT, PDF, photo ya notes bhejo. Main sab kuch simple bhasha mein, zero se, step by step samjhaunga.</p></section>
        <div className="chat-messages">
          {historyLoaded && !messages.length && <div className="chat-empty"><p>Try asking:</p><button type="button" onClick={() => void send('Engineering Graphics mein HP, VP aur XY ko zero se samjhao')}>Explain HP, VP and XY from zero</button><button type="button" onClick={() => void send('Mathematics ka first chapter padhana hai, basic se')}>Teach my first Maths chapter</button></div>}
          {messages.map((message) => <div key={message.id} className={`chat-row ${message.role === 'user' ? 'from-user' : 'from-teacher'}`}><div className="chat-bubble">{message.attachment_name && <span className="chat-attachment-chip"><Paperclip size={12} />{message.attachment_name}</span>}<MessageBody text={message.content} />{message.role === 'assistant' && message.image && <img src={message.image.src} alt={message.image.alt} className="chat-diagram" />}</div></div>)}
          {isThinking && <div className="chat-row from-teacher"><div className="chat-bubble thinking"><Sparkles size={15} className="magic-pulse" /><span>Padhe ja rahe hain… jaadui mantra ab chalega — Adi ka Tantra</span></div></div>}
          <div ref={bottomRef} />
        </div>
      </div>
      <footer className="chat-composer">
        {sendError && <p className="form-message form-error" role="alert">{sendError}</p>}
        {attachment && <div className="attachment-chip"><span><Paperclip size={13} /> {attachment.name}</span><button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={13} /></button></div>}
        <div className="composer-row"><label className="attach-button" aria-label="Attach material"><Paperclip size={18} /><input type="file" accept="image/*,.pdf,.ppt,.pptx,txt" onChange={handleAttachment} hidden /></label><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder="Type your doubt, or attach material and ask me to teach it…" rows={1} disabled={isThinking} /><button className="send-button" type="button" onClick={() => void send(draft)} disabled={isThinking || (!draft.trim() && !attachment)} aria-label="Send">{isThinking ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}</button></div>
        <div className="composer-controls"><label className="subject-input"><Plus size={13} /><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject (e.g. Mechanics, Engineering Graphics)" maxLength={80} /></label><select value={teachingLevel ?? ''} onChange={(event) => setTeachingLevel(event.target.value ? Number(event.target.value) : undefined)} aria-label="Teaching level"><option value="">Auto level</option>{TEACHING_LEVELS.map((option) => <option key={option.level} value={option.level}>{option.label}</option>)}</select></div>
        <div className="quick-commands">{QUICK_COMMANDS.map((command) => <button key={command} type="button" onClick={() => void send(command)} disabled={isThinking}>{command}</button>)}</div><span className="composer-email">{email}</span>
      </footer>
    </main>
  );
}

function MessageBody({ text }: { text: string }) {
  const blocks = text.split('```');
  return <>{blocks.map((block, index) => index % 2 === 1 ? <pre key={index} className="chat-diagram-text">{block.trim()}</pre> : <MessageText key={index} value={block} />)}</>;
}

function MessageText({ value }: { value: string }) {
  return <>{value.split('\n').map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={index} className="message-gap" />;
    const math = trimmed.replace(/^\$\$|\$\$$/g, '').trim();
    if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) return <MathBlock key={index} value={math} />;
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) return <h3 key={index} className="message-heading">{renderInline(heading[1])}</h3>;
    const listItem = trimmed.match(/^(?:\*|-|•)\s+(.+)$/);
    if (listItem) return <div key={index} className="message-list-item"><span>•</span><p>{renderInline(listItem[1])}</p></div>;
    return <p key={index}>{renderInline(trimmed)}</p>;
  })}</>;
}

function renderInline(value: string): ReactNode[] {
  const pieces = value.split(/(\*\*[^*]+\*\*|\$[^$]+\$|`[^`]+`)/g).filter(Boolean);
  return pieces.map((piece, index) => {
    if (piece.startsWith('**') && piece.endsWith('**')) return <strong key={index}>{renderInline(piece.slice(2, -2))}</strong>;
    if (piece.startsWith('$') && piece.endsWith('$')) return <MathInline key={index} value={piece.slice(1, -1)} />;
    if (piece.startsWith('`') && piece.endsWith('`')) return <span key={index} className="chat-inline-code">{formatMath(piece.slice(1, -1))}</span>;
    return <span key={index}>{piece}</span>;
  });
}

function MathBlock({ value }: { value: string }) {
  const matrixStart = value.indexOf('\\begin{bmatrix}');
  const matrixEnd = value.indexOf('\\end{bmatrix}');
  if (matrixStart >= 0 && matrixEnd > matrixStart) {
    const prefix = formatMath(value.slice(0, matrixStart).replace(/=$/, '').trim());
    const matrixValue = value.slice(matrixStart + 15, matrixEnd);
    const rows = matrixValue.split(/\\\\|\n/).map((row) => row.split('&').map((cell) => formatMath(cell.trim()))).filter((row) => row.some(Boolean));
    return <div className="math-card"><span className="math-label">Formula ko simple way mein</span><div className="matrix-line">{prefix && <span>{prefix} =</span>}<span className="matrix-bracket">[</span><table><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table><span className="matrix-bracket">]</span></div></div>;
  }
  return <div className="math-card"><span className="math-label">Iska matlab</span><div className="formula-line">{formatMath(value)}</div></div>;
}

function MathInline({ value }: { value: string }) { return <span className="math-inline" title="Is notation ko teacher simple bhasha mein samjha raha hai">{formatMath(value)}</span>; }

function formatMath(value: string): string {
  return value.replace(/\\lambda/g, 'λ').replace(/\\theta/g, 'θ').replace(/\\Delta/g, 'Δ').replace(/\\Sigma/g, 'Σ').replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ').replace(/\\notin/g, '∉').replace(/\\in/g, '∈').replace(/\\neq/g, '≠').replace(/\\times/g, '×').replace(/\\cdot/g, '·').replace(/\\dots|\\cdots/g, '…').replace(/\\rightarrow|\\to/g, '→').replace(/\\leq/g, '≤').replace(/\\geq/g, '≥').replace(/\\sqrt\{([^{}]+)\}/g, '√($1)').replace(/\\text\{([^{}]+)\}/g, '$1').replace(/\\(?:mathrm|mathbf|mathit)\{([^{}]+)\}/g, '$1').replace(/\\left|\\right/g, '').replace(/[{}]/g, '').replace(/\\/g, '').replace(/\^0/g, '⁰').replace(/\^1/g, '¹').replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/\^4/g, '⁴').replace(/\^5/g, '⁵').replace(/\^6/g, '⁶').replace(/\^7/g, '⁷').replace(/\^8/g, '⁸').replace(/\^9/g, '⁹').replace(/_0/g, '₀').replace(/_1/g, '₁').replace(/_2/g, '₂').replace(/_3/g, '₃').replace(/_4/g, '₄').replace(/_5/g, '₅').replace(/_6/g, '₆').replace(/_7/g, '₇').replace(/_8/g, '₈').replace(/_9/g, '₉').trim();
}
