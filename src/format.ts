/** Human-readable byte size, e.g. 842KB, 3.2MB. Under 1MB shows no
 * decimal (nobody needs "842.0KB"); at 1MB and above shows one, since
 * that's where the rounding actually matters for judging a result. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** "-34%" for a real reduction, "+12%" if the output somehow ended up
 * bigger (an already-tiny or already-compressed source, most often) -
 * shown as-is rather than hidden, so a surprising result stays visible
 * instead of silently reporting a savings number that isn't true. */
export function formatSavings(before: number, after: number): string {
  const pct = Math.round((1 - after / before) * 100)
  return pct >= 0 ? `-${pct}%` : `+${Math.abs(pct)}%`
}
