// v3-triz-contradiction-copilot tasks 3.4 —— 被动雷达信号 API 集成测试。
//
// 覆盖（tasks 3.4 验收 + spec「信号读取的权限隔离与审计」「信号去重、过期与状态流转」）：
// - 认证 401 / 跨组织 404（统一不泄露存在性）/ 入参 422；
// - 领域权限裁剪：无 `resource:view` 时资源类信号证据被裁剪（整条信号仍可见），
//   有 `risk:view` 时风险类证据完整；
// - 列表统一 `{ data, meta }` 信封、状态与分层过滤；
// - **信号读取零写操作**（业务表与信号表行数、updated_at 均不变）；
// - 状态流转产生审计事件（信号 ID / 状态 / 前后状态 / 操作人）；重复流转 409；
// - 采纳关联分析记录形成双向可追溯；跨组织分析记录统一 404；
// - 真实检测链路（无替身）跑一次：业务表行数零变化（检测只读）且信号正确落库。
import AuditLog from '#models/audit_log'
import ChangeRequest from '#models/change_request'
import Issue from '#models/issue'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectSignal from '#models/project_signal'
import ProjectRole from '#models/project_role'
import Risk from '#models/risk'
import Task from '#models/task'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import ProjectSignalService from '#services/project_signal/project_signal_service'
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

