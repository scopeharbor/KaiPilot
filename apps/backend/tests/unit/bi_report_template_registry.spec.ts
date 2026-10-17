/**
 * BI 报表模板注册表测试（tasks §2.2）。
 *
 * 覆盖：
 *   - 5 个内置模板定义完整性
 *   - 每个模板引用的数据源键/指标键/维度键在注册表中存在
 *   - 非声明式内容被拒绝
 *   - 模板查找、按分类/场景筛选
 */
import { describe, it, expect } from 'vitest'
import {
  BI_BUILTIN_TEMPLATES,
  isBuiltinBiTemplate,
  getBuiltinBiTemplatesByCategory,
  getBuiltinBiTemplatesByScenario,
  getBuiltinBiTemplate,
  getBuiltinBiTemplateVersion,
} from '#services/bi_report_templates/registry'
import {
  BI_TEMPLATE_CATEGORIES,
  BI_TEMPLATE_SCENARIOS,
  BI_DATASOURCE_KEY_VALUES,
  BI_TEMPLATE_METRIC_KEY_VALUES,
  BI_TEMPLATE_DIMENSION_KEY_VALUES,
} from '@aiproj/types'

describe('BI 报表模板注册表', () => {
  describe('内置模板完整性', () => {
    it('注册表包含 5 个内置模板', () => {
      expect(BI_BUILTIN_TEMPLATES).toHaveLength(5)
    })

    it('每个模板有唯一 templateId', () => {
      const ids = BI_BUILTIN_TEMPLATES.map((t) => t.templateId)
      const unique = new Set(ids)
      expect(unique.size).toBe(5)
    })

    it('每个模板 version 字段与 BI_TEMPLATE_VERSIONS 一致', () => {
      for (const t of BI_BUILTIN_TEMPLATES) {
        expect(t.version).toBeGreaterThanOrEqual(1)
      }
    })

    it('每个模板有非空 name 和 description', () => {
      for (const t of BI_BUILTIN_TEMPLATES) {
        expect(t.name.length).toBeGreaterThan(0)
        expect(t.description.length).toBeGreaterThan(0)
      }
    })

    it('每个模板有至少一个数据源键', () => {
      for (const t of BI_BUILTIN_TEMPLATES) {
        expect(t.composition.dataSourceKeys.length).toBeGreaterThan(0)
      }
    })

    it('每个模板有至少一个指标键', () => {
      for (const t of BI_BUILTIN_TEMPLATES) {
        expect(t.composition.metricKeys.length).toBeGreaterThan(0)
      }
    })

    it('每个模板有至少一个图表组件', () => {
      for (const t of BI_BUILTIN_TEMPLATES) {
        expect(t.composition.charts.length).toBeGreaterThan(0)
      }
    })
  })

  describe('数据源键/指标键/维度键引用校验', () => {
    it('所有模板引用的数据源键在 BI_DATASOURCE_KEYS 中存在', () => {
      const validKeys = new Set(BI_DATASOURCE_KEY_VALUES)
      for (const t of BI_BUILTIN_TEMPLATES) {
        for (const dsKey of t.composition.dataSourceKeys) {
          expect(validKeys.has(dsKey), `模板 ${t.templateId} 引用的数据源键 ${dsKey} 不存在`).toBe(
            true,
          )
        }
      }
    })

    it('所有模板引用的指标键在 BI_TEMPLATE_METRIC_KEY_VALUES 中存在', () => {
      const validKeys = new Set(BI_TEMPLATE_METRIC_KEY_VALUES)
      for (const t of BI_BUILTIN_TEMPLATES) {
        for (const mk of t.composition.metricKeys) {
          expect(validKeys.has(mk), `模板 ${t.templateId} 引用的指标键 ${mk} 不存在`).toBe(true)
        }
      }
    })

    it('所有模板引用的维度键在 BI_TEMPLATE_DIMENSION_KEY_VALUES 中存在', () => {
      const validKeys = new Set(BI_TEMPLATE_DIMENSION_KEY_VALUES)
      for (const t of BI_BUILTIN_TEMPLATES) {
        for (const dk of t.composition.dimensionKeys) {
          expect(validKeys.has(dk), `模板 ${t.templateId} 引用的维度键 ${dk} 不存在`).toBe(true)
        }
      }
    })

    it('所有图表组件引用的指标键存在', () => {
      const validKeys = new Set(BI_TEMPLATE_METRIC_KEY_VALUES)
      for (const t of BI_BUILTIN_TEMPLATES) {
        for (const chart of t.composition.charts) {
          for (const mk of chart.metricKeys) {
            expect(
              validKeys.has(mk),
              `模板 ${t.templateId} 图表 "${chart.title}" 引用的指标键 ${mk} 不存在`,
            ).toBe(true)
          }
        }
      }
    })

    it('所有图表组件引用的维度键存在', () => {
      const validKeys = new Set(BI_TEMPLATE_DIMENSION_KEY_VALUES)
      for (const t of BI_BUILTIN_TEMPLATES) {
        for (const chart of t.composition.charts) {
          expect(
            validKeys.has(chart.dimensionKey),
            `模板 ${t.templateId} 图表 "${chart.title}" 引用的维度键 ${chart.dimensionKey} 不存在`,
          ).toBe(true)
        }
      }
    })
  })

  describe('拒绝非声明式内容', () => {
    it('模板定义不包含 SQL 片段', () => {
      const json = JSON.stringify(BI_BUILTIN_TEMPLATES)
      expect(json).not.toContain('SELECT ')
      expect(json).not.toContain('INSERT ')
      expect(json).not.toContain('UPDATE ')
      expect(json).not.toContain('DELETE ')
      expect(json).not.toContain('DROP ')
    })

    it('模板定义不包含脚本或公式', () => {
      const json = JSON.stringify(BI_BUILTIN_TEMPLATES)
      expect(json).not.toContain('eval(')
      expect(json).not.toContain('Function(')
      expect(json).not.toContain('<script')
      expect(json).not.toContain('=>')
    })

    it('模板定义不包含外部 URL', () => {
      const json = JSON.stringify(BI_BUILTIN_TEMPLATES)
      expect(json).not.toContain('http://')
      expect(json).not.toContain('https://')
    })

    it('模板定义不包含 prompt 关键字', () => {
      const json = JSON.stringify(BI_BUILTIN_TEMPLATES)
      expect(json).not.toContain('"prompt"')
      expect(json).not.toContain('"modelOutput"')
    })
  })

  describe('模板查找', () => {
    it('isBuiltinBiTemplate 正确识别内置模板', () => {
      for (const t of BI_BUILTIN_TEMPLATES) {
        expect(isBuiltinBiTemplate(t.templateId)).toBe(true)
      }
      expect(isBuiltinBiTemplate('nonexistent')).toBe(false)
    })

    it('getBuiltinBiTemplate 按 ID 查找', () => {
      const t = getBuiltinBiTemplate('project_execution_overview')
      expect(t).toBeDefined()
      expect(t!.name).toBe('项目执行概览')
    })

    it('getBuiltinBiTemplatesByCategory 按分类筛选', () => {
      const exec = getBuiltinBiTemplatesByCategory(BI_TEMPLATE_CATEGORIES.EXECUTION)
      expect(exec.length).toBe(1)
      expect(exec[0].templateId).toBe('project_execution_overview')

      const resource = getBuiltinBiTemplatesByCategory(BI_TEMPLATE_CATEGORIES.RESOURCE)
      expect(resource.length).toBe(1)
      expect(resource[0].templateId).toBe('resource_utilization')
    })

    it('getBuiltinBiTemplatesByScenario 按场景筛选', () => {
      const weekly = getBuiltinBiTemplatesByScenario(BI_TEMPLATE_SCENARIOS.WEEKLY_REVIEW)
      expect(weekly.length).toBe(1)

      const perf = getBuiltinBiTemplatesByScenario(BI_TEMPLATE_SCENARIOS.PERFORMANCE_REVIEW)
      expect(perf.length).toBe(1)
      expect(perf[0].templateId).toBe('team_performance')
    })

    it('getBuiltinBiTemplateVersion 返回正确版本', () => {
      const v = getBuiltinBiTemplateVersion('project_execution_overview')
      expect(v).toBe(1)
    })

    it('getBuiltinBiTemplateVersion 对不存在模板返回 0', () => {
      const v = getBuiltinBiTemplateVersion('nonexistent' as any)
      expect(v).toBe(0)
    })
  })

  describe('团队绩效模板个人级权限', () => {
    it('team_performance 模板标记 personDimensionRequiresExtraPermission = true', () => {
      const t = getBuiltinBiTemplate('team_performance')
      expect(t).toBeDefined()
      expect(t!.personDimensionRequiresExtraPermission).toBe(true)
    })

    it('其他模板不需要额外个人级权限', () => {
      for (const t of BI_BUILTIN_TEMPLATES) {
        if (t.templateId === 'team_performance') continue
        expect(t.personDimensionRequiresExtraPermission).toBe(false)
      }
    })
  })

  describe('模板覆盖所有分类和场景', () => {
    it('5 个分类各有对应模板', () => {
      const categories = Object.values(BI_TEMPLATE_CATEGORIES)
      const covered = new Set(BI_BUILTIN_TEMPLATES.map((t) => t.category))
      expect(covered.size).toBe(5)
      for (const cat of categories) {
        expect(covered.has(cat), `分类 ${cat} 无模板覆盖`).toBe(true)
      }
    })

    it('5 个场景各有对应模板', () => {
      const scenarios = Object.values(BI_TEMPLATE_SCENARIOS)
      const covered = new Set(BI_BUILTIN_TEMPLATES.map((t) => t.scenario))
      expect(covered.size).toBe(5)
      for (const scenario of scenarios) {
        expect(covered.has(scenario), `场景 ${scenario} 无模板覆盖`).toBe(true)
      }
    })
  })
})
