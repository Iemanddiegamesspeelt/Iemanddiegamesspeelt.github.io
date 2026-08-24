import type { ReactNode } from 'react';
import { getChatGPTUser } from '../../app/chatgpt-auth';
import { Footer } from './footer';
import { Navbar } from './navbar';

export async function SiteShell({ children }: { children: ReactNode }) {
  const user = await getChatGPTUser();
  return (
    <div className="min-h-screen bg-[#080a0f] text-white">
      <Navbar user={user ? { displayName: user.displayName, email: user.email } : null} />
      {children}
      <Footer />
    </div>
  );
}

