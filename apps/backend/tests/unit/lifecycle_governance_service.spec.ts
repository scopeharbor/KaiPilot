/**
 * v3-four-layer-knowledge-system —— LifecycleGovernanceService 单测。
 *
 * 覆盖：L1 定期评审过时、L2 未引用降级、L3 复验标记、
 * 降级不删内容、过时项退出默认检索（active only）、reviewHistory 只追加、
 * L4 到期清理（委托 CollectL4Service，已在 synthesize_collect_l4_service.spec.ts 覆盖）。
 *
 * @aiproj/backend
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import Database from '@adonisjs/lucid/services/db'
import KnowledgeService from '#services/knowledge/knowledge_service'
import LifecycleGovernanceService from '#services/knowledge/lifecycle_governance_service'
import KnowledgeItem from '#models/knowledge_item'
import AuditLog from '#models/audit_log'

const ORG_ID = 401

test.group('LifecycleGovernanceService', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await KnowledgeItem.query().delete()
    await AuditLog.query().delete()
  })

  // ── L1 定期评审过时 ────────────────────────────────────────

  test('L1 超过评审期 → outdated', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const govSvc = await testUtils.app.container.make(LifecycleGovernanceService)

    // 创建 L1 记录并确认
    const item = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'L1 规范条目',
      content: '规范内容',
      domain: '进度管理',
      purpose: '规划',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'l1-gov', title: 'L1 治理来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, item.id)

    // 手动设置 updatedAt 为 13 个月之前（绕过 Lucid DateTime 列的序列化）
    const date13MonthsAgo = new Date()
    date13MonthsAgo.setMonth(date13MonthsAgo.getMonth() - 13)
    await Database.rawQuery(
      'UPDATE knowledge_items SET updated_at = ? WHERE id = ? AND organization_id = ?',
      [DateTime.fromJSDate(date13MonthsAgo).toFormat('yyyy-MM-dd HH:mm:ss.SSS'), item.id, ORG_ID],
    )

    const result = await govSvc.reviewL1Outdated(ORG_ID)
    assert.isAtLeast(result.count, 1, '应至少标记 1 条 outdated')
    assert.include(result.affectedIds, item.id)

    // 验证状态已变为 outdated
    const afterItem = await knowledgeSvc.getById(ORG_ID, item.id)
    assert.equal(afterItem.status, 'outdated', 'L1 记录应标记为 outdated')
    assert.isAtLeast(afterItem.reviewHistory.length, 3, '审核记录应追加')
  })

  test('L1 仍在评审期内不标记', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const govSvc = await testUtils.app.container.make(LifecycleGovernanceService)

    const item = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'L1 近期更新条目',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'l1-recent', title: '近期来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, item.id)
    // updatedAt 默认就是现在，不应被标记

    const result = await govSvc.reviewL1Outdated(ORG_ID)
    assert.equal(result.count, 0, '近期记录的 L1 不应被标记为 outdated')
  })

  // ── L2 未引用降级 ──────────────────────────────────────────

  test('L2 6 个月未引用 → deprecated', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const govSvc = await testUtils.app.container.make(LifecycleGovernanceService)

    const item = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L2',
      title: 'L2 观察条目',
      content: '观察内容',
      domain: '进度管理',
      purpose: '监控',
      provenance: {
        sources: [{ layer: 'L2', sourceId: 'l2-gov', title: 'L2 治理来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, item.id)

    // 手动设置 lastReferencedAt 为 7 个月之前（绕过 Lucid DateTime 列的序列化）
    const date7MonthsAgo = new Date()
    date7MonthsAgo.setMonth(date7MonthsAgo.getMonth() - 7)
    await Database.rawQuery(
      'UPDATE knowledge_items SET last_referenced_at = ? WHERE id = ? AND organization_id = ?',
      [DateTime.fromJSDate(date7MonthsAgo).toFormat('yyyy-MM-dd HH:mm:ss.SSS'), item.id, ORG_ID],
    )

    const result = await govSvc.downgradeL2Unreferenced(ORG_ID)
    assert.isAtLeast(result.count, 1, '应至少降级 1 条 L2')
    assert.include(result.affectedIds, item.id)

    const afterItem = await knowledgeSvc.getById(ORG_ID, item.id)
    assert.equal(afterItem.status, 'deprecated', 'L2 未引用应降级为 deprecated')
  })

  test('L2 lastReferencedAt 为 null 也被降级', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const govSvc = await testUtils.app.container.make(LifecycleGovernanceService)

    const item = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L2',
      title: 'L2 从未引用条目',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L2', sourceId: 'l2-null', title: 'NULL 来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, item.id)
    // lastReferencedAt 默认就是 null

    const result = await govSvc.downgradeL2Unreferenced(ORG_ID)
    assert.isAtLeast(result.count, 1, 'lastReferencedAt 为 null 的 L2 应被降级')
  })

  // ── L3 复验 ────────────────────────────────────────────────

  test('L3 创建超过 3 个月追加复验标记', async ({ assert }) => {
    const govSvc = await testUtils.app.container.make(LifecycleGovernanceService)

    // 直接创建 L3 active 记录
    const l3 = new KnowledgeItem()
    l3.organizationId = ORG_ID
    l3.layer = 'L3'
    l3.layerMeta = {
      layer: 'L3',
      trust: '仅测试',
      source: '合成案例',
      usage: '仅测试',
      frequency: '按需合成',
      annotation: ['SYNTHETIC'],
    }
    l3.title = 'L3 合成条目'
    l3.content = '合成内容'
    l3.status = 'active'
    l3.domain = '进度管理'
    l3.purpose = '测试'
    l3.provenance = {
      sources: [{ layer: 'L3', sourceId: 'l3-gov', title: 'L3 来源' }],
      reviewHistory: [],
    }
    l3.reviewHistory = []
    l3.isSynthetic = true
    l3.syntheticMethod = 'model=claude-opus-4-8, temperature=0.7, seed=42'
    l3.createdBy = 1
    // 手动设置创建时间为 4 个月之前
    const date4MonthsAgo = new Date()
    date4MonthsAgo.setMonth(date4MonthsAgo.getMonth() - 4)
    l3.createdAt = DateTime.fromJSDate(date4MonthsAgo)
    await l3.save()

    const reviewHistoryBefore = l3.reviewHistory.length

    const result = await govSvc.reverifyL3(ORG_ID)
    assert.isAtLeast(result.count, 1, '应至少复验 1 条 L3')

    // 重新加载并验证
    const afterL3 = await KnowledgeItem.forOrganization(ORG_ID).where('id', l3.id).first()
    assert.isAtLeast(
      afterL3!.reviewHistory.length,
      reviewHistoryBefore + 1,
      '应追加 1 条复验审核记录',
    )
    assert.equal(afterL3!.status, 'active', 'L3 复验不改状态——仍为 active')
  })

  // ── 降级不删内容 ────────────────────────────────────────────

  test('降级后内容保留', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const govSvc = await testUtils.app.container.make(LifecycleGovernanceService)

    const item = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L2',
      title: '降级内容保留测试',
      content: { key: 'value', data: '重要数据' },
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L2', sourceId: 'keep-content', title: '内容测试' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, item.id)

    // 强制降级
    const date7MonthsAgo = new Date()
    date7MonthsAgo.setMonth(date7MonthsAgo.getMonth() - 7)
    await Database.rawQuery(
      'UPDATE knowledge_items SET last_referenced_at = ? WHERE id = ? AND organization_id = ?',
      [DateTime.fromJSDate(date7MonthsAgo).toFormat('yyyy-MM-dd HH:mm:ss.SSS'), item.id, ORG_ID],
    )

    await govSvc.downgradeL2Unreferenced(ORG_ID)

    const afterItem = await knowledgeSvc.getById(ORG_ID, item.id)
    assert.equal(afterItem.status, 'deprecated')
    assert.deepEqual(afterItem.content, { key: 'value', data: '重要数据' }, '降级后内容不丢失')
    assert.equal(afterItem.title, '降级内容保留测试', '降级后标题不丢失')
  })

  // ── 过时项退出默认检索（active only） ──────────────────────

  test('过时项不进入默认生产检索', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)

    // 创建 active L2 记录
    const activeItem = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L2',
      title: '活跃 L2 条目',
      content: '活跃内容',
      domain: '进度管理',
      purpose: '监控',
      provenance: {
        sources: [{ layer: 'L2', sourceId: 'active-item', title: '活跃来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, activeItem.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, activeItem.id)

    // 创建同 domain 的 deprecated 记录
    const deprecatedItem = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L2',
      title: '已降级 L2 条目',
      content: '过时内容',
      domain: '进度管理',
      purpose: '监控',
      provenance: {
        sources: [{ layer: 'L2', sourceId: 'deprecated-item', title: '过时来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, deprecatedItem.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, deprecatedItem.id)
    // 手动标记为 deprecated
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, deprecatedItem.id, 'deprecated')

    // 默认检索——只看 active 状态
    const result = await knowledgeSvc.query(ORG_ID, { domain: '进度管理' })
    const ids = result.data.map((i) => i.id)
    assert.include(ids, activeItem.id, 'active 记录应出现在检索结果中')
    // deprecated 不应出现在生产检索中（index 过滤 status=active）
    const deprecatedInResult = result.data.filter((i) => i.id === deprecatedItem.id)
    assert.equal(deprecatedInResult.length, 0, 'deprecated 记录不应出现在默认生产检索中')
  })

  test('outdated 项 exit 默认检索，不删内容', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)

    const item = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'outdated 不删内容测试',
      content: { rule: '内容应保留' },
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'outdated-keep', title: '来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, item.id)
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, item.id, 'outdated')

    // 确认通过 getById 仍可查到
    const fetched = await knowledgeSvc.getById(ORG_ID, item.id)
    assert.isNotNull(fetched, 'outdated 记录应能通过 getById 查到')
    assert.equal(fetched.status, 'outdated')
    assert.deepEqual(fetched.content, { rule: '内容应保留' }, 'outdated 记录内容不丢失')

    // 确认不在生产检索路径
    const result = await knowledgeSvc.query(ORG_ID, { domain: '测试' })
    const found = result.data.filter((i) => i.id === item.id)
    assert.equal(found.length, 0, 'outdated 记录不应出现在默认生产检索中')
  })

  // ── reviewHistory 只追加 ────────────────────────────────────

  test('reviewHistory 只追加不可覆盖', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const govSvc = await testUtils.app.container.make(LifecycleGovernanceService)

    const item = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L2',
      title: 'reviewHistory 只追加测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L2', sourceId: 'append-test', title: '来源' }],
      },
    })
    const historyAfterCreate = item.reviewHistory.length

    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, item.id)

    // 强制降级（产生新的 ReviewRecord）
    const date7MonthsAgo = new Date()
    date7MonthsAgo.setMonth(date7MonthsAgo.getMonth() - 7)
    await Database.rawQuery(
      'UPDATE knowledge_items SET last_referenced_at = ? WHERE id = ? AND organization_id = ?',
      [DateTime.fromJSDate(date7MonthsAgo).toFormat('yyyy-MM-dd HH:mm:ss.SSS'), item.id, ORG_ID],
    )

    await govSvc.downgradeL2Unreferenced(ORG_ID)

    const finalItem = await knowledgeSvc.getById(ORG_ID, item.id)
    // transitionLifecycle(create 自身不产 reviewRecord → pending, pending → active/confirmed)
    // 至少应 ≥ create + transition×2 + confirmed + downgrade = 4+
    assert.isAtLeast(
      finalItem.reviewHistory.length,
      historyAfterCreate + 3,
      '审核记录应只追加——应有 ≥3 条新记录（2 条转移 + 1 条降级）',
    )
  })

  // ── 综合治理运行 ────────────────────────────────────────────

  test('runAll 执行全部四层治理', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const govSvc = await testUtils.app.container.make(LifecycleGovernanceService)

    // 创建 L1 过期记录
    const l1 = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'L1 过期条目',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'runall-l1', title: 'L1 来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, l1.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, l1.id)
    const date13MonthsAgo = new Date()
    date13MonthsAgo.setMonth(date13MonthsAgo.getMonth() - 13)
    await KnowledgeItem.forOrganization(ORG_ID)
      .where('id', l1.id)
      .update({ updatedAt: DateTime.fromJSDate(date13MonthsAgo).toISO()! })

    // 创建 L2 未引用记录
    const l2 = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L2',
      title: 'L2 未引用条目',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L2', sourceId: 'runall-l2', title: 'L2 来源' }],
      },
    })
    await knowledgeSvc.transitionLifecycle(ORG_ID, 1, l2.id, 'pending')
    await knowledgeSvc.confirm(ORG_ID, 1, l2.id)
    // lastReferencedAt 已经是 null，满足降级条件

    const results = await govSvc.runAll(ORG_ID)
    assert.equal(results.length, 3, '应返回 L1/L2/L3 三种治理结果')
    assert.equal(results[0].action, 'review_l1_outdated')
    assert.equal(results[1].action, 'downgrade_l2_unreferenced')
    assert.equal(results[2].action, 'reverify_l3')

    assert.isAtLeast(results[0].count, 1, 'L1 治理应 ≥1')
    assert.isAtLeast(results[1].count, 1, 'L2 治理应 ≥1')
  })
})
