import InnovationSourceService from '#services/triz_innovation/innovation_source_service'
import ProjectContradiction from '#models/project_contradiction'
import CompilerRun from '#models/compiler_run'
import CompilerArtifact from '#models/compiler_artifact'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'

test.group('V3 InnovationSourceService — read-only adapters & no-leak', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('iw-src') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project: { id: Number(project.id) } }
  }

  async function seedContradiction(args: {
    orgId: number
    projectId: number
    key: string
    severity?: 'critical' | 'high' | 'medium' | 'low'
    status?: 'confirmed' | 'draft' | 'dismissed' | 'superseded'
    stale?: boolean
    type?: 'technical' | 'physical'
    title?: string
    inputSignature?: string
  }) {
    return ProjectContradiction.create({
      organizationId: args.orgId,
      projectId: args.projectId,
      key: args.key,
      dedupeKey: `d-${args.key}`,
      type: args.type ?? 'technical',
      ruleId: 'CD-001',
      ruleVersion: '1.0.0',
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      improvingDirection: null,
      worseningDirection: null,
      parameterKey: null,
      requirementA: null,
      requirementB: null,
      severity: args.severity ?? 'high',
      confidence: 0.8,
      title: args.title ?? '测试矛盾',
      evidence: [],
      suggestedPrinciples: [],
      inputSignature: args.inputSignature ?? `tcd-${args.key}`,
      outputHash: null,
      status: args.status ?? 'confirmed',
      stale: args.stale ?? false,
      staleReason: args.stale ? '已过期' : null,
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
    requiresHumanReview?: boolean
    warningCode?: string
    contentHash?: string
  }) {
    const run = await CompilerRun.create({
      organizationId: args.orgId,
      requestedByUserId: args.userId,
      status: 'completed',
      currentPhase: null,
      currentStage: null,
      input: { projectId: args.projectId, source: 'iw-test' },
      error: null,
      startedAt: null,
      completedAt: null,
    })
    const warnings = args.warningCode
      ? [
          {
            code: args.warningCode,
            severity: args.warningCode === 'NEEDS_HUMAN_REVIEW' ? 'blocking' : 'warning',
            message: 'm',
          },
        ]
      : []
    return CompilerArtifact.create({
      compilerRunId: Number(run.id),
      organizationId: args.orgId,
      kind: 'triz_analysis_artifact',
      stageId: 'triz_analysis',
      artifactId: args.artifactId,
      version: 1,
      contentHash: args.contentHash ?? 'ch-demo',
      idempotencyKey: `idem-${args.artifactId}`,
      summaryLevel: 'artifact',
      payload: {
        schemaVersion: '1.0',
        mode: 'deterministic',
        status: args.requiresHumanReview ? 'needs_human_review' : 'completed',
        sourceContradictions: [],
        parameterTensions: [],
        principleCandidates: [],
        resolutionPaths: [],
        warnings,
        requiresHumanReview: args.requiresHumanReview ?? false,
        sourceHashes: {
          inputSignatures: [],
          outputHash: 'out',
          contentHash: args.contentHash ?? 'ch-demo',
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

  test('授权用户可见 confirmed 矛盾；低敏 ref 字段齐全', async ({ assert }) => {
    const { owner, org, project } = await setup()
    await seedContradiction({ orgId: Number(org.id), projectId: project.id, key: 'pc-conf-1' })
    const svc = await app.container.make(InnovationSourceService)
    const bundle = await svc.listSources(owner, Number(org.id), project.id, {})
    assert.equal(bundle.contradictions.length, 1)
    const ref = bundle.contradictions[0]
    assert.equal(ref.sourceType, 'contradiction')
    assert.equal(ref.ref, 'pc-conf-1')
    assert.equal(ref.severity, 'high')
    assert.isFalse(ref.stale)
    assert.isOk(ref.hash)
  })

  test('无权用户不泄漏矛盾数量/标题（no-count leakage）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    await seedContradiction({ orgId: Number(org.id), projectId: project.id, key: 'pc-conf-2' })
    const stranger = await createUser({ email: uniqueEmail('iw-stranger-src') })
    const svc = await app.container.make(InnovationSourceService)
    const bundle = await svc.listSources(stranger, Number(org.id), project.id, {})
    assert.equal(bundle.contradictions.length, 0)
    assert.equal(bundle.analysisArtifacts.length, 0)
    // owner 仍可看到（对照）
    const ownerBundle = await svc.listSources(owner, Number(org.id), project.id, {})
    assert.isAtLeast(ownerBundle.contradictions.length, 1)
  })

  test('默认仅 confirmed；includeDraft=true 才纳入 draft 候选', async ({ assert }) => {
    const { owner, org, project } = await setup()
    await seedContradiction({
      orgId: Number(org.id),
      projectId: project.id,
      key: 'pc-c',
      status: 'confirmed',
    })
    await seedContradiction({
      orgId: Number(org.id),
      projectId: project.id,
      key: 'pc-d',
      status: 'draft',
    })
    const svc = await app.container.make(InnovationSourceService)
    const onlyConfirmed = await svc.listSources(owner, Number(org.id), project.id, {})
    assert.equal(onlyConfirmed.contradictions.length, 1)
    assert.equal(onlyConfirmed.contradictions[0].ref, 'pc-c')

    const withDraft = await svc.listSources(owner, Number(org.id), project.id, {
      includeDraft: true,
    })
    assert.equal(withDraft.contradictions.length, 2)
    assert.isTrue(withDraft.includeDraft)
  })

  test('stale 标记在 ref 中保留', async ({ assert }) => {
    const { owner, org, project } = await setup()
    await seedContradiction({
      orgId: Number(org.id),
      projectId: project.id,
      key: 'pc-stale',
      stale: true,
    })
    const svc = await app.container.make(InnovationSourceService)
    const bundle = await svc.listSources(owner, Number(org.id), project.id, {})
    const ref = bundle.contradictions.find((c) => c.ref === 'pc-stale')
    assert.isOk(ref)
    assert.isTrue(ref!.stale)
  })

  test('跨组织查询不命中（org 隔离）', async ({ assert }) => {
    const { org, project } = await setup()
    await seedContradiction({ orgId: Number(org.id), projectId: project.id, key: 'pc-xorg' })
    const otherOwner = await createUser({ email: uniqueEmail('iw-xorg') })
    const otherOrg = await createOrganization(otherOwner)
    const { project: otherProject } = await createProjectWithMember(
      otherOrg,
      otherOwner,
      otherOwner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const svc = await app.container.make(InnovationSourceService)
    // 用 owner 在 otherOrg 查 → 无矛盾（不属于 otherOrg）
    const bundle = await svc.listSources(
      otherOwner,
      Number(otherOrg.id),
      Number(otherProject.id),
      {},
    )
    assert.equal(bundle.contradictions.length, 0)
  })

  test('只读来源层零 mutation：project_contradictions 行不变', async ({ assert }) => {
    const { owner, org, project } = await setup()
    await seedContradiction({
      orgId: Number(org.id),
      projectId: project.id,
      key: 'pc-mut',
      title: '原标题',
    })
    const svc = await app.container.make(InnovationSourceService)
    const before = await ProjectContradiction.query()
      .where('project_id', project.id)
      .count('* as c')
    const beforeCount = (before[0].$extras?.c ?? 0) as number

    await svc.listSources(owner, Number(org.id), project.id, { includeDraft: true })
    await svc.resolveContradictionRef(owner, Number(org.id), project.id, 'pc-mut')

    const after = await ProjectContradiction.query().where('project_id', project.id).count('* as c')
    assert.equal((after[0].$extras?.c ?? 0) as number, beforeCount)
    const row = await ProjectContradiction.findByOrFail('key', 'pc-mut')
    assert.equal(row.title, '原标题')
    assert.equal(row.status, 'confirmed')
  })

  test('analysis artifact 摘要：NEEDS_HUMAN_REVIEW → stale=true；confirmed-only 默认不含 draft', async ({
    assert,
  }) => {
    const { owner, org, project } = await setup()
    await seedAnalysisArtifact({
      orgId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      artifactId: 'ta-review',
      requiresHumanReview: true,
      warningCode: 'NEEDS_HUMAN_REVIEW',
      contentHash: 'ch-review',
    })
    const svc = await app.container.make(InnovationSourceService)
    const bundle = await svc.listSources(owner, Number(org.id), project.id, {})
    assert.equal(bundle.analysisArtifacts.length, 1)
    const summary = bundle.analysisArtifacts[0]
    assert.equal(summary.artifactId, 'ta-review')
    assert.isTrue(summary.stale)
    assert.isAtLeast(summary.warningCount, 1)

    // 单条详情同样可读，且跨项目隔离
    const detail = await svc.getAnalysisArtifact(Number(org.id), project.id, 'ta-review')
    assert.isOk(detail)
    assert.isTrue(detail!.requiresHumanReview)
    const leaked = await svc.getAnalysisArtifact(Number(org.id), project.id + 99999, 'ta-review')
    assert.isNull(leaked)
  })

  test('analysis artifact 跨项目隔离（input.projectId 不匹配 → 不返回）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const { project: project2 } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await seedAnalysisArtifact({
      orgId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      artifactId: 'ta-p1',
      contentHash: 'ch-p1',
    })
    const svc = await app.container.make(InnovationSourceService)
    const p1 = await svc.listSources(owner, Number(org.id), project.id, {})
    const p2 = await svc.listSources(owner, Number(org.id), Number(project2.id), {})
    assert.equal(p1.analysisArtifacts.length, 1)
    assert.equal(p2.analysisArtifacts.length, 0)
  })
})
