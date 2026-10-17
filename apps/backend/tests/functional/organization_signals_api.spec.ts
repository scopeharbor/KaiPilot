/**
 * v3-triz-copilot-followups 任务 4.2 —— 组织级信号只读 API 集成测试。
 *
 * 覆盖：
 * ① 返回当前组织全部项目信号 + 正确分页元数据；
 * ② status / confidenceTier / signalType 过滤生效；
 * ③ 无对应领域权限时 evidence 被裁剪且 evidenceRedacted: true；
 * ④ 跨组织 404（不泄露组织存在性）；
 * ⑤ 未认证 401；
 * ⑥ 零写断言（业务表与信号表行数、updated_at 均不变）。
 */
import ChangeRequest from '#models/change_request'
import Issue from '#models/issue'
import Project from '#models/project'
import ProjectSignal from '#models/project_signal'
import Risk from '#models/risk'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const API_PREFIX = '/api/v1'
const WINDOW = '2026-09-01..2026-09-07'
const EXPIRES_AT = new Date('2026-09-21T23:59:59.000Z')

function orgSignalsUrl(organizationId: number | string, qs = ''): string {
  return `${API_PREFIX}/organizations/${organizationId}/signals${qs}`
}

async function login(client: any, user: any): Promise<string> {
  const res = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

function authed(client: any, token: string, orgId: number) {
  return {
    get: (url: string) =>
      client
        .get(url)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(orgId)),
  }
}

async function tableCount(model: { query: () => any }): Promise<number> {
  const rows = (await model.query().count('* as total')) as unknown as Array<{
    $extras: { total: number | string }
  }>
  return Number(rows[0]?.$extras?.total ?? 0)
}

async function businessTableCounts(): Promise<Record<string, number>> {
  return {
    projects: await tableCount(Project),
    tasks: await tableCount(Task),
    risks: await tableCount(Risk),
    issues: await tableCount(Issue),
    changeRequests: await tableCount(ChangeRequest),
  }
}

async function seedSignal(input: {
  organizationId: number
  projectId: number
  userId: number
  signalType: 'progress_deviation' | 'risk_surge' | 'resource_overload' | 'milestone_slip'
  confidenceTier?: 'low' | 'high'
  status?: 'open' | 'dismissed' | 'adopted' | 'expired'
  observationWindow?: string
  expiresAt?: Date
}): Promise<ProjectSignal> {
  return ProjectSignal.create({
    organizationId: input.organizationId,
    projectId: input.projectId,
    signalType: input.signalType,
    confidenceTier: input.confidenceTier ?? 'low',
    tierReasons: {
      amplitude: { hit: true, detail: 'significant_amplitude_met' },
      consecutive: { hit: false, detail: 'consecutive_cycles_1_of_2' },
      completeness: { hit: true, detail: 'key_fields_complete' },
      composite: { hit: false, detail: 'composite_types_1_of_2' },
      window: input.observationWindow ?? WINDOW,
      evaluatedAt: '2026-09-07T00:00:00.000Z',
      compositeTypes: [input.signalType],
      previousTier: null,
    },
    severity: input.confidenceTier === 'high' ? 'critical' : 'warning',
    evidence: {
      metric: `${input.signalType}_metric`,
      window: {
        from: '2026-09-01',
        to: '2026-09-07',
        previousFrom: '2026-08-25',
        previousTo: '2026-08-31',
        days: 7,
      },
      readings: { overloadRatioPercent: 50, overloadedResourceCount: 2 },
      thresholds: { ratioPercent: 25 },
      coveredCycles: 2,
      hitConditions: [],
      compositeTypes: [input.signalType],
      entityRefs: {},
      truncated: false,
    },
    idempotencyKey: `${input.signalType}-${input.observationWindow ?? WINDOW}-${Math.random()}`
      .padEnd(64, '0')
      .slice(0, 64),
    observationWindow: input.observationWindow ?? WINDOW,
    expiresAt: DateTime.fromJSDate(input.expiresAt ?? EXPIRES_AT),
    status: input.status ?? 'open',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: input.userId,
    deletedAt: null,
  })
}

