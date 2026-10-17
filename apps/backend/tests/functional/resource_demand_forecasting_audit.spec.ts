/**
 * 资源需求预测审计单元测试（v3-resource-demand-forecasting §4.4）。
 *
 * 覆盖：
 *   - buildForecastReadAuditPayload 基础结构
 *   - buildForecastReadAuditPayload 敏感字段排除
 *   - buildForecastDrillDownAuditPayload drillTargetHash
 *   - buildForecastAiAdvisoryAuditPayload 模型输出排除
 *
 * 红线验证：
 *   - 审计负载不包含 prompts、tokens、secrets、模型输出文本
 *   - drill-down 目标 ID 以哈希形式记录
 *   - AI advisory 负载不携带模型输出文本
 */
import { test } from '@japa/runner'
import {
  buildForecastReadAuditPayload,
  buildForecastDrillDownAuditPayload,
  buildForecastAiAdvisoryAuditPayload,
  ResourceDemandForecastingAuditEvent,
} from '#services/resource_demand_forecasting_audit'
import { FORECAST_METHODS } from '@aiproj/types'
import type { ForecastFreshness } from '@aiproj/types'

// ─── Mock User ─────────────────────────────────────────────────────────────

function mockUser(id: number) {
  return {
    id,
    fullName: '测试用户',
    email: 'test@example.com',
    organizationId: 1,
  } as any
}

// ─── Mock Freshness ────────────────────────────────────────────────────────

function mockFreshness(freshnessHash = 'abc123', sourceCoverage = 0.75): ForecastFreshness {
  return {
    freshnessHash,
    sourceCoverage,
    sources: {} as ForecastFreshness['sources'],
    staleSources: [],
    isStale: false,
    overallFreshness: '2026-07-29T00:00:00.000Z',
  }
}

// ─── Mock Query ────────────────────────────────────────────────────────────

