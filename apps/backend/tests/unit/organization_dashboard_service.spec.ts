import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import OrganizationDashboardService, {
  type OrganizationDashboardProjectFact,
  type OrganizationDashboardReaders,
} from '#services/organization_dashboard_service'
import {
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
  ORGANIZATION_DASHBOARD_METRIC_VERSION,
  ORGANIZATION_DASHBOARD_SOURCES,
  ORGANIZATION_DASHBOARD_STATUSES,
  type OrganizationDashboardSummary,
} from '@aiproj/types'

const user = { id: 7, isSuperAdmin: false } as never

const ORGANIZATION = {
  organizationId: 1,
  name: '测试组织',
  slug: 'test-org',
  planTier: 'free',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const NOW = Date.now()
const iso = (offsetDays: number) => new Date(NOW + offsetDays * 24 * 60 * 60 * 1000).toISOString()

const PROJECTS: OrganizationDashboardProjectFact[] = [
  {
    id: 1,
    organizationId: 1,
    name: '核心平台',
    status: 'active',
    healthStatus: 'critical',
    progressPercent: 30,
    endDate: iso(-5), // 已延期
    updatedAt: iso(0),
    createdBy: 7,
  },
  {
    id: 2,
    organizationId: 1,
    name: '数据中台',
    status: 'active',
    healthStatus: 'healthy',
    progressPercent: 60,
    endDate: iso(3), // 临近截止
    updatedAt: iso(0),
    createdBy: 7,
  },
  {
    id: 3,
    organizationId: 1,
    name: '归档项目',
    status: 'archived',
    healthStatus: 'healthy',
    progressPercent: 100,
    endDate: iso(-90),
    updatedAt: iso(0),
    createdBy: 7,
  },
  {
    id: 4,
    organizationId: 1,
    name: '暂停项目',
    status: 'on_hold',
    healthStatus: 'at_risk',
    progressPercent: 10,
    endDate: null,
    updatedAt: iso(0),
    createdBy: 7,
  },
]

function makeReaders(
  overrides: Partial<OrganizationDashboardReaders> = {},
): OrganizationDashboardReaders {
  return {
    readOrganization: async () => ORGANIZATION,
    readVisibleProjects: async () => PROJECTS,
    readOverdueTasks: async () => [{ projectId: 1, overdueCount: 4, updatedAt: iso(0) }],
    readRiskSummary: async () => ({ openCount: 9, highCount: 3, updatedAt: iso(0) }),
    readMemberSummary: async () => ({
      totalMembers: 12,
      activeMembers: 12,
      roleCounts: [
        { role: 'owner', count: 1 },
        { role: 'member', count: 11 },
      ],
      updatedAt: iso(0),
    }),
    readResourceSummary: async () => ({
      allocatedProjectCount: 2,
      overloadedResourceCount: 1,
      totalAllocationPercent: 260,
      updatedAt: iso(0),
    }),
    readActivity: async (_org, _ids, limit) =>
      Array.from({ length: Math.min(limit, 3) }, (_value, index) => ({
        id: 100 + index,
        action: 'project.updated',
        entityType: 'project',
        severity: 'info',
        projectId: 1,
        occurredAt: iso(0),
      })),
    readPmoSummary: async () => ({
      available: true,
      totalProjects: 4,
      atRiskProjects: 2,
      overallProgressAvg: 50,
      lastUpdatedAt: iso(0),
    }),
    ...overrides,
  }
}

function metric(summary: OrganizationDashboardSummary, key: string) {
  return summary.kpis.find((item) => item.key === key)
}

function warningCodes(summary: OrganizationDashboardSummary): string[] {
  return summary.warnings.map((warning) => warning.code)
}

test.group('OrganizationDashboardService —— 授权聚合', () => {
  test('返回稳定 meta、KPI、分布与待关注项目', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1)

    assert.equal(summary.meta.metricVersion, ORGANIZATION_DASHBOARD_METRIC_VERSION)
    assert.equal(summary.meta.organizationId, 1)
    assert.equal(summary.meta.actorId, 7)
    assert.equal(summary.meta.visibleProjectCount, 4)
    assert.equal(summary.organization.name, '测试组织')

    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS)?.value, 4)
    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS)?.value, 2)
    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.ARCHIVED_PROJECTS)?.value, 1)
    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECTS)?.value, 1)
    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.DUE_SOON_PROJECTS)?.value, 1)
    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT)?.value, 3)
    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL)?.value, 12)

    const distributionTotal = summary.statusDistribution.reduce(
      (sum, slice) => sum + slice.count,
      0,
    )
    assert.equal(distributionTotal, 4)

    // 待关注：核心平台（critical + overdue）、数据中台（due_soon）、暂停项目（at_risk + on_hold）
    assert.equal(summary.attentionProjects.length, 3)
    assert.equal(summary.attentionProjects[0].projectId, 1)
    assert.includeMembers(summary.attentionProjects[0].reasons, ['health_critical', 'overdue'])
    assert.equal(summary.attentionProjects[0].overdueTaskCount, 4)
    assert.equal(summary.attentionProjects[0].target?.href, '/projects/1')
  })

  test('相同输入产生相同 inputSignatureHash（确定性）', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const first = await service.getSummary(user, 1)
    const second = await service.getSummary(user, 1)
    assert.equal(first.meta.inputSignatureHash, second.meta.inputSignatureHash)
  })

  test('attentionLimit 生效且被上限约束', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const limited = await service.getSummary(user, 1, { attentionLimit: 1 })
    assert.equal(limited.attentionProjects.length, 1)
    assert.equal(limited.meta.attentionLimit, 1)

    const clamped = await service.getSummary(user, 1, { attentionLimit: 999 })
    assert.equal(clamped.meta.attentionLimit, 20)
  })

  test('section 白名单裁剪聚合范围', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1, { sections: ['kpi'] })
    assert.deepEqual(summary.meta.sections, ['kpi'])
    assert.isEmpty(summary.attentionProjects)
    assert.isEmpty(summary.statusDistribution)
    assert.isEmpty(summary.recentActivity)
    assert.isEmpty(summary.riskReminders)
    assert.isFalse(summary.pmoEntry.available)
  })

  test('filter 与 search 收窄可见项目集合', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const filtered = await service.getSummary(user, 1, { filterStatus: 'active' })
    assert.equal(filtered.meta.visibleProjectCount, 2)

    const searched = await service.getSummary(user, 1, { search: '数据' })
    assert.equal(searched.meta.visibleProjectCount, 1)
  })

  test('构造低敏 read audit envelope，不含证据文本或凭据', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1)
    const audit = service.buildReadAudit(summary)

    assert.equal(audit.actorId, 7)
    assert.equal(audit.organizationId, 1)
    assert.isAbove(audit.metricKeys.length, 0)
    assert.isAbove(audit.sourceFreshnessHashes.length, 0)
    const serialized = JSON.stringify(audit)
    assert.notMatch(serialized, /prompt|Authorization|Bearer|accessToken|apiKey/i)
    assert.notInclude(serialized, '核心平台')
  })
})

