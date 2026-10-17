/**
 * v3-bi-custom-report-builder §2.5 —— registry/validator/planner 单元测试
 */
import { test } from '@japa/runner'
import {
  BiCustomReportDataSourceRegistry,
  normalizeDefinition,
  normalizeFields,
  normalizeDataSources,
  normalizeFilters,
  checkForbiddenPayloadFields,
  checkComplexity,
  validateDefinitionAgainstRegistry,
  planPreview,
} from '#services/bi_custom_report/index'

import {
  BI_CUSTOM_REPORT_DATA_SOURCE_KEYS,
  BI_CUSTOM_REPORT_WARNING_CODES,
  BI_CUSTOM_REPORT_LIMITS,
} from '@aiproj/types'

test.group('BiCustomReportDataSourceRegistry', () => {
  test('listAll 返回所有内置数据源', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    const all = registry.listAll()
    assert.isTrue(all.length >= 7)
    assert.isTrue(all.some((ds) => ds.sourceKey === BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.TASK_SUMMARY))
    assert.isTrue(
      all.some((ds) => ds.sourceKey === BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.PMO_PORTFOLIO),
    )
  })

  test('listForPermissions 按权限过滤', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    const riskOnly = registry.listForPermissions(new Set(['risk:view']))
    assert.isTrue(riskOnly.length > 0)
    for (const ds of riskOnly) {
      assert.isTrue(ds.permissionTags.some((tag) => ['risk:view'].includes(tag)))
    }
  })

  test('listForPermissions 空权限返回空', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    const empty = registry.listForPermissions(new Set())
    assert.lengthOf(empty, 0)
  })

  test('get 返回正确数据源', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    const ds = registry.get(BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.TASK_SUMMARY)
    assert.isDefined(ds)
    assert.equal(ds!.name, '任务概要')
  })

  test('get 未注册 key 返回 undefined', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    assert.isUndefined(registry.get('nonexistent' as any))
  })

  test('isValidSourceKey 白名单校验', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    assert.isTrue(registry.isValidSourceKey('task_summary'))
    assert.isFalse(registry.isValidSourceKey('sql_query'))
    assert.isFalse(registry.isValidSourceKey(''))
  })

  test('isFieldInSource 字段归属校验', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    assert.isTrue(
      registry.isFieldInSource('task_count', BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.TASK_SUMMARY),
    )
    assert.isFalse(
      registry.isFieldInSource('nonexistent_field', BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.TASK_SUMMARY),
    )
  })

  test('isVisualizationCompatible 可视化兼容性', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    assert.isTrue(
      registry.isVisualizationCompatible('table', BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.TASK_SUMMARY),
    )
    assert.isTrue(
      registry.isVisualizationCompatible('line', BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.BI_TREND_SERIES),
    )
  })

  test('isBlocking 返回 fallback 行为', ({ assert }) => {
    const registry = new BiCustomReportDataSourceRegistry()
    assert.isTrue(registry.isBlocking(BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.TASK_SUMMARY))
    assert.isFalse(registry.isBlocking(BI_CUSTOM_REPORT_DATA_SOURCE_KEYS.RISK_SUMMARY))
  })
})

