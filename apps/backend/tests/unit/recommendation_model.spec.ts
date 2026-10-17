import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import ProjectRecommendation from '#models/project_recommendation'
import ProjectRecommendationEvent from '#models/project_recommendation_event'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import type {
  RecommendationTargetRef,
  RecommendationEvidenceRef,
  RecommendationWarning,
  RecommendationAiMetadata,
} from '@aiproj/types'

const PM_ROLE = 'project_manager' as const

/**
 * v2-ai-smart-recommendations 2.4 —— 模型 JSON 序列化、组织隔离与事件测试。
 */
test.group('ProjectRecommendation model', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rec-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)
    return { owner, org, project }
  }

  const targetRef: RecommendationTargetRef = {
    entityType: 'task',
    entityId: 1,
    displayName: '测试任务',
    url: '/projects/1/tasks/1',
  }

  test('基础创建与字段读取', async ({ assert }) => {
    const { project } = await setupProject()

    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'risk',
      sourceId: 'risk-1',
      targetRef,
      title: '测试推荐',
      summary: '这是一个测试推荐',
      recommendedAction: '检查风险',
      actionType: 'navigate',
      severity: 'high',
      priority: 80,
      confidence: 'high',
      dedupeKey: 'risk-risk-1',
      inputSignature: 'sig-abc123',
      evidenceHash: 'hash-def456',
      evidenceRefs: null,
      status: 'new',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: null,
      handledAt: null,
    })

    assert.isNumber(rec.id)
    assert.equal(rec.sourceType, 'risk')
    assert.equal(rec.title, '测试推荐')
    assert.equal(rec.severity, 'high')
    assert.equal(rec.priority, 80)
    assert.equal(rec.status, 'new')
    assert.equal(rec.dedupeKey, 'risk-risk-1')
    assert.equal(rec.inputSignature, 'sig-abc123')
    assert.equal(rec.evidenceHash, 'hash-def456')
    assert.isFalse(rec.stale)
  })

  test('targetRef JSON 序列化 prepare/consume', async ({ assert }) => {
    const { project } = await setupProject()

    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'change_impact',
      sourceId: 'impact-1',
      targetRef,
      title: '变更影响推荐',
      summary: '变更影响分析提示',
      recommendedAction: '审查变更',
      actionType: 'navigate',
      severity: 'critical',
      priority: 95,
      confidence: 'high',
      dedupeKey: 'change_impact-impact-1',
      inputSignature: 'sig-imp',
      evidenceHash: 'hash-imp',
      evidenceRefs: null,
      status: 'new',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: null,
      handledAt: null,
    })

    const loaded = await ProjectRecommendation.findOrFail(rec.id)
    assert.isNotNull(loaded.targetRef)
    assert.equal(loaded.targetRef.entityType, 'task')
    assert.equal(loaded.targetRef.displayName, '测试任务')
    assert.equal(loaded.targetRef.url, '/projects/1/tasks/1')
  })

  test('evidenceRefs JSON 序列化 prepare/consume', async ({ assert }) => {
    const { project } = await setupProject()

    const refs: RecommendationEvidenceRef[] = [
      {
        entityType: 'task',
        entityId: 1,
        summaryHash: 'abc123',
        displaySummary: '任务 A 逾期',
        visibility: 'summary_only',
      },
      {
        entityType: 'risk',
        entityId: 2,
        summaryHash: 'def456',
        displaySummary: '风险 B 升级',
        visibility: 'full',
      },
    ]

    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'resource',
      sourceId: 'res-1',
      targetRef,
      title: '资源过载推荐',
      summary: '资源过载提示',
      recommendedAction: '调整资源分配',
      actionType: 'open_preview',
      severity: 'medium',
      priority: 60,
      confidence: 'medium',
      dedupeKey: 'resource-res-1',
      inputSignature: 'sig-evidence',
      evidenceHash: 'hash-evidence',
      evidenceRefs: refs,
      status: 'new',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: null,
      handledAt: null,
    })

    const loaded = await ProjectRecommendation.findOrFail(rec.id)
    assert.isNotNull(loaded.evidenceRefs)
    assert.lengthOf(loaded.evidenceRefs!, 2)
    assert.equal(loaded.evidenceRefs![0].entityType, 'task')
    assert.equal(loaded.evidenceRefs![1].displaySummary, '风险 B 升级')
    assert.equal(loaded.evidenceRefs![0].visibility, 'summary_only')
  })

  test('evidenceRefs = null 回读为 null', async ({ assert }) => {
    const { project } = await setupProject()

    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'dashboard',
      sourceId: 'dash-1',
      targetRef,
      title: 'Dashboard 推荐',
      summary: '指标 warning',
      recommendedAction: null,
      actionType: 'navigate',
      severity: 'low',
      priority: 30,
      confidence: 'low',
      dedupeKey: 'dashboard-dash-1',
      inputSignature: 'sig-null',
      evidenceHash: 'hash-null',
      evidenceRefs: null,
      status: 'new',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: null,
      handledAt: null,
    })

    const loaded = await ProjectRecommendation.findOrFail(rec.id)
    assert.isNull(loaded.evidenceRefs)
  })

  test('warnings JSON 序列化', async ({ assert }) => {
    const { project } = await setupProject()

    const warnings: RecommendationWarning[] = [
      {
        code: 'SOURCE_UNAVAILABLE',
        message: '健康诊断尚未实现',
        blocking: false,
        source: 'health_diagnosis',
      },
      {
        code: 'PERMISSION_FORBIDDEN',
        message: '无资源查看权限',
        blocking: true,
        source: 'resource',
      },
    ]

    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'health_diagnosis',
      sourceId: 'health-1',
      targetRef,
      title: '诊断推荐',
      summary: '健康诊断不可用',
      recommendedAction: null,
      actionType: 'navigate',
      severity: 'info',
      priority: 10,
      confidence: 'low',
      dedupeKey: 'health_diagnosis-health-1',
      inputSignature: 'sig-warn',
      evidenceHash: 'hash-warn',
      evidenceRefs: null,
      status: 'new',
      warnings,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: null,
      handledAt: null,
    })

    const loaded = await ProjectRecommendation.findOrFail(rec.id)
    assert.isNotNull(loaded.warnings)
    assert.lengthOf(loaded.warnings!, 2)
    assert.equal(loaded.warnings![0].code, 'SOURCE_UNAVAILABLE')
    assert.equal(loaded.warnings![1].source, 'resource')
  })

  test('aiMetadata JSON 序列化', async ({ assert }) => {
    const { project } = await setupProject()

    const metadata: RecommendationAiMetadata = {
      provider: 'fake',
      model: 'test-fixture',
      inputTokens: 0,
      outputTokens: 50,
      totalCost: 0,
      currency: 'USD',
      latencyMs: 5,
      inputSignature: 'in-sig',
      outputHash: 'out-hash',
      status: 'pending',
      failureCode: null,
      failureMessage: null,
      narrative: 'AI 解释测试',
      focusPoints: ['关注高风险项'],
      suggestedActions: ['审查'],
      assumptions: ['基于当前快照'],
      confidence: 0.75,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      generatedAt: new Date().toISOString(),
    }

    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'manual',
      sourceId: 'manual-1',
      targetRef,
      title: 'AI 解释推荐',
      summary: 'AI 生成的建议',
      recommendedAction: '审查并处理',
      actionType: 'navigate',
      severity: 'high',
      priority: 75,
      confidence: 'medium',
      dedupeKey: 'manual-manual-1',
      inputSignature: 'sig-ai',
      evidenceHash: 'hash-ai',
      evidenceRefs: null,
      status: 'reviewing',
      warnings: null,
      aiMetadata: metadata,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: null,
      handledAt: null,
    })

    const loaded = await ProjectRecommendation.findOrFail(rec.id)
    assert.isNotNull(loaded.aiMetadata)
    assert.equal(loaded.aiMetadata!.status, 'pending')
    assert.equal(loaded.aiMetadata!.narrative, 'AI 解释测试')
    assert.equal(loaded.aiMetadata!.confidence, 0.75)
    assert.equal(loaded.aiMetadata!.currency, 'USD')
  })

  test('aiMetadata = null 回读为 null', async ({ assert }) => {
    const { project } = await setupProject()

    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'risk',
      sourceId: 'risk-null',
      targetRef,
      title: '无 AI 推荐',
      summary: '纯规则推荐',
      recommendedAction: null,
      actionType: 'navigate',
      severity: 'medium',
      priority: 50,
      confidence: 'high',
      dedupeKey: 'risk-risk-null',
      inputSignature: 'sig-null-ai',
      evidenceHash: 'hash-null-ai',
      evidenceRefs: null,
      status: 'new',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: null,
      handledAt: null,
    })

    const loaded = await ProjectRecommendation.findOrFail(rec.id)
    assert.isNull(loaded.aiMetadata)
  })

  test('所有来源类型可写入', async ({ assert }) => {
    const { project } = await setupProject()
    const sources = [
      'resource',
      'risk',
      'change_impact',
      'dashboard',
      'report',
      'health_diagnosis',
      'prediction',
      'weekly_report',
      'monthly_report',
      'manual',
    ] as const

    for (const source of sources) {
      const rec = await ProjectRecommendation.create({
        organizationId: 1,
        projectId: Number(project.id),
        sourceType: source,
        sourceId: `src-${source}`,
        targetRef,
        title: `来源 ${source}`,
        summary: `来自 ${source} 的推荐`,
        recommendedAction: null,
        actionType: 'navigate',
        severity: 'medium',
        priority: 50,
        confidence: 'medium',
        dedupeKey: `${source}-src-${source}`,
        inputSignature: `sig-${source}`,
        evidenceHash: `hash-${source}`,
        evidenceRefs: null,
        status: 'new',
        warnings: null,
        aiMetadata: null,
        expiresAt: null,
        stale: false,
        staleReason: null,
        createdBy: Number(project.id),
        handledBy: null,
        handledAt: null,
      })
      assert.isNumber(rec.id)
      assert.equal(rec.sourceType, source)
    }
  })

  test('所有状态可写入', async ({ assert }) => {
    const { project } = await setupProject()
    const statuses = [
      'new',
      'reviewing',
      'accepted',
      'dismissed',
      'snoozed',
      'converted',
      'expired',
    ] as const

    for (const status of statuses) {
      const rec = await ProjectRecommendation.create({
        organizationId: 1,
        projectId: Number(project.id),
        sourceType: 'risk',
        sourceId: `status-${status}`,
        targetRef,
        title: `状态 ${status}`,
        summary: `状态测试 ${status}`,
        recommendedAction: null,
        actionType: 'navigate',
        severity: 'medium',
        priority: 50,
        confidence: 'medium',
        dedupeKey: `status-${status}`,
        inputSignature: `sig-${status}`,
        evidenceHash: `hash-${status}`,
        evidenceRefs: null,
        status,
        warnings: null,
        aiMetadata: null,
        expiresAt: null,
        stale: false,
        staleReason: null,
        createdBy: Number(project.id),
        handledBy: null,
        handledAt: null,
      })
      assert.equal(rec.status, status)
    }
  })

  test('handledBy / handledAt 写入回读', async ({ assert }) => {
    const { project, owner } = await setupProject()

    const now = DateTime.now()
    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'risk',
      sourceId: 'handled-1',
      targetRef,
      title: '已处理推荐',
      summary: '已被处理',
      recommendedAction: null,
      actionType: 'navigate',
      severity: 'medium',
      priority: 50,
      confidence: 'medium',
      dedupeKey: 'handled-test',
      inputSignature: 'sig-handled',
      evidenceHash: 'hash-handled',
      evidenceRefs: null,
      status: 'accepted',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: Number(owner.id),
      handledAt: now,
    })

    const loaded = await ProjectRecommendation.findOrFail(rec.id)
    assert.equal(loaded.handledBy, Number(owner.id))
    assert.isNotNull(loaded.handledAt)
    assert.equal(loaded.status, 'accepted')
  })

  test('组织隔离字段存在', async ({ assert }) => {
    const rec = await ProjectRecommendation.create({
      organizationId: 42,
      projectId: 99,
      sourceType: 'risk',
      sourceId: 'org-1',
      targetRef,
      title: '组织隔离测试',
      summary: '组织 42',
      recommendedAction: null,
      actionType: 'navigate',
      severity: 'medium',
      priority: 50,
      confidence: 'medium',
      dedupeKey: 'org-test-42',
      inputSignature: 'sig-org',
      evidenceHash: 'hash-org',
      evidenceRefs: null,
      status: 'new',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: 1,
      handledBy: null,
      handledAt: null,
    })

    assert.equal(rec.organizationId, 42)
    assert.equal(rec.projectId, 99)

    const loaded = await ProjectRecommendation.findOrFail(rec.id)
    assert.equal(loaded.organizationId, 42)
    assert.equal(loaded.projectId, 99)
  })

  test('createdAt / updatedAt 自动生成', async ({ assert }) => {
    const { project } = await setupProject()

    const rec = await ProjectRecommendation.create({
      organizationId: 1,
      projectId: Number(project.id),
      sourceType: 'risk',
      sourceId: 'ts-1',
      targetRef,
      title: '时间戳测试',
      summary: '创建时间自动生成',
      recommendedAction: null,
      actionType: 'navigate',
      severity: 'medium',
      priority: 50,
      confidence: 'medium',
      dedupeKey: 'ts-test',
      inputSignature: 'sig-ts',
      evidenceHash: 'hash-ts',
      evidenceRefs: null,
      status: 'new',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(project.id),
      handledBy: null,
      handledAt: null,
    })

    assert.isNotNull(rec.createdAt)
    assert.isNotNull(rec.updatedAt)
  })
})

