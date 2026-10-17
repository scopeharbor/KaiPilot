import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import ProjectHealthDiagnosisItem from '#models/project_health_diagnosis_item'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import type { HealthDiagnosisSummary, HealthAiDraft, HealthDataWarning } from '@aiproj/types'

test.group('Health Diagnosis Model — schema & default', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('hd-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  // ------------------------------------------------------------------
  // ProjectHealthDiagnosis
  // ------------------------------------------------------------------

  test('创建与读取基本字段', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const now = DateTime.now()

    const d = await ProjectHealthDiagnosis.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-test-001',
      outputHash: null,
      evidenceHash: null,
      summary: null,
      aiDraft: null,
      warnings: null,
      generatedBy: Number(owner.id),
      generatedAt: now,
      confirmedBy: null,
      confirmedAt: null,
      confirmedNotes: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      stale: false,
      staleReason: null,
    })

    const loaded = await ProjectHealthDiagnosis.findOrFail(d.id)
    assert.equal(loaded.status, 'pending')
    assert.equal(loaded.ruleVersion, '1.0.0')
    assert.equal(loaded.inputSignature, 'sig-test-001')
    assert.equal(loaded.stale, false)
  })

  test('JSON 列写入回读为对象', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const now = DateTime.now()

    const summary: HealthDiagnosisSummary = {
      overallScore: 75,
      overallLabel: 'attention',
      dimensionScores: [],
      warnings: [],
      suggestedActions: [],
      evidenceHash: 'evhash001',
    }

    const aiDraft: HealthAiDraft = {
      narrativeDraft: '项目整体可控',
      recommendedActionsText: '关注关键路径',
      assumptions: ['数据准确'],
      confidence: 0.85,
      questions: [],
      provider: 'fake',
      model: 'fake-model',
    }

    const warnings: HealthDataWarning[] = [
      { dimension: 'resource', code: 'DATA_MISSING', message: '资源数据不可用', blocking: false },
    ]

    const d = await ProjectHealthDiagnosis.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      status: 'ai_ready',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-json-test',
      outputHash: 'outhash001',
      evidenceHash: 'evhash001',
      summary,
      aiDraft,
      warnings,
      generatedBy: Number(owner.id),
      generatedAt: now,
      confirmedBy: null,
      confirmedAt: null,
      confirmedNotes: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      stale: false,
      staleReason: null,
    })

    const loaded = await ProjectHealthDiagnosis.findOrFail(d.id)
    assert.isNotNull(loaded.summary)
    assert.equal(loaded.summary!.overallScore, 75)
    assert.equal(loaded.summary!.overallLabel, 'attention')
    assert.isNotNull(loaded.aiDraft)
    assert.equal(loaded.aiDraft!.narrativeDraft, '项目整体可控')
    assert.equal(loaded.aiDraft!.confidence, 0.85)
    assert.isNotNull(loaded.warnings)
    assert.equal(loaded.warnings!.length, 1)
    assert.equal(loaded.warnings![0].code, 'DATA_MISSING')
  })

  test('组织/项目索引', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const now = DateTime.now()

    const d = await ProjectHealthDiagnosis.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      status: 'confirmed',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-index',
      outputHash: null,
      evidenceHash: null,
      summary: null,
      aiDraft: null,
      warnings: null,
      generatedBy: Number(owner.id),
      generatedAt: now,
      confirmedBy: Number(owner.id),
      confirmedAt: now,
      confirmedNotes: '诊断验证通过',
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      stale: false,
      staleReason: null,
    })

    const list = await ProjectHealthDiagnosis.query()
      .where('organization_id', Number(org.id))
      .where('project_id', Number(project.id))
      .where('status', 'confirmed')

    assert.isTrue(list.length >= 1)
    assert.equal(list[0].id, d.id)
  })

  // ------------------------------------------------------------------
  // ProjectHealthDiagnosisItem
  // ------------------------------------------------------------------

  test('创建诊断信号条目与级联读取', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const now = DateTime.now()

    const d = await ProjectHealthDiagnosis.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      status: 'confirmed',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-item-test',
      outputHash: null,
      evidenceHash: null,
      summary: null,
      aiDraft: null,
      warnings: null,
      generatedBy: Number(owner.id),
      generatedAt: now,
      confirmedBy: null,
      confirmedAt: null,
      confirmedNotes: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      stale: false,
      staleReason: null,
    })

    const item = await ProjectHealthDiagnosisItem.create({
      diagnosisId: d.id,
      dimension: 'critical_path',
      ruleId: 'R003',
      severity: 'high',
      scoreImpact: -15,
      evidence: '关键路径上 3 个任务逾期',
      sourceType: 'task',
      sourceId: 101,
      suggestedAction: '审核关键路径任务进度',
      requiresReview: false,
    })

    const loadedItem = await ProjectHealthDiagnosisItem.findOrFail(item.id)
    assert.equal(loadedItem.dimension, 'critical_path')
    assert.equal(loadedItem.ruleId, 'R003')
    assert.equal(loadedItem.severity, 'high')
    assert.equal(loadedItem.scoreImpact, -15)

    // 级联读取
    const loadedDiagnosis = await ProjectHealthDiagnosis.query()
      .where('id', d.id)
      .preload('items')
      .firstOrFail()

    assert.isTrue(loadedDiagnosis.items.length >= 1)
    assert.equal(loadedDiagnosis.items[0].dimension, 'critical_path')
  })
})
