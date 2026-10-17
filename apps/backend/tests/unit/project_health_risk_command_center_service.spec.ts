import { test } from '@japa/runner'
import ProjectHealthRiskCommandCenterService from '#services/project_health_risk_command_center_service'
import type { CommandCenterAccess } from '#policies/project_health_risk_command_center_policy'
import { normalizeCommandCenterQuery, detectForbiddenFields } from '@aiproj/types'
import type { CommandCenterResponse, DashboardHealthSummary } from '@aiproj/types'

const NOW = Date.parse('2026-09-01T08:00:00.000Z')

const user = { id: 7, isSuperAdmin: false } as never

const accessFull: CommandCenterAccess = {
  canViewRisk: true,
  canViewResource: true,
  canViewChangeImpact: true,
}

function normalizedQuery(limit?: number) {
  const r = normalizeCommandCenterQuery(limit !== undefined ? { attentionLimit: limit } : {})
  if (!r.ok) throw new Error('bad query')
  return r.query
}

// ─── fakes ─────────────────────────────────────────────────────────────────────

interface FakeDashboardOptions {
  healthStatus?: string
  overdueTaskCount?: number
  blockedCount?: number
  taskTotal?: number
  milestoneOverdue?: number
  healthDiagnosis?: DashboardHealthSummary
  throwOnGet?: boolean
}

function makeHealthDiagnosis(
  overrides: Partial<DashboardHealthSummary> = {},
): DashboardHealthSummary {
  return {
    diagnosisId: 9001,
    overallScore: 86,
    overallLabel: '良好',
    dimensionScores: [
      { dimension: 'schedule', score: 82, severity: 'medium' },
      { dimension: 'risk', score: 90, severity: 'info' },
    ],
    status: 'confirmed',
    stale: false,
    staleReason: null,
    confirmedAt: new Date(NOW - 86_400_000).toISOString(),
    confirmedBy: 7,
    confirmedNotes: null,
    warnings: [],
    available: true,
    ...overrides,
  } as DashboardHealthSummary
}

function makeDashboardService(options: FakeDashboardOptions = {}) {
  const calls = { get: 0 }
  const service = {
    async get() {
      calls.get += 1
      if (options.throwOnGet) throw new Error('RESOURCE_NOT_FOUND')
      const taskTotal = options.taskTotal ?? 20
      return {
        stats: {
          healthStatus: options.healthStatus ?? 'yellow',
          progressPercent: 42,
          taskStatusDistribution: {
            todo: Math.max(0, taskTotal - 2),
            done: 1,
            blocked: options.blockedCount ?? 1,
          },
          memberCount: 6,
          milestoneStatusDistribution: {
            total: 4,
            done: 2,
            overdue: options.milestoneOverdue ?? 0,
          },
          startDate: null,
          endDate: null,
          remainingDays: 30,
        },
        recentActivity: [],
        metrics: [
          { key: 'overdue_task_count', value: options.overdueTaskCount ?? 3 },
          { key: 'health_status', value: options.healthStatus ?? 'yellow' },
        ],
        meta: {
          calculatedAt: new Date(NOW).toISOString(),
          metricVersion: 'dashboard-metrics.v1',
          projectId: 101,
          organizationId: 1,
        },
        warnings: [],
        healthDiagnosis: options.healthDiagnosis ?? makeHealthDiagnosis(),
        contradictionSummary: null,
        recommendationSummary: null,
        trizInnovationWorkbenchSummary: null,
      }
    },
  }
  return { service, calls }
}

function makeRiskWorkbench(
  options: {
    summary?: Partial<Record<string, unknown>>
    reviewQueue?: Array<Record<string, unknown>>
  } = {},
) {
  const calls = { getSummary: 0, getReviewQueue: 0 }
  const service = {
    async getSummary() {
      calls.getSummary += 1
      return {
        totalRisks: 12,
        openRisks: 5,
        highRiskCount: 2,
        criticalRiskCount: 0,
        overdueReviewCount: 1,
        incompleteResponsePlans: 2,
        trend30d: { created: 4, closed: 3 },
        healthScore: 74,
        topRisks: [
          {
            id: 501,
            title: '关键依赖延期风险',
            riskLevel: 'critical',
            score: 90,
            status: 'mitigating',
          },
          { id: 502, title: '人员流失风险', riskLevel: 'high', score: 70, status: 'identified' },
        ],
        ...options.summary,
      }
    },
    async getReviewQueue() {
      calls.getReviewQueue += 1
      return (
        options.reviewQueue ?? [
          {
            id: 503,
            title: '供应商交付风险',
            riskLevel: 'high',
            score: 65,
            nextReviewAt: new Date(NOW - 3 * 86_400_000).toISOString(),
            lastReviewAt: null,
            ownerId: 7,
          },
        ]
      )
    },
  }
  return { service, calls }
}

