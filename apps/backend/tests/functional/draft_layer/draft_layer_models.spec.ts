/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer Models 功能测试（task 2.6）。
 *
 * 覆盖：
 *   1. 组织隔离：forOrganization 只返回同级组织会话
 *   2. 级联删除：删除会话连带清除变更/预览/应用结果
 *   3. JSON 字段：与会话/变更/预览表 JSON 列的存取
 *   4. 唯一约束：idempotency_key 唯一、(session_id, version) 唯一、preview_hash 可重复
 *   5. 基本 CRUD：创建并读取含变更的会话
 */
import { test } from '@japa/runner'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerChange from '#models/draft_layer_change'
import DraftLayerPreview from '#models/draft_layer_preview'
import DraftLayerApplyResult from '#models/draft_layer_apply_result'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'
import type { DraftLayerSessionSummary } from '@aiproj/types'

const summaryFixture = (
  overrides: Partial<DraftLayerSessionSummary> = {},
): DraftLayerSessionSummary => ({
  compilerRunStatus: 'completed',
  ledgerStatus: 'passed',
  pdmEntityCount: 0,
  totalChanges: 0,
  acceptedChanges: 0,
  rejectedChanges: 0,
  pendingChanges: 0,
  unresolvedConflicts: 0,
  dryRunStatus: null,
  applyStatus: null,
  ...overrides,
})

