import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import ProjectPredictionSnapshot from '#models/project_prediction_snapshot'
import ProjectPredictionSignal from '#models/project_prediction_signal'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import type {
  PredictionDataWarning,
  PredictionAiExplanation,
  PredictionEvidenceRef,
} from '@aiproj/types'

const PM_ROLE = 'project_manager' as const

/**
 * v2-ai-risk-progress-prediction 2.4 —— 模型 JSON 序列化、组织隔离与级联行为测试。
 */
test.group('ProjectPredictionSnapshot model', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('pred-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)
    return { owner, org, project }
  }

  test('基础创建与字段读取', async ({ assert }) => {
    const { project } = await setupProject()

    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 30,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-abc123',
      outputHash: 'hash-def456',
      sourceHash: 'src-ghi789',
      warnings: null,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    assert.isNumber(snapshot.id)
    assert.equal(snapshot.window, 30)
    assert.equal(snapshot.status, 'pending')
    assert.equal(snapshot.ruleVersion, '1.0.0')
    assert.equal(snapshot.inputSignature, 'sig-abc123')
    assert.equal(snapshot.outputHash, 'hash-def456')
    assert.equal(snapshot.sourceHash, 'src-ghi789')
    assert.isFalse(snapshot.stale)
    assert.equal(snapshot.confirmationStatus, 'pending')
  })

  test('warnings JSON 序列化 prepare/consume', async ({ assert }) => {
    const { project } = await setupProject()

    const warnings: PredictionDataWarning[] = [
      {
        code: 'DATA_MISSING',
        message: '项目暂无任务数据',
        blocking: true,
        signalType: 'schedule_risk',
      },
      {
        code: 'PERMISSION_FORBIDDEN',
        message: '无资源查看权限',
        blocking: true,
        signalType: 'resource_bottleneck',
      },
    ]

    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 30,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-abc123',
      outputHash: 'hash-def456',
      sourceHash: 'src-ghi789',
      warnings,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    // 从 DB 重新读取
    const loaded = await ProjectPredictionSnapshot.findOrFail(snapshot.id)
    assert.isNotNull(loaded.warnings)
    assert.lengthOf(loaded.warnings!, 2)
    assert.equal(loaded.warnings![0].code, 'DATA_MISSING')
    assert.equal(loaded.warnings![1].signalType, 'resource_bottleneck')
    assert.isTrue(loaded.warnings![0].blocking)
  })

  test('warnings = null 回读为 null', async ({ assert }) => {
    const { project } = await setupProject()

    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 14,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-null',
      outputHash: 'hash-null',
      sourceHash: 'src-null',
      warnings: null,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    const loaded = await ProjectPredictionSnapshot.findOrFail(snapshot.id)
    assert.isNull(loaded.warnings)
  })

  test('aiExplanation JSON 序列化 prepare/consume', async ({ assert }) => {
    const { project } = await setupProject()

    const explanation: PredictionAiExplanation = {
      narrative: '测试解释',
      focusPoints: ['关注任务逾期'],
      suggestedActions: ['审查高风险任务'],
      assumptions: ['数据基于最近快照'],
      confidence: 0.75,
      provider: 'fake',
      model: 'test-fixture',
      status: 'pending',
      failureCode: null,
      failureMessage: null,
      outputHash: 'out-test123',
      costSummary: {
        provider: 'fake',
        model: 'test-fixture',
        inputTokens: 0,
        outputTokens: 50,
        totalCost: 0,
        currency: 'USD',
        latencyMs: 5,
      },
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      generatedAt: new Date().toISOString(),
    }

    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 30,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-ai',
      outputHash: 'hash-ai',
      sourceHash: 'src-ai',
      warnings: null,
      aiExplanation: explanation,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    const loaded = await ProjectPredictionSnapshot.findOrFail(snapshot.id)
    assert.isNotNull(loaded.aiExplanation)
    assert.equal(loaded.aiExplanation!.narrative, '测试解释')
    assert.equal(loaded.aiExplanation!.status, 'pending')
    assert.equal(loaded.aiExplanation!.confidence, 0.75)
    assert.isNotNull(loaded.aiExplanation!.costSummary)
    assert.equal(loaded.aiExplanation!.costSummary!.currency, 'USD')
  })

  test('aiExplanation = null 回读为 null', async ({ assert }) => {
    const { project } = await setupProject()

    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 14,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-null-ai',
      outputHash: 'hash-null-ai',
      sourceHash: 'src-null-ai',
      warnings: null,
      aiExplanation: null,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    const loaded = await ProjectPredictionSnapshot.findOrFail(snapshot.id)
    assert.isNull(loaded.aiExplanation)
  })

  test('组织隔离字段存在', async ({ assert }) => {
    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 42,
      projectId: 99,
      window: 60,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-org',
      outputHash: 'hash-org',
      sourceHash: 'src-org',
      warnings: null,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    assert.equal(snapshot.organizationId, 42)
    assert.equal(snapshot.projectId, 99)

    const loaded = await ProjectPredictionSnapshot.findOrFail(snapshot.id)
    assert.equal(loaded.organizationId, 42)
    assert.equal(loaded.projectId, 99)
  })

  test('确认字段写入回读', async ({ assert }) => {
    const { project } = await setupProject()

    const now = DateTime.now()
    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 30,
      status: 'confirmed',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-conf',
      outputHash: 'hash-conf',
      sourceHash: 'src-conf',
      warnings: null,
      confirmationStatus: 'confirmed',
      confirmedBy: 2,
      confirmedAt: now,
      confirmedNotes: '确认测试',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    const loaded = await ProjectPredictionSnapshot.findOrFail(snapshot.id)
    assert.equal(loaded.status, 'confirmed')
    assert.equal(loaded.confirmationStatus, 'confirmed')
    assert.equal(loaded.confirmedBy, 2)
    assert.isNotNull(loaded.confirmedAt)
    assert.equal(loaded.confirmedNotes, '确认测试')
  })

  test('dismiss 字段写入回读', async ({ assert }) => {
    const { project } = await setupProject()

    const now = DateTime.now()
    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 7,
      status: 'dismissed',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-dismiss',
      outputHash: 'hash-dismiss',
      sourceHash: 'src-dismiss',
      warnings: null,
      confirmationStatus: 'dismissed',
      dismissedBy: 3,
      dismissedAt: now,
      dismissReason: '不适用',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    const loaded = await ProjectPredictionSnapshot.findOrFail(snapshot.id)
    assert.equal(loaded.status, 'dismissed')
    assert.equal(loaded.dismissedBy, 3)
    assert.equal(loaded.dismissReason, '不适用')
  })

  test('stale 字段写入回读', async ({ assert }) => {
    const { project } = await setupProject()

    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 90,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-stale',
      outputHash: 'hash-stale',
      sourceHash: 'src-stale',
      warnings: null,
      confirmationStatus: 'pending',
      stale: true,
      staleReason: '规则版本已更新',
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    const loaded = await ProjectPredictionSnapshot.findOrFail(snapshot.id)
    assert.ok(loaded.stale, 'stale 应为真值')
    assert.equal(loaded.staleReason, '规则版本已更新')
  })

  test('createdAt / updatedAt 自动生成', async ({ assert }) => {
    const { project } = await setupProject()

    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: 1,
      projectId: Number(project.id),
      window: 30,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-ts',
      outputHash: 'hash-ts',
      sourceHash: 'src-ts',
      warnings: null,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: 1,
      generatedAt: DateTime.now(),
    })

    assert.isNotNull(snapshot.createdAt)
    assert.isNotNull(snapshot.updatedAt)
  })
})

