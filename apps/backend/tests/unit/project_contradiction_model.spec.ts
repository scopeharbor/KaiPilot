import ProjectContradiction from '#models/project_contradiction'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import type {
  ContradictionEvidence,
  SuggestedPrinciple,
  ContradictionAiExplanation,
} from '@aiproj/types'

test.group('V2 ProjectContradiction Model — schema & defaults', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('pc-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  test('technical 矛盾创建与基本字段读取', async ({ assert }) => {
    const { project, org } = await setupProject()

    const c = await ProjectContradiction.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      key: 'pc:1:d-aaaa0000',
      dedupeKey: 'd-aaaa0000',
      type: 'technical',
      ruleId: 'CD-001',
      ruleVersion: '1.0.0',
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      improvingDirection: '工期缩短',
      worseningDirection: '成本上升',
      parameterKey: null,
      requirementA: null,
      requirementB: null,
      severity: 'high',
      confidence: 0.8,
      title: '压缩工期会抬高成本',
      evidence: [],
      suggestedPrinciples: [],
      inputSignature: 'tcd-aaaaaaaa',
      outputHash: 'out-bbbbbbbb',
      status: 'draft',
      stale: false,
      staleReason: null,
      relatedChangeRequestId: null,
      confirmedBy: null,
      confirmedAt: null,
      dismissedBy: null,
      dismissedAt: null,
      dismissReason: null,
      aiExplanation: null,
    })

    const loaded = await ProjectContradiction.findOrFail(c.id)
    assert.equal(loaded.type, 'technical')
    assert.equal(loaded.ruleId, 'CD-001')
    assert.equal(loaded.improvingParameterKey, 'duration')
    assert.equal(loaded.worseningParameterKey, 'cost')
    assert.equal(loaded.severity, 'high')
    assert.equal(loaded.status, 'draft')
    assert.equal(loaded.stale, false)
    assert.equal(loaded.title, '压缩工期会抬高成本')
    assert.deepEqual(loaded.evidence, [])
    assert.deepEqual(loaded.suggestedPrinciples, [])
    assert.isNull(loaded.aiExplanation)
  })

  test('physical 矛盾对立要求字段读写', async ({ assert }) => {
    const { project, org } = await setupProject()

    const c = await ProjectContradiction.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      key: 'pc:1:d-phys0000',
      dedupeKey: 'd-phys0000',
      type: 'physical',
      ruleId: 'CD-006',
      ruleVersion: '1.0.0',
      improvingParameterKey: null,
      worseningParameterKey: null,
      improvingDirection: null,
      worseningDirection: null,
      parameterKey: 'scope',
      requirementA: '范围要完整覆盖',
      requirementB: '交付要快速完成',
      severity: 'medium',
      confidence: 0.6,
      title: '范围既要全又要快',
      evidence: [],
      suggestedPrinciples: [],
      inputSignature: 'tcd-cccccccc',
      outputHash: 'out-dddddddd',
      status: 'draft',
      stale: false,
      staleReason: null,
      relatedChangeRequestId: null,
      confirmedBy: null,
      confirmedAt: null,
      dismissedBy: null,
      dismissedAt: null,
      dismissReason: null,
      aiExplanation: null,
    })

    const loaded = await ProjectContradiction.findOrFail(c.id)
    assert.equal(loaded.type, 'physical')
    assert.equal(loaded.parameterKey, 'scope')
    assert.equal(loaded.requirementA, '范围要完整覆盖')
    assert.equal(loaded.requirementB, '交付要快速完成')
  })

  test('evidence/suggestedPrinciples/aiExplanation JSON 列往返', async ({ assert }) => {
    const { project, org } = await setupProject()

    const evidence: ContradictionEvidence[] = [
      {
        entityType: 'task',
        entityId: 42,
        title: '关键任务',
        detail: '关键路径任务逾期',
        isVisible: true,
      },
    ]
    const suggestedPrinciples: SuggestedPrinciple[] = [
      { principleId: 'segmentation', name: '分割/分解', relevance: 0.9, advice: '拆分阶段' },
    ]
    const aiExplanation: ContradictionAiExplanation = {
      narrative: '该矛盾建议拆分关键路径',
      isFallback: false,
      hallucinationChecked: true,
      degradedReason: null,
      referencedPrincipleIds: ['segmentation'],
      referencedParameterKeys: ['duration', 'cost'],
      confidence: 0.7,
      provider: 'fake',
      model: 'test-model',
      needsConfirmation: true,
    }

    const c = await ProjectContradiction.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      key: 'pc:1:d-json0000',
      dedupeKey: 'd-json0000',
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
      title: 'JSON 列测试',
      evidence,
      suggestedPrinciples,
      inputSignature: 'tcd-eeeeeeee',
      outputHash: null,
      status: 'confirmed',
      stale: false,
      staleReason: null,
      relatedChangeRequestId: null,
      confirmedBy: 1,
      confirmedAt: null,
      dismissedBy: null,
      dismissedAt: null,
      dismissReason: null,
      aiExplanation,
    })

    const loaded = await ProjectContradiction.findOrFail(c.id)
    assert.deepEqual(loaded.evidence, evidence)
    assert.deepEqual(loaded.suggestedPrinciples, suggestedPrinciples)
    assert.deepEqual(loaded.aiExplanation, aiExplanation)
  })

  test('组织 + 项目 scope 隔离：跨项目查询不命中', async ({ assert }) => {
    const { project, org } = await setupProject()
    // 第二个项目（同组织）
    const owner2 = await createUser({ email: uniqueEmail('pc-model2') })
    const { project: project2 } = await createProjectWithMember(
      org,
      owner2,
      owner2,
      ProjectRoleName.PROJECT_MANAGER,
    )

    await ProjectContradiction.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      key: 'pc:1:d-scope01',
      dedupeKey: 'd-scope01',
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
      severity: 'low',
      confidence: 0.5,
      title: '项目1矛盾',
      evidence: [],
      suggestedPrinciples: [],
      inputSignature: 'tcd-scope001',
      outputHash: null,
      status: 'draft',
      stale: false,
      staleReason: null,
      relatedChangeRequestId: null,
      confirmedBy: null,
      confirmedAt: null,
      dismissedBy: null,
      dismissedAt: null,
      dismissReason: null,
      aiExplanation: null,
    })

    const inOtherProject = await ProjectContradiction.query()
      .where('project_id', project2.id)
      .where('organization_id', org.id)
    assert.equal(inOtherProject.length, 0)

    const inOwnProject = await ProjectContradiction.query()
      .where('project_id', project.id)
      .where('organization_id', org.id)
    assert.equal(inOwnProject.length, 1)
  })

  test('状态流转：draft → confirmed 后读取确认字段', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const c = await ProjectContradiction.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      key: 'pc:1:d-flow001',
      dedupeKey: 'd-flow001',
      type: 'technical',
      ruleId: 'CD-002',
      ruleVersion: '1.0.0',
      improvingParameterKey: 'resource_load',
      worseningParameterKey: 'stability',
      improvingDirection: null,
      worseningDirection: null,
      parameterKey: null,
      requirementA: null,
      requirementB: null,
      severity: 'medium',
      confidence: 0.7,
      title: '资源利用率与稳定性',
      evidence: [],
      suggestedPrinciples: [],
      inputSignature: 'tcd-flow0001',
      outputHash: null,
      status: 'draft',
      stale: false,
      staleReason: null,
      relatedChangeRequestId: null,
      confirmedBy: null,
      confirmedAt: null,
      dismissedBy: null,
      dismissedAt: null,
      dismissReason: null,
      aiExplanation: null,
    })

    c.status = 'confirmed'
    c.confirmedBy = Number(owner.id)
    c.confirmedAt = c.createdAt
    await c.save()

    const loaded = await ProjectContradiction.findOrFail(c.id)
    assert.equal(loaded.status, 'confirmed')
    assert.equal(loaded.confirmedBy, Number(owner.id))
  })
})
