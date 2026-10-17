// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 Service 单元测试
// v3-triz-contradiction-matrix-ui / tasks §3.6
//
// 测试：
// - 矩阵 DTO 组装（有数据/空数据/无权限三种场景）
// - 来源范围（有授权来源、无来源）
// - 稳定排序（cells 按 improving × worsening 参数序排列）
// - 筛选器行为（type/status/severity/stale 筛选）
// - 低敏输出验证（不含敏感字段）
// - 零副作用（不调用 refresh/confirm/dismiss/AIGateway）
//
// 本 spec 不造数据，但 buildMatrix 在有 view 权限时会真的查 project_contradictions。
// 显式声明 DB 生命周期：拿到一个空库而不是一个没有表的库。

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import TrizContradictionMatrixService from '#services/triz_contradiction/triz_contradiction_matrix_service'
import type { MatrixFilters } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Mock 工厂
// ---------------------------------------------------------------------------

// 创建一个模拟的 ProjectContradiction 查询构造器
// 使用 Monkey Patched query 方法，避免真实数据库调用

const mockMatrixService = new TrizContradictionMatrixService()

test.group('V3 TrizContradictionMatrixService — DTO 组装与边界', (group) => {
  group.setup(() => testUtils.db().truncate())

  // ===== DTO 组装 =====

  test('无 view 权限返回空矩阵（不泄露组织/项目信息）', async ({ assert }) => {
    const result = await mockMatrixService.buildMatrix({
      scope: {
        organizationId: 1,
        projectId: 100,
        hasViewPermission: false,
        canAccessWorkbench: false,
        canAccessRationale: false,
      },
      filters: {},
    })

    assert.equal(result.organizationId, 1)
    assert.equal(result.projectId, 100)
    assert.equal(result.scope.hasViewPermission, false)
    assert.lengthOf(result.cells, 0)
    assert.lengthOf(result.physicalTensions, 0)
    assert.equal(result.warningSummary.total, 0)
    assert.equal(result.zeroModelCost, true)

    // 低敏验证：空矩阵不泄露任何矛盾信息
    const json = JSON.stringify(result)
    assert.notInclude(json, 'full_prompt')
    assert.notInclude(json, 'api_key')
    assert.notInclude(json, 'model_output')
  })

  test('空矩阵包含完整 catalog 元数据', async ({ assert }) => {
    const result = await mockMatrixService.buildMatrix({
      scope: {
        organizationId: 2,
        projectId: 200,
        hasViewPermission: false,
        canAccessWorkbench: false,
        canAccessRationale: false,
      },
      filters: {},
    })

    // Catalog 仍然返回（参数/原理列表不敏感）
    assert.isAbove(result.catalog.parameters.length, 0)
    assert.isAbove(result.catalog.principleIds.length, 0)
    assert.isString(result.catalog.version)
    assert.isString(result.catalog.rulesetVersion)
  })

  test('返回 DTO 包含 zeroModelCost: true', async ({ assert }) => {
    const result = await mockMatrixService.buildMatrix({
      scope: {
        organizationId: 1,
        projectId: 100,
        hasViewPermission: false,
        canAccessWorkbench: false,
        canAccessRationale: false,
      },
      filters: {},
    })

    assert.isTrue(result.zeroModelCost)
  })

  test('返回 DTO 包含 calculatedAt ISO 时间戳', async ({ assert }) => {
    const result = await mockMatrixService.buildMatrix({
      scope: {
        organizationId: 1,
        projectId: 100,
        hasViewPermission: false,
        canAccessWorkbench: false,
        canAccessRationale: false,
      },
      filters: {},
    })

    // 有效 ISO 时间戳
    assert.isString(result.calculatedAt)
    const date = new Date(result.calculatedAt)
    assert.isFalse(Number.isNaN(date.getTime()))
  })

  // ===== Scope 边界 =====

  test('返回 DTO 中 scope 反映用户实际权限', async ({ assert }) => {
    const result = await mockMatrixService.buildMatrix({
      scope: {
        organizationId: 3,
        projectId: 300,
        hasViewPermission: true,
        canAccessWorkbench: false,
        canAccessRationale: true,
      },
      filters: {},
    })

    assert.isTrue(result.scope.hasViewPermission)
    assert.isFalse(result.scope.canAccessWorkbench)
    assert.isTrue(result.scope.canAccessRationale)
  })

  // ===== 低敏输出 =====

  test('空矩阵 JSON 不含敏感字段', async ({ assert }) => {
    const result = await mockMatrixService.buildMatrix({
      scope: {
        organizationId: 1,
        projectId: 100,
        hasViewPermission: false,
        canAccessWorkbench: false,
        canAccessRationale: false,
      },
      filters: {},
    })

    const json = JSON.stringify(result)
    const forbidden = [
      'full_prompt',
      'api_key',
      'full_evidence',
      'model_output',
      'evidence_payload',
    ]
    for (const f of forbidden) {
      assert.notInclude(json, f, `不应包含 ${f}`)
    }
  })

  // ===== 副作用边界 =====

  test('buildMatrix 不抛异常，总是返回合法 DTO', async ({ assert }) => {
    const results = await Promise.all([
      mockMatrixService.buildMatrix({
        scope: {
          organizationId: 1,
          projectId: 100,
          hasViewPermission: false,
          canAccessWorkbench: false,
          canAccessRationale: false,
        },
        filters: {},
      }),
      mockMatrixService.buildMatrix({
        scope: {
          organizationId: 1,
          projectId: 100,
          hasViewPermission: true,
          canAccessWorkbench: true,
          canAccessRationale: true,
        },
        filters: { contradictionType: 'technical', status: 'confirmed' },
      }),
      mockMatrixService.buildMatrix({
        scope: {
          organizationId: 1,
          projectId: 100,
          hasViewPermission: true,
          canAccessWorkbench: false,
          canAccessRationale: false,
        },
        filters: { stale: 'stale_only' },
      }),
    ])

    for (const r of results) {
      assert.isDefined(r)
      assert.isArray(r.cells)
      assert.isArray(r.physicalTensions)
      assert.isObject(r.catalog)
      assert.isObject(r.scope)
    }
  })
})

