import { useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, KeyRound, LockKeyhole, Mail } from 'lucide-react';
import { requireSupabase } from '@/lib/supabase';

interface AuthPanelProps {
  onComplete: () => void;
}

type AuthMode = 'sign-in' | 'sign-up' | 'forgot';

export default function AuthPanel({ onComplete }: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  function resetFeedback(): void {
    setErrorMessage('');
    setSuccessMessage('');
  }

  async function handleForgot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    resetFeedback();
    try {
      const client = requireSupabase();
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) throw new Error('The reset link could not be sent.');
      setSuccessMessage('If that email is registered, a reset link is on its way.');
    } catch (caught) {
      setErrorMessage(caught instanceof Error ? caught.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    resetFeedback();

    try {
      const client = requireSupabase();
      const result = mode === 'sign-in'
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({ email, password });

      if (result.error) {
        if (result.error.code === 'weak_password') {
          throw new Error('That password is too short or too common. Use at least 6 characters and avoid obvious ones like "1234" or "password".');
        }
        throw new Error(mode === 'sign-in' ? 'The email or password was not recognised.' : 'Your account could not be created.');
      }

      if (mode === 'sign-up' && !result.data.session) {
        setSuccessMessage('Your account is ready. Sign in with your email and password.');
        setMode('sign-in');
        return;
      }

      onComplete();
    } catch (caught) {
      setErrorMessage(caught instanceof Error ? caught.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand-lockup">
          <div className="brand-mark"><BookOpen size={18} strokeWidth={2.5} /></div>
          <span>Tantra</span>
        </div>
        <div className="story-content">
          <p className="eyebrow">Adaptive learning, made legible</p>
          <h1>Understand the subject. Understand the learner.</h1>
          <p className="story-copy">Tantra builds a private, evidence-backed map of what you are learning and how you learn best.</p>
          <div className="story-note"><span className="note-line" />Every answer becomes useful context for the next lesson.</div>
        </div>
        <p className="story-footer">Private by design · Evidence over assumptions</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          {mode === 'forgot' ? (
            <>
              <div className="auth-heading">
                <div className="auth-icon"><KeyRound size={18} /></div>
                <p className="eyebrow">Forgot password</p>
                <h2>Reset your password.</h2>
                <p>We will email you a link to set a new one. The new password becomes the one you use from then on.</p>
              </div>
              <form onSubmit={handleForgot} className="auth-form">
                <label>
                  Email address
                  <span className="input-wrap"><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></span>
                </label>
                {errorMessage && <p className="form-message form-error" role="alert">{errorMessage}</p>}
                {successMessage && <p className="form-message form-success" role="status">{successMessage}</p>}
                <button className="button button-dark button-wide" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Sending link' : 'Send reset link'}
                  {!isSubmitting && <ArrowRight size={16} />}
                </button>
              </form>
              <div className="auth-switch">
                <span>Remembered it?</span>
                <button type="button" onClick={() => { setMode('sign-in'); resetFeedback(); }}>Back to sign in</button>
              </div>
            </>
          ) : (
            <>
              <div className="auth-heading">
                <div className="auth-icon"><LockKeyhole size={18} /></div>
                <p className="eyebrow">Your learning workspace</p>
                <h2>{mode === 'sign-in' ? 'Welcome back.' : 'Start your study model.'}</h2>
                <p>{mode === 'sign-in' ? 'Continue where your evidence left off.' : 'Create your account once, then sign in with the same email and password any time.'}</p>
              </div>

              <form onSubmit={handleSubmit} className="auth-form">
                <label>
                  Email address
                  <span className="input-wrap"><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></span>
                </label>
                <label>
                  Password
                  <span className="input-wrap"><LockKeyhole size={16} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} placeholder="At least 6 characters" /></span>
                </label>
                {errorMessage && <p className="form-message form-error" role="alert">{errorMessage}</p>}
                {successMessage && <p className="form-message form-success" role="status">{successMessage}</p>}
                <button className="button button-dark button-wide" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Opening workspace' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
                  {!isSubmitting && <ArrowRight size={16} />}
                </button>
              </form>

              <div className="auth-links">
                {mode === 'sign-in' && <button type="button" onClick={() => { setMode('forgot'); resetFeedback(); }}>Forgot password?</button>}
              </div>

              <div className="auth-switch">
                <span>{mode === 'sign-in' ? 'New to Tantra?' : 'Already have an account?'}</span>
                <button type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); resetFeedback(); }}>
                  {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