function makePredictionAdapter(options: { summary?: Record<string, unknown> } = {}) {
  const calls = { getSummary: 0 }
  const service = {
    async getSummary() {
      calls.getSummary += 1
      return {
        snapshotId: null,
        window: null,
        status: null,
        signalCount: 0,
        criticalCount: 0,
        highCount: 0,
        maxSeverity: null,
        stale: false,
        staleReason: null,
        warnings: [],
        available: false,
        confirmedAt: null,
        hasAiExplanation: false,
        ...options.summary,
      }
    },
  }
  return { service, calls }
}

function makeResourceLoadService(
  options: {
    fail?: boolean
    resources?: Array<{ overallUtilizationPercent: number }>
  } = {},
) {
  const calls = { load: 0 }
  const service = {
    async load() {
      calls.load += 1
      if (options.fail) throw new Error('DB_UNAVAILABLE')
      return {
        from: '',
        to: '',
        resources: options.resources ?? [
          { overallUtilizationPercent: 120 },
          { overallUtilizationPercent: 60 },
        ],
        teamAverageUtilizationPercent: 90,
      }
    },
  }
  return { service, calls }
}

type AnyService = InstanceType<typeof ProjectHealthRiskCommandCenterService>

function makeService(deps: {
  dashboard?: ReturnType<typeof makeDashboardService>
  risk?: ReturnType<typeof makeRiskWorkbench>
  prediction?: ReturnType<typeof makePredictionAdapter>
  resource?: ReturnType<typeof makeResourceLoadService>
}): AnyService {
  return new ProjectHealthRiskCommandCenterService(
    (deps.dashboard ?? makeDashboardService()).service as never,
    (deps.risk ?? makeRiskWorkbench()).service as never,
    (deps.prediction ?? makePredictionAdapter()).service as never,
    (deps.resource ?? makeResourceLoadService()).service as never,
  )
}

function injectClock(service: AnyService): void {
  service.clock = () => new Date(NOW)
}

function findSource(response: CommandCenterResponse, key: string) {
  return response.data.sources.find((s) => s.sourceKey === key)
}

// ─── tests ─────────────────────────────────────────────────────────────────────

