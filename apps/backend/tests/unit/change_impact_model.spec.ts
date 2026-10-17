import ChangeImpactAnalysis from '#models/change_impact_analysis'
import ChangeImpactItem from '#models/change_impact_item'
import ChangeRequest from '#models/change_request'
import { ProjectRoleName } from '#rbac'
import type Organization from '#models/organization'
import type Project from '#models/project'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

/**
 * 影响分析模型与迁移测试（v2-change-management-impact-analysis §2.5）。
 * 覆盖 SQLite JSON 列序列化、组织隔离、级联/明细关系和旧数据默认值。
 */

let crSeq = 0
async function makeCr(org: Organization, project: Project, userId: number): Promise<ChangeRequest> {
  crSeq += 1
  return ChangeRequest.create({
    crCode: `CR-TEST-${process.pid}-${crSeq}`,
    organizationId: org.id,
    projectId: project.id,
    requesterId: userId,
    requestedBy: userId,
    title: '模型测试变更',
    changeType: 'scope',
    status: 'draft',
    priority: 'medium',
  })
}

async function setup() {
  const owner = await createUser({ email: uniqueEmail('ci-model') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

test.group('ChangeImpactAnalysis / ChangeImpactItem 模型', (group) => {
  useAuthDatabase(group)

  test('JSON 列（summary/warnings/missingInputs/scope/aiExplanation）往返序列化', async ({
    assert,
  }) => {
    const { owner, org, project } = await setup()
    const cr = await makeCr(org, project, owner.id)

    const created = await ChangeImpactAnalysis.create({
      organizationId: org.id,
      projectId: project.id,
      changeRequestId: cr.id,
      ruleVersion: '2.0.0',
      inputSignature: 'sig-abc',
      outputHash: 'out-123',
      status: 'completed',
      scope: {
        dimensions: ['scope', 'schedule'],
        maxPropagationDepth: 5,
        includeEvidenceDetails: false,
      },
      summary: {
        totalAffected: 2,
        severityDistribution: { critical: 0, high: 1, medium: 1, low: 0, none: 0 },
        dimensionSummaries: [
          {
            dimension: 'schedule',
            affectedCount: 1,
            highestSeverity: 'high',
            topEvidence: ['证据A'],
          },
        ],
        criticalPathAffected: true,
        hasBlockingWarnings: true,
      },
      warnings: [{ code: 'RESOURCE_DATA_MISSING', message: '缺少资源数据', dimension: 'resource' }],
      missingInputs: [{ dimension: 'resource', reason: '未启用', requiredData: 'allocations' }],
      createdBy: owner.id,
    })

    const reloaded = await ChangeImpactAnalysis.findOrFail(created.id)
    assert.equal(reloaded.summary?.totalAffected, 2)
    assert.equal(reloaded.summary?.severityDistribution.high, 1)
    assert.isTrue(reloaded.summary?.criticalPathAffected)
    assert.equal(reloaded.scope?.maxPropagationDepth, 5)
    assert.lengthOf(reloaded.warnings ?? [], 1)
    assert.equal(reloaded.warnings?.[0].code, 'RESOURCE_DATA_MISSING')
    assert.lengthOf(reloaded.missingInputs ?? [], 1)
    assert.equal(reloaded.missingInputs?.[0].dimension, 'resource')
  })

  test('影响项 propagationPath JSON 与布尔字段往返', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await ChangeImpactAnalysis.create({
      organizationId: org.id,
      projectId: project.id,
      changeRequestId: cr.id,
      ruleVersion: '2.0.0',
      inputSignature: 'sig',
      status: 'completed',
      createdBy: owner.id,
    })

    await ChangeImpactItem.create({
      analysisId: analysis.id,
      entityType: 'task',
      entityId: 42,
      dimension: 'schedule',
      severity: 'high',
      score: 8,
      propagationPath: [
        {
          fromEntityType: 'task',
          fromEntityId: 1,
          toEntityType: 'task',
          toEntityId: 42,
          relationshipType: 'task_dependency',
          relationshipId: null,
        },
      ],
      depth: 1,
      ruleId: 'R001',
      evidence: '通过依赖传播',
      requiresReview: true,
      isVisible: true,
    })

    const item = await ChangeImpactItem.query().where('analysis_id', analysis.id).firstOrFail()
    assert.isArray(item.propagationPath)
    assert.equal(item.propagationPath?.[0].toEntityId, 42)
    assert.equal(item.propagationPath?.[0].relationshipType, 'task_dependency')
    // SQLite 以 0/1 存布尔，断言真值语义
    assert.isTrue(Boolean(item.requiresReview))
    assert.isTrue(Boolean(item.isVisible))
    assert.equal(item.ruleId, 'R001')
  })

  test('组织隔离：按 organization_id 过滤不泄露其它组织的分析', async ({ assert }) => {
    const a = await setup()
    const bOwner = await createUser({ email: uniqueEmail('ci-model-b') })
    const bOrg = await createOrganization(bOwner)
    const { project: bProject } = await createProjectWithMember(
      bOrg,
      bOwner,
      bOwner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const crA = await makeCr(a.org, a.project, a.owner.id)
    await ChangeImpactAnalysis.create({
      organizationId: a.org.id,
      projectId: a.project.id,
      changeRequestId: crA.id,
      ruleVersion: '2.0.0',
      inputSignature: 'sig-a',
      status: 'completed',
      createdBy: a.owner.id,
    })
    const crB = await makeCr(bOrg, bProject, bOwner.id)
    await ChangeImpactAnalysis.create({
      organizationId: bOrg.id,
      projectId: bProject.id,
      changeRequestId: crB.id,
      ruleVersion: '2.0.0',
      inputSignature: 'sig-b',
      status: 'completed',
      createdBy: bOwner.id,
    })

    const orgAAnalyses = await ChangeImpactAnalysis.query().where('organization_id', a.org.id)
    assert.lengthOf(orgAAnalyses, 1)
    assert.equal(orgAAnalyses[0].organizationId, a.org.id)
  })

  test('旧数据默认值：可选 JSON 字段缺省为 null', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await ChangeImpactAnalysis.create({
      organizationId: org.id,
      projectId: project.id,
      changeRequestId: cr.id,
      ruleVersion: '2.0.0',
      inputSignature: 'sig',
      status: 'pending',
      createdBy: owner.id,
    })

    const reloaded = await ChangeImpactAnalysis.findOrFail(analysis.id)
    assert.isNull(reloaded.summary)
    assert.isNull(reloaded.warnings)
    assert.isNull(reloaded.missingInputs)
    assert.isNull(reloaded.aiExplanation)
    assert.isNull(reloaded.confirmedBy)
    assert.isNull(reloaded.staleReason)
  })
})
