import type { ProfileRow } from '../lib/types';

export function Avatar({
  profile,
  className = 'h-7 w-7 rounded-lg',
}: {
  profile?: Pick<ProfileRow, 'username' | 'display_name' | 'avatar_url'> | null;
  className?: string;
}) {
  const name = profile?.display_name ?? profile?.username ?? 'Player';
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-violet-500 to-indigo-700 font-semibold text-white ${className}`}>
    {profile?.avatar_url
      ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
      : <span>{name.slice(0, 1).toUpperCase()}</span>}
  </span>;
}