test.group('ProjectPredictionSignal model', (group) => {
  useAuthDatabase(group)

  async function setupSnapshot() {
    const owner = await createUser({ email: uniqueEmail('pred-sig') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)

    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      window: 30,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-parent',
      outputHash: 'hash-parent',
      sourceHash: 'src-parent',
      warnings: null,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: Number(owner.id),
      generatedAt: DateTime.now(),
    })
    return { owner, org, project, snapshot }
  }

  test('基础创建与字段读取', async ({ assert }) => {
    const { snapshot: parent } = await setupSnapshot()

    const signal = await ProjectPredictionSignal.create({
      snapshotId: parent.id,
      signalType: 'schedule_risk',
      severity: 'high',
      score: 45,
      confidenceBand: 'medium',
      confidenceLower: 35,
      confidenceUpper: 55,
      ruleId: 'schedule-risk',
      ruleVersion: '1.0.0',
      description: '排期风险：5 个任务逾期',
      evidenceRefs: [],
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    assert.isNumber(signal.id)
    assert.equal(signal.snapshotId, parent.id)
    assert.equal(signal.signalType, 'schedule_risk')
    assert.equal(signal.severity, 'high')
    assert.equal(signal.score, 45)
    assert.equal(signal.confidenceBand, 'medium')
    assert.equal(signal.ruleId, 'schedule-risk')
    assert.equal(signal.description, '排期风险：5 个任务逾期')
  })

  test('evidenceRefs JSON 序列化', async ({ assert }) => {
    const { snapshot: parent } = await setupSnapshot()

    const refs: PredictionEvidenceRef[] = [
      {
        entityType: 'task',
        entityId: 1,
        summaryHash: 'abc123',
        displaySummary: '任务 A 逾期',
        visibility: 'summary_only',
      },
      {
        entityType: 'task',
        entityId: 2,
        summaryHash: 'def456',
        displaySummary: '任务 B 阻塞',
        visibility: 'summary_only',
      },
    ]

    const signal = await ProjectPredictionSignal.create({
      snapshotId: parent.id,
      signalType: 'dependency_block',
      severity: 'medium',
      score: 60,
      confidenceBand: 'high',
      confidenceLower: 50,
      confidenceUpper: 65,
      ruleId: 'dependency-block',
      ruleVersion: '1.0.0',
      description: '3 个任务阻塞',
      evidenceRefs: refs,
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    const loaded = await ProjectPredictionSignal.findOrFail(signal.id)
    assert.isNotNull(loaded.evidenceRefs)
    assert.lengthOf(loaded.evidenceRefs!, 2)
    assert.equal(loaded.evidenceRefs![0].entityType, 'task')
    assert.equal(loaded.evidenceRefs![1].displaySummary, '任务 B 阻塞')
  })

  test('evidenceRefs = null 回读为 null', async ({ assert }) => {
    const { snapshot: parent } = await setupSnapshot()

    const signal = await ProjectPredictionSignal.create({
      snapshotId: parent.id,
      signalType: 'data_staleness',
      severity: 'low',
      score: 50,
      confidenceBand: 'low',
      confidenceLower: null,
      confidenceUpper: null,
      ruleId: 'data-staleness',
      ruleVersion: '1.0.0',
      description: '近 30 天无活动',
      evidenceRefs: null,
      expiresAt: null,
    })

    const loaded = await ProjectPredictionSignal.findOrFail(signal.id)
    assert.isNull(loaded.evidenceRefs)
    assert.isNull(loaded.expiresAt)
  })

  test('信号类型常量映射', async ({ assert }) => {
    const { snapshot: parent } = await setupSnapshot()

    const types: Array<{ signalType: string; ruleId: string }> = [
      { signalType: 'schedule_risk', ruleId: 'schedule-risk' },
      { signalType: 'critical_path_drift', ruleId: 'critical-path-drift' },
      { signalType: 'milestone_pressure', ruleId: 'milestone-pressure' },
      { signalType: 'dependency_block', ruleId: 'dependency-block' },
      { signalType: 'resource_bottleneck', ruleId: 'resource-bottleneck' },
      { signalType: 'risk_escalation', ruleId: 'risk-escalation' },
      { signalType: 'change_impact', ruleId: 'change-impact' },
      { signalType: 'data_staleness', ruleId: 'data-staleness' },
      { signalType: 'data_quality', ruleId: 'data-quality' },
    ]

    for (const t of types) {
      const signal = await ProjectPredictionSignal.create({
        snapshotId: parent.id,
        signalType: t.signalType as any,
        severity: 'info',
        score: 100,
        confidenceBand: 'high',
        ruleId: t.ruleId,
        ruleVersion: '1.0.0',
        description: `测试 ${t.signalType}`,
        evidenceRefs: [],
        expiresAt: DateTime.now().plus({ days: 7 }),
      })
      assert.isNumber(signal.id)
    }
  })

  test('级联删除 —— 删除快照后信号自动删除', async ({ assert }) => {
    const { snapshot: parent } = await setupSnapshot()

    await ProjectPredictionSignal.create({
      snapshotId: parent.id,
      signalType: 'schedule_risk',
      severity: 'high',
      score: 45,
      confidenceBand: 'medium',
      ruleId: 'schedule-risk',
      ruleVersion: '1.0.0',
      description: '级联测试信号',
      evidenceRefs: [],
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    // 确认信号存在
    const before = await ProjectPredictionSignal.query().where('snapshot_id', parent.id)
    assert.lengthOf(before, 1)

    // 删除快照
    await parent.delete()

    // 确认信号也被级联删除
    const after = await ProjectPredictionSignal.query().where('snapshot_id', parent.id)
    assert.lengthOf(after, 0)
  })

  test('快照 hasMany 关系查询', async ({ assert }) => {
    const { snapshot: parent } = await setupSnapshot()

    await ProjectPredictionSignal.create({
      snapshotId: parent.id,
      signalType: 'schedule_risk',
      severity: 'high',
      score: 45,
      confidenceBand: 'medium',
      ruleId: 'schedule-risk',
      ruleVersion: '1.0.0',
      description: '关系测试信号 1',
      evidenceRefs: [],
      expiresAt: DateTime.now().plus({ days: 7 }),
    })
    await ProjectPredictionSignal.create({
      snapshotId: parent.id,
      signalType: 'milestone_pressure',
      severity: 'low',
      score: 80,
      confidenceBand: 'high',
      ruleId: 'milestone-pressure',
      ruleVersion: '1.0.0',
      description: '关系测试信号 2',
      evidenceRefs: [],
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    const signals = await ProjectPredictionSignal.query().where('snapshot_id', parent.id)
    assert.lengthOf(signals, 2)
  })

  test('多快照信号隔离', async ({ assert }) => {
    const { snapshot: parent } = await setupSnapshot()

    // 创建第二个快照
    const snapshot2 = await ProjectPredictionSnapshot.create({
      organizationId: parent.organizationId,
      projectId: parent.projectId,
      window: 60,
      status: 'pending',
      ruleVersion: '1.0.0',
      inputSignature: 'sig-iso2',
      outputHash: 'hash-iso2',
      sourceHash: 'src-iso2',
      warnings: null,
      confirmationStatus: 'pending',
      stale: false,
      staleReason: null,
      generatedBy: parent.generatedBy,
      generatedAt: DateTime.now(),
    })

    await ProjectPredictionSignal.create({
      snapshotId: parent.id,
      signalType: 'schedule_risk',
      severity: 'high',
      score: 45,
      confidenceBand: 'medium',
      ruleId: 'schedule-risk',
      ruleVersion: '1.0.0',
      description: '快照1信号',
      evidenceRefs: [],
      expiresAt: DateTime.now().plus({ days: 7 }),
    })
    await ProjectPredictionSignal.create({
      snapshotId: snapshot2.id,
      signalType: 'critical_path_drift',
      severity: 'critical',
      score: 20,
      confidenceBand: 'high',
      ruleId: 'critical-path-drift',
      ruleVersion: '1.0.0',
      description: '快照2信号',
      evidenceRefs: [],
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    const signals1 = await ProjectPredictionSignal.query().where('snapshot_id', parent.id)
    const signals2 = await ProjectPredictionSignal.query().where('snapshot_id', snapshot2.id)
    assert.lengthOf(signals1, 1)
    assert.lengthOf(signals2, 1)
    assert.equal(signals1[0].signalType, 'schedule_risk')
    assert.equal(signals2[0].signalType, 'critical_path_drift')
  })
})
