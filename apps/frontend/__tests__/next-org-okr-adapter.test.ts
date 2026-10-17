/**
 * v3-ui-next-org-portfolio-domains W2 · tasks 2.2 —— OKR 适配器纯函数单元测试。
 *
 * 覆盖（tasks 2.2）：
 * - 状态徽标映射全覆盖（draft/active/paused/completed/archived 中文标签 + 语义色
 *   chipClass 双通道）；
 * - 进度色阶边界（0 / 24 / 25 / 49 / 50 / 74 / 75 / 99 / 100 / 越界负值 / null /
 *   NaN / 空值回落中性「—」）；
 * - 树扁平化行模型：O→KR 层级缩进、展开态收敛、统计聚合（objective/KR 计数与
 *   平均进度）；
 * - stale 判定与「数据陈旧」中性提示、相对时间格式化（刚刚/N 分钟前/N 小时前/N 天前）；
 * - 仪表盘脱敏语义：受限指标布尔判定 + 中性「不可见」文案 + 数值格式化边界、
 *   KPI 选区固定顺序、警告/关注原因标签映射。
 */
import { describe, expect, test } from 'vitest'
import { makeOkrCycle, makeOkrKeyResult, makeOkrObjective } from '@aiproj/types'
import type {
  OkrDashboardMetric,
  OkrDashboardMetricKey,
  OkrDashboardWarning,
  OkrKeyResult,
  OkrObjective,
  OkrObjectiveTree,
  OkrStatus,
  OkrWarning,
} from '@aiproj/types'
import {
  OKR_DASHBOARD_WARNING_CODES,
  OKR_WARNING_CODES,
  OKR_DASHBOARD_ATTENTION_REASONS,
} from '@aiproj/types'
import {
  OKR_ATTENTION_REASON_LABELS,
  OKR_DASHBOARD_KPI_ORDER,
  OKR_DASHBOARD_METRIC_LABELS,
  OKR_DASHBOARD_WARNING_LABELS,
  OKR_METRIC_REDACTED_TEXT,
  OKR_PROGRESS_BANDS,
  OKR_SCOPE_LABELS,
  OKR_STALE_DATA_NOTICE,
  OKR_STATUS_LABELS,
  OKR_STATUS_META,
  OKR_TREE_WARNING_META,
  flattenOkrTreeRows,
  formatOkrCycleLabel,
  formatOkrCycleWindow,
  formatOkrMetricValue,
  formatOkrProgressText,
  formatOkrRelativeTime,
  hasOkrStaleWarning,
  isOkrMetricRedacted,
  okrAttentionReasonLabel,
  okrCycleListMeta,
  okrCycleListOf,
  okrDashboardWarningChipClass,
  okrKeyResultProgress,
  okrProgressBandOf,
  okrStatusMetaOf,
  okrTreeListOf,
  okrTreeMetaOf,
  selectOkrDashboardKpis,
  summarizeOkrTreeRows,
} from '@/lib/next/org-okr/org-okr-adapter'

// ── 夹具 ───────────────────────────────────────────────────────────────────

const STATUSES: readonly OkrStatus[] = ['draft', 'active', 'paused', 'completed', 'archived']

function objectiveNode(
  id: number,
  overrides: Partial<OkrObjective> = {},
  extras: { children?: OkrObjectiveTree[]; keyResults?: OkrKeyResult[] } = {},
): OkrObjectiveTree {
  return {
    objective: makeOkrObjective({ id, title: `目标 ${id}`, progress: 60, ...overrides }),
    children: extras.children ?? [],
    keyResults: extras.keyResults ?? [],
    alignments: [],
    evidence: [],
  }
}

function keyResultNode(id: number, overrides: Partial<OkrKeyResult> = {}): OkrKeyResult {
  return makeOkrKeyResult({
    id,
    title: `KR ${id}`,
    baselineValue: 0,
    targetValue: 100,
    currentValue: 40,
    ...overrides,
  })
}

function okrWarning(code: OkrWarning['code']): OkrWarning {
  return { code, message: `后端消息：${code}` }
}

// ── 状态 / 范围 / 周期标签 ─────────────────────────────────────────────────

