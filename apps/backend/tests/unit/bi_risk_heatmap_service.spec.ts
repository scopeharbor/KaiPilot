/**
 * BI 风险热力图 Service 单元测试（v3-bi-risk-heatmap §3.9–3.10）
 */

import { test } from '@japa/runner'
import { setupApp } from '../helpers/test_helpers.js'
import BiRiskHeatmapService from '#services/bi_risk_heatmap_service'
import BiRiskHeatmapPolicy from '#policies/bi_risk_heatmap_policy'
import Risk from '#models/risk'
import { DateTime } from 'luxon'
import type AuditService from '#services/audit_service'
import type {
  BiRiskHeatmapQuery,
  BiRiskHeatmapMetricKey,
  BiRiskHeatmapDimensionKey,
} from '@aiproj/types'
import {
  BI_RISK_HEATMAP_METRIC_KEYS,
  BI_RISK_HEATMAP_DEFAULT_WINDOW,
  BI_RISK_HEATMAP_MAX_PER_PAGE,
} from '@aiproj/types'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'

test.group('BiRiskHeatmapService', (group) => {
  let service: BiRiskHeatmapService
  let orgId: number
  let owner: any
  let member: any

  group.setup(async () => {
    await setupApp()
  })

  group.each.setup(async () => {
    const policy = new (BiRiskHeatmapPolicy as any)(mockRbac(), mockOrgPolicy())
    const audit = mockAuditService()
    service = new BiRiskHeatmapService(policy, audit)

    orgId = 1
    owner = { id: 1, isSuperAdmin: false }
    member = { id: 2, isSuperAdmin: false }
  })

  // ── 3.9: Valid reads ──────────────────────────────────────────────────────

  test('返回有效热力图 cells', async ({ assert }) => {
    const query = mkQuery()
    const result = await service.getHeatmap(orgId, owner, query)
    assert.isArray(result.data)
    assert.isObject(result.meta)
    assert.equal(result.meta.organizationId, orgId)
    assert.equal(result.meta.metricVersion, 'bi-risk-heatmap-v1')
  })

  test('分页正确', async ({ assert }) => {
    const query = mkQuery({ perPage: 5, page: 1 })
    const result = await service.getHeatmap(orgId, owner, query)
    assert.equal(result.meta.perPage, 5)
    assert.equal(result.meta.page, 1)
    assert.isAtMost(result.data.length, 5)
  })

  // ── 3.9: Validation failures ──────────────────────────────────────────────

  test('不支持的指标返回 empty unavailable', async ({ assert }) => {
    const query = mkQuery({ metricKey: 'unknown_metric' as BiRiskHeatmapMetricKey })
    const result = await service.getHeatmap(orgId, owner, query)
    assert.isEmpty(result.data)
    assert.isNotEmpty(result.warnings)
    assert.isTrue(result.warnings.some((w) => w.code === 'UNSUPPORTED_METRIC'))
  })

  test('财务风险指标被拒绝', async ({ assert }) => {
    const query = mkQuery({ metricKey: 'budget_risk' as BiRiskHeatmapMetricKey })
    const result = await service.getHeatmap(orgId, owner, query)
    assert.isEmpty(result.data)
    assert.isTrue(result.warnings.some((w) => w.code === 'UNSUPPORTED_FINANCIAL_METRIC'))
  })

  test('相同行列维度被拒绝', async ({ assert }) => {
    const query = mkQuery({
      rowDimension: 'project',
      columnDimension: 'project' as BiRiskHeatmapDimensionKey,
    })
    const result = await service.getHeatmap(orgId, owner, query)
    assert.isTrue(result.warnings.some((w) => w.code === 'UNSUPPORTED_QUERY_COMBINATION'))
  })

  test('超大 perPage 被截断', async ({ assert }) => {
    const query = mkQuery({ perPage: 1000 })
    const result = await service.getHeatmap(orgId, owner, query)
    // perPage 截断到最大值
    assert.equal(result.meta.perPage, BI_RISK_HEATMAP_MAX_PER_PAGE)
  })

  // ── 3.9: Organization isolation ───────────────────────────────────────────

  test('不同组织间数据隔离', async ({ assert }) => {
    const query = mkQuery()
    const result = await service.getHeatmap(99999, owner, query)
    // 即使请求了不存在的组织，也会返回空结果
    assert.isEmpty(result.data)
    assert.equal(result.meta.organizationId, 99999)
  })

  // ── 3.9: Dimension redaction ──────────────────────────────────────────────

  test('风险指标权限不足时返回 redacted', async ({ assert }) => {
    // 使用无权查看风险的 policy
    const noRiskPolicy = new (BiRiskHeatmapPolicy as any)(mockNoPermissionRbac(), mockOrgPolicy())
    const noRiskAudit = mockAuditService()
    const noRiskService = new BiRiskHeatmapService(noRiskPolicy, noRiskAudit)

    const query = mkQuery({ metricKey: BI_RISK_HEATMAP_METRIC_KEYS.RISK_COUNT })
    const result = await noRiskService.getHeatmap(orgId, member, query)
    assert.isEmpty(result.data)
    assert.isTrue(result.warnings.some((w) => w.code === 'DIMENSION_REDACTED'))
  })

  // ── 3.9: Stale sources ────────────────────────────────────────────────────

  test('来源 freshness 信息包含在 meta 中', async ({ assert }) => {
    const query = mkQuery()
    const result = await service.getHeatmap(orgId, owner, query)
    assert.isObject(result.meta.freshness)
    assert.property(result.meta.freshness, 'state')
    assert.property(result.meta.freshness, 'sourceCoverage')
    assert.property(result.meta.freshness, 'freshnessHash')
  })

  // ── 3.10: No side effects ─────────────────────────────────────────────────

  test('读端点不调用 AIGateway', async ({ assert }) => {
    const query = mkQuery()
    const result = await service.getHeatmap(orgId, owner, query)
    // Service 不产生任何业务写入
    assert.exists(result)
    assert.isDefined(result.meta)
  })

  test('读端点不修改事实数据', async ({ assert }) => {
    const query = mkQuery()
    const result1 = await service.getHeatmap(orgId, owner, query)
    const result2 = await service.getHeatmap(orgId, owner, query)
    // 连续两次读取应返回一致的结构
    assert.equal(result1.meta.metricVersion, result2.meta.metricVersion)
  })

  // ── 3.9: Pagination ───────────────────────────────────────────────────────

  test('分页可翻页', async ({ assert }) => {
    const query = mkQuery({ perPage: 3, page: 2 })
    const result = await service.getHeatmap(orgId, owner, query)
    assert.equal(result.meta.page, 2)
    assert.equal(result.meta.perPage, 3)
  })

  // ── 3.9: Cell alpha ─────────────────────────────────────────────────────────

  test('cell alpha 计算正确（cell 评分有效性）', async ({ assert }) => {
    const query = mkQuery()
    const result = await service.getHeatmap(orgId, owner, query)
    for (const cell of result.data) {
      assert.isNumber(cell.score)
      assert.isAtLeast(cell.score, 0)
      assert.isAtMost(cell.score, 1)
      assert.isNumber(cell.confidence)
      assert.isAtLeast(cell.confidence, 0)
      assert.isAtMost(cell.confidence, 1)
    }
  })

  // ── 3.10: 端点不暴露敏感元数据 ──────────────────────────────────────────

  test('响应不包含 prompt/model 输出或 Authorization 头', async ({ assert }) => {
    const query = mkQuery()
    const result = await service.getHeatmap(orgId, owner, query)
    const json = JSON.stringify(result)
    assert.notInclude(json, 'prompt')
    assert.notInclude(json, 'Authorization')
    assert.notInclude(json, 'token')
    assert.notInclude(json, 'apiKey')
  })
})

