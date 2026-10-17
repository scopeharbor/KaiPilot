import CustomView from '#models/custom_view'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import type { CustomViewBaseType, CustomViewConfig } from '@aiproj/types'

test.group('CustomView Model — schema & 字段', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('cv-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  function validConfig(baseViewType: CustomViewBaseType): CustomViewConfig {
    const common = {
      schemaVersion: 1,
      filters: { search: 'test', statuses: ['in_progress'] },
      sort: [{ field: 'name', direction: 'asc' as const }],
    }
    switch (baseViewType) {
      case 'kanban':
        return {
          ...common,
          baseViewType,
          display: { columnDisplay: { todo: { collapsed: false } } },
          scope: {},
          state: { columnPage: { todo: 1 } },
        }
      case 'list':
        return {
          ...common,
          baseViewType,
          display: { columns: ['name', 'status', 'priority'], density: 'comfortable' },
          scope: {},
          state: { scrollPosition: { top: 0, left: 0 } },
        }
      case 'calendar':
        return {
          ...common,
          baseViewType,
          display: { mode: 'month' },
          scope: {
            anchorDate: '2026-07-01',
            timeRange: { start: '2026-07-01', end: '2026-07-31' },
          },
          state: {},
        }
      case 'gantt':
        return {
          ...common,
          baseViewType,
          display: { showDependencies: true, showCriticalPath: true, showWeekends: false },
          scope: { expandedNodes: [1, 2], timeRange: { start: '2026-07-01', end: '2026-08-31' } },
          state: {},
        }
      case 'wbs':
        return {
          ...common,
          baseViewType,
          display: { showFields: ['name', 'status'] },
          scope: { expandedNodes: [1] },
          state: {},
        }
      case 'resource':
        return {
          ...common,
          baseViewType,
          filters: {
            roles: ['member'],
            skills: ['React'],
            loadStatuses: ['available'],
            dateFrom: '2026-07-01',
            dateTo: '2026-07-31',
          },
          display: { resourceViewMode: 'matrix', density: 'comfortable' },
          scope: { timeRange: { start: '2026-07-01', end: '2026-07-31' } },
          state: {},
        }
    }
  }

  // ------------------------------------------------------------------
  // 创建与基本字段
  // ------------------------------------------------------------------

  test('CustomView 创建与读取基本字段', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const config = validConfig('kanban')

    const cv = await CustomView.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      ownerUserId: Number(owner.id),
      name: '我的看板视图',
      baseViewType: 'kanban',
      visibility: 'personal',
      configJson: config,
      schemaVersion: 1,
      position: 0,
      isDefault: false,
    })

    const loaded = await CustomView.findOrFail(cv.id)
    assert.equal(loaded.name, '我的看板视图')
    assert.equal(loaded.baseViewType, 'kanban')
    assert.equal(loaded.visibility, 'personal')
    assert.equal(loaded.schemaVersion, 1)
    assert.equal(loaded.position, 0)
    assert.isFalse(loaded.isDefault)
    assert.equal(loaded.ownerUserId, Number(owner.id))
    assert.equal(loaded.projectId, Number(project.id))
    assert.equal(loaded.organizationId, Number(org.id))
  })

  test('CustomView JSON 列 (configJson) 写入回读为对象', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const config = validConfig('list')

    const cv = await CustomView.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      ownerUserId: Number(owner.id),
      name: '列表视图配置',
      baseViewType: 'list',
      visibility: 'personal',
      configJson: config,
      schemaVersion: 1,
      position: 1,
      isDefault: false,
    })

    const loaded = await CustomView.findOrFail(cv.id)
    assert.deepEqual(loaded.configJson, config)
    assert.equal(loaded.configJson.baseViewType, 'list')
    assert.equal(loaded.configJson.schemaVersion, 1)
    assert.deepEqual(loaded.configJson.display, config.display)
    assert.deepEqual(loaded.configJson.sort, config.sort)
  })

  test('CustomView timestamp 字段正确', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const { DateTime } = await import('luxon')

    const cv = await CustomView.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      ownerUserId: Number(owner.id),
      name: '时间戳测试',
      baseViewType: 'gantt',
      visibility: 'personal',
      configJson: validConfig('gantt'),
      schemaVersion: 1,
      position: 2,
      isDefault: false,
    })

    assert.isTrue(DateTime.isDateTime(cv.createdAt))
    assert.isTrue(cv.updatedAt === null || DateTime.isDateTime(cv.updatedAt))
    assert.isNull(cv.deletedAt ?? null)
  })

  // ------------------------------------------------------------------
  // 各视图类型配置
  // ------------------------------------------------------------------

  const VIEW_TYPES = ['kanban', 'list', 'calendar', 'gantt', 'wbs', 'resource'] as const
  for (const viewType of VIEW_TYPES) {
    test(`CustomView ${viewType} 配置写入与回读一致`, async ({ assert }) => {
      const { project, org, owner } = await setupProject()
      const config = validConfig(viewType)

      const cv = await CustomView.create({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        ownerUserId: Number(owner.id),
        name: `${viewType} 视图`,
        baseViewType: viewType,
        visibility: 'personal',
        configJson: config,
        schemaVersion: 1,
        position: 0,
        isDefault: false,
      })

      const loaded = await CustomView.findOrFail(cv.id)
      assert.equal(loaded.baseViewType, viewType)
      assert.deepEqual(loaded.configJson.filters, config.filters)
      assert.deepEqual(loaded.configJson.sort, config.sort)
    })
  }

  // ------------------------------------------------------------------
  // 软删除
  // ------------------------------------------------------------------

  test('CustomView 软删除：find 不返回已删除记录', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const cv = await CustomView.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      ownerUserId: Number(owner.id),
      name: '待删除视图',
      baseViewType: 'kanban',
      visibility: 'personal',
      configJson: validConfig('kanban'),
      schemaVersion: 1,
      position: 0,
      isDefault: false,
    })

    const { DateTime } = await import('luxon')
    cv.deletedAt = DateTime.now()
    await cv.save()

    const notFound = await CustomView.find(cv.id)
    assert.isNull(notFound)
  })

  test('CustomView 软删除：查询不过滤 deleted_at IS NULL 时可找回', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const cv = await CustomView.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      ownerUserId: Number(owner.id),
      name: '找回视图',
      baseViewType: 'list',
      visibility: 'personal',
      configJson: validConfig('list'),
      schemaVersion: 1,
      position: 0,
      isDefault: false,
    })

    const { DateTime } = await import('luxon')
    cv.deletedAt = DateTime.now()
    await cv.save()

    const raw = await db.from('custom_views').where('id', cv.id).whereNotNull('deleted_at').first()
    assert.isNotNull(raw)
    assert.isNotNull(raw!.deleted_at)
  })

  // ------------------------------------------------------------------
  // 关系加载
  // ------------------------------------------------------------------

  test('CustomView 关联 project 加载正确', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const cv = await CustomView.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      ownerUserId: Number(owner.id),
      name: '关联测试',
      baseViewType: 'kanban',
      visibility: 'personal',
      configJson: validConfig('kanban'),
      schemaVersion: 1,
      position: 0,
      isDefault: false,
    })

    const loaded = await CustomView.query().where('id', cv.id).preload('project').firstOrFail()

    assert.exists(loaded.project)
    assert.equal(loaded.project.id, Number(project.id))
    assert.equal(loaded.project.name, '测试项目')
  })

  test('CustomView 关联 owner 加载正确', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const cv = await CustomView.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      ownerUserId: Number(owner.id),
      name: '所有者测试',
      baseViewType: 'kanban',
      visibility: 'personal',
      configJson: validConfig('kanban'),
      schemaVersion: 1,
      position: 0,
      isDefault: false,
    })

    const loaded = await CustomView.query().where('id', cv.id).preload('owner').firstOrFail()

    assert.exists(loaded.owner)
    assert.equal(loaded.owner.id, Number(owner.id))
    assert.equal(loaded.owner.email, owner.email)
  })
})
