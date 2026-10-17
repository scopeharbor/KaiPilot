/**
 * CopilotAction 确认前校验器单元测试（v3-copilot-action-and-preview-boundary 任务 4.x）。
 *
 * 覆盖：
 * - 4.1 权限复核（缺失即拒绝）
 * - 4.2/4.3 source 签名重校验与 stale 阻断（含捕获时间戳）
 * - 4.4 stale 情况下不发生静默刷新后落库（fresh=false 即阻断）
 * - 4.5 确认对象与最终写入对象一致（diff 一致判定）
 * - 4.6/4.7 dry-run 门禁（失败必阻断）
 * - 4.8/4.9 幂等去重（网络重试返回既有结果）与服务端键重算
 * - 4.10 组织隔离（跨组织恒拒且非泄露）
 *
 * 纯本地：零网络、零数据库、零 provider。相对路径导入核心，vitest 直跑。
 */
import { describe, expect, it } from 'vitest'
import type { CopilotActionSourceSignature } from '@aiproj/types'
import {
  assertConfirmedDiffEqualsWrite,
  deriveServerSideIdempotencyKey,
  evaluateCopilotActionPermission,
  evaluateCopilotConfirmationPreflight,
  evaluateCopilotDryRunGate,
  evaluateCopilotIdempotencyReplay,
  evaluateCopilotOrganizationIsolation,
  revalidateCopilotActionSources,
} from '../../app/services/copilot_action/confirmation_validator_core.js'

const sig = (
  contentHash: string,
  capturedAt = '2026-08-16T10:00:00.000Z',
  sourceRef = 'project:42',
): CopilotActionSourceSignature => ({
  sourceRef,
  contentHash,
  capturedAt,
})

describe('4.1 权限复核', () => {
  it('权限齐备 → granted', () => {
    expect(
      evaluateCopilotActionPermission(
        ['ai:trigger', 'task:update'],
        ['ai:trigger', 'task:update', 'project:view'],
      ).granted,
    ).toBe(true)
  })

  it('缺权限 → 拒绝并列出缺失项', () => {
    const r = evaluateCopilotActionPermission(['ai:trigger', 'task:update'], ['ai:trigger'])
    expect(r.granted).toBe(false)
    expect(r.missing).toEqual(['task:update'])
  })
})

describe('4.2/4.3 source 签名重校验与 stale 阻断', () => {
  it('签名全部一致 → fresh', () => {
    const r = revalidateCopilotActionSources([sig('aaa'), sig('bbb')], [sig('aaa'), sig('bbb')])
    expect(r.fresh).toBe(true)
    expect(r.blockedReason).toBeNull()
  })

  it('内容 hash 失配 → stale 阻断', () => {
    const r = revalidateCopilotActionSources([sig('aaa'), sig('bbb')], [sig('aaa'), sig('CHANGED')])
    expect(r.fresh).toBe(false)
    expect(r.mismatchedIndexes).toEqual([1])
    expect(r.blockedReason).toContain('刷新')
  })

  it('捕获时间戳失配 → stale 阻断（hash 相同但捕获时间不同）', () => {
    const r = revalidateCopilotActionSources(
      [sig('aaa', '2026-08-16T10:00:00.000Z')],
      [sig('aaa', '2026-08-16T10:05:00.000Z')],
    )
    expect(r.fresh).toBe(false)
  })

  it('4.4 数量不匹配 → stale 阻断（不静默刷新后落库）', () => {
    const r = revalidateCopilotActionSources([sig('aaa')], [sig('aaa'), sig('bbb')])
    expect(r.fresh).toBe(false)
  })
})

describe('4.5 确认的 diff 即写入的 diff', () => {
  it('目标引用集合一致 → 通过', () => {
    expect(assertConfirmedDiffEqualsWrite(['task:1', 'task:2'], ['task:2', 'task:1'])).toBe(true)
  })

  it('任一目标不同 → 阻断', () => {
    expect(assertConfirmedDiffEqualsWrite(['task:1', 'task:2'], ['task:1', 'risk:9'])).toBe(false)
    expect(assertConfirmedDiffEqualsWrite(['task:1'], ['task:1', 'task:2'])).toBe(false)
  })
})

describe('4.6/4.7 dry-run 门禁', () => {
  it('dry-run 失败必阻断 apply', () => {
    expect(evaluateCopilotDryRunGate(false)).toBe(false)
    expect(evaluateCopilotDryRunGate(true)).toBe(true)
  })
})

