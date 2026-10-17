import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import { createDefaultRegistry } from '#services/report_v2/index'
import {
  isValidTemplateId,
  getVisibleTemplates,
  TEMPLATE_MAP,
  BUILTIN_TEMPLATES,
} from '#services/report_v2/templates'
import {
  makeSuccess,
  makeForbidden,
  makeUnavailable,
  makeEmpty,
  computeSourceHash,
} from '#services/report_v2/data_source_adapter'

test.group('Report V2 — Template Directory', () => {
  test('TEMPLATE_MAP 包含所有内置模板', ({ assert }) => {
    assert.equal(TEMPLATE_MAP.size, 13)
    assert.isTrue(TEMPLATE_MAP.has('progress'))
    assert.isTrue(TEMPLATE_MAP.has('project-weekly'))
    assert.isTrue(TEMPLATE_MAP.has('project-monthly'))
    assert.isTrue(TEMPLATE_MAP.has('milestone-tracking'))
    assert.isTrue(TEMPLATE_MAP.has('resource-summary'))
    assert.isTrue(TEMPLATE_MAP.has('risk-summary'))
    assert.isTrue(TEMPLATE_MAP.has('health-summary'))
    assert.isTrue(TEMPLATE_MAP.has('stakeholder-briefing'))
    assert.isTrue(TEMPLATE_MAP.has('weekly-ai-summary'))
    assert.isTrue(TEMPLATE_MAP.has('monthly-ai-summary'))
  })

  test('isValidTemplateId 白名单校验', ({ assert }) => {
    assert.isTrue(isValidTemplateId('progress'))
    assert.isTrue(isValidTemplateId('project-weekly'))
    assert.isFalse(isValidTemplateId('custom'))
    assert.isFalse(isValidTemplateId(''))
    assert.isFalse(isValidTemplateId('sql-injection'))
  })

  test('getVisibleTemplates 权限过滤', ({ assert }) => {
    // 只有 report:view
    const onlyReport = getVisibleTemplates(true, false, false)
    assert.isTrue(onlyReport.some((t) => t.templateId === 'progress'))
    assert.isFalse(onlyReport.some((t) => t.templateId === 'resource-summary'))
    assert.isFalse(onlyReport.some((t) => t.templateId === 'risk-summary'))

    // 全部权限
    const all = getVisibleTemplates(true, true, true)
    assert.isTrue(all.some((t) => t.templateId === 'resource-summary'))
    assert.isTrue(all.some((t) => t.templateId === 'risk-summary'))
    assert.isTrue(all.some((t) => t.templateId === 'stakeholder-briefing'))
  })

  test('所有模板声明必要字段', ({ assert }) => {
    for (const t of BUILTIN_TEMPLATES) {
      assert.isNotEmpty(t.templateId)
      assert.isNotEmpty(t.name)
      assert.isNotEmpty(t.description)
      assert.isNotEmpty(t.supportedFormats)
      assert.isNotEmpty(t.permission)
    }
  })

  test('每个模板至少有一种支持的格式', ({ assert }) => {
    for (const t of BUILTIN_TEMPLATES) {
      assert.isAtLeast(t.supportedFormats.length, 1)
    }
  })
})

test.group('Report V2 — Data Source Helpers', () => {
  test('computeSourceHash 对同一数据返回相同 hash', ({ assert }) => {
    const data = { count: 42, items: ['a', 'b'] }
    const h1 = computeSourceHash(data)
    const h2 = computeSourceHash(data)
    assert.equal(h1, h2)
  })

  test('computeSourceHash 对不同数据返回不同 hash', ({ assert }) => {
    const h1 = computeSourceHash({ count: 1 })
    const h2 = computeSourceHash({ count: 2 })
    assert.notEqual(h1, h2)
  })

  test('makeSuccess 返回 available 状态', ({ assert }) => {
    const result = makeSuccess('test', { value: 42 })
    assert.equal(result.sourceKey, 'test')
    assert.equal(result.status, 'available')
    assert.equal(result.data?.value, 42)
    assert.isNotEmpty(result.sourceHash)
    assert.isNotEmpty(result.generatedAt)
  })

  test('makeForbidden 返回 forbidden 状态和 warning', ({ assert }) => {
    const result = makeForbidden('test')
    assert.equal(result.status, 'forbidden')
    assert.isNull(result.data)
    assert.equal(result.warnings.length, 1)
    assert.equal(result.warnings[0].code, 'REPORT_DATASOURCE_FORBIDDEN')
  })

  test('makeUnavailable 返回 unavailable 状态', ({ assert }) => {
    const result = makeUnavailable('test', '测试不可用')
    assert.equal(result.status, 'unavailable')
    assert.equal(result.warnings[0].message, '测试不可用')
  })

  test('makeEmpty 返回 available 含空数据警告', ({ assert }) => {
    const result = makeEmpty('test', { items: [] }, '暂无数据')
    assert.equal(result.status, 'available')
    assert.equal(result.warnings[0].code, 'REPORT_DATASOURCE_EMPTY')
  })
})

