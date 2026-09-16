/** Provider failures are persisted in scan receipts and displayed in the UI. */
export function safeMarketDataError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
    .replace(/organizations\/[^\s"']+\/apiKeys\/[^\s"',;)]+/g, '[REDACTED KEY NAME]')
    .replace(/((?:api[_-]?key|private[_-]?key|secret|token|authorization|password)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',;)]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[^\s"',;)]+/gi, 'Bearer [REDACTED]')
    .slice(0, 1500)
}
