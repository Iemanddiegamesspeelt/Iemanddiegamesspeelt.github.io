export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function relativeDate(value: string): string {
  const days = Math.round((new Date(value).getTime() - Date.now()) / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(days) < 30) return formatter.format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, 'month');
  return formatter.format(Math.round(months / 12), 'year');
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatRate(tps?: number, fps?: number): string {
  if (tps) return `${tps} TPS`;
  if (fps) return `${fps} FPS`;
  return 'Rate unknown';
}

export function formatGeometryDashVersion(value?: string | null): string {
  const raw = value?.trim();
  if (!raw || raw.toLowerCase() === 'unknown') return 'Unknown';
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return raw;
  if (Number.isInteger(numeric) && numeric >= 100) {
    const digits = String(numeric);
    return `${digits[0]}.${digits.slice(1)}`;
  }
  return numeric.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