test.group('Definition Normalizer', () => {
  test('normalizeFields 去重排序', ({ assert }) => {
    assert.deepEqual(
      normalizeFields(['task_count', 'risk_level', 'task_count', '', '  project_name ']),
      ['project_name', 'risk_level', 'task_count'],
    )
  })

  test('normalizeDataSources 去重排序', ({ assert }) => {
    const result = normalizeDataSources([
      { sourceKey: 'risk_summary' },
      { sourceKey: 'task_summary' },
      { sourceKey: 'risk_summary' },
    ])
    assert.equal(result[0].sourceKey, 'risk_summary')
    assert.equal(result[1].sourceKey, 'task_summary')
    assert.lengthOf(result, 2)
  })

  test('normalizeFilters 去重', ({ assert }) => {
    const result = normalizeFilters([
      { fieldKey: 'task_count', operator: 'gt' as const, value: 5 },
      { fieldKey: 'task_count', operator: 'gt' as const, value: 10 },
      { fieldKey: 'risk_level', operator: 'eq' as const, value: '高' },
    ])
    assert.lengthOf(result, 2)
  })

  test('normalizeDefinition 产生稳定 hash', ({ assert }) => {
    const def = {
      dataSources: [{ sourceKey: 'task_summary' }, { sourceKey: 'risk_summary' }],
      fields: ['task_count', 'risk_level'],
      filters: [{ fieldKey: 'task_count', operator: 'gt' as const, value: 5 }],
      groups: [{ fieldKey: 'project_name' }],
      sorts: [{ fieldKey: 'task_count', direction: 'desc' as const }],
      visualizations: [{ type: 'table' as const }],
    }
    const r1 = normalizeDefinition(def)
    const r2 = normalizeDefinition(def)
    assert.equal(r1.definitionHash, r2.definitionHash)
    assert.match(r1.definitionHash, /^bh_/)
  })
})

test.group('Definition Validator', () => {
  test('checkForbiddenPayloadFields 拒绝 SQL', ({ assert }) => {
    const violations = checkForbiddenPayloadFields({
      fields: ['task_count'],
      sql: 'SELECT * FROM tasks',
    })
    assert.isTrue(violations.some((v) => v.includes('sql')))
  })

  test('checkForbiddenPayloadFields 拒绝 script', ({ assert }) => {
    const violations = checkForbiddenPayloadFields({
      fields: ['task_count'],
      script: 'javascript:alert(1)',
    })
    assert.isTrue(violations.some((v) => v.includes('script')))
  })

  test('checkForbiddenPayloadFields 拒绝 prompt', ({ assert }) => {
    const violations = checkForbiddenPayloadFields({
      fields: ['task_count'],
      prompt: 'generate report',
    })
    assert.isTrue(violations.some((v) => v.includes('prompt')))
  })

  test('checkForbiddenPayloadFields 拒绝 modelOutput', ({ assert }) => {
    const violations = checkForbiddenPayloadFields({ modelOutput: 'AI result' })
    assert.isTrue(violations.some((v) => v.includes('modelOutput')))
  })

  test('checkForbiddenPayloadFields 拒绝 secret/token', ({ assert }) => {
    const violations = checkForbiddenPayloadFields({ secret: 'xyz', token: 'abc' })
    assert.isTrue(violations.some((v) => v.includes('secret')))
    assert.isTrue(violations.some((v) => v.includes('token')))
  })

  test('checkForbiddenPayloadFields 拒绝非法 fieldKey 格式', ({ assert }) => {
    const violations = checkForbiddenPayloadFields({
      fields: ['task_count', 'DROP TABLE;--', 'okr_progress_pct'],
    })
    assert.isTrue(violations.some((v) => v.includes('DROP TABLE')))
  })

  test('checkForbiddenPayloadFields 合法 payload 无违规', ({ assert }) => {
    const violations = checkForbiddenPayloadFields({
      fields: ['task_count', 'risk_level', 'project_name'],
      dataSources: [{ sourceKey: 'task_summary' }],
    })
    assert.lengthOf(violations, 0)
  })

  test('checkComplexity 数据源超限', ({ assert }) => {
    const result = checkComplexity({
      dataSources: Array.from({ length: 10 }, (_, i) => ({ sourceKey: `ds${i}` })),
    })
    assert.isFalse(result.valid)
    assert.isTrue(result.violations.some((v) => v.includes('数据源数量')))
  })

  test('checkComplexity 字段超限', ({ assert }) => {
    const result = checkComplexity({
      fields: Array.from({ length: 50 }, (_, i) => `field_${i}`),
    })
    assert.isFalse(result.valid)
    assert.isTrue(result.violations.some((v) => v.includes('字段数量')))
  })

  test('checkComplexity payload 大小超限', ({ assert }) => {
    const longString = 'x'.repeat(BI_CUSTOM_REPORT_LIMITS.MAX_PAYLOAD_BYTES)
    const result = checkComplexity({
      title: longString,
    })
    assert.isFalse(result.valid)
    assert.isTrue(result.violations.some((v) => v.includes('payload 大小')))
  })

  test('checkComplexity 合法 payload 通过', ({ assert }) => {
    const result = checkComplexity({
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: ['task_count'],
      title: '我的报表',
    })
    assert.isTrue(result.valid)
  })

  test('validateDefinitionAgainstRegistry 未注册数据源 blocking', ({ assert }) => {
    const result = validateDefinitionAgainstRegistry({
      dataSources: [{ sourceKey: 'unknown_source' }],
      fields: ['task_count'],
    })
    assert.isFalse(result.valid)
    assert.isTrue(
      result.blockingWarnings.some(
        (w) => w.code === BI_CUSTOM_REPORT_WARNING_CODES.REQUIRED_DATASOURCE_UNAVAILABLE,
      ),
    )
  })

  test('validateDefinitionAgainstRegistry 未注册字段 warning', ({ assert }) => {
    const result = validateDefinitionAgainstRegistry({
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: ['nonexistent_field'],
    })
    assert.isTrue(
      result.warnings.some((w) => w.code === BI_CUSTOM_REPORT_WARNING_CODES.FIELD_FORBIDDEN),
    )
  })

  test('validateDefinitionAgainstRegistry 合法定义通过', ({ assert }) => {
    const result = validateDefinitionAgainstRegistry({
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: ['task_count', 'project_name'],
      filters: [{ fieldKey: 'task_count', operator: 'gt', value: 5 }],
      groups: [{ fieldKey: 'project_name' }],
      sorts: [{ fieldKey: 'task_count', direction: 'desc' }],
      visualizations: [{ type: 'table' }],
    })
    assert.isTrue(result.valid)
    assert.lengthOf(result.blockingWarnings, 0)
  })
})

