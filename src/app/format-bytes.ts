/**
 * Human-readable byte count using binary prefixes (1 KB = 1024 B).
 * Used by the "My Tube" and "Storage Budgets" consoles for the usage bar
 * label and per-job/per-user size display.
 *
 * @param n - Byte count, or null/undefined (treated as 0 B).
 * @returns Human-readable string, e.g. `'1.5 GB'`.
 */
export function formatBytes(n: number | null | undefined): string {
  const bytes = n ?? 0;
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
