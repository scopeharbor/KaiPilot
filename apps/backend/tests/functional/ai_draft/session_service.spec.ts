import { test } from '@japa/runner'
import type { ConfirmedProjectContext, ProjectDraftStreamEvent } from '@aiproj/types'
import AiProjectDraftEvent from '#models/ai_project_draft_event'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import { AIGateway } from '#services/ai_m0/gateway'
import { MockAdapter } from '#services/ai_m0/mock_adapter'
import { ProjectDraftGenerationService } from '#services/ai_draft/generation_service'
import { DraftGenerationRunner } from '#services/ai_draft/draft_generation_runner'
import ProjectDraftSessionService from '#services/ai_draft/session_service'
import { draftValidationGateway } from '#services/ai_draft/validation_gateway'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'

const context: ConfirmedProjectContext = {
  schemaVersion: '1.0',
  rawInput: '开发一个内部审批系统并生成可审查项目草案。',
  parsedIntent: {
    schemaVersion: '1.0',
    projectType: 'software',
    projectName: '内部审批系统',
    objectives: ['减少重复录入'],
    deliverables: [],
    timeline: { startDate: null, deadline: null, durationDays: null },
    constraints: [],
    entities: [],
    overallConfidence: 0.8,
  },
  resolvedFields: {},
  assumptions: {},
  unresolvedCriticalFields: [],
  unansweredOptionalFields: [],
}

