/** Keep the first publication for each identical realised window, before
 * filtering abstentions or direction. Weekend updates must not multiply the
 * same Monday outcome or allow a later call to replace an earlier miss.
 * Different, overlapping windows remain dependent observations. */
export function firstPerOutcomeWindow<T>(items: T[], select: (item: T) => { issuedAt: string; start: string | null; end: string | null }): T[] {
  const seen = new Set<string>()
  return items.slice().sort((a, b) => select(a).issuedAt.localeCompare(select(b).issuedAt)).filter(item => {
    const { start, end } = select(item)
    // Complete production outcomes always have dates. Do not merge unknown
    // dates into one apparently verified observation.
    if (!start || !end) return true
    const key = `${start}:${end}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