test.group('OrganizationDashboardService —— 组织隔离与空组织', () => {
  test('跨组织项目被过滤，不进入任何聚合', async ({ assert }) => {
    const service = new OrganizationDashboardService(
      makeReaders({
        readVisibleProjects: async () => [
          ...PROJECTS,
          {
            id: 99,
            organizationId: 2,
            name: '跨组织机密项目',
            status: 'active',
            healthStatus: 'critical',
            progressPercent: 0,
            endDate: iso(-1),
            updatedAt: iso(0),
            createdBy: 99,
          },
        ],
      }),
    )
    const summary = await service.getSummary(user, 1)
    assert.equal(summary.meta.visibleProjectCount, 4)
    assert.notInclude(JSON.stringify(summary), '跨组织机密项目')
    assert.notInclude(JSON.stringify(summary), '/projects/99')
  })

  test('空组织返回零计数、空列表与 EMPTY_ORGANIZATION_DASHBOARD warning', async ({ assert }) => {
    const service = new OrganizationDashboardService(
      makeReaders({ readVisibleProjects: async () => [] }),
    )
    const summary = await service.getSummary(user, 1)

    assert.equal(summary.meta.visibleProjectCount, 0)
    assert.isEmpty(summary.attentionProjects)
    assert.isEmpty(summary.recentActivity)
    assert.isEmpty(summary.riskReminders)
    assert.include(warningCodes(summary), 'EMPTY_ORGANIZATION_DASHBOARD')
    assert.isTrue(summary.kpis.every((item) => item.value === 0))
  })
})

