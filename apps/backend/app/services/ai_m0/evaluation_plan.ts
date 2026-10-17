import { AI_M0_STRATEGIES, type AiM0EvaluationMode, type AiM0EvaluationStep } from '@aiproj/types'
import { AI_M0_INPUT_CASES } from './inputs.ts'

export const AI_M0_REAL_REPETITIONS = 20
export const AI_M0_REAL_TEMPERATURE = 0

export function buildEvaluationPlan(options: {
  mode: AiM0EvaluationMode
  repetitions?: number
}): AiM0EvaluationStep[] {
  const repetitions =
    options.mode === 'real'
      ? AI_M0_REAL_REPETITIONS
      : Math.max(1, Math.min(AI_M0_REAL_REPETITIONS, options.repetitions ?? 1))
  const steps: AiM0EvaluationStep[] = []
  for (const strategy of AI_M0_STRATEGIES) {
    for (const input of AI_M0_INPUT_CASES) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        steps.push({
          id: `${strategy}:${input.id}:${String(repetition).padStart(2, '0')}`,
          inputId: input.id,
          requestedStrategy: strategy,
          repetition,
          status: 'pending',
          attempts: 0,
        })
      }
    }
  }
  return steps
}
