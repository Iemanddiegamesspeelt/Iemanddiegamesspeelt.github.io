import { cn } from '../../lib/utils';

export function Avatar({
  initials,
  tone = 'from-violet-500 to-indigo-600',
  size = 'md',
  className,
  src,
}: {
  initials: string;
  tone?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  src?: string;
}) {
  const sizes = { sm: 'h-7 w-7 text-[9px]', md: 'h-9 w-9 text-[11px]', lg: 'h-12 w-12 text-sm', xl: 'h-20 w-20 text-xl' };
  return (
    <span style={src ? { backgroundImage: `url("${src.replace(/["\\]/g, '')}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-white ring-1 ring-inset ring-white/15', tone, sizes[size], className)}>
      <span className={src ? 'sr-only' : undefined}>{initials}</span>
    </span>
  );
}
