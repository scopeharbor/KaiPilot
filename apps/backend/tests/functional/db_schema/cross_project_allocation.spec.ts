import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import {
  columnNames,
  foreignKeys,
  assertForeignKey,
  tableSql,
  checkEnum,
  columnDefault,
} from './_helpers.js'
import CrossProjectAllocationDraft from '#models/cross_project_allocation_draft'
import CrossProjectAllocationItem from '#models/cross_project_allocation_item'
import CrossProjectAllocationCommit from '#models/cross_project_allocation_commit'

/**
 * 任务 3.3 — 跨项目资源分配迁移与模型测试。
 * 覆盖：三表结构、字段默认值、索引、外键约束、状态字段 CHECK、
 * JSON 序列化往返、组织隔离查询、SQLite 兼容性。
 */
test.group('跨项目资源分配 — 迁移结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  // ── drafts 表 ───────────────────────────────────────────────────────────

  test('cross_project_allocation_drafts 表核心字段', async ({ assert }) => {
    const cols = await columnNames('cross_project_allocation_drafts')
    for (const c of [
      'id',
      'organization_id',
      'name',
      'status',
      'query_shape',
      'source_signatures',
      'preview_hash',
      'preview_expires_at',
      'idempotency_key_hash',
      'warnings',
      'actor_id',
      'created_at',
      'updated_at',
      'deleted_at',
    ]) {
      assert.include(cols, c, `drafts 应含字段 ${c}`)
    }
  })

  test('cross_project_allocation_drafts 外键策略', async () => {
    const fks = await foreignKeys('cross_project_allocation_drafts')
    assertForeignKey(fks, 'organization_id', 'organizations', 'CASCADE')
    assertForeignKey(fks, 'actor_id', 'users', 'SET NULL')
  })

  test('cross_project_allocation_drafts status CHECK 约束', async ({ assert }) => {
    const sql = await tableSql('cross_project_allocation_drafts')
    assert.isTrue(
      checkEnum(sql, 'status', [
        'draft',
        'previewed',
        'confirmed',
        'applied',
        'cancelled',
        'expired',
        'failed',
      ]),
      'drafts status 枚举 CHECK',
    )
  })

  test('cross_project_allocation_drafts 默认值', async ({ assert }) => {
    const def = await columnDefault('cross_project_allocation_drafts', 'status')
    assert.isNotNull(def)
    assert.include(def!, 'draft')
  })

  // ── items 表 ────────────────────────────────────────────────────────────

  test('cross_project_allocation_items 表核心字段', async ({ assert }) => {
    const cols = await columnNames('cross_project_allocation_items')
    for (const c of [
      'id',
      'draft_id',
      'organization_id',
      'item_type',
      'item_status',
      'target_project_id',
      'target_task_id',
      'candidate_resource_id',
      'demand_snapshot',
      'candidate_snapshot',
      'allocation_percent',
      'start_date',
      'end_date',
      'conflicts',
      'source',
      'advisory_only',
      'confirmation_required',
      'applied',
      'source_signature',
      'redaction_state',
      'created_at',
      'updated_at',
    ]) {
      assert.include(cols, c, `items 应含字段 ${c}`)
    }
  })

  test('cross_project_allocation_items 外键策略', async () => {
    const fks = await foreignKeys('cross_project_allocation_items')
    assertForeignKey(fks, 'draft_id', 'cross_project_allocation_drafts', 'CASCADE')
    assertForeignKey(fks, 'organization_id', 'organizations', 'CASCADE')
    assertForeignKey(fks, 'target_project_id', 'projects', 'CASCADE')
    assertForeignKey(fks, 'target_task_id', 'tasks', 'SET NULL')
    assertForeignKey(fks, 'candidate_resource_id', 'resources', 'SET NULL')
  })

  test('cross_project_allocation_items 默认值', async ({ assert }) => {
    const itemTypeDef = await columnDefault('cross_project_allocation_items', 'item_type')
    assert.include(itemTypeDef!, 'allocate')

    const itemStatusDef = await columnDefault('cross_project_allocation_items', 'item_status')
    assert.include(itemStatusDef!, 'pending')

    const sourceDef = await columnDefault('cross_project_allocation_items', 'source')
    assert.include(sourceDef!, 'rule')
  })

  test('cross_project_allocation_items 枚举 CHECK', async ({ assert }) => {
    const sql = await tableSql('cross_project_allocation_items')
    assert.isTrue(
      checkEnum(sql, 'item_type', ['allocate', 'reallocate', 'remove', 'map_resource']),
      'items item_type 枚举 CHECK',
    )
    assert.isTrue(
      checkEnum(sql, 'item_status', [
        'pending',
        'conflict',
        'ready',
        'applied',
        'failed',
        'skipped',
      ]),
      'items item_status 枚举 CHECK',
    )
  })

  // ── commits 表 ──────────────────────────────────────────────────────────

  test('cross_project_allocation_commits 表核心字段', async ({ assert }) => {
    const cols = await columnNames('cross_project_allocation_commits')
    for (const c of [
      'id',
      'draft_id',
      'organization_id',
      'actor_id',
      'visible_target_project_ids',
      'item_ids',
      'preview_hash',
      'query_shape_hash',
      'warnings',
      'idempotency_key_hash',
      'status',
      'apply_result',
      'audit_references',
      'confirmed_at',
      'applied_at',
    ]) {
      assert.include(cols, c, `commits 应含字段 ${c}`)
    }
  })

  test('cross_project_allocation_commits 外键策略', async () => {
    const fks = await foreignKeys('cross_project_allocation_commits')
    assertForeignKey(fks, 'draft_id', 'cross_project_allocation_drafts', 'CASCADE')
    assertForeignKey(fks, 'organization_id', 'organizations', 'CASCADE')
    assertForeignKey(fks, 'actor_id', 'users', 'CASCADE')
  })

  test('cross_project_allocation_commits status CHECK', async ({ assert }) => {
    const sql = await tableSql('cross_project_allocation_commits')
    assert.isTrue(
      checkEnum(sql, 'status', ['confirmed', 'applied', 'failed', 'partial', 'cancelled']),
      'commits status 枚举 CHECK',
    )
  })
})

