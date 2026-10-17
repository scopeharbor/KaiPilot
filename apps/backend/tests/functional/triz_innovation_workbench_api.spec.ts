import DraftLayerSession from '#models/draft_layer_session'
import AuditLog from '#models/audit_log'
import ChangeRequest from '#models/change_request'
import CompilerArtifact from '#models/compiler_artifact'
import CompilerRun from '#models/compiler_run'
import CompilerStageEvent from '#models/compiler_stage_event'
import GanttBaseline from '#models/gantt_baseline'
import ProjectContradiction from '#models/project_contradiction'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import ResourceAllocation from '#models/resource_allocation'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
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

async function login(client: any, user: any) {
  const res = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

async function seedContradiction(args: {
  orgId: number
  projectId: number
  key: string
  inputSignature?: string
  stale?: boolean
}) {
  return ProjectContradiction.create({
    organizationId: args.orgId,
    projectId: args.projectId,
    key: args.key,
    dedupeKey: `iw-api-${args.key}`,
    type: 'technical',
    ruleId: 'CD-001',
    ruleVersion: '1.0.0',
    improvingParameterKey: 'duration',
    worseningParameterKey: 'cost',
    improvingDirection: null,
    worseningDirection: null,
    parameterKey: null,
    requirementA: null,
    requirementB: null,
    severity: 'high',
    confidence: 0.8,
    title: '工期与资源负载对立',
    evidence: [],
    suggestedPrinciples: [],
    inputSignature: args.inputSignature ?? `sig-${args.key}`,
    outputHash: null,
    status: 'confirmed',
    stale: args.stale ?? false,
    staleReason: args.stale ? '来源数据已变化' : null,
    relatedChangeRequestId: null,
    confirmedBy: null,
    confirmedAt: null,
    dismissedBy: null,
    dismissedAt: null,
    dismissReason: null,
    aiExplanation: null,
  })
}

async function seedAnalysisArtifact(args: {
  orgId: number
  projectId: number
  userId: number
  artifactId: string
  contentHash: string
}) {
  const run = await CompilerRun.create({
    organizationId: args.orgId,
    requestedByUserId: args.userId,
    status: 'completed',
    currentPhase: null,
    currentStage: null,
    input: { projectId: args.projectId, source: 'iw-api-e2e' },
    error: null,
    startedAt: null,
    completedAt: null,
  })
  return CompilerArtifact.create({
    compilerRunId: Number(run.id),
    organizationId: args.orgId,
    kind: 'triz_analysis_artifact',
    stageId: 'triz_analysis',
    artifactId: args.artifactId,
    version: 1,
    contentHash: args.contentHash,
    idempotencyKey: `idem-${args.artifactId}`,
    summaryLevel: 'artifact',
    payload: {
      schemaVersion: '1.0',
      mode: 'deterministic',
      status: 'completed',
      sourceContradictions: [],
      parameterTensions: [],
      principleCandidates: [],
      resolutionPaths: [
        {
          pathId: 'path-1',
          suggestionType: 'split',
          name: '分段交付路径',
          description: '将审查对象拆成多个可复核片段',
          applicability: ['范围可拆分'],
          nonApplicability: [],
        },
      ],
      warnings: [],
      requiresHumanReview: false,
      sourceHashes: {
        inputSignatures: ['sig-iw-api'],
        outputHash: 'out',
        contentHash: args.contentHash,
      },
      handoff: {
        status: 'none',
        draftSessionRef: null,
        selectedPathId: null,
        handedOffAt: null,
        blockedReason: null,
      },
      aiNarrative: null,
      createdAt: '2026-07-16T00:00:00.000Z',
    },
  })
}

async function tableCount(model: { query: () => any }): Promise<number> {
  const rows = await model.query().count('* as c')
  return Number(rows[0].$extras.c ?? 0)
}

function trizAuditEvents(logs: AuditLog[]): string[] {
  return logs
    .map((log) => String(log.metadata?.event ?? ''))
    .filter((event) => event.startsWith('TRIZ_INNOVATION_'))
}

test.group('TRIZ Innovation Workbench API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('iw-api-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    await seedContradiction({
      orgId: Number(org.id),
      projectId: Number(project.id),
      key: 'pc-iw-api',
      inputSignature: 'sig-iw-api',
    })
    return { owner, org, project, token }
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
      patch: (url: string) =>
        client
          .patch(url)
          .header('Authorization', `Bearer ${token}`)
          .header('x-organization-id', String(orgId)),
      delete: (url: string) =>
        client
          .delete(url)
          .header('Authorization', `Bearer ${token}`)
          .header('x-organization-id', String(orgId)),
    }
  }

  test('sources and scheme lifecycle return unified success shapes', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))
    const base = `${API_PREFIX}/projects/${project.id}/triz-workbench`

    const sources = await api.get(`${base}/sources`)
    assert.equal(sources.status(), 200)
    assert.isAtLeast(
      (sources.body() as { data: { contradictions: unknown[] } }).data.contradictions.length,
      1,
    )

    const created = await api.post(`${base}/schemes`).json({ name: '方案 API', note: '低敏备注' })
    assert.equal(created.status(), 201)
    const scheme = (created.body() as { data: { schemeId: string; name: string } }).data
    assert.equal(scheme.name, '方案 API')

    const list = await api.get(`${base}/schemes?page=1&perPage=1`)
    assert.equal(list.status(), 200)
    assert.property(list.body(), 'meta')

    const detail = await api.get(`${base}/schemes/${scheme.schemeId}`)
    assert.equal(detail.status(), 200)

    const updated = await api.patch(`${base}/schemes/${scheme.schemeId}`).json({
      name: '方案 API 已审查',
      reviewState: 'reviewed',
    })
    assert.equal(updated.status(), 200)
  })

  test('option, comparison, narrative, and handoff keep formal task data unchanged', async ({
    client,
    assert,
  }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))
    const base = `${API_PREFIX}/projects/${project.id}/triz-workbench`
    const beforeTasks = await Task.query().where('project_id', project.id).count('* as c')
    const beforeTaskCount = Number(beforeTasks[0].$extras.c ?? 0)

    const created = await api.post(`${base}/schemes`).json({ name: 'handoff 方案' })
    const schemeId = (created.body() as { data: { schemeId: string } }).data.schemeId

    const option = await api.post(`${base}/schemes/${schemeId}/options`).json({
      origin: 'deterministic_mapping',
      sourceRefs: [{ sourceType: 'contradiction', ref: 'pc-iw-api' }],
      principleIds: ['segmentation'],
      name: '分段交付候选',
      description: '仅作为待审核建议',
    })
    assert.equal(option.status(), 201)

    const comparison = await api.post(`${base}/schemes/${schemeId}/comparison`).json({})
    assert.equal(comparison.status(), 200)
    assert.isTrue(
      (comparison.body() as { data: { comparison: { modelCostRecorded: boolean } } }).data
        .comparison.modelCostRecorded,
    )

    const narrative = await api.post(`${base}/schemes/${schemeId}/narrative`).json({})
    assert.equal(narrative.status(), 200)
    assert.property((narrative.body() as { data: { narrative: unknown } }).data, 'narrative')

    const handoff = await api.post(`${base}/schemes/${schemeId}/draft-handoff`).json({})
    assert.equal(handoff.status(), 201)
    const handoffData = (
      handoff.body() as {
        data: {
          candidate: {
            sourceType: string
            contradictionRefs: string[]
            sourceHashes: { contradictionSignatures: string[] }
          }
        }
      }
    ).data
    assert.equal(handoffData.candidate.sourceType, 'triz_innovation_workbench')
    assert.include(handoffData.candidate.contradictionRefs, 'pc-iw-api')
    assert.include(handoffData.candidate.sourceHashes.contradictionSignatures, 'sig-iw-api')

    const draftSessions = await DraftLayerSession.query().where('organization_id', org.id)
    assert.lengthOf(draftSessions, 0)
    const afterTasks = await Task.query().where('project_id', project.id).count('* as c')
    assert.equal(Number(afterTasks[0].$extras.c ?? 0), beforeTaskCount)
  })

  test('invalid params and missing permissions use unified non-success error shape', async ({
    client,
    assert,
  }) => {
    const { org, project, token } = await setup(client)
    const base = `${API_PREFIX}/projects/${project.id}/triz-workbench`
    const invalid = await authed(client, token, Number(org.id)).get(`${base}/schemes?page=0`)
    assert.equal(invalid.status(), 422)
    assert.property(invalid.body() as { error: unknown }, 'error')

    const viewer = await createUser({ email: uniqueEmail('iw-api-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    const role = await ProjectRole.create({
      projectId: project.id,
      name: 'custom-no-triz',
      description: 'no triz permissions',
      permissions: [],
      isSystem: false,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: role.id,
      isActive: true,
    })
    const viewerToken = await login(client, viewer)
    const denied = await authed(client, viewerToken, Number(org.id)).get(`${base}/sources`)
    assert.equal(denied.status(), 403)
    assert.equal((denied.body() as { error: { code: string } }).error.code, 'PERMISSION_DENIED')

    const auditLogs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
    assert.include(trizAuditEvents(auditLogs), 'TRIZ_INNOVATION_PERMISSION_DENIED')
  })

  test('cross-organization access is hidden by a non-success response', async ({
    client,
    assert,
  }) => {
    const { project } = await setup(client)
    const other = await createUser({ email: uniqueEmail('iw-api-other') })
    const otherOrg = await createOrganization(other)
    const otherToken = await login(client, other)
    const res = await authed(client, otherToken, Number(otherOrg.id)).get(
      `${API_PREFIX}/projects/${project.id}/triz-workbench/sources`,
    )
    assert.isTrue([403, 404].includes(res.status()))
    assert.property(res.body() as { error: unknown }, 'error')
  })

  test('security regressions isolate foreign contradiction refs, artifact refs, schemes, narrative, dashboard, and handoff', async ({
    client,
    assert,
  }) => {
    const a = await setup(client)
    const b = await setup(client)
    await seedContradiction({
      orgId: Number(b.org.id),
      projectId: Number(b.project.id),
      key: 'pc-foreign-only',
      inputSignature: 'sig-foreign-only',
    })
    await seedAnalysisArtifact({
      orgId: Number(b.org.id),
      projectId: Number(b.project.id),
      userId: Number(b.owner.id),
      artifactId: 'ta-foreign-only',
      contentHash: 'ch-foreign-only',
    })

    const apiA = authed(client, a.token, Number(a.org.id))
    const baseA = `${API_PREFIX}/projects/${a.project.id}/triz-workbench`
    const created = await apiA.post(`${baseA}/schemes`).json({ name: '隔离方案' })
    const schemeId = (created.body() as { data: { schemeId: string } }).data.schemeId

    const foreignContradiction = await apiA.post(`${baseA}/schemes/${schemeId}/options`).json({
      origin: 'deterministic_mapping',
      sourceRefs: [{ sourceType: 'contradiction', ref: 'pc-foreign-only' }],
      principleIds: ['segmentation'],
      name: '跨组织矛盾 ref',
    })
    assert.equal(foreignContradiction.status(), 422)
    assert.property(foreignContradiction.body() as { error: unknown }, 'error')

    const foreignArtifact = await apiA.post(`${baseA}/schemes/${schemeId}/options`).json({
      origin: 'triz_analysis_path',
      sourceRefs: [{ sourceType: 'triz_analysis', ref: 'ta-foreign-only' }],
      selectedPathId: 'path-1',
      principleIds: ['segmentation'],
      name: '跨组织分析 ref',
    })
    assert.equal(foreignArtifact.status(), 422)
    assert.property(foreignArtifact.body() as { error: unknown }, 'error')

    const apiB = authed(client, b.token, Number(b.org.id))
    const foreignSchemeDetail = await apiB.get(`${baseA}/schemes/${schemeId}`)
    assert.isTrue([403, 404].includes(foreignSchemeDetail.status()))
    assert.property(foreignSchemeDetail.body() as { error: unknown }, 'error')

    const foreignNarrative = await apiB.post(`${baseA}/schemes/${schemeId}/narrative`).json({})
    assert.isTrue([403, 404].includes(foreignNarrative.status()))
    assert.property(foreignNarrative.body() as { error: unknown }, 'error')

    const foreignHandoff = await apiB.post(`${baseA}/schemes/${schemeId}/draft-handoff`).json({})
    assert.isTrue([403, 404].includes(foreignHandoff.status()))
    assert.property(foreignHandoff.body() as { error: unknown }, 'error')

    const foreignDashboard = await apiB.get(`${API_PREFIX}/projects/${a.project.id}/dashboard`)
    assert.isTrue([403, 404].includes(foreignDashboard.status()))
    assert.property(foreignDashboard.body() as { error: unknown }, 'error')

    const foreignNarrativeLogs = await AuditLog.query()
      .where('organization_id', b.org.id)
      .where('project_id', a.project.id)
    assert.notInclude(trizAuditEvents(foreignNarrativeLogs), 'TRIZ_INNOVATION_NARRATIVE_GENERATED')
    assert.notInclude(trizAuditEvents(foreignNarrativeLogs), 'TRIZ_INNOVATION_HANDOFF_CREATED')
  })

  test('stale source blocks Draft Layer handoff', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    await seedContradiction({
      orgId: Number(org.id),
      projectId: Number(project.id),
      key: 'pc-iw-stale',
      inputSignature: 'sig-iw-stale',
      stale: true,
    })
    const api = authed(client, token, Number(org.id))
    const base = `${API_PREFIX}/projects/${project.id}/triz-workbench`
    const created = await api.post(`${base}/schemes`).json({ name: 'stale 方案' })
    const schemeId = (created.body() as { data: { schemeId: string } }).data.schemeId
    await api.post(`${base}/schemes/${schemeId}/options`).json({
      origin: 'deterministic_mapping',
      sourceRefs: [{ sourceType: 'contradiction', ref: 'pc-iw-stale' }],
      principleIds: ['segmentation'],
      name: '过期来源候选',
    })

    const handoff = await api.post(`${base}/schemes/${schemeId}/draft-handoff`).json({})
    assert.equal(handoff.status(), 422)
    const data = (handoff.body() as { data: { handoffStatus: string; blockedReason: string } }).data
    assert.equal(data.handoffStatus, 'stale')
    assert.include(data.blockedReason, '过期')
  })

  test('confirmed contradiction plus analysis artifact flows to Draft candidate without formal writes', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, token } = await setup(client)
    await seedAnalysisArtifact({
      orgId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      artifactId: 'ta-iw-e2e',
      contentHash: 'ch-iw-e2e',
    })
    const api = authed(client, token, Number(org.id))
    const base = `${API_PREFIX}/projects/${project.id}/triz-workbench`
    const beforeTasks = await Task.query().where('project_id', project.id).count('* as c')

    const sources = await api.get(`${base}/sources`)
    assert.equal(sources.status(), 200)
    assert.isAtLeast(
      (sources.body() as { data: { analysisArtifacts: unknown[] } }).data.analysisArtifacts.length,
      1,
    )

    const created = await api.post(`${base}/schemes`).json({ name: 'analysis e2e 方案' })
    const schemeId = (created.body() as { data: { schemeId: string } }).data.schemeId
    const option = await api.post(`${base}/schemes/${schemeId}/options`).json({
      origin: 'triz_analysis_path',
      sourceRefs: [
        { sourceType: 'contradiction', ref: 'pc-iw-api' },
        { sourceType: 'triz_analysis', ref: 'ta-iw-e2e', selectedPathId: 'path-1' },
      ],
      selectedPathId: 'path-1',
      principleIds: ['segmentation'],
      name: '分段交付路径',
    })
    assert.equal(option.status(), 201)

    const comparison = await api.post(`${base}/schemes/${schemeId}/comparison`).json({})
    assert.equal(comparison.status(), 200)

    const handoff = await api.post(`${base}/schemes/${schemeId}/draft-handoff`).json({})
    assert.equal(handoff.status(), 201)
    const candidate = (
      handoff.body() as { data: { candidate: { analysisArtifactRefs: string[] } } }
    ).data.candidate
    assert.include(candidate.analysisArtifactRefs, 'ta-iw-e2e')

    const draftSessions = await DraftLayerSession.query().where('organization_id', org.id)
    assert.lengthOf(draftSessions, 0)
    const afterTasks = await Task.query().where('project_id', project.id).count('* as c')
    assert.equal(Number(afterTasks[0].$extras.c ?? 0), Number(beforeTasks[0].$extras.c ?? 0))
  })

  test('read endpoints do not trigger mutation, Compiler execution, Draft handoff, or AI narrative writes', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, token } = await setup(client)
    await seedAnalysisArtifact({
      orgId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      artifactId: 'ta-read-only',
      contentHash: 'ch-read-only',
    })
    const api = authed(client, token, Number(org.id))
    const base = `${API_PREFIX}/projects/${project.id}/triz-workbench`
    const created = await api.post(`${base}/schemes`).json({ name: '只读回归方案' })
    const schemeId = (created.body() as { data: { schemeId: string } }).data.schemeId

    const before = {
      contradictions: await tableCount(ProjectContradiction),
      compilerRuns: await tableCount(CompilerRun),
      compilerArtifacts: await tableCount(CompilerArtifact),
      compilerStageEvents: await tableCount(CompilerStageEvent),
      draftSessions: await tableCount(DraftLayerSession),
      auditLogs: await tableCount(AuditLog),
    }

    const sources = await api.get(`${base}/sources`)
    const schemes = await api.get(`${base}/schemes`)
    const detail = await api.get(`${base}/schemes/${schemeId}`)
    assert.equal(sources.status(), 200)
    assert.equal(schemes.status(), 200)
    assert.equal(detail.status(), 200)

    assert.deepEqual(
      {
        contradictions: await tableCount(ProjectContradiction),
        compilerRuns: await tableCount(CompilerRun),
        compilerArtifacts: await tableCount(CompilerArtifact),
        compilerStageEvents: await tableCount(CompilerStageEvent),
        draftSessions: await tableCount(DraftLayerSession),
        auditLogs: await tableCount(AuditLog),
      },
      before,
    )
  })

  test('scheme comparison creates no what-if baselines, Gantt snapshots, rebalances, or change requests', async ({
    client,
    assert,
  }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))
    const base = `${API_PREFIX}/projects/${project.id}/triz-workbench`
    const created = await api.post(`${base}/schemes`).json({ name: '无仿真方案' })
    const schemeId = (created.body() as { data: { schemeId: string } }).data.schemeId
    await api.post(`${base}/schemes/${schemeId}/options`).json({
      origin: 'deterministic_mapping',
      sourceRefs: [{ sourceType: 'contradiction', ref: 'pc-iw-api' }],
      principleIds: ['segmentation'],
      name: '静态影响候选',
    })

    const before = {
      ganttBaselines: await tableCount(GanttBaseline),
      resourceAllocations: await tableCount(ResourceAllocation),
      changeRequests: await tableCount(ChangeRequest),
      draftSessions: await tableCount(DraftLayerSession),
      tasks: await tableCount(Task),
    }

    const comparison = await api.post(`${base}/schemes/${schemeId}/comparison`).json({})
    assert.equal(comparison.status(), 200)

    assert.deepEqual(
      {
        ganttBaselines: await tableCount(GanttBaseline),
        resourceAllocations: await tableCount(ResourceAllocation),
        changeRequests: await tableCount(ChangeRequest),
        draftSessions: await tableCount(DraftLayerSession),
        tasks: await tableCount(Task),
      },
      before,
    )
  })

  test('workbench audit events are mapped and keep low-sensitivity metadata only', async ({
    client,
    assert,
  }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))
    const base = `${API_PREFIX}/projects/${project.id}/triz-workbench`

    const created = await api.post(`${base}/schemes`).json({ name: '审计方案' })
    const schemeId = (created.body() as { data: { schemeId: string } }).data.schemeId
    await api.post(`${base}/schemes/${schemeId}/options`).json({
      origin: 'deterministic_mapping',
      sourceRefs: [{ sourceType: 'contradiction', ref: 'pc-iw-api' }],
      principleIds: ['segmentation'],
      name: '审计候选',
    })
    await api.post(`${base}/schemes/${schemeId}/comparison`).json({})
    await api.post(`${base}/schemes/${schemeId}/narrative`).json({})
    await api.post(`${base}/schemes/${schemeId}/draft-handoff`).json({})
    await api.post(`${base}/schemes/${schemeId}/abandon`).json({})

    const logs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .orderBy('id', 'asc')
    const events = trizAuditEvents(logs)
    assert.includeMembers(events, [
      'TRIZ_INNOVATION_SCHEME_CREATED',
      'TRIZ_INNOVATION_OPTION_CHANGED',
      'TRIZ_INNOVATION_COMPARISON_GENERATED',
      'TRIZ_INNOVATION_NARRATIVE_GENERATED',
      'TRIZ_INNOVATION_HANDOFF_CREATED',
      'TRIZ_INNOVATION_SCHEME_ABANDONED',
    ])

    const trizMetadata = logs
      .filter((log) => String(log.metadata?.event ?? '').startsWith('TRIZ_INNOVATION_'))
      .map((log) => log.metadata)
    const serialized = JSON.stringify(trizMetadata)
    assert.notInclude(serialized, 'Authorization')
    assert.notInclude(serialized, 'accessToken')
    assert.notInclude(serialized, 'apiKey')
    assert.notInclude(serialized, '规则摘要')
    assert.notInclude(serialized, '完整证据')
    assert.notInclude(serialized, 'password')
  })
})
