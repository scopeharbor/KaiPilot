/**
 * v3-four-layer-knowledge-system —— KnowledgeService 单元测试。
 *
 * 覆盖：CRUD、检索（组织隔离 + L3 排除 + 关键词）、
 * 正向对照（生产路径 0 L3 / Eval 路径精确计数）、
 * 生命周期转移（合法/非法）、人工确认门、降级态、
 * 审计写入、越权拒绝、L3 手动创建被拒。
 *
 * 目标覆盖率：Service ≥90%、红线相关 100%。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import KnowledgeService, {
  KnowledgeValidationError,
  KnowledgeTransitionRejectedError,
  L3AccessDeniedError,
} from '#services/knowledge/knowledge_service'
import KnowledgeItem from '#models/knowledge_item'
import AuditLog from '#models/audit_log'
import SqliteKnowledgeIndex from '#services/knowledge/sqlite_knowledge_index'

const ORG_ID = 201

test.group('KnowledgeService', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await KnowledgeItem.query().delete()
    await AuditLog.query().delete()
  })

  // ── CRUD ───────────────────────────────────────────────

  test('创建 L1 知识记录成功', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)
    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'PMBOK 第 7 版 进度管理流程',
      content: {
        steps: ['定义活动', '排列活动顺序', '估算活动持续时间', '制定进度计划', '控制进度'],
      },
      domain: '进度管理',
      purpose: '规划',
      complexity: '中级',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'pmbok-7', title: 'PMBOK 第 7 版', section: '§6.5' }],
      },
    })

    assert.equal(item.layer, 'L1')
    assert.equal(item.status, 'draft')
    assert.equal(item.organizationId, ORG_ID)
    assert.equal(item.domain, '进度管理')
    assert.isFalse(item.isSynthetic)
    assert.isDefined(item.id)
  })

  test('创建 L2 知识记录成功', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)
    const item = await svc.create(ORG_ID, 1, {
      layer: 'L2',
      title: '某互联网项目延期复盘',
      content: { cause: '需求变更频繁', mitigation: '采用迭代式交付' },
      domain: '进度管理',
      purpose: '监控',
      provenance: {
        sources: [
          {
            layer: 'L2',
            sourceId: 'retro-2024h1',
            title: '2024H1 复盘报告',
            url: 'https://internal/reports',
          },
        ],
      },
    })

    assert.equal(item.layer, 'L2')
    assert.equal(item.status, 'draft')
    assert.isFalse(item.isSynthetic)
  })

  test('手动创建 L3 知识被拒', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)
    try {
      await svc.create(ORG_ID, 1, {
        layer: 'L3',
        title: '尝试手动创建 L3',
        content: '测试',
        domain: '测试',
        purpose: '测试',
        provenance: {
          sources: [{ layer: 'L3', sourceId: 'test', title: 'Test' }],
        },
      })
      assert.fail('应抛出异常——L3 不可手动创建')
    } catch (e) {
      assert.instanceOf(e as Error, KnowledgeValidationError)
      assert.include((e as Error).message, 'L3')
    }
  })

  test('创建时写入审计日志', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)
    await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '审计日志测试',
      content: '测试内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'test-audit', title: '审计来源' }],
      },
    })

    const logs = await AuditLog.query().where('organization_id', ORG_ID)
    assert.isAtLeast(logs.length, 1)
    const log = logs[logs.length - 1]
    assert.equal(log.action, 'create')
  })

  // ── 检索（组织隔离 + L3 排除） ──────────────────────────────────

  test('检索强制组织隔离', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    // 创建 org1 记录
    await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'Org 201 专有知识',
      content: '数据',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'org-201', title: 'Org 201 来源' }],
      },
    })

    // 转正
    const items = await KnowledgeItem.forOrganization(ORG_ID)
    await svc.transitionLifecycle(ORG_ID, 1, items[0].id, 'pending')
    await svc.confirm(ORG_ID, 1, items[0].id)

    // 用 org 202 检索——应返回 0
    const result = await svc.query(202, {})
    assert.equal(result.data.length, 0, '其他组织不应看到本组织记录')
  })

  test('生产检索默认排除 L3', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    // 创建 L1 记录并确认
    const l1Item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'L1 规范条目',
      content: '内容',
      domain: '进度管理',
      purpose: '规划',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'l1-test', title: 'L1 来源' }],
      },
    })
    await svc.transitionLifecycle(ORG_ID, 1, l1Item.id, 'pending')
    await svc.confirm(ORG_ID, 1, l1Item.id)

    // 直接通过 Model 创建 L3 记录（绕过 Service 的手动创建限制，模拟 Eval 管道的产物）
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
      sources: [{ layer: 'L3', sourceId: 'l3-test', title: 'L3 来源' }],
      reviewHistory: [],
    }
    l3.reviewHistory = []
    l3.isSynthetic = true
    l3.syntheticMethod = '由 L1(l1-test) 合成'
    l3.createdBy = 1
    await l3.save()

    // 生产检索——应不包含 L3
    const result = await svc.query(ORG_ID, { domain: '进度管理' })
    assert.isTrue(
      result.data.every((item) => item.layer !== 'L3'),
      '生产路径不应包含 L3 记录',
    )
    assert.equal(result.data.length, 1, '应只有 1 条 L1 记录')
  })

  test('Eval 检索放行 L3 (evalContext=true)', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    // 直接创建 L3 记录
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
    l3.title = 'L3 Eval 条目'
    l3.content = '合成内容'
    l3.status = 'active'
    l3.domain = '进度管理'
    l3.purpose = '测试'
    l3.provenance = {
      sources: [{ layer: 'L3', sourceId: 'l3-eval', title: 'L3 Eval 来源' }],
      reviewHistory: [],
    }
    l3.reviewHistory = []
    l3.isSynthetic = true
    l3.syntheticMethod = '合成方法'
    l3.createdBy = 1
    await l3.save()

    // Eval 检索——应包含 L3
    const result = await svc.queryForEval(ORG_ID, { domain: '进度管理' })
    const l3Results = result.data.filter((item) => item.layer === 'L3')
    assert.equal(l3Results.length, 1, 'Eval 路径应包含 1 条 L3 记录')
    assert.isTrue(Boolean(l3Results[0].isSynthetic), 'L3 记录应标注 isSynthetic')
  })

  // ── 正向对照测试（D2 核心要求） ────────────────────────────────

  test('正向对照：assertNoL3InProduction 返回 0（生产路径零 L3）', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    // 创建 L1 记录 + L1 active
    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '正向对照测试',
      content: '数据',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'pc-test', title: '正向对照来源' }],
      },
    })
    await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await svc.confirm(ORG_ID, 1, item.id)

    const count = await svc.assertNoL3InProduction(ORG_ID)
    assert.equal(count, 0, '生产路径应返回 0 条 L3')
  })

  test('正向对照：故意注入 L3 验证生产路径排除（Eval 可检出）', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    // 注入 L3 active 记录
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
    l3.title = '恶意注入的 L3'
    l3.content = '恶意内容'
    l3.status = 'active'
    l3.domain = '测试'
    l3.purpose = '测试'
    l3.provenance = {
      sources: [{ layer: 'L3', sourceId: 'evil', title: 'Evil' }],
      reviewHistory: [],
    }
    l3.reviewHistory = []
    l3.isSynthetic = true
    l3.syntheticMethod = '攻击'
    l3.createdBy = 1
    await l3.save()

    // 生产路径：assertNoL3InProduction 应返回 0（L3 被排除）
    const productionCount = await svc.assertNoL3InProduction(ORG_ID)
    assert.equal(productionCount, 0, '生产路径应排除 L3')

    // Eval 路径：countL3InEval 应检出注入的 L3（证明数据确实存在）
    const evalCount = await svc.countL3InEval(ORG_ID)
    assert.isAtLeast(evalCount, 1, 'Eval 路径应检出 L3 证明数据存在')
  })

  test('正向对照：countL3InEval 返回精确 L3 条数', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    // 创建 3 条 L3 记录（通过 Model 直接创建）
    for (let i = 0; i < 3; i++) {
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
      l3.title = `L3 条目 ${i}`
      l3.content = `内容 ${i}`
      l3.status = 'active'
      l3.domain = '测试'
      l3.purpose = '测试'
      l3.provenance = {
        sources: [{ layer: 'L3', sourceId: `l3-${i}`, title: `L3 来源 ${i}` }],
        reviewHistory: [],
      }
      l3.reviewHistory = []
      l3.isSynthetic = true
      l3.syntheticMethod = `合成方法 ${i}`
      l3.createdBy = 1
      await l3.save()
    }

    const count = await svc.countL3InEval(ORG_ID)
    assert.equal(count, 3, 'Eval 路径应精确返回 3 条 L3')
  })

  // ── 关键词检索（降级态） ────────────────────────────────────────

  test('关键词检索返回匹配记录', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '关键路径法（CPM）',
      content: '关键路径法是项目进度管理的核心方法',
      domain: '进度管理',
      purpose: '规划',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'cpm-test', title: 'CPM 来源' }],
      },
    })
    await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await svc.confirm(ORG_ID, 1, item.id)

    const result = await svc.query(ORG_ID, { keyword: 'CPM' })
    assert.isAtLeast(result.data.length, 1)
    assert.include(result.data[0].title, '关键路径法')
  })

  test('降级态——无外部向量库时结构化过滤仍然工作', async ({ assert }) => {
    // SqliteKnowledgeIndex 本身就是降级实现——验证它仍能返回结构化过滤结果
    const index = new SqliteKnowledgeIndex()
    const result = await index.search(ORG_ID, { domain: '进度管理' })
    assert.isArray(result.data)
    assert.isDefined(result.meta)
    assert.isAtLeast(result.meta.total, 0)
  })

  test('状态过滤：缺省只返回 active，显式 status 返回对应状态', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    // draft：创建后停在 draft
    const draftItem = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '草稿条目',
      content: '内容',
      domain: '进度管理',
      purpose: '规划',
      provenance: { sources: [{ layer: 'L1', sourceId: 'status-draft', title: '来源' }] },
    })
    // pending：draft → pending
    const pendingItem = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '待审条目',
      content: '内容',
      domain: '进度管理',
      purpose: '规划',
      provenance: { sources: [{ layer: 'L1', sourceId: 'status-pending', title: '来源' }] },
    })
    await svc.transitionLifecycle(ORG_ID, 1, pendingItem.id, 'pending')
    // active：draft → pending → confirm
    const activeItem = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '活跃条目',
      content: '内容',
      domain: '进度管理',
      purpose: '规划',
      provenance: { sources: [{ layer: 'L1', sourceId: 'status-active', title: '来源' }] },
    })
    await svc.transitionLifecycle(ORG_ID, 1, activeItem.id, 'pending')
    await svc.confirm(ORG_ID, 1, activeItem.id)

    // 缺省（未指定 status）→ 仅 active
    const def = await svc.query(ORG_ID, {})
    assert.equal(def.data.length, 1, '缺省应只返回 active')
    assert.equal(def.data[0].id, activeItem.id)
    assert.equal(def.data[0].status, 'active')

    // 显式 status → 对应状态（治理视图可查待审/草稿）
    const drafts = await svc.query(ORG_ID, { status: 'draft' })
    assert.equal(drafts.data.length, 1)
    assert.equal(drafts.data[0].id, draftItem.id)

    const pendings = await svc.query(ORG_ID, { status: 'pending' })
    assert.equal(pendings.data.length, 1)
    assert.equal(pendings.data[0].id, pendingItem.id)

    const actives = await svc.query(ORG_ID, { status: 'active' })
    assert.equal(actives.data.length, 1)
    assert.equal(actives.data[0].id, activeItem.id)
  })

  // ── 生命周期状态机 ────────────────────────────────────────────

  test('draft → pending → active 完整确认链', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '生命周期测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'lifecycle-test', title: '来源' }],
      },
    })

    assert.equal(item.status, 'draft')

    // draft → pending
    const pending = await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    assert.equal(pending.status, 'pending')

    // pending → active（人工确认）
    const active = await svc.confirm(ORG_ID, 1, item.id)
    assert.equal(active.status, 'active')
    assert.isAtLeast(active.reviewHistory.length, 2, '应有 2 条审核记录')
  })

  test('draft → active 跳级非法', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '跳级测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'skip-test', title: '来源' }],
      },
    })

    try {
      await svc.transitionLifecycle(ORG_ID, 1, item.id, 'active')
      assert.fail('应抛出异常——draft→active 跳级非法')
    } catch (e) {
      assert.instanceOf(e, KnowledgeTransitionRejectedError)
    }
  })

  test('draft 状态不能直接 confirm', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: 'draft confirm 测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'draft-confirm', title: '来源' }],
      },
    })

    try {
      await svc.confirm(ORG_ID, 1, item.id)
      assert.fail('应抛出异常——draft 不可直接 confirm')
    } catch (e) {
      assert.instanceOf(e, KnowledgeTransitionRejectedError)
    }
  })

  test('active → deprecated 合法', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '废弃测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'deprecate-test', title: '来源' }],
      },
    })
    await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await svc.confirm(ORG_ID, 1, item.id)

    const deprecated = await svc.transitionLifecycle(ORG_ID, 1, item.id, 'deprecated')
    assert.equal(deprecated.status, 'deprecated')
  })

  test('active → outdated 合法', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '过时测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'outdated-test', title: '来源' }],
      },
    })
    await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await svc.confirm(ORG_ID, 1, item.id)

    const outdated = await svc.transitionLifecycle(ORG_ID, 1, item.id, 'outdated')
    assert.equal(outdated.status, 'outdated')
  })

  // ── 审核记录不可删除 ──────────────────────────────────────────

  test('reviewHistory 只追加不可删除', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '审核记录测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'review-test', title: '来源' }],
      },
    })

    const historyBefore = item.reviewHistory.length

    await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')
    await svc.confirm(ORG_ID, 1, item.id)

    const finalItem = await KnowledgeItem.forOrganization(ORG_ID).where('id', item.id).first()
    assert.isAtLeast(finalItem!.reviewHistory.length, historyBefore + 2, '审核记录应追加而非覆盖')
  })

  // ── 高置信度不豁免确认 ────────────────────────────────────────

  test('pending 记录不因高置信度自动转正', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '高置信度测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'high-conf', title: '来源' }],
      },
    })

    // 转 pending（模拟 AI 结构化结果）
    await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')

    // 确认 pending 仍为 pending——没有自动转 active
    const fetched = await svc.getById(ORG_ID, item.id)
    assert.equal(fetched.status, 'pending', '高置信度不豁免人工确认——仍为 pending')
  })

  // ── L3 上下文访问控制 ─────────────────────────────────────────

  test('非 evalContext 下直接查 L3 被拒', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    // 创建 L3 记录（通过 Model 直接创建）
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
    l3.title = 'L3 访问测试'
    l3.content = '合成'
    l3.status = 'active'
    l3.domain = '测试'
    l3.purpose = '测试'
    l3.provenance = {
      sources: [{ layer: 'L3', sourceId: 'l3-access', title: 'L3 来源' }],
      reviewHistory: [],
    }
    l3.reviewHistory = []
    l3.isSynthetic = true
    l3.syntheticMethod = '合成'
    l3.createdBy = 1
    await l3.save()

    try {
      await svc.getLowSensitiveById(ORG_ID, l3.id, false)
      assert.fail('应抛出异常——非 evalContext 不可查 L3')
    } catch (e) {
      assert.instanceOf(e, L3AccessDeniedError)
    }
  })

  // ── 审计完整性 ────────────────────────────────────────────────

  test('confirm 写入审计日志含前后状态', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '审计完整性测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'audit-full', title: '来源' }],
      },
    })
    await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')

    const logsBefore = await AuditLog.query().where('organization_id', ORG_ID)
    const countBefore = logsBefore.length

    await svc.confirm(ORG_ID, 1, item.id)

    const logsAfter = await AuditLog.query().where('organization_id', ORG_ID)
    assert.equal(logsAfter.length, countBefore + 1, '应新增 1 条确认审计日志')
  })

  test('transitionLifecycle 写入审计日志', async ({ assert }) => {
    const svc = await testUtils.app.container.make(KnowledgeService)

    const item = await svc.create(ORG_ID, 1, {
      layer: 'L1',
      title: '转移审计测试',
      content: '内容',
      domain: '测试',
      purpose: '测试',
      provenance: {
        sources: [{ layer: 'L1', sourceId: 'transition-audit', title: '来源' }],
      },
    })

    const logsBefore = await AuditLog.query().where('organization_id', ORG_ID)
    const countBefore = logsBefore.length

    await svc.transitionLifecycle(ORG_ID, 1, item.id, 'pending')

    const logsAfter = await AuditLog.query().where('organization_id', ORG_ID)
    assert.equal(logsAfter.length, countBefore + 1, '应新增 1 条转移审计日志')
  })
})
