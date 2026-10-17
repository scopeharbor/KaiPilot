import AuditLog from '#models/audit_log'
import Task from '#models/task'
import { AuditEvent, type AuditEventType } from '#services/audit_service'
import AuditService from '#services/audit_service'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  STRONG_PASSWORD,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'
import { createProjectMembership } from './_project_member_helper.js'

async function login(client: any, user: any, organizationId?: number) {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  const accessToken = res.body().data.accessToken as string
  if (organizationId === undefined) return accessToken
  const refreshRes = await client.post('/api/v1/auth/refresh').json({
    refreshToken: res.body().data.refreshToken,
    organizationId,
  })
  return refreshRes.body().data.accessToken as string
}

const audit = new AuditService()

async function seed(
  orgId: number,
  projectId: number,
  userId: number,
  event: AuditEventType,
  metadata: Record<string, unknown> = {},
  entityId: number | null = 1,
) {
  await audit.log({
    event,
    organizationId: orgId,
    projectId,
    userId,
    entityType: 'task',
    entityId,
    metadata,
  })
}

test.group('项目 Timeline API', (group) => {
  useAuthDatabase(group)

  test('项目成员读取由 audit_logs 派生的 Timeline（无 activity_events 表）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seed(org.id, project.id, owner.id, AuditEvent.TASK_CREATED, { name: '登录页' }, 5)
    await seed(org.id, project.id, owner.id, AuditEvent.MILESTONE_ACHIEVED, { name: 'M1' }, 8)

    const token = await login(client, owner, org.id)
    const res = await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body()
    assert.isArray(body.data)
    assert.isAtLeast(body.data.length, 2)
    assert.exists(body.meta)
    assert.equal(body.meta.source, 'audit_derived')

    const summaries = body.data.map((e: any) => e.summary)
    assert.isTrue(summaries.some((s: string) => s.includes('登录页')))
    assert.isTrue(summaries.some((s: string) => s.includes('M1')))

    // 结构化 DTO：不返回原始 action / metadata 原文
    for (const e of body.data) {
      assert.exists(e.category)
      assert.exists(e.importance)
      assert.exists(e.occurredAt)
      assert.notProperty(e, 'metadata')
      assert.notProperty(e, 'action')
    }
  })

  test('跨组织访问返回 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const otherOwner = await createUser({ email: uniqueEmail('o2') })
    const org = await createOrganization(owner)
    const org2 = await createOrganization(otherOwner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, otherOwner, org2.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(404)
  })

  test('非项目成员返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const other = await createUser({ email: uniqueEmail('other') })
    const org = await createOrganization(owner)
    await addOrgMember(org, other, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, other, org.id)

    const res = await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(403)
  })

  test('认证/安全类隐藏事件不出现在 Timeline', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seed(org.id, project.id, owner.id, AuditEvent.LOGIN_SUCCESS, {})
    await seed(org.id, project.id, owner.id, AuditEvent.PERMISSION_DENIED, {})
    await seed(org.id, project.id, owner.id, AuditEvent.TASK_DELETED, { name: '密件' }, 9)
    await seed(org.id, project.id, owner.id, AuditEvent.TASK_CREATED, { name: '公开任务' }, 5)

    const token = await login(client, owner, org.id)
    const res = await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const eventTypes = res.body().data.map((e: any) => e.eventType)
    assert.notInclude(eventTypes, AuditEvent.LOGIN_SUCCESS)
    assert.notInclude(eventTypes, AuditEvent.PERMISSION_DENIED)
    assert.notInclude(eventTypes, AuditEvent.TASK_DELETED)
    assert.include(eventTypes, AuditEvent.TASK_CREATED)
  })

  test('管理员可见事件对普通成员隐藏', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const member = await createUser({ email: uniqueEmail('member') })
    const org = await createOrganization(owner)
    await addOrgMember(org, member, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    // 把 member 也加入项目（普通成员角色）
    await createProjectMembership(project, member, ProjectRoleName.MEMBER)

    await seed(org.id, project.id, owner.id, AuditEvent.PROJECT_MEMBER_ADDED, {}, 2)
    await seed(org.id, project.id, owner.id, AuditEvent.TASK_CREATED, { name: '任务A' }, 5)

    // 普通成员看不到成员管理类事件
    const memberToken = await login(client, member, org.id)
    const memberRes = await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${memberToken}`)
    memberRes.assertStatus(200)
    const memberEventTypes = memberRes.body().data.map((e: any) => e.eventType)
    assert.notInclude(memberEventTypes, AuditEvent.PROJECT_MEMBER_ADDED)
    assert.include(memberEventTypes, AuditEvent.TASK_CREATED)

    // 项目管理者可见
    const mgrToken = await login(client, owner, org.id)
    const mgrRes = await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${mgrToken}`)
    const mgrEventTypes = mgrRes.body().data.map((e: any) => e.eventType)
    assert.include(mgrEventTypes, AuditEvent.PROJECT_MEMBER_ADDED)
  })

  test('敏感字段（IP/UA/API Key/评论正文/AI prompt）不出现在响应', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seed(
      org.id,
      project.id,
      owner.id,
      AuditEvent.COMMENT_CREATED,
      {
        body: 'SECRET_COMMENT_BODY_XYZ',
        ip: '10.9.8.7',
        userAgent: 'Mozilla/5.0 SECRET_UA',
      },
      3,
    )
    await seed(
      org.id,
      project.id,
      owner.id,
      AuditEvent.AI_DRAFT_GENERATED,
      {
        prompt: 'SECRET_PROMPT_ABC',
        apiKey: 'sk-SECRET-KEY-123',
        output: 'SECRET_MODEL_OUTPUT',
      },
      4,
    )

    const token = await login(client, owner, org.id)
    const res = await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const raw = JSON.stringify(res.body())
    for (const secret of [
      'SECRET_COMMENT_BODY_XYZ',
      'SECRET_PROMPT_ABC',
      'sk-SECRET-KEY-123',
      'SECRET_MODEL_OUTPUT',
      'SECRET_UA',
      '10.9.8.7',
    ]) {
      assert.notInclude(raw, secret)
    }
  })

  test('类型筛选只返回选定 category', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seed(org.id, project.id, owner.id, AuditEvent.TASK_CREATED, { name: 'T' }, 5)
    await seed(org.id, project.id, owner.id, AuditEvent.RISK_CREATED, { name: 'R' }, 6)
    await seed(org.id, project.id, owner.id, AuditEvent.MILESTONE_ACHIEVED, { name: 'M' }, 7)

    const token = await login(client, owner, org.id)
    const res = await client
      .get(`/api/v1/projects/${project.id}/timeline?category=risk`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const categories = res.body().data.map((e: any) => e.category)
    assert.isNotEmpty(categories)
    assert.isTrue(categories.every((c: string) => c === 'risk'))
  })

  test('非法筛选返回 422，perPage 超上限被裁剪', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seed(org.id, project.id, owner.id, AuditEvent.TASK_CREATED, { name: 'T' }, 5)
    const token = await login(client, owner, org.id)

    // 非法排序枚举
    const bad = await client
      .get(`/api/v1/projects/${project.id}/timeline?sort=drop_table`)
      .header('Authorization', `Bearer ${token}`)
    bad.assertStatus(422)

    // perPage 超上限：被裁剪到 <=50，仍 200
    const ok = await client
      .get(`/api/v1/projects/${project.id}/timeline?perPage=9999`)
      .header('Authorization', `Bearer ${token}`)
    ok.assertStatus(200)
    assert.isAtMost(ok.body().meta.perPage, 50)
  })

  test('短时间同类低重要性事件聚合降噪', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    for (let i = 0; i < 4; i++) {
      await seed(
        org.id,
        project.id,
        owner.id,
        AuditEvent.TASK_CREATED,
        { name: `任务${i}` },
        100 + i,
      )
    }

    const token = await login(client, owner, org.id)
    const res = await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const aggregated = res.body().data.find((e: any) => e.isAggregated)
    assert.exists(aggregated)
    assert.isAtLeast(aggregated.aggregatedCount, 3)
    assert.include(aggregated.summary, '任务')
  })

  test('只读：读取 Timeline 不新增审计或业务数据', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seed(org.id, project.id, owner.id, AuditEvent.TASK_CREATED, { name: 'T' }, 5)
    const token = await login(client, owner, org.id)

    const auditBefore = await AuditLog.query().count('* as total')
    const taskBefore = await Task.query().count('* as total')

    await client
      .get(`/api/v1/projects/${project.id}/timeline`)
      .header('Authorization', `Bearer ${token}`)

    const auditAfter = await AuditLog.query().count('* as total')
    const taskAfter = await Task.query().count('* as total')

    assert.equal(Number(auditAfter[0].$extras.total), Number(auditBefore[0].$extras.total))
    assert.equal(Number(taskAfter[0].$extras.total), Number(taskBefore[0].$extras.total))
  })

  test('大量事件下分页仍可交互（perPage 上限）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    // 60 条关键事件（critical 不被聚合），验证一页封顶且给出游标（分页可交互）
    for (let i = 0; i < 60; i++) {
      await seed(
        org.id,
        project.id,
        owner.id,
        AuditEvent.MILESTONE_ACHIEVED,
        { name: `M${i}` },
        1000 + i,
      )
    }

    const token = await login(client, owner, org.id)
    const res = await client
      .get(`/api/v1/projects/${project.id}/timeline?perPage=50`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.isAtMost(res.body().data.length, 50)
    assert.isTrue(res.body().meta.hasMore)
    assert.exists(res.body().meta.nextCursor)
  })
})

test.group('Timeline 实时旁路', (group) => {
  useAuthDatabase(group)

  test('候选事件审计写入成功且实时未挂载不影响写入', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    // realtime 未挂载：广播为 no-op，绝不抛错、绝不回滚审计写入
    await audit.log({
      event: AuditEvent.TASK_CREATED,
      organizationId: org.id,
      projectId: project.id,
      userId: owner.id,
      entityType: 'task',
      entityId: 5,
      metadata: { name: '任务' },
    })

    const rows = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
    assert.equal(rows.length, 1)
    assert.equal((rows[0].metadata as any).event, AuditEvent.TASK_CREATED)
  })
})
