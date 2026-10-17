/**
 * CopilotAction 决策翻译单元测试（v3-copilot-action-and-preview-boundary 任务 5.x）。
 *
 * 覆盖：
 * - 5.1/5.2/5.3 单条决策映射五态；修改后应用记为 modified（userModifiedValue/userNote），
 *   「按原样接受」与「改后接受」为两种不同状态
 * - 5.5/5.6 批量逐条结局；混合批次（含 stale/越权）逐条报告，不整批静默通过
 * - 5.7/5.8 部分失败不得呈现为完全成功
 * - 5.9 有界重试（幂等与 hash 重校验约束）
 *
 * 纯本地：零网络、零数据库、零 provider。相对路径导入核心，vitest 直跑。
 */
import { describe, expect, it } from 'vitest'
import {
  assembleCopilotBulkResult,
  evaluateCopilotBoundedRetry,
  evaluateCopilotBulkItemOutcome,
  evaluateCopilotPartialApply,
  mapCopilotDecisionToReviewStatus,
} from '../../app/services/copilot_action/decision_translation_core.js'

describe('5.1 单条决策映射五态', () => {
  it('accept/reject/modify/skip 映射到草案层四态', () => {
    expect(mapCopilotDecisionToReviewStatus('accept')).toBe('accepted')
    expect(mapCopilotDecisionToReviewStatus('reject')).toBe('rejected')
    expect(mapCopilotDecisionToReviewStatus('modify')).toBe('modified')
    expect(mapCopilotDecisionToReviewStatus('skip')).toBe('skipped')
  })
})

describe('5.2/5.3 修改后应用 ≠ 按原样接受', () => {
  it('决策种类区分修改与接受：modified 独立于 accepted', () => {
    // 状态映射层面两种决策产出两个不同值（决策服务据此记录 userModifiedValue）
    expect(mapCopilotDecisionToReviewStatus('modify')).not.toBe(
      mapCopilotDecisionToReviewStatus('accept'),
    )
    const accepted = evaluateCopilotBulkItemOutcome({
      actionCardId: 'c1',
      decision: 'accept',
      permissionGranted: true,
      stale: false,
      dryRunCanApply: true,
    })
    const modified = evaluateCopilotBulkItemOutcome({
      actionCardId: 'c2',
      decision: 'modify',
      permissionGranted: true,
      stale: false,
      dryRunCanApply: true,
    })
    expect(accepted.outcome).toBe('applied')
    expect(modified.outcome).toBe('modified')
    expect(modified.outcome).not.toBe('applied')
  })
})

describe('5.5/5.6 批量逐条结局判定', () => {
  it('全通过 → 逐条 applied，fullyApplied=true', () => {
    const items = [
      evaluateCopilotBulkItemOutcome({
        actionCardId: 'c1',
        decision: 'accept',
        permissionGranted: true,
        stale: false,
        dryRunCanApply: true,
      }),
      evaluateCopilotBulkItemOutcome({
        actionCardId: 'c2',
        decision: 'accept',
        permissionGranted: true,
        stale: false,
        dryRunCanApply: true,
      }),
    ]
    const result = assembleCopilotBulkResult(items)
    expect(result.fullyApplied).toBe(true)
    expect(result.results.every((r) => r.outcome === 'applied')).toBe(true)
  })

  it('混合批次（stale + 越权）逐条报告结局，不整批静默通过', () => {
    const items = [
      evaluateCopilotBulkItemOutcome({
        actionCardId: 'c1',
        decision: 'accept',
        permissionGranted: true,
        stale: false,
        dryRunCanApply: true,
      }),
      evaluateCopilotBulkItemOutcome({
        actionCardId: 'c2',
        decision: 'accept',
        permissionGranted: true,
        stale: true,
        dryRunCanApply: true,
      }),
      evaluateCopilotBulkItemOutcome({
        actionCardId: 'c3',
        decision: 'accept',
        permissionGranted: false,
        stale: false,
        dryRunCanApply: true,
      }),
    ]
    const result = assembleCopilotBulkResult(items)
    expect(result.fullyApplied).toBe(false)
    expect(result.results[1].outcome).toBe('stale_blocked')
    expect(result.results[1].stale).toBe('stale')
    expect(result.results[2].outcome).toBe('denied')
    expect(result.results[2].permission).toBe('denied')
    // 合法项仍然逐条应用，但整体不呈现为完全成功
    expect(result.results[0].outcome).toBe('applied')
  })

  it('dry-run 失败的项单独报告 dry_run_failed，不影响其余项结局', () => {
    const item = evaluateCopilotBulkItemOutcome({
      actionCardId: 'c4',
      decision: 'accept',
      permissionGranted: true,
      stale: false,
      dryRunCanApply: false,
    })
    expect(item.outcome).toBe('dry_run_failed')
  })
})

describe('5.7/5.8 部分失败不得呈现为完全成功', () => {
  it('部分失败 → partialFailure=true 且 fullyApplied=false', () => {
    const r = evaluateCopilotPartialApply({ appliedCount: 2, failedCount: 1 })
    expect(r.partialFailure).toBe(true)
    expect(r.fullyApplied).toBe(false)
  })

  it('完全失败 → 非成功', () => {
    const r = evaluateCopilotPartialApply({ appliedCount: 0, failedCount: 3 })
    expect(r.fullyApplied).toBe(false)
    expect(r.partialFailure).toBe(false)
  })

  it('全部成功 → fullyApplied=true', () => {
    const r = evaluateCopilotPartialApply({ appliedCount: 3, failedCount: 0 })
    expect(r.fullyApplied).toBe(true)
  })
})

describe('5.9 有界重试语义', () => {
  it('尝试次数 ≤ 上限且来源 fresh → 允许重试', () => {
    expect(
      evaluateCopilotBoundedRetry({ attempt: 1, maxAttempts: 3, sourceFresh: true }).allowed,
    ).toBe(true)
    expect(
      evaluateCopilotBoundedRetry({ attempt: 3, maxAttempts: 3, sourceFresh: true }).allowed,
    ).toBe(true)
  })

  it('超过上限 → 拒绝', () => {
    const r = evaluateCopilotBoundedRetry({ attempt: 4, maxAttempts: 3, sourceFresh: true })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('上限')
  })

  it('来源 stale → 拒绝（重试仍受 hash 重校验约束）', () => {
    const r = evaluateCopilotBoundedRetry({ attempt: 1, maxAttempts: 3, sourceFresh: false })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('重新审查')
  })
})
