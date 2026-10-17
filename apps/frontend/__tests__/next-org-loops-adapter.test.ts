/**
 * v3-ui-next-org-portfolio-domains W6 · tasks 6.1 —— 容量闭环适配器纯函数单测。
 *
 * 覆盖（spec「资源容量闭环咨询工作台（列表与详情）」+ tasks 6.1）：
 * - 八态状态机徽标文本全量映射与未知状态中性回退（旧页 STATE_LABELS 语义）；
 * - 状态徽标语义色类名只引用 next-tokens.css 既有令牌（防臆造令牌回潮）；
 * - 终态判定、粒度标签（日/周/月）、窗口人读标签与「下一步」提示六分支；
 * - parse/serializeRcclUrlFilters 纯透传封装往返一致；
 * - envelope 归一化：列表裸数组与 {data,meta} 双形状、详情裸 detail 与
 *   {data} 信封、空/脏载荷中性回落。
 * - 零网络、零 DOM 的高速纯函数执行。
 */
import { describe, expect, it } from 'vitest'
import type { RcclLoopDetail } from '@/lib/api/resource-capacity-loops'
import {
  RCCL_STATE_META,
  RCCL_STATE_OPTIONS,
  granularityLabelOf,
  isLoopTerminalState,
  loopNextActionHint,
  loopStateMeta,
  loopWindowLabel,
  parseLoopsUrlFilters,
  resolveRcclDetailPayload,
  resolveRcclListPayload,
  serializeLoopsUrlFilters,
} from '@/lib/next/org-loops/org-loops-adapter'

const LOOP_ROW = {
  id: 7,
  title: 'Q4 容量闭环',
  ownerUserId: 1,
  state: 'simulated',
  revision: 3,
  granularity: 'week',
  windowStart: '2026-09-01',
  windowEnd: '2026-11-30',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
}

function makeDetail(overrides: Partial<RcclLoopDetail> = {}): RcclLoopDetail {
  return {
    loop: {
      id: 7,
      title: 'Q4 容量闭环',
      state: 'simulated',
      revision: 3,
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
    },
    baseline: { id: 77, digest: 'fnv1a:abc123', readyForSimulation: true },
    scenarios: [{ id: 1, name: '情景一', revision: 2, active: true }],
    simulations: [{ id: 5, scenarioId: 1, digest: 'fnv1a:sim', staleState: 'current' }],
    currentSelection: null,
    receipts: [],
    observations: [],
    reviews: [],
    actionPosture: { writesApplied: false, confirmationRequired: true },
    ...overrides,
  }
}

