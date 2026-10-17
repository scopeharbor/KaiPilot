import AuditLog from '#models/audit_log'
import Risk from '#models/risk'
import Task from '#models/task'
import TrizEvolutionTrendRiskCandidate from '#models/triz_evolution_trend_risk_candidate'
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
// TRIZ 进化趋势分析 API 功能测试（v3-triz-evolution-trend-analysis §5.5–§5.7、§3.6、§3.8、§6.8）
//
// 覆盖：JWT 门禁、RBAC（view/manage/aiExplain 分离）、组织隔离不泄露、统一 envelope、
// 幂等复用、审查状态流转、四类 preview、stale 阻断、source hash 失配、正式数据零写入、低敏审计。
// 默认全程不调用真实模型（AI 说明走确定性 fallback）。
// ===========================================================================

const API_PREFIX = '/api/v1'
const BASE = (projectId: number) =>
  `${API_PREFIX}/projects/${projectId}/triz/evolution-trend-analyses`

async function login(client: any, user: any) {
  const r = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  return (r.body() as { data: { accessToken: string } }).data.accessToken
}

/** 读取某项目下本 change 的审计事件。 */
async function evolutionAuditLogs(projectId: number) {
  const logs = await AuditLog.query().where('project_id', projectId)
  return logs
    .map((log) => ({
      log,
      event: String((log.metadata as { event?: string } | null)?.event ?? ''),
    }))
    .filter((entry) => entry.event.startsWith('TRIZ_EVOLUTION_TREND_'))
}

/** 播种可产出多类风险候选的项目事实：阻塞任务 + 高风险。
 *  注意：项目角色与成员由 createProjectWithMember 负责，这里只补任务/风险事实。 */
async function seedProject(projectId: number, organizationId: number, createdBy: number) {
  // 多个任务，部分阻塞（触发 information_flow_delay）
  for (let i = 0; i < 25; i++) {
    await Task.create({
      projectId,
      name: `任务 ${i}`,
      status: i < 5 ? 'blocked' : 'not_started',
      taskType: 'task',
      priority: 'medium',
    } as any)
  }

  // 高风险（触发 ideality_decline 的 harm 信号）
  await Risk.create({
    organizationId,
    projectId,
    title: '关键技术风险',
    description: '关键路径存在重大技术不确定性',
    category: 'technical',
    probability: 4,
    impact: 5,
    score: 20,
    status: 'identified',
    identifiedAt: DateTime.now(),
    createdBy,
  } as any)
}

/** 正式数据快照，用于断言分析/审查/预览不写正式记录。 */
async function formalSnapshot(projectId: number) {
  const [tasks, risks, allocations] = await Promise.all([
    Task.query().where('project_id', projectId).count('* as total'),
    Risk.query().where('project_id', projectId).count('* as total'),
    Risk.query().count('* as total'),
  ])
  const num = (rows: any[]) => Number(rows[0]?.$extras?.total ?? 0)
  return { tasks: num(tasks), risks: num(risks), allRisks: num(allocations) }
}