describe('org-okr-adapter：状态徽标映射（tasks 2.2）', () => {
  test('五种状态全量中文标签映射', () => {
    expect(OKR_STATUS_LABELS).toEqual({
      draft: '草稿',
      active: '进行中',
      paused: '已暂停',
      completed: '已完成',
      archived: '已归档',
    })
  })

  test('五种状态徽标 chipClass 均含 text 令牌色与边框/底色 rgba（双通道）', () => {
    for (const status of STATUSES) {
      const meta = OKR_STATUS_META[status]
      expect(meta.status).toBe(status)
      expect(meta.label).toBe(OKR_STATUS_LABELS[status])
      expect(meta.chipClass).toMatch(/text-\[var\(--nx-[a-z-]+\)\]/)
      expect(meta.chipClass).toMatch(/border-\[rgba\(/)
      expect(meta.chipClass).toMatch(/bg-\[rgba\(/)
    }
    // 语义抽查：active=成功绿、paused=警示琥珀、completed=工作蓝
    expect(OKR_STATUS_META.active.chipClass).toContain('--nx-status-success')
    expect(OKR_STATUS_META.paused.chipClass).toContain('--nx-status-warning')
    expect(OKR_STATUS_META.completed.chipClass).toContain('--nx-workspace-blue')
  })

  test('未知状态回退 null，scope 全量标签', () => {
    expect(okrStatusMetaOf('exploded')).toBeNull()
    expect(okrStatusMetaOf(undefined)).toBeNull()
    expect(okrStatusMetaOf('active')?.label).toBe('进行中')
    expect(OKR_SCOPE_LABELS).toEqual({
      organization: '组织',
      team: '团队',
      project: '项目',
      individual: '个人',
    })
  })

  test('周期标签：标题带状态短标签、起止窗口格式化', () => {
    const cycle = makeOkrCycle({
      title: '2026 Q3',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })
    expect(formatOkrCycleLabel(cycle)).toBe('2026 Q3（进行中）')
    expect(formatOkrCycleWindow(cycle)).toBe('2026-07-01 → 2026-09-30')
  })
})

// ── 进度条带 ───────────────────────────────────────────────────────────────

describe('org-okr-adapter：进度色阶边界（tasks 2.2）', () => {
  test('五桶分段与 0/100 边界', () => {
    expect(OKR_PROGRESS_BANDS.map((b) => b.label)).toEqual([
      '<25%',
      '25-49%',
      '50-74%',
      '75-99%',
      '100%',
    ])
    expect(okrProgressBandOf(0)?.key).toBe('lt25')
    expect(okrProgressBandOf(24)?.key).toBe('lt25')
    expect(okrProgressBandOf(25)?.key).toBe('lt50')
    expect(okrProgressBandOf(49)?.key).toBe('lt50')
    expect(okrProgressBandOf(50)?.key).toBe('lt75')
    expect(okrProgressBandOf(74)?.key).toBe('lt75')
    expect(okrProgressBandOf(75)?.key).toBe('lt100')
    expect(okrProgressBandOf(99)?.key).toBe('lt100')
    expect(okrProgressBandOf(100)?.key).toBe('done')
  })

  test('空值 / NaN / 越界值确定性回落', () => {
    expect(okrProgressBandOf(null)).toBeNull()
    expect(okrProgressBandOf(undefined)).toBeNull()
    expect(okrProgressBandOf(Number.NaN)).toBeNull()
    expect(okrProgressBandOf(-1)?.key).toBe('lt25')
    expect(okrProgressBandOf(120)?.key).toBe('done')
    expect(formatOkrProgressText(null)).toBe('—')
    expect(formatOkrProgressText(Number.NaN)).toBe('—')
    expect(formatOkrProgressText(40.4)).toBe('40%')
  })

  test('进度条带为颜色 + 文字双通道：fillClass 与 label 并存', () => {
    for (const band of OKR_PROGRESS_BANDS) {
      expect(band.fillClass).toMatch(/bg-\[var\(--nx-[a-z0-9-]+\)\]/)
      expect(band.label.length).toBeGreaterThan(0)
    }
  })

  test('KR 进度折算：正常 / 越过 100 / 负值截断 / 目标=基线恒 0', () => {
    expect(
      okrKeyResultProgress(
        keyResultNode(1, { baselineValue: 0, targetValue: 100, currentValue: 40 }),
      ),
    ).toBe(40)
    expect(
      okrKeyResultProgress(
        keyResultNode(2, { baselineValue: 10, targetValue: 20, currentValue: 30 }),
      ),
    ).toBe(100)
    expect(
      okrKeyResultProgress(
        keyResultNode(3, { baselineValue: 10, targetValue: 20, currentValue: 5 }),
      ),
    ).toBe(0)
    expect(
      okrKeyResultProgress(
        keyResultNode(4, { baselineValue: 50, targetValue: 50, currentValue: 99 }),
      ),
    ).toBe(0)
  })
})

// ── 树行模型 ───────────────────────────────────────────────────────────────

describe('org-okr-adapter：树行模型层级与统计（tasks 2.2）', () => {
  const forest: OkrObjectiveTree[] = [
    objectiveNode(
      1,
      { progress: 100 },
      {
        keyResults: [keyResultNode(11, { currentValue: 100 })],
        children: [
          objectiveNode(
            2,
            { progress: 50 },
            {
              keyResults: [keyResultNode(21), keyResultNode(22)],
              children: [objectiveNode(3, { progress: 0 }, { keyResults: [keyResultNode(31)] })],
            },
          ),
        ],
      },
    ),
    objectiveNode(4, { progress: 30 }),
  ]

  test('全部展开：O→KR 行序、深度缩进与行键', () => {
    const rows = flattenOkrTreeRows(forest, new Set([1, 2, 3]))
    expect(rows.map((r) => r.key)).toEqual([
      'o:1',
      'kr:11',
      'o:2',
      'kr:21',
      'kr:22',
      'o:3',
      'kr:31',
      'o:4',
    ])
    const o1 = rows[0]!
    const kr11 = rows[1]!
    const o2 = rows[2]!
    const o3 = rows[5]!
    expect(o1.depth).toBe(0)
    expect(o1.kind).toBe('objective')
    expect(o1.childObjectiveCount).toBe(1)
    expect(o1.keyResultCount).toBe(1)
    expect(o1.expandable).toBe(true)
    expect(kr11.kind).toBe('key_result')
    expect(kr11.depth).toBe(1)
    expect(kr11.keyResult?.id).toBe(11)
    expect(kr11.expandable).toBe(false)
    expect(o2.depth).toBe(1)
    expect(o3.depth).toBe(2)
    expect(o2.keyResultCount).toBe(2)
  })

  test('未展开的目标不产出其 KR 行与子目标子树（自身行保留）', () => {
    const rows = flattenOkrTreeRows(forest, new Set([1]))
    // o:1 展开 → 直属 KR 行 + 子目标 o:2 行；o:2 未展开 → 其 KR/孙代不产出；根 o:4 恒可见
    expect(rows.map((r) => r.key)).toEqual(['o:1', 'kr:11', 'o:2', 'o:4'])
    expect(rows.some((r) => r.key === 'kr:21')).toBe(false)
    expect(rows.some((r) => r.key === 'o:3')).toBe(false)
  })

  test('无 KR 的叶子目标不可展开', () => {
    const rows = flattenOkrTreeRows([objectiveNode(9)], new Set([9]))
    expect(rows[0]!.expandable).toBe(false)
  })

  test('统计聚合：objective/KR 计数与平均进度', () => {
    const rows = flattenOkrTreeRows(forest, new Set([1, 2, 3]))
    const stats = summarizeOkrTreeRows(rows)
    expect(stats.objectiveCount).toBe(4)
    expect(stats.keyResultCount).toBe(4)
    // (100 + 50 + 0 + 30) / 4 = 45
    expect(stats.averageProgress).toBe(45)
  })

  test('空树统计回落：0 计数与 null 平均进度', () => {
    expect(summarizeOkrTreeRows([])).toEqual({
      objectiveCount: 0,
      keyResultCount: 0,
      averageProgress: null,
    })
  })

  test('数据层归一化：数组形态（apiFetch 展开）与信封形态均收敛到元素列表/meta', () => {
    const trees = forest
    // 数组形态：data 即列表、meta 缺省（当前 lib/api/okr.ts 经 apiFetch 展开后的实态）
    expect(okrTreeListOf(trees)).toHaveLength(2)
    expect(okrTreeMetaOf(trees)).toBeUndefined()
    expect(okrTreeListOf(undefined)).toEqual([])
    expect(okrCycleListMeta([])).toBeUndefined()
    // 信封形态：声明契约 OkrTreeResponse
    const envelope = {
      data: trees,
      meta: { totalNodes: 8, maxDepth: 2, truncated: false, warnings: [] },
    }
    expect(okrTreeListOf(envelope)).toHaveLength(2)
    expect(okrTreeMetaOf(envelope)?.totalNodes).toBe(8)
    const cyclesEnvelope = {
      data: [makeOkrCycle({ id: 7, title: '2026 Q3' })],
      meta: { total: 1, page: 1, perPage: 25, totalPages: 1 },
    }
    expect(okrCycleListOf(cyclesEnvelope)).toHaveLength(1)
    expect(okrCycleListMeta(cyclesEnvelope)?.total).toBe(1)
    expect(okrCycleListOf(undefined)).toEqual([])
  })
})

// ── stale / 相对时间 ───────────────────────────────────────────────────────

describe('org-okr-adapter：stale 判定与相对时间（tasks 2.2）', () => {
  test('stale 相关警告码命中（证据过期 / 不可用 / 缓存降级）', () => {
    expect(hasOkrStaleWarning([okrWarning(OKR_WARNING_CODES.STALE_EVIDENCE)])).toBe(true)
    expect(hasOkrStaleWarning([okrWarning(OKR_WARNING_CODES.EVIDENCE_UNAVAILABLE)])).toBe(true)
    expect(hasOkrStaleWarning([okrWarning(OKR_WARNING_CODES.CACHE_DEGRADED)])).toBe(true)
    expect(hasOkrStaleWarning([okrWarning(OKR_WARNING_CODES.MAX_DEPTH_EXCEEDED)])).toBe(false)
    expect(hasOkrStaleWarning([])).toBe(false)
    expect(hasOkrStaleWarning(undefined)).toBe(false)
  })

  test('「数据陈旧」中性提示存在且不含具体数值', () => {
    expect(OKR_STALE_DATA_NOTICE).toContain('过期')
    expect(OKR_STALE_DATA_NOTICE).not.toMatch(/\d+/)
  })

  test('树警告码全量映射（含分档 tone 与中性文案源）', () => {
    // 抽查代表性分档
    expect(OKR_TREE_WARNING_META[OKR_WARNING_CODES.STALE_EVIDENCE].tone).toBe('warning')
    expect(OKR_TREE_WARNING_META[OKR_WARNING_CODES.CYCLE_DETECTED].tone).toBe('danger')
    expect(OKR_TREE_WARNING_META[OKR_WARNING_CODES.EMPTY_OKR_RESULT].tone).toBe('neutral')
    const codes = Object.keys(OKR_WARNING_CODES)
    // 全码（16 个）覆盖
    expect(Object.keys(OKR_TREE_WARNING_META).length).toBeGreaterThanOrEqual(16)
    for (const code of codes) {
      expect(OKR_TREE_WARNING_META[code as keyof typeof OKR_WARNING_CODES]).toBeDefined()
    }
  })

  test('相对时间分档：刚刚 / N 分钟前 / N 小时前 / N 天前 / 未知', () => {
    const now = Date.parse('2026-09-10T00:00:00.000Z')
    expect(formatOkrRelativeTime('2026-09-10T00:00:30.000Z', now)).toBe('刚刚')
    expect(formatOkrRelativeTime('2026-09-09T23:55:00.000Z', now)).toBe('5 分钟前')
    expect(formatOkrRelativeTime('2026-09-09T20:00:00.000Z', now)).toBe('4 小时前')
    expect(formatOkrRelativeTime('2026-09-01T00:00:00.000Z', now)).toBe('9 天前')
    expect(formatOkrRelativeTime(null, now)).toBe('未知')
    expect(formatOkrRelativeTime('not-a-date', now)).toBe('未知')
  })
})

// ── 仪表盘脱敏与标签 ───────────────────────────────────────────────────────

describe('org-okr-adapter：仪表盘受限指标与标签（tasks 2.2 / spec 幽灵守卫修复）', () => {
  function metric(overrides: Partial<OkrDashboardMetric>): OkrDashboardMetric {
    return {
      key: 'okr_total_objectives',
      value: 8,
      unit: 'count',
      source: 'computed',
      status: 'ok',
      ...overrides,
    }
  }

  test('受限判定：null 值 / forbidden / unavailable → true，正常值 false', () => {
    expect(isOkrMetricRedacted(metric({ value: null }))).toBe(true)
    expect(isOkrMetricRedacted(metric({ status: 'forbidden' }))).toBe(true)
    expect(isOkrMetricRedacted(metric({ status: 'unavailable' }))).toBe(true)
    expect(isOkrMetricRedacted(metric({ value: 3, status: 'ok' }))).toBe(false)
    expect(isOkrMetricRedacted(metric({ value: 0, status: 'ok' }))).toBe(false)
  })

  test('受限指标中性占位（不可见），绝不渲染猜测数值', () => {
    const redacted = metric({ value: null, status: 'forbidden' })
    expect(formatOkrMetricValue(redacted)).toBe(OKR_METRIC_REDACTED_TEXT)
    expect(OKR_METRIC_REDACTED_TEXT).toBe('不可见')
    expect(formatOkrMetricValue(redacted)).not.toMatch(/\d/)
  })

  test('数值格式化：count/percent/score/avg 边界', () => {
    expect(formatOkrMetricValue(metric({ unit: 'count', value: 3 }))).toBe('3')
    expect(formatOkrMetricValue(metric({ unit: 'percent', value: 66.7 }))).toBe('67%')
    expect(formatOkrMetricValue(metric({ unit: 'score', value: 7.25 }))).toBe('7.3')
    expect(formatOkrMetricValue(metric({ unit: 'avg', value: 0 }))).toBe('0.0')
  })

  test('KPI 选区：按固定顺序取白名单键且跳过缺失项', () => {
    const summary = {
      kpis: [
        metric({ key: 'okr_active_objectives' as OkrDashboardMetricKey }),
        metric({
          key: 'okr_overall_progress_avg' as OkrDashboardMetricKey,
          unit: 'percent',
          value: 61,
        }),
      ],
    } as unknown as Parameters<typeof selectOkrDashboardKpis>[0]
    const kpis = selectOkrDashboardKpis(summary)
    expect(kpis.map((m) => m.key)).toEqual(['okr_active_objectives', 'okr_overall_progress_avg'])
    expect(selectOkrDashboardKpis(undefined)).toEqual([])
    // 顺序常量：活跃目标 → 风险目标 → 落后 KR → 平均进度
    expect(OKR_DASHBOARD_KPI_ORDER).toHaveLength(4)
    expect(OKR_DASHBOARD_KPI_ORDER[0]).toBe('okr_active_objectives')
    expect(OKR_DASHBOARD_KPI_ORDER[3]).toBe('okr_overall_progress_avg')
  })

  test('全量 KPI 指标中文标签', () => {
    expect(OKR_DASHBOARD_METRIC_LABELS.okr_total_objectives).toBe('目标总数')
    expect(OKR_DASHBOARD_METRIC_LABELS.okr_overall_progress_avg).toBe('平均进度')
    expect(Object.keys(OKR_DASHBOARD_METRIC_LABELS).length).toBeGreaterThanOrEqual(18)
  })

  test('仪表盘警告码标签全量映射 + chip 类分档', () => {
    expect(OKR_DASHBOARD_WARNING_LABELS[OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE]).toBe(
      '数据来源已过期',
    )
    expect(OKR_DASHBOARD_WARNING_LABELS[OKR_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED]).toBe(
      '部分指标因权限被脱敏',
    )
    const codes = Object.keys(OKR_DASHBOARD_WARNING_CODES)
    for (const code of codes) {
      expect(
        OKR_DASHBOARD_WARNING_LABELS[code as keyof typeof OKR_DASHBOARD_WARNING_CODES],
      ).toBeDefined()
    }
    const warning: OkrDashboardWarning = {
      code: OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE,
      message: 'raw',
    }
    expect(okrDashboardWarningChipClass(warning)).toContain('--nx-status-warning')
  })

  test('关注原因标签映射（未知回落原文）', () => {
    expect(OKR_ATTENTION_REASON_LABELS[OKR_DASHBOARD_ATTENTION_REASONS.BEHIND_TARGET]).toBe(
      '进度落后目标',
    )
    expect(OKR_ATTENTION_REASON_LABELS[OKR_DASHBOARD_ATTENTION_REASONS.LOW_CONFIDENCE]).toBe(
      '信心不足',
    )
    expect(okrAttentionReasonLabel('unknown_reason')).toBe('unknown_reason')
  })
})
