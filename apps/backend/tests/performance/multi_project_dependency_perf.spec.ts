// 跨项目依赖性能探针测试
// v3-multi-project-dependency-model / §10.2 + v3-multi-project-dependency-graph §3.11

import { test } from '@japa/runner'
import { largeGraphFixture, largeGraphResponseFixture } from '@aiproj/types'
import type { MultiProjectGraphResponse } from '@aiproj/types'

test.group('MultiProjectDependency Performance', () => {
  // 大图夹具：1000 项目，2000 依赖边
  const deps = largeGraphFixture(1000, 2000)

  test('graph query - 2000 edges completes under threshold', async ({ assert }) => {
    const start = performance.now()
    // 模拟图谱构建：遍历所有边构建节点集
    const nodeMap = new Map<string, number>()
    for (const dep of deps) {
      const pKey = `task:p${dep.providerEndpoint.projectId}:t${dep.providerEndpoint.taskId}`
      const cKey = `task:p${dep.consumerEndpoint.projectId}:t${dep.consumerEndpoint.taskId}`
      nodeMap.set(pKey, (nodeMap.get(pKey) ?? 0) + 1)
      nodeMap.set(cKey, (nodeMap.get(cKey) ?? 0) + 1)
    }
    const elapsed = performance.now() - start

    // 2000 条边 + 节点构建应在 2000ms 内完成
    assert.isBelow(elapsed, 2000, `graph build took ${elapsed.toFixed(1)}ms`)
    assert.equal(deps.length, 2000)
    assert.isAbove(nodeMap.size, 0)
  })

  test('duplicate detection - 2000 edges completes under threshold', async ({ assert }) => {
    const { buildDependencyKey } = await import('@aiproj/types')

    const start = performance.now()
    const keys = new Set<string>()
    for (const dep of deps) {
      const key = buildDependencyKey(
        dep.providerEndpoint,
        dep.consumerEndpoint,
        dep.type,
        dep.category,
      )
      keys.add(key)
    }
    const elapsed = performance.now() - start

    // 2000 条边的重复检测应在 500ms 内完成
    assert.isBelow(elapsed, 500, `duplicate detection took ${elapsed.toFixed(1)}ms`)
    assert.equal(keys.size, 2000, '2000 unique edges should all be distinct')
  })

  test('cycle detection - 2000 edges completes under threshold', async ({ assert }) => {
    // 构建有向图
    const graph = new Map<string, Set<string>>()
    const visited = new Set<string>()
    const stack = new Set<string>()

    for (const dep of deps) {
      const pKey = `task:p${dep.providerEndpoint.projectId}:t${dep.providerEndpoint.taskId}`
      const cKey = `task:p${dep.consumerEndpoint.projectId}:t${dep.consumerEndpoint.taskId}`
      if (!graph.has(pKey)) graph.set(pKey, new Set())
      graph.get(pKey)!.add(cKey)
    }

    function hasCycle(node: string): boolean {
      if (stack.has(node)) return true
      if (visited.has(node)) return false
      visited.add(node)
      stack.add(node)
      for (const neighbor of graph.get(node) ?? []) {
        if (hasCycle(neighbor)) return true
      }
      stack.delete(node)
      return false
    }

    const start = performance.now()
    let hasCycleFound = false
    for (const node of graph.keys()) {
      if (hasCycle(node)) {
        hasCycleFound = true
        break
      }
    }
    const elapsed = performance.now() - start

    // 2000 条边的循环检测应在 1000ms 内完成
    assert.isBelow(elapsed, 1000, `cycle detection took ${elapsed.toFixed(1)}ms`)
    // 大图夹具生成的是链式边，不应有循环
    assert.isFalse(hasCycleFound)
  })

  test('impact analysis - BFS on 2000 edges under threshold', async ({ assert }) => {
    // 构建邻接表
    const adj = new Map<string, { key: string; dep: any }[]>()
    for (const dep of deps) {
      const pKey = `task:p${dep.providerEndpoint.projectId}:t${dep.providerEndpoint.taskId}`
      const cKey = `task:p${dep.consumerEndpoint.projectId}:t${dep.consumerEndpoint.taskId}`
      if (!adj.has(pKey)) adj.set(pKey, [])
      adj.get(pKey)!.push({ key: cKey, dep })
    }

    // BFS from first provider
    const startKey = `task:p${deps[0].providerEndpoint.projectId}:t${deps[0].providerEndpoint.taskId}`

    const start = performance.now()
    const visited = new Set<string>()
    const queue = [startKey]
    let totalHops = 0
    while (queue.length > 0 && visited.size < 500) {
      const key = queue.shift()!
      if (visited.has(key)) continue
      visited.add(key)
      for (const { key: nextKey } of adj.get(key) ?? []) {
        if (!visited.has(nextKey)) {
          queue.push(nextKey)
          totalHops++
        }
      }
    }
    const elapsed = performance.now() - start

    // BFS 应在 1000ms 内完成
    assert.isBelow(elapsed, 1000, `BFS impact analysis took ${elapsed.toFixed(1)}ms`)
    assert.isAbove(totalHops, 0)
  })

  test('preview generation - hash computation under threshold', async ({ assert }) => {
    const { stableHash } = await import('@aiproj/types')

    const start = performance.now()
    const hashes: string[] = []
    for (let i = 0; i < 2000; i++) {
      hashes.push(stableHash(`preview-${i}-${Date.now()}`))
    }
    const elapsed = performance.now() - start

    // 2000 次哈希计算应在 100ms 内完成
    assert.isBelow(elapsed, 100, `2000 hashes took ${elapsed.toFixed(1)}ms`)
    assert.equal(hashes.length, 2000)
  })
})

