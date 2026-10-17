import { beforeEach, describe, expect, it } from 'vitest'
import type { AiM0EvaluationOutcome, AiM0EvaluationStep } from '@aiproj/types'
import {
  AI_M0_RUN_STORAGE_KEY,
  completeStep,
  createEvaluationRun,
  loadEvaluationRun,
  markStepRunning,
  recoverEvaluationRun,
  saveEvaluationRun,
  summarizeEvaluationRun,
} from '@/lib/ai-m0/evaluation-run'
import { exportOutcomesCsv, exportRawJson, exportSummaryJson } from '@/lib/ai-m0/evaluation-export'
import {
  AI_M0_STREAM_STORAGE_KEY,
  loadStreamCheckpoint,
  saveStreamCheckpoint,
  streamRequestFingerprint,
} from '@/lib/ai-m0/stream-checkpoint'

const steps: AiM0EvaluationStep[] = [
  {
    id: 'prompt:sw-01:01',
    inputId: 'sw-01',
    requestedStrategy: 'prompt',
    repetition: 1,
    status: 'pending',
    attempts: 0,
  },
  {
    id: 'native:sw-01:01',
    inputId: 'sw-01',
    requestedStrategy: 'native',
    repetition: 1,
    status: 'pending',
    attempts: 0,
  },
]
const firstStep = steps[0]!

function outcome(overrides: Partial<AiM0EvaluationOutcome> = {}): AiM0EvaluationOutcome {
  return {
    stepId: 'prompt:sw-01:01',
    inputId: 'sw-01',
    inputSetHash: 'abc',
    repetition: 1,
    strategy: 'prompt',
    requestedStrategy: 'prompt',
    effectiveStrategy: 'prompt',
    mode: 'dry_run',
    bucket: 'strict',
    firstTokenMs: 10,
    totalMs: 20,
    retries: 0,
    triggeredErrors: [],
    markerCoverage: 1,
    outputTokens: null,
    provider: 'mock',
    model: 'mock,"line"\nnext',
    connectionId: null,
    usingRealAdapter: false,
    evidenceEligible: false,
    missingMarkerFields: [],
    appliedFixes: [],
    measuredAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  }
}

describe('AI M0 evaluation run', () => {
  beforeEach(() => localStorage.clear())

  it('逐步检查点持久化，刷新恢复时把 running 归回 pending', () => {
    let run = createEvaluationRun({
      id: 'run-1',
      mode: 'dry_run',
      connectionId: null,
      inputSetHash: 'abc',
      repetitions: 1,
      steps,
      now: '2026-07-06T00:00:00.000Z',
    })
    run = markStepRunning(run, firstStep.id, '2026-07-06T00:00:01.000Z')
    saveEvaluationRun(run)
    const loaded = loadEvaluationRun()
    expect(loaded?.steps[0]?.status).toBe('running')
    const recovered = recoverEvaluationRun(loaded!, '2026-07-06T00:00:02.000Z')
    expect(recovered.status).toBe('paused')
    expect(recovered.steps[0]?.status).toBe('pending')
    expect(localStorage.getItem(AI_M0_RUN_STORAGE_KEY)).not.toContain('apiKey')
  })

  it('汇总三档、Marker 与证据资格，演练永远不可作为证据', () => {
    let run = createEvaluationRun({
      id: 'run-1',
      mode: 'dry_run',
      connectionId: null,
      inputSetHash: 'abc',
      repetitions: 1,
      steps: [firstStep],
      now: '2026-07-06T00:00:00.000Z',
    })
    run = completeStep(run, outcome(), '2026-07-06T00:00:03.000Z')
    const summary = summarizeEvaluationRun(run)
    expect(summary.complete).toBe(true)
    expect(summary.evidenceEligible).toBe(false)
    expect(summary.perStrategy.prompt.strict).toBe(1)
    expect(summary.perStrategy.prompt.landableRate).toBe(1)
    expect(summary.perStrategy.prompt.markerCoverage).toBe(1)
  })

  it('JSON/CSV 导出包含资格字段、正确转义且不含凭据', () => {
    const run = {
      ...createEvaluationRun({
        id: 'run-1',
        mode: 'dry_run' as const,
        connectionId: null,
        inputSetHash: 'abc',
        repetitions: 1,
        steps: [firstStep],
        now: '2026-07-06T00:00:00.000Z',
      }),
      outcomes: [outcome()],
    }
    expect(exportRawJson(run)).toContain('"evidenceEligible": false')
    expect(exportSummaryJson(run)).toContain('"inputSetHash": "abc"')
    const csv = exportOutcomesCsv(run)
    expect(csv).toContain('"mock,""line""\nnext"')
    expect(`${exportRawJson(run)}${csv}`).not.toMatch(/apiKey|Authorization|Bearer /)
  })
})

