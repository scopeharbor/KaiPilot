import {
  AI_M0_ERROR_KINDS,
  AI_M0_STRATEGIES,
  type AiM0EvaluationMode,
  type AiM0EvaluationOutcome,
  type AiM0EvaluationRun,
  type AiM0EvaluationStep,
  type AiM0EvaluationSummary,
  type AiM0Strategy,
  type AiM0StrategySummary,
} from '@aiproj/types'
import { percentile } from './measure'

export const AI_M0_RUN_STORAGE_KEY = 'aiproj:ai-m0:evaluation-run:v1'

export function createEvaluationRun(input: {
  id: string
  mode: AiM0EvaluationMode
  connectionId: string | null
  inputSetHash: string
  repetitions: number
  steps: AiM0EvaluationStep[]
  now: string
}): AiM0EvaluationRun {
  return {
    schemaVersion: 1,
    id: input.id,
    mode: input.mode,
    status: 'idle',
    connectionId: input.connectionId,
    inputSetHash: input.inputSetHash,
    repetitions: input.repetitions,
    temperature: 0,
    createdAt: input.now,
    updatedAt: input.now,
    steps: input.steps.map((step) => ({ ...step, status: 'pending', attempts: 0 })),
    outcomes: [],
  }
}

export function recoverEvaluationRun(run: AiM0EvaluationRun, now: string): AiM0EvaluationRun {
  return {
    ...run,
    status: run.status === 'running' || run.status === 'pausing' ? 'paused' : run.status,
    updatedAt: now,
    steps: run.steps.map((step) =>
      step.status === 'running' ? { ...step, status: 'pending' } : step,
    ),
  }
}

export function markStepRunning(
  run: AiM0EvaluationRun,
  stepId: string,
  now: string,
): AiM0EvaluationRun {
  return {
    ...run,
    status: 'running',
    updatedAt: now,
    steps: run.steps.map((step) =>
      step.id === stepId ? { ...step, status: 'running', attempts: step.attempts + 1 } : step,
    ),
  }
}

export function completeStep(
  run: AiM0EvaluationRun,
  outcome: AiM0EvaluationOutcome,
  now: string,
): AiM0EvaluationRun {
  const steps = run.steps.map((step) =>
    step.id === outcome.stepId ? { ...step, status: 'completed' as const } : step,
  )
  const outcomes = [...run.outcomes.filter((item) => item.stepId !== outcome.stepId), outcome]
  const finished = steps.every((step) => step.status === 'completed')
  return {
    ...run,
    status: finished ? 'completed' : run.status === 'pausing' ? 'paused' : 'running',
    updatedAt: now,
    steps,
    outcomes,
  }
}

export function failStep(run: AiM0EvaluationRun, stepId: string, now: string): AiM0EvaluationRun {
  return {
    ...run,
    status: run.status === 'pausing' ? 'paused' : 'running',
    updatedAt: now,
    steps: run.steps.map((step) => (step.id === stepId ? { ...step, status: 'failed' } : step)),
  }
}

export function nextRunnableStep(run: AiM0EvaluationRun): AiM0EvaluationStep | null {
  return run.steps.find((step) => step.status === 'pending') ?? null
}

export function summarizeEvaluationRun(run: AiM0EvaluationRun): AiM0EvaluationSummary {
  const perStrategy = Object.fromEntries(
    AI_M0_STRATEGIES.map((strategy) => [
      strategy,
      summarizeStrategy(
        strategy,
        run.outcomes.filter((item) => item.requestedStrategy === strategy),
      ),
    ]),
  ) as Record<AiM0Strategy, AiM0StrategySummary>
  return {
    complete: run.status === 'completed',
    evidenceEligible:
      run.status === 'completed' &&
      run.mode === 'real' &&
      run.outcomes.length === run.steps.length &&
      run.outcomes.every((item) => item.evidenceEligible),
    total: run.steps.length,
    completed: run.steps.filter((step) => step.status === 'completed').length,
    failed: run.steps.filter((step) => step.status === 'failed').length,
    perStrategy,
  }
}

function summarizeStrategy(
  strategy: AiM0Strategy,
  outcomes: AiM0EvaluationOutcome[],
): AiM0StrategySummary {
  const strict = outcomes.filter((item) => item.bucket === 'strict').length
  const repaired = outcomes.filter((item) => item.bucket === 'repaired').length
  const failed = outcomes.filter((item) => item.bucket === 'failed').length
  const runs = outcomes.length
  const errors = Object.fromEntries(AI_M0_ERROR_KINDS.map((kind) => [kind, 0])) as Record<
    (typeof AI_M0_ERROR_KINDS)[number],
    number
  >
  for (const outcome of outcomes) {
    for (const error of outcome.triggeredErrors) errors[error] += 1
  }
  return {
    strategy,
    runs,
    strict,
    repaired,
    failed,
    landableRate: runs ? (strict + repaired) / runs : 0,
    markerCoverage: runs ? outcomes.reduce((sum, item) => sum + item.markerCoverage, 0) / runs : 0,
    firstTokenP50Ms: percentile(
      outcomes.map((item) => item.firstTokenMs),
      0.5,
    ),
    firstTokenP95Ms: percentile(
      outcomes.map((item) => item.firstTokenMs),
      0.95,
    ),
    totalP50Ms: percentile(
      outcomes.map((item) => item.totalMs),
      0.5,
    ),
    totalP95Ms: percentile(
      outcomes.map((item) => item.totalMs),
      0.95,
    ),
    retryRate: runs ? outcomes.filter((item) => item.retries > 0).length / runs : 0,
    evidenceEligible: runs > 0 && outcomes.every((item) => item.evidenceEligible),
    errors,
  }
}

export function saveEvaluationRun(run: AiM0EvaluationRun, storage: Storage = localStorage) {
  storage.setItem(AI_M0_RUN_STORAGE_KEY, JSON.stringify(run))
}

export function loadEvaluationRun(storage: Storage = localStorage): AiM0EvaluationRun | null {
  const raw = storage.getItem(AI_M0_RUN_STORAGE_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as AiM0EvaluationRun
    if (
      value.schemaVersion !== 1 ||
      !Array.isArray(value.steps) ||
      !Array.isArray(value.outcomes)
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}

export function clearEvaluationRun(storage: Storage = localStorage) {
  storage.removeItem(AI_M0_RUN_STORAGE_KEY)
}
