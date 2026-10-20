const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar YYYY-MM-DD. Never parse with `new Date(value)` — that is UTC-midnight and shifts locally. */
export function isCalendarDate(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = DATE_ONLY.exec(value);
  if (!match) return value;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return `${MONTHS[month - 1]} ${day}, ${match[1]}`;
}

export function completionLabel(status: string, completedAt: string | null | undefined): string | null {
  if (status !== 'done') return null;
  if (!completedAt) return 'Completion time unavailable';
  return completedAt;
}
