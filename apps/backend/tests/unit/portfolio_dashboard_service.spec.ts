// Portfolio Dashboard Service 测试（v3-pmo-portfolio-dashboard §4.2 + §4.10）。
import { test } from '@japa/runner'
import { PORTFOLIO_DASHBOARD_METRIC_KEYS, PORTFOLIO_DASHBOARD_METRIC_VERSION } from '@aiproj/types'

test.group('PortfolioDashboardService — contracts', () => {
  test('PORTFOLIO_DASHBOARD_METRIC_VERSION 稳定', ({ assert }) => {
    assert.equal(PORTFOLIO_DASHBOARD_METRIC_VERSION, 'portfolio-dashboard.v1')
  })

  test('metric keys 包含核心 KPI', ({ assert }) => {
    assert.equal(PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS, 'total_projects')
    assert.equal(PORTFOLIO_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS, 'active_projects')
    assert.equal(PORTFOLIO_DASHBOARD_METRIC_KEYS.AT_RISK_PROJECTS, 'at_risk_projects')
  })

  test('metric keys 不含财务/预算/ROI', ({ assert }) => {
    const keys = Object.values(PORTFOLIO_DASHBOARD_METRIC_KEYS)
    assert.isFalse(keys.includes('budget' as any))
    assert.isFalse(keys.includes('roi' as any))
    assert.isFalse(keys.includes('cost' as any))
  })

  test('metric keys 数量 >= 19', ({ assert }) => {
    const keys = Object.values(PORTFOLIO_DASHBOARD_METRIC_KEYS)
    assert.isAtLeast(keys.length, 19)
  })
})
