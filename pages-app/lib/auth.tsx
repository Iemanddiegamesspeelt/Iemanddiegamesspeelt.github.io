import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';
import type { ProfileRow } from './types';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured());

  async function loadProfile(userId: string | undefined) {
    if (!userId || !isSupabaseConfigured()) {
      setProfile(null);
      return;
    }
    const { data } = await supabase().from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile((data as ProfileRow | null) ?? null);
  }

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }
    const client = supabase();
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      return loadProfile(data.session?.user.id);
    }).finally(() => setLoading(false));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void loadProfile(nextSession?.user.id);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    refreshProfile: () => loadProfile(session?.user.id),
    signOut: async () => {
      if (isSupabaseConfigured()) {
        const { error } = await supabase().auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
      setSession(null);
      setProfile(null);
    },
  }), [session, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