test.group('ProjectRecommendationEvent model', (group) => {
  useAuthDatabase(group)

  async function setupRec() {
    const owner = await createUser({ email: uniqueEmail('rec-event') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)

    const targetRef: RecommendationTargetRef = {
      entityType: 'task',
      entityId: 1,
      displayName: '测试任务',
      url: '/projects/1/tasks/1',
    }

    const rec = await ProjectRecommendation.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      sourceType: 'risk',
      sourceId: 'event-test',
      targetRef,
      title: '事件测试推荐',
      summary: '事件测试',
      recommendedAction: null,
      actionType: 'navigate',
      severity: 'medium',
      priority: 50,
      confidence: 'medium',
      dedupeKey: 'event-test',
      inputSignature: 'sig-event',
      evidenceHash: 'hash-event',
      evidenceRefs: null,
      status: 'new',
      warnings: null,
      aiMetadata: null,
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: Number(owner.id),
      handledBy: null,
      handledAt: null,
    })
    return { owner, org, project, rec }
  }

  test('基础创建与字段读取', async ({ assert }) => {
    const { rec, owner } = await setupRec()

    const event = await ProjectRecommendationEvent.create({
      recommendationId: rec.id,
      organizationId: rec.organizationId,
      projectId: rec.projectId,
      eventType: 'generated',
      fromStatus: null,
      toStatus: 'new',
      actorId: Number(owner.id),
      metadata: { reason: '自动刷新' },
      summary: '推荐已生成',
    })

    assert.isNumber(event.id)
    assert.equal(event.recommendationId, rec.id)
    assert.equal(event.eventType, 'generated')
    assert.equal(event.toStatus, 'new')
    assert.equal(event.actorId, Number(owner.id))
    assert.equal(event.summary, '推荐已生成')
  })

  test('事件类型可枚举', async ({ assert }) => {
    const { rec, owner } = await setupRec()
    const eventTypes = [
      'generated',
      'merged',
      'accepted',
      'dismissed',
      'snoozed',
      'converted',
      'expired',
      'ai_explanation',
      'status_changed',
    ]

    for (const eventType of eventTypes) {
      const event = await ProjectRecommendationEvent.create({
        recommendationId: rec.id,
        organizationId: rec.organizationId,
        projectId: rec.projectId,
        eventType,
        fromStatus: null,
        toStatus: null,
        actorId: Number(owner.id),
        metadata: null,
        summary: `测试 ${eventType}`,
      })
      assert.equal(event.eventType, eventType)
    }
  })

  test('metadata JSON 序列化', async ({ assert }) => {
    const { rec, owner } = await setupRec()

    const metadata = { reason: '用户手动接受', sourceType: 'risk', severity: 'high' }

    const event = await ProjectRecommendationEvent.create({
      recommendationId: rec.id,
      organizationId: rec.organizationId,
      projectId: rec.projectId,
      eventType: 'accepted',
      fromStatus: 'new',
      toStatus: 'accepted',
      actorId: Number(owner.id),
      metadata,
      summary: '推荐已接受',
    })

    const loaded = await ProjectRecommendationEvent.findOrFail(event.id)
    assert.isNotNull(loaded.metadata)
    assert.equal(loaded.metadata!.reason, '用户手动接受')
    assert.equal(loaded.metadata!.severity, 'high')
  })

  test('createdAt 自动生成', async ({ assert }) => {
    const { rec, owner } = await setupRec()

    const event = await ProjectRecommendationEvent.create({
      recommendationId: rec.id,
      organizationId: rec.organizationId,
      projectId: rec.projectId,
      eventType: 'generated',
      fromStatus: null,
      toStatus: 'new',
      actorId: Number(owner.id),
      metadata: null,
      summary: '创建时间测试',
    })

    assert.isNotNull(event.createdAt)
  })

  test('多事件关联同一推荐', async ({ assert }) => {
    const { rec, owner } = await setupRec()

    await ProjectRecommendationEvent.create({
      recommendationId: rec.id,
      organizationId: rec.organizationId,
      projectId: rec.projectId,
      eventType: 'generated',
      fromStatus: null,
      toStatus: 'new',
      actorId: Number(owner.id),
      metadata: null,
      summary: '生成',
    })
    await ProjectRecommendationEvent.create({
      recommendationId: rec.id,
      organizationId: rec.organizationId,
      projectId: rec.projectId,
      eventType: 'accepted',
      fromStatus: 'new',
      toStatus: 'accepted',
      actorId: Number(owner.id),
      metadata: null,
      summary: '接受',
    })

    const events = await ProjectRecommendationEvent.query()
      .where('recommendation_id', rec.id)
      .orderBy('created_at', 'asc')
    assert.lengthOf(events, 2)
    assert.equal(events[0].summary, '生成')
    assert.equal(events[1].summary, '接受')
  })
})
