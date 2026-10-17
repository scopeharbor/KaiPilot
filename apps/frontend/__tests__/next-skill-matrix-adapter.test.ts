/**
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.1 —— 技能矩阵适配器单元测试。
 *
 * 覆盖（tasks 8.1 + spec「全局资源入口、技能矩阵与问题风险入口」技能矩阵项）：
 * - formatCoveragePercent：0 / 1 / 小数（Math.round 语义，0.995 → 100%）；
 * - formatCapacityHours：正数/零/负缺口小时（旧轨「缺 N 小时」语义）、小数四舍五入；
 * - 缺口严重度五档中文标签全覆盖；getGapSeverityLabel 未知回落；
 * - getGapSeverityColor 五档语义色阶（全部消费 next-tokens.css 既有令牌 var 名，
 *   杜绝臆造令牌）与未知回落中性；
 * - 严重度徽标双通道类（颜色令牌 + rgba 固定展开边框/底色 + 文字类）；
 * - 覆盖率三档色阶边界（0.8 / 0.5 / 0.25 精确分档）与档位标签；
 * - 候选关键词匹配：资源名/角色/技能标签命中、大小写不敏感、空关键词恒命中；
 * - fresh 来源中文标签全覆盖与未知回落；
 * - 缺口按严重度稳定排序（critical → none）。
 */
import { describe, expect, it } from 'vitest'
import {
  formatCapacityHours,
  formatCoveragePercent,
  getCoverageToneChipClass,
  getCoverageToneColor,
  getCoverageToneLabel,
  getGapSeverityChipClass,
  getGapSeverityColor,
  getGapSeverityLabel,
  getSkillSourceLabel,
  getWarningToneChipClass,
  matchCandidateKeywords,
  SKILL_SOURCE_LABELS,
  sortGapsBySeverity,
} from '@/lib/next/org-skill-matrix/skill-matrix-adapter'

describe('skill-matrix-adapter：覆盖率与容量格式化（旧轨 formatCoveragePercent/formatCapacityHours 语义）', () => {
  it('覆盖率百分比格式化：0 → 0%、1 → 100%、小数按四舍五入', () => {
    expect(formatCoveragePercent(0)).toBe('0%')
    expect(formatCoveragePercent(1)).toBe('100%')
    expect(formatCoveragePercent(0.5)).toBe('50%')
    expect(formatCoveragePercent(0.23456)).toBe('23%')
    expect(formatCoveragePercent(0.995)).toBe('100%')
    expect(formatCoveragePercent(0.004)).toBe('0%')
  })

  it('容量小时格式化：正数/零直出 N 小时，负缺口小时 → 「缺 N 小时」', () => {
    expect(formatCapacityHours(40)).toBe('40 小时')
    expect(formatCapacityHours(0)).toBe('0 小时')
    expect(formatCapacityHours(8.4)).toBe('8 小时')
    expect(formatCapacityHours(8.6)).toBe('9 小时')
    expect(formatCapacityHours(-12.6)).toBe('缺 13 小时')
    expect(formatCapacityHours(-120)).toBe('缺 120 小时')
  })
})

describe('skill-matrix-adapter：缺口严重度标签与色阶（旧轨 getGapSeverityColor/Label 语义）', () => {
  it('五档严重度中文标签全覆盖：严重/高/中/低/无缺口', () => {
    expect(getGapSeverityLabel('critical')).toBe('严重')
    expect(getGapSeverityLabel('high')).toBe('高')
    expect(getGapSeverityLabel('medium')).toBe('中')
    expect(getGapSeverityLabel('low')).toBe('低')
    expect(getGapSeverityLabel('none')).toBe('无缺口')
  })

  it('未知严重度标签回落原值，不臆造文案', () => {
    expect(getGapSeverityLabel('bogus' as never)).toBe('bogus')
  })

  it('色阶全部为既有 --nx-* 令牌：critical→danger / high→warning / medium→workspace-blue / low→success / none→text-muted', () => {
    expect(getGapSeverityColor('critical')).toBe('var(--nx-status-danger)')
    expect(getGapSeverityColor('high')).toBe('var(--nx-status-warning)')
    expect(getGapSeverityColor('medium')).toBe('var(--nx-workspace-blue)')
    expect(getGapSeverityColor('low')).toBe('var(--nx-status-success)')
    expect(getGapSeverityColor('none')).toBe('var(--nx-text-muted)')
    // 未知严重度回落中性
    expect(getGapSeverityColor('bogus' as never)).toBe('var(--nx-text-muted)')
  })

  it('严重度徽标类为双通道：文字令牌类 + rgba 固定展开（0.45 边框 / 0.14 底色）', () => {
    const critical = getGapSeverityChipClass('critical')
    expect(critical).toContain('text-[var(--nx-status-danger)]')
    expect(critical).toContain('border-[rgba(239,68,68,0.45)]')
    expect(critical).toContain('bg-[rgba(239,68,68,0.14)]')
    const low = getGapSeverityChipClass('low')
    expect(low).toContain('text-[var(--nx-status-success)]')
    expect(low).toContain('border-[rgba(16,185,129,0.45)]')
    const unknown = getGapSeverityChipClass('bogus' as never)
    expect(unknown).toContain('text-[var(--nx-text-muted)]')
  })

  it('缺口按严重度稳定排序：critical 在前、none 在后', () => {
    const rows = [
      { skillKey: 'slow', severity: 'low' as const },
      { skillKey: 'none-skill', severity: 'none' as const },
      { skillKey: 'hot', severity: 'critical' as const },
      { skillKey: 'warm', severity: 'high' as const },
      { skillKey: 'mid', severity: 'medium' as const },
    ]
    const sorted = sortGapsBySeverity(rows)
    expect(sorted.map((row) => row.severity)).toEqual(['critical', 'high', 'medium', 'low', 'none'])
    // 输入不被修改（纯函数）
    expect(rows[0]?.severity).toBe('low')
  })
})