test.group('AI 草案会话服务拆分', (group) => {
  useAuthDatabase(group)

  test('pending、随发随写与 complete 元数据/版本形成单调序列', async ({ assert }) => {
    const user = await createUser()
    const organization = await createOrganization(user)
    const sessions = new ProjectDraftSessionService()
    const generation = new ProjectDraftGenerationService()
    const session = await sessions.createPending({
      organizationId: organization.id,
      userId: user.id,
      projectType: 'software',
    })

    assert.equal(session.status, 'drafting')
    assert.equal(session.currentVersion, 0)
    assert.equal(session.schemaVersion, '1.0')
    assert.isNull(await sessions.activeVersion(session))

    const started: ProjectDraftStreamEvent = {
      type: 'draft.started',
      draftId: session.draftUid,
      version: 1,
      sequence: 999,
      projectType: 'software',
      modules: ['charter'],
    }
    const progress: ProjectDraftStreamEvent = {
      type: 'draft.progress',
      draftId: session.draftUid,
      version: 1,
      sequence: 999,
      phase: 'receiving',
      receivedChars: 100,
    }
    assert.equal(await sessions.appendEvent(session, started), 1)
    assert.equal(started.sequence, 1)
    assert.equal(await sessions.appendEvent(session, progress), 2)
    assert.equal(progress.sequence, 2)
    const persistedEvents = await AiProjectDraftEvent.query()
      .where('draft_id', session.id)
      .orderBy('sequence', 'asc')
    assert.deepEqual(
      persistedEvents.map((event) => event.sequence),
      [1, 2],
    )

    const result = await generation.generate({
      context,
      resolved: {
        gateway: new AIGateway(new MockAdapter()),
        provider: 'mock',
        model: 'mock-deterministic-v1',
        usingRealAdapter: false,
        source: 'mock',
      },
    })
    const validation = result.draft
      ? draftValidationGateway.validate({ draft: result.draft })
      : null
    await sessions.completeGeneration(session, { result, validation })
    await session.refresh()

    assert.equal(session.status, 'reviewing')
    assert.equal(session.currentVersion, 1)
    assert.equal(session.provider, result.meta.provider)
    assert.equal(session.model, result.meta.model)
    assert.equal(session.consistency, result.consistency)
    assert.equal(
      await AiProjectDraftVersion.query()
        .where('draft_id', session.id)
        .count('* as total')
        .then((rows) => Number(rows[0].$extras.total)),
      1,
    )
  })

  test('heartbeat 不落库，也不推进恢复 cursor', async ({ assert }) => {
    const user = await createUser()
    const organization = await createOrganization(user)
    const sessions = new ProjectDraftSessionService()
    const session = await sessions.createPending({
      organizationId: organization.id,
      userId: user.id,
      projectType: 'software',
    })
    const heartbeat: ProjectDraftStreamEvent = {
      type: 'draft.heartbeat',
      draftId: session.draftUid,
      version: 1,
      sequence: 4,
      elapsedMs: 5_000,
    }

    assert.equal(await sessions.appendEvent(session, heartbeat), 4)
    assert.lengthOf(await sessions.eventsAfter(session, 0), 0)
  })

  test('无消费连接时 runner 仍可完成版本与终态事件持久化', async ({ assert }) => {
    const user = await createUser()
    const organization = await createOrganization(user)
    const sessions = new ProjectDraftSessionService()
    const generation = new ProjectDraftGenerationService()
    const runner = new DraftGenerationRunner({ completedRetentionMs: 100 })
    const session = await sessions.createPending({
      organizationId: organization.id,
      userId: user.id,
      projectType: 'software',
    })
    assert.isTrue(runner.register(session.draftUid, session, 1))

    const result = await generation.generate({
      context,
      resolved: {
        gateway: new AIGateway(new MockAdapter()),
        provider: 'mock',
        model: 'mock-deterministic-v1',
        usingRealAdapter: false,
        source: 'mock',
      },
    })
    const validation = draftValidationGateway.validate({ draft: result.draft! })
    await sessions.completeGeneration(session, { result, validation })
    const terminal: ProjectDraftStreamEvent = {
      type: 'draft.completed',
      draftId: session.draftUid,
      version: 1,
      sequence: 0,
      draft: result.draft!,
      meta: result.meta,
      validation,
    }
    await sessions.appendEvent(session, terminal)
    runner.pushEvent(session.draftUid, terminal)
    runner.complete(session.draftUid)

    assert.isNotNull(await sessions.activeVersion(session))
    const replayedEvents = await sessions.eventsAfter(session, 0)
    assert.equal(replayedEvents.at(-1)?.type, 'draft.completed')
    assert.equal(runner.readBatch(session.draftUid, 0).events.at(-1)?.type, 'draft.completed')
    runner.cleanupRunner(session.draftUid)
  })

  test('completeGeneration 失败路径保留 generationCheckpoint 诊断且 getDetail 投影 stage/reasonCode/errors', async ({
    assert,
  }) => {
    const user = await createUser()
    const organization = await createOrganization(user)
    const sessions = new ProjectDraftSessionService()
    const session = await sessions.createPending({
      organizationId: organization.id,
      userId: user.id,
      projectType: 'software',
    })

    const failedResult = {
      status: 'failed' as const,
      draft: null,
      meta: {
        schemaVersion: '1.0' as const,
        projectType: 'software' as const,
        structuredStrategy: 'prompt' as const,
        consistency: 'failed' as const,
        fallbackUsed: false,
        provider: 'mock',
        model: 'mock-fail',
        usingRealAdapter: false,
        appliedFixes: [],
        moduleCounts: {
          wbsNodes: 0,
          tasks: 0,
          dependencies: 0,
          acceptanceCriteria: 0,
          resourceHints: 0,
          riskHints: 0,
          milestoneHints: 0,
        },
        groundingManifest: {
          version: '1.0' as const,
          projectType: 'software' as const,
          facts: [],
          hash: 'hash-test',
          truncated: false,
        },
        stages: [
          {
            stage: 'charter_scope' as const,
            status: 'completed' as const,
            contextScope: [],
            allowedTools: [],
            artifactHash: 'hash-charter',
            attemptCount: 1,
            errorCodes: [],
          },
          {
            stage: 'wbs_tasks' as const,
            status: 'failed' as const,
            contextScope: [],
            allowedTools: [],
            artifactHash: null,
            attemptCount: 2,
            errorCodes: ['MODEL_STAGE_OUTPUT_INCOMPLETE'],
          },
        ],
        confirmability: { status: 'failed' as const, reasons: ['MODEL_STAGE_OUTPUT_INCOMPLETE'] },
        repairs: [],
        failure: {
          stage: 'wbs_tasks' as const,
          reasonCode: 'MODEL_STAGE_OUTPUT_INCOMPLETE',
          errors: [{ path: 'tasks[0].name', message: '任务名称缺失', code: 'FIELD_REQUIRED' }],
        },
      },
      consistency: 'failed' as const,
      errorCode: 'MODEL_STAGE_OUTPUT_INCOMPLETE',
      stage: 'wbs_tasks' as const,
      reasonCode: 'MODEL_STAGE_OUTPUT_INCOMPLETE',
      errors: [{ path: 'tasks[0].name', message: '任务名称缺失' }],
      retries: 2,
    }

    await sessions.completeGeneration(session, { result: failedResult, validation: null })
    await session.refresh()

    assert.equal(session.status, 'error')
    assert.equal(session.currentVersion, 0)
    assert.isNotNull(session.generationCheckpoint)
    assert.equal(session.generationCheckpoint?.failedStage?.stage, 'wbs_tasks')
    assert.deepEqual(session.generationCheckpoint?.failedStage?.errorCodes, [
      'MODEL_STAGE_OUTPUT_INCOMPLETE',
    ])

    const detail = await sessions.getDetail(session)
    assert.equal(detail.status, 'error')
    assert.isNotNull(detail.failure)
    assert.equal(detail.failure?.stage, 'wbs_tasks')
    assert.equal(detail.failure?.reasonCode, 'MODEL_STAGE_OUTPUT_INCOMPLETE')
    assert.lengthOf(detail.failure?.errors ?? [], 1)
    assert.equal(detail.failure?.errors?.[0].path, 'tasks[0].name')
    assert.equal(detail.failure?.errors?.[0].message, '任务名称缺失')
  })

  test('getDetail 优先从 draft.failed 事件投影完整的 stage、reasonCode 与脱敏 errors', async ({
    assert,
  }) => {
    const user = await createUser()
    const organization = await createOrganization(user)
    const sessions = new ProjectDraftSessionService()
    const session = await sessions.createPending({
      organizationId: organization.id,
      userId: user.id,
      projectType: 'software',
    })
    session.status = 'error'
    await session.save()

    const failedEvent: ProjectDraftStreamEvent = {
      type: 'draft.failed',
      draftId: session.draftUid,
      version: 1,
      sequence: 1,
      errorCode: 'GROUNDING_VALIDATION_FAILED',
      message: '草案未完整覆盖已确认事实，已阻止进入确认导入。',
      consistency: 'failed',
      stage: 'reconcile_review',
      reasonCode: 'HL-001',
      errors: [
        {
          path: 'charter.objectives',
          message: '缺少必需业务事实项 Authorization: Bearer sk-secret12345678',
          code: 'HL-001',
        },
      ],
    }
    await sessions.appendEvent(session, failedEvent)

    const detail = await sessions.getDetail(session)
    assert.equal(detail.status, 'error')
    assert.isNotNull(detail.failure)
    assert.equal(detail.failure?.stage, 'reconcile_review')
    assert.equal(detail.failure?.reasonCode, 'HL-001')
    assert.lengthOf(detail.failure?.errors ?? [], 1)
    assert.equal(detail.failure?.errors?.[0].code, 'HL-001')
  })
})
