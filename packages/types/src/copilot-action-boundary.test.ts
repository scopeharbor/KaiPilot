/**
 * copilot-action-boundary —— 共享契约聚焦测试（v3-copilot-action-and-preview-boundary 任务 2.x）。
 *
 * 覆盖：
 * - 2.6/2.7：source 签名契约校验——缺捕获时间戳的签名被拒绝；fresh/stale 判定
 * - 2.8/2.9：幂等键派生——两个语义不同的动作永不共享键；同输入同键
 * - 2.2：五类动作枚举 + 主操作上限 3
 * - 2.3：按钮状态机 idle→loading→success/failure，禁止无反馈态（idle→success 直跳非法）
 * - 2.4/2.5：假设插槽消费共享契约类型；「依赖替代默认值但插槽未接入」阻断确认
 * - 2.10：批量逐条结果——部分失败不得呈现为完全成功
 * - 2.11：禁止措辞清单（按声明清单校验）
 *
 * 纯本地：零网络、零数据库、零 provider。
 */
import { describe, expect, it } from 'vitest'
import {
  COPILOT_ACTION_BUTTON_STATES,
  COPILOT_ACTION_CARD_MAX_PRIMARY,
  COPILOT_ACTION_DECISION_KINDS,
  COPILOT_ACTION_FORBIDDEN_WORDING,
  COPILOT_ACTION_KINDS,
  assertCopilotDryRunGate,
  canCopilotActionButtonTransition,
  copilotActionCardConfirmBlockReason,
  copilotActionKindLabel,
  copilotActionSourceSignaturePrefix,
  deriveCopilotActionIdempotencyKey,
  findCopilotActionForbiddenWording,
  isCopilotActionButtonState,
  isCopilotActionCardConfirmable,
  isCopilotActionDecisionKind,
  isCopilotActionKind,
  isCopilotActionSourceSignatureFresh,
  isCopilotActionWordingClean,
  isCopilotBulkResultFullyApplied,
  validateCopilotActionSourceSignatures,
  type CopilotActionSourceSignature,
} from './copilot-action-boundary.js'
import {
  COPILOT_ACTION_FIXTURE_BULK_RESULT_MIXED,
  COPILOT_ACTION_FIXTURE_BULK_RESULT_OK,
  COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE,
  COPILOT_ACTION_FIXTURE_CARD_STALE,
  COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT,
  COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES,
  COPILOT_ACTION_FIXTURE_STALE_SIGNATURES,
  copilotActionFixtureConfirmationRequest,
} from './copilot-action-boundary-fixtures.js'

describe('2.2 五类动作枚举与主操作上限', () => {
  it('动作枚举恰好五类且含全部规定动作', () => {
    expect(COPILOT_ACTION_KINDS).toHaveLength(5)
    expect(COPILOT_ACTION_KINDS).toEqual(
      expect.arrayContaining([
        'apply_proposal',
        'adjust',
        'discard',
        'view_details',
        'add_as_task',
      ]),
    )
  })

  it('主操作上限为三', () => {
    expect(COPILOT_ACTION_CARD_MAX_PRIMARY).toBe(3)
  })

  it('每类动作都有审查导向中文标签', () => {
    for (const kind of COPILOT_ACTION_KINDS) {
      expect(copilotActionKindLabel(kind).length).toBeGreaterThan(0)
    }
    expect(copilotActionKindLabel('apply_proposal')).toBe('应用此方案')
  })

  it('守卫拒绝未知动作', () => {
    expect(isCopilotActionKind('apply_proposal')).toBe(true)
    expect(isCopilotActionKind('auto_apply')).toBe(false)
  })
})

