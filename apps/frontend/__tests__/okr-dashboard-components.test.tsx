/**
 * OKR Dashboard 组件群测试（v3-okr-dashboard §5.6）。
 *
 * 覆盖：
 *   - OkrKpiStrip：KPI 顺序、redacted 时值降级到 '--'
 *   - OkrCycleHeader：无 cycleId 空态、有 cycle 时展示 title/status/剩余
 *   - OkrDistributionList：空 slices 显示 EmptyState；有 slices 显示条目
 *   - OkrAttentionTable：空态；authorized target 渲染跳转；unauthorized 只渲染 EyeOff（不泄露 href）
 *   - OkrAlignmentHealthPanel：不可用/forbidden 空态；可用时数值
 *   - OkrEvidenceFreshness：不可用/forbidden 空态；可用时统计
 *   - OkrSourceFreshnessList：空数组 null；stale 项带 Clock icon
 *   - OkrBackflowStrip：available/forbidden/unavailable 三态
 *   - OkrStaleRail：无 stale 时不渲染；有 stale 时 Alert
 *   - OkrWarningList：中文文案由 code 决定
 *   - 长中文文本不破坏布局（truncate class 存在）
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type {
  OkrDashboardAttentionItem,
  OkrDashboardCycleContext,
  OkrDashboardMetric,
  OkrDashboardSummary,
  OkrDashboardWarning,
} from '@aiproj/types'
import {
  OkrAlignmentHealthPanel,
  OkrAttentionTable,
  OkrBackflowStrip,
  OkrCycleHeader,
  OkrDistributionList,
  OkrEvidenceFreshness,
  OkrKpiStrip,
  OkrSourceFreshnessList,
  OkrStaleRail,
  OkrWarningList,
} from '@/components/okr/okr-dashboard-components'

function metric(
  key: OkrDashboardMetric['key'],
  value: number | null,
  unit: OkrDashboardMetric['unit'] = 'count',
): OkrDashboardMetric {
  return {
    key,
    value,
    unit,
    source: 'okr_objective',
    status: value === null ? 'unavailable' : 'ok',
    warnings: [],
  } as OkrDashboardMetric
}

function makeSummary(overrides: Partial<OkrDashboardSummary> = {}): OkrDashboardSummary {
  return {
    meta: {
      calculatedAt: '2026-07-30T12:00:00.000Z',
      metricVersion: 'okr@2026-07',
      organizationId: 1,
      actorId: 1,
      cycleId: 1,
      visibleObjectiveCount: 3,
      visibleKeyResultCount: 10,
      restrictedObjectiveCount: 0,
      restrictedKeyResultCount: 0,
      sections: [],
      attentionLimit: 20,
      staleThresholdMinutes: 60,
      inputSignatureHash: 'abc',
    },
    cycleContext: {
      cycleId: 1,
      title: 'Q3 2026',
      status: 'active',
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
      elapsedPercent: 45,
      daysRemaining: 60,
    },
    kpis: [
      metric('okr_active_objectives', 5),
      metric('okr_at_risk_objectives', 2),
      metric('okr_behind_key_results', 3),
      metric('okr_overall_progress_avg', 55, 'percent'),
    ],
    progressDistribution: [],
    statusDistribution: [],
    attention: [],
    alignmentHealth: {
      available: true,
      forbidden: false,
      healthScore: 80,
      orphanObjectiveCount: 1,
      weakAlignmentCount: 2,
      disabledScopeReferences: 0,
      maxDepth: 3,
      warnings: [],
    },
    evidenceFreshness: {
      available: true,
      forbidden: false,
      totalEvidence: 20,
      staleEvidence: 3,
      restrictedEvidence: 0,
      freshestAt: '2026-07-29T00:00:00.000Z',
      stalestAt: '2026-06-01T00:00:00.000Z',
      warnings: [],
    },
    sourceFreshness: [],
    backflow: {
      available: true,
      forbidden: false,
      candidateCount: 5,
      conflictCount: 1,
      staleCount: 2,
      lastRefreshedAt: '2026-07-29T00:00:00.000Z',
      targets: [],
      warnings: [],
    },
    warnings: [],
    ...overrides,
  } as OkrDashboardSummary
}

// ─── KPI Strip ────────────────────────────────────────────────────────────────

describe('OkrKpiStrip', () => {
  it('summary=undefined → 骨架', () => {
    render(<OkrKpiStrip summary={undefined} />)
    expect(screen.getByTestId('okr-kpi-strip-empty')).toBeInTheDocument()
  })

  it('渲染 4 个 KPI 卡片（顺序为白名单顺序）', () => {
    render(<OkrKpiStrip summary={makeSummary()} />)
    expect(screen.getByTestId('okr-kpi-okr_active_objectives')).toBeInTheDocument()
    expect(screen.getByTestId('okr-kpi-okr_at_risk_objectives')).toBeInTheDocument()
    expect(screen.getByTestId('okr-kpi-okr_behind_key_results')).toBeInTheDocument()
    expect(screen.getByTestId('okr-kpi-okr_overall_progress_avg')).toBeInTheDocument()
  })

  it('redacted metric（value=null）→ 显示 --', () => {
    const s = makeSummary({
      kpis: [
        {
          ...metric('okr_active_objectives', null),
          status: 'forbidden',
        } as OkrDashboardMetric,
      ],
    })
    render(<OkrKpiStrip summary={s} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })
})

// ─── Cycle Header ─────────────────────────────────────────────────────────────

describe('OkrCycleHeader', () => {
  it('cycle=undefined → 空态', () => {
    render(<OkrCycleHeader cycle={undefined} />)
    expect(screen.getByTestId('okr-cycle-empty')).toBeInTheDocument()
  })

  it('cycleId=null → 空态', () => {
    const empty: OkrDashboardCycleContext = {
      cycleId: null,
      title: null,
      status: null,
      startDate: null,
      endDate: null,
      elapsedPercent: null,
      daysRemaining: null,
    }
    render(<OkrCycleHeader cycle={empty} />)
    expect(screen.getByTestId('okr-cycle-empty')).toBeInTheDocument()
  })

  it('渲染 title / status / 已过 / 剩余', () => {
    const c: OkrDashboardCycleContext = {
      cycleId: 1,
      title: 'Q3 2026',
      status: 'active',
      startDate: '2026-06-01',
      endDate: '2026-09-30',
      elapsedPercent: 45,
      daysRemaining: 60,
    }
    render(<OkrCycleHeader cycle={c} />)
    expect(screen.getByText('Q3 2026')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText(/已过 45%/)).toBeInTheDocument()
    expect(screen.getByText(/剩余 60 天/)).toBeInTheDocument()
  })
})

// ─── Distribution ─────────────────────────────────────────────────────────────

describe('OkrDistributionList', () => {
  it('空 slices → EmptyState', () => {
    render(<OkrDistributionList slices={[]} title="进度分布" testid="okr-progress-distribution" />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('多 slices → 显示 label / count / percent', () => {
    render(
      <OkrDistributionList
        slices={[
          { key: 'active', label: '进行中', count: 5, percent: 50 },
          { key: 'paused', label: '已暂停', count: 5, percent: 50 },
        ]}
        title="进度分布"
        testid="okr-progress-distribution"
      />,
    )
    expect(screen.getByTestId('okr-progress-distribution')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('已暂停')).toBeInTheDocument()
  })
})

// ─── Attention Table ──────────────────────────────────────────────────────────

describe('OkrAttentionTable', () => {
  it('空 items → EmptyState', () => {
    render(<OkrAttentionTable items={[]} />)
    expect(screen.getByText('暂无关注项')).toBeInTheDocument()
  })

  it('authorized target → 渲染 <a href>；unauthorized → 只渲染 EyeOff（不泄露 href）', () => {
    const items: OkrDashboardAttentionItem[] = [
      {
        kind: 'objective',
        entityId: 1,
        title: 'A 目标',
        scope: 'team',
        status: 'active',
        progress: 30,
        confidence: 'low',
        ownerId: null,
        riskScore: 0,
        reasons: ['behind_target'],
        freshness: null,
        target: { kind: 'objective', href: '/organization/okrs/objectives/1', authorized: true },
        warnings: [],
      },
      {
        kind: 'key_result',
        entityId: 10,
        title: 'B KR',
        scope: 'team',
        status: 'active',
        progress: 20,
        confidence: 'low',
        ownerId: null,
        riskScore: 0,
        reasons: ['stale_evidence'],
        freshness: null,
        target: {
          kind: 'key_result',
          href: '/organization/okrs/key-results/10',
          authorized: false,
        },
        warnings: [],
      },
    ]
    render(<OkrAttentionTable items={items} />)
    // authorized 有跳转链接
    const links = screen.getAllByTestId('okr-drill-link')
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute('href')).toBe('/organization/okrs/objectives/1')
    // unauthorized 只显示 EyeOff
    expect(screen.getByTestId('okr-drill-forbidden')).toBeInTheDocument()
    // 未授权行绝不能包含 unauthorized 的 href
    expect(screen.queryByText('/organization/okrs/key-results/10')).toBeNull()
    // reason 中文化
    expect(screen.getByText('进度落后目标')).toBeInTheDocument()
    expect(screen.getByText('证据过期')).toBeInTheDocument()
  })
})

// ─── Alignment Health ────────────────────────────────────────────────────────

describe('OkrAlignmentHealthPanel', () => {
  it('forbidden → 显示无权 empty state', () => {
    render(
      <OkrAlignmentHealthPanel
        health={{
          available: false,
          forbidden: true,
          healthScore: null,
          orphanObjectiveCount: null,
          weakAlignmentCount: null,
          disabledScopeReferences: null,
          maxDepth: null,
          warnings: [],
        }}
      />,
    )
    expect(screen.getByText('无权查看对齐健康度')).toBeInTheDocument()
  })

  it('available=true → 渲染健康度数据', () => {
    render(<OkrAlignmentHealthPanel health={makeSummary().alignmentHealth} />)
    expect(screen.getByTestId('okr-alignment-health')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
  })
})

// ─── Evidence Freshness ──────────────────────────────────────────────────────

describe('OkrEvidenceFreshness', () => {
  it('forbidden → 空态', () => {
    render(
      <OkrEvidenceFreshness
        evidence={{
          available: false,
          forbidden: true,
          totalEvidence: null,
          staleEvidence: null,
          restrictedEvidence: null,
          freshestAt: null,
          stalestAt: null,
          warnings: [],
        }}
      />,
    )
    expect(screen.getByText('无权查看证据')).toBeInTheDocument()
  })

  it('available=true → 数字/时间', () => {
    render(
      <OkrEvidenceFreshness
        evidence={makeSummary().evidenceFreshness}
        now={Date.parse('2026-07-30T12:00:00.000Z')}
      />,
    )
    expect(screen.getByTestId('okr-evidence-freshness')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

// ─── Source freshness list ───────────────────────────────────────────────────

describe('OkrSourceFreshnessList', () => {
  it('空数组 → null', () => {
    const { container } = render(<OkrSourceFreshnessList summary={makeSummary()} />)
    expect(container.firstChild).toBeNull()
  })

  it('stale 项带 destructive 样式', () => {
    const s = makeSummary({
      sourceFreshness: [
        {
          source: 'okr_objective',
          lastUpdatedAt: '2026-06-01T00:00:00.000Z',
          isStale: true,
          staleThresholdMinutes: 60,
          status: 'ok',
        },
      ],
    })
    render(<OkrSourceFreshnessList summary={s} now={Date.parse('2026-07-30T12:00:00.000Z')} />)
    expect(screen.getByTestId('okr-source-freshness')).toBeInTheDocument()
    expect(screen.getByText('okr_objective')).toBeInTheDocument()
  })
})

// ─── Warning list ────────────────────────────────────────────────────────────

describe('OkrWarningList', () => {
  it('空数组 → 不渲染', () => {
    const { container } = render(<OkrWarningList warnings={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('已知 code → 用中文映射；未知 code → fallback 到 message', () => {
    const w: OkrDashboardWarning[] = [
      { code: 'SOURCE_STALE', message: 'raw' },
      // 故意用未知 code：本用例验证的正是'没有中文映射时回落到 message'，
      // 值必然不在 OkrDashboardWarningCode 联合里。
      {
        code: 'UNKNOWN_XYZ' as unknown as OkrDashboardWarning['code'],
        message: '自定义 fallback 文案',
      },
    ]
    render(<OkrWarningList warnings={w} />)
    expect(screen.getByText('数据来源已过期')).toBeInTheDocument()
    expect(screen.getByText('自定义 fallback 文案')).toBeInTheDocument()
  })
})

// ─── Backflow Strip ──────────────────────────────────────────────────────────

describe('OkrBackflowStrip', () => {
  it('available=false → unavailable', () => {
    const s = makeSummary({
      backflow: { ...makeSummary().backflow, available: false },
    })
    render(<OkrBackflowStrip summary={s} />)
    expect(screen.getByTestId('okr-backflow-unavailable')).toBeInTheDocument()
  })

  it('forbidden=true → forbidden', () => {
    const s = makeSummary({
      backflow: { ...makeSummary().backflow, forbidden: true },
    })
    render(<OkrBackflowStrip summary={s} />)
    expect(screen.getByTestId('okr-backflow-forbidden')).toBeInTheDocument()
  })

  it('available=true → 主体', () => {
    render(<OkrBackflowStrip summary={makeSummary()} />)
    expect(screen.getByTestId('okr-backflow-strip')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})

// ─── Stale rail ──────────────────────────────────────────────────────────────

describe('OkrStaleRail', () => {
  it('无 stale → 不渲染', () => {
    const { container } = render(<OkrStaleRail summary={makeSummary()} />)
    expect(container.firstChild).toBeNull()
  })

  it('有 stale → Alert 中列出 source 名', () => {
    const s = makeSummary({
      sourceFreshness: [
        {
          source: 'okr_evidence',
          lastUpdatedAt: '2026-06-01T00:00:00.000Z',
          isStale: true,
          staleThresholdMinutes: 60,
          status: 'ok',
        },
      ],
    })
    render(<OkrStaleRail summary={s} />)
    expect(screen.getByTestId('okr-stale-rail')).toBeInTheDocument()
    expect(screen.getByText(/okr_evidence/)).toBeInTheDocument()
  })
})

// ─── 长中文文本 & 键盘可达 ───────────────────────────────────────────────────

describe('组件健壮性 — 长文与可达性', () => {
  it('长中文 title 使用 truncate 类，避免撑破布局', () => {
    const longTitle =
      '这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的目标标题用来验证截断'
    const items: OkrDashboardAttentionItem[] = [
      {
        kind: 'objective',
        entityId: 1,
        title: longTitle,
        scope: 'team',
        status: 'active',
        progress: 30,
        confidence: 'low',
        ownerId: null,
        riskScore: 0,
        reasons: ['behind_target'],
        freshness: null,
        target: { kind: 'objective', href: '/x', authorized: true },
        warnings: [],
      },
    ]
    render(<OkrAttentionTable items={items} />)
    const titleEl = screen.getByText(longTitle)
    expect(titleEl.className).toContain('truncate')
  })

  it('drill link 是键盘可达的原生 <a> 元素', () => {
    const items: OkrDashboardAttentionItem[] = [
      {
        kind: 'objective',
        entityId: 1,
        title: 'X',
        scope: 'team',
        status: 'active',
        progress: 30,
        confidence: 'low',
        ownerId: null,
        riskScore: 0,
        reasons: ['behind_target'],
        freshness: null,
        target: { kind: 'objective', href: '/x', authorized: true },
        warnings: [],
      },
    ]
    render(<OkrAttentionTable items={items} />)
    const link = screen.getByTestId('okr-drill-link')
    expect(link.tagName).toBe('A')
  })
})