test.group('TRIZ 进化趋势分析 API', (group) => {
  useAuthDatabase(group)

  async function setupManager(client: any) {
    const owner = await createUser({ email: uniqueEmail('et-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedProject(project.id, org.id, owner.id)
    const token = await login(client, owner)
    return { owner, org, project, token }
  }

  test('未认证访问返回 401', async ({ client }) => {
    const { project } = await setupManager(client)
    const res = await client.get(BASE(project.id))
    res.assertStatus(401)
  })

  test('create 返回 { data } 且带 8 趋势与风险候选（候选含 id）', async ({ client, assert }) => {
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
        trendCount: number
        riskCount: number
        trends: any[]
        risks: any[]
      }
    }

    assert.isNumber(body.data.id)
    assert.equal(body.data.trendCount, 8)
    assert.lengthOf(body.data.trends, 8)
    assert.isAtLeast(body.data.risks.length, 1)
    assert.match(body.data.outputHash, /^tet-t-/)

    // 候选必须带持久化 id —— 前端 review/preview 依赖它
    for (const risk of body.data.risks) {
      assert.isNumber(risk.id)
      assert.match(risk.riskKey, /^trr-/)
      assert.equal(risk.status, 'unreviewed')
      assert.match(risk.outputHash, /^tet-ro-/)
    }
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

  test('list / detail / trends / risks / history 返回统一 envelope', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const runId = (created.body() as { data: { id: number } }).data.id

    const list = await auth(client.get(BASE(project.id)))
    assert.equal(list.status(), 200)
    const listBody = list.body() as { data: any[]; meta: any }
    assert.isArray(listBody.data)
    assert.isAtLeast(listBody.meta.total, 1)

    const detail = await auth(client.get(`${BASE(project.id)}/${runId}`))
    assert.equal(detail.status(), 200)
    assert.equal((detail.body() as { data: { id: number } }).data.id, runId)

    const trends = await auth(client.get(`${BASE(project.id)}/${runId}/trends`))
    assert.equal(trends.status(), 200)
    const trendBody = trends.body() as { data: any[]; meta: any }
    assert.lengthOf(trendBody.data, 8)
    assert.isNumber(trendBody.meta.totalPages)

    const risks = await auth(client.get(`${BASE(project.id)}/${runId}/risks`))
    assert.equal(risks.status(), 200)
    assert.isAtLeast((risks.body() as { data: any[] }).data.length, 1)

    const history = await auth(client.get(`${BASE(project.id)}/${runId}/history`))
    assert.equal(history.status(), 200)
    assert.equal((history.body() as { data: { runId: number } }).data.runId, runId)
  })

  test('risks 支持 status / severity 过滤', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const runId = (created.body() as { data: { id: number } }).data.id

    const unreviewed = await auth(
      client.get(`${BASE(project.id)}/${runId}/risks`).qs({ status: 'unreviewed' }),
    )
    assert.equal(unreviewed.status(), 200)
    for (const r of (unreviewed.body() as { data: any[] }).data) {
      assert.equal(r.status, 'unreviewed')
    }

    const bad = await auth(
      client.get(`${BASE(project.id)}/${runId}/risks`).qs({ riskType: 'bogus' }),
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
    const createdBody = created.body() as { data: { id: number; risks: any[] } }
    const runId = createdBody.data.id
    const riskId = createdBody.data.risks[0]!.id

    const res = await auth(client.post(`${BASE(project.id)}/${runId}/risks/${riskId}/explain`))
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
    const createdBody = created.body() as { data: { id: number; risks: any[] } }
    const runId = createdBody.data.id
    const riskId = createdBody.data.risks[0]!.id

    const res = await auth(client.post(`${BASE(project.id)}/${runId}/risks/${riskId}/review`)).json(
      { action: 'mark_reviewed' },
    )

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
    const createdBody = created.body() as { data: { id: number; risks: any[] } }
    const runId = createdBody.data.id
    const riskId = createdBody.data.risks[0]!.id
    const base = `${BASE(project.id)}/${runId}/risks/${riskId}`

    for (const path of ['workbench-preview', 'decision-preview', 'draft-preview', 'risk-preview']) {
      const res = await auth(client.post(`${base}/${path}`))
      assert.equal(res.status(), 200, `${path} 应成功`)
      const body = res.body() as {
        data: {
          runId: number
          requiresUserConfirmation: boolean
          stale: boolean
          sourceHashes: object
        }
      }
      // runId 必须是真正的 run id（修复前是 risk id）
      assert.equal(body.data.runId, runId)
      assert.isTrue(body.data.requiresUserConfirmation)
      assert.isFalse(body.data.stale)
      assert.isObject(body.data.sourceHashes)
    }
  })

  test('来源过期（blocked_stale）的候选阻断 preview 与 review', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const createdBody = created.body() as { data: { id: number; risks: any[] } }
    const runId = createdBody.data.id
    const riskId = createdBody.data.risks[0]!.id

    // 模拟来源变化后候选被标 stale
    const candidate = await TrizEvolutionTrendRiskCandidate.findOrFail(riskId)
    candidate.status = 'blocked_stale'
    await candidate.save()

    const preview = await auth(
      client.post(`${BASE(project.id)}/${runId}/risks/${riskId}/workbench-preview`),
    )
    assert.equal(preview.status(), 422)

    const review = await auth(
      client.post(`${BASE(project.id)}/${runId}/risks/${riskId}/review`),
    ).json({ action: 'mark_reviewed' })
    assert.equal(review.status(), 422)
  })

  test('source hash 失配时 preview 标记 stale 并阻断', async ({ client, assert }) => {
    const { org, project, token } = await setupManager(client)
    const auth = (r: any) =>
      r.header('Authorization', `Bearer ${token}`).header('x-organization-id', String(org.id))

    const created = await auth(client.post(BASE(project.id))).json({})
    const createdBody = created.body() as { data: { id: number; risks: any[] } }
    const runId = createdBody.data.id
    const riskId = createdBody.data.risks[0]!.id

    // 传入与快照不同的 currentSourceHashes → 应被 stale 阻断
    const res = await auth(
      client.post(`${BASE(project.id)}/${runId}/risks/${riskId}/workbench-preview`),
    ).json({ currentSourceHashes: { tasks_wbs: 'completely-different-hash' } })
    assert.equal(res.status(), 422)
  })
})

test.group('TRIZ 进化趋势分析 API — 权限与组织隔离', (group) => {
  useAuthDatabase(group)

  test('view-only 成员可读但不可创建/审查/预览', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('et-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedProject(project.id, org.id, owner.id)

    const viewer = await createUser({ email: uniqueEmail('et-viewer') })
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
    const createdBody = created.body() as { data: { id: number; risks: any[] } }
    const runId = createdBody.data.id
    const riskId = createdBody.data.risks[0]!.id

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
      client.post(`${BASE(project.id)}/${runId}/risks/${riskId}/review`),
    ).json({ action: 'mark_reviewed' })
    assert.equal(review.status(), 403)

    const preview = await asViewer(
      client.post(`${BASE(project.id)}/${runId}/risks/${riskId}/workbench-preview`),
    )
    assert.equal(preview.status(), 403)
  })

  test('无权限用户被拒绝且写入低敏拒绝审计（不泄露运行信息）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('et-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const outsider = await createUser({ email: uniqueEmail('et-outsider') })
    await addOrgMember(org, outsider, 'viewer')
    const outsiderToken = await login(client, outsider)

    const res = await client
      .get(BASE(project.id))
      .header('Authorization', `Bearer ${outsiderToken}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 403)
    const body = res.body() as { error: { code: string; message: string } }
    assert.equal(body.error.code, 'PERMISSION_DENIED')
    assert.notInclude(JSON.stringify(body), 'tet-')
    assert.notInclude(JSON.stringify(body), 'trr-')

    const auditEntries = await evolutionAuditLogs(project.id)
    const denied = auditEntries.filter(
      (entry) => entry.event === 'TRIZ_EVOLUTION_TREND_PERMISSION_DENIED',
    )
    assert.isAtLeast(denied.length, 1)
    assert.equal(denied[0]!.log.userId, outsider.id)
    const meta = JSON.stringify(denied[0]!.log.metadata ?? {})
    assert.notInclude(meta, 'Bearer')
    assert.notInclude(meta, 'trr-')
  })

  test('跨组织访问不泄露运行、趋势与 hash', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('et-org-a') })
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

    const ownerB = await createUser({ email: uniqueEmail('et-org-b') })
    const orgB = await createOrganization(ownerB)
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`${BASE(projectA.id)}/${runId}`)
      .header('Authorization', `Bearer ${tokenB}`)
      .header('x-organization-id', String(orgB.id))

    assert.oneOf(res.status(), [403, 404])
    const raw = JSON.stringify(res.body())
    assert.notInclude(raw, 'tet-')
    assert.notInclude(raw, 'trr-')
    assert.notInclude(raw, '完备性')
  })
})

test.group('TRIZ 进化趋势分析 API — 正式数据不变性与审计低敏', (group) => {
  useAuthDatabase(group)

  test('create/read/review/explain/preview 全流程不修改正式数据', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('et-immutable') })
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
    const createdBody = created.body() as { data: { id: number; risks: any[] } }
    const runId = createdBody.data.id
    const riskId = createdBody.data.risks[0]!.id
    const riskBase = `${BASE(project.id)}/${runId}/risks/${riskId}`

    await auth(client.get(`${BASE(project.id)}/${runId}/trends`))
    await auth(client.get(`${BASE(project.id)}/${runId}/risks`))
    await auth(client.get(`${BASE(project.id)}/${runId}/history`))
    await auth(client.post(`${riskBase}/explain`))
    await auth(client.post(`${riskBase}/review`)).json({ action: 'mark_reviewed' })
    await auth(client.post(`${riskBase}/workbench-preview`))
    await auth(client.post(`${riskBase}/decision-preview`))
    await auth(client.post(`${riskBase}/draft-preview`))
    await auth(client.post(`${riskBase}/risk-preview`))

    const after = await formalSnapshot(project.id)
    assert.deepEqual(after, before)
  })

  test('审计事件覆盖运行/读取/审查/预览且 metadata 保持低敏', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('et-audit') })
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
    const createdBody = created.body() as { data: { id: number; risks: any[] } }
    const runId = createdBody.data.id
    const riskId = createdBody.data.risks[0]!.id
    const riskBase = `${BASE(project.id)}/${runId}/risks/${riskId}`

    await auth(client.get(BASE(project.id)))
    await auth(client.post(`${riskBase}/review`)).json({ action: 'mark_reviewed' })
    await auth(client.post(`${riskBase}/workbench-preview`))
    await auth(client.post(`${riskBase}/explain`))

    const entries = await evolutionAuditLogs(project.id)
    const events = new Set(entries.map((e) => e.event))

    for (const expected of [
      'TRIZ_EVOLUTION_TREND_ANALYSIS_RUN',
      'TRIZ_EVOLUTION_TREND_READ',
      'TRIZ_EVOLUTION_TREND_RISK_REVIEW',
      'TRIZ_EVOLUTION_TREND_WORKBENCH_PREVIEW',
      'TRIZ_EVOLUTION_TREND_AI_EXPLANATION_FALLBACK',
    ]) {
      assert.isTrue(events.has(expected), `缺少审计事件 ${expected}`)
    }

    // 低敏断言：不落 prompt/模型输出/凭据/理由正文
    for (const { log } of entries) {
      const meta = JSON.stringify(log.metadata ?? {})
      assert.notInclude(meta, 'Bearer')
      assert.notInclude(meta, 'Authorization')
      assert.notInclude(meta, 'prompt')
      assert.notInclude(meta, '不自动执行')
      assert.equal(Number(log.organizationId), org.id)
      assert.equal(Number(log.projectId), project.id)
    }
  })
})
