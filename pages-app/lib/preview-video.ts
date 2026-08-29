export type PreviewVideo = { url: string; embedUrl: string };

const youtubeIdPattern = /^[a-zA-Z0-9_-]{6,15}$/;

export function parsePreviewVideoUrl(value: string): PreviewVideo | null {
  const input = value.trim();
  if (!input) return null;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Enter a valid preview video URL.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Preview videos must use a secure HTTPS link.');
  if (parsed.username || parsed.password) throw new Error('Preview video links cannot contain login information.');

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    if (!youtubeIdPattern.test(id)) throw new Error('That YouTube link is not valid.');
    return { url: parsed.toString(), embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    const id = parsed.searchParams.get('v') ?? (['embed', 'shorts', 'live'].includes(parts[0] ?? '') ? parts[1] : '');
    if (!id || !youtubeIdPattern.test(id)) throw new Error('That YouTube link is not valid.');
    return { url: parsed.toString(), embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }

  throw new Error('Use a valid YouTube video link.');
}
