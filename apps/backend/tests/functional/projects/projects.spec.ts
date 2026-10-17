import AuditLog from '#models/audit_log'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  STRONG_PASSWORD,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * 项目 CRUD / 成员 / Dashboard 集成测试（任务 6.2 / 6.3）。
 */
test.group('项目核心 API', (group) => {
  useAuthDatabase(group)

  async function login(
    client: any,
    email: string,
    password = STRONG_PASSWORD,
    organizationId?: number,
  ) {
    const res = await client.post('/api/v1/auth/login').json({ email, password })
    const accessToken = res.body().data.accessToken as string
    if (organizationId === undefined) return accessToken

    const refreshRes = await client.post('/api/v1/auth/refresh').json({
      refreshToken: res.body().data.refreshToken,
      organizationId,
    })
    return refreshRes.body().data.accessToken as string
  }

  async function createOrgAndAdmin(client: any) {
    const admin = await createUser({ email: uniqueEmail('admin') })
    const org = await createOrganization(admin)
    const token = await login(client, admin.email, STRONG_PASSWORD, org.id)
    return { admin, org, token }
  }

  async function createProject(
    client: any,
    token: string,
    _orgId: number,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: '测试项目',
        code: `P${Date.now()}`,
        ...overrides,
      })
    return res
  }

  async function getProject(client: any, token: string, projectId: number) {
    return client.get(`/api/v1/projects/${projectId}`).header('Authorization', `Bearer ${token}`)
  }

  test('创建项目事务内生成 5 系统角色与 Owner 成员', async ({ client, assert }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const res = await createProject(client, token, org.id, { name: '事务项目', code: 'TXN' })

    res.assertStatus(201)
    const projectId = res.body().data.id

    const roles = await ProjectRole.query().where('project_id', projectId)
    assert.lengthOf(roles, 5)
    assert.isTrue(roles.every((r) => r.isSystem))

    const ownerMember = await ProjectMember.query()
      .where('project_id', projectId)
      .where('user_id', admin.id)
      .preload('projectRole')
      .first()
    assert.isNotNull(ownerMember)
    assert.equal(ownerMember!.projectRole!.name, 'Project Owner')
  })

  test('组织内 code 重复返回 2001', async ({ client, assert }) => {
    const { org, token } = await createOrgAndAdmin(client)
    await createProject(client, token, org.id, { code: 'DUPE' })
    const res = await createProject(client, token, org.id, { code: 'DUPE' })

    res.assertStatus(422)
    assert.equal(res.body().error.code, '2001')
  })

  test('普通组织成员无建项权返回 403', async ({ client }) => {
    const { org } = await createOrgAndAdmin(client)
    const member = await createUser({ email: uniqueEmail('member') })
    await addOrgMember(org, member, 'member')
    const memberToken = await login(client, member.email)

    const res = await createProject(client, memberToken, org.id, { code: 'NOAUTH' })
    res.assertStatus(403)
  })

  test('项目详情返回 stats 聚合', async ({ client, assert }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'DETAIL' })
    const projectId = created.body().data.id

    const res = await getProject(client, token, projectId)

    res.assertStatus(200)
    assert.equal(res.body().data.stats.memberCount, 1)
  })

  test('项目列表含 member/task 聚合', async ({ client, assert }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'AGG' })
    const projectId = created.body().data.id

    const list = await client.get('/api/v1/projects').header('Authorization', `Bearer ${token}`)
    list.assertStatus(200)
    const item = (list.body().data as Array<any>).find((p) => p.id === projectId)
    assert.isDefined(item)
    assert.equal(item.stats.memberCount, 1)
    assert.equal(item.stats.taskCount, 0)
  })

  test('归档项目后普通编辑被拒', async ({ client }) => {
    const { token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, 0, { code: 'ARCH' })
    const projectId = created.body().data.id

    const archiveRes = await client
      .post(`/api/v1/projects/${projectId}/archive`)
      .header('Authorization', `Bearer ${token}`)
    archiveRes.assertStatus(200)

    const updateRes = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '已改' })
    updateRes.assertStatus(422)
  })

  test('软删除后项目从列表消失', async ({ client, assert }) => {
    const { token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, 0, { code: 'SOFTDEL' })
    const projectId = created.body().data.id

    // 需要先 patch 到非 archived 状态，再删除；因为创建后默认 draft 直接删除应被允许
    const deleteRes = await client
      .delete(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
    deleteRes.assertStatus(204)

    const project = await Project.find(projectId)
    assert.isNull(project)

    const raw = await db.from('projects').where('id', projectId).first()
    assert.isNotNull(raw)
  })

  test('非项目成员看详情返回 403', async ({ client }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const member = await createUser({ email: uniqueEmail('outsider') })
    await addOrgMember(org, member, 'member')
    const memberToken = await login(client, member.email, STRONG_PASSWORD, org.id)

    const created = await createProject(client, token, 0, { code: 'PRIVATE' })
    const projectId = created.body().data.id

    const outsiderRes = await getProject(client, memberToken, projectId)
    outsiderRes.assertStatus(403)
  })

  test('跨组织项目返回 404', async ({ client }) => {
    const { token: tokenA } = await createOrgAndAdmin(client)
    const adminB = await createUser({ email: uniqueEmail('adminb') })
    const orgB = await createOrganization(adminB)
    const tokenB = await login(client, adminB.email, STRONG_PASSWORD, orgB.id)

    const created = await createProject(client, tokenA, 0, { code: 'CROSS' })
    const projectId = created.body().data.id

    const crossRes = await getProject(client, tokenB, projectId)
    crossRes.assertStatus(404)
  })

  test('项目工作日历读取默认值并更新规范化设置', async ({ client, assert }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'CAL' })
    const projectId = created.body().data.id

    const defaultRes = await client
      .get(`/api/v1/projects/${projectId}/working-calendar`)
      .header('Authorization', `Bearer ${token}`)
    defaultRes.assertStatus(200)
    assert.deepEqual(defaultRes.body().data, {
      version: 1,
      workdays: [1, 2, 3, 4, 5],
      holidays: [],
      extraWorkdays: [],
    })

    const updateRes = await client
      .patch(`/api/v1/projects/${projectId}/working-calendar`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        version: 1,
        workdays: [6, 1, 2, 1],
        holidays: ['2026-10-03', '2026-10-01'],
        extraWorkdays: ['2026-09-27'],
      })
    updateRes.assertStatus(200)
    assert.deepEqual(updateRes.body().data, {
      version: 1,
      workdays: [1, 2, 6],
      holidays: ['2026-10-01', '2026-10-03'],
      extraWorkdays: ['2026-09-27'],
    })

    const fresh = await Project.findOrFail(projectId)
    assert.deepEqual(fresh.settings?.workingCalendar, updateRes.body().data)

    const audit = await AuditLog.query()
      .where('project_id', projectId)
      .orderBy('id', 'desc')
      .firstOrFail()
    assert.equal((audit.metadata as any).event, 'PROJECT_WORKING_CALENDAR_UPDATED')
  })

  test('工作日历更新拒绝只读、归档、跨组织和非法 payload', async ({ client, assert }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'CALERR' })
    const projectId = created.body().data.id

    const observer = await createUser({ email: uniqueEmail('calendar-observer') })
    await addOrgMember(org, observer, 'member')
    const observerRole = await ProjectRole.query()
      .where('project_id', projectId)
      .where('name', ProjectRoleName.READONLY_OBSERVER)
      .firstOrFail()
    await ProjectMember.create({
      projectId,
      userId: observer.id,
      projectRoleId: observerRole.id,
      isActive: true,
    })
    const observerToken = await login(client, observer.email, STRONG_PASSWORD, org.id)
    const readonlyRes = await client
      .patch(`/api/v1/projects/${projectId}/working-calendar`)
      .header('Authorization', `Bearer ${observerToken}`)
      .json({ workdays: [1, 2, 3], holidays: [], extraWorkdays: [] })
    readonlyRes.assertStatus(403)

    const invalidCases = [
      { payload: { workdays: [] }, message: '空工作日' },
      { payload: { workdays: [1, 7] }, message: '非法星期编号' },
      { payload: { holidays: ['2026-02-30'] }, message: '非法日期' },
      { payload: { holidays: ['2026-09-27'], extraWorkdays: ['2026-09-27'] }, message: '冲突日期' },
      { payload: { holidays: ['2026-09-27', '2026-09-27'] }, message: '重复日期' },
      { payload: { shifts: [{ startsAt: '09:00' }] }, message: '非范围字段' },
    ]
    for (const item of invalidCases) {
      const res = await client
        .patch(`/api/v1/projects/${projectId}/working-calendar`)
        .header('Authorization', `Bearer ${token}`)
        .json(item.payload)
      res.assertStatus(422)
      assert.equal(
        (res.body() as unknown as { error: { code: string } }).error.code,
        'VALIDATION_ERROR',
        item.message,
      )
    }

    await client
      .post(`/api/v1/projects/${projectId}/archive`)
      .header('Authorization', `Bearer ${token}`)
    const archivedRes = await client
      .patch(`/api/v1/projects/${projectId}/working-calendar`)
      .header('Authorization', `Bearer ${token}`)
      .json({ workdays: [1, 2, 3], holidays: [], extraWorkdays: [] })
    archivedRes.assertStatus(422)

    const adminB = await createUser({ email: uniqueEmail('cal-admin-b') })
    const orgB = await createOrganization(adminB)
    const tokenB = await login(client, adminB.email, STRONG_PASSWORD, orgB.id)
    const crossRes = await client
      .get(`/api/v1/projects/${projectId}/working-calendar`)
      .header('Authorization', `Bearer ${tokenB}`)
    crossRes.assertStatus(404)
  })

  test('保存工作日历不批量改写任务日期', async ({ client, assert }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'CALTASK' })
    const projectId = created.body().data.id
    const task = await Task.create({
      projectId,
      name: '固定日期任务',
      status: 'not_started' as never,
      priority: 'medium',
      taskType: 'task',
      startDate: DateTime.fromISO('2026-09-25'),
      endDate: DateTime.fromISO('2026-09-30'),
      durationDays: 4,
    })

    const res = await client
      .patch(`/api/v1/projects/${projectId}/working-calendar`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        workdays: [1, 2, 3, 4, 5, 6],
        holidays: ['2026-09-28'],
        extraWorkdays: [],
      })
    res.assertStatus(200)

    const freshTask = await Task.findOrFail(task.id)
    assert.equal(freshTask.startDate?.toISODate(), '2026-09-25')
    assert.equal(freshTask.endDate?.toISODate(), '2026-09-30')
  })

  test('成员增改删转交', async ({ client, assert }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'MEMBERS' })
    const projectId = created.body().data.id

    const member = await createUser({ email: uniqueEmail('newmember') })
    await addOrgMember(org, member, 'member')

    const rolesRes = await client
      .get(`/api/v1/projects/${projectId}/roles`)
      .header('Authorization', `Bearer ${token}`)
    rolesRes.assertStatus(200)
    const memberRole = rolesRes.body().data.find((r: any) => r.name === 'Member')

    const addRes = await client
      .post(`/api/v1/projects/${projectId}/members`)
      .header('Authorization', `Bearer ${token}`)
      .json({ userId: member.id, projectRoleId: memberRole!.id })
    addRes.assertStatus(201)

    const transferRes = await client
      .post(`/api/v1/projects/${projectId}/transfer-owner`)
      .header('Authorization', `Bearer ${token}`)
      .json({ userId: member.id })
    transferRes.assertStatus(200)
    assert.equal(transferRes.body().data.newOwnerId, member.id)

    const removeRes = await client
      .delete(`/api/v1/projects/${projectId}/members/${member.id}`)
      .header('Authorization', `Bearer ${token}`)
    removeRes.assertStatus(422)
  })

  test('Dashboard 返回 stats 与最近活动', async ({ client, assert }) => {
    const { token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, 0, { code: 'DASH' })
    const projectId = created.body().data.id

    const res = await client
      .get(`/api/v1/projects/${projectId}/dashboard`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)

    assert.equal(res.body().data.stats.memberCount, 1)
    assert.isArray(res.body().data.recentActivity)
  })

  test('项目角色下放：org member 任 PM 可在本项目内 project:update', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('r1-owner') })
    const org = await createOrganization(owner)

    const pmUser = await createUser({ email: uniqueEmail('r1-pm') })
    await addOrgMember(org, pmUser, 'member')
    const { project } = await createProjectWithMember(org, owner, pmUser, 'Project Manager', [])

    const pmToken = await login(client, pmUser.email, STRONG_PASSWORD, org.id)
    const r1Res = await client
      .patch(`/api/v1/projects/${project.id}`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({ name: '项目经理修改' })
    r1Res.assertStatus(200)
  })

  test('外部协作者编辑项目被拒 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('ext-owner') })
    const org = await createOrganization(owner)

    const extUser = await createUser({ email: uniqueEmail('ext-user') })
    await addOrgMember(org, extUser, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      extUser,
      'External Collaborator',
      [],
    )

    const extToken = await login(client, extUser.email, STRONG_PASSWORD, org.id)
    const extRes = await client
      .patch(`/api/v1/projects/${project.id}`)
      .header('Authorization', `Bearer ${extToken}`)
      .json({ name: '试图修改' })
    extRes.assertStatus(403)
  })

  test('重复添加项目成员返回 2006', async ({ client, assert }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'DUPMEM' })
    const projectId = created.body().data.id
    const member = await createUser({ email: uniqueEmail('dup') })
    await addOrgMember(org, member, 'member')

    const rolesRes = await client
      .get(`/api/v1/projects/${projectId}/roles`)
      .header('Authorization', `Bearer ${token}`)
    const memberRole = rolesRes.body().data.find((r: any) => r.name === 'Member')

    const add1 = await client
      .post(`/api/v1/projects/${projectId}/members`)
      .header('Authorization', `Bearer ${token}`)
      .json({ userId: member.id, projectRoleId: memberRole!.id })
    add1.assertStatus(201)

    const add2 = await client
      .post(`/api/v1/projects/${projectId}/members`)
      .header('Authorization', `Bearer ${token}`)
      .json({ userId: member.id, projectRoleId: memberRole!.id })
    add2.assertStatus(409)
    assert.equal((add2.body() as any).error.code, '2006')
  })

  test('添加非本组织用户被拒 422', async ({ client }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'EXTMEM' })
    const projectId = created.body().data.id
    const stranger = await createUser({ email: uniqueEmail('stranger') })

    const rolesRes = await client
      .get(`/api/v1/projects/${projectId}/roles`)
      .header('Authorization', `Bearer ${token}`)
    const memberRole = rolesRes.body().data.find((r: any) => r.name === 'Member')

    const res = await client
      .post(`/api/v1/projects/${projectId}/members`)
      .header('Authorization', `Bearer ${token}`)
      .json({ userId: stranger.id, projectRoleId: memberRole!.id })
    res.assertStatus(422)
  })

  test('按邮箱邀请成员成功并记 invitedByEmail 审计；重复邀请返回 2006', async ({
    client,
    assert,
  }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'INVITE' })
    const projectId = created.body().data.id
    const invitee = await createUser({ email: uniqueEmail('invitee') })
    await addOrgMember(org, invitee, 'member')

    const rolesRes = await client
      .get(`/api/v1/projects/${projectId}/roles`)
      .header('Authorization', `Bearer ${token}`)
    const memberRole = rolesRes.body().data.find((r: any) => r.name === 'Member')

    const ok = await client
      .post(`/api/v1/projects/${projectId}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: invitee.email, projectRoleId: memberRole!.id })
    ok.assertStatus(201)
    assert.equal(ok.body().data.userId, invitee.id)
    assert.notProperty(ok.body().data.user, 'password')

    const auditRow = await db
      .from('audit_logs')
      .where('project_id', projectId)
      .orderBy('id', 'desc')
      .first()
    const meta = auditRow?.metadata
      ? (JSON.parse(auditRow.metadata as string) as { event?: string; invitedByEmail?: boolean })
      : undefined
    assert.equal(meta?.event, 'PROJECT_MEMBER_ADDED')
    assert.isTrue(meta?.invitedByEmail)

    const dup = await client
      .post(`/api/v1/projects/${projectId}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: invitee.email, projectRoleId: memberRole!.id })
    dup.assertStatus(409)
    assert.equal((dup.body() as any).error.code, '2006')
  })

  test('邮箱邀请：未注册/已禁用/非组织成员均返回 422', async ({ client }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'INV422' })
    const projectId = created.body().data.id

    const rolesRes = await client
      .get(`/api/v1/projects/${projectId}/roles`)
      .header('Authorization', `Bearer ${token}`)
    const memberRole = rolesRes.body().data.find((r: any) => r.name === 'Member')

    const missing = await client
      .post(`/api/v1/projects/${projectId}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: uniqueEmail('missing'), projectRoleId: memberRole!.id })
    missing.assertStatus(422)

    const inactive = await createUser({ email: uniqueEmail('inactive'), isActive: false })
    await addOrgMember(org, inactive, 'member')
    const inactiveRes = await client
      .post(`/api/v1/projects/${projectId}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: inactive.email, projectRoleId: memberRole!.id })
    inactiveRes.assertStatus(422)

    const outsider = await createUser({ email: uniqueEmail('outsider') })
    const outsiderRes = await client
      .post(`/api/v1/projects/${projectId}/members/invite`)
      .header('Authorization', `Bearer ${token}`)
      .json({ email: outsider.email, projectRoleId: memberRole!.id })
    outsiderRes.assertStatus(422)
  })

  test('外部协作者按邮箱邀请成员被拒 403', async ({ client }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'INV403' })
    const projectId = created.body().data.id

    const rolesRes = await client
      .get(`/api/v1/projects/${projectId}/roles`)
      .header('Authorization', `Bearer ${token}`)
    const observerRole = rolesRes.body().data.find((r: any) => r.name === 'External Collaborator')
    const memberRole = rolesRes.body().data.find((r: any) => r.name === 'Member')
    const ext = await createUser({ email: uniqueEmail('ext') })
    await addOrgMember(org, ext, 'member')
    await client
      .post(`/api/v1/projects/${projectId}/members`)
      .header('Authorization', `Bearer ${token}`)
      .json({ userId: ext.id, projectRoleId: observerRole!.id })

    const extToken = await login(client, ext.email, STRONG_PASSWORD, org.id)
    const invitee = await createUser({ email: uniqueEmail('invitee2') })
    await addOrgMember(org, invitee, 'member')

    const res = await client
      .post(`/api/v1/projects/${projectId}/members/invite`)
      .header('Authorization', `Bearer ${extToken}`)
      .json({ email: invitee.email, projectRoleId: memberRole!.id })
    res.assertStatus(403)
  })

  test('直接降级 Project Owner 被拒 422', async ({ client }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'DOWNGRADE' })
    const projectId = created.body().data.id

    const rolesRes = await client
      .get(`/api/v1/projects/${projectId}/roles`)
      .header('Authorization', `Bearer ${token}`)
    const memberRole = rolesRes.body().data.find((r: any) => r.name === 'Member')

    const res = await client
      .patch(`/api/v1/projects/${projectId}/members/${admin.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ projectRoleId: memberRole!.id })
    res.assertStatus(422)
  })

  test('转交所有权给非成员被拒 422', async ({ client }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'XFER' })
    const projectId = created.body().data.id
    const stranger = await createUser({ email: uniqueEmail('xfer-stranger') })
    await addOrgMember(org, stranger, 'member')

    const res = await client
      .post(`/api/v1/projects/${projectId}/transfer-owner`)
      .header('Authorization', `Bearer ${token}`)
      .json({ userId: stranger.id })
    res.assertStatus(422)
  })

  test('外部协作者管理成员被拒 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('ec-owner') })
    const org = await createOrganization(owner)
    const extUser = await createUser({ email: uniqueEmail('ec-user') })
    await addOrgMember(org, extUser, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      extUser,
      'External Collaborator',
      [],
    )

    const someone = await createUser({ email: uniqueEmail('ec-target') })
    await addOrgMember(org, someone, 'member')

    const extToken = await login(client, extUser.email, STRONG_PASSWORD, org.id)
    const res = await client
      .post(`/api/v1/projects/${project.id}/members`)
      .header('Authorization', `Bearer ${extToken}`)
      .json({ userId: someone.id, projectRoleId: 1 })
    res.assertStatus(403)
  })

  test('非项目成员访问 Dashboard 返回 403', async ({ client }) => {
    const { org, token } = await createOrgAndAdmin(client)
    const created = await createProject(client, token, org.id, { code: 'DASH403' })
    const projectId = created.body().data.id

    const outsider = await createUser({ email: uniqueEmail('dash-out') })
    await addOrgMember(org, outsider, 'member')
    const outsiderToken = await login(client, outsider.email, STRONG_PASSWORD, org.id)

    const res = await client
      .get(`/api/v1/projects/${projectId}/dashboard`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    res.assertStatus(403)
  })

  test('Dashboard 活动流受组织隔离', async ({ client, assert }) => {
    const adminA = await createUser({ email: uniqueEmail('iso-a') })
    const orgA = await createOrganization(adminA)
    const tokenA = await login(client, adminA.email, STRONG_PASSWORD, orgA.id)
    const createdA = await createProject(client, tokenA, orgA.id, { code: 'ISOA' })
    const projectAId = createdA.body().data.id
    // 在 orgA 项目上触发 PROJECT_UPDATED 审计
    await client
      .patch(`/api/v1/projects/${projectAId}`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({ priority: 'high' })

    const adminB = await createUser({ email: uniqueEmail('iso-b') })
    const orgB = await createOrganization(adminB)
    const tokenB = await login(client, adminB.email, STRONG_PASSWORD, orgB.id)
    const createdB = await createProject(client, tokenB, orgB.id, { code: 'ISOB' })
    const projectBId = createdB.body().data.id

    const dashB = await client
      .get(`/api/v1/projects/${projectBId}/dashboard`)
      .header('Authorization', `Bearer ${tokenB}`)
    dashB.assertStatus(200)
    const events = dashB.body().data.recentActivity as Array<{ entityId: number | null }>
    // orgB 项目活动不应包含 orgA 项目的任何事件
    assert.isFalse(events.some((e) => e.entityId === projectAId))
  })
})
