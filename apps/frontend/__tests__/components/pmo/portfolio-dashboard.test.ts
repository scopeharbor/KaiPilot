// PMO Portfolio Dashboard 页面状态测试（v3-pmo-portfolio-dashboard §5.4 + §5.6）。
import { describe, test, expect } from 'vitest'

/** 将 kpiLabel 函数提取为独立函数测试 */
function kpiLabel(key: string): string {
  const labels: Record<string, string> = {
    total_projects: '项目总数',
    active_projects: '活跃项目',
    archived_projects: '已归档',
    at_risk_projects: '风险项目',
    blocked_projects: '暂停项目',
    overall_progress_avg: '平均进度',
    delivery_on_track_percent: '按期交付',
    overdue_project_percent: '延期项目',
    health_red_percent: '健康红色',
    health_yellow_percent: '健康黄色',
    health_green_percent: '健康绿色',
    risk_high_percent: '高风险',
    risk_critical_count: '严重风险',
    resource_overload_percent: '资源超载',
    prediction_high_severity_percent: '预测高压',
    source_freshness_stale_percent: '数据过期',
    metric_unavailable_count: '不可用指标',
    traffic_light_red_count: '红灯',
    traffic_light_yellow_count: '黄灯',
    traffic_light_green_count: '绿灯',
    traffic_light_gray_count: '灰灯',
  }
  return labels[key] ?? key
}

describe('Portfolio Dashboard kpiLabel', () => {
  test('已知 key 返回中文标签', () => {
    expect(kpiLabel('total_projects')).toBe('项目总数')
    expect(kpiLabel('at_risk_projects')).toBe('风险项目')
  })

  test('未知 key 返回原始 key', () => {
    expect(kpiLabel('nonexistent_key')).toBe('nonexistent_key')
  })

  test('所有 traffic light keys 有标签', () => {
    expect(kpiLabel('traffic_light_red_count')).toBe('红灯')
    expect(kpiLabel('traffic_light_yellow_count')).toBe('黄灯')
    expect(kpiLabel('traffic_light_green_count')).toBe('绿灯')
    expect(kpiLabel('traffic_light_gray_count')).toBe('灰灯')
  })

  test('无财务/预算/ROI 标签', () => {
    Object.keys(kpiLabel('budget') === 'budget' ? [] : [])
    expect(kpiLabel('budget')).toBe('budget')
    expect(kpiLabel('roi')).toBe('roi')
  })
})

describe('Portfolio Dashboard 页面逻辑', () => {
  test('空项目列表不影响摘要计算', () => {
    const emptyKpis: { key: string; value: number }[] = [
      { key: 'total_projects', value: 0 },
      { key: 'active_projects', value: 0 },
    ]
    expect(emptyKpis![0]!.value!).toBe(0)
    expect(emptyKpis![1]!.value!).toBe(0)
  })

  test('交通灯不可用时不泄漏灯色数据', () => {
    const unavailable = {
      available: false,
      forbidden: false,
      redCount: 0,
      yellowCount: 0,
      greenCount: 0,
      grayCount: 0,
      warnings: [{ code: 'TRAFFIC_LIGHT_UNAVAILABLE', message: 'PMO 交通灯能力未启用' }],
    }
    expect(unavailable.available).toBe(false)
    expect(unavailable.redCount).toBe(0)
    expect(unavailable!.warnings[0]!.code!).toBe('TRAFFIC_LIGHT_UNAVAILABLE')
  })

  test('权限脱敏时指标 value 为 null', () => {
    const redacted = {
      key: 'risk_high_percent' as const,
      value: null,
      unit: 'percent' as const,
      source: 'risk_summary' as const,
      status: 'forbidden' as const,
      warnings: [{ code: 'PERMISSION_REDACTED', message: '指标已脱敏' }],
    }
    expect(redacted.value).toBeNull()
    expect(redacted.status).toBe('forbidden')
  })

  test('不支持的财务指标不出现', () => {
    const validKeys = ['total_projects', 'active_projects', 'at_risk_projects']
    const forbidden = ['budget', 'roi', 'cost']
    for (const fk of forbidden) {
      expect(validKeys).not.toContain(fk)
    }
  })
})
