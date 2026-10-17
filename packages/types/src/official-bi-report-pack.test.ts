import { describe, it, expect } from 'vitest'
import {
  OFFICIAL_BI_REPORT_PACK_PAYLOAD,
  OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
  OFFICIAL_BI_REPORT_PACK_VERSION,
  PLUGIN_SEAM_TEMPLATE_PACK,
  normalizeTemplatePackPayload,
  templatePackStableSerialize,
  computeTemplatePackDigest,
  validateTemplatePackPayload,
} from './plugin-template-pack.js'
import { BI_DATASOURCE_KEY_VALUES, BI_TEMPLATE_ID_VALUES } from './bi-report-template-library.js'

describe('official BI report pack 官方包契约与负载校验', () => {
  it('官方包常量稳定：pluginId 与 version', () => {
    expect(OFFICIAL_BI_REPORT_PACK_PLUGIN_ID).toBe('com.aiproj.official.bi-report-pack')
    expect(OFFICIAL_BI_REPORT_PACK_VERSION).toBe('1.0.0')
    expect(OFFICIAL_BI_REPORT_PACK_PAYLOAD.domain).toBe('bi-report-template')
    expect(OFFICIAL_BI_REPORT_PACK_PAYLOAD.version).toBe('1.0.0')
  })

  it('官方包包含 5 个模板：报表/热力图/趋势/资源/绩效齐全', () => {
    expect(OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates).toHaveLength(5)
    const ids = OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates.map((t) => t.templateId)
    expect(ids).toContain('ptpl_official_exec_governance')
    expect(ids).toContain('ptpl_official_risk_heatmap_matrix')
    expect(ids).toContain('ptpl_official_trend_velocity')
    expect(ids).toContain('ptpl_official_resource_health')
    expect(ids).toContain('ptpl_official_team_perf_trend')
    // 所有 id 保持 ptpl_ 前缀且唯一
    expect(new Set(ids).size).toBe(5)
    for (const id of ids) expect(id.startsWith('ptpl_')).toBe(true)
  })

  it('官方包校验通过且 digest 稳定', () => {
    const res = validateTemplatePackPayload(OFFICIAL_BI_REPORT_PACK_PAYLOAD, {
      knownDataSourceKeys: BI_DATASOURCE_KEY_VALUES,
      knownBuiltinTemplateIds: BI_TEMPLATE_ID_VALUES,
    })
    expect(res.valid).toBe(true)
    expect(res.findings.filter((f) => f.severity === 'blocking')).toHaveLength(0)
    expect(res.normalizedPayload).toBeDefined()
    // digest 两次一致
    const d1 = computeTemplatePackDigest(OFFICIAL_BI_REPORT_PACK_PAYLOAD)
    const d2 = computeTemplatePackDigest(OFFICIAL_BI_REPORT_PACK_PAYLOAD)
    expect(d1).toBe(d2)
    expect(d1.length).toBe(8)
    // 归一化后模板按 id 排序稳定
    const norm = normalizeTemplatePackPayload(OFFICIAL_BI_REPORT_PACK_PAYLOAD)
    const sorted = [...OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates].map((t) => t.templateId).sort()
    expect(norm.templates.map((t) => t.templateId)).toEqual(sorted)
    // 序列化体积不超限
    expect(templatePackStableSerialize(OFFICIAL_BI_REPORT_PACK_PAYLOAD).length).toBeLessThan(65536)
  })

  it('官方包所有数据源键均在宿主 allowlist 内', () => {
    const allowed = new Set(BI_DATASOURCE_KEY_VALUES as readonly string[])
    for (const t of OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates) {
      for (const ds of t.composition.dataSourceKeys) {
        expect(allowed.has(ds)).toBe(true)
      }
    }
  })

  it('官方包覆盖三类只读模板且均为声明式（无 SQL/外部 URL）', () => {
    const categories = OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates.map((t) => t.category)
    expect(categories).toContain('execution')
    expect(categories).toContain('risk')
    expect(categories).toContain('resource')
    expect(categories).toContain('people')
    // 风险热力图模板使用 bi_risk_heatmap
    const heatmapTpl = OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates.find(
      (t) => t.templateId === 'ptpl_official_risk_heatmap_matrix',
    )!
    expect(heatmapTpl.composition.dataSourceKeys).toContain('bi_risk_heatmap')
    expect(heatmapTpl.composition.charts.some((c) => c.chartType === 'heatmap')).toBe(true)
    // 趋势模板使用 bi_trend_analysis
    const trendTpl = OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates.find(
      (t) => t.templateId === 'ptpl_official_trend_velocity',
    )!
    expect(trendTpl.composition.dataSourceKeys).toContain('bi_trend_analysis')
    expect(trendTpl.composition.charts.some((c) => c.chartType === 'line')).toBe(true)
  })

  it('人物维度模板要求额外权限位', () => {
    const withPerson = OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates.filter((t) =>
      t.composition.dimensionKeys.includes('person' as any),
    )
    expect(withPerson.length).toBeGreaterThan(0)
    const teamPerf = OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates.find(
      (t) => t.templateId === 'ptpl_official_team_perf_trend',
    )!
    expect(teamPerf.personDimensionRequiresExtraPermission).toBe(true)
    expect(teamPerf.composition.dimensionKeys).toContain('person')
  })

  it('未知数据源校验产生 blocking finding', () => {
    const bad = {
      ...OFFICIAL_BI_REPORT_PACK_PAYLOAD,
      templates: [
        {
          ...OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates[0]!,
          composition: {
            ...OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates[0]!.composition,
            dataSourceKeys: ['non_existent_ds' as any],
          },
        },
      ],
    }
    const res = validateTemplatePackPayload(bad, { knownDataSourceKeys: BI_DATASOURCE_KEY_VALUES })
    expect(res.valid).toBe(false)
    expect(
      res.findings.some((f) => f.code === 'plugin-template-pack-dangling-datasource-key'),
    ).toBe(true)
  })

  it('与内置模板 id 冲突产生 blocking finding', () => {
    const bad = {
      ...OFFICIAL_BI_REPORT_PACK_PAYLOAD,
      templates: [
        {
          ...OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates[0]!,
          templateId: 'project_execution_overview' as any,
        },
      ],
    }
    const res = validateTemplatePackPayload(bad, {
      knownBuiltinTemplateIds: BI_TEMPLATE_ID_VALUES,
    })
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-template-pack-id-conflict-builtin')).toBe(
      true,
    )
  })

  it('包含可执行内容（SQL/外部 URL）产生 blocking finding', () => {
    const bad = {
      ...OFFICIAL_BI_REPORT_PACK_PAYLOAD,
      templates: [
        {
          ...OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates[0]!,
          name: 'SELECT * FROM users WHERE 1=1' as any,
        },
      ],
    }
    const res = validateTemplatePackPayload(bad)
    expect(res.valid).toBe(false)
    expect(
      res.findings.some((f) => f.code === 'plugin-template-pack-sensitive-content-detected'),
    ).toBe(true)
  })

  it('接缝 key 常量与 payload domain 封闭', () => {
    expect(PLUGIN_SEAM_TEMPLATE_PACK).toBe('template-pack.content-bundle')
    // domain 仅允许 bi-report-template（官方包不带 project seed）
    expect(OFFICIAL_BI_REPORT_PACK_PAYLOAD.domain).toBe('bi-report-template')
  })
})