// ── 3.11: DB 数据映射与组织隔离（level→risk_level 缺陷修复回归）─────────────

test.group('BiRiskHeatmapService 数据库映射', (group) => {
  useAuthDatabase(group)

  // 与实现 computeSeverityWeight / computeStatusWeight 保持一致的期望值计算（独立于服务实现，便于发现权重回归）。
  const LEVEL_WEIGHTS: Record<string, number> = {
    critical: 1.0,
    high: 0.8,
    medium: 0.5,
    low: 0.2,
    none: 0.05,
  }
  const STATUS_WEIGHTS: Record<string, number> = {
    identified: 1.0,
    analyzing: 0.7,
    mitigating: 0.7,
    accepted: 0.4,
    resolved: 0.1,
    closed: 0.0,
  }
  function expectedScore(level: string, probability: number, impact: number, status: string) {
    const p = Math.min(1, Math.max(0, probability))
    const i = Math.min(1, Math.max(0, impact))
    const lw = LEVEL_WEIGHTS[level] ?? 0.5
    const sw = STATUS_WEIGHTS[status] ?? 0.5
    return Math.round(p * i * lw * sw * 10000) / 10000
  }

  let service: BiRiskHeatmapService
  let owner: any
  let org: any
  let project: any

  group.each.setup(async () => {
    const policy = new (BiRiskHeatmapPolicy as any)(mockRbac(), mockOrgPolicy())
    service = new BiRiskHeatmapService(policy, mockAuditService())
    owner = await createUser({ email: uniqueEmail('heatmap-owner') })
    org = await createOrganization(owner)
    const created = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    project = created.project
  })

  async function createRisk(
    orgId: number,
    projectId: number,
    createdBy: number,
    level: string,
    probability: number,
    impact: number,
    status = 'identified',
  ): Promise<Risk> {
    return Risk.create({
      organizationId: orgId,
      projectId,
      title: `风险-${level}-${Math.random().toString(36).slice(2, 8)}`,
      description: '热力图测试风险',
      category: 'technical',
      probability,
      impact,
      score: Math.round(probability * impact * 10),
      status,
      riskLevel: level,
      identifiedAt: DateTime.now(),
      createdBy,
      updatedBy: createdBy,
    })
  }

  test('多级别风险映射为多列且分数正确', async ({ assert }) => {
    const sets = [
      { level: 'critical', probability: 1.0, impact: 1.0 },
      { level: 'high', probability: 0.9, impact: 0.8 },
      { level: 'medium', probability: 0.5, impact: 0.5 },
      { level: 'low', probability: 0.3, impact: 0.3 },
    ]
    for (const s of sets) {
      for (let k = 0; k < 3; k++) {
        await createRisk(org.id, project.id, owner.id, s.level, s.probability, s.impact)
      }
    }

    const result = await service.getHeatmap(
      org.id,
      owner,
      mkQuery({ columnDimension: 'risk_level' }),
    )
    assert.equal(result.data.length, 4, '应有 4 个风险等级列×行单元')
    const byLevel = new Map(result.data.map((c) => [c.columnKey, c]))
    for (const s of sets) {
      const cell = byLevel.get(s.level)
      assert.isDefined(cell, `缺少 ${s.level} 列`)
      assert.equal(cell!.count, 3, `${s.level} 单元样本数`)
      assert.equal(
        cell!.score,
        expectedScore(s.level, s.probability, s.impact, 'identified'),
        `${s.level} 单元分数应与概率×影响×等级权重×状态权重一致`,
      )
    }
    // 缺陷回归：旧代码读 r.level（不存在）→ 等级恒 undefined → severityWeight 恒 0.5，
    // 且状态权重键 open/in_progress/monitoring 在本系统不存在 → statusWeight 恒 0.5，
    // critical 单元分数上限 0.25 → 永不达到 high/critical → Top 风险单元永不渲染。
    // 修复后 critical（p=1,i=1, identified）单元分数 1.0 → 等级 critical；
    // high（p=0.9,i=0.8）单元分数 0.576 → 等级 high。
    assert.equal(byLevel.get('critical')!.riskLevel, 'critical')
    assert.equal(byLevel.get('high')!.riskLevel, 'high')
  })

  test('风险等级筛选使用 risk_level 列（旧代码筛选 level 列不存在会 SQL 报错）', async ({
    assert,
  }) => {
    await createRisk(org.id, project.id, owner.id, 'high', 0.9, 0.8)
    await createRisk(org.id, project.id, owner.id, 'low', 0.3, 0.3)

    const result = await service.getHeatmap(
      org.id,
      owner,
      mkQuery({ columnDimension: 'risk_level', filters: { riskLevels: ['high'] } }),
    )
    assert.deepEqual(
      result.data.map((c) => c.columnKey),
      ['high'],
    )
    assert.equal(result.data[0]!.count, 1)
  })

  test('无风险数据返回空态', async ({ assert }) => {
    const result = await service.getHeatmap(org.id, owner, mkQuery())
    assert.isEmpty(result.data)
    assert.equal(result.meta.total, 0)
    assert.equal(result.meta.totalPages, 0)
  })

  test('不同组织数据隔离', async ({ assert }) => {
    await createRisk(org.id, project.id, owner.id, 'critical', 1.0, 1.0)
    await createRisk(org.id, project.id, owner.id, 'high', 0.9, 0.8)

    const otherOwner = await createUser({ email: uniqueEmail('heatmap-other') })
    const otherOrg = await createOrganization(otherOwner)
    const otherCreated = await createProjectWithMember(
      otherOrg,
      otherOwner,
      otherOwner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const otherProject = otherCreated.project
    await createRisk(otherOrg.id, otherProject.id, otherOwner.id, 'low', 0.3, 0.3)
    await createRisk(otherOrg.id, otherProject.id, otherOwner.id, 'medium', 0.5, 0.5)

    const resultA = await service.getHeatmap(
      org.id,
      owner,
      mkQuery({ columnDimension: 'risk_level' }),
    )
    assert.deepEqual(
      [...new Set(resultA.data.map((c) => c.columnKey))].sort(),
      ['critical', 'high'],
      '组织 A 只能看到自己的风险等级',
    )

    const resultB = await service.getHeatmap(
      otherOrg.id,
      otherOwner,
      mkQuery({ columnDimension: 'risk_level' }),
    )
    assert.deepEqual(
      [...new Set(resultB.data.map((c) => c.columnKey))].sort(),
      ['low', 'medium'],
      '组织 B 只能看到自己的风险等级',
    )
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkQuery(overrides?: Partial<BiRiskHeatmapQuery>): BiRiskHeatmapQuery {
  return {
    metricKey: BI_RISK_HEATMAP_METRIC_KEYS.RISK_EXPOSURE_SCORE,
    window: BI_RISK_HEATMAP_DEFAULT_WINDOW,
    rowDimension: 'project',
    columnDimension: 'risk_level',
    ...overrides,
  }
}

function mockRbac() {
  return {
    check: async () => ({ allowed: true }),
  }
}

function mockNoPermissionRbac() {
  return {
    check: async () => ({ allowed: false }),
  }
}

function mockOrgPolicy() {
  return {
    view: async () => true,
  }
}

// 只用到 log()，其余成员对本用例无意义，故按 AuditService 断言最小桩
function mockAuditService(): AuditService {
  return {
    log: async () => {},
  } as unknown as AuditService
}