describe('AI M0 stream checkpoint', () => {
  beforeEach(() => localStorage.clear())

  it('请求指纹稳定且连接变化会改变指纹', () => {
    const base = { sentence: '测试项目', strategy: 'prompt' as const, temperature: 0 }
    expect(streamRequestFingerprint(base)).toBe(streamRequestFingerprint(base))
    expect(streamRequestFingerprint(base)).not.toBe(
      streamRequestFingerprint({ ...base, connectionId: 2 }),
    )
  })

  it('保存同 streamId 的 Last-Event-ID 与已到达文本', () => {
    saveStreamCheckpoint({
      schemaVersion: 1,
      streamId: 'stream-1',
      requestFingerprint: 'abc',
      lastEventId: '7',
      rawText: '{"partial":',
      updatedAt: '2026-07-06T00:00:00.000Z',
      finished: false,
    })
    expect(loadStreamCheckpoint()).toMatchObject({
      streamId: 'stream-1',
      lastEventId: '7',
      rawText: '{"partial":',
    })
    expect(localStorage.getItem(AI_M0_STREAM_STORAGE_KEY)).not.toContain('apiKey')
  })
})

describe('AI M0 evidence eligibility in export', () => {
  beforeEach(() => localStorage.clear())

  it('CSV 导出列包含 evidenceEligible', () => {
    const run = {
      ...createEvaluationRun({
        id: 'run-ev',
        mode: 'dry_run',
        connectionId: null,
        inputSetHash: 'abc',
        repetitions: 1,
        steps: [steps[0]!],
        now: '2026-07-08T00:00:00.000Z',
      }),
      outcomes: [outcome({ mode: 'dry_run', evidenceEligible: false, usingRealAdapter: false })],
    }
    const csv = exportOutcomesCsv(run)
    expect(csv).toContain('evidenceEligible')
    expect(csv).toContain('"false"')
  })

  it('汇总：dry_run 模式下 evidenceEligible=false', () => {
    let run = createEvaluationRun({
      id: 'run-ev2',
      mode: 'dry_run',
      connectionId: null,
      inputSetHash: 'abc',
      repetitions: 1,
      steps: [steps[0]!],
      now: '2026-07-08T00:00:00.000Z',
    })
    run = completeStep(
      run,
      outcome({ mode: 'dry_run', evidenceEligible: false }),
      '2026-07-08T00:00:01.000Z',
    )
    const summary = summarizeEvaluationRun(run)
    expect(summary.evidenceEligible).toBe(false)
    expect(summary.perStrategy.prompt.evidenceEligible).toBe(false)
  })

  it('汇总：real 模式全部证据合格时 evidenceEligible=true', () => {
    let run = createEvaluationRun({
      id: 'run-ev3',
      mode: 'real',
      connectionId: '1',
      inputSetHash: 'abc',
      repetitions: 1,
      steps: [steps[0]!],
      now: '2026-07-08T00:00:00.000Z',
    })
    run = completeStep(
      run,
      outcome({
        mode: 'real',
        evidenceEligible: true,
        usingRealAdapter: true,
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
      '2026-07-08T00:00:01.000Z',
    )
    const summary = summarizeEvaluationRun(run)
    expect(summary.evidenceEligible).toBe(true)
    expect(summary.perStrategy.prompt.evidenceEligible).toBe(true)
  })
})
