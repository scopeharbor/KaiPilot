import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import Risk from '#models/risk'
import Task from '#models/task'
import AuditLog from '#models/audit_log'
import TrizResourceOpportunityCandidate from '#models/triz_resource_opportunity_candidate'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

// ===========================================================================
// TRIZ 资源分析器 API 功能测试（v3-triz-resource-analyzer §5.5–§5.6、§3.6、§3.8、§6.8）
//
// 覆盖：JWT 门禁、RBAC（view/manage 分离）、组织隔离不泄露、统一 envelope、
// 幂等复用、审查状态流转、四类 preview、stale 阻断、正式数据零写入、低敏审计。
// 默认全程不调用真实模型（AI 说明走确定性 fallback）。
// ===========================================================================

const API_PREFIX = '/api/v1'
const BASE = (projectId: number) => `${API_PREFIX}/projects/${projectId}/triz/resource-analyses`

async function login(client: any, user: any) {
  const r = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  return (r.body() as { data: { accessToken: string } }).data.accessToken
}

/** 读取某项目下本 change 的审计事件（事件名写在 metadata.event，不是独立列）。 */
async function resourceAuditLogs(projectId: number) {
  const logs = await AuditLog.query().where('project_id', projectId)
  return logs
    .map((log) => ({
      log,
      event: String((log.metadata as { event?: string } | null)?.event ?? ''),
    }))
    .filter((entry) => entry.event.startsWith('TRIZ_RESOURCE_'))
}

/** 播种可产出多类机会的项目事实：闲置资源 + 超载资源 + 高风险 + 较多任务。 */
async function seedProject(projectId: number, organizationId: number, createdBy: number) {
  const tasks: Task[] = []
  for (let i = 0; i < 25; i++) {
    tasks.push(
      await Task.create({
        projectId,
        name: `任务 ${i}`,
        status: 'not_started',
        taskType: 'task',
        priority: 'medium',
      } as any),
    )
  }

  const idle = await Resource.create({
    projectId,
    name: '闲置测试服务器',
    resourceType: 'equipment',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
  } as any)

  const overloaded = await Resource.create({
    projectId,
    name: '后端工程师',
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
  } as any)

  // 超载：两条分配合计 150%
  await ResourceAllocation.create({
    resourceId: overloaded.id,
    taskId: tasks[0]!.id,
    allocationType: 'assigned',
    allocationPercent: 100,
  } as any)
  await ResourceAllocation.create({
    resourceId: overloaded.id,
    taskId: tasks[1]!.id,
    allocationType: 'assigned',
    allocationPercent: 50,
  } as any)

  await Risk.create({
    organizationId,
    projectId,
    title: '关键路径资源不足',
    description: '关键路径上的人力资源被过度分配',
    category: 'resource',
    probability: 4,
    impact: 5,
    score: 20,
    status: 'identified',
    identifiedAt: DateTime.now(),
    createdBy,
  } as any)

  return { idleResourceId: idle.id, overloadedResourceId: overloaded.id }
}

/** 正式数据快照，用于断言分析/审查/预览不写正式记录。 */
async function formalSnapshot(projectId: number) {
  const [tasks, resources, allocations, risks] = await Promise.all([
    Task.query().where('project_id', projectId).count('* as total'),
    Resource.query().where('project_id', projectId).count('* as total'),
    ResourceAllocation.query().count('* as total'),
    Risk.query().where('project_id', projectId).count('* as total'),
  ])
  const num = (rows: any[]) => Number(rows[0]?.$extras?.total ?? 0)
  return {
    tasks: num(tasks),
    resources: num(resources),
    allocations: num(allocations),
    risks: num(risks),
  }
}

