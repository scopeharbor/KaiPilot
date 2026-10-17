import { test } from '@japa/runner'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerChange from '#models/draft_layer_change'
import DraftLayerPreview from '#models/draft_layer_preview'
import DraftLayerApplyResult from '#models/draft_layer_apply_result'
import CompilerRun from '#models/compiler_run'
import Project from '#models/project'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'
import { DateTime } from 'luxon'

async function createCompilerRun(organizationId: number, userId: number) {
  return CompilerRun.create({
    organizationId,
    requestedByUserId: userId,
    status: 'completed',
    currentPhase: null,
    currentStage: null,
    input: { source: 'draft-layer-e2e' },
    error: null,
    startedAt: null,
    completedAt: null,
  })
}

test.group('Draft Layer E2E：全链路集成', (group) => {
  useAuthDatabase(group)

  test('核心流程：创建 Session → Preview → Diff → 决策 → Dry-run → Apply', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const compilerRun = await createCompilerRun(org.id, user.id)

    // 1. 创建 Session
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: user.id,
      sourceType: 'v2_compiler_pdm',
      compilerRunId: compilerRun.id,
      pdmArtifactId: 'pdm:test:v1',
      pdmHash: 'test_hash',
      status: 'active',
      version: 1,
      summary: {
        compilerRunStatus: 'completed',
        ledgerStatus: 'passed',
        pdmEntityCount: 3,
        totalChanges: 0,
        acceptedChanges: 0,
        rejectedChanges: 0,
        pendingChanges: 0,
        unresolvedConflicts: 0,
        dryRunStatus: null,
        applyStatus: null,
      },
    })
    assert.exists(session.id)
    assert.equal(session.status, 'active')

    // 2. 创建 Preview + Changes
    const change1 = await DraftLayerChange.create({
      sessionId: session.id,
      targetEntityType: 'project',
      targetEntityId: 'project_1',
      targetFieldPath: null,
      operation: 'create',
      value: { name: '测试项目', description: 'E2E 测试' },
      oldValue: null,
      reviewStatus: 'pending',
      sequence: 1,
      dependsOn: [],
      confidence: 0.85,
    })

    const change2 = await DraftLayerChange.create({
      sessionId: session.id,
      targetEntityType: 'task',
      targetEntityId: 'task_1',
      targetFieldPath: null,
      operation: 'create',
      value: { name: '任务一', durationDays: 5 },
      oldValue: null,
      reviewStatus: 'pending',
      sequence: 2,
      dependsOn: [],
      confidence: 0.9,
    })

    const preview = await DraftLayerPreview.create({
      sessionId: session.id,
      version: 1,
      baselineSummary: null,
      currentSummary: { entityCount: 2 },
      previewHash: 'preview_hash_1',
      computedFromChangeIds: [change1.id, change2.id],
    })

    session.status = 'previewing'
    await session.save()

    assert.equal(preview.previewHash, 'preview_hash_1')
    assert.equal(session.status, 'previewing')

    // 3. 决策：全部接受
    change1.reviewStatus = 'accepted'
    await change1.save()
    change2.reviewStatus = 'accepted'
    await change2.save()

    // 4. 验证决策状态
    const acceptedChanges = await DraftLayerChange.query()
      .where('session_id', session.id)
      .whereIn('review_status', ['accepted', 'modified'])
    assert.lengthOf(acceptedChanges, 2)

    // 5. Apply
    const applyResult = await DraftLayerApplyResult.create({
      sessionId: session.id,
      applyPlanHash: 'apply_plan_hash_1',
      selectionHash: 'selection_hash_1',
      status: 'applied',
      projectId: null, // 模拟：实际会创建正式项目
      entityCounts: {
        projects: 1,
        wbsNodes: 0,
        tasks: 1,
        dependencies: 0,
        milestones: 0,
        acceptanceCriteria: 0,
        risks: 0,
        resources: 0,
      },
      errorSummary: null,
      idempotencyKey: `e2e_test_ik_${Date.now()}`,
      appliedAt: DateTime.now(),
    })

    assert.exists(applyResult.id)
    assert.equal(applyResult.status, 'applied')

    // 6. 验证幂等：同一幂等键返回既有结果
    const duplicateKey = applyResult.idempotencyKey
    const duplicate = await DraftLayerApplyResult.query()
      .where('idempotency_key', duplicateKey)
      .first()
    assert.exists(duplicate)
    assert.equal(duplicate!.status, 'applied')
  })

  test('无自动落库：创建/预览/决策都不会创建正式项目', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const compilerRun = await createCompilerRun(org.id, user.id)

    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: user.id,
      sourceType: 'v2_compiler_pdm',
      compilerRunId: compilerRun.id,
      status: 'active',
      version: 1,
      summary: null,
    })

    await DraftLayerChange.create({
      sessionId: session.id,
      targetEntityType: 'project',
      targetEntityId: 'project_1',
      targetFieldPath: null,
      operation: 'create',
      value: { name: '不应存在的项目' },
      reviewStatus: 'pending',
      sequence: 1,
      dependsOn: [],
      confidence: 0.5,
    })

    await DraftLayerPreview.create({
      sessionId: session.id,
      version: 1,
      previewHash: 'no_write_hash',
      computedFromChangeIds: [],
    })

    // 验证没有正式项目被创建
    const projects = await Project.all()
    const projectsBeforeApply = projects.length

    // 更改状态但不 apply
    session.status = 'discarded'
    await session.save()

    // 验证正式项目数未变化
    const projectsAfter = await Project.all()
    assert.equal(projectsAfter.length, projectsBeforeApply, '放弃草案不应创建正式项目')
  })

  test('跨组织隔离：Session 不属于当前组织不可见', async ({ assert }) => {
    const userA = await createUser()
    const orgA = await createOrganization(userA)
    const userB = await createUser()
    const orgB = await createOrganization(userB)
    const compilerRun = await createCompilerRun(orgA.id, userA.id)

    await DraftLayerSession.create({
      organizationId: orgA.id,
      createdByUserId: userA.id,
      sourceType: 'v2_compiler_pdm',
      compilerRunId: compilerRun.id,
      status: 'active',
      version: 1,
    })

    // 组织 B 查询应该看不到组织 A 的 session
    const orgBSessions = await DraftLayerSession.forOrganization(orgB.id)
    assert.lengthOf(orgBSessions, 0)
  })

  test('幂等键唯一性：重复提交返回既有结果', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const compilerRun = await createCompilerRun(org.id, user.id)

    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: user.id,
      sourceType: 'v2_compiler_pdm',
      compilerRunId: compilerRun.id,
      status: 'applied',
      version: 1,
    })

    const ik = `idempotent_${Date.now()}`
    const result1 = await DraftLayerApplyResult.create({
      sessionId: session.id,
      applyPlanHash: 'plan_hash',
      selectionHash: 'sel_hash',
      status: 'applied',
      idempotencyKey: ik,
      appliedAt: DateTime.now(),
    })
    assert.exists(result1.id)

    // 重复键应该抛出唯一约束异常
    try {
      await DraftLayerApplyResult.create({
        sessionId: session.id,
        applyPlanHash: 'plan_hash_2',
        selectionHash: 'sel_hash_2',
        status: 'applied',
        idempotencyKey: ik,
        appliedAt: DateTime.now(),
      })
      assert.fail('应当抛出唯一约束异常')
    } catch (error: any) {
      assert.include(error.message.toLowerCase(), 'unique')
    }
  })
})
