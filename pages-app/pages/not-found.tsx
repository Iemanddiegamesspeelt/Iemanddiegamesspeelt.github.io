import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return <main className="grid min-h-[75vh] place-items-center px-5 text-center"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">404</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em]">Page not found</h1><p className="mt-3 text-sm text-zinc-600">The page may have moved or no longer exists.</p><Link to="/" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-xs font-semibold"><ArrowLeft className="h-4 w-4" />Back to MacroHub</Link></div></main>;
}