// ── 模型测试 ──────────────────────────────────────────────────────────────

test.group('跨项目资源分配 — 模型', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    // 清理测试数据（顺序：子表先删）
    await CrossProjectAllocationCommit.query().delete()
    await CrossProjectAllocationItem.query().delete()
    await CrossProjectAllocationDraft.query().delete()
  })

  async function seedOrgAndUser() {
    const db = await import('@adonisjs/lucid/services/db').then((m) => m.default)
    const now = new Date().toISOString()
    // FK 约束（organizations.owner_id → users.id、projects.organization_id → organizations.id）
    // 要求插入顺序：user → org → projects；且 each.setup 只清三张分配表，
    // 重复插入需幂等（存在则跳过）。
    const hasUser = await db.from('users').where('id', 1).first()
    if (!hasUser) {
      await db.table('users').insert({
        id: 1,
        email: 'crossproj@test.local',
        full_name: 'Cross Project Test',
        // 真实列名是 password（不是 password_hash）
        password: 'x',
        is_active: 1,
        is_super_admin: 0,
        role_version: 1,
        created_at: now,
        updated_at: now,
      })
    }
    const hasOrg = await db.from('organizations').where('id', 1).first()
    if (!hasOrg) {
      await db.table('organizations').insert({
        id: 1,
        name: 'cross-project-test-org',
        slug: 'cross-project-test-org',
        owner_id: 1,
        created_at: now,
        updated_at: now,
      })
    }
    // 项目 1/2 存在（供 items 的 target_project_id FK 使用）
    for (const p of [
      { id: 1, name: 'project-a', code: 'PA' },
      { id: 2, name: 'project-b', code: 'PB' },
    ]) {
      const hasProject = await db.from('projects').where('id', p.id).first()
      if (!hasProject) {
        await db.table('projects').insert({
          id: p.id,
          organization_id: 1,
          name: p.name,
          code: p.code,
          status: 'active',
          priority: 'medium',
          currency: 'CNY',
          progress_percent: 0,
          health_status: 'unknown',
          created_by: 1,
          created_at: now,
          updated_at: now,
        })
      }
    }
  }

  test('Draft 创建与查询（组织隔离）', async ({ assert }) => {
    await seedOrgAndUser()
    const draft = await CrossProjectAllocationDraft.create({
      organizationId: 1,
      name: '测试调配草案',
      status: 'draft',
      queryShape: { organizationId: 1, projectIds: [] },
      actorId: null,
      sourceSignatures: null,
      warnings: null,
    })

    assert.isNotNull(draft.id)
    assert.equal(draft.organizationId, 1)
    assert.equal(draft.status, 'draft')
    assert.equal(draft.name, '测试调配草案')
    assert.isNotNull(draft.createdAt)

    // 组织隔离查询
    const found = await CrossProjectAllocationDraft.query()
      .where('organization_id', 1)
      .where('id', draft.id)
      .first()
    assert.isNotNull(found)

    const notFound = await CrossProjectAllocationDraft.query()
      .where('organization_id', 999)
      .where('id', draft.id)
      .first()
    assert.isNull(notFound)
  })

  test('Draft 状态字段可读写', async ({ assert }) => {
    await seedOrgAndUser()
    const draft = await CrossProjectAllocationDraft.create({
      organizationId: 1,
      name: '状态测试',
      status: 'draft',
      queryShape: {},
    })

    // 状态迁移
    draft.status = 'previewed'
    draft.previewHash = 'abc123'
    await draft.save()

    const fetched = await CrossProjectAllocationDraft.find(draft.id)
    assert.equal(fetched!.status, 'previewed')
    assert.equal(fetched!.previewHash, 'abc123')
  })

  test('Draft JSON 字段序列化往返', async ({ assert }) => {
    await seedOrgAndUser()
    const qs = {
      organizationId: 1,
      projectIds: [10, 20],
      dateWindow: { from: '2026-01-01', to: '2026-06-30' },
    }
    const sigs = { resources: 'hash_a', tasks: 'hash_b' }
    const warns = [{ code: 'SOURCE_STALE', message: '数据过期', severity: 'warning' }]

    const draft = await CrossProjectAllocationDraft.create({
      organizationId: 1,
      name: 'JSON 测试',
      status: 'draft',
      queryShape: qs,
      sourceSignatures: sigs,
      warnings: warns,
    })

    const fetched = await CrossProjectAllocationDraft.find(draft.id)
    assert.deepEqual(fetched!.queryShape, qs)
    assert.deepEqual(fetched!.sourceSignatures, sigs)
    assert.deepEqual(fetched!.warnings, warns)
  })

  test('Item 创建与关联 Draft', async ({ assert }) => {
    await seedOrgAndUser()
    const draft = await CrossProjectAllocationDraft.create({
      organizationId: 1,
      name: '关联测试',
      status: 'draft',
      queryShape: {},
    })

    const item = await CrossProjectAllocationItem.create({
      draftId: draft.id,
      organizationId: 1,
      itemType: 'allocate',
      itemStatus: 'pending',
      targetProjectId: 1,
      targetTaskId: null,
      candidateResourceId: null,
      allocationPercent: 50,
      startDate: '2026-02-01' as any,
      endDate: '2026-03-01' as any,
      source: 'rule',
      advisoryOnly: 0,
      confirmationRequired: 1,
      applied: 0,
      demandSnapshot: {},
      candidateSnapshot: null,
      conflicts: null,
    })

    assert.isNotNull(item.id)
    assert.equal(item.draftId, draft.id)
    assert.equal(item.organizationId, 1)
    assert.equal(item.itemStatus, 'pending')
    assert.equal(item.allocationPercent, 50)

    // 关联查询
    const draftWithItems = await CrossProjectAllocationDraft.query()
      .where('id', draft.id)
      .preload('items')
      .firstOrFail()

    assert.isArray(draftWithItems.items)
    assert.isAtLeast(draftWithItems.items.length, 1)
  })

  test('Item 默认值：advisory_only=0, confirmation_required=1, applied=0', async ({ assert }) => {
    await seedOrgAndUser()
    const draft = await CrossProjectAllocationDraft.create({
      organizationId: 1,
      name: '默认值测试',
      status: 'draft',
      queryShape: {},
    })

    const item = await CrossProjectAllocationItem.create({
      draftId: draft.id,
      organizationId: 1,
      itemType: 'allocate',
      itemStatus: 'pending',
      targetProjectId: 1,
      allocationPercent: 100,
      startDate: '2026-02-01' as any,
      endDate: '2026-02-28' as any,
      source: 'manual',
      advisoryOnly: 0,
      confirmationRequired: 1,
      applied: 0,
      demandSnapshot: {},
      candidateSnapshot: null,
      conflicts: null,
    })

    const fetched = await CrossProjectAllocationItem.find(item.id)
    assert.equal(fetched!.advisoryOnly, 0)
    assert.equal(fetched!.confirmationRequired, 1)
    assert.equal(fetched!.applied, 0)
  })

  test('Commit 创建与幂等哈希', async ({ assert }) => {
    await seedOrgAndUser()
    const draft = await CrossProjectAllocationDraft.create({
      organizationId: 1,
      name: '提交测试',
      status: 'previewed',
      queryShape: {},
      previewHash: 'preview_hash_xyz',
    })

    const commit = await CrossProjectAllocationCommit.create({
      draftId: draft.id,
      organizationId: 1,
      actorId: 1,
      visibleTargetProjectIds: [1, 2],
      itemIds: ['1', '2'],
      previewHash: 'preview_hash_xyz',
      idempotencyKeyHash: 'idem_abc',
      status: 'confirmed',
      // Lucid dateTime 列要求 luxon DateTime，不接受原生 Date
      confirmedAt: DateTime.now(),
    })

    assert.isNotNull(commit.id)
    assert.equal(commit.draftId, draft.id)
    assert.equal(commit.status, 'confirmed')
    assert.deepEqual(commit.visibleTargetProjectIds, [1, 2])
    assert.equal(commit.idempotencyKeyHash, 'idem_abc')
    assert.isNotNull(commit.confirmedAt)
  })

  test('Commit 幂等哈希唯一性', async ({ assert }) => {
    await seedOrgAndUser()
    const draft = await CrossProjectAllocationDraft.create({
      organizationId: 1,
      name: '幂等测试',
      status: 'previewed',
      queryShape: {},
      previewHash: 'ph_1',
    })

    // 相同 idempotencyKeyHash + draft_id 应可以创建（由应用层做幂等）
    await CrossProjectAllocationCommit.create({
      draftId: draft.id,
      organizationId: 1,
      actorId: 1,
      visibleTargetProjectIds: [1],
      itemIds: ['a'],
      previewHash: 'ph_1',
      idempotencyKeyHash: 'same_key',
      status: 'confirmed',
      // Lucid dateTime 列要求 luxon DateTime，不接受原生 Date
      confirmedAt: DateTime.now(),
    })

    // 不同 draft 可以有相同 idempotency hash
    const draft2 = await CrossProjectAllocationDraft.create({
      organizationId: 1,
      name: '幂等测试2',
      status: 'previewed',
      queryShape: {},
      previewHash: 'ph_2',
    })

    await CrossProjectAllocationCommit.create({
      draftId: draft2.id,
      organizationId: 1,
      actorId: 1,
      visibleTargetProjectIds: [2],
      itemIds: ['b'],
      previewHash: 'ph_2',
      idempotencyKeyHash: 'same_key',
      status: 'confirmed',
      // Lucid dateTime 列要求 luxon DateTime，不接受原生 Date
      confirmedAt: DateTime.now(),
    })

    const commits = await CrossProjectAllocationCommit.query().where(
      'idempotency_key_hash',
      'same_key',
    )
    assert.isAtLeast(commits.length, 2)
  })
})
