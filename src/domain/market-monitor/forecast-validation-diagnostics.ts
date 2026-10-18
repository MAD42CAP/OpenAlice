import type { ReturnChoice } from './forecast-experiment-types.js'
import { validForwardAnswer } from './forecast-validation-input.js'
import type { ForwardCandidate, ForwardJevOutcomeDiagnostics } from './forecast-validation-types.js'
import type { JevHorizon } from './typesafe-types.js'

/** Project only saved answers. Invalid/missing raw answers cannot become a
 * scored call; a valid raw call remains separate from the guarded decision. */
export function projectJevDiagnostics(candidate: ForwardCandidate | null, horizon: JevHorizon, actual: ReturnChoice | null): ForwardJevOutcomeDiagnostics {
  const answer = candidate?.raw.answers[horizon], evidence = candidate?.raw.answers[`${horizon}Evidence`], signal = candidate?.raw.answers[`${horizon}Signal`]
  const rawAnswerValid = validForwardAnswer(answer, ['up', 'flat', 'down'])
  const evidenceValid = validForwardAnswer(evidence, ['adequate', 'insufficient'])
  const signalValid = validForwardAnswer(signal, ['supported', 'uncertain'])
  const rawChoice = rawAnswerValid ? answer.choice as ReturnChoice : null
  return { rawAnswerValid, rawChoice, rawCorrect: rawChoice && actual ? rawChoice === actual : null,
    rawSelectedProbability: rawChoice ? answer!.probabilities[rawChoice]! : null,
    evidence: { valid: evidenceValid, choice: evidenceValid ? evidence.choice as 'adequate' | 'insufficient' : null },
    signal: { valid: signalValid, choice: signalValid ? signal.choice as 'supported' | 'uncertain' : null },
    reasons: [...(candidate?.decisions[horizon].reasons ?? [])] }
}
