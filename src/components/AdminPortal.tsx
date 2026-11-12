import { useEffect, useState } from 'react';
import { Ban, BookOpen, CheckCircle2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { requireSupabase } from '@/lib/supabase';

export interface AdminRegistration {
  user_id: string;
  email: string;
  status: 'active' | 'blocked' | string;
  block_message: string | null;
  created_at: string;
  last_seen_at: string | null;
}

interface AdminPortalProps {
  email: string;
  onSignOut: () => void;
}

export default function AdminPortal({ email, onSignOut }: AdminPortalProps) {
  const [registrations, setRegistrations] = useState<AdminRegistration[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadRegistrations(): Promise<void> {
    setIsRefreshing(true);
    setActionError('');
    try {
      const client = requireSupabase();
      const { data, error } = await client.rpc('admin_list_registrations');
      if (error) throw new Error('The registration list could not be loaded.');
      setRegistrations((data ?? []) as AdminRegistration[]);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'The registration list could not be loaded.');
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadRegistrations();
  }, []);

  async function setBlocked(registration: AdminRegistration, block: boolean): Promise<void> {
    setBusyUserId(registration.user_id);
    setActionError('');
    try {
      const client = requireSupabase();
      const { error } = await client.rpc('admin_set_user_status', {
        p_user_id: registration.user_id,
        p_block: block,
        p_message: 'u are allowed or chal nikal lawde',
      });
      if (error) throw new Error('This change could not be saved.');
      await loadRegistrations();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'This change could not be saved.');
    } finally {
      setBusyUserId(null);
    }
  }

  function exportCsv(): void {
    if (!registrations?.length) return;
    const header = 'email,status,registered_at,last_seen_at,block_message';
    const rows = registrations.map((row) => [
      row.email,
      row.status,
      row.created_at,
      row.last_seen_at ?? '',
      (row.block_message ?? '').replace(/"/g, '""'),
    ].map((value) => `"${value}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tantra-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const activeCount = registrations?.filter((row) => row.status === 'active').length ?? 0;
  const blockedCount = registrations?.filter((row) => row.status === 'blocked').length ?? 0;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><ShieldCheck size={18} strokeWidth={2.5} /></div>
          <span>Tantra Admin</span>
        </div>
        <div className="admin-topbar-actions">
          <span className="admin-email">{email}</span>
          <button className="refresh-button" onClick={() => void loadRegistrations()} disabled={isRefreshing} aria-label="Refresh registrations">
            <RefreshCw size={16} className={isRefreshing ? 'spin' : ''} />
          </button>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <section className="admin-content">
        <div className="page-intro animate-in">
          <div>
            <p className="eyebrow">Private control room</p>
            <h1>Registrations.</h1>
            <p className="intro-copy">Every account created in Tantra appears here. Blocking an account locks the app for that person instantly, including any open sessions.</p>
          </div>
          <div className="admin-stats">
            <div className="admin-stat"><Users size={16} /><strong>{registrations?.length ?? '—'}</strong><span>registered</span></div>
            <div className="admin-stat"><CheckCircle2 size={16} /><strong>{registrations ? activeCount : '—'}</strong><span>active</span></div>
            <div className="admin-stat"><Ban size={16} /><strong>{registrations ? blockedCount : '—'}</strong><span>blocked</span></div>
            <button className="button button-outline" type="button" onClick={exportCsv} disabled={!registrations?.length}>Export CSV</button>
          </div>
        </div>

        {actionError && <p className="form-message form-error" role="alert">{actionError}</p>}
        {loadError && <p className="form-message form-error" role="alert">{loadError}</p>}

        <div className="admin-table-wrap animate-in">
          {registrations === null && !loadError ? (
            <div className="empty-insight"><BookOpen size={18} /><p>Loading registrations…</p></div>
          ) : registrations?.length ? (
            <table className="admin-table">
              <thead>
                <tr><th>Email</th><th>Status</th><th>Registered</th><th>Last seen</th><th>Action</th></tr>
              </thead>
              <tbody>
                {registrations.map((row) => (
                  <tr key={row.user_id} className={row.status === 'blocked' ? 'row-blocked' : ''}>
                    <td data-label="Email">{row.email}</td>
                    <td data-label="Status">
                      <span className={row.status === 'blocked' ? 'status-pill status-blocked' : 'status-pill status-active'}>
                        {row.status === 'blocked' ? 'Blocked' : 'Active'}
                      </span>
                    </td>
                    <td data-label="Registered">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td data-label="Last seen">{row.last_seen_at ? new Date(row.last_seen_at).toLocaleDateString() : '—'}</td>
                    <td data-label="Action">
                      {row.status === 'blocked' ? (
                        <button className="button button-outline button-small" type="button" disabled={busyUserId === row.user_id} onClick={() => void setBlocked(row, false)}>Unblock</button>
                      ) : (
                        <button className="button button-dark button-small" type="button" disabled={busyUserId === row.user_id} onClick={() => void setBlocked(row, true)}>Block</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-insight"><Users size={18} /><p>No one has registered yet.</p></div>
          )}
        </div>

        <p className="admin-note">Blocked accounts see the moderator message and lose app access immediately. Add new administrators by inserting their email into the <code>tantra_admin_emails</code> allowlist in the database.</p>
      </section>
    </main>
  );
}