test.group('TRIZ 资源分析器 API', (group) => {
  useAuthDatabase(group)

  async function setupManager(client: any) {
    const owner = await createUser({ email: uniqueEmail('res-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const seeded = await seedProject(project.id, org.id, owner.id)
    const token = await login(client, owner)
    return { owner, org, project, token, ...seeded }
  }

  test('未认证访问返回 401', async ({ client }) => {
    const { project } = await setupManager(client)
    const res = await client.get(BASE(project.id))
    res.assertStatus(401)
  })

  test('create 返回 { data } 且带资源快照与机会候选（候选含 id）', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)

    const res = await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    assert.equal(res.status(), 200)
    const body = res.body() as {
      data: {
        id: number
        status: string
        outputHash: string
        resourceCount: number
        opportunityCount: number
        resources: any[]
        opportunities: any[]
      }
    }

    assert.isNumber(body.data.id)
    assert.isAtLeast(body.data.resources.length, 2)
    assert.isAtLeast(body.data.opportunities.length, 1)
    assert.match(body.data.outputHash, /^tro-/)

    // 候选必须带持久化 id —— 前端 review/preview 依赖它
    for (const opp of body.data.opportunities) {
      assert.isNumber(opp.id)
      assert.match(opp.opportunityKey, /^rop-/)
      assert.equal(opp.status, 'unreviewed')
    }

    // 闲置资源与超载资源都被识别
    const states = body.data.resources.map((r: any) => r.utilizationState)
    assert.include(states, 'idle')
    assert.include(states, 'overloaded')
    assert.include(
      body.data.opportunities.map((o: any) => o.opportunityType),
      'overload_relief',
    )
  })

  test('相同输入重复 create 幂等复用同一 run', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const headers = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const first = await headers(client.post(BASE(project.id))).json({})
    const second = await headers(client.post(BASE(project.id))).json({})

    const a = first.body() as { data: { id: number; outputHash: string } }
    const b = second.body() as { data: { id: number; outputHash: string } }
    assert.equal(a.data.id, b.data.id)
    assert.equal(a.data.outputHash, b.data.outputHash)
  })

  test('list / detail / resources / opportunities 返回统一 envelope', async ({
    client,
    assert,
  }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const runId = (created.body() as { data: { id: number } }).data.id

    const list = await auth(client.get(BASE(project.id)))
    assert.equal(list.status(), 200)
    const listBody = list.body() as { data: any[]; meta: any }
    assert.isArray(listBody.data)
    assert.containsSubset(listBody.meta, { page: 1 })
    assert.isAtLeast(listBody.meta.total, 1)

    const detail = await auth(client.get(`${BASE(project.id)}/${runId}`))
    assert.equal(detail.status(), 200)
    assert.equal((detail.body() as { data: { id: number } }).data.id, runId)

    const resources = await auth(client.get(`${BASE(project.id)}/${runId}/resources`))
    assert.equal(resources.status(), 200)
    const resBody = resources.body() as { data: any[]; meta: any }
    assert.isAtLeast(resBody.data.length, 2)
    assert.isNumber(resBody.meta.totalPages)

    const opps = await auth(client.get(`${BASE(project.id)}/${runId}/opportunities`))
    assert.equal(opps.status(), 200)
    assert.isAtLeast((opps.body() as { data: any[] }).data.length, 1)
  })

  test('resources 支持 resourceKind / origin 过滤', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const runId = (created.body() as { data: { id: number } }).data.id

    const human = await auth(
      client.get(`${BASE(project.id)}/${runId}/resources`).qs({ resourceKind: 'human' }),
    )
    assert.equal(human.status(), 200)
    for (const r of (human.body() as { data: any[] }).data) {
      assert.equal(r.resourceKind, 'human')
    }

    const bad = await auth(
      client.get(`${BASE(project.id)}/${runId}/resources`).qs({ resourceKind: 'people' }),
    )
    assert.equal(bad.status(), 422)
  })

  test('detail 对不存在的 run 返回 RESOURCE_NOT_FOUND', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const res = await client
      .get(`${BASE(project.id)}/999999`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    assert.equal(res.status(), 404)
    assert.equal((res.body() as { error: { code: string } }).error.code, 'RESOURCE_NOT_FOUND')
  })

  test('explain 返回确定性 fallback，不调用真实模型', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const createdBody = created.body() as { data: { id: number; opportunities: any[] } }
    const runId = createdBody.data.id
    const oppId = createdBody.data.opportunities[0]!.id

    const res = await auth(
      client.post(`${BASE(project.id)}/${runId}/opportunities/${oppId}/explain`),
    )
    assert.equal(res.status(), 200)
    const body = res.body() as {
      data: { explanation: { isFallback: boolean; provider: null; model: null; narrative: string } }
    }
    assert.isTrue(body.data.explanation.isFallback)
    assert.isNull(body.data.explanation.provider)
    assert.isNull(body.data.explanation.model)
    assert.include(body.data.explanation.narrative, '不自动执行')
  })

  test('review 流转状态并写入审查人', async ({ client, assert }) => {
    const { org, project, token, owner } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const createdBody = created.body() as { data: { id: number; opportunities: any[] } }
    const runId = createdBody.data.id
    const oppId = createdBody.data.opportunities[0]!.id

    const res = await auth(
      client.post(`${BASE(project.id)}/${runId}/opportunities/${oppId}/review`),
    ).json({ action: 'mark_reviewed' })

    assert.equal(res.status(), 200)
    const body = res.body() as { data: { status: string; reviewedBy: number } }
    assert.equal(body.data.status, 'reviewed')
    assert.equal(body.data.reviewedBy, owner.id)
  })

  test('四类 preview 返回候选输入且要求人工确认', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const createdBody = created.body() as { data: { id: number; opportunities: any[] } }
    const runId = createdBody.data.id
    const oppId = createdBody.data.opportunities[0]!.id
    const base = `${BASE(project.id)}/${runId}/opportunities/${oppId}`

    for (const path of ['workbench-preview', 'decision-preview']) {
      const res = await auth(client.post(`${base}/${path}`))
      assert.equal(res.status(), 200)
      const body = res.body() as {
        data: { requiresUserConfirmation: boolean; stale: boolean; sourceHashes: object }
      }
      assert.isTrue(body.data.requiresUserConfirmation)
      assert.isFalse(body.data.stale)
      assert.isObject(body.data.sourceHashes)
    }

    for (const path of ['draft-preview', 'resource-preview']) {
      const res = await auth(client.post(`${base}/${path}`))
      assert.equal(res.status(), 200)
      const body = res.body() as {
        data: { targetType: string; stale: boolean; targetPreview: { idempotencyKey: string } }
      }
      assert.isFalse(body.data.stale)
      assert.isString(body.data.targetPreview.idempotencyKey)
    }
  })

  test('来源过期的候选阻断 preview 与 review', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const createdBody = created.body() as { data: { id: number; opportunities: any[] } }
    const runId = createdBody.data.id
    const oppId = createdBody.data.opportunities[0]!.id

    // 模拟来源变化后候选被标 stale
    const opp = await TrizResourceOpportunityCandidate.findOrFail(oppId)
    opp.status = 'blocked_stale'
    await opp.save()

    const preview = await auth(
      client.post(`${BASE(project.id)}/${runId}/opportunities/${oppId}/workbench-preview`),
    )
    assert.equal(preview.status(), 422)

    const review = await auth(
      client.post(`${BASE(project.id)}/${runId}/opportunities/${oppId}/review`),
    ).json({ action: 'mark_reviewed' })
    assert.equal(review.status(), 422)
  })
})

