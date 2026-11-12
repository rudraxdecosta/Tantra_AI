import { requireSupabase } from '@/lib/supabase';

export interface AccessState {
  status: 'active' | 'blocked';
  blockMessage: string;
  isAdmin: boolean;
}

export async function fetchAccessState(): Promise<AccessState> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_tantra_access_state');

  if (error) {
    throw new Error('Your account status could not be checked.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: row?.status === 'blocked' ? 'blocked' : 'active',
    blockMessage: row?.block_message ?? 'You are not allowed to use Tantra right now.',
    isAdmin: Boolean(row?.is_admin),
  };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.resetPasswordForEmail(email);

  if (error) {
    throw new Error('The reset link could not be sent.');
  }
}

export async function updatePassword(newPassword: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error('Your password could not be changed.');
  }
}
