import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  useEffect(() => {
    const finish = async () => {
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { error: exchangeError } = await supabase().auth.exchangeCodeForSession(code);
        if (exchangeError) { setError(exchangeError.message); return; }
      }
      const { data } = await supabase().auth.getSession();
      if (!data.session) { setError('The sign-in link is invalid or expired.'); return; }
      const next = sessionStorage.getItem('macrohub_auth_return') || '/';
      sessionStorage.removeItem('macrohub_auth_return');
      navigate(next, { replace: true });
    };
    void finish();
  }, [navigate]);
  return <main className="grid min-h-[75vh] place-items-center px-5"><div className="text-center">{error ? <><h1 className="text-2xl font-semibold">Could not sign in</h1><p className="mt-3 text-sm text-rose-200">{error}</p></> : <><LoaderCircle className="mx-auto h-7 w-7 animate-spin text-violet-300" /><h1 className="mt-4 text-lg font-semibold">Finishing sign in…</h1></>}</div></main>;
}
