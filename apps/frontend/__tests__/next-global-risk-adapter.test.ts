/**
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.5 —— 全局风险 taxonomy 适配器单元测试。
 *
 * 覆盖（tasks 8.5 + spec「问题与风险入口」）：
 * - 「问题 vs 风险 vs 产品故障」三分 taxonomy 数据齐全（kind/label/definition/example/
 *   where/implemented），语义对齐旧 ISSUE_RISK_TAXONOMY 文案口径；
 * - implemented 语义：三分均已投产可用（项目问题 Issue 后端已投产 + 新轨工作台接线）；
 * - 可用性徽标双通道（可用 = 恢复绿 / 规划中 = 琥珀 + 中文文字）；
 * - 项目风险登记册深链指向新轨 /next/projects/:id/risks；产品故障入口指向新轨
 *   帮助中心故障排查 ?q= 查询。
 */
import { describe, expect, it } from 'vitest'
import {
  buildProjectRisksDeepLink,
  getGlobalRiskTaxonomyByKind,
  getGlobalRiskTaxonomyLabel,
  getTaxonomyStatusChipClass,
  getTaxonomyStatusLabel,
  GLOBAL_RISK_TAXONOMY,
  INCIDENT_HELP_SEARCH_HREF,
  NEW_PROJECT_CREATE_HREF,
} from '@/lib/next/org-risk-global/global-risk-adapter'

describe('global-risk-adapter：三分 taxonomy 数据（对齐旧 ISSUE_RISK_TAXONOMY 语义）', () => {
  it('恰含 项目问题/项目风险/产品故障 三个条目，字段齐全', () => {
    expect(GLOBAL_RISK_TAXONOMY).toHaveLength(3)
    expect(GLOBAL_RISK_TAXONOMY.map((entry) => entry.kind)).toEqual(['issue', 'risk', 'incident'])
    for (const entry of GLOBAL_RISK_TAXONOMY) {
      expect(entry.label).toBeTruthy()
      expect(entry.definition).toBeTruthy()
      expect(entry.example).toBeTruthy()
      expect(entry.where).toBeTruthy()
      expect(typeof entry.implemented).toBe('boolean')
    }
  })

  it('三分均已投产可用（项目问题 Issue 后端已投产，工作台真实 CRUD）', () => {
    const issue = getGlobalRiskTaxonomyByKind('issue')
    expect(issue?.implemented).toBe(true)
    const risk = getGlobalRiskTaxonomyByKind('risk')
    expect(risk?.implemented).toBe(true)
    const incident = getGlobalRiskTaxonomyByKind('incident')
    expect(incident?.implemented).toBe(true)
  })

  it('文案与旧 ISSUE_RISK_TAXONOMY 口径一致（同义改写但语义不失真）', () => {
    const issue = getGlobalRiskTaxonomyByKind('issue')
    expect(issue?.definition).toContain('阻塞项目目标')
    expect(issue?.where).toContain('owner')
    const risk = getGlobalRiskTaxonomyByKind('risk')
    expect(risk?.definition).toContain('概率')
    expect(risk?.where).toContain('风险登记册')
    const incident = getGlobalRiskTaxonomyByKind('incident')
    expect(incident?.definition).toContain('软件')
    expect(incident?.where).toContain('故障排查')
    expect(incident?.where).not.toContain('风险登记册')
  })

  it('taxonomy 标签与未知回落', () => {
    expect(getGlobalRiskTaxonomyLabel('issue')).toBe('项目问题')
    expect(getGlobalRiskTaxonomyLabel('risk')).toBe('项目风险')
    expect(getGlobalRiskTaxonomyLabel('incident')).toBe('产品故障')
    expect(getGlobalRiskTaxonomyLabel('recommendation' as never)).toBe('recommendation')
  })
})

describe('global-risk-adapter：可用性徽标（双通道）', () => {
  it('implemented → 可用（恢复绿）；false → 规划中（琥珀）', () => {
    expect(getTaxonomyStatusLabel(true)).toBe('可用')
    expect(getTaxonomyStatusLabel(false)).toBe('规划中')
    expect(getTaxonomyStatusChipClass(true)).toContain('text-[var(--nx-status-success)]')
    expect(getTaxonomyStatusChipClass(true)).toContain('border-[rgba(16,185,129,0.45)]')
    expect(getTaxonomyStatusChipClass(false)).toContain('text-[var(--nx-status-warning)]')
    expect(getTaxonomyStatusChipClass(false)).toContain('border-[rgba(245,158,11,0.45)]')
  })
})

describe('global-risk-adapter：新轨深链与确定性常量', () => {
  it('项目风险登记册深链指向新轨项目风险工作台（B6c 已迁）', () => {
    expect(buildProjectRisksDeepLink(3)).toBe('/next/projects/3/risks')
    expect(buildProjectRisksDeepLink('42')).toBe('/next/projects/42/risks')
  })

  it('产品故障引导新轨帮助中心故障排查；创建入口指向新轨生成剧场', () => {
    expect(INCIDENT_HELP_SEARCH_HREF).toBe('/next/help/search?q=故障')
    expect(NEW_PROJECT_CREATE_HREF).toBe('/next/create')
  })
})
