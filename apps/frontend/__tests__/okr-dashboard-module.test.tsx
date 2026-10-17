/**
 * 组织 Dashboard OKR 模块前端组件测试（v3-okr-dashboard §5.8）。
 *
 * 覆盖：
 *   - forbidden：无权 empty state，不含 KPI/attention/warning
 *   - unavailable：不可用 empty state
 *   - empty：当前周期无 OKR
 *   - ok / stale：KPI 数量随 size；attention 未授权仅 EyeOff
 *   - density=compact 时隐藏 attention list
 *   - navigation target orgId=0 → 不渲染跳转
 *   - warningCodes 中文化
 *   - 长中文 cycleTitle 使用 truncate
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OkrDashboardModuleRenderProps } from '@aiproj/types'
import { OkrDashboardModule } from '@/components/okr/okr-dashboard-module'

function makeRender(
  overrides: Partial<OkrDashboardModuleRenderProps> = {},
): OkrDashboardModuleRenderProps {
  return {
    status: 'ok',
    reasonCode: 'ok',
    emptyStateKey: null,
    metricVersion: 'okr@2026-07',
    cycleTitle: 'Q3 2026',
    cycleStatus: 'active',
    kpis: [
      { key: 'okr_active_objectives', value: 5, unit: 'count', status: 'ok' },
      { key: 'okr_at_risk_objectives', value: 2, unit: 'count', status: 'ok' },
      { key: 'okr_behind_key_results', value: 3, unit: 'count', status: 'ok' },
      { key: 'okr_overall_progress_avg', value: 55, unit: 'percent', status: 'ok' },
    ],
    attentionTop: [],
    warningCodes: [],
    navigationTarget: { type: 'okr_dashboard', organizationId: 42 },
    ...overrides,
  }
}

describe('OkrDashboardModule — 状态', () => {
  it('reasonCode=forbidden → forbidden 空态，不含 KPI/attention/warning', () => {
    render(
      <OkrDashboardModule render={makeRender({ reasonCode: 'forbidden', status: 'forbidden' })} />,
    )
    expect(screen.getByTestId('okr-module-forbidden')).toBeInTheDocument()
    expect(screen.queryByTestId('okr-module-kpis')).toBeNull()
    expect(screen.queryByTestId('okr-module-attention')).toBeNull()
  })

  it('reasonCode=unavailable → unavailable 空态', () => {
    render(
      <OkrDashboardModule
        render={makeRender({ reasonCode: 'unavailable', status: 'unavailable' })}
      />,
    )
    expect(screen.getByTestId('okr-module-unavailable')).toBeInTheDocument()
  })

  it('reasonCode=empty → empty 空态', () => {
    render(<OkrDashboardModule render={makeRender({ reasonCode: 'empty', status: 'empty' })} />)
    expect(screen.getByTestId('okr-module-empty')).toBeInTheDocument()
  })

  it('reasonCode=stale → 主体 + stale alert', () => {
    render(<OkrDashboardModule render={makeRender({ reasonCode: 'stale', status: 'stale' })} />)
    expect(screen.getByTestId('okr-module')).toBeInTheDocument()
    expect(screen.getByTestId('okr-module-stale')).toBeInTheDocument()
  })

  it('ok 主体 → KPI + drill + cycle 上下文', () => {
    render(<OkrDashboardModule render={makeRender()} />)
    expect(screen.getByTestId('okr-module')).toBeInTheDocument()
    expect(screen.getByTestId('okr-module-kpis')).toBeInTheDocument()
    expect(screen.getByTestId('okr-module-drill')).toBeInTheDocument()
    expect(screen.getByText('Q3 2026')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
  })
})

describe('OkrDashboardModule — size 与 density', () => {
  it('size=sm → 只渲染 2 个 KPI', () => {
    const { container } = render(<OkrDashboardModule render={makeRender()} size="sm" />)
    const dt = container.querySelectorAll('[data-testid="okr-module-kpis"] dt')
    expect(dt.length).toBe(2)
  })

  it('size=lg → 4 个 KPI', () => {
    const { container } = render(<OkrDashboardModule render={makeRender()} size="lg" />)
    const dt = container.querySelectorAll('[data-testid="okr-module-kpis"] dt')
    expect(dt.length).toBe(4)
  })

  it('density=compact → 隐藏 attention list', () => {
    render(
      <OkrDashboardModule
        render={makeRender({
          attentionTop: [
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
              target: null,
              warnings: [],
            },
          ],
        })}
        density="compact"
      />,
    )
    expect(screen.queryByTestId('okr-module-attention')).toBeNull()
  })
})

describe('OkrDashboardModule — 安全下钻', () => {
  it('attention target unauthorized → 只显示 EyeOff，无跳转 href', () => {
    render(
      <OkrDashboardModule
        render={makeRender({
          attentionTop: [
            {
              kind: 'objective',
              entityId: 1,
              title: 'A',
              scope: 'team',
              status: 'active',
              progress: 30,
              confidence: 'low',
              ownerId: null,
              riskScore: 0,
              reasons: ['behind_target'],
              freshness: null,
              target: { kind: 'objective', href: '/secret/1', authorized: false },
              warnings: [],
            },
          ],
        })}
      />,
    )
    expect(screen.getByTestId('okr-module-attention-forbidden')).toBeInTheDocument()
    expect(screen.queryByTestId('okr-module-attention-link')).toBeNull()
    // 未授权 href 不得出现在 DOM
    expect(screen.queryByText('/secret/1')).toBeNull()
  })

  it('attention target authorized → 渲染 <a href>', () => {
    render(
      <OkrDashboardModule
        render={makeRender({
          attentionTop: [
            {
              kind: 'objective',
              entityId: 1,
              title: 'A',
              scope: 'team',
              status: 'active',
              progress: 30,
              confidence: 'low',
              ownerId: null,
              riskScore: 0,
              reasons: ['behind_target'],
              freshness: null,
              target: {
                kind: 'objective',
                href: '/organization/okrs/objectives/1',
                authorized: true,
              },
              warnings: [],
            },
          ],
        })}
      />,
    )
    const link = screen.getByTestId('okr-module-attention-link')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/organization/okrs/objectives/1')
  })

  it('navigationTarget.organizationId=0 → 不渲染顶部 drill 链接', () => {
    render(
      <OkrDashboardModule
        render={makeRender({
          navigationTarget: { type: 'okr_dashboard', organizationId: 0 },
        })}
      />,
    )
    expect(screen.queryByTestId('okr-module-drill')).toBeNull()
  })
})

describe('OkrDashboardModule — warning 与长文本', () => {
  it('warningCodes 中文化', () => {
    render(
      <OkrDashboardModule
        render={makeRender({ warningCodes: ['SOURCE_STALE', 'ATTENTION_TRUNCATED'] })}
      />,
    )
    expect(screen.getByText('数据来源已过期')).toBeInTheDocument()
    expect(screen.getByText('关注项已按上限截断')).toBeInTheDocument()
  })

  it('长中文 cycleTitle 使用 truncate 类', () => {
    const longTitle = '这是一个非常非常非常非常非常非常非常非常非常长的周期标题'
    render(<OkrDashboardModule render={makeRender({ cycleTitle: longTitle })} />)
    const titleEl = screen.getByText(longTitle)
    expect(titleEl.className).toContain('truncate')
  })
})