function endpoint(projectId: number, suffix = ''): string {
  return `${API_PREFIX}/projects/${projectId}/signals${suffix}`
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
    post: (url: string) =>
      client
        .post(url)
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

/** 业务表读点：检测 / 读取都不得改动这些表。 */
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

test.group('被动雷达信号 API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('signal-api-owner') })
    const org = await createOrganization(owner)
    const { project, role } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { owner, org, project, role, token }
  }

  /** 只读观察者：有 `project:view` / `task:view` / `risk:view` / `milestone:view`，无 `resource:view`。 */
  async function addObserver(
    org: any,
    project: any,
    projectRole: any,
    client: any,
  ): Promise<{ viewer: any; token: string }> {
    const viewer = await createUser({ email: uniqueEmail('signal-api-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    const role =
      projectRole ??
      (await ProjectRole.create({
        projectId: project.id,
        name: ProjectRoleName.READONLY_OBSERVER,
        description: '只读观察者',
        permissions: [],
        isSystem: true,
      }))
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: role.id,
      isActive: true,
    })
    const token = await login(client, viewer)
    return { viewer, token }
  }

  test('未认证读取信号返回 401', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('signal-anon') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const res = await client.get(endpoint(Number(project.id)))
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('跨组织读取返回 404（不泄露存在性），且零写操作', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const outsider = await createUser({ email: uniqueEmail('signal-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const outsiderToken = await login(client, outsider)

    const before = await businessTableCounts()

    const res = await authed(client, outsiderToken, Number(outsiderOrg.id)).get(
      endpoint(Number(project.id)),
    )
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
    assert.notInclude(res.text(), String(project.name))

    // 本组织业主读取正常
    const owned = await authed(client, token, Number(org.id)).get(endpoint(Number(project.id)))
    owned.assertStatus(200)
    assert.deepEqual(await businessTableCounts(), before)
  })

  test('领域权限裁剪：无 resource:view 时资源类证据被裁剪、风险类证据完整', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, token } = await setup(client)
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'resource_overload',
      confidenceTier: 'high',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'risk_surge',
      confidenceTier: 'high',
    })

    // 只读观察者：有 project:view / task:view / risk:view / milestone:view，无 resource:view
    const { token: viewerToken } = await addObserver(org, project, undefined, client)
    const res = await authed(client, viewerToken, Number(org.id)).get(endpoint(Number(project.id)))
    res.assertStatus(200)

    const body = res.body() as { data: Array<Record<string, any>>; meta: Record<string, number> }
    assert.lengthOf(body.data, 2, '整条信号仍可见（只裁剪证据字段）')

    const resource = body.data.find((entry) => entry.signalType === 'resource_overload')!
    assert.isNull(resource.evidence, '无 resource:view ⇒ 资源类证据必须裁剪')
    assert.isTrue(resource.evidenceRedacted)
    assert.equal(resource.redactedReason, 'missing_permission:resource:view')
    assert.equal(resource.requiredPermission, 'resource:view')
    assert.notInclude(
      JSON.stringify(resource),
      'resource_overload_metric',
      '被裁剪的信号不得泄露任何证据内容',
    )

    const risk = body.data.find((entry) => entry.signalType === 'risk_surge')!
    assert.isNotNull(risk.evidence, '有 risk:view ⇒ 风险类证据完整可见')
    assert.isFalse(risk.evidenceRedacted)
    assert.equal(risk.evidence.readings.overloadRatioPercent, 50)

    // 业主（PM）两类证据都能读，无裁剪
    const ownerRes = await authed(client, token, Number(org.id)).get(endpoint(Number(project.id)))
    ownerRes.assertStatus(200)
    const ownerData = (ownerRes.body() as { data: Array<Record<string, any>> }).data
    for (const entry of ownerData) {
      assert.isNotNull(entry.evidence, `业主（PM）应可读 ${entry.signalType} 证据`)
      assert.isFalse(entry.evidenceRedacted)
    }
  })

  test('列表统一信封：状态与分层过滤、分页元数据', async ({ client, assert }) => {
    const { owner, org, project, token } = await setup(client)
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
      confidenceTier: 'low',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'risk_surge',
      confidenceTier: 'high',
    })
    await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'milestone_slip',
      confidenceTier: 'low',
      status: 'dismissed',
      observationWindow: '2026-08-25..2026-08-31',
    })

    const api = authed(client, token, Number(org.id))

    const active = await api.get(endpoint(Number(project.id)))
    active.assertStatus(200)
    const activeBody = active.body() as { data: Array<Record<string, any>>; meta: any }
    assert.lengthOf(activeBody.data, 2, '缺省只返回 open')
    assert.equal(activeBody.meta.total, 2)
    assert.equal(activeBody.meta.page, 1)
    assert.equal(activeBody.meta.totalPages, 1)
    assert.isAtLeast(activeBody.meta.perPage, 1)

    const high = await api.get(endpoint(Number(project.id), '?confidenceTier=high'))
    high.assertStatus(200)
    assert.lengthOf((high.body() as { data: unknown[] }).data, 1, '高置信过滤供项目空间信号卡使用')

    const low = await api.get(endpoint(Number(project.id), '?confidenceTier=low'))
    low.assertStatus(200)
    assert.lengthOf((low.body() as { data: unknown[] }).data, 1, '低置信过滤供角色首页建议队列使用')

    const all = await api.get(endpoint(Number(project.id), '?status=all'))
    all.assertStatus(200)
    assert.lengthOf((all.body() as { data: unknown[] }).data, 3, '历史查询含已忽略')

    const invalid = await api.get(endpoint(Number(project.id), '?signalType=s_curve_stage'))
    invalid.assertStatus(422)
    invalid.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('信号读取零写操作：行数与 updated_at 均不变', async ({ client, assert }) => {
    const { owner, org, project, token } = await setup(client)
    const seeded = await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
    })
    const before = await businessTableCounts()
    const signalCountBefore = await tableCount(ProjectSignal)
    // 以库内真实值为基准（内存对象的时间戳带毫秒，库内为秒精度）
    const rowBefore = await ProjectSignal.query().where('id', seeded.id).firstOrFail()
    const updatedAtBefore = rowBefore.updatedAt?.toISO() ?? null

    const res = await authed(client, token, Number(org.id)).get(endpoint(Number(project.id)))
    res.assertStatus(200)

    assert.deepEqual(await businessTableCounts(), before, '读取不得写业务表')
    assert.equal(await tableCount(ProjectSignal), signalCountBefore, '读取不得新增信号行')
    const reloaded = await ProjectSignal.query().where('id', seeded.id).firstOrFail()
    assert.equal(reloaded.status, 'open', '读取不得改变状态')
    assert.equal(reloaded.updatedAt?.toISO() ?? null, updatedAtBefore, '读取不得改 updated_at')
  })

  test('忽略：状态流转、前后状态、操作人、审计事件；重复流转 409', async ({ client, assert }) => {
    const { owner, org, project, token } = await setup(client)
    const seeded = await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'risk_surge',
    })
    const api = authed(client, token, Number(org.id))

    const res = await api
      .post(endpoint(Number(project.id), `/${seeded.id}/dismiss`))
      .json({ note: 'PM 已评估：本期波动在容忍区间' })
    res.assertStatus(200)
    const data = (res.body() as { data: Record<string, any> }).data
    assert.equal(data.status, 'dismissed')
    assert.equal(data.previousStatus, 'open')
    assert.equal(data.statusChangedBy, Number(owner.id))
    assert.isNotNull(data.statusChangedAt)

    const audits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'project_signal')
      .where('entity_id', seeded.id)
    const transition = audits.find(
      (entry) => (entry.metadata as Record<string, unknown>).action === 'dismiss',
    )
    assert.isNotNull(transition, '状态流转必须产生审计事件')
    const metadata = transition!.metadata as Record<string, unknown>
    assert.equal(metadata.signalStatus, 'dismissed')
    assert.equal(metadata.status, 'SUCCESS', '审计生命周期状态沿用仓库既有约定')
    assert.equal(metadata.previousStatus, 'open')
    assert.equal(metadata.signalId, Number(seeded.id))
    assert.match(String(metadata.parametersHash), /^[0-9a-f]{64}$/)
    assert.notInclude(JSON.stringify(metadata), '容忍区间', 'RL-12：备注正文不落审计')

    const again = await api.post(endpoint(Number(project.id), `/${seeded.id}/dismiss`)).json({})
    again.assertStatus(409)
    again.assertBodyContains({ error: { code: 'RESOURCE_CONFLICT' } })
  })

  test('采纳：关联分析记录并双向可追溯；跨组织分析记录 404；未知信号 404', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, token } = await setup(client)
    const seeded = await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
    })
    const analysis = await TrizCopilotAnalysis.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      createdBy: Number(owner.id),
      parentAnalysisId: null,
      sourceSignalId: null,
      contradictionType: 'administrative',
      improvingParameter: null,
      worseningParameter: null,
      candidatePrinciples: [],
      topSolutions: [],
      path: 'rule',
      confidence: 0,
      entityBinding: 'none',
      contextRefs: [],
      qualityFlags: [],
      fallbackReasons: [],
      knowledgePackVersion: 'test-pack-v1',
      statementDigest: 'd'.repeat(32),
      statementLength: 5,
      statementTruncated: false,
      humanOverride: false,
      overrideBy: null,
      overrideAt: null,
      clarificationRounds: 0,
      metricReadCount: 0,
      tokenBudget: 4000,
      estimatedTokens: 0,
      actualTokens: null,
      budgetState: 'within_budget',
      budgetReason: null,
      deletedAt: null,
    })
    const api = authed(client, token, Number(org.id))

    const res = await api
      .post(endpoint(Number(project.id), `/${seeded.id}/adopt`))
      .json({ analysisId: Number(analysis.id) })
    res.assertStatus(200)
    const data = (res.body() as { data: Record<string, any> }).data
    assert.equal(data.status, 'adopted')
    assert.equal(data.adoptedAnalysisId, Number(analysis.id))

    const linked = await TrizCopilotAnalysis.query().where('id', analysis.id).firstOrFail()
    assert.equal(Number(linked.sourceSignalId), Number(seeded.id), '分析记录可反查来源信号')

    const audit = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'project_signal')
      .where('entity_id', seeded.id)
    assert.isTrue(
      audit.some((entry) => (entry.metadata as Record<string, unknown>).action === 'adopt'),
      '采纳必须产生审计事件',
    )

    const second = await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'milestone_slip',
      observationWindow: '2026-08-25..2026-08-31',
    })
    const outsider = await createUser({ email: uniqueEmail('signal-analysis-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    await createProjectWithMember(outsiderOrg, outsider, outsider, ProjectRoleName.PROJECT_MANAGER)

    const crossOrgAnalysis = await TrizCopilotAnalysis.create({
      organizationId: Number(outsiderOrg.id),
      projectId: Number(outsiderOrg.id),
      createdBy: Number(outsider.id),
      parentAnalysisId: null,
      sourceSignalId: null,
      contradictionType: 'administrative',
      improvingParameter: null,
      worseningParameter: null,
      candidatePrinciples: [],
      topSolutions: [],
      path: 'rule',
      confidence: 0,
      entityBinding: 'none',
      contextRefs: [],
      qualityFlags: [],
      fallbackReasons: [],
      knowledgePackVersion: 'test-pack-v1',
      statementDigest: 'e'.repeat(32),
      statementLength: 5,
      statementTruncated: false,
      humanOverride: false,
      overrideBy: null,
      overrideAt: null,
      clarificationRounds: 0,
      metricReadCount: 0,
      tokenBudget: 4000,
      estimatedTokens: 0,
      actualTokens: null,
      budgetState: 'within_budget',
      budgetReason: null,
      deletedAt: null,
    })

    const crossOrg = await api
      .post(endpoint(Number(project.id), `/${second.id}/adopt`))
      .json({ analysisId: Number(crossOrgAnalysis.id) })
    crossOrg.assertStatus(404)
    crossOrg.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    const unknown = await api.post(endpoint(Number(project.id), '/999999/dismiss')).json({})
    unknown.assertStatus(404)
    unknown.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    const badBody = await api.post(endpoint(Number(project.id), `/${second.id}/adopt`)).json({
      analysisId: 'not-a-number',
    })
    badBody.assertStatus(422)
  })

  test('采纳：重复采纳 409；已忽略信号再次采纳 409；审计记录 adoptedAnalysisId 且 note 只存哈希', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const seeded = await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'progress_deviation',
    })
    const analysis = await TrizCopilotAnalysis.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      createdBy: Number(owner.id),
      parentAnalysisId: null,
      sourceSignalId: null,
      contradictionType: 'administrative',
      improvingParameter: null,
      worseningParameter: null,
      candidatePrinciples: [],
      topSolutions: [],
      path: 'rule',
      confidence: 0,
      entityBinding: 'none',
      contextRefs: [],
      qualityFlags: [],
      fallbackReasons: [],
      knowledgePackVersion: 'test-pack-v1',
      statementDigest: 'f'.repeat(32),
      statementLength: 5,
      statementTruncated: false,
      humanOverride: false,
      overrideBy: null,
      overrideAt: null,
      clarificationRounds: 0,
      metricReadCount: 0,
      tokenBudget: 4000,
      estimatedTokens: 0,
      actualTokens: null,
      budgetState: 'within_budget',
      budgetReason: null,
      deletedAt: null,
    })

    const secretNote = '内部评估：此信号涉及客户敏感信息'
    const first = await api
      .post(endpoint(Number(project.id), `/${seeded.id}/adopt`))
      .json({ analysisId: Number(analysis.id), note: secretNote })
    first.assertStatus(200)

    const audits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'project_signal')
      .where('entity_id', seeded.id)
    const transition = audits.find(
      (entry) => (entry.metadata as Record<string, unknown>).action === 'adopt',
    )
    assert.isNotNull(transition, '采纳必须产生审计事件')
    const metadata = transition!.metadata as Record<string, unknown>
    assert.equal(metadata.adoptedAnalysisId, Number(analysis.id), '审计须记录 adoptedAnalysisId')
    assert.match(String(metadata.noteHash), /^[0-9a-f]{64}$/, 'note 只存哈希（RL-12）')
    assert.notInclude(JSON.stringify(metadata), secretNote, 'RL-12：备注正文不落审计')

    // 已被采纳的信号再次调用 adopt → 409
    const again = await api
      .post(endpoint(Number(project.id), `/${seeded.id}/adopt`))
      .json({ analysisId: Number(analysis.id) })
    again.assertStatus(409)
    again.assertBodyContains({ error: { code: 'RESOURCE_CONFLICT' } })

    // 已被忽略的信号再次调用 adopt → 409
    const dismissedSignal = await seedSignal({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      signalType: 'milestone_slip',
      status: 'dismissed',
      observationWindow: '2026-08-18..2026-08-24',
    })
    const onDismissed = await api
      .post(endpoint(Number(project.id), `/${dismissedSignal.id}/adopt`))
      .json({})
    onDismissed.assertStatus(409)
    onDismissed.assertBodyContains({ error: { code: 'RESOURCE_CONFLICT' } })
  })

  test('真实检测链路（无替身）：业务表零写入且信号正确落库', async ({ client, assert }) => {
    const { owner, org, project } = await setup(client)
    const service = new ProjectSignalService()

    // 风险登记册突变：本周期新增 12 条活跃风险、上周期 6 条（环比翻倍且绝对新增 ≥5）
    const created = DateTime.fromISO('2026-09-03T00:00:00.000Z')
    for (let index = 0; index < 12; index += 1) {
      await Risk.create({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        riskCode: `RSK-SIG-${index}`,
        title: `风险 ${index}`,
        description: '检测链路测试用风险',
        category: 'schedule',
        probability: 3,
        impact: 3,
        score: 9,
        status: 'identified',
        riskLevel: 'high',
        priority: 'high',
        identifiedAt: created,
        createdAt: created,
        createdBy: Number(owner.id),
      })
    }
    for (let index = 0; index < 6; index += 1) {
      await Risk.create({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        riskCode: `RSK-SIG-PREV-${index}`,
        title: `历史风险 ${index}`,
        description: '检测链路测试用历史风险',
        category: 'schedule',
        probability: 3,
        impact: 3,
        score: 9,
        status: 'identified',
        riskLevel: 'medium',
        priority: 'medium',
        identifiedAt: DateTime.fromISO('2026-08-28T00:00:00.000Z'),
        createdAt: DateTime.fromISO('2026-08-28T00:00:00.000Z'),
        createdBy: Number(owner.id),
      })
    }

    const before = await businessTableCounts()
    const result = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
      evaluatedAt: '2026-09-07T00:00:00.000Z',
    })

    assert.isAtLeast(result.created.length, 1, '风险登记册突变必须被检测到')
    const riskSignal = result.created.find((signal) => signal.signalType === 'risk_surge')
    assert.isNotNull(riskSignal, '应产出风险突变信号')
    assert.equal(riskSignal!.observationWindow, WINDOW)
    assert.isTrue(Boolean(riskSignal!.evidence['metric']))
    assert.deepEqual(
      await businessTableCounts(),
      before,
      '检测链路必须零业务表写入（风险 / 任务 / 议题 / 变更请求行数不变）',
    )

    // 落库信号可通过 API 读到，且证据可复算（阈值 / 基期 / 覆盖周期数）
    const tokenRes = await client
      .post(`${API_PREFIX}/auth/login`)
      .json({ email: owner.email, password: STRONG_PASSWORD })
    const token = (tokenRes.body() as { data: { accessToken: string } }).data.accessToken
    const list = await authed(client, token, Number(org.id)).get(endpoint(Number(project.id)))
    list.assertStatus(200)
    const data = (list.body() as { data: Array<Record<string, any>> }).data
    const apiRisk = data.find((entry) => entry.signalType === 'risk_surge')!
    assert.isNotNull(apiRisk)
    assert.isNotNull(apiRisk.evidence.thresholds.riskGrowthRatio)
    assert.equal(apiRisk.evidence.window.previousTo, '2026-08-31')
    assert.isAtLeast(apiRisk.evidence.coveredCycles, 1)
    assert.isString(apiRisk.tierReasons.amplitude.detail)

    // 同窗口重复检测不产生重复记录
    const second = await service.detectAndPersist({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
      asOfDate: '2026-09-07',
      evaluatedAt: '2026-09-07T01:00:00.000Z',
    })
    assert.lengthOf(second.created, 0, '同观测窗重复检测命中既有记录')
    const rows = await ProjectSignal.query().where('project_id', project.id)
    assert.lengthOf(rows, result.created.length)
  })

  test('POST /projects/:projectId/signals/detect 手动触发检测：返回计数摘要、幂等去重、鉴权隔离与零业务写', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, token } = await setup(client)
    const url = endpoint(Number(project.id), '/detect')

    // ① 未认证 401
    const unauthed = await client.post(url).json({})
    unauthed.assertStatus(401)
    unauthed.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })

    // ② 越权 403（非项目成员）
    const outsider = await createUser({ email: uniqueEmail('signal-detect-outsider') })
    await addOrgMember(org, outsider, 'viewer')
    const outsiderToken = await login(client, outsider)
    const forbidden = await authed(client, outsiderToken, Number(org.id)).post(url).json({})
    forbidden.assertStatus(403)
    forbidden.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    // ③ 跨组织 404（不泄露存在性）
    const otherOwner = await createUser({ email: uniqueEmail('signal-detect-other-owner') })
    const otherOrg = await createOrganization(otherOwner)
    const otherToken = await login(client, otherOwner)
    const notFound = await authed(client, otherToken, Number(otherOrg.id)).post(url).json({})
    notFound.assertStatus(404)
    notFound.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    // 业务数据准备：造出风险突变条件
    const createdDate = DateTime.fromISO('2026-09-03T00:00:00.000Z')
    for (let index = 0; index < 12; index += 1) {
      await Risk.create({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        riskCode: `RSK-DETECT-${index}`,
        title: `检测测试风险 ${index}`,
        description: '手动检测端点测试风险',
        category: 'schedule',
        probability: 3,
        impact: 3,
        score: 9,
        status: 'identified',
        riskLevel: 'high',
        priority: 'high',
        identifiedAt: createdDate,
        createdAt: createdDate,
        createdBy: Number(owner.id),
      })
    }
    for (let index = 0; index < 6; index += 1) {
      await Risk.create({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        riskCode: `RSK-DETECT-PREV-${index}`,
        title: `检测测试历史风险 ${index}`,
        description: '手动检测端点测试历史风险',
        category: 'schedule',
        probability: 3,
        impact: 3,
        score: 9,
        status: 'identified',
        riskLevel: 'medium',
        priority: 'medium',
        identifiedAt: DateTime.fromISO('2026-08-28T00:00:00.000Z'),
        createdAt: DateTime.fromISO('2026-08-28T00:00:00.000Z'),
        createdBy: Number(owner.id),
      })
    }

    const beforeBiz = await businessTableCounts()

    // ④ 首次触发检测：生成信号并返回计数摘要
    const res = await authed(client, token, Number(org.id))
      .post(url)
      .json({ asOfDate: '2026-09-07', windowDays: 7 })

    res.assertStatus(200)
    const body = (res.body() as { data: Record<string, any> }).data
    assert.isAtLeast(body.createdCount, 1, '应有新信号生成')
    assert.isAtLeast(body.totalDetected, 1)
    assert.equal(body.asOfDate, '2026-09-07')

    // 零业务表写入断言
    const afterBiz = await businessTableCounts()
    assert.deepEqual(afterBiz, beforeBiz, '检测全程业务表零变更')

    const initialSignalCount = await tableCount(ProjectSignal)
    assert.isAtLeast(initialSignalCount, 1)

    // ⑤ 相同参数重复触发：命中既有幂等键，createdCount 为 0，不产生重复行
    const repeatRes = await authed(client, token, Number(org.id))
      .post(url)
      .json({ asOfDate: '2026-09-07', windowDays: 7 })

    repeatRes.assertStatus(200)
    const repeatBody = (repeatRes.body() as { data: Record<string, any> }).data
    assert.equal(repeatBody.createdCount, 0, '相同参数重复触发 createdCount 应为 0')
    assert.isAtLeast(repeatBody.refreshedCount, 1, '应刷新既有记录')

    const afterRepeatSignalCount = await tableCount(ProjectSignal)
    assert.equal(afterRepeatSignalCount, initialSignalCount, '不应产生重复行')

    // 审计事件断言：AI_RECOMMENDATION_GENERATED (action: manual_detect)
    const auditLogs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('entity_type', 'project_signal')
    assert.isTrue(
      auditLogs.some(
        (entry) => (entry.metadata as Record<string, unknown>)?.action === 'manual_detect',
      ),
      '手动检测必须记录审计事件',
    )
  })
})