describe('skill-matrix-adapter：覆盖率色阶边界与档位', () => {
  it('0.8 / 0.5 / 0.25 三档边界精确分档：≥0.8 充足 / ≥0.5 一般 / ≥0.25 偏低 / <0.25 严重不足', () => {
    expect(getCoverageToneColor(0.8)).toBe('var(--nx-status-success)')
    expect(getCoverageToneColor(0.79)).toBe('var(--nx-workspace-blue)')
    expect(getCoverageToneColor(0.5)).toBe('var(--nx-workspace-blue)')
    expect(getCoverageToneColor(0.49)).toBe('var(--nx-status-warning)')
    expect(getCoverageToneColor(0.25)).toBe('var(--nx-status-warning)')
    expect(getCoverageToneColor(0.249)).toBe('var(--nx-status-danger)')
    expect(getCoverageToneColor(0)).toBe('var(--nx-status-danger)')
    expect(getCoverageToneColor(1)).toBe('var(--nx-status-success)')
  })

  it('档位标签与徽标类双通道一致', () => {
    expect(getCoverageToneLabel(0.9)).toBe('覆盖充足')
    expect(getCoverageToneLabel(0.6)).toBe('覆盖一般')
    expect(getCoverageToneLabel(0.3)).toBe('覆盖偏低')
    expect(getCoverageToneLabel(0.1)).toBe('覆盖严重不足')
    expect(getCoverageToneChipClass(0.9)).toContain('text-[var(--nx-status-success)]')
    expect(getCoverageToneChipClass(0.1)).toContain('text-[var(--nx-status-danger)]')
  })
})

describe('skill-matrix-adapter：候选关键词匹配', () => {
  const candidate = {
    resourceName: '陈默',
    role: '前端工程师',
    skillTags: ['react', 'TypeScript', '图表渲染'],
  }

  it('关键词命中资源名/角色/技能标签任一即命中', () => {
    expect(matchCandidateKeywords(candidate, ['陈默'])).toBe(true)
    expect(matchCandidateKeywords(candidate, ['前端'])).toBe(true)
    expect(matchCandidateKeywords(candidate, ['react'])).toBe(true)
    expect(matchCandidateKeywords(candidate, ['图表'])).toBe(true)
  })

  it('全部关键词需命中（AND）；未命中返回 false', () => {
    expect(matchCandidateKeywords(candidate, ['前端', 'react'])).toBe(true)
    expect(matchCandidateKeywords(candidate, ['react', 'java'])).toBe(false)
    expect(matchCandidateKeywords(candidate, ['后端'])).toBe(false)
  })

  it('大小写不敏感 + 空白关键词被忽略 + 空关键词恒命中', () => {
    expect(matchCandidateKeywords(candidate, ['REACT'])).toBe(true)
    expect(matchCandidateKeywords(candidate, [' typescript '])).toBe(true)
    expect(matchCandidateKeywords(candidate, ['', '  '])).toBe(true)
    expect(matchCandidateKeywords(candidate, [])).toBe(true)
  })
})

describe('skill-matrix-adapter：fresh 来源标签与 warning 色阶', () => {
  it('六类来源中文标签全覆盖（与 RESOURCE_SKILL_MATRIX_SOURCES 对齐）', () => {
    expect(SKILL_SOURCE_LABELS).toMatchObject({
      project_resource: '项目资源',
      task_requirement: '任务需求',
      resource_load: '资源负载',
      resource_conflict: '资源冲突',
      skill_registry: 'Skill 注册表',
      resource_pool: '资源池',
    })
    expect(getSkillSourceLabel('project_resource')).toBe('项目资源')
    expect(getSkillSourceLabel('unknown_source' as never)).toBe('unknown_source')
  })

  it('warning 严重度色阶：critical → danger、warning → 琥珀、info/缺省 → 中性', () => {
    expect(getWarningToneChipClass('critical')).toContain('text-[var(--nx-status-danger)]')
    expect(getWarningToneChipClass('warning')).toContain('text-[var(--nx-status-warning)]')
    expect(getWarningToneChipClass('info')).toContain('text-[var(--nx-text-secondary)]')
    expect(getWarningToneChipClass(undefined)).toContain('text-[var(--nx-text-secondary)]')
  })
})
