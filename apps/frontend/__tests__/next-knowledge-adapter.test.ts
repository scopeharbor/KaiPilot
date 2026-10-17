/**
 * v3-ui-next-help-knowledge-domain W2 · tasks 2.2 —— 知识库适配器纯函数单测。
 *
 * 覆盖（spec「四层知识库底册表格浏览与多维过滤」+ tasks 2.2）：
 * - L1-L4 四层色彩语义映射的确定性输出（令牌与色值冻结断言，防臆造令牌回潮）；
 * - SYNTHETIC 合成标识判定（L3 层/条目自带标记/普通条目三分支）；
 * - 生命周期状态（draft/pending/active/deprecated/outdated）微标文本与类名映射；
 * - 推进目标白名单与 pending → active 专属「确认转正」门；
 * - `filterKnowledgeItems` 多维组合过滤：空值/重置/单维/多维/大小写边界；
 * - 零网络、零 DOM 的高速纯函数执行（全文件无任何 DOM API 调用）。
 */
import { describe, expect, it } from 'vitest'
import type {
  KnowledgeItemLowSensitiveProjection,
  KnowledgeLayer,
  KnowledgeLifecycleStatus,
} from '@aiproj/types'
import {
  KNOWLEDGE_LAYER_META,
  KNOWLEDGE_LAYER_OPTIONS,
  KNOWLEDGE_STATUS_META,
  KNOWLEDGE_STATUS_OPTIONS,
  KNOWLEDGE_TRANSITION_TARGETS,
  SYNTHETIC_BADGE_CLASS,
  SYNTHETIC_BADGE_TEXT,
  canConfirmPromotion,
  filterKnowledgeItems,
  formatKnowledgeDate,
  hasActiveKnowledgeFilters,
  layerMetaOf,
  nextKnowledgeStatuses,
  requiresSyntheticBadge,
  sortKnowledgeItemsByUpdatedAt,
  statusMetaOf,
} from '@/lib/next/knowledge/knowledge-adapter'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let nextId = 1
function makeItem(overrides: Partial<KnowledgeItemLowSensitiveProjection> = {}) {
  const now = '2026-09-01T00:00:00.000Z'
  return {
    id: nextId++,
    layer: 'L1' as KnowledgeLayer,
    title: 'API 错误处理规范',
    status: 'active' as KnowledgeLifecycleStatus,
    domain: '接口架构',
    purpose: '参考',
    complexity: '初级',
    provenance: {
      sources: [{ layer: 'L1' as KnowledgeLayer, sourceId: 'src-1', title: '团队工程规范 V2' }],
    },
    isSynthetic: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies KnowledgeItemLowSensitiveProjection
}

function seed() {
  return [
    makeItem({
      id: 1,
      layer: 'L1',
      title: 'API 错误处理规范',
      domain: '接口架构',
      status: 'active',
      complexity: '初级',
      provenance: { sources: [{ layer: 'L1', sourceId: 's1', title: '团队工程规范 V2' }] },
    }),
    makeItem({
      id: 2,
      layer: 'L2',
      title: '双机房割接观察记录',
      domain: '运维',
      status: 'pending',
      complexity: '中级',
      provenance: { sources: [{ layer: 'L2', sourceId: 's2', title: '2026-08 割接复盘' }] },
    }),
    makeItem({
      id: 3,
      layer: 'L3',
      title: '合成压测案例：千任务甘特重排',
      domain: '性能评测',
      status: 'active',
      complexity: '高级',
      isSynthetic: true,
      provenance: {
        sources: [
          {
            layer: 'L3',
            sourceId: 'syn-1',
            title: '合成案例集',
            isSynthetic: true,
            syntheticMethod: 'LLM 生成 + 参数网格',
          },
        ],
      },
    }),
    makeItem({
      id: 4,
      layer: 'L4',
      title: 'Q3 真实排程耗时分布',
      domain: '产品数据',
      status: 'deprecated',
      complexity: '高级',
      provenance: { sources: [{ layer: 'L4', sourceId: 's4', title: '产品遥测聚合' }] },
    }),
    makeItem({
      id: 5,
      layer: 'L2',
      title: '风险例会迟到观察',
      domain: '协作观察',
      status: 'draft',
      provenance: { sources: [{ layer: 'L2', sourceId: 's5', title: '例会记录' }] },
    }),
  ] as KnowledgeItemLowSensitiveProjection[]
}

// ---------------------------------------------------------------------------

describe('L1-L4 层级色彩与文本映射（tasks 2.2 / spec 层级语义色）', () => {
  it('四层完整且文本映射确定', () => {
    expect(KNOWLEDGE_LAYER_OPTIONS).toHaveLength(4)
    expect(KNOWLEDGE_LAYER_META.L1.fullName).toBe('L1 规范')
    expect(KNOWLEDGE_LAYER_META.L1.shortName).toBe('规范')
    expect(KNOWLEDGE_LAYER_META.L2.fullName).toBe('L2 观察')
    expect(KNOWLEDGE_LAYER_META.L3.fullName).toBe('L3 合成')
    expect(KNOWLEDGE_LAYER_META.L4.fullName).toBe('L4 现实')
    expect(KNOWLEDGE_LAYER_META.L4.shortName).toBe('现实')
  })

  it('色彩类名冻结：令牌变量与实码色值一致（防 --nx-accent-gold / --nx-accent-purple 臆造令牌回潮）', () => {
    // L1 规范：战术冷蓝 --nx-workspace-blue #4f75ff
    expect(KNOWLEDGE_LAYER_META.L1.chipClass).toContain('text-[var(--nx-workspace-blue)]')
    expect(KNOWLEDGE_LAYER_META.L1.chipClass).toContain('rgba(79,117,255')
    // L2 观察：翠绿 --nx-status-success #10b981
    expect(KNOWLEDGE_LAYER_META.L2.chipClass).toContain('text-[var(--nx-status-success)]')
    expect(KNOWLEDGE_LAYER_META.L2.chipClass).toContain('rgba(16,185,129')
    // L3 合成：紫罗兰 --nx-chart-7 #c084fc
    expect(KNOWLEDGE_LAYER_META.L3.chipClass).toContain('text-[var(--nx-chart-7)]')
    expect(KNOWLEDGE_LAYER_META.L3.chipClass).toContain('rgba(192,132,252')
    // L4 现实：琥珀金 --nx-chart-4 #fbbf24
    expect(KNOWLEDGE_LAYER_META.L4.chipClass).toContain('text-[var(--nx-chart-4)]')
    expect(KNOWLEDGE_LAYER_META.L4.chipClass).toContain('rgba(251,191,36')

    const allChips = Object.values(KNOWLEDGE_LAYER_META)
      .map((m) => m.chipClass)
      .join(' ')
    // 臆造令牌禁止出现在任何层级映射中
    expect(allChips).not.toContain('--nx-accent-gold')
    expect(allChips).not.toContain('--nx-accent-purple')
  })

  it('SYNTHETIC 徽标类名确定且为紫罗兰语义', () => {
    expect(SYNTHETIC_BADGE_TEXT).toBe('SYNTHETIC')
    expect(SYNTHETIC_BADGE_CLASS).toContain('text-[var(--nx-chart-7)]')
    expect(SYNTHETIC_BADGE_CLASS).toContain('rgba(192,132,252')
  })

  it('未知层级回退为空（健壮渲染依据）', () => {
    expect(layerMetaOf('L9')).toBeNull()
    expect(layerMetaOf(undefined)).toBeNull()
    expect(layerMetaOf('L2')?.fullName).toBe('L2 观察')
  })

  it('SYNTHETIC 判定：L3 层或条目自带合成标记即命中，普通 L1/L4 不误报', () => {
    expect(requiresSyntheticBadge({ layer: 'L3', isSynthetic: false })).toBe(true)
    expect(requiresSyntheticBadge({ layer: 'L3', isSynthetic: true })).toBe(true)
    expect(requiresSyntheticBadge({ layer: 'L1', isSynthetic: true })).toBe(true)
    expect(requiresSyntheticBadge({ layer: 'L1', isSynthetic: false })).toBe(false)
    expect(requiresSyntheticBadge({ layer: 'L4', isSynthetic: false })).toBe(false)
    expect(requiresSyntheticBadge({})).toBe(false)
  })
})

describe('生命周期状态微标映射（tasks 2.2）', () => {
  it('五状态齐全且中文名确定', () => {
    expect(KNOWLEDGE_STATUS_OPTIONS.map((s) => s.status).sort()).toEqual([
      'active',
      'deprecated',
      'draft',
      'outdated',
      'pending',
    ])
    expect(KNOWLEDGE_STATUS_META.active.label).toBe('活跃')
    expect(KNOWLEDGE_STATUS_META.pending.label).toBe('待审')
    expect(KNOWLEDGE_STATUS_META.draft.label).toBe('草稿')
    expect(KNOWLEDGE_STATUS_META.deprecated.label).toBe('已弃用')
    expect(KNOWLEDGE_STATUS_META.outdated.label).toBe('已过时')
  })

  it('状态微标语义色：active 翡翠绿 / pending 琥珀黄 / draft 中性冷灰 / deprecated 琥珀金 / outdated 警示红', () => {
    expect(KNOWLEDGE_STATUS_META.active.chipClass).toContain('text-[var(--nx-status-success)]')
    expect(KNOWLEDGE_STATUS_META.pending.chipClass).toContain('text-[var(--nx-status-warning)]')
    expect(KNOWLEDGE_STATUS_META.draft.chipClass).toContain('text-[var(--nx-text-muted)]')
    expect(KNOWLEDGE_STATUS_META.deprecated.chipClass).toContain('text-[var(--nx-chart-4)]')
    expect(KNOWLEDGE_STATUS_META.outdated.chipClass).toContain('text-[var(--nx-status-danger)]')
    // 无臆造令牌
    const all = Object.values(KNOWLEDGE_STATUS_META)
      .map((m) => m.chipClass)
      .join(' ')
    expect(all).not.toContain('--nx-accent-gold')
    expect(all).not.toContain('--nx-accent-purple')
  })

  it('未知状态回退为空；正常状态可反查', () => {
    expect(statusMetaOf('frozen')).toBeNull()
    expect(statusMetaOf('active')?.label).toBe('活跃')
  })

  it('确认转正门仅 pending 可走；推进目标白名单确定', () => {
    expect(canConfirmPromotion('pending')).toBe(true)
    expect(canConfirmPromotion('active')).toBe(false)
    expect(canConfirmPromotion('draft')).toBe(false)
    expect(canConfirmPromotion('deprecated')).toBe(false)
    expect(canConfirmPromotion('outdated')).toBe(false)

    // pending → active 必须走 confirm 门，绝不出现在通用推进目标里
    expect(KNOWLEDGE_TRANSITION_TARGETS.pending).not.toContain('active')
    expect(nextKnowledgeStatuses('pending')).toEqual(['draft'])
    expect(nextKnowledgeStatuses('draft')).toEqual(['pending'])
    expect(nextKnowledgeStatuses('active')).toEqual(['deprecated', 'outdated'])
    expect(nextKnowledgeStatuses('deprecated')).toEqual(['active'])
    expect(nextKnowledgeStatuses('outdated')).toEqual(['active', 'deprecated'])
  })
})

describe('filterKnowledgeItems 多维复合过滤（tasks 2.2 / spec 组合筛选场景）', () => {
  const items = seed()

  it('空过滤 / 全重置（{}）返回全量且不改引用顺序语义', () => {
    expect(filterKnowledgeItems(items, {})).toHaveLength(5)
    expect(filterKnowledgeItems(items, { keyword: '  ' })).toHaveLength(5)
    expect(filterKnowledgeItems(items, { layers: [], statuses: [], domain: '' })).toHaveLength(5)
  })

  it('关键词模糊：标题命中（大小写不敏感，命中英文与中文）', () => {
    expect(filterKnowledgeItems(items, { keyword: 'API' }).map((i) => i.id)).toEqual([1])
    expect(filterKnowledgeItems(items, { keyword: 'api' }).map((i) => i.id)).toEqual([1])
    expect(filterKnowledgeItems(items, { keyword: '割接' }).map((i) => i.id)).toEqual([2])
  })

  it('关键词检索覆盖领域/用途/来源标题（低敏投影无 content 字段的等价检索面）', () => {
    // 领域命中
    expect(filterKnowledgeItems(items, { keyword: '接口架构' }).map((i) => i.id)).toEqual([1])
    // 来源标题命中
    expect(filterKnowledgeItems(items, { keyword: '复盘' }).map((i) => i.id)).toEqual([2])
  })

  it('无命中返回空数组；无分页/无抛错', () => {
    expect(filterKnowledgeItems(items, { keyword: 'xyz-unmatched-term' })).toEqual([])
  })

  it('层级多选收敛（单选 / 双选 / 越界空）', () => {
    expect(filterKnowledgeItems(items, { layers: ['L1'] }).map((i) => i.id)).toEqual([1])
    expect(filterKnowledgeItems(items, { layers: ['L2'] }).map((i) => i.id)).toEqual([2, 5])
    expect(
      filterKnowledgeItems(items, { layers: ['L1', 'L4'] })
        .map((i) => i.id)
        .sort(),
    ).toEqual([1, 4])
    expect(filterKnowledgeItems(items, { layers: ['L3'] }).map((i) => i.id)).toEqual([3])
  })

  it('状态多选收敛（单选 / 双选）', () => {
    expect(
      filterKnowledgeItems(items, { statuses: ['active'] })
        .map((i) => i.id)
        .sort(),
    ).toEqual([1, 3])
    expect(
      filterKnowledgeItems(items, { statuses: ['pending', 'draft'] })
        .map((i) => i.id)
        .sort(),
    ).toEqual([2, 5])
  })

  it('领域精确收敛（trim + 大小写不敏感，非子串模糊）', () => {
    expect(filterKnowledgeItems(items, { domain: '接口架构' }).map((i) => i.id)).toEqual([1])
    // 子串「架构」不会模糊命中「接口架构」——精确收敛语义
    expect(filterKnowledgeItems(items, { domain: '架构' })).toEqual([])
    expect(filterKnowledgeItems(items, { domain: ' 接口架构 ' }).map((i) => i.id)).toEqual([1])
  })

  it('多维组合收敛：层级 + 状态 + 领域同时收敛', () => {
    // 与 spec 场景「组合筛选特定层级与状态」对齐：L1 × active 只余 1 条
    expect(
      filterKnowledgeItems(items, { layers: ['L1'], statuses: ['active'] }).map((i) => i.id),
    ).toEqual([1])
    // L2 × pending × keyword 收敛
    expect(
      filterKnowledgeItems(items, { layers: ['L2'], statuses: ['pending'], keyword: '割接' }).map(
        (i) => i.id,
      ),
    ).toEqual([2])
    // L4 × deprecated × domain
    expect(
      filterKnowledgeItems(items, {
        layers: ['L4'],
        statuses: ['deprecated'],
        domain: '产品数据',
      }).map((i) => i.id),
    ).toEqual([4])
    // 矛盾组合收敛为空
    expect(filterKnowledgeItems(items, { layers: ['L1'], statuses: ['draft'] })).toEqual([])
  })

  it('重置判定：任意维度激活即 true', () => {
    expect(hasActiveKnowledgeFilters({})).toBe(false)
    expect(hasActiveKnowledgeFilters({ layers: [] })).toBe(false)
    expect(hasActiveKnowledgeFilters({ keyword: 'x' })).toBe(true)
    expect(hasActiveKnowledgeFilters({ statuses: ['active'] })).toBe(true)
    expect(hasActiveKnowledgeFilters({ domain: '产品数据' })).toBe(true)
  })
})

describe('排序与日期工具（纯函数附加面）', () => {
  it('updatedAt 降序（最近更新在前），非法时间兜底', () => {
    const items = [
      makeItem({ id: 11, updatedAt: '2026-09-01T00:00:00.000Z' }),
      makeItem({ id: 12, updatedAt: '2026-09-10T00:00:00.000Z' }),
      makeItem({ id: 13, updatedAt: 'bad-date' }),
    ]
    const sorted = sortKnowledgeItemsByUpdatedAt(items)
    expect(sorted.map((i) => i.id)).toEqual([12, 11, 13])
  })

  it('formatKnowledgeDate 输出 UTC 日历日且对空/非法输入兜底', () => {
    expect(formatKnowledgeDate('2026-09-10T00:00:00.000Z')).toBe('2026-09-10')
    expect(formatKnowledgeDate('2026-09-10T23:59:59.000Z')).toBe('2026-09-10')
    expect(formatKnowledgeDate(null)).toBe('—')
    expect(formatKnowledgeDate(undefined)).toBe('—')
    expect(formatKnowledgeDate('garbage')).toBe('garbage')
  })
})