test.group('Draft Layer 表：隔离/级联/JSON/唯一约束/CRUD', (group) => {
  useAuthDatabase(group)

  // ── 1. 组织隔离 ──────────────────────────────────────────────────

  test('组织隔离：forOrganization 只返回本级组织会话', async ({ assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)

    const sessionA = await DraftLayerSession.create({
      organizationId: orgA.id,
      createdByUserId: ownerA.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
    })
    await DraftLayerSession.create({
      organizationId: orgB.id,
      createdByUserId: ownerB.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
    })

    const scoped = await DraftLayerSession.forOrganization(orgA.id)
    assert.lengthOf(scoped, 1)
    assert.equal(scoped[0].id, sessionA.id)
  })

  // ── 2. 级联删除 ──────────────────────────────────────────────────

  test('级联删除：删除会话级联清除变更/预览/应用结果', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: owner.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
    })

    // 创建变更
    await DraftLayerChange.create({
      sessionId: session.id,
      targetEntityType: 'task',
      targetEntityId: 'task-1',
      operation: 'create',
      value: { name: '新任务' },
      sequence: 1,
      confidence: 0.9,
      dependsOn: [],
      reviewStatus: 'pending',
    })

    // 创建预览
    await DraftLayerPreview.create({
      sessionId: session.id,
      version: 1,
      previewHash: 'hash-cascade',
      computedFromChangeIds: [],
    })

    // 创建应用结果
    await DraftLayerApplyResult.create({
      sessionId: session.id,
      applyPlanHash: 'plan-cascade',
      selectionHash: 'sel-cascade',
      status: 'dry_run_passed',
      idempotencyKey: 'cascade-delete-ik',
    })

    // 删除会话
    await session.delete()

    // 验证子记录全部被级联清除
    assert.equal(
      await DraftLayerChange.query()
        .where('session_id', session.id)
        .then((r) => r.length),
      0,
    )
    assert.equal(
      await DraftLayerPreview.query()
        .where('session_id', session.id)
        .then((r) => r.length),
      0,
    )
    assert.equal(
      await DraftLayerApplyResult.query()
        .where('session_id', session.id)
        .then((r) => r.length),
      0,
    )
  })

  // ── 3. JSON 字段存取 ─────────────────────────────────────────────

  test('JSON 列：会话表 summary/metadata 可存取复杂对象', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: owner.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
      summary: summaryFixture({ totalChanges: 5, acceptedChanges: 3 }),
      metadata: { source: 'compiler-run-42', tags: ['pdm', 'v2'] },
    })

    const reloaded = await DraftLayerSession.findOrFail(session.id)
    assert.deepEqual(reloaded.summary, summaryFixture({ totalChanges: 5, acceptedChanges: 3 }))
    assert.deepEqual(reloaded.metadata, { source: 'compiler-run-42', tags: ['pdm', 'v2'] })
  })

  test('JSON 列：变更表 value/validation_summary 可存取', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: owner.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
    })
    const change = await DraftLayerChange.create({
      sessionId: session.id,
      targetEntityType: 'task',
      targetEntityId: 'task-42',
      operation: 'update',
      value: { name: '更新任务', priority: 'high' },
      oldValue: { name: '旧任务', priority: 'medium' },
      sequence: 2,
      confidence: 0.85,
      dependsOn: [],
      reviewStatus: 'pending',
      validationSummary: { blocking: [], warning: ['需要复核'], info: [] },
    })

    const reloaded = await DraftLayerChange.findOrFail(change.id)
    assert.deepEqual(reloaded.value, { name: '更新任务', priority: 'high' })
    assert.deepEqual(reloaded.oldValue, { name: '旧任务', priority: 'medium' })
    assert.deepEqual(reloaded.validationSummary, { blocking: [], warning: ['需要复核'], info: [] })
  })

  test('JSON 列：预览表 baseline_summary/current_summary 可存取', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: owner.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
    })
    const preview = await DraftLayerPreview.create({
      sessionId: session.id,
      version: 1,
      baselineSummary: { taskCount: 2, wbsNodes: 3 },
      currentSummary: { taskCount: 5, wbsNodes: 6 },
      previewHash: 'hash-json-preview',
      computedFromChangeIds: [1, 2, 3],
      validationSummary: { blocking: [], warning: [], info: [] },
    })

    const reloaded = await DraftLayerPreview.findOrFail(preview.id)
    assert.deepEqual(reloaded.baselineSummary, { taskCount: 2, wbsNodes: 3 })
    assert.deepEqual(reloaded.currentSummary, { taskCount: 5, wbsNodes: 6 })
    assert.deepEqual(reloaded.computedFromChangeIds, [1, 2, 3])
    assert.deepEqual(reloaded.validationSummary, { blocking: [], warning: [], info: [] })
  })

  // ── 4. 唯一/索引约束 ────────────────────────────────────────────

  test('幂等键唯一：idempotency_key 拒绝重复', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: owner.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
    })
    await DraftLayerApplyResult.create({
      sessionId: session.id,
      applyPlanHash: 'plan-1',
      selectionHash: 'sel-1',
      status: 'applied',
      idempotencyKey: 'dup-ik',
    })

    await assert.rejects(
      () =>
        DraftLayerApplyResult.create({
          sessionId: session.id,
          applyPlanHash: 'plan-2',
          selectionHash: 'sel-2',
          status: 'applied',
          idempotencyKey: 'dup-ik', // 相同的幂等键
        }),
      /UNIQUE constraint failed|duplicate/i,
    )
  })

  test('预览唯一约束：相同 session+version 拒绝重复', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: owner.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
    })
    await DraftLayerPreview.create({
      sessionId: session.id,
      version: 1,
      previewHash: 'hash-sv-1',
      computedFromChangeIds: [],
    })

    await assert.rejects(
      () =>
        DraftLayerPreview.create({
          sessionId: session.id,
          version: 1, // 相同的 session_id + version
          previewHash: 'hash-sv-2',
          computedFromChangeIds: [],
        }),
      /UNIQUE constraint failed/i,
    )
  })

  test('preview_hash 允许重复（仅有索引，非唯一约束）', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: owner.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
    })
    await DraftLayerPreview.create({
      sessionId: session.id,
      version: 1,
      previewHash: 'same-preview-hash',
      computedFromChangeIds: [],
    })
    const preview2 = await DraftLayerPreview.create({
      sessionId: session.id,
      version: 2,
      previewHash: 'same-preview-hash', // 相同 hash，不同 version
      computedFromChangeIds: [],
    })

    assert.isNotNull(preview2.id)
  })

  // ── 5. 基本 CRUD ─────────────────────────────────────────────────

  test('基本 CRUD：创建并读取含变更的会话', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await DraftLayerSession.create({
      organizationId: org.id,
      createdByUserId: owner.id,
      sourceType: 'v2_compiler_pdm',
      status: 'active',
      version: 1,
      summary: summaryFixture({ totalChanges: 2 }),
    })
    await DraftLayerChange.create({
      sessionId: session.id,
      targetEntityType: 'task',
      targetEntityId: 'task-1',
      operation: 'create',
      value: { name: '任务一' },
      sequence: 1,
      confidence: 0.95,
      dependsOn: [],
      reviewStatus: 'pending',
    })
    await DraftLayerChange.create({
      sessionId: session.id,
      targetEntityType: 'task',
      targetEntityId: 'task-2',
      operation: 'update',
      value: { name: '任务二', priority: 'high' },
      sequence: 2,
      confidence: 0.8,
      dependsOn: [1],
      reviewStatus: 'accepted',
    })

    const reloaded = await DraftLayerSession.query()
      .where('id', session.id)
      .preload('changes', (q) => q.orderBy('sequence', 'asc'))
      .firstOrFail()

    assert.equal(reloaded.id, session.id)
    assert.equal(reloaded.version, 1)
    assert.equal(reloaded.changes.length, 2)
    assert.equal(reloaded.changes[0].targetEntityId, 'task-1')
    assert.equal(reloaded.changes[1].targetEntityId, 'task-2')
  })
})
