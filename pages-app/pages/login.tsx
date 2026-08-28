import { AlertTriangle, Chrome, LoaderCircle, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { absoluteAppUrl, isSupabaseConfigured, supabase } from '../lib/supabase';

export function LoginPage() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const next = safeNext(query.get('return_to'));
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (!loading && user) return <Navigate to={next} replace />;

  async function google() {
    setBusy(true); setError('');
    try {
      if (!isSupabaseConfigured()) throw new Error('Authentication is not configured yet.');
      sessionStorage.setItem('macrohub_auth_return', next);
      const { data, error: authError } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: absoluteAppUrl('auth/callback') } });
      if (authError) throw authError;
      if (data.url) window.location.assign(data.url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Google sign-in failed.'); setBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    try {
      if (!isSupabaseConfigured()) throw new Error('Authentication is not configured yet.');
      if (mode === 'register') {
        const displayName = String(form.get('displayName') ?? '').trim();
        const { data, error: authError } = await supabase().auth.signUp({ email, password, options: { data: { full_name: displayName }, emailRedirectTo: absoluteAppUrl('auth/callback') } });
        if (authError) throw authError;
        if (!data.session) { setMessage('Check your email to confirm your account, then return here to sign in.'); return; }
      } else {
        const { error: authError } = await supabase().auth.signInWithPassword({ email, password });
        if (authError) throw new Error('The email address or password is incorrect.');
      }
      navigate(next, { replace: true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto grid min-h-[78vh] max-w-6xl items-center gap-10 px-5 py-14 lg:grid-cols-[1fr_460px] lg:px-8"><section className="hidden lg:block"><p className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-300">Your MacroHub account</p><h1 className="mt-5 max-w-xl text-6xl font-semibold tracking-[-.06em]">Upload, like, collect, and share.</h1><p className="mt-6 max-w-xl text-sm leading-7 text-zinc-500">Use Google for a quick start or create an account with your email address and password.</p><div className="surface-grid mt-10 h-40 rounded-[28px] border border-white/[.055] bg-gradient-to-br from-violet-500/[.08] to-cyan-500/[.025]" /></section>
    <section className="rounded-[28px] border border-white/[.085] bg-[#0e1118] p-6 shadow-2xl shadow-black/25 sm:p-8"><h2 className="text-2xl font-semibold">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2><p className="mt-2 text-sm text-zinc-600">{mode === 'sign-in' ? 'Sign in to continue to MacroHub.' : 'Join the Geometry Dash macro community.'}</p>
      <button type="button" onClick={() => void google()} disabled={busy} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[.1] bg-white/[.05] text-sm font-semibold hover:bg-white/[.09] disabled:opacity-50"><Chrome className="h-4 w-4" />Continue with Google</button>
      <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-widest text-zinc-700"><span className="h-px flex-1 bg-white/[.07]" />or<span className="h-px flex-1 bg-white/[.07]" /></div>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">{mode === 'register' && <Field icon={UserRound} label="Display name" name="displayName" type="text" autoComplete="name" minLength={1} maxLength={80} />}<Field icon={Mail} label="Email address" name="email" type="email" autoComplete="email" /><Field icon={LockKeyhole} label="Password" name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={8} maxLength={128} /><button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-sm font-semibold hover:bg-violet-400 disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{mode === 'sign-in' ? 'Sign in' : 'Create account'}</button></form>
      {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/15 bg-rose-400/[.06] p-3 text-xs leading-5 text-rose-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}{message && <p className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[.06] p-3 text-xs leading-5 text-emerald-200">{message}</p>}
      <button type="button" onClick={() => { setMode(mode === 'sign-in' ? 'register' : 'sign-in'); setError(''); setMessage(''); }} className="mt-6 w-full text-center text-xs text-zinc-500 hover:text-white">{mode === 'sign-in' ? 'New to MacroHub? Create an account' : 'Already have an account? Sign in'}</button>
    </section></main>;
}

function Field({ icon: Icon, label, name, type, autoComplete, minLength, maxLength }: { icon: typeof Mail; label: string; name: string; type: string; autoComplete: string; minLength?: number; maxLength?: number }) { return <label className="block"><span className="mb-2 block text-[11px] font-medium text-zinc-400">{label}</span><span className="flex h-12 items-center gap-2 rounded-xl border border-white/[.08] bg-[#11151d] px-3.5 focus-within:border-violet-400/40"><Icon className="h-4 w-4 text-zinc-600" /><input name={name} type={type} required autoComplete={autoComplete} minLength={minLength} maxLength={maxLength} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-700" /></span></label>; }
function safeNext(value: string | null) { return value?.startsWith('/') && !value.startsWith('//') ? value : '/'; }