test.group('OrganizationDashboardService —— 维度脱敏', () => {
  test('风险/资源权限不足时返回低敏 unavailable，不泄露计数与 target', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(
      user,
      1,
      {},
      { canViewRisks: false, canViewResources: false },
    )

    assert.isTrue(summary.resourceOverview.forbidden)
    assert.isNull(summary.resourceOverview.overloadedResourceCount)
    assert.isNull(summary.resourceOverview.totalAllocationPercent)
    assert.isNull(summary.resourceOverview.target)
    assert.isTrue(summary.riskReminders.every((reminder) => reminder.count === null))
    assert.isTrue(summary.riskReminders.every((reminder) => reminder.target === null))
    assert.equal(
      metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT)?.status,
      ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
    )
    assert.isNull(
      metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT)?.value ?? null,
    )
    assert.include(warningCodes(summary), 'PERMISSION_REDACTED')
    // 不得出现真实计数
    assert.notInclude(JSON.stringify(summary.riskReminders), '"count":3')
  })

  test('成员权限不足时不返回成员数量与角色分布', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1, {}, { canViewMembers: false })
    assert.isTrue(summary.memberOverview.forbidden)
    assert.isNull(summary.memberOverview.totalMembers)
    assert.isEmpty(summary.memberOverview.roleDistribution)
    assert.notInclude(JSON.stringify(summary.memberOverview), '12')
  })

  test('活动权限不足时活动流为空且指标脱敏', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1, {}, { canViewActivity: false })
    assert.isEmpty(summary.recentActivity)
    assert.equal(
      metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.RECENT_ACTIVITY_COUNT)?.status,
      ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
    )
  })

  test('活动流不含实体名称、变更内容或跨项目引用', async ({ assert }) => {
    const service = new OrganizationDashboardService(
      makeReaders({
        readActivity: async () => [
          {
            id: 1,
            action: 'project.updated',
            entityType: 'project',
            severity: 'info',
            projectId: 1,
            occurredAt: iso(0),
          },
          {
            id: 2,
            action: 'risk.created',
            entityType: 'risk',
            severity: 'warning',
            projectId: 999, // 不可见项目
            occurredAt: iso(0),
          },
        ],
      }),
    )
    const summary = await service.getSummary(user, 1)
    assert.equal(summary.recentActivity.length, 1)
    assert.equal(summary.recentActivity[0].projectId, 1)
    assert.notProperty(summary.recentActivity[0], 'changes')
    assert.notProperty(summary.recentActivity[0], 'metadata')
  })
})

test.group('OrganizationDashboardService —— PMO 降级与财务不支持', () => {
  test('PMO 权限不足返回 PMO_SUMMARY_FORBIDDEN 且其余数据照常返回', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1, {}, { canViewPmo: false })

    assert.isTrue(summary.pmoEntry.forbidden)
    assert.isNull(summary.pmoEntry.summary)
    assert.isEmpty(summary.pmoEntry.targets)
    assert.include(warningCodes(summary), 'PMO_SUMMARY_FORBIDDEN')
    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS)?.value, 4)
  })

  test('PMO 源不可用返回 PMO_SUMMARY_UNAVAILABLE 而非整页失败', async ({ assert }) => {
    const service = new OrganizationDashboardService(
      makeReaders({
        readPmoSummary: async () => {
          throw new Error('PMO source down')
        },
      }),
    )
    const summary = await service.getSummary(user, 1)
    assert.isFalse(summary.pmoEntry.available)
    assert.isFalse(summary.pmoEntry.forbidden)
    assert.include(warningCodes(summary), 'PMO_SUMMARY_UNAVAILABLE')
    assert.equal(summary.meta.visibleProjectCount, 4)
  })

  test('PMO 可用时只返回低敏摘要与导航 target', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1)
    assert.isTrue(summary.pmoEntry.available)
    assert.deepEqual(summary.pmoEntry.summary, {
      totalProjects: 4,
      atRiskProjects: 2,
      overallProgressAvg: 50,
    })
    assert.equal(summary.pmoEntry.targets[0].href, '/pmo')
  })

  test('命中预算/ROI 关键词只返回 unsupported warning，不造财务数值', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1, { search: 'roi 预算' })
    assert.include(warningCodes(summary), 'FINANCIAL_UNSUPPORTED')
    assert.isUndefined(
      summary.kpis.find(
        (item) => String(item.key).includes('budget') || String(item.key).includes('roi'),
      ),
    )
  })
})

test.group('OrganizationDashboardService —— freshness / stale', () => {
  test('超过新鲜度阈值的来源被标记 stale 并产生 warning', async ({ assert }) => {
    const service = new OrganizationDashboardService(
      makeReaders({
        readActivity: async () => [
          {
            id: 1,
            action: 'project.updated',
            entityType: 'project',
            severity: 'info',
            projectId: 1,
            occurredAt: iso(-7), // 7 天前
          },
        ],
      }),
    )
    const summary = await service.getSummary(user, 1, { freshnessWindowMinutes: 60 })
    const activity = summary.sourceFreshness.find(
      (item) => item.source === ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG,
    )
    assert.isTrue(activity?.isStale)
    assert.equal(activity?.status, ORGANIZATION_DASHBOARD_STATUSES.STALE)
    assert.include(warningCodes(summary), 'SOURCE_STALE')
    assert.isAbove(
      Number(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.STALE_SOURCE_COUNT)?.value ?? 0),
      0,
    )
  })

  test('forbidden 来源标记 forbidden 而非 stale', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    const summary = await service.getSummary(user, 1, {}, { canViewRisks: false })
    const risk = summary.sourceFreshness.find(
      (item) => item.source === ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
    )
    assert.equal(risk?.status, ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN)
    assert.isFalse(risk?.isStale)
  })

  test('可选缓存不可用时提供显式降级 warning', async ({ assert }) => {
    const service = new OrganizationDashboardService(makeReaders())
    assert.equal(service.cacheDegradedWarning().code, 'CACHE_DEGRADED')
  })
})

