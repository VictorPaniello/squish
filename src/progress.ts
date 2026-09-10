/** Renders an install-script style ASCII progress bar, e.g.
 * "[#######-----------] 35% (7/20)". Kept as a pure, synchronous
 * function (no stdout/TTY access) so it's trivially unit-testable -
 * the actual terminal writing (carriage return, line clearing, the
 * TTY check that disables it entirely when output isn't a real
 * terminal) lives in cli.ts, which is exercised by the CLI's own
 * end-to-end tests instead. */
export function formatProgressBar(completed: number, total: number, width = 30): string {
  if (total <= 0) return `[${"#".repeat(width)}] 100% (0/0)`
  const ratio = Math.min(Math.max(completed, 0) / total, 1)
  const filled = Math.round(ratio * width)
  const bar = "#".repeat(filled) + "-".repeat(width - filled)
  const pct = Math.round(ratio * 100)
  return `[${bar}] ${pct}% (${completed}/${total})`
}