// ── 图谱查询性能探针（v3-multi-project-dependency-graph §3.11） ──

test.group('MultiProjectDependency Graph Performance', () => {
  const graphFixture: MultiProjectGraphResponse = largeGraphResponseFixture(1000, 2000)

  test('graph query - 1000 nodes 2000 edges under threshold', async ({ assert }) => {
    const { deriveNodeVisualState, deriveEdgeVisualState, deriveBoundedGraphSummary } =
      await import('@aiproj/types')

    const start = performance.now()

    // 模拟图谱渲染管线：派生节点/边可视状态 + 摘要统计
    const nodeStates = graphFixture.nodes.map((n) => deriveNodeVisualState(n, null, null))
    const edgeStates = graphFixture.edges.map((e) => deriveEdgeVisualState(e, null, null))
    const summary = deriveBoundedGraphSummary(graphFixture)

    const elapsed = performance.now() - start

    // 1000 节点 + 2000 边的视觉派生和摘要统计应在 500ms 内完成
    assert.isBelow(elapsed, 500, `graph visual derivation took ${elapsed.toFixed(1)}ms`)
    assert.equal(nodeStates.length, 1000)
    assert.equal(edgeStates.length, 2000)
    assert.isTrue(summary.truncated, 'large fixture should be truncated')
    assert.equal(summary.visibleNodes, 1000)
    assert.equal(summary.visibleEdges, 2000)
  })

  test('graph truncation state recorded correctly', async ({ assert }) => {
    const { deriveGraphTruncationState } = await import('@aiproj/types')

    const state = deriveGraphTruncationState(graphFixture)

    assert.isTrue(state.truncated)
    assert.equal(state.visibleNodeCount, 1000)
    assert.equal(state.visibleEdgeCount, 2000)
    assert.isNotNull(state.reason)
  })

  test('graph freshness summary - 2000 edges under threshold', async ({ assert }) => {
    const { deriveGraphFreshnessSummary } = await import('@aiproj/types')

    const start = performance.now()
    const freshness = deriveGraphFreshnessSummary(graphFixture)
    const elapsed = performance.now() - start

    // 新鲜度派生应在 200ms 内完成
    assert.isBelow(elapsed, 200, `freshness derivation took ${elapsed.toFixed(1)}ms`)
    assert.isAbove(freshness.staleCount + freshness.freshCount, 0)
  })

  test('graph warning summary - 2000 edges under threshold', async ({ assert }) => {
    const { deriveGraphWarningSummary } = await import('@aiproj/types')

    const start = performance.now()
    const warnings = deriveGraphWarningSummary(graphFixture)
    const elapsed = performance.now() - start

    // 警告派生应在 100ms 内完成
    assert.isBelow(elapsed, 100, `warning derivation took ${elapsed.toFixed(1)}ms`)
    assert.equal(warnings.codes[0], 'GRAPH_TRUNCATED_EDGES')
    assert.isTrue(warnings.truncated)
  })

  test('graph query hash computation - 2000 edges under threshold', async ({ assert }) => {
    const { hashGraphViewFilters, normalizeGraphViewFilters } = await import('@aiproj/types')

    const start = performance.now()
    const filters = normalizeGraphViewFilters({
      projectScope: Array.from({ length: 1000 }, (_, i) => i + 1),
      depth: 3,
      nodeLimit: 2000,
      edgeLimit: 5000,
    })
    const hash = hashGraphViewFilters(filters)
    const elapsed = performance.now() - start

    // 1000 项目 scope 的哈希计算应在 50ms 内完成
    assert.isBelow(elapsed, 50, `graph query hash took ${elapsed.toFixed(1)}ms`)
    assert.isString(hash)
    assert.isAbove(hash.length, 0)
  })
})