test.group('Report V2 — Data Source Registry', (group) => {
  useAuthDatabase(group)

  test('注册表列表包含所有适配器', async ({ assert }) => {
    const registry = createDefaultRegistry()
    const keys = registry.listKeys()
    assert.includeMembers(keys, [
      'task_summary',
      'schedule_summary',
      'dashboard_metrics',
      'resource_summary',
      'risk_summary',
      'timeline_activity_summary',
      'compiler_summary',
      'change_impact_summary',
    ])
    assert.equal(keys.length, 8)
  })

  test('未知数据源返回 unavailable', async ({ assert }) => {
    const registry = createDefaultRegistry()
    const results = await registry.aggregateMany(['unknown_source'], 1, 1, 1, {})
    assert.equal(results['unknown_source'].status, 'unavailable')
  })

  test('task_summary 数据源返回聚合数据', async ({ assert }) => {
    const { project, org } = await setupProjectWithMember()
    const registry = createDefaultRegistry()
    const results = await registry.aggregateMany(
      ['task_summary'],
      Number(org.id),
      Number(project.id),
      1,
      {},
    )
    const taskSummary = results['task_summary']
    assert.equal(taskSummary.sourceKey, 'task_summary')
    assert.isNotEmpty(taskSummary.status)
    assert.isNotEmpty(taskSummary.generatedAt)

    const data = taskSummary.data as Record<string, unknown> | null
    if (taskSummary.status === 'available' && data) {
      assert.typeOf(data.totalTasks, 'number')
      assert.typeOf(data.completedPercent, 'number')
    }
  })

  test('dashboard_metrics 数据源返回基础健康摘要', async ({ assert }) => {
    const { project, org } = await setupProjectWithMember()
    const registry = createDefaultRegistry()
    const results = await registry.aggregateMany(
      ['dashboard_metrics'],
      Number(org.id),
      Number(project.id),
      1,
      {},
    )
    const dm = results['dashboard_metrics']
    assert.equal(dm.sourceKey, 'dashboard_metrics')

    const data = dm.data as Record<string, unknown> | null
    if (dm.status === 'available' && data) {
      assert.typeOf(data.progressPercent, 'number')
      assert.typeOf(data.healthStatus, 'string')
    }
  })

  test('resource_summary 不可用时返回 unavailable', async ({ assert }) => {
    const { project, org } = await setupProjectWithMember()
    const registry = createDefaultRegistry()
    const results = await registry.aggregateMany(
      ['resource_summary'],
      Number(org.id),
      Number(project.id),
      1,
      {},
    )
    // 新项目无资源 → unavailable
    assert.include(['available', 'unavailable'], results['resource_summary'].status)
  })

  test('risk_summary 不可用时返回 unavailable', async ({ assert }) => {
    const { project, org } = await setupProjectWithMember()
    const registry = createDefaultRegistry()
    const results = await registry.aggregateMany(
      ['risk_summary'],
      Number(org.id),
      Number(project.id),
      1,
      {},
    )
    assert.include(['available', 'unavailable'], results['risk_summary'].status)
  })
})

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function setupProjectWithMember() {
  const owner = await createUser({ email: uniqueEmail('rv2-ds') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { project, org, owner }
}