describe('2.3 动作按钮状态机（禁止无反馈态）', () => {
  it('状态集合为 idle/loading/success/failure', () => {
    expect(COPILOT_ACTION_BUTTON_STATES).toEqual(['idle', 'loading', 'success', 'failure'])
  })

  it('idle 只能进入 loading，禁止 idle→success 直跳（无反馈态被禁）', () => {
    expect(canCopilotActionButtonTransition('idle', 'loading')).toBe(true)
    expect(canCopilotActionButtonTransition('idle', 'success')).toBe(false)
    expect(canCopilotActionButtonTransition('idle', 'failure')).toBe(false)
  })

  it('loading → success / failure 合法；failure 可重试回 loading', () => {
    expect(canCopilotActionButtonTransition('loading', 'success')).toBe(true)
    expect(canCopilotActionButtonTransition('loading', 'failure')).toBe(true)
    expect(canCopilotActionButtonTransition('failure', 'loading')).toBe(true)
  })

  it('守卫拒绝未知状态', () => {
    expect(isCopilotActionButtonState('loading')).toBe(true)
    expect(isCopilotActionButtonState('pending')).toBe(false)
  })
})

describe('2.6/2.7 source 签名：缺捕获时间戳被契约拒绝', () => {
  it('缺 capturedAt 的签名校验失败', () => {
    const bad = [
      { sourceRef: 'project:42', contentHash: 'aaaabbbbccccdddd' },
    ] as unknown as CopilotActionSourceSignature[]
    const result = validateCopilotActionSourceSignatures(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.join('|')).toContain('捕获时间戳')
  })

  it('缺内容 hash 的签名校验失败', () => {
    const bad = [
      { sourceRef: 'project:42', capturedAt: '2026-08-16T10:00:00.000Z' },
    ] as unknown as CopilotActionSourceSignature[]
    const result = validateCopilotActionSourceSignatures(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.join('|')).toContain('内容 hash')
  })

  it('合法签名（hash + 时间戳齐备）校验通过', () => {
    const result = validateCopilotActionSourceSignatures(COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fresh 判定要求 hash 与 capturedAt 均一致', () => {
    expect(
      isCopilotActionSourceSignatureFresh(
        COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES[0],
        COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES[0],
      ),
    ).toBe(true)
    expect(
      isCopilotActionSourceSignatureFresh(
        COPILOT_ACTION_FIXTURE_STALE_SIGNATURES[0],
        COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES[0],
      ),
    ).toBe(false)
  })

  it('审计用 hash 前缀只取前 8 位', () => {
    expect(copilotActionSourceSignaturePrefix(COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES[0])).toBe(
      'aaaabbbb',
    )
  })
})

describe('2.8/2.9 幂等键派生', () => {
  const base = {
    normalizedActionInput: 'apply-proposal:task:1201:duration=5',
    targetEntityRefs: ['task:1201'],
    sourceSignatures: COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES,
  }

  it('同一输入派生同一键', () => {
    expect(deriveCopilotActionIdempotencyKey(base)).toBe(deriveCopilotActionIdempotencyKey(base))
  })

  it('两个语义不同的动作永不共享幂等键', () => {
    const different = [
      { ...base, normalizedActionInput: 'apply-proposal:task:1201:duration=10' },
      { ...base, targetEntityRefs: ['task:9876'] },
      { ...base, sourceSignatures: COPILOT_ACTION_FIXTURE_STALE_SIGNATURES },
    ]
    const key = deriveCopilotActionIdempotencyKey(base)
    for (const variant of different) {
      expect(deriveCopilotActionIdempotencyKey(variant)).not.toBe(key)
    }
    // 两两互不相同
    for (let i = 0; i < different.length; i++) {
      for (let j = i + 1; j < different.length; j++) {
        expect(deriveCopilotActionIdempotencyKey(different[i])).not.toBe(
          deriveCopilotActionIdempotencyKey(different[j]),
        )
      }
    }
  })

  it('目标实体引用顺序不影响键（稳定排序）', () => {
    const a = deriveCopilotActionIdempotencyKey({
      ...base,
      targetEntityRefs: ['task:1', 'task:2'],
    })
    const b = deriveCopilotActionIdempotencyKey({
      ...base,
      targetEntityRefs: ['task:2', 'task:1'],
    })
    expect(a).toBe(b)
  })
})

describe('2.4/2.5 假设插槽与「未见默认值不得确认」', () => {
  it('插槽消费共享契约的假设条目类型（supplied + assumptions）', () => {
    const slot = COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE.assumptionSlot
    expect(slot.supplied).toBe(true)
    expect(slot.assumptions.length).toBeGreaterThan(0)
    expect(slot.assumptions[0]).toHaveProperty('assumptionId')
    expect(slot.assumptions[0]).toHaveProperty('statement')
    expect(slot.assumptions[0]).toHaveProperty('confidence')
  })

  it('依赖替代默认值但插槽未接入 → 不可确认，且有可读中文原因', () => {
    expect(isCopilotActionCardConfirmable(COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT)).toBe(false)
    const reason = copilotActionCardConfirmBlockReason(COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT)
    expect(reason).not.toBeNull()
    expect(reason).toContain('假设')
  })

  it('插槽已接入且非 stale → 可确认', () => {
    expect(isCopilotActionCardConfirmable(COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE)).toBe(true)
  })

  it('stale 动作恒不可确认', () => {
    expect(isCopilotActionCardConfirmable(COPILOT_ACTION_FIXTURE_CARD_STALE)).toBe(false)
    expect(copilotActionCardConfirmBlockReason(COPILOT_ACTION_FIXTURE_CARD_STALE)).toContain('过期')
  })
})

describe('决策请求与结果', () => {
  it('决策种类含 accept/reject/modify/skip', () => {
    expect(COPILOT_ACTION_DECISION_KINDS).toEqual(['accept', 'reject', 'modify', 'skip'])
    expect(isCopilotActionDecisionKind('modify')).toBe(true)
    expect(isCopilotActionDecisionKind('auto')).toBe(false)
  })

  it('确认请求的幂等键由派生 helper 生成（非客户端自定义）', () => {
    const req = copilotActionFixtureConfirmationRequest()
    expect(req.idempotencyKey).toBe(
      deriveCopilotActionIdempotencyKey({
        normalizedActionInput: 'apply-proposal:task:1201:duration=5',
        targetEntityRefs: ['task:1201'],
        sourceSignatures: COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES,
      }),
    )
  })
})

describe('2.10 批量逐条结果：部分失败不得呈现为完全成功', () => {
  it('全 applied → fullyApplied=true', () => {
    expect(isCopilotBulkResultFullyApplied(COPILOT_ACTION_FIXTURE_BULK_RESULT_OK)).toBe(true)
    expect(COPILOT_ACTION_FIXTURE_BULK_RESULT_OK.fullyApplied).toBe(true)
  })

  it('含 stale/越权项 → fullyApplied=false 且逐条结局独立', () => {
    const mixed = COPILOT_ACTION_FIXTURE_BULK_RESULT_MIXED
    expect(isCopilotBulkResultFullyApplied(mixed)).toBe(false)
    expect(mixed.fullyApplied).toBe(false)
    const stale = mixed.results.find((r) => r.stale === 'stale')
    const denied = mixed.results.find((r) => r.permission === 'denied')
    expect(stale?.outcome).toBe('stale_blocked')
    expect(denied?.outcome).toBe('denied')
    // 不整批静默通过：失败的项必须被逐条呈现
    expect(mixed.results.every((r) => r.outcome === 'applied')).toBe(false)
  })
})

describe('2.11 禁止措辞清单', () => {
  it('干净措辞通过，命中列表按声明清单报告', () => {
    expect(isCopilotActionWordingClean('查看依据、打开审查、生成预览')).toBe(true)
    const hits = findCopilotActionForbiddenWording('点击后自动应用并自动执行该方案')
    expect(hits).toContain('自动应用')
    expect(hits).toContain('自动执行')
  })

  it('声明清单非空且每条都可命中（防全串匹配脆性）', () => {
    expect(COPILOT_ACTION_FORBIDDEN_WORDING.length).toBeGreaterThan(0)
    for (const word of COPILOT_ACTION_FORBIDDEN_WORDING) {
      expect(findCopilotActionForbiddenWording(`前缀${word}后缀`)).toContain(word)
    }
  })
})

describe('dry-run 门禁', () => {
  it('dry-run canApply=false 时 apply 门禁为假（不可 apply）', () => {
    expect(assertCopilotDryRunGate(true)).toBe(true)
    expect(assertCopilotDryRunGate(false)).toBe(false)
  })
})
