import { describe, expect, it, vi } from 'vitest'
import { createTypeSafeClient, TYPESAFE_MODEL } from './typesafe-client.js'
const questions = { test: { type: 'choice' as const, instructions: 'Choose using evidence.', criteria: { yes: 'Yes', no: 'No' } } }
const valid = { model: TYPESAFE_MODEL, answers: { test: { type: 'choice', choice: 'yes', confidence: 0.8, probabilities: { yes: 0.8, no: 0.2 } } }, usage: { input_tokens: 10 } }
describe('TypeSafe client boundary', () => {
  it('pins the official endpoint/model, prevents redirects and returns validated answers only', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...valid, ignored: 'not returned' }))
    const result = await createTypeSafeClient(fetcher).evaluate('test-only-placeholder', { observation: 1 }, questions)
    expect(fetcher).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', expect.objectContaining({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) }))
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: TYPESAFE_MODEL, state: { observation: 1 }, questions })
    expect(result).toMatchObject({ model: TYPESAFE_MODEL, answers: valid.answers, inputTokens: 10 })
    expect(result).not.toHaveProperty('ignored')
  })
  it.each([401, 403, 402, 422, 429, 529, 500])('sanitizes provider errors (%s)', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('do-not-echo-response', { status }))
    const error = await createTypeSafeClient(fetcher).evaluate('test-only-placeholder', {}, questions).catch(e => e)
    expect(error.message).not.toMatch(/do-not-echo-response|test-only-placeholder/)
    expect(error.code).toBe(`http-${status}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    { ...valid, model: 'jev-future' },
    { ...valid, answers: {} },
    { ...valid, answers: { test: { ...valid.answers.test, choice: 'no' } } },
    { ...valid, answers: { test: { ...valid.answers.test, probabilities: { yes: 0.9, no: 0.9 } } } },
    { ...valid, answers: { test: { ...valid.answers.test, probabilities: { yes: 0.8, invented: 0.2 } } } },
  ])('rejects incompatible or invalid probabilities', async value => {
    await expect(createTypeSafeClient(vi.fn().mockResolvedValue(Response.json(value))).evaluate('test-only-placeholder', {}, questions)).rejects.toMatchObject({ code: 'response' })
  })
  it('bounds response size and hides network exceptions', async () => {
    await expect(createTypeSafeClient(vi.fn().mockResolvedValue(new Response('x'.repeat(256001)))).evaluate('test-only-placeholder', {}, questions)).rejects.toMatchObject({ code: 'response' })
    await expect(createTypeSafeClient(vi.fn().mockRejectedValue(new Error('private details'))).evaluate('test-only-placeholder', {}, questions)).rejects.toMatchObject({ code: 'network' })
  })
})