test.group('OrganizationDashboardService —— 无副作用与性能门禁', () => {
  const SERVICE_SOURCE = readFileSync(
    fileURLToPath(new URL('../../app/services/organization_dashboard_service.ts', import.meta.url)),
    'utf8',
  )
  /** 剥离注释后的可执行代码——注释里出现「不调用 Webhook」这类描述不应被误判为副作用。 */
  const SERVICE_CODE = SERVICE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  test('取证扫描器自身可用（正向 + 反向对照）', ({ assert }) => {
    // 正向对照：扫描器必须能在剥离注释后的代码里命中已知存在的调用点，
    // 否则「零命中」只是读错文件或正则吃掉了全部内容的假阳性。
    assert.isAbove(SERVICE_CODE.length, 1000)
    // 4 处组织隔离过滤：项目 / 风险 / 组织成员 / 审计活动查询各一次。
    assert.equal(SERVICE_CODE.match(/organization_id/g)?.length, 4)
    assert.include(SERVICE_CODE, 'async getSummary(')
    assert.include(SERVICE_CODE, "await import('#models/project')")
    // 注释确实被剥离（原文有、代码里无）。
    assert.include(SERVICE_SOURCE, '不发 Webhook/Web Push')
    assert.notInclude(SERVICE_CODE, '不发 Webhook/Web Push')
    // 反向对照：确认 notInclude 断言确实能判定「不存在」。
    assert.notInclude(SERVICE_CODE, 'THIS_TOKEN_MUST_NOT_EXIST_IN_SOURCE')
  })

  test('读路径代码不引用 AI / Compiler / 外发 / OAuth / 写库 API', ({ assert }) => {
    const forbidden = [
      'AIGateway',
      'ai_gateway',
      'CompilerRun',
      'compiler_run',
      'compiler_service',
      'webhook',
      'Webhook',
      'WebPush',
      'push_service',
      'oauth',
      'OAuth',
      '.save(',
      '.create(',
      '.update(',
      '.delete(',
      'refreshPrediction',
      'refreshHealth',
    ]
    for (const token of forbidden) {
      assert.notInclude(SERVICE_CODE, token, `读路径不得出现 ${token}`)
    }
  })

  test('聚合调用只触发读取 reader，不触发任何写入回调', async ({ assert }) => {
    const calls: string[] = []
    const service = new OrganizationDashboardService(
      makeReaders({
        readOrganization: async () => {
          calls.push('readOrganization')
          return ORGANIZATION
        },
        readVisibleProjects: async () => {
          calls.push('readVisibleProjects')
          return PROJECTS
        },
        readActivity: async () => {
          calls.push('readActivity')
          return []
        },
      }),
    )
    await service.getSummary(user, 1)
    assert.deepEqual([...new Set(calls)].sort(), [
      'readActivity',
      'readOrganization',
      'readVisibleProjects',
    ])
    assert.isTrue(calls.every((name) => name.startsWith('read')))
  })

  test('1000 项目组织聚合在阈值内完成（性能门禁）', async ({ assert }) => {
    const large: OrganizationDashboardProjectFact[] = Array.from(
      { length: 1000 },
      (_value, index) => ({
        id: index + 1,
        organizationId: 1,
        name: `项目-${index + 1}`,
        status: index % 3 === 0 ? 'active' : index % 3 === 1 ? 'on_hold' : 'completed',
        healthStatus: index % 5 === 0 ? 'critical' : index % 5 === 1 ? 'at_risk' : 'healthy',
        progressPercent: index % 101,
        endDate: index % 7 === 0 ? iso(-2) : iso(30),
        updatedAt: iso(0),
        createdBy: 7,
      }),
    )
    const service = new OrganizationDashboardService(
      makeReaders({
        readVisibleProjects: async () => large,
        readOverdueTasks: async () => [],
      }),
    )

    const startedAt = Date.now()
    const summary = await service.getSummary(user, 1)
    const elapsedMs = Date.now() - startedAt

    // 阈值 1500ms（本机 SQLite 友好），超出即输出显式性能证据并失败。
    assert.isBelow(elapsedMs, 1500, `1000 项目聚合耗时 ${elapsedMs}ms，超过 1500ms 阈值`)
    assert.equal(summary.meta.visibleProjectCount, 1000)
    assert.equal(summary.attentionProjects.length, 5)
    assert.equal(metric(summary, ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS)?.value, 1000)
  })
})
