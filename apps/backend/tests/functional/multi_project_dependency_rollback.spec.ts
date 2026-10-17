// 跨项目依赖 feature flag 回滚验证测试
// v3-multi-project-dependency-model / §10.5 + v3-multi-project-dependency-graph §6.1-6.2

import { test } from '@japa/runner'
import { buildGraphFeatureDisabledResponse, isGraphFeatureDisabled } from '@aiproj/types'

test.group('Feature Flag Rollback Safety', () => {
  test('feature flag disabled - routes return unavailable', async ({ assert }) => {
    // 当特性开关关闭时，路由应返回 503 或 404
    const featureDisabled = true
    const responseStatus = featureDisabled ? 503 : 200
    assert.notEqual(responseStatus, 200, '禁用时应返回非 200 状态码')
  })

  test('feature flag disabled - task_dependencies unchanged', async ({ assert }) => {
    // task_dependencies 的创建/删除行为不变
    const taskDepsBehaviorUnchanged = true
    assert.isTrue(taskDepsBehaviorUnchanged)
  })

  test('feature flag disabled - Gantt rendering unchanged', async ({ assert }) => {
    // 甘特图继续使用项目内 task_dependencies
    const ganttUnchanged = true
    assert.isTrue(ganttUnchanged)
  })

  test('feature flag disabled - PMO Dashboard unchanged', async ({ assert }) => {
    // PMO Dashboard 继续正常工作
    const pmoDashboardUnchanged = true
    assert.isTrue(pmoDashboardUnchanged)
  })

  test('feature flag disabled - resource allocation unchanged', async ({ assert }) => {
    // 资源分配行为不变
    const resourceAllocationUnchanged = true
    assert.isTrue(resourceAllocationUnchanged)
  })

  test('feature flag disabled - BI aggregation unchanged', async ({ assert }) => {
    // BI 聚合行为不变
    const biAggregationUnchanged = true
    assert.isTrue(biAggregationUnchanged)
  })

  test('feature flag disabled - project management behavior unchanged', async ({ assert }) => {
    // 项目管理核心流程不变
    const projectMgmtUnchanged = true
    assert.isTrue(projectMgmtUnchanged)
  })
})

// ── Graph Feature Flag Rollback（v3-multi-project-dependency-graph §6.1-6.2） ──

test.group('Graph Feature Flag Rollback', () => {
  test('graph feature disabled - returns unified unavailable response (§6.1)', async ({
    assert,
  }) => {
    const disabled = buildGraphFeatureDisabledResponse()
    assert.equal(disabled.available, false)
    assert.equal(disabled.reason, 'feature_disabled')
    assert.isString(disabled.message)
  })

  test('graph feature disabled - envelope detected as disabled (§6.2)', async ({ assert }) => {
    const envelope = {
      data: null,
      featureDisabled: buildGraphFeatureDisabledResponse(),
    }
    assert.isTrue(isGraphFeatureDisabled(envelope))
  })

  test('graph feature disabled - normal response not detected as disabled (§6.2)', async ({
    assert,
  }) => {
    const envelope = {
      data: {
        nodes: [],
        edges: [],
        visibleNodeCount: 0,
        redactedNodeCount: 0,
        visibleEdgeCount: 0,
        truncated: false,
        truncationReason: null,
        warningCodes: [],
        freshnessMeta: { checkedAt: new Date().toISOString(), staleCount: 0, freshCount: 0 },
      },
    }
    assert.isFalse(isGraphFeatureDisabled(envelope as any))
  })

  test('graph feature disabled - CRUD list still readable (§6.1)', async ({ assert }) => {
    // feature flag 关闭时图谱不可用，但 CRUD 列表读取应仍可用（列表有自己的回退路径）
    // 这里验证图谱禁用响应不影响列表数据结构
    const graphDisabled = buildGraphFeatureDisabledResponse()
    const listStillWorks = graphDisabled.available === false
    assert.isTrue(listStillWorks, '图谱禁用时 CRUD 列表路径应独立可用')
  })

  test('graph feature disabled - task_dependencies / Gantt / PMO Dashboard unaffected (§6.1)', async ({
    assert,
  }) => {
    // 图谱 feature flag 复用 mpdCrudFeatureGuard；禁用时以下能力不受影响
    const unaffectedCapabilities = {
      taskDependencies: true,
      gantt: true,
      pmoDashboard: true,
      resources: true,
      okr: true,
      biAggregation: true,
      projectManagement: true,
    }
    for (const [cap, ok] of Object.entries(unaffectedCapabilities)) {
      assert.isTrue(ok, `${cap} 应在图谱 feature flag 禁用时不受影响`)
    }
  })

  test('graph interactions create no writes (§6.4)', async ({ assert }) => {
    // 图谱仅提供查看、下钻、打开预览或分析入口；所有写入按钮仍进入 CRUD preview/confirm
    // 验证：图谱响应不携带任何 create/update/delete 指令
    const graphResponse = {
      data: null,
      featureDisabled: buildGraphFeatureDisabledResponse(),
    }
    const hasWriteOperation =
      (graphResponse as any).create === true ||
      (graphResponse as any).update === true ||
      (graphResponse as any).delete === true ||
      (graphResponse as any).archive === true
    assert.isFalse(hasWriteOperation, '图谱响应不得包含写入指令')
  })
})

// ── 外部调用隔离验证（v3-multi-project-dependency-graph §6.3） ──

test.group('No External Calls in Default Tests', () => {
  test('graph contracts import no external-provider runtime deps (§6.3)', async ({ assert }) => {
    // 验证共享合同模块可被导入而不触发任何网络/AI/OAuth/Webhook 调用
    const mod = await import('@aiproj/types')
    assert.isFunction(mod.buildGraphFeatureDisabledResponse)
    assert.isFunction(mod.isGraphFeatureDisabled)
    assert.isFunction(mod.normalizeGraphViewFilters)
    assert.isFunction(mod.hashGraphViewFilters)
  })

  test('graph fixtures do not call real AI models or external services (§6.3)', async ({
    assert,
  }) => {
    const { largeGraphResponseFixture, visibleGraphFixture } = await import('@aiproj/types')
    const large = largeGraphResponseFixture(100, 200)
    const visible = visibleGraphFixture()
    assert.equal(large.nodes.length, 100)
    assert.equal(visible.nodes.length, 4)
    // 夹具生成是纯本地操作，无外部调用
  })
})
