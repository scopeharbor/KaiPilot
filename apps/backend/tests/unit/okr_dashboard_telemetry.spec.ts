/**
 * OKR Dashboard 只读读审计/telemetry payload 脱敏测试（v3-okr-dashboard §3.10）。
 *
 * 覆盖：
 *   - payload 只含计数、metricVersion、cycleId、白名单查询键与 hash
 *   - **绝不包含** prompt、模型输出、证据正文、Authorization、token、API key、
 *     跨组织字段、objective/KR/evidence 明细、任何用户可读文本
 *   - 项目未启用读审计时也可以静默不落库；此测试仅验证 helper 输出脱敏
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import { buildOkrDashboardReadTelemetryPayload } from '#services/okr_dashboard_service'
import { computeOkrDashboardSummary, OKR_METRIC_VERSION } from '@aiproj/types'

function makeSummary() {
  return computeOkrDashboardSummary({
    organizationId: 42,
    actorId: 7,
    now: new Date('2026-07-30T00:00:00Z').getTime(),
    cycle: {
      cycleId: 100,
      title: '2026 Q3',
      status: 'active',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    },
    objectives: [
      {
        id: 200,
        organizationId: 42,
        cycleId: 100,
        projectId: null,
        teamId: null,
        ownerId: 7,
        scope: 'organization',
        title: '组织目标 A（含敏感文本）',
        description: '含 API key sk-xxxxx 的描述',
        status: 'active',
        weight: 1,
        progress: 40,
        confidence: 'medium',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        metricVersion: OKR_METRIC_VERSION,
        calculatedAt: null,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
        deletedAt: null,
      },
    ],
    keyResults: [],
    alignments: [],
    evidence: [],
    progressHistory: [],
    normalizedQuery: {} as any,
  })
}

test.group('OKR Dashboard telemetry payload 脱敏', () => {
  test('输出只含计数、hash、白名单键，不泄露敏感文本', ({ assert }) => {
    const summary = makeSummary()
    const payload = buildOkrDashboardReadTelemetryPayload(summary)

    // 必要字段
    assert.equal(payload.event, 'okr_dashboard.summary_read')
    assert.equal(payload.actorId, 7)
    assert.equal(payload.organizationId, 42)
    assert.equal(payload.metricVersion, `okr-dashboard.${OKR_METRIC_VERSION}`)
    assert.equal(payload.cycleId, 100)
    assert.equal(payload.visibleObjectiveCount, 1)
    assert.isString(payload.inputSignatureHash)
    assert.isString(payload.calculatedAt)

    // 脱敏：payload 序列化后不得包含任何敏感字符串
    const serialized = JSON.stringify(payload)
    assert.notInclude(serialized, '组织目标')
    assert.notInclude(serialized, 'API key')
    assert.notInclude(serialized, 'sk-xxxxx')
    assert.notInclude(serialized, '含敏感文本')
    assert.notMatch(serialized, /prompt/i)
    assert.notMatch(serialized, /authorization/i)
    assert.notMatch(serialized, /bearer/i)
    assert.notMatch(serialized, /token/i)
    assert.notMatch(serialized, /apikey/i)
  })

  test('无 cycle 与空数据 → payload cycleId=null，count=0', ({ assert }) => {
    const summary = computeOkrDashboardSummary({
      organizationId: 1,
      actorId: 2,
      now: new Date('2026-07-30T00:00:00Z').getTime(),
      cycle: {
        cycleId: null,
        title: null,
        status: null,
        startDate: null,
        endDate: null,
      },
      objectives: [],
      keyResults: [],
      alignments: [],
      evidence: [],
      progressHistory: [],
      normalizedQuery: {} as any,
    })
    const payload = buildOkrDashboardReadTelemetryPayload(summary)
    assert.equal(payload.cycleId, null)
    assert.equal(payload.visibleObjectiveCount, 0)
    assert.equal(payload.visibleKeyResultCount, 0)
  })

  test('payload 字段集稳定（不引入未白名单键）', ({ assert }) => {
    const summary = makeSummary()
    const payload = buildOkrDashboardReadTelemetryPayload(summary)
    const allowed = new Set([
      'event',
      'actorId',
      'organizationId',
      'metricVersion',
      'cycleId',
      'attentionLimit',
      'staleThresholdMinutes',
      'visibleObjectiveCount',
      'visibleKeyResultCount',
      'restrictedObjectiveCount',
      'restrictedKeyResultCount',
      'warningCount',
      'inputSignatureHash',
      'calculatedAt',
    ])
    for (const key of Object.keys(payload)) {
      assert.isTrue(allowed.has(key), `unexpected telemetry key: ${key}`)
    }
  })
})