describe('容量环状态徽标映射（tasks 6.1，旧页 STATE_LABELS 语义）', () => {
  it('八态全量中文标签与旧页语义一致', () => {
    expect(RCCL_STATE_META.draft.label).toBe('草稿')
    expect(RCCL_STATE_META.simulated.label).toBe('已模拟')
    expect(RCCL_STATE_META.selected.label).toBe('已选择')
    expect(RCCL_STATE_META['handed-off'].label).toBe('已移交')
    expect(RCCL_STATE_META.observing.label).toBe('观察中')
    expect(RCCL_STATE_META.reviewed.label).toBe('已复核')
    expect(RCCL_STATE_META.closed.label).toBe('已关闭')
    expect(RCCL_STATE_META.cancelled.label).toBe('已取消')
  })

  it('RCCL_STATE_OPTIONS 覆盖全部八态且按生命周期顺序排列', () => {
    expect(RCCL_STATE_OPTIONS.map((meta) => meta.state)).toEqual([
      'draft',
      'simulated',
      'selected',
      'handed-off',
      'observing',
      'reviewed',
      'closed',
      'cancelled',
    ])
  })

  it('语义色类名只消费 --nx-* 令牌（双通道：颜色 + 文字标签）', () => {
    // 每个非中性态 chip 都引用 var(--nx-*) 令牌色文本类与固定 rgba 展开；
    // 中性态引用 --nx-border-hairline/--nx-bg-1/--nx-text-secondary。
    expect(RCCL_STATE_META.simulated.chipClass).toContain('text-[var(--nx-space-cyan)]')
    expect(RCCL_STATE_META.selected.chipClass).toContain('text-[var(--nx-chart-2)]')
    expect(RCCL_STATE_META['handed-off'].chipClass).toContain('text-[var(--nx-status-warning)]')
    expect(RCCL_STATE_META.observing.chipClass).toContain('text-[var(--nx-chart-6)]')
    expect(RCCL_STATE_META.reviewed.chipClass).toContain('text-[var(--nx-status-success)]')
    expect(RCCL_STATE_META.cancelled.chipClass).toContain('text-[var(--nx-status-danger)]')
    for (const tone of [
      'simulated',
      'selected',
      'handed-off',
      'observing',
      'reviewed',
      'cancelled',
    ] as const) {
      expect(RCCL_STATE_META[tone].chipClass).toMatch(/border-\[rgba\(/)
      expect(RCCL_STATE_META[tone].chipClass).toMatch(/bg-\[rgba\(/)
      // 严禁出现任何非令牌十六进制色值
      expect(RCCL_STATE_META[tone].chipClass).not.toMatch(/(?<!rgba)\(#|#(?:[0-9a-fA-F]{3}){1,2}\b/)
    }
    expect(RCCL_STATE_META.draft.chipClass).toContain('var(--nx-border-hairline)')
    expect(RCCL_STATE_META.closed.chipClass).toContain('var(--nx-text-secondary)')
  })

  it('未知状态走中性回退且不中断（脏数据可渲染）', () => {
    const meta = loopStateMeta('simulating-unknown')
    expect(meta.label).toBe('simulating-unknown')
    expect(meta.chipClass).toContain('var(--nx-border-hairline)')
    expect(loopStateMeta(undefined).label).toBe('未知')
  })

  it('终态判定：closed/cancelled 无出边', () => {
    expect(isLoopTerminalState('closed')).toBe(true)
    expect(isLoopTerminalState('cancelled')).toBe(true)
    expect(isLoopTerminalState('reviewed')).toBe(false)
    expect(isLoopTerminalState(undefined)).toBe(false)
  })
})

describe('粒度 / 窗口 / 下一步提示（tasks 6.1）', () => {
  it('粒度标签：周/月/日 + 未知回退', () => {
    expect(granularityLabelOf('week')).toBe('周')
    expect(granularityLabelOf('month')).toBe('月')
    expect(granularityLabelOf('day')).toBe('日')
    expect(granularityLabelOf('year')).toBe('year')
    expect(granularityLabelOf(null)).toBe('—')
  })

  it('窗口人读标签原样拼接后端规范日期', () => {
    expect(loopWindowLabel('2026-09-01', '2026-11-30')).toBe('2026-09-01 ~ 2026-11-30')
  })

  it('下一步提示六分支 + 终态/未知回退', () => {
    expect(loopNextActionHint('draft')).toContain('刷新基线并创建情景')
    expect(loopNextActionHint('simulated')).toContain('人工选择情景')
    expect(loopNextActionHint('selected')).toContain('创建受控 handoff')
    expect(loopNextActionHint('handed-off')).toContain('等待下游确认后捕获观察')
    expect(loopNextActionHint('observing')).toContain('人工复核结论')
    expect(loopNextActionHint('reviewed')).toContain('关闭闭环')
    expect(loopNextActionHint('closed')).toBe('闭环已关闭')
    expect(loopNextActionHint('cancelled')).toBe('闭环已取消')
    expect(loopNextActionHint('mystery')).toBe('')
  })
})

describe('URL filters 纯透传封装（tasks 6.1）', () => {
  it('序列化→解析往返一致（与既有 parse/serializeRcclUrlFilters 同契约）', () => {
    const qs = serializeLoopsUrlFilters({ state: 'simulated', page: 2 })
    expect(qs).toBe('?state=simulated&page=2')
    expect(parseLoopsUrlFilters({ state: 'simulated', page: '2' })).toEqual({
      state: 'simulated',
      page: 2,
    })
  })

  it('空筛选不产生 query；page=1 不落 URL；page<=1 解析回落 undefined', () => {
    expect(serializeLoopsUrlFilters({ state: undefined, page: 1 })).toBe('')
    expect(serializeLoopsUrlFilters(undefined)).toBe('')
    expect(parseLoopsUrlFilters({})).toEqual({})
    expect(parseLoopsUrlFilters({ page: '1' })).toEqual({})
  })

  it('多值参数取首值；非法 page 忽略', () => {
    expect(parseLoopsUrlFilters({ state: ['draft', 'closed'], page: 'x' })).toEqual({
      state: 'draft',
    })
  })
})

describe('envelope 归一化（apiFetch 解包歧义收敛）', () => {
  it('列表：裸数组（live 解包）直接消费', () => {
    const { rows, meta } = resolveRcclListPayload([LOOP_ROW])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(7)
    expect(meta).toBeNull()
  })

  it('列表：{data,meta} 信封（既有 hook 单测契约）取 rows 与 meta', () => {
    const { rows, meta } = resolveRcclListPayload({
      data: [LOOP_ROW],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    expect(rows).toHaveLength(1)
    expect(meta?.totalPages).toBe(1)
  })

  it('列表：空/脏载荷中性回落 rows=[]', () => {
    expect(resolveRcclListPayload(undefined).rows).toEqual([])
    expect(resolveRcclListPayload(null).rows).toEqual([])
    expect(resolveRcclListPayload({ foo: 1 }).rows).toEqual([])
    expect(resolveRcclListPayload({ data: 'x' }).rows).toEqual([])
  })

  it('详情：裸 detail（live 解包）与 {data} 信封均可解析', () => {
    const detail = makeDetail()
    expect(resolveRcclDetailPayload(detail)?.loop.id).toBe(7)
    expect(resolveRcclDetailPayload({ data: detail })?.loop.state).toBe('simulated')
  })

  it('详情：空/脏载荷返回 null（详情页据此渲染中性未找到态）', () => {
    expect(resolveRcclDetailPayload(null)).toBeNull()
    expect(resolveRcclDetailPayload(undefined)).toBeNull()
    expect(resolveRcclDetailPayload({ loop: 'not-an-object' })).toBeNull()
    expect(resolveRcclDetailPayload({ data: { loop: { id: '7' } } })).toBeNull()
  })
})