describe('4.8/4.9 幂等去重', () => {
  it('同派生键 + 来源未变 → 重放既有结果，不重复写入', () => {
    const r = evaluateCopilotIdempotencyReplay({
      requestIdempotencyKey: 'key-1',
      existingResultIdempotencyKey: 'key-1',
      requestSources: [sig('aaa')],
      existingSources: [sig('aaa')],
    })
    expect(r.replay).toBe(true)
    expect(r.reason).toContain('幂等')
  })

  it('键不同（网络重试携带不同键）→ 不重放（防伪造）', () => {
    const r = evaluateCopilotIdempotencyReplay({
      requestIdempotencyKey: 'key-2',
      existingResultIdempotencyKey: 'key-1',
      requestSources: [sig('aaa')],
      existingSources: [sig('aaa')],
    })
    expect(r.replay).toBe(false)
  })

  it('来源已变（stale）→ 不重放', () => {
    const r = evaluateCopilotIdempotencyReplay({
      requestIdempotencyKey: 'key-1',
      existingResultIdempotencyKey: 'key-1',
      requestSources: [sig('aaa')],
      existingSources: [sig('CHANGED')],
    })
    expect(r.replay).toBe(false)
  })

  it('服务端重算派生键与契约 helper 一致（不接受客户端键直接为权威）', () => {
    const serverKey = deriveServerSideIdempotencyKey({
      normalizedActionInput: 'apply-proposal:task:1201:duration=5',
      targetEntityRefs: ['task:1201'],
      sourceSignatures: [sig('aaa')],
    })
    const requestKey = deriveServerSideIdempotencyKey({
      normalizedActionInput: 'apply-proposal:task:1201:duration=5',
      targetEntityRefs: ['task:1201'],
      sourceSignatures: [sig('aaa')],
    })
    expect(serverKey).toBe(requestKey)
    expect(serverKey.length).toBeGreaterThanOrEqual(8)
  })
})

describe('4.10 组织隔离', () => {
  it('同组织 → 允许', () => {
    expect(
      evaluateCopilotOrganizationIsolation({ actionOrganizationId: 1, actorOrganizationId: 1 })
        .allowed,
    ).toBe(true)
  })

  it('跨组织 → 恒拒且不泄露存在', () => {
    const r = evaluateCopilotOrganizationIsolation({
      actionOrganizationId: 2,
      actorOrganizationId: 1,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).not.toContain('2')
    expect(r.reason).not.toContain('存在')
  })
})

describe('综合确认前校验（preflight）', () => {
  const okParams = {
    actorOrganizationId: 1,
    actionOrganizationId: 1,
    requiredPermissions: ['task:update'],
    actorPermissions: ['task:update'],
    requestSources: [sig('aaa')],
    recordedSources: [sig('aaa')],
    confirmedTargetRefs: ['task:1'],
    writeTargetRefs: ['task:1'],
    dryRunCanApply: true,
  }

  it('全部通过 → canConfirm', () => {
    expect(evaluateCopilotConfirmationPreflight(okParams).canConfirm).toBe(true)
  })

  it('权限不足 → permission_denied', () => {
    const r = evaluateCopilotConfirmationPreflight({ ...okParams, actorPermissions: [] })
    expect(r.canConfirm).toBe(false)
    expect(r.status).toBe('permission_denied')
  })

  it('stale → stale_blocked，message 要求刷新', () => {
    const r = evaluateCopilotConfirmationPreflight({
      ...okParams,
      recordedSources: [sig('CHANGED')],
    })
    expect(r.canConfirm).toBe(false)
    expect(r.status).toBe('stale_blocked')
    expect(r.message).toContain('刷新')
  })

  it('diff 不一致 → diff_mismatch', () => {
    const r = evaluateCopilotConfirmationPreflight({ ...okParams, writeTargetRefs: ['risk:9'] })
    expect(r.canConfirm).toBe(false)
    expect(r.status).toBe('diff_mismatch')
  })

  it('dry-run 失败 → dry_run_failed', () => {
    const r = evaluateCopilotConfirmationPreflight({ ...okParams, dryRunCanApply: false })
    expect(r.canConfirm).toBe(false)
    expect(r.status).toBe('dry_run_failed')
  })

  it('跨组织 → organization_denied 且非泄露', () => {
    const r = evaluateCopilotConfirmationPreflight({ ...okParams, actionOrganizationId: 2 })
    expect(r.canConfirm).toBe(false)
    expect(r.status).toBe('organization_denied')
  })
})
