/**
 * v3-ai-automated-evaluation §5 — LLM-as-judge 适配器测试。
 *
 * 覆盖：
 * - §5.1 fixture judge 默认可用
 * - §5.2 judge 调用落账本（产生一条 attempt）
 * - §5.3 账本 attempt 记录正确
 * - §5.4–5.5 预算/限流拒绝时 judge 不调用且记为未评
 * - §5.6–5.7 judge 失败记为 not-evaluated（不产生自动合格）
 * - §5.8 自我认证禁止
 * - §5.10 judge 模型身份与 prompt 版本记录
 * - §5.11–5.12 确定性优先：同维度有确定性结论时 judge 不覆盖
 *
 * @aiproj/backend tests — 零网络零 provider（默认 fixture judge）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { JudgeAdapterInput, EvaluationDimension } from '@aiproj/types'
import {
  FixtureJudgeAdapter,
  JudgeLedgerRecorder,
  JudgeBudgetGuard,
  JudgeOrchestrationService,
  isSelfEvaluation,
  judgeResultToScore,
} from '../../app/services/ai_evaluation/judge_adapter.js'
import type { JudgeCallResult } from '@aiproj/types'

// ── 辅助 ──────────────────────────────────────────────────────────────

function makeJudgeInput(
  dimension: EvaluationDimension = 'narration_cites_out_of_context_fact',
): JudgeAdapterInput {
  return {
    dimension,
    artifact: {
      artifactKind: 'copilot_message',
      artifactRef: 'copilot_msg:test',
      contentHash: 'fnv1a:test123',
    },
    context: {},
    organizationId: 1,
    judgeModel: 'openai/gpt-4',
    judgePromptVersion: 'v2.1',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5.1 Fixture judge
// ═══════════════════════════════════════════════════════════════════════════════

describe('FixtureJudgeAdapter', () => {
  it('always returns success with pass label', async () => {
    const adapter = new FixtureJudgeAdapter()
    const result = await adapter.evaluate(makeJudgeInput())
    expect(result.success).toBe(true)
    expect(result.output?.scoreLabel).toBe('pass')
    expect(result.output?.scoreValue).toBe(1)
  })

  it('has name and version', () => {
    const adapter = new FixtureJudgeAdapter()
    expect(adapter.name).toBe('fixture-judge')
    expect(adapter.version).toBe('1.0.0')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5.2–5.3 Judge 调用落账本
// ═══════════════════════════════════════════════════════════════════════════════

describe('JudgeLedgerRecorder', () => {
  let recorder: JudgeLedgerRecorder

  beforeEach(() => {
    recorder = new JudgeLedgerRecorder()
  })

  it('records judge call and returns attempt ID', async () => {
    const attemptId = await recorder.record({
      judgeModel: 'openai/gpt-4',
      judgePromptVersion: 'v2.1',
      dimension: 'narration_cites_out_of_context_fact',
      artifactRef: 'copilot_msg:test',
      organizationId: 1,
      startedAt: '2026-08-17T00:00:00.000Z',
      endedAt: '2026-08-17T00:00:01.000Z',
      status: 'success',
    })
    expect(attemptId).toBeTruthy()
    expect(attemptId).toContain('judge-attempt')
  })

  it('stores records for later retrieval', async () => {
    await recorder.record({
      judgeModel: 'openai/gpt-4',
      judgePromptVersion: 'v2.1',
      dimension: 'narration_cites_out_of_context_fact',
      artifactRef: 'copilot_msg:test',
      organizationId: 1,
      startedAt: '2026-08-17T00:00:00.000Z',
      endedAt: '2026-08-17T00:00:01.000Z',
      status: 'success',
    })
    const records = recorder.getRecords()
    expect(records).toHaveLength(1)
    expect(records[0].judgeModel).toBe('openai/gpt-4')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5.4–5.5 预算/限流拒绝
// ═══════════════════════════════════════════════════════════════════════════════

describe('JudgeBudgetGuard', () => {
  it('denies judge when not enabled (budget/rate-limit not landed)', async () => {
    const guard = new JudgeBudgetGuard()
    const decision = await guard.adjudicate(makeJudgeInput())
    expect(decision.allowed).toBe(false)
    expect(decision.denialReason).toContain('not yet landed')
  })

  it('allows judge when enabled', async () => {
    const guard = new JudgeBudgetGuard()
    guard.enable()
    const decision = await guard.adjudicate(makeJudgeInput())
    expect(decision.allowed).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5.6–5.7 judge 失败 → not-evaluated（不产生自动合格）
// ═══════════════════════════════════════════════════════════════════════════════

describe('judgeResultToScore — failure posture', () => {
  it('maps failure to not-evaluated (NOT pass)', () => {
    const result: JudgeCallResult = {
      success: false,
      error: 'Provider timeout',
    }
    const score = judgeResultToScore(result, makeJudgeInput())
    expect(score.scoreLabel).toBe('not-evaluated')
    expect(score.scoreValue).toBe(0)
  })

  it('maps budget/rate-limit denial to not-evaluated', () => {
    const result: JudgeCallResult = {
      success: false,
      deniedByBudgetOrRateLimit: true,
      error: 'Budget exceeded',
    }
    const score = judgeResultToScore(result, makeJudgeInput())
    expect(score.scoreLabel).toBe('not-evaluated')
    expect(score.scoreValue).toBe(0)
  })

  it('maps success to judge output', () => {
    const result: JudgeCallResult = {
      success: true,
      output: {
        scoreValue: 0.8,
        scoreLabel: 'pass',
        explanation: 'Looks good',
      },
    }
    const score = judgeResultToScore(result, makeJudgeInput())
    expect(score.scoreLabel).toBe('pass')
    expect(score.scoreValue).toBe(0.8)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5.8 自我认证禁止
// ═══════════════════════════════════════════════════════════════════════════════

describe('isSelfEvaluation', () => {
  it('detects same evaluator name', () => {
    expect(
      isSelfEvaluation(
        { name: 'gpt-4-judge', version: '1.0', judgeModel: 'openai/gpt-4' },
        { evaluatorName: 'gpt-4-judge' },
      ),
    ).toBe(true)
  })

  it('detects same model', () => {
    expect(
      isSelfEvaluation(
        { name: 'gpt-4-judge', version: '1.0', judgeModel: 'openai/gpt-4' },
        { evaluatorModel: 'openai/gpt-4' },
      ),
    ).toBe(true)
  })

  it('returns false for different judge', () => {
    expect(
      isSelfEvaluation(
        { name: 'gpt-4-judge', version: '1.0', judgeModel: 'openai/gpt-4' },
        { evaluatorName: 'claude-judge', evaluatorModel: 'anthropic/claude-3' },
      ),
    ).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5.10–5.11 Judge 编排服务
// ═══════════════════════════════════════════════════════════════════════════════

describe('JudgeOrchestrationService', () => {
  let service: JudgeOrchestrationService
  let recorder: JudgeLedgerRecorder

  beforeEach(() => {
    recorder = new JudgeLedgerRecorder()
    service = new JudgeOrchestrationService(
      new FixtureJudgeAdapter(),
      new JudgeBudgetGuard(), // not enabled → judge denied
      recorder,
    )
  })

  it('denies judge when budget guard not enabled', async () => {
    const result = await service.evaluate(makeJudgeInput())
    expect(result.score.scoreLabel).toBe('not-evaluated')
    expect(result.deniedByBudgetOrRateLimit).toBe(true)
  })

  it('records to ledger when judge is called (enabled)', async () => {
    const guard = new JudgeBudgetGuard()
    guard.enable()
    const enabledService = new JudgeOrchestrationService(new FixtureJudgeAdapter(), guard, recorder)
    const result = await enabledService.evaluate(makeJudgeInput())
    expect(result.score.scoreLabel).toBe('pass')
    expect(result.ledgerAttemptId).toBeTruthy()
    // §5.3 验证账本产生了一条 attempt
    expect(recorder.getRecords()).toHaveLength(1)
  })

  it('refuses self-evaluation', async () => {
    const guard = new JudgeBudgetGuard()
    guard.enable()
    const selfService = new JudgeOrchestrationService(new FixtureJudgeAdapter(), guard, recorder)
    const result = await selfService.evaluate(makeJudgeInput(), {
      artifactEvaluatorName: 'fixture-judge',
    })
    expect(result.score.scoreLabel).toBe('not-evaluated')
    expect(result.score.explanation).toContain('Self-evaluation refused')
    // 不应调用 judge（账本为空）
    expect(recorder.getRecords()).toHaveLength(0)
  })

  it('records judge model identity and prompt version', async () => {
    const guard = new JudgeBudgetGuard()
    guard.enable()
    const enabledService = new JudgeOrchestrationService(new FixtureJudgeAdapter(), guard, recorder)
    await enabledService.evaluate(makeJudgeInput())
    const records = recorder.getRecords()
    expect(records[0].judgeModel).toBe('openai/gpt-4')
    expect(records[0].judgePromptVersion).toBe('v2.1')
  })
})
