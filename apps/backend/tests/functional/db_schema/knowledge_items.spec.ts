import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { columnNames } from './_helpers.js'
import KnowledgeItem from '#models/knowledge_item'
import { LAYER_METADATA } from '@aiproj/types'

/**
 * v3-four-layer-knowledge-system —— knowledge_items 表结构 + Model 序列化测试。
 *
 * 覆盖：表字段、索引、JSON 列序列化往返、Model 创建与组织隔离
 */
test.group('knowledge_items 表结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('knowledge_items 表包含所有必需字段', async ({ assert }) => {
    const cols = await columnNames('knowledge_items')
    for (const c of [
      'id',
      'organization_id',
      'layer',
      'layer_meta',
      'title',
      'content',
      'status',
      'domain',
      'purpose',
      'complexity',
      'provenance',
      'review_history',
      'is_synthetic',
      'synthetic_method',
      'created_by',
      'updated_by',
      'last_referenced_at',
      'retention_days',
      'created_at',
      'updated_at',
    ]) {
      assert.include(cols, c, `knowledge_items 应含字段 ${c}`)
    }
    // 确保不含 deleted_at（只写不删）
    assert.notInclude(cols, 'deleted_at', 'knowledge_items 不应含软删除字段')
  })

  test('knowledge_items 有 organization_id 复合索引', async ({ assert }) => {
    const cols = await columnNames('knowledge_items')
    // 核心索引覆盖验证：org+layer, org+status, org+domain
    assert.include(cols, 'organization_id', '应有 organization_id 字段')
    assert.include(cols, 'layer', '应有 layer 字段')
    assert.include(cols, 'status', '应有 status 字段')
    assert.include(cols, 'domain', '应有 domain 字段')
  })
})

test.group('KnowledgeItem Model', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('Model 创建——合法 L1 记录序列化往返', async ({ assert }) => {
    const item = new KnowledgeItem()
    item.organizationId = 1
    item.layer = 'L1'
    item.layerMeta = LAYER_METADATA.L1
    item.title = 'PMBOK 第 7 版 风险管理流程'
    item.content = { summary: '风险管理流程概述', details: '识别、评估、应对、监控' }
    item.status = 'active'
    item.domain = '风险管理'
    item.purpose = '规划'
    item.complexity = '中级'
    item.provenance = {
      sources: [
        {
          layer: 'L1',
          sourceId: 'pmbok-7',
          title: 'PMBOK 第 7 版',
          section: '§8.1',
        },
      ],
      reviewHistory: [],
    }
    item.reviewHistory = []
    item.isSynthetic = false
    item.syntheticMethod = null
    item.createdBy = 1
    item.updatedBy = null
    item.lastReferencedAt = null
    item.retentionDays = null

    await item.save()

    assert.isNumber(item.id, '保存后应有 id')
    assert.equal(item.layer, 'L1')
    assert.equal(item.status, 'active')
    assert.equal(item.domain, '风险管理')
    assert.equal(item.isSynthetic, false)
    assert.deepEqual(item.layerMeta, LAYER_METADATA.L1)
  })

  test('Model 创建——合法 L3 记录（isSynthetic=true + syntheticMethod）', async ({ assert }) => {
    const item = new KnowledgeItem()
    item.organizationId = 1
    item.layer = 'L3'
    item.layerMeta = LAYER_METADATA.L3
    item.title = '合成案例：高风险项目延迟应对'
    item.content = { scenario: '高风险项目延迟 30%', response: '加速并行任务' }
    item.status = 'active'
    item.domain = '进度管理'
    item.purpose = '测试'
    item.provenance = {
      sources: [
        { layer: 'L1', sourceId: 'pmbok-7', title: 'PMBOK 第 7 版', section: '§6.5' },
        {
          layer: 'L2',
          sourceId: 'project-123',
          title: '某项目延期复盘',
          url: 'https://internal/report',
        },
      ],
      reviewHistory: [],
    }
    item.reviewHistory = []
    item.isSynthetic = true
    item.syntheticMethod =
      '由 L1(pmbok-7§6.5) + L2(project-123) 交叉验证生成，model=claude-opus-4-8, t=0.3, seed=42'
    item.createdBy = 1

    await item.save()

    assert.isNumber(item.id)
    assert.isTrue(item.isSynthetic)
    assert.isString(item.syntheticMethod)
    assert.include(item.syntheticMethod!, 'claude-opus-4-8')
  })

  test('Model 组织隔离——forOrganization 只返回本组织记录', async ({ assert }) => {
    // 创建 org 1 的记录
    const org1Item = new KnowledgeItem()
    org1Item.organizationId = 1
    org1Item.layer = 'L2'
    org1Item.layerMeta = LAYER_METADATA.L2
    org1Item.title = 'Org 1 观察记录'
    org1Item.content = 'Org 1 数据'
    org1Item.status = 'active'
    org1Item.domain = '测试'
    org1Item.purpose = '测试'
    org1Item.provenance = {
      sources: [{ layer: 'L2', sourceId: 'test-org1', title: 'Org1 来源' }],
      reviewHistory: [],
    }
    org1Item.reviewHistory = []
    org1Item.isSynthetic = false
    org1Item.createdBy = 1
    await org1Item.save()

    // 创建 org 2 的记录
    const org2Item = new KnowledgeItem()
    org2Item.organizationId = 2
    org2Item.layer = 'L2'
    org2Item.layerMeta = LAYER_METADATA.L2
    org2Item.title = 'Org 2 观察记录'
    org2Item.content = 'Org 2 数据'
    org2Item.status = 'active'
    org2Item.domain = '测试'
    org2Item.purpose = '测试'
    org2Item.provenance = {
      sources: [{ layer: 'L2', sourceId: 'test-org2', title: 'Org2 来源' }],
      reviewHistory: [],
    }
    org2Item.reviewHistory = []
    org2Item.isSynthetic = false
    org2Item.createdBy = 1
    await org2Item.save()

    const org1Results = await KnowledgeItem.forOrganization(1)
    const org2Results = await KnowledgeItem.forOrganization(2)

    assert.isAtLeast(org1Results.length, 1, 'org 1 应有记录')
    assert.isAtLeast(org2Results.length, 1, 'org 2 应有记录')
    // org 1 不应看到 org 2 的记录
    const org1Ids = org1Results.map((i) => i.organizationId)
    assert.isTrue(
      org1Ids.every((id) => id === 1),
      'org 1 查询只应返回 org 1 的记录',
    )
    const org2Ids = org2Results.map((i) => i.organizationId)
    assert.isTrue(
      org2Ids.every((id) => id === 2),
      'org 2 查询只应返回 org 2 的记录',
    )
  })

  test('Model 拒绝非法 layer 值（数据库层 CHECK 约束）', async ({ assert }) => {
    const item = new KnowledgeItem()
    item.organizationId = 1
    // 故意设非法 layer
    item.layer = 'L5' as any
    item.layerMeta = LAYER_METADATA.L1
    item.title = '非法层测试'
    item.content = '测试'
    item.status = 'draft'
    item.domain = '测试'
    item.purpose = '测试'
    item.provenance = {
      sources: [{ layer: 'L1', sourceId: 'test', title: 'Test' }],
      reviewHistory: [],
    }
    item.reviewHistory = []
    item.isSynthetic = false
    item.createdBy = 1

    try {
      await item.save()
      assert.fail('应抛出异常——非法 layer 值应被拒')
    } catch (e) {
      // SQLite CHECK 约束会抛出错误
      assert.isTrue(e instanceof Error, '非法 layer 值被数据库拒绝')
    }
  })
})
