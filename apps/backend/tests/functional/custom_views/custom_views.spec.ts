/**
 * 自定义视图 API 集成测试（tasks 3.4 / 3.5）。
 *
 * 覆盖点：
 *   - PM 创建个人/共享自定义视图 201 → 正确字段；
 *   - 列表返回 personal + shared 两部分；
 *   - 跨组织隔离 404（不泄露存在性）；
 *   - 详情返回正确配置；
 *   - 更新名称/配置 200；
 *   - 删除 200，软删除后不可见；
 *   - 共享视图复制为个人视图；
 *   - 排序更新；
 *   - 设默认视图 → 唯一默认；
 *   - 验证错误 422；
 *   - 权限错误 403；
 *   - 默认视图删除后的回退。
 */
import AuditLog from '#models/audit_log'
import CustomView from '#models/custom_view'
import db from '@adonisjs/lucid/services/db'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import type Organization from '#models/organization'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

/** 装配项目（owner=PM）+ 可选额外成员。 */
async function setupProject(
  org: Organization,
  creator: User,
  extraMembers: Array<{ user: User; role: string }> = [],
) {
  const { project } = await createProjectWithMember(
    org,
    creator,
    creator,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const roleCache = new Map<string, ProjectRole>()
  for (const { user, role } of extraMembers) {
    await addOrgMember(org, user, 'member')
    let roleRow = roleCache.get(role)
    if (!roleRow) {
      roleRow = await ProjectRole.create({
        projectId: project.id,
        name: role,
        description: role,
        permissions: [],
        isSystem: true,
      })
      roleCache.set(role, roleRow)
    }
    await ProjectMember.create({
      projectId: project.id,
      userId: user.id,
      projectRoleId: roleRow.id,
      isActive: true,
    })
  }
  return { project }
}

function validConfig(
  baseViewType: 'kanban' | 'list' | 'calendar' | 'gantt' | 'wbs' | 'resource' = 'kanban',
) {
  const filtersByType: Record<typeof baseViewType, Record<string, unknown>> = {
    kanban: { priorities: ['high'] },
    list: { statuses: ['in_progress'], priorities: ['high'] },
    calendar: { dateFrom: '2026-07-01', dateTo: '2026-07-31' },
    gantt: { statuses: ['in_progress'] },
    wbs: { search: '阶段' },
    resource: {
      roles: ['member'],
      skills: ['React'],
      loadStatuses: ['available'],
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    },
  }

  return {
    schemaVersion: 1,
    baseViewType,
    filters: filtersByType[baseViewType],
    sort: baseViewType === 'kanban' ? [] : [{ field: 'name', direction: 'asc' as const }],
    display: baseViewType === 'resource' ? { resourceViewMode: 'matrix' } : {},
    scope:
      baseViewType === 'resource' ? { timeRange: { start: '2026-07-01', end: '2026-07-31' } } : {},
    state: {},
  }
}

test.group('自定义视图 API：CRUD + 权限 + 隔离', (group) => {
  useAuthDatabase(group)

  // ---------------- 创建 ----------------

  test('PM 创建个人自定义视图 201 + 字段正确', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '我的看板',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    res.assertStatus(201)
    const body = res.body()
    assert.equal(body.data.name, '我的看板')
    assert.equal(body.data.baseViewType, 'kanban')
    assert.equal(body.data.visibility, 'personal')
    assert.equal(body.data.schemaVersion, 1)
    assert.equal(body.data.isDefault, false)
    assert.isNumber(body.data.position)
    assert.exists(body.data.createdAt)
    assert.exists(body.data.updatedAt)
  })

  test('PM 创建共享自定义视图 201 + 审计日志', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '团队甘特',
        baseViewType: 'gantt',
        visibility: 'shared',
        config: validConfig('gantt'),
      })
    res.assertStatus(201)
    assert.equal(res.body().data.visibility, 'shared')

    // 审计事件
    const audits = await AuditLog.query()
      .where('entity_type', 'custom_view')
      .where('entity_id', res.body().data.id)
      .where('action', 'update')
    assert.isAbove(audits.length, 0, '共享视图创建应写入审计')
    assert.equal(audits[0].metadata?.event, 'CONFIG_CHANGED')
    assert.notProperty(audits[0].metadata ?? {}, 'configJson')
  })

  test('PM 创建资源工作台自定义视图 201 + 配置白名单', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const config = validConfig('resource')
    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '资源矩阵',
        baseViewType: 'resource',
        visibility: 'personal',
        config,
      })
    res.assertStatus(201)
    assert.equal(res.body().data.baseViewType, 'resource')
    assert.deepEqual(res.body().data.config.filters, config.filters)
    assert.equal(res.body().data.config.display.resourceViewMode, 'matrix')
  })

  // ---------------- 列表 ----------------

  test('列表返回 personal + shared 两部分', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 创建两个个人视图、一个共享视图
    await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '个人1',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })

    await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '团队',
        baseViewType: 'list',
        visibility: 'shared',
        config: validConfig('list'),
      })

    await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '个人2',
        baseViewType: 'gantt',
        visibility: 'personal',
        config: validConfig('gantt'),
      })

    const res = await client
      .get(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    const body = res.body()
    assert.isArray(body.data.personal)
    assert.isArray(body.data.shared)
    assert.equal(body.data.personal.length, 2)
    assert.equal(body.data.shared.length, 1)
    assert.equal(body.data.shared[0].name, '团队')
  })

  test('列表 → 跨组织隔离 404', async ({ client }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const { project: projectA } = await setupProject(orgA, ownerA)
    await setupProject(orgB, ownerB)
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`/api/v1/projects/${projectA.id}/custom-views`)
      .header('Authorization', `Bearer ${tokenB}`)
    res.assertStatus(404)
  })

  // ---------------- 详情 ----------------

  test('获取视图详情返回正确配置', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const config = validConfig('list')
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '列表视图', baseViewType: 'list', visibility: 'personal', config })
    createRes.assertStatus(201)
    const viewId = createRes.body().data.id

    const showRes = await client
      .get(`/api/v1/projects/${project.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${token}`)
    showRes.assertStatus(200)
    assert.equal(showRes.body().data.name, '列表视图')
    assert.equal(showRes.body().data.baseViewType, 'list')
    assert.deepEqual(showRes.body().data.config, config)
  })

  // ---------------- 更新 ----------------

  test('更新视图名称和配置返回 200', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '旧名称',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    createRes.assertStatus(201)
    const viewId = createRes.body().data.id

    const newConfig = { ...validConfig('kanban'), filters: { priorities: ['low'] } }
    const updateRes = await client
      .patch(`/api/v1/projects/${project.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '新名称', config: newConfig })
    updateRes.assertStatus(200)
    assert.equal(updateRes.body().data.name, '新名称')
    assert.deepEqual(updateRes.body().data.config.filters, { priorities: ['low'] })
  })

  // ---------------- 删除 ----------------

  test('删除视图 200，软删除后不可见', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '待删除',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    createRes.assertStatus(201)
    const viewId = createRes.body().data.id

    const deleteRes = await client
      .delete(`/api/v1/projects/${project.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${token}`)
    deleteRes.assertStatus(204)

    // 删除后不可见
    const showRes = await client
      .get(`/api/v1/projects/${project.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${token}`)
    showRes.assertStatus(404)

    // 数据库仍存在（软删除）
    const raw = await db.from('custom_views').where('id', viewId).whereNotNull('deleted_at').first()
    assert.exists(raw, '删除视图应在数据库保留（软删除）')
  })

  // ---------------- 复制 ----------------

  test('克隆共享视图到个人视图 → 新建个人视图', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const member = await createUser({ email: uniqueEmail('member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    const pmToken = await login(client, owner)

    // PM 创建共享视图
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({
        name: '团队看板',
        baseViewType: 'kanban',
        visibility: 'shared',
        config: validConfig('kanban'),
      })
    createRes.assertStatus(201)
    const sharedViewId = createRes.body().data.id

    // 成员复制为个人视图
    const mbrToken = await login(client, member)
    const cloneRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views/${sharedViewId}/clone`)
      .header('Authorization', `Bearer ${mbrToken}`)
      .json({ name: '我的副本' })
    cloneRes.assertStatus(201)
    assert.equal(cloneRes.body().data.name, '我的副本')
    assert.equal(cloneRes.body().data.visibility, 'personal')

    // 原共享视图未被修改
    const original = await CustomView.find(sharedViewId)
    assert.exists(original)
    assert.equal(original!.name, '团队看板')
    assert.equal(original!.visibility, 'shared')
  })

  // ---------------- 排序 ----------------

  test('排序更新 → 位置更新', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const r1 = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '视图A',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    r1.assertStatus(201)
    const r2 = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '视图B',
        baseViewType: 'list',
        visibility: 'personal',
        config: validConfig('list'),
      })
    r2.assertStatus(201)
    const idA = r1.body().data.id
    const idB = r2.body().data.id

    // 交换顺序：B → A
    const reorderRes = await client
      .put(`/api/v1/projects/${project.id}/custom-views/reorder`)
      .header('Authorization', `Bearer ${token}`)
      .json({ viewIds: [idB, idA] })
    reorderRes.assertStatus(200)

    const listRes = await client
      .get(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
    listRes.assertStatus(200)
    const personal = listRes.body().data.personal
    assert.equal(personal[0].id, idB)
    assert.equal(personal[0].position, 0)
    assert.equal(personal[1].id, idA)
    assert.equal(personal[1].position, 1)
  })

  // ---------------- 默认视图 ----------------

  test('设置默认视图 → 用户在该项目恰好一个默认视图', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const r1 = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '视图1',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    r1.assertStatus(201)
    const r2 = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '视图2',
        baseViewType: 'list',
        visibility: 'personal',
        config: validConfig('list'),
      })
    r2.assertStatus(201)
    const id1 = r1.body().data.id

    // 设视图1为默认
    const def1 = await client
      .put(`/api/v1/projects/${project.id}/custom-views/${id1}/default`)
      .header('Authorization', `Bearer ${token}`)
    def1.assertStatus(200)

    const list1 = await client
      .get(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
    list1.assertStatus(200)
    const defaults1 = list1.body().data.personal.filter((v: any) => v.isDefault)
    assert.lengthOf(defaults1, 1)
    assert.equal(defaults1[0].id, id1)
  })

  test('设置默认 → 旧默认被清除', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const r1 = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '视图A',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    r1.assertStatus(201)
    const r2 = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '视图B',
        baseViewType: 'list',
        visibility: 'personal',
        config: validConfig('list'),
      })
    r2.assertStatus(201)
    const idA = r1.body().data.id
    const idB = r2.body().data.id

    await client
      .put(`/api/v1/projects/${project.id}/custom-views/${idA}/default`)
      .header('Authorization', `Bearer ${token}`)
    await client
      .put(`/api/v1/projects/${project.id}/custom-views/${idB}/default`)
      .header('Authorization', `Bearer ${token}`)

    const listRes = await client
      .get(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
    listRes.assertStatus(200)
    const defaults = listRes.body().data.personal.filter((v: any) => v.isDefault)
    assert.lengthOf(defaults, 1)
    assert.equal(defaults[0].id, idB, '新默认取代旧默认')
  })

  test('删除默认视图后回退到基础视图', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '默认视图',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    createRes.assertStatus(201)
    const viewId = createRes.body().data.id

    await client
      .put(`/api/v1/projects/${project.id}/custom-views/${viewId}/default`)
      .header('Authorization', `Bearer ${token}`)

    await client
      .delete(`/api/v1/projects/${project.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${token}`)

    // 确认该用户已无默认视图
    const listRes = await client
      .get(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
    listRes.assertStatus(200)
    const defaults = listRes.body().data.personal.filter((v: any) => v.isDefault)
    assert.lengthOf(defaults, 0, '删除默认视图后应清理 is_default 标记')
  })

  // ---------------- 验证错误 ----------------

  test('空名称 → 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('无效 baseViewType → 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '测试',
        baseViewType: 'invalid',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    res.assertStatus(422)
  })

  test('未知配置字段 → 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '测试',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: { ...validConfig('kanban'), unknownField: 'should_not_exist' },
      })
    res.assertStatus(422)
  })

  test('配置过大 → 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 构造 60KB+ 配置
    const largeConfig = {
      ...validConfig('kanban'),
      filters: { search: 'x'.repeat(60000) },
    }

    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '超大配置',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: largeConfig,
      })
    res.assertStatus(422)
  })

  // ---------------- 权限错误 ----------------

  test('非项目成员创建视图 → 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const outsider = await createUser({ email: uniqueEmail('outsider') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, outsider)

    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '测试',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('只读成员创建共享视图 → 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const observer = await createUser({ email: uniqueEmail('obs') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    const token = await login(client, observer)

    const res = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '测试',
        baseViewType: 'kanban',
        visibility: 'shared',
        config: validConfig('kanban'),
      })
    res.assertStatus(403)
  })

  test('非所有者查看个人视图 → 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const member = await createUser({ email: uniqueEmail('member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    const pmToken = await login(client, owner)

    // PM 创建个人视图
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({
        name: 'PM个人',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    createRes.assertStatus(201)
    const viewId = createRes.body().data.id

    // 成员尝试查看 → 403
    const mbrToken = await login(client, member)
    const showRes = await client
      .get(`/api/v1/projects/${project.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${mbrToken}`)
    showRes.assertStatus(403)
    showRes.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('非所有者尝试删除个人视图 → 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const member = await createUser({ email: uniqueEmail('member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    const pmToken = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({
        name: 'PM个人',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    createRes.assertStatus(201)
    const viewId = createRes.body().data.id

    const mbrToken = await login(client, member)
    const delRes = await client
      .delete(`/api/v1/projects/${project.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${mbrToken}`)
    delRes.assertStatus(403)
  })

  test('非项目经理尝试删除共享视图 → 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const member = await createUser({ email: uniqueEmail('member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    const pmToken = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/custom-views`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({
        name: '共享视图',
        baseViewType: 'kanban',
        visibility: 'shared',
        config: validConfig('kanban'),
      })
    createRes.assertStatus(201)
    const viewId = createRes.body().data.id

    const mbrToken = await login(client, member)
    const delRes = await client
      .delete(`/api/v1/projects/${project.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${mbrToken}`)
    delRes.assertStatus(403)
  })

  // ---------------- 跨组织隔离 ----------------

  test('跨组织用户无法访问视图列表', async ({ client }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const { project: projectA } = await setupProject(orgA, ownerA)
    await setupProject(orgB, ownerB)
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`/api/v1/projects/${projectA.id}/custom-views`)
      .header('Authorization', `Bearer ${tokenB}`)
    res.assertStatus(404)
  })

  test('跨组织用户无法查看单个视图', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const { project: projectA } = await setupProject(orgA, ownerA)
    await setupProject(orgB, ownerB)
    const tokenA = await login(client, ownerA)
    const tokenB = await login(client, ownerB)

    const createRes = await client
      .post(`/api/v1/projects/${projectA.id}/custom-views`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({
        name: 'A的视图',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: validConfig('kanban'),
      })
    createRes.assertStatus(201)
    const viewId = createRes.body().data.id

    // B 去查 A 的视图 → 404
    const res = await client
      .get(`/api/v1/projects/${projectA.id}/custom-views/${viewId}`)
      .header('Authorization', `Bearer ${tokenB}`)
    res.assertStatus(404)

    // 数据库中的视图仍存在
    const stillExists = await CustomView.find(viewId)
    assert.exists(stillExists, '跨组织访问不应删除资源')
  })

  // ---------------- 未认证 ----------------

  test('未认证访问列表返回 401', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const res = await client.get(`/api/v1/projects/${project.id}/custom-views`)
    res.assertStatus(401)
  })
})