function mockQuery() {
  return {
    startDate: '2026-07-01',
    endDate: '2026-08-01',
    granularity: 'week' as const,
    projectIds: [1, 2, 3],
    roles: ['frontend', 'backend'],
    skills: ['react', 'typescript'],
    departments: ['engineering'],
    loadStatuses: ['normal', 'high'],
    confidenceThreshold: 'medium',
    method: 'deterministic_bucket' as const,
    topN: 10,
    sort: '-demand',
    page: 1,
    perPage: 50,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Group
// ═══════════════════════════════════════════════════════════════════════════

test.group('ResourceDemandForecasting — Audit Safety', () => {
  // ─── 1: buildForecastReadAuditPayload contains actorId and organizationId ───

  test('buildForecastReadAuditPayload contains actorId and organizationId', ({ assert }) => {
    const actor = mockUser(42)
    const payload = buildForecastReadAuditPayload(
      actor,
      7,
      'summary',
      mockQuery(),
      FORECAST_METHODS.DETERMINISTIC_BUCKET,
      mockFreshness(),
      [],
    )

    assert.equal(payload.actorId, 42)
    assert.equal(payload.organizationId, 7)
  })

  // ─── 2: buildForecastReadAuditPayload includes queryShape with endpointFamily ───

  test('buildForecastReadAuditPayload includes queryShape with endpointFamily', ({ assert }) => {
    const actor = mockUser(1)
    const payload = buildForecastReadAuditPayload(
      actor,
      1,
      'demand_curves',
      mockQuery(),
      FORECAST_METHODS.DETERMINISTIC_BUCKET,
      mockFreshness(),
      [],
    )

    assert.isDefined(payload.queryShape)
    assert.equal(payload.queryShape.endpointFamily, 'demand_curves')
    assert.equal(payload.queryShape.projectCount, 3)
    assert.equal(payload.queryShape.roleCount, 2)
    assert.equal(payload.queryShape.skillCount, 2)
    assert.equal(payload.queryShape.departmentCount, 1)
    assert.equal(payload.queryShape.loadStatusCount, 2)
    assert.equal(payload.queryShape.granularity, 'week')
    assert.equal(payload.queryShape.startDate, '2026-07-01')
    assert.equal(payload.queryShape.endDate, '2026-08-01')
    assert.equal(payload.queryShape.method, 'deterministic_bucket')
    assert.equal(payload.queryShape.topN, 10)
    assert.equal(payload.queryShape.sortKey, '-demand')
    assert.equal(payload.queryShape.page, 1)
    assert.equal(payload.queryShape.perPage, 50)
  })

  // ─── 3: buildForecastReadAuditPayload includes freshnessHash and sourceCoverage ───

  test('buildForecastReadAuditPayload includes freshnessHash and sourceCoverage', ({ assert }) => {
    const actor = mockUser(1)
    const payload = buildForecastReadAuditPayload(
      actor,
      1,
      'summary',
      mockQuery(),
      FORECAST_METHODS.DETERMINISTIC_BUCKET,
      mockFreshness('f47ac10b', 0.88),
      [],
    )

    assert.equal(payload.freshnessHash, 'f47ac10b')
    assert.equal(payload.sourceCoverage, 0.88)
  })

  // ─── 4: buildForecastReadAuditPayload does NOT contain prompts, tokens, or secrets ───

  test('buildForecastReadAuditPayload does NOT contain prompts, tokens, or secrets', ({
    assert,
  }) => {
    const actor = mockUser(1)
    const payload = buildForecastReadAuditPayload(
      actor,
      1,
      'summary',
      mockQuery(),
      FORECAST_METHODS.DETERMINISTIC_BUCKET,
      mockFreshness(),
      [],
    )

    const payloadObj = payload as unknown as Record<string, unknown>

    // 不应包含敏感字段
    assert.isUndefined(payloadObj.prompt)
    assert.isUndefined(payloadObj.prompts)
    assert.isUndefined(payloadObj.token)
    assert.isUndefined(payloadObj.tokens)
    assert.isUndefined(payloadObj.apiKey)
    assert.isUndefined(payloadObj.secret)
    assert.isUndefined(payloadObj.secrets)
    assert.isUndefined(payloadObj.modelOutput)
    assert.isUndefined(payloadObj.modelOutputText)
    assert.isUndefined(payloadObj.evidenceText)
    assert.isUndefined(payloadObj.authorization)
    assert.isUndefined(payloadObj.crossOrganizationData)
    assert.isUndefined(payloadObj.hiddenLabels)
    assert.isUndefined(payloadObj.hiddenCounts)

    // queryShape 只应包含计数和元数据，不应包含具体 ID 列表或名称
    assert.isUndefined(payloadObj.projectNames)
    assert.isUndefined(payloadObj.resourceNames)
    assert.isUndefined(payloadObj.taskTitles)
  })

  // ─── 5: buildForecastDrillDownAuditPayload includes drillTargetHash ───

  test('buildForecastDrillDownAuditPayload includes drillTargetHash', ({ assert }) => {
    const actor = mockUser(99)
    const payload = buildForecastDrillDownAuditPayload(
      actor,
      3,
      'project',
      'e3b0c44298fc1c149afbf4c8996fb924',
      'freshness-abc',
    )

    assert.equal(payload.actorId, 99)
    assert.equal(payload.organizationId, 3)
    assert.equal(payload.drillTargetType, 'project')
    assert.equal(payload.drillTargetHash, 'e3b0c44298fc1c149afbf4c8996fb924')
    assert.equal(payload.freshnessHash, 'freshness-abc')

    // drill-down 负载不应包含原始 targetId 或 target 名称
    const payloadObj = payload as unknown as Record<string, unknown>
    assert.isUndefined(payloadObj.targetId)
    assert.isUndefined(payloadObj.targetName)
    assert.isUndefined(payloadObj.rawTargetId)
  })

  // ─── 6: buildForecastAiAdvisoryAuditPayload excludes model output text ───

  test('buildForecastAiAdvisoryAuditPayload excludes model output text', ({ assert }) => {
    const actor = mockUser(1)
    const payload = buildForecastAiAdvisoryAuditPayload(
      actor,
      2,
      'claude-fable-5',
      'success',
      'advisory-freshness-hash',
    )

    assert.equal(payload.actorId, 1)
    assert.equal(payload.organizationId, 2)
    assert.equal(payload.aiModel, 'claude-fable-5')
    assert.equal(payload.aiAdvisoryStatus, 'success')
    assert.equal(payload.freshnessHash, 'advisory-freshness-hash')

    // AI advisory 审计负载绝对不能包含模型输出文本、prompts、tokens
    const payloadObj = payload as unknown as Record<string, unknown>
    assert.isUndefined(payloadObj.modelOutput)
    assert.isUndefined(payloadObj.modelOutputText)
    assert.isUndefined(payloadObj.narrative)
    assert.isUndefined(payloadObj.suggestedActions)
    assert.isUndefined(payloadObj.rawResponse)
    assert.isUndefined(payloadObj.prompt)
    assert.isUndefined(payloadObj.systemPrompt)
    assert.isUndefined(payloadObj.userPrompt)
    assert.isUndefined(payloadObj.token)
    assert.isUndefined(payloadObj.tokens)
    assert.isUndefined(payloadObj.inputTokens)
    assert.isUndefined(payloadObj.outputTokens)
  })
})

// ─── 审计事件常量验证 ──────────────────────────────────────────────────────

test.group('ResourceDemandForecasting — Audit Event Constants', () => {
  test('FORECAST_READ event constant is defined', ({ assert }) => {
    assert.equal(ResourceDemandForecastingAuditEvent.FORECAST_READ, 'ORG_FORECAST_READ')
  })

  test('FORECAST_DRILL_DOWN event constant is defined', ({ assert }) => {
    assert.equal(ResourceDemandForecastingAuditEvent.FORECAST_DRILL_DOWN, 'ORG_FORECAST_DRILL_DOWN')
  })

  test('FORECAST_AI_ADVISORY event constant is defined', ({ assert }) => {
    assert.equal(
      ResourceDemandForecastingAuditEvent.FORECAST_AI_ADVISORY,
      'ORG_FORECAST_AI_ADVISORY',
    )
  })
})