test.group('Preview Planner', () => {
  test('planPreview 合法输入 planValid', ({ assert }) => {
    const plan = planPreview({
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: ['task_count', 'project_name'],
      filters: [],
      groups: [{ fieldKey: 'project_name' }],
      sorts: [{ fieldKey: 'task_count', direction: 'desc' }],
      visualizations: [{ type: 'table' }],
    })
    assert.isTrue(plan.planValid)
    assert.include(plan.resolvedSourceKeys, 'task_summary')
  })

  test('planPreview 无字段 blocking', ({ assert }) => {
    const plan = planPreview({
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: [],
      filters: [],
      groups: [],
      sorts: [],
      visualizations: [],
    })
    assert.isFalse(plan.planValid)
    assert.isTrue(
      plan.blockingWarnings.some((w) => w.code === BI_CUSTOM_REPORT_WARNING_CODES.FIELD_FORBIDDEN),
    )
  })

  test('planPreview 字段不在数据源中 warning', ({ assert }) => {
    const plan = planPreview({
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: ['risk_level'],
      filters: [],
      groups: [],
      sorts: [],
      visualizations: [{ type: 'table' }],
    })
    assert.isTrue(
      plan.nonBlockingWarnings.some(
        (w) => w.code === BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
      ),
    )
  })

  test('planPreview 筛选字段不在选中列表 warning', ({ assert }) => {
    const plan = planPreview({
      dataSources: [{ sourceKey: 'task_summary' }],
      fields: ['task_count'],
      filters: [{ fieldKey: 'risk_level', operator: 'eq', value: '高' }],
      groups: [],
      sorts: [],
      visualizations: [{ type: 'table' }],
    })
    assert.isTrue(
      plan.nonBlockingWarnings.some(
        (w) => w.code === BI_CUSTOM_REPORT_WARNING_CODES.FIELD_INCOMPATIBLE,
      ),
    )
  })
})
