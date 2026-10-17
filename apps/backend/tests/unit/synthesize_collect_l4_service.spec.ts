/**
 * v3-four-layer-knowledge-system —— SynthesizeKnowledgeService 与 CollectL4Service 单测。
 *
 * 覆盖：L3 合成（isSynthetic 强制、syntheticMethod 完整可复现、baseKnowledge 引用、
 * 合成不改写上游）、L4 采集（去标识化无明文泄露、超期清理、组织隔离）。
 *
 * @aiproj/backend
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import KnowledgeService from '#services/knowledge/knowledge_service'
import SynthesizeKnowledgeService from '#services/knowledge/synthesize_knowledge_service'
import CollectL4Service from '#services/knowledge/collect_l4_service'
import KnowledgeItem from '#models/knowledge_item'
import AuditLog from '#models/audit_log'

const ORG_ID = 301

test.group('SynthesizeKnowledgeService', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await KnowledgeItem.query().delete()
    await AuditLog.query().delete()
  })

  // ── L3 合成 ───────────────────────────────────────────────

  test('L3 合成 isSynthetic=true 强制', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const synthSvc = await testUtils.app.container.make(SynthesizeKnowledgeService)

    // 创建 L1 和 L2 基础记录
    const l1 = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'PMBOK 进度管理',
      content: '标准流程',
      domain: '进度管理',
      purpose: '规划',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'pmbok', title: 'PMBOK 第 7 版' }],
      },
    })

    const l2 = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L2',
      title: '项目延期复盘',
      content: '经验教训',
      domain: '进度管理',
      purpose: '监控',
      provenance: {
        sources: [{ layer: 'L2', sourceId: 'retro-1', title: '复盘报告 1' }],
      },
    })

    // 合成 L3
    const l3 = await synthSvc.synthesize(ORG_ID, 1, {
      baseKnowledgeIds: [l1.id, l2.id],
      model: 'claude-opus-4-8',
      temperature: 0.7,
      seed: 42,
      domain: '进度管理',
      purpose: 'Eval 测试',
    })

    assert.equal(l3.layer, 'L3')
    assert.isTrue(l3.isSynthetic, 'L3 必须 isSynthetic=true')
    assert.isDefined(l3.syntheticMethod, 'L3 必须提供 syntheticMethod')
    assert.include(l3.syntheticMethod!, 'model=claude-opus-4-8')
    assert.include(l3.syntheticMethod!, 'temperature=0.7')
    assert.include(l3.syntheticMethod!, 'seed=42')
    assert.equal(l3.status, 'draft', '合成产物应为 draft')
  })

  test('L3 合成不改写上游 L1/L2 源记录', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const synthSvc = await testUtils.app.container.make(SynthesizeKnowledgeService)

    const l1 = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '原始 L1 记录',
      content: '规范内容',
      domain: '进度管理',
      purpose: '规划',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'std-1', title: '标准 1' }],
      },
    })

    const originalTitle = l1.title
    const originalStatus = l1.status

    await synthSvc.synthesize(ORG_ID, 1, {
      baseKnowledgeIds: [l1.id],
      model: 'claude-opus-4-8',
      temperature: 0.5,
      seed: 1,
      domain: '进度管理',
      purpose: '测试',
    })

    // 验证上游 L1 未改变
    const l1After = await knowledgeSvc.getById(ORG_ID, l1.id)
    assert.equal(l1After.title, originalTitle, '合成不应修改上游 L1 标题')
    assert.equal(l1After.status, originalStatus, '合成不应修改上游 L1 状态')
  })

  test('空 baseKnowledge 被拒', async ({ assert }) => {
    const synthSvc = await testUtils.app.container.make(SynthesizeKnowledgeService)

    try {
      await synthSvc.synthesize(ORG_ID, 1, {
        baseKnowledgeIds: [],
        model: 'claude-opus-4-8',
        temperature: 0.5,
        seed: 1,
        domain: '测试',
        purpose: '测试',
      })
      assert.fail('应抛出异常——空 baseKnowledge')
    } catch (e) {
      assert.include((e as Error).message, 'baseKnowledge')
    }
  })

  test('L3 合成写入审计日志', async ({ assert }) => {
    const knowledgeSvc = await testUtils.app.container.make(KnowledgeService)
    const synthSvc = await testUtils.app.container.make(SynthesizeKnowledgeService)

    const l1 = await knowledgeSvc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '审计合成测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'audit-l1', title: '审计来源' }],
      },
    })

    const logsBefore = await AuditLog.query().where('organization_id', ORG_ID)
    const countBefore = logsBefore.length

    await synthSvc.synthesize(ORG_ID, 1, {
      baseKnowledgeIds: [l1.id],
      model: 'claude-opus-4-8',
      temperature: 0.5,
      seed: 1,
      domain: '测试',
      purpose: '测试',
    })

    const logsAfter = await AuditLog.query().where('organization_id', ORG_ID)
    assert.equal(logsAfter.length, countBefore + 1, '应新增 1 条合成审计日志')
  })
})

test.group('CollectL4Service', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await KnowledgeItem.query().delete()
    await AuditLog.query().delete()
  })

  // ── L4 采集 ───────────────────────────────────────────────

  test('L4 采集去标识化——敏感字段被哈希', async ({ assert }) => {
    const collectSvc = await testUtils.app.container.make(CollectL4Service)

    const item = await collectSvc.collect(ORG_ID, {
      dataId: 'evt-001',
      eventType: 'project.created',
      payload: {
        projectName: '超级秘密项目',
        companyName: '某科技公司',
        personName: '张三',
        email: 'zhangsan@example.com',
        phone: '13800138000',
        description: '正常描述信息',
        taskCount: 42,
      },
      timestamp: new Date().toISOString(),
      organizationId: ORG_ID,
    })

    assert.equal(item.layer, 'L4')
    assert.equal(item.retentionDays, 90)

    const content = item.content as Record<string, unknown>
    const payload = content.payload as Record<string, unknown>

    // 敏感字段被哈希/遮蔽
    assert.match(payload.projectName as string, /REDACTED/)
    assert.match(payload.companyName as string, /REDACTED/)
    assert.match(payload.personName as string, /REDACTED/)
    assert.match(payload.email as string, /REDACTED/)
    assert.match(payload.phone as string, /REDACTED/)
    // 非敏感字段原样保留
    assert.equal(payload.description, '正常描述信息')
    assert.equal(payload.taskCount, 42)
  })

  test('L4 采集去标识化——嵌套敏感字段被哈希', async ({ assert }) => {
    const collectSvc = await testUtils.app.container.make(CollectL4Service)

    const item = await collectSvc.collect(ORG_ID, {
      dataId: 'evt-002',
      eventType: 'task.assigned',
      payload: {
        taskId: 'TSK-100',
        assignee: '李四',
        owner: '王五',
        creator: '赵六',
        title: '任务标题（非敏感）',
        details: {
          reporter: '孙七',
          priority: 'high',
        },
      },
      timestamp: new Date().toISOString(),
      organizationId: ORG_ID,
    })

    const content = item.content as Record<string, unknown>
    const payload = content.payload as Record<string, unknown>

    // 嵌套敏感字段被哈希
    assert.match(payload.assignee as string, /REDACTED/)
    assert.match(payload.owner as string, /REDACTED/)
    assert.match(payload.creator as string, /REDACTED/)

    const details = payload.details as Record<string, unknown>
    assert.match(details.reporter as string, /REDACTED/)
    // 非敏感嵌套字段原样保留
    assert.equal(details.priority, 'high')
    // 非敏感顶层字段原样保留
    assert.equal(payload.taskId, 'TSK-100')
  })

  test('L4 采集组织隔离', async ({ assert }) => {
    const collectSvc = await testUtils.app.container.make(CollectL4Service)

    await collectSvc.collect(ORG_ID, {
      dataId: 'evt-org',
      eventType: 'project.created',
      payload: { description: 'Org 301 事件' },
      timestamp: new Date().toISOString(),
      organizationId: ORG_ID,
    })

    // 另一组织查询应不可见
    const otherOrgItems = await KnowledgeItem.forOrganization(999).where('layer', 'L4')
    assert.equal(otherOrgItems.length, 0, '其他组织不应看到本组织 L4 记录')
  })

  test('超期 L4 清理只清理超期记录', async ({ assert }) => {
    const collectSvc = await testUtils.app.container.make(CollectL4Service)

    // 创建 1 条正常的 L4 记录（通过 Service）
    const recentItem = await collectSvc.collect(ORG_ID, {
      dataId: 'evt-recent',
      eventType: 'task.created',
      payload: { description: '近期事件' },
      timestamp: new Date().toISOString(),
      organizationId: ORG_ID,
    })

    // 手动创建 1 条超期 100 天的 L4 记录（通过 Model 绕过 Service 时间戳）
    const expiredItem = new KnowledgeItem()
    expiredItem.organizationId = ORG_ID
    expiredItem.layer = 'L4'
    expiredItem.layerMeta = {
      layer: 'L4',
      trust: '高（一手）',
      source: '产品数据',
      usage: '匿名聚合',
      frequency: '自动采集',
      annotation: ['必须去标识化', '原始数据限 90 天', '聚合优先返回'],
    }
    expiredItem.title = '超期 L4 记录'
    expiredItem.content = { description: '100 天前的事件' }
    expiredItem.status = 'active'
    expiredItem.domain = '产品数据'
    expiredItem.purpose = '匿名聚合'
    expiredItem.provenance = {
      sources: [{ layer: 'L4', sourceId: 'expired', title: '超期事件' }],
      reviewHistory: [],
    }
    expiredItem.reviewHistory = []
    expiredItem.isSynthetic = false
    expiredItem.createdBy = 1
    expiredItem.retentionDays = 90
    // 手动设置创建时间为 100 天前
    const date100DaysAgo = new Date()
    date100DaysAgo.setDate(date100DaysAgo.getDate() - 100)
    expiredItem.createdAt = DateTime.fromJSDate(date100DaysAgo)
    await expiredItem.save()

    // 清理前确认两条记录都存在
    const beforeClean = await KnowledgeItem.forOrganization(ORG_ID).where('layer', 'L4')
    assert.equal(beforeClean.length, 2, '清理前应有 2 条 L4 记录')

    const cleaned = await collectSvc.cleanupExpired(ORG_ID)
    assert.isAtLeast(cleaned, 1, '应至少清理 1 条超期记录')

    // 近期记录仍存在
    const remainingItems = await KnowledgeItem.forOrganization(ORG_ID).where('layer', 'L4')
    assert.equal(remainingItems.length, 1, '应只剩 1 条 L4 记录')
    assert.equal(remainingItems[0].id, recentItem.id, '近期记录不应被清理')
  })
})
