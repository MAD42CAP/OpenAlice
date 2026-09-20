import { z } from 'zod'

export const TYPESAFE_MODEL = 'jev-1.13.0'
export type JevQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
export interface JevAnswer { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
export interface JevResult { model: string; answers: Record<string, JevAnswer>; inputTokens: number; durationMs: number }

/** Only controlled messages leave this boundary. Provider bodies can echo input
 * or credentials and must never reach logs, journal entries or the browser. */
export class TypeSafeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TypeSafeError' }
}
const messages: Record<number, string> = {
  401: 'TypeSafe API Key 无效或已失效，请在 AI 提供方设置中更新。',
  403: 'TypeSafe 拒绝访问，请检查账户的模型使用权限。',
  402: 'TypeSafe 账户额度不足。',
  422: 'TypeSafe 请求格式或模型版本不受支持。',
  429: 'TypeSafe 请求限流，请稍后重试。',
  529: 'TypeSafe 服务繁忙，请稍后重试。',
}
const answerSchema = z.object({ type: z.literal('choice'), choice: z.string(), confidence: z.number().min(0).max(1), probabilities: z.record(z.string(), z.number().min(0).max(1)) })
const responseSchema = z.object({ model: z.string().regex(/^jev-[\w.-]{1,64}$/), answers: z.record(z.string(), answerSchema), usage: z.object({ input_tokens: z.number().int().nonnegative() }) })

export function createTypeSafeClient(fetcher: typeof fetch = fetch) {
  return {
    async evaluate(apiKey: string, state: unknown, questions: Record<string, JevQuestion>): Promise<JevResult> {
      if (!apiKey.trim()) throw new TypeSafeError('not-configured', '请先在 AI 提供方设置中保存 TypeSafe API Key。')
      const start = performance.now()
      // One bounded call, no recursive agent or unbounded automatic retries.
      let response: Response
      try {
        response = await fetcher('https://api.typesafe.ai/v1/systemone', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: TYPESAFE_MODEL, state, questions }),
        })
      } catch { throw new TypeSafeError('network', 'TypeSafe 连接失败或超时，现有行情与分析不受影响。') }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new TypeSafeError(`http-${response.status}`, messages[response.status] ?? 'TypeSafe 服务请求失败，请稍后重试。') }
      let raw: unknown
      try {
        // Bound response size and the body-read duration as well as connection time.
        const reader = response.body?.getReader()
        if (!reader) throw new Error()
        const chunks: Uint8Array[] = []; let bytes = 0
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          if (bytes > 256_000) { await reader.cancel(); throw new Error() }
          chunks.push(part.value)
        }
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch { throw new TypeSafeError('response', 'TypeSafe 返回的数据无法验证。') }
      const parsed = responseSchema.safeParse(raw)
      if (!parsed.success || parsed.data.model !== TYPESAFE_MODEL) throw new TypeSafeError('response', 'TypeSafe 返回的模型版本或数据格式不匹配。')
      const answers: Record<string, JevAnswer> = {}
      for (const [id, question] of Object.entries(questions)) {
        const answer = parsed.data.answers[id], options = Object.keys(question.criteria)
        if (!answer || !options.includes(answer.choice) || Object.keys(answer.probabilities).length !== options.length
          || options.some(option => answer.probabilities[option] === undefined)
          || Math.abs(Object.values(answer.probabilities).reduce((a, b) => a + b, 0) - 1) > 0.001
          || answer.probabilities[answer.choice]! < Math.max(...Object.values(answer.probabilities)) - 1e-6) {
          throw new TypeSafeError('response', 'TypeSafe 返回的选项或概率分布无效。')
        }
        answers[id] = answer
      }
      return { model: parsed.data.model, answers, inputTokens: parsed.data.usage.input_tokens, durationMs: Math.round(performance.now() - start) }
    },
  }
}
