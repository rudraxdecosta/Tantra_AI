import { useEffect, useState } from 'react';
import { Ban, LoaderCircle, ShieldAlert } from 'lucide-react';
import AdminPortal from '@/components/AdminPortal';
import AuthPanel from '@/components/AuthPanel';
import StudyDashboard from '@/components/StudyDashboard';
import TeacherChat from '@/components/TeacherChat';
import { fetchAccessState } from '@/lib/access';
import { isSupabaseConfigured, requireSupabase } from '@/lib/supabase';
import { createStarterCourse, getCourses, loadCourseData, type Course, type CourseData } from '@/lib/study';

const BLOCK_CHECK_INTERVAL_MS = 60_000;

function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminPortal, setIsAdminPortal] = useState(false);
  const [blockMessage, setBlockMessage] = useState('');
  const [isBlocked, setIsBlocked] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [courseData, setCourseData] = useState<CourseData | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<'chat' | 'dashboard'>('chat');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSessionReady(true);
      setIsLoading(false);
      return;
    }

    const client = requireSupabase();
    let mounted = true;

    async function loadSession(): Promise<void> {
      const { data } = await client.auth.getSession();
      if (!mounted) return;
      setIsAuthenticated(Boolean(data.session));
      setUserEmail(data.session?.user.email ?? '');
      setSessionReady(true);
      setIsLoading(false);
    }

    void loadSession();
    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      void (async () => {
        if (!mounted) return;
        setIsAuthenticated(Boolean(nextSession));
        setUserEmail(nextSession?.user.email ?? '');
        if (event === 'SIGNED_OUT') {
          setSelectedCourse(null);
          setCourseData(null);
          setActiveWorkspace('chat');
          setIsBlocked(false);
          setBlockMessage('');
          setIsAdmin(false);
          setIsAdminPortal(false);
        }
        setSessionReady(true);
      })();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    async function checkAccess(): Promise<void> {
      try {
        const state = await fetchAccessState();
        if (cancelled) return;
        setIsAdmin(state.isAdmin);
        if (state.status === 'blocked') {
          setIsBlocked(true);
          setBlockMessage(state.blockMessage);
          const blockedClient = requireSupabase();
          await blockedClient.auth.signOut();
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    }

    async function loadWorkspace(): Promise<void> {
      setIsLoading(true);
      setErrorMessage('');
      try {
        await checkAccess();
        if (cancelled) return;
        const nextCourses = await getCourses();
        const nextCourse = nextCourses[0];
        setSelectedCourse(nextCourse ?? null);
        if (nextCourse) {
          setCourseData(await loadCourseData(nextCourse));
        } else {
          setCourseData(null);
        }
      } catch (error) {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : 'Your workspace could not be loaded.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadWorkspace();
    const interval = window.setInterval(() => void checkAccess(), BLOCK_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isAuthenticated]);

  async function reloadCourse(): Promise<void> {
    if (!selectedCourse) return;
    const refreshed = await loadCourseData(selectedCourse);
    setCourseData(refreshed);
  }

  async function handleCreateCourse(title: string, subjectLabel: string): Promise<void> {
    setIsCreatingCourse(true);
    setErrorMessage('');
    try {
      const courseId = await createStarterCourse(title, subjectLabel);
      const nextCourses = await getCourses();
      const nextCourse = nextCourses.find((course) => course.id === courseId) ?? nextCourses[0];
      setSelectedCourse(nextCourse ?? null);
      if (nextCourse) setCourseData(await loadCourseData(nextCourse));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Your study space could not be created.');
    } finally {
      setIsCreatingCourse(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    const client = requireSupabase();
    setIsAdminPortal(false);
    await client.auth.signOut();
  }

  async function handleHistoryDeleted(): Promise<void> {
    await reloadCourse();
  }

  function handleBlocked(): void {
    setIsBlocked(true);
    setBlockMessage('u are allowed or chal nikal lawde');
  }

  if (!sessionReady || isLoading) {
    return <div className="loading-screen"><div className="loading-mark"><LoaderCircle size={20} className="spin" /></div><span>Loading Tantra</span></div>;
  }

  if (!isSupabaseConfigured) {
    return <div className="connection-screen"><div className="connection-card"><div className="brand-mark"><LoaderCircle size={19} /></div><p className="eyebrow">Tantra workspace</p><h1>Connection needed.</h1><p>The learning workspace is not connected yet, so your private study data cannot be loaded.</p></div></div>;
  }

  if (!isAuthenticated) {
    return (
      <>
        <AuthPanel onComplete={() => undefined} />
        {isBlocked && (
          <div className="modal-backdrop">
            <div className="block-card">
              <div className="block-icon"><Ban size={22} /></div>
              <h2>Access revoked</h2>
              <p className="block-message">{blockMessage || 'u are allowed or chal nikal lawde'}</p>
              <button className="button button-dark button-wide" type="button" onClick={() => { setIsBlocked(false); setBlockMessage(''); }}>Close</button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (isBlocked) {
    return (
      <main className="block-shell">
        <div className="block-card">
          <div className="block-icon"><ShieldAlert size={22} /></div>
          <p className="eyebrow">Tantra</p>
          <h1>You cannot open the app right now.</h1>
          <p className="block-message">{blockMessage || 'u are allowed or chal nikal lawde'}</p>
          <button className="button button-outline" type="button" onClick={() => void handleSignOut()}>Sign out</button>
        </div>
      </main>
    );
  }

  if (isAdmin && isAdminPortal) {
    return <AdminPortal email={userEmail} onSignOut={() => void handleSignOut()} />;
  }

  if (activeWorkspace === 'chat') {
    return <TeacherChat firstName={firstNameFromEmail(userEmail)} email={userEmail} isAdmin={isAdmin} onOpenAdminPortal={() => setIsAdminPortal(true)} onSignOut={() => void handleSignOut()} />;
  }

  if (!courseData) {
    return <CourseSetup email={userEmail} isAdmin={isAdmin} onOpenAdminPortal={() => setIsAdminPortal(true)} isCreating={isCreatingCourse} errorMessage={errorMessage} onCreate={(title, subject) => void handleCreateCourse(title, subject)} onSignOut={() => void handleSignOut()} />;
  }

  return <StudyDashboard data={courseData} userEmail={userEmail} isAdmin={isAdmin} onBackToChat={() => setActiveWorkspace('chat')} onOpenAdminPortal={() => setIsAdminPortal(true)} onSignOut={handleSignOut} onReload={reloadCourse} onHistoryDeleted={handleHistoryDeleted} onBlocked={handleBlocked} />;}

function firstNameFromEmail(email: string): string {
  const rawName = email.split('@')[0]?.split(/[._-]/)[0] ?? '';
  return rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : 'there';
}

function CourseSetup({ email, isAdmin, onOpenAdminPortal, isCreating, errorMessage, onCreate, onSignOut }: { email: string; isAdmin: boolean; onOpenAdminPortal: () => void; isCreating: boolean; errorMessage: string; onCreate: (title: string, subject: string) => void; onSignOut: () => void }) {
  const [title, setTitle] = useState('My first study course');
  const [subject, setSubject] = useState('Calculus');

  return <main className="setup-shell"><div className="setup-card"><div className="brand-lockup"><div className="brand-mark"><LoaderCircle size={18} /></div><span>Tantra</span></div><div className="setup-heading"><p className="eyebrow">A new learning model</p><h1>Start with a subject.</h1><p>Tantra will create a private course map, then refine it as you add material and practice evidence.</p></div><form onSubmit={(event) => { event.preventDefault(); onCreate(title, subject); }} className="setup-form"><label>Course name<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} /></label><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={160} /></label><button className="button button-dark button-wide" type="submit" disabled={isCreating}>{isCreating ? 'Creating your map' : 'Create study space'}<span>→</span></button></form>{errorMessage && <p className="form-message form-error" role="alert">{errorMessage}</p>}<div className="setup-footer"><span>{email}</span><span className="setup-footer-actions">{isAdmin && <button type="button" onClick={onOpenAdminPortal}>Admin portal</button>}<button type="button" onClick={onSignOut}>Sign out</button></span></div></div></main>;
}

export default App;