test.group('TRIZ 资源分析器 API — 权限与组织隔离', (group) => {
  useAuthDatabase(group)

  test('view-only 成员可读但不可创建/审查/预览', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('res-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedProject(project.id, org.id, owner.id)

    const viewer = await createUser({ email: uniqueEmail('res-viewer') })
    await addOrgMember(org, viewer, 'member')
    const { default: ProjectMember } = await import('#models/project_member')
    const { default: ProjectRole } = await import('#models/project_role')
    const memberRole = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.MEMBER,
      description: ProjectRoleName.MEMBER,
      permissions: [] as unknown as string[],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: memberRole.id,
      isActive: true,
    })

    const ownerToken = await login(client, owner)
    const created = await client
      .post(BASE(project.id))
      .header('Authorization', `Bearer ${ownerToken}`)
      .header('x-organization-id', String(org.id))
      .json({})
    const createdBody = created.body() as { data: { id: number; opportunities: any[] } }
    const runId = createdBody.data.id
    const oppId = createdBody.data.opportunities[0]!.id

    const viewerToken = await login(client, viewer)
    const asViewer = (r: any) =>
      r.header('Authorization', `Bearer ${viewerToken}`).header('x-organization-id', String(org.id))

    // 可读
    const list = await asViewer(client.get(BASE(project.id)))
    assert.equal(list.status(), 200)

    // 不可写
    const create = await asViewer(client.post(BASE(project.id))).json({})
    assert.equal(create.status(), 403)
    assert.equal((create.body() as { error: { code: string } }).error.code, 'PERMISSION_DENIED')

    const review = await asViewer(
      client.post(`${BASE(project.id)}/${runId}/opportunities/${oppId}/review`),
    ).json({ action: 'mark_reviewed' })
    assert.equal(review.status(), 403)

    const preview = await asViewer(
      client.post(`${BASE(project.id)}/${runId}/opportunities/${oppId}/workbench-preview`),
    )
    assert.equal(preview.status(), 403)
  })

  test('无权限用户被拒绝且写入低敏拒绝审计（不泄露运行信息）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('res-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const outsider = await createUser({ email: uniqueEmail('res-outsider') })
    await addOrgMember(org, outsider, 'viewer')
    const outsiderToken = await login(client, outsider)

    const res = await client
      .get(BASE(project.id))
      .header('Authorization', `Bearer ${outsiderToken}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 403)
    const body = res.body() as { error: { code: string; message: string } }
    assert.equal(body.error.code, 'PERMISSION_DENIED')
    assert.notInclude(JSON.stringify(body), 'tro-')
    assert.notInclude(JSON.stringify(body), 'rop-')

    const auditEntries = await resourceAuditLogs(project.id)
    const denied = auditEntries.filter((entry) => entry.event === 'TRIZ_RESOURCE_PERMISSION_DENIED')
    assert.isAtLeast(denied.length, 1)
    assert.equal(denied[0]!.log.userId, outsider.id)
    const meta = JSON.stringify(denied[0]!.log.metadata ?? {})
    assert.notInclude(meta, 'Bearer')
    assert.notInclude(meta, 'rop-')
  })

  test('跨组织访问不泄露运行、资源与 hash', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('res-org-a') })
    const orgA = await createOrganization(ownerA)
    const { project: projectA } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedProject(projectA.id, orgA.id, ownerA.id)
    const tokenA = await login(client, ownerA)
    const created = await client
      .post(BASE(projectA.id))
      .header('Authorization', `Bearer ${tokenA}`)
      .header('x-organization-id', String(orgA.id))
      .json({})
    const runId = (created.body() as { data: { id: number } }).data.id

    const ownerB = await createUser({ email: uniqueEmail('res-org-b') })
    const orgB = await createOrganization(ownerB)
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`${BASE(projectA.id)}/${runId}`)
      .header('Authorization', `Bearer ${tokenB}`)
      .header('x-organization-id', String(orgB.id))

    assert.oneOf(res.status(), [403, 404])
    const raw = JSON.stringify(res.body())
    assert.notInclude(raw, 'tro-')
    assert.notInclude(raw, 'rop-')
    assert.notInclude(raw, '闲置测试服务器')
  })
})

test.group('TRIZ 资源分析器 API — 正式数据不变性与审计低敏', (group) => {
  useAuthDatabase(group)

  test('create/read/review/explain/preview 全流程不修改正式数据', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('res-immutable') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedProject(project.id, org.id, owner.id)
    const token = await login(client, owner)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const before = await formalSnapshot(project.id)

    const created = await auth(client.post(BASE(project.id))).json({})
    const createdBody = created.body() as { data: { id: number; opportunities: any[] } }
    const runId = createdBody.data.id
    const oppId = createdBody.data.opportunities[0]!.id
    const oppBase = `${BASE(project.id)}/${runId}/opportunities/${oppId}`

    await auth(client.get(`${BASE(project.id)}/${runId}/resources`))
    await auth(client.post(`${oppBase}/explain`))
    await auth(client.post(`${oppBase}/review`)).json({ action: 'mark_reviewed' })
    await auth(client.post(`${oppBase}/workbench-preview`))
    await auth(client.post(`${oppBase}/decision-preview`))
    await auth(client.post(`${oppBase}/draft-preview`))
    await auth(client.post(`${oppBase}/resource-preview`))

    const after = await formalSnapshot(project.id)
    assert.deepEqual(after, before)
  })

  test('审计事件覆盖运行/读取/审查/预览且 metadata 保持低敏', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('res-audit') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedProject(project.id, org.id, owner.id)
    const token = await login(client, owner)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const createdBody = created.body() as { data: { id: number; opportunities: any[] } }
    const runId = createdBody.data.id
    const oppId = createdBody.data.opportunities[0]!.id
    const oppBase = `${BASE(project.id)}/${runId}/opportunities/${oppId}`

    await auth(client.get(BASE(project.id)))
    await auth(client.get(`${BASE(project.id)}/${runId}/resources`))
    await auth(client.post(`${oppBase}/review`)).json({ action: 'mark_reviewed' })
    await auth(client.post(`${oppBase}/workbench-preview`))
    await auth(client.post(`${oppBase}/decision-preview`))
    await auth(client.post(`${oppBase}/draft-preview`))
    await auth(client.post(`${oppBase}/resource-preview`))
    await auth(client.post(`${oppBase}/explain`))

    const entries = await resourceAuditLogs(project.id)
    const events = new Set(entries.map((e) => e.event))

    for (const expected of [
      'TRIZ_RESOURCE_ANALYSIS_RUN',
      'TRIZ_RESOURCE_SUMMARY_READ',
      'TRIZ_RESOURCE_SNAPSHOT_READ',
      'TRIZ_RESOURCE_REVIEW',
      'TRIZ_RESOURCE_WORKBENCH_PREVIEW',
      'TRIZ_RESOURCE_DECISION_PREVIEW',
      'TRIZ_RESOURCE_DRAFT_PREVIEW',
      'TRIZ_RESOURCE_RESOURCE_PREVIEW',
      'TRIZ_RESOURCE_AI_EXPLANATION_FALLBACK',
    ]) {
      assert.isTrue(events.has(expected), `缺少审计事件 ${expected}`)
    }

    // 低敏断言：不落 prompt/模型输出/凭据/资源标签/理由正文
    for (const { log } of entries) {
      const meta = JSON.stringify(log.metadata ?? {})
      assert.notInclude(meta, 'Bearer')
      assert.notInclude(meta, 'Authorization')
      assert.notInclude(meta, 'prompt')
      assert.notInclude(meta, '闲置测试服务器')
      assert.notInclude(meta, '后端工程师')
      assert.notInclude(meta, '不自动执行')
      assert.equal(Number(log.organizationId), org.id)
      assert.equal(Number(log.projectId), project.id)
    }
  })
})