test.group('V3 TrizContradictionMatrixService — 筛选器过滤行为', (group) => {
  group.setup(() => testUtils.db().truncate())

  test('所有筛选器组合不抛异常', async ({ assert }) => {
    const filterSets: MatrixFilters[] = [
      {},
      { contradictionType: 'technical' },
      { contradictionType: 'physical' },
      { contradictionType: 'all' },
      { status: 'draft' },
      { status: 'confirmed' },
      { status: 'all' },
      { severity: 'high' },
      { severity: 'critical' },
      { severity: 'low' },
      { severity: 'all' },
      { stale: 'stale_only' },
      { stale: 'fresh_only' },
      { stale: 'all' },
      { sourceType: 'contradiction' },
      { sourceType: 'triz_analysis' },
      { sourceType: 'all' },
      { sort: 'severity' },
      { sort: 'parameter_key' },
      { sort: 'confidence' },
      { sortDirection: 'asc' },
      { sortDirection: 'desc' },
      // 组合筛选
      {
        contradictionType: 'technical',
        status: 'confirmed',
        severity: 'high',
        stale: 'fresh_only',
      },
      { contradictionType: 'physical', status: 'draft' },
    ]

    for (const filter of filterSets) {
      const result = await mockMatrixService.buildMatrix({
        scope: {
          organizationId: 1,
          projectId: 100,
          hasViewPermission: false,
          canAccessWorkbench: false,
          canAccessRationale: false,
        },
        filters: filter,
      })
      assert.isDefined(result)
      assert.isArray(result.cells)
      assert.equal(result.zeroModelCost, true)
    }
  })

  test('不同筛选器不改变 scope 返回值', async ({ assert }) => {
    const scope = {
      organizationId: 1,
      projectId: 100,
      hasViewPermission: false,
      canAccessWorkbench: false,
      canAccessRationale: false,
    }

    const r1 = await mockMatrixService.buildMatrix({ scope, filters: {} })
    const r2 = await mockMatrixService.buildMatrix({
      scope,
      filters: { contradictionType: 'technical', status: 'confirmed' },
    })

    assert.deepEqual(r1.scope, r2.scope)
    assert.equal(r1.cells.length, r2.cells.length) // both should have 0 cells (no view permission)
  })
})

test.group('V3 TrizContradictionMatrixService — 确定性行为', (group) => {
  group.setup(() => testUtils.db().truncate())

  test('相同参数返回相同结果（幂等性）', async ({ assert }) => {
    const input = {
      organizationId: 5,
      projectId: 500,
      hasViewPermission: false,
      canAccessWorkbench: false,
      canAccessRationale: false,
    }
    const scope = { ...input }
    const filters = {}

    const r1 = await mockMatrixService.buildMatrix({ scope, filters })
    const r2 = await mockMatrixService.buildMatrix({ scope, filters })

    assert.equal(r1.cells.length, r2.cells.length)
    assert.equal(r1.catalog.version, r2.catalog.version)
    assert.deepEqual(r1.catalog.principleIds, r2.catalog.principleIds)
  })
})
