/** Bounded retries for public context reads. SEC has its own stricter policy. */
export function contextReadFailure(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const status = /(?:HTTP|status(?: code)?|response(?: code)?)\D{0,12}(\d{3})\b/i.exec(message)?.[1]
  if (status) return `HTTP ${status}`
  if (/429|too.many.requests|rate.limit/i.test(message)) return 'rate limited'
  if (/timeout|timed out|abort/i.test(message)) return 'request timed out'
  if (/fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket/i.test(message)) return 'network request failed'
  // Provider messages can embed request headers, URLs or credentials.
  return 'provider request failed (unclassified)'
}

function retryable(error: unknown): boolean {
  const reason = contextReadFailure(error)
  return reason === 'request timed out' || reason === 'network request failed' || /^HTTP 5\d\d$/.test(reason)
}

export function createContextReader() {
  const pending = new Map<string, Promise<unknown>>()
  const starts = new Map<string, number>()
  return async function read<T>(id: string, operation: () => Promise<T>): Promise<T> {
    let task = pending.get(id) as Promise<T> | undefined
    if (!task) {
      const started = performance.now()
      starts.set(id, started)
      task = (async () => {
        try { return await operation() }
        catch (error) {
          if (!retryable(error) || performance.now() - started > 12_000) throw error
          await new Promise(resolve => setTimeout(resolve, 250))
          return operation()
        }
      })()
      pending.set(id, task)
      // Keep ownership of an uncancellable upstream read until it settles.
      // A later scan must not launch another copy of a stuck request.
      void task.then(() => { pending.delete(id); starts.delete(id) }, () => { pending.delete(id); starts.delete(id) })
    }
    const remaining = 12_500 - (performance.now() - starts.get(id)!)
    if (remaining <= 0) throw new Error('Context read timed out after 12500ms; upstream request still pending')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([task, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Context read timed out after 12500ms')), remaining)
      })])
    } finally { clearTimeout(timer) }
  }
}