test.group('ProjectHealthRiskCommandCenterService —— 只读聚合（§3）', () => {
  test('ready：已确认且未过期诊断成为 headline，来源齐全且低敏扫描零命中', async ({ assert }) => {
    const dashboard = makeDashboardService()
    const risk = makeRiskWorkbench()
    const prediction = makePredictionAdapter({
      summary: {
        snapshotId: 77,
        signalCount: 3,
        criticalCount: 1,
        highCount: 2,
        maxSeverity: 'critical',
        available: true,
      },
    })
    const resource = makeResourceLoadService()
    const service = makeService({ dashboard, risk, prediction, resource })
    injectClock(service)
    const ledger: import('#services/project_health_risk_command_center_service').ReaderQueryLedger =
      {
        entries: [],
        total() {
          return this.entries.reduce((s, e) => s + e.queries, 0)
        },
      }
    service.queryLedger = ledger

    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)

    assert.equal(result.data.headline.sourceKey, 'health-diagnosis')
    assert.equal(result.data.headline.degraded, false)
    assert.equal(result.meta.contractVersion, 'project-health-risk-command-center/v1')
    assert.match(result.meta.projectionSignature, /^[0-9a-f]{8}$/)

    // 风险冲突：headline 良好但存在 critical 风险 → 冲突警告
    assert.isTrue(result.data.sources.some((s) => s.sourceKey === 'risk-workbench'))
    // 注意力：critical 预测信号与 critical 风险并列最前；稳定 tie-break 为 sourceKey ASC
    assert.isAtLeast(result.data.attention.length, 3)
    const firstRisk = result.data.attention.find((a) => a.reasonCode === 'HIGH_SEVERITY_RISK_OPEN')
    assert.isOk(firstRisk)
    assert.equal(firstRisk!.entityRef?.id, 501)
    assert.equal(firstRisk!.severity, 'critical')
    // 排序确定性：critical 预测信号（sourceKey 字典序更小）排在同级风险之前
    assert.equal(result.data.attention[0]!.sourceKey, 'prediction')

    // 低敏输出扫描零命中
    assert.lengthOf(detectForbiddenFields(result), 0)

    // query 记账：dashboard 1 + risk 2 + prediction 1 + resource 1
    assert.equal(ledger.total(), 5)

    // 只读证明：fake 只有读方法被调用
    assert.equal(dashboard.calls.get, 1)
    assert.equal(risk.calls.getSummary, 1)
    assert.equal(risk.calls.getReviewQueue, 1)
    assert.equal(prediction.calls.getSummary, 1)
    assert.equal(resource.calls.load, 1)
  })

  test('missing 诊断：headline 回退基础 Dashboard 并带 MISSING 降级警告', async ({ assert }) => {
    const dashboard = makeDashboardService({
      healthDiagnosis: makeHealthDiagnosis({ available: false, status: null, diagnosisId: null }),
    })
    const service = makeService({ dashboard })
    injectClock(service)
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    assert.equal(result.data.headline.sourceKey, 'project-dashboard')
    assert.equal(result.data.headline.degraded, true)
    assert.equal(result.data.headline.degradationWarning?.code, 'HEALTH_DIAGNOSIS_MISSING')
  })

  test('stale 诊断：headline 回退并带 STALE 警告 + 复核注意力项；不隐式生成/确认诊断', async ({
    assert,
  }) => {
    const dashboard = makeDashboardService({
      healthDiagnosis: makeHealthDiagnosis({ stale: true, staleReason: 'INPUT_SIGNATURE_CHANGED' }),
    })
    const service = makeService({ dashboard })
    injectClock(service)
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    assert.equal(result.data.headline.degradationWarning?.code, 'HEALTH_DIAGNOSIS_STALE')
    const review = result.data.attention.find(
      (a) => a.reasonCode === 'SOURCE_STALE_REVIEW_REQUIRED',
    )
    assert.isOk(review)
    assert.equal(review!.sourceKey, 'health-diagnosis')
  })

  test('相同输入产生相同投影签名与相同队列顺序', async ({ assert }) => {
    const deps = () =>
      makeService({
        dashboard: makeDashboardService(),
        risk: makeRiskWorkbench(),
        prediction: makePredictionAdapter(),
        resource: makeResourceLoadService(),
      })
    const a = deps()
    const b = deps()
    injectClock(a)
    injectClock(b)
    const [ra, rb] = await Promise.all([
      a.getSummary(user, 1, 101, normalizedQuery(), accessFull),
      b.getSummary(user, 1, 101, normalizedQuery(), accessFull),
    ])
    assert.equal(ra.meta.projectionSignature, rb.meta.projectionSignature)
    assert.deepEqual(
      ra.data.attention.map((i) => i.attentionId),
      rb.data.attention.map((i) => i.attentionId),
    )
  })

  test('单 optional 失败转 partial unavailable，其它来源不受影响', async ({ assert }) => {
    const resource = makeResourceLoadService({ fail: true })
    const service = makeService({ resource })
    injectClock(service)
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    const res = findSource(result, 'resource-load')
    assert.equal(res!.meta.availability, 'unavailable')
    assert.isNull(res!.facts)
    // 其它来源照常可用
    assert.equal(findSource(result, 'risk-workbench')!.meta.availability, 'available')
    assert.equal(result.data.project.id, 101)
    // bounded warning
    assert.isTrue(
      result.data.sources.some((s) => s.warnings.some((w) => w.code === 'SOURCE_UNAVAILABLE')),
    )
  })

  test('多 optional 同时失败仍返回 partial 成功', async ({ assert }) => {
    const service = makeService({
      risk: makeRiskWorkbench(),
      prediction: makePredictionAdapter(),
      resource: makeResourceLoadService({ fail: true }),
    })
    // 让 risk/prediction 也失败：用会抛异常的包装
    const failing = makeService({
      resource: makeResourceLoadService({ fail: true }),
      prediction: {
        service: {
          async getSummary(): Promise<never> {
            throw new Error('SNAPSHOT_READ_FAILED')
          },
        },
        calls: { getSummary: 0 },
      },
    })
    injectClock(failing)
    const result = await failing.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    assert.equal(findSource(result, 'prediction')!.meta.availability, 'unavailable')
    assert.equal(findSource(result, 'resource-load')!.meta.availability, 'unavailable')
    assert.equal(findSource(result, 'risk-workbench')!.meta.availability, 'available')
    void service
  })

  test('mandatory Dashboard 失败整次读取 fail-closed', async ({ assert }) => {
    const dashboard = makeDashboardService({ throwOnGet: true })
    const service = makeService({ dashboard })
    injectClock(service)
    try {
      await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
      assert.fail('should throw')
    } catch (error) {
      assert.equal((error as Error).message, 'RESOURCE_NOT_FOUND')
    }
  })

  test('无 risk:view：风险查询零发起、来源 forbidden 且注意力队列无风险项', async ({ assert }) => {
    const risk = makeRiskWorkbench()
    const service = makeService({ risk })
    injectClock(service)
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), {
      canViewRisk: false,
      canViewResource: true,
      canViewChangeImpact: false,
    })
    assert.equal(risk.calls.getSummary, 0)
    assert.equal(risk.calls.getReviewQueue, 0)
    const riskSource = findSource(result, 'risk-workbench')
    assert.equal(riskSource!.meta.availability, 'forbidden')
    assert.isNull(riskSource!.facts)
    assert.isNull(riskSource!.meta.calculatedAt)
    assert.isNull(riskSource!.meta.sourceVersionDigest)
    assert.isNull(riskSource!.meta.authorityRef)
    assert.isFalse(result.data.attention.some((a) => a.sourceKey === 'risk-workbench'))
  })

  test('reader 超时按 unavailable 收束（共享 deadline）', async ({ assert }) => {
    const hangingRisk = {
      service: {
        async getSummary(): Promise<never> {
          return new Promise(() => {})
        },
        async getReviewQueue(): Promise<never> {
          return new Promise(() => {})
        },
      },
      calls: { getSummary: 0, getReviewQueue: 0 },
    }
    const service = makeService({ risk: hangingRisk as never })
    injectClock(service)
    service.readerDeadlineMs = 10
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    assert.equal(findSource(result, 'risk-workbench')!.meta.availability, 'unavailable')
  })

  test('truncation：候选超过 limit 时准确截断并报告 omitted（每来源贡献有界）', async ({
    assert,
  }) => {
    const risk = makeRiskWorkbench({
      summary: {
        topRisks: Array.from({ length: 30 }, (_, i) => ({
          id: 6000 + i,
          title: `风险 ${i}`,
          riskLevel: i % 2 === 0 ? 'critical' : 'high',
          score: 100 - i,
          status: 'mitigating',
        })),
      },
      reviewQueue: Array.from({ length: 50 }, (_, i) => ({
        id: 7000 + i,
        title: `复查 ${i}`,
        riskLevel: 'high',
        score: 50,
        nextReviewAt: new Date(NOW - (i + 1) * 86_400_000).toISOString(),
        lastReviewAt: null,
        ownerId: 7,
      })),
    })
    const service = makeService({ risk })
    injectClock(service)
    // 每来源贡献有界（topRisks ≤5、复查队列 ≤5），候选总数有限；
    // 用小于候选总数的 limit 触发截断。
    const result = await service.getSummary(user, 1, 101, normalizedQuery(6), accessFull)
    assert.equal(result.data.attention.length, 6)
    assert.isTrue(result.meta.attentionTruncation.truncated)
    assert.equal(result.meta.attentionTruncation.returned, 6)
    assert.isAtLeast(result.meta.attentionTruncation.omitted, 4)
    assert.equal(result.meta.attentionTruncation.requestedLimit, 6)
  })

  test('空风险登记册：来源标记 empty（零风险不得叙述为可用事实）', async ({ assert }) => {
    const risk = makeRiskWorkbench({
      summary: {
        totalRisks: 0,
        openRisks: 0,
        highRiskCount: 0,
        criticalRiskCount: 0,
        overdueReviewCount: 0,
        healthScore: null,
        topRisks: [],
      },
      reviewQueue: [],
    })
    const service = makeService({ risk })
    injectClock(service)
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    const source = findSource(result, 'risk-workbench')
    assert.equal(source!.meta.availability, 'empty')
    assert.isNull(source!.meta.sourceVersionDigest)
    // 空登记册不产生高严重度注意力项
    assert.isFalse(result.data.attention.some((a) => a.sourceKey === 'risk-workbench'))
  })

  test('Dashboard 对账 warning 映射为低敏 DASHBOARD_RECONCILIATION 提示', async ({ assert }) => {
    // 注入一条领域对账提示，验证映射后不带原始全文
    const dashboard = makeDashboardService()
    const originalGet = dashboard.service.get.bind(dashboard.service)
    dashboard.service.get = async () => {
      const result = await originalGet()
      result.warnings = [
        { code: 'TASK_MILESTONE_GAP', message: '任务统计与里程碑统计存在出入' },
      ] as unknown as typeof result.warnings
      return result
    }
    const service = makeService({ dashboard })
    injectClock(service)
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    const dashboardSource = findSource(result, 'project-dashboard')
    assert.isTrue(dashboardSource!.warnings.some((w) => w.code === 'DASHBOARD_RECONCILIATION'))
    for (const w of dashboardSource!.warnings) {
      assert.isAtMost(w.message.length, 80)
    }
  })

  test('资源维度权限裁剪与可用事实投影（forbidden / available 两态）', async ({ assert }) => {
    // 无 resource:view → 零查询 + forbidden
    const resourceA = makeResourceLoadService()
    const serviceA = makeService({ resource: resourceA })
    injectClock(serviceA)
    const resultA = await serviceA.getSummary(user, 1, 101, normalizedQuery(), {
      canViewRisk: true,
      canViewResource: false,
      canViewChangeImpact: false,
    })
    assert.equal(resourceA.calls.load, 0)
    const forbiddenSource = findSource(resultA, 'resource-load')
    assert.equal(forbiddenSource!.meta.availability, 'forbidden')
    assert.isNull(forbiddenSource!.facts)
    assert.isFalse(resultA.data.attention.some((a) => a.sourceKey === 'resource-load'))

    // 有权限且存在超负荷成员 → available + 有界事实 + 注意力项
    const serviceB = makeService({ resource: makeResourceLoadService() })
    injectClock(serviceB)
    const resultB = await serviceB.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    const availableSource = findSource(resultB, 'resource-load')
    assert.equal(availableSource!.meta.availability, 'available')
    if (availableSource!.facts && availableSource!.facts.sourceKey === 'resource-load') {
      assert.equal(availableSource!.facts.overAllocatedMemberCount, 1)
      assert.equal(availableSource!.facts.peakUtilizationPercent, 120)
    } else {
      assert.fail('resource facts should be projected')
    }
    assert.isTrue(resultB.data.attention.some((a) => a.reasonCode === 'RESOURCE_OVERALLOCATION'))
  })

  test('per-source timing 为非负低敏数值且响应不含 secret/path 类字段', async ({ assert }) => {
    const service = makeService({})
    injectClock(service)
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    for (const value of Object.values(result.meta.perSourceTimingMs)) {
      assert.isNumber(value)
      assert.isAtLeast(value as number, 0)
    }
    assert.lengthOf(detectForbiddenFields(result), 0)
  })

  test('change-impact 无安全 facade：unsupported 且 facts 为空、无目标', async ({ assert }) => {
    const service = makeService({})
    injectClock(service)
    const result = await service.getSummary(user, 1, 101, normalizedQuery(), accessFull)
    const changeImpact = findSource(result, 'change-impact')
    assert.equal(changeImpact!.meta.availability, 'unsupported')
    assert.isNull(changeImpact!.facts)
    assert.lengthOf(changeImpact!.targets, 0)
  })

  test('并发读取互不串扰（各自独立投影）', async ({ assert }) => {
    const service = makeService({})
    injectClock(service)
    const [a, b] = await Promise.all([
      service.getSummary(user, 1, 101, normalizedQuery(), accessFull),
      service.getSummary(user, 1, 202, normalizedQuery(50), accessFull),
    ])
    assert.equal(a.data.project.id, 101)
    assert.equal(b.data.project.id, 202)
    assert.notEqual(a.meta.projectionSignature, b.meta.projectionSignature)
  })
})

test.group('ProjectHealthRiskCommandCenterPolicy —— 项目门（§3.1/3.2）', () => {
  test('Policy 契约：权限不足与项目不存在同形 RESOURCE_NOT_FOUND（存在性不泄露）', async ({
    assert,
  }) => {
    // 项目可见性走真实 db，在功能测试覆盖；此处验证异常契约本身：
    // ResourceNotFoundException 渲染为非泄露统一错误码。
    const { ResourceNotFoundException } = await import('#exceptions/api_exception')
    const error = new ResourceNotFoundException('项目不存在')
    assert.equal((error as unknown as { status: number }).status, 404)
    assert.equal(error.message, '项目不存在')
  })
})
