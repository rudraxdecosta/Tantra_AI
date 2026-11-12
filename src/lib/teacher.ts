import { requireSupabase } from '@/lib/supabase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachment_name: string | null;
  created_at: string;
  image?: TeacherImage | null;
}

export interface ChatAttachment {
  name: string;
  mediaType: string;
  dataBase64: string;
}

const EDGE_FUNCTION_NAME = 'teacher';

export async function loadChatHistory(): Promise<ChatMessage[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('chat_messages')
    .select('id, role, content, attachment_name, created_at')
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    throw new Error('Your conversation could not be loaded.');
  }

  return (data ?? []) as ChatMessage[];
}

export async function saveChatMessage(
  role: 'user' | 'assistant',
  content: string,
  attachmentName: string | null,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('chat_messages')
    .insert({ role, content, attachment_name: attachmentName });

  if (error) {
    throw new Error('This message could not be saved.');
  }
}

export async function clearChatHistory(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('chat_messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    throw new Error('Your conversation could not be cleared.');
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

const ALLOWED_ATTACHMENT_TYPES = [
  'image/',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-powerpoint',
  'text/plain',
];
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export function isAttachmentAllowed(file: File): boolean {
  return ALLOWED_ATTACHMENT_TYPES.some((prefix) => file.type.startsWith(prefix)) && file.size <= MAX_ATTACHMENT_BYTES;
}

export interface TeacherImage {
  src: string;
  alt: string;
}

export interface TeacherReply {
  reply: string;
  image?: TeacherImage | null;
}

export async function askTeacher(params: {
  message: string;
  history: ChatMessage[];
  subject?: string;
  attachments?: File[];
  teachingLevel?: number;
}): Promise<TeacherReply> {
  const client = requireSupabase();
  const attachments: ChatAttachment[] = [];
  for (const file of params.attachments ?? []) {
    attachments.push({
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      dataBase64: await fileToBase64(file),
    });
  }

  const { data, error } = await client.functions.invoke(EDGE_FUNCTION_NAME, {
    body: {
      message: params.message,
      history: params.history.slice(-16).map((message) => ({ role: message.role, content: message.content })),
      subject: params.subject,
      attachments,
      teachingLevel: params.teachingLevel,
    },
  });

  if (error) {
    throw new Error('The teacher could not respond just now. Please try again.');
  }

  const payload = data as TeacherReply | null;
  const reply = payload?.reply;
  if (payload?.error || !reply) {
    throw new Error(payload?.error ?? 'The teacher could not respond just now. Please try again.');
  }

  return { reply, image: payload.image ?? null };
}