test.group('组织级信号 API (Task 4.2)', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('org-signal-owner') })
    const org = await createOrganization(owner)
    const { project: project1 } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const { project: project2 } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { owner, org, project1, project2, token }
  }

  /** 只读观察者：有 org viewer（READONLY_OBSERVER），具备 task/risk/milestone:view，无 resource:view。 */
  async function addObserver(org: any, client: any) {
    const viewer = await createUser({ email: uniqueEmail('org-signal-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer)
    return { viewer, token }
  }

  test('⑤ 未认证读取组织信号返回 401', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('org-signal-anon') })
    const org = await createOrganization(owner)
    const res = await client.get(orgSignalsUrl(Number(org.id)))
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('④ 跨组织读取返回 404（不泄露组织存在性），且零写操作', async ({ client, assert }) => {
    const { org, token } = await setup(client)
    const outsider = await createUser({ email: uniqueEmail('org-signal-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const outsiderToken = await login(client, outsider)

    const before = await businessTableCounts()

    // 外人访问当前组织
    const res = await authed(client, outsiderToken, Number(outsiderOrg.id)).get(
      orgSignalsUrl(Number(org.id)),
    )
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    // 本组织 owner 读取正常
    const owned = await authed(client, token, Number(org.id)).get(orgSignalsUrl(Number(org.id)))
    owned.assertStatus(200)
    assert.deepEqual(await businessTableCounts(), before)
  })

  test('① 返回当前组织全部项目信号 + 正确分页元数据', async ({ client, assert }) => {
    const { owner, org, project1, project2, token } = await setup(client)

    // 在 project1 和 project2 下各种植信号
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project1.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
      confidenceTier: 'low',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project2.id),
      userId: Number(owner.id),
      signalType: 'risk_surge',
      confidenceTier: 'high',
    })

    const api = authed(client, token, Number(org.id))
    const res = await api.get(orgSignalsUrl(Number(org.id)))
    res.assertStatus(200)

    const body = res.body() as { data: Array<Record<string, any>>; meta: Record<string, any> }
    assert.lengthOf(body.data, 2, '聚合当前组织下全部项目的信号')
    assert.equal(body.meta.total, 2)
    assert.equal(body.meta.page, 1)
    assert.equal(body.meta.perPage, 20)
    assert.equal(body.meta.totalPages, 1)

    // 验证 DTO 字段与项目级一致
    const first = body.data[0]
    assert.isNumber(first.id)
    assert.equal(first.organizationId, Number(org.id))
    assert.isNumber(first.projectId)
    assert.isString(first.signalType)
    assert.isString(first.signalTypeLabel)
    assert.isString(first.confidenceTier)
    assert.isObject(first.tierReasons)
    assert.isString(first.severity)
    assert.isBoolean(first.evidenceRedacted)
    assert.isString(first.requiredPermission)
    assert.isString(first.idempotencyKey)
    assert.isString(first.observationWindow)
    assert.equal(first.status, 'open')
  })

  test('② status/confidenceTier/signalType 过滤生效', async ({ client, assert }) => {
    const { owner, org, project1, project2, token } = await setup(client)

    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project1.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
      confidenceTier: 'low',
      status: 'open',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project2.id),
      userId: Number(owner.id),
      signalType: 'risk_surge',
      confidenceTier: 'high',
      status: 'open',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project1.id),
      userId: Number(owner.id),
      signalType: 'milestone_slip',
      confidenceTier: 'low',
      status: 'dismissed',
    })

    const api = authed(client, token, Number(org.id))

    // 默认 status=open 返回 2 条
    const openRes = await api.get(orgSignalsUrl(Number(org.id)))
    openRes.assertStatus(200)
    assert.lengthOf(openRes.body().data, 2)

    // status=all 返回 3 条
    const allRes = await api.get(orgSignalsUrl(Number(org.id), '?status=all'))
    allRes.assertStatus(200)
    assert.lengthOf(allRes.body().data, 3)

    // confidenceTier=high 返回 1 条
    const highRes = await api.get(orgSignalsUrl(Number(org.id), '?confidenceTier=high'))
    highRes.assertStatus(200)
    assert.lengthOf(highRes.body().data, 1)
    assert.equal(highRes.body().data[0].signalType, 'risk_surge')

    // confidenceTier=low 返回 1 条 (open 状态下)
    const lowRes = await api.get(orgSignalsUrl(Number(org.id), '?confidenceTier=low'))
    lowRes.assertStatus(200)
    assert.lengthOf(lowRes.body().data, 1)
    assert.equal(lowRes.body().data[0].signalType, 'progress_deviation')

    // signalType=risk_surge 返回 1 条
    const typeRes = await api.get(orgSignalsUrl(Number(org.id), '?signalType=risk_surge'))
    typeRes.assertStatus(200)
    assert.lengthOf(typeRes.body().data, 1)
  })

  test('⑦ 按信号编号定位：signalId 精确查，并附项目名与项目编号', async ({ client, assert }) => {
    const { owner, org, project1, project2, token } = await setup(client)
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project2.id),
      userId: Number(owner.id),
      signalType: 'risk_surge',
      confidenceTier: 'low',
      status: 'open',
    })
    const target = await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project1.id),
      userId: Number(owner.id),
      signalType: 'milestone_slip',
      confidenceTier: 'low',
      status: 'adopted',
    })

    const api = authed(client, token, Number(org.id))
    const res = await api.get(orgSignalsUrl(Number(org.id), `?signalId=${target.id}&status=all`))
    res.assertStatus(200)
    const data = res.body().data
    assert.lengthOf(data, 1)
    assert.equal(data[0].id, Number(target.id))
    assert.equal(data[0].status, 'adopted')
    assert.equal(data[0].projectName, project1.name)
    assert.equal(data[0].projectCode, project1.code?.trim() || `PROJ-${project1.id}`)
  })

  test('③ 无对应领域权限时 evidence 被裁剪且 evidenceRedacted: true', async ({
    client,
    assert,
  }) => {
    const { owner, org, project1, project2, token: ownerToken } = await setup(client)

    // 种植 resource_overload 信号（需要 resource:view）与 risk_surge 信号（需要 risk:view）
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project1.id),
      userId: Number(owner.id),
      signalType: 'resource_overload',
      confidenceTier: 'high',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project2.id),
      userId: Number(owner.id),
      signalType: 'risk_surge',
      confidenceTier: 'high',
    })

    // 组织 viewer：具备 risk:view，无 resource:view
    const { token: viewerToken } = await addObserver(org, client)
    const res = await authed(client, viewerToken, Number(org.id)).get(orgSignalsUrl(Number(org.id)))
    res.assertStatus(200)

    const data = res.body().data as Array<Record<string, any>>
    assert.lengthOf(data, 2, '整条信号记录仍可见')

    const resourceSignal = data.find((entry) => entry.signalType === 'resource_overload')!
    assert.isNull(resourceSignal.evidence, '无 resource:view ⇒ 证据必须被置 null')
    assert.isTrue(resourceSignal.evidenceRedacted, '必须标注 evidenceRedacted: true')
    assert.equal(resourceSignal.redactedReason, 'missing_permission:resource:view')
    assert.notInclude(JSON.stringify(resourceSignal), 'overloadRatioPercent')

    const riskSignal = data.find((entry) => entry.signalType === 'risk_surge')!
    assert.isNotNull(riskSignal.evidence, '具备 risk:view ⇒ 证据可见')
    assert.isFalse(riskSignal.evidenceRedacted)
    assert.isNull(riskSignal.redactedReason)

    // Owner 两类证据均可见
    const ownerRes = await authed(client, ownerToken, Number(org.id)).get(
      orgSignalsUrl(Number(org.id)),
    )
    ownerRes.assertStatus(200)
    for (const entry of ownerRes.body().data) {
      assert.isNotNull(entry.evidence)
      assert.isFalse(entry.evidenceRedacted)
    }
  })

  test('⑥ 零写断言：组织级信号读取全程数据库零写入', async ({ client, assert }) => {
    const { owner, org, project1, token } = await setup(client)
    const seeded = await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project1.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
    })

    const beforeBiz = await businessTableCounts()
    const signalCountBefore = await tableCount(ProjectSignal)
    const rowBefore = await ProjectSignal.query().where('id', seeded.id).firstOrFail()
    const updatedAtBefore = rowBefore.updatedAt?.toISO() ?? null

    const res = await authed(client, token, Number(org.id)).get(orgSignalsUrl(Number(org.id)))
    res.assertStatus(200)

    assert.deepEqual(await businessTableCounts(), beforeBiz, '读取不得写任何业务表')
    assert.equal(await tableCount(ProjectSignal), signalCountBefore, '不得增加或删除信号记录')

    const rowAfter = await ProjectSignal.query().where('id', seeded.id).firstOrFail()
    assert.equal(rowAfter.status, 'open', '状态不得发生改变')
    assert.equal(rowAfter.updatedAt?.toISO() ?? null, updatedAtBefore, 'updatedAt 必须保持不变')
  })
})
