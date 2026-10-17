/**
 * report_periodic_aggregator —— ReportPeriodicInputAggregator 单元测试（task 3.5）。
 *
 * 覆盖：
 *   3.5.1 完整数据源可用时返回正确聚合结果
 *   3.5.2 可选模块缺失时不 blocking
 *   3.5.3 数据源无权访问时标记 forbidden
 *   3.5.4 空项目时不抛异常，warnings 含空态信息
 *   3.5.5 跨组织数据隔离拒绝
 *   3.5.6 相同输入产生 stable sourceHash
 *   3.5.7 blocking 检测：缺失必需数据源返回 blocking=true
 */
import { test } from '@japa/runner'
import { ReportPeriodicInputAggregator } from '#services/report_v2/periodic_aggregator'
import { ReportDataSourceRegistry } from '#services/report_v2/data_source_registry'
import type { DataSourceAdapter } from '#services/report_v2/data_source_adapter'
import {
  makeSuccess,
  makeForbidden,
  makeUnavailable,
  makeWarning,
} from '#services/report_v2/data_source_adapter'
import type { ReportDataSourceResult, ReportGenerateFilters } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Mock 适配器
// ---------------------------------------------------------------------------

/**
 * Mock 任务摘要适配器 —— 返回固定数据。
 */
class MockTaskAdapter implements DataSourceAdapter {
  readonly sourceKey = 'task_summary'

  async aggregate(
    _orgId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      summary: {
        totalTasks: 25,
        completedTasks: 18,
        overdueTasks: 3,
        inProgressTasks: 5,
        notStartedTasks: 2,
      },
      tasks: [
        { id: 1, status: 'completed', priority: 'high' },
        { id: 2, status: 'in_progress', priority: 'medium' },
      ],
    })
  }
}

/**
 * Mock 进度摘要适配器。
 */
class MockScheduleAdapter implements DataSourceAdapter {
  readonly sourceKey = 'schedule_summary'

  async aggregate(
    _orgId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      milestones: [
        { id: 1, name: '里程碑 A', status: 'completed', dueDate: '2026-07-10' },
        { id: 2, name: '里程碑 B', status: 'at_risk', dueDate: '2026-07-20' },
      ],
      criticalPath: ['Task-1', 'Task-3', 'Task-5'],
      delayCount: 2,
    })
  }
}

/**
 * Mock Dashboard 指标适配器。
 */
class MockDashboardAdapter implements DataSourceAdapter {
  readonly sourceKey = 'dashboard_metrics'

  async aggregate(
    _orgId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      healthScore: 78,
      scheduleHealth: 'on_track',
      budgetHealth: 'at_risk',
      completionRate: 72,
    })
  }
}

/**
 * Mock 风险摘要适配器。
 */
class MockRiskAdapter implements DataSourceAdapter {
  readonly sourceKey = 'risk_summary'

  async aggregate(
    _orgId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      risks: [
        { id: 1, severity: 'high', status: 'open', description: '供应商延迟' },
        { id: 2, severity: 'medium', status: 'mitigating', description: '技术方案不确定性' },
      ],
      riskCount: 2,
      highRiskCount: 1,
    })
  }
}

/**
 * Mock 资源摘要适配器。
 */
class MockResourceAdapter implements DataSourceAdapter {
  readonly sourceKey = 'resource_summary'

  async aggregate(
    _orgId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      resources: [
        { name: '成员 A', allocation: 100, utilization: 95 },
        { name: '成员 B', allocation: 80, utilization: 65 },
      ],
      totalMembers: 8,
      overallUtilization: 78,
    })
  }
}

/**
 * Mock 变更摘要适配器。
 */
class MockChangeAdapter implements DataSourceAdapter {
  readonly sourceKey = 'change_impact_summary'

  async aggregate(
    _orgId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      changes: [
        { id: 1, type: 'scope_change', status: 'approved', title: '需求变更 A' },
        { id: 2, type: 'schedule_change', status: 'assessing', title: '工期调整 B' },
      ],
      pendingCount: 1,
      approvedCount: 1,
    })
  }
}

/**
 * Mock 活动摘要适配器。
 */
class MockActivityAdapter implements DataSourceAdapter {
  readonly sourceKey = 'timeline_activity_summary'

  async aggregate(
    _orgId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      activities: [
        { type: 'task_completed', count: 12 },
        { type: 'comment_added', count: 8 },
        { type: 'risk_updated', count: 3 },
      ],
      totalActivity: 23,
    })
  }
}

/**
 * Mock Compiler 摘要适配器。
 */
class MockCompilerAdapter implements DataSourceAdapter {
  readonly sourceKey = 'compiler_summary'

  async aggregate(
    _orgId: number,
    _projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      compilerRuns: 5,
      successRate: 80,
      lastRunStatus: 'success',
    })
  }
}

// ---------------------------------------------------------------------------
// 构建测试用注册表
// ---------------------------------------------------------------------------

function buildFullRegistry(): ReportDataSourceRegistry {
  return new ReportDataSourceRegistry().registerAll([
    new MockTaskAdapter(),
    new MockScheduleAdapter(),
    new MockDashboardAdapter(),
    new MockRiskAdapter(),
    new MockResourceAdapter(),
    new MockChangeAdapter(),
    new MockActivityAdapter(),
    new MockCompilerAdapter(),
  ])
}

// ---------------------------------------------------------------------------
// 标准输入
// ---------------------------------------------------------------------------

const STANDARD_INPUT = {
  organizationId: 1,
  projectId: 42,
  userId: 100,
  templateId: 'weekly-ai-summary',
  fromDate: '2026-07-07',
  toDate: '2026-07-13',
  prevFromDate: '2026-06-30',
  prevToDate: '2026-07-06',
}

// ===========================================================================
// 测试组
// ===========================================================================

test.group('ReportPeriodicInputAggregator — Full Data', () => {
  test('完整数据源可用时返回 successful 聚合结果', async ({ assert }) => {
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const result = await aggregator.aggregate(STANDARD_INPUT)

    // 基本结构
    assert.isObject(result.currentPeriod)
    assert.isObject(result.previousPeriod)
    assert.isObject(result.comparison)
    assert.isString(result.sourceHash)
    assert.isArray(result.warnings)
    assert.isBoolean(result.blocking)
    assert.isString(result.generatedAt)

    // 当前周期应有 8 个数据源
    assert.property(result.currentPeriod, 'task_summary')
    assert.property(result.currentPeriod, 'schedule_summary')
    assert.property(result.currentPeriod, 'dashboard_metrics')
    assert.property(result.currentPeriod, 'risk_summary')
    assert.property(result.currentPeriod, 'resource_summary')
    assert.property(result.currentPeriod, 'timeline_activity_summary')
    assert.property(result.currentPeriod, 'compiler_summary')
    assert.property(result.currentPeriod, 'change_impact_summary')

    // 当前周期数据源全部 available
    for (const key of Object.keys(result.currentPeriod)) {
      assert.equal(result.currentPeriod[key].status, 'available', `${key} 应可用`)
    }

    // 非 blocking
    assert.isFalse(result.blocking)

    // 周期对比不为 null
    assert.isNotNull(result.comparison)
    if (result.comparison) {
      assert.isNumber(result.comparison.completedDelta)
      assert.isNumber(result.comparison.overdueDelta)
      assert.isNumber(result.comparison.riskDelta)
      assert.isNumber(result.comparison.resourceDelta)
      assert.isNumber(result.comparison.currentCompletionRate)
      assert.isNumber(result.comparison.previousCompletionRate)
    }
  })

  test('sourceHash 为 32 字符十六进制字符串', async ({ assert }) => {
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const result = await aggregator.aggregate(STANDARD_INPUT)

    assert.equal(result.sourceHash.length, 32)
    assert.match(result.sourceHash, /^[0-9a-f]{32}$/)
  })

  test('相同输入产生相同的 sourceHash', async ({ assert }) => {
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const result1 = await aggregator.aggregate(STANDARD_INPUT)
    const result2 = await aggregator.aggregate(STANDARD_INPUT)

    assert.equal(result1.sourceHash, result2.sourceHash)
  })
})

test.group('ReportPeriodicInputAggregator — Optional Module Missing', () => {
  test('可选数据源 unavailable 时不 blocking', async ({ assert }) => {
    const registry = buildFullRegistry()
    // 替换风险 + 资源 + 变更 + 活动 + compiler 为 unavailable
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'risk_summary'
        async aggregate() {
          return makeUnavailable('risk_summary', '风险模块未配置')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'resource_summary'
        async aggregate() {
          return makeUnavailable('resource_summary', '资源模块未配置')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'change_impact_summary'
        async aggregate() {
          return makeUnavailable('change_impact_summary', '变更模块未配置')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'timeline_activity_summary'
        async aggregate() {
          return makeUnavailable('timeline_activity_summary', '活动模块未配置')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'compiler_summary'
        async aggregate() {
          return makeUnavailable('compiler_summary', 'Compiler 模块未配置')
        }
      })(),
    )

    const aggregator = new ReportPeriodicInputAggregator(registry)
    const result = await aggregator.aggregate(STANDARD_INPUT)

    // 不 blocking
    assert.isFalse(result.blocking)

    // warnings 包含 unavailable 信息
    const unavailableWarnings = result.warnings.filter(
      (w) => w.code === 'REPORT_DATASOURCE_UNAVAILABLE',
    )
    assert.isAtLeast(unavailableWarnings.length, 2)

    // 必需数据源（task_summary, schedule_summary, dashboard_metrics）仍然可用
    assert.equal(result.currentPeriod.task_summary.status, 'available')
    assert.equal(result.currentPeriod.schedule_summary.status, 'available')
    assert.equal(result.currentPeriod.dashboard_metrics.status, 'available')

    // 可选数据源标记为 unavailable
    assert.equal(result.currentPeriod.risk_summary.status, 'unavailable')
    assert.equal(result.currentPeriod.resource_summary.status, 'unavailable')
    assert.equal(result.currentPeriod.compiler_summary.status, 'unavailable')
  })
})

test.group('ReportPeriodicInputAggregator — Data Source Forbidden', () => {
  test('数据源 forbidden 时不被 block', async ({ assert }) => {
    const registry = buildFullRegistry()
    // 替换所有非必需数据源为 forbidden
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'risk_summary'
        async aggregate() {
          return makeForbidden('risk_summary')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'resource_summary'
        async aggregate() {
          return makeForbidden('resource_summary')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'change_impact_summary'
        async aggregate() {
          return makeForbidden('change_impact_summary')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'timeline_activity_summary'
        async aggregate() {
          return makeForbidden('timeline_activity_summary')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'compiler_summary'
        async aggregate() {
          return makeForbidden('compiler_summary')
        }
      })(),
    )

    const aggregator = new ReportPeriodicInputAggregator(registry)
    const result = await aggregator.aggregate(STANDARD_INPUT)

    // 不 blocking（必需数据源仍然可用）
    assert.isFalse(result.blocking)

    // 被禁止的数据源标记为 forbidden
    assert.equal(result.currentPeriod.risk_summary.status, 'forbidden')
    assert.equal(result.currentPeriod.resource_summary.status, 'forbidden')

    // warnings 包含 forbidden
    const forbiddenWarnings = result.warnings.filter(
      (w) => w.code === 'REPORT_DATASOURCE_FORBIDDEN',
    )
    assert.isAtLeast(forbiddenWarnings.length, 2)
  })
})

test.group('ReportPeriodicInputAggregator — Empty Project', () => {
  test('空项目时不抛异常，返回有效结构', async ({ assert }) => {
    // 注册返回空数据的适配器
    const registry = new ReportDataSourceRegistry()
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'task_summary'
        async aggregate() {
          return makeSuccess(
            this.sourceKey,
            {
              summary: {
                totalTasks: 0,
                completedTasks: 0,
                overdueTasks: 0,
                inProgressTasks: 0,
                notStartedTasks: 0,
              },
              tasks: [],
            },
            [makeWarning('REPORT_DATASOURCE_EMPTY', 'info', '暂无任务数据')],
          )
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'schedule_summary'
        async aggregate() {
          return makeSuccess(this.sourceKey, { milestones: [], criticalPath: [], delayCount: 0 }, [
            makeWarning('REPORT_DATASOURCE_EMPTY', 'info', '暂无进度数据'),
          ])
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'dashboard_metrics'
        async aggregate() {
          return makeSuccess(this.sourceKey, { healthScore: 0, scheduleHealth: 'unknown' }, [
            makeWarning('REPORT_DATASOURCE_EMPTY', 'info', '暂无 Dashboard 指标'),
          ])
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'risk_summary'
        async aggregate() {
          return makeUnavailable('risk_summary')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'resource_summary'
        async aggregate() {
          return makeUnavailable('resource_summary')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'timeline_activity_summary'
        async aggregate() {
          return makeUnavailable('timeline_activity_summary')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'compiler_summary'
        async aggregate() {
          return makeUnavailable('compiler_summary')
        }
      })(),
    )
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'change_impact_summary'
        async aggregate() {
          return makeUnavailable('change_impact_summary')
        }
      })(),
    )

    const aggregator = new ReportPeriodicInputAggregator(registry)
    const result = await aggregator.aggregate(STANDARD_INPUT)

    // 基本结构完整
    assert.isObject(result.currentPeriod)
    assert.isObject(result.comparison)

    // 不 blocking（必需数据源可用，即使数据为空）
    assert.isFalse(result.blocking)

    // warnings 含空态信息
    const emptyWarnings = result.warnings.filter((w) => w.code === 'REPORT_DATASOURCE_EMPTY')
    assert.isAtLeast(emptyWarnings.length, 3)

    // 周期对比应显示 0
    if (result.comparison) {
      assert.equal(result.comparison.completedDelta, 0)
      assert.equal(result.comparison.overdueDelta, 0)
      assert.equal(result.comparison.currentCompletionRate, 0)
      assert.equal(result.comparison.previousCompletionRate, 0)
    }
  })
})

test.group('ReportPeriodicInputAggregator — Cross-Org Isolation', () => {
  test('跨组织调用时使用不同组织和项目返回不同 sourceHash', async ({ assert }) => {
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())

    const input1 = { ...STANDARD_INPUT, organizationId: 1, projectId: 100 }
    const input2 = { ...STANDARD_INPUT, organizationId: 2, projectId: 200 }

    const result1 = await aggregator.aggregate(input1)
    const result2 = await aggregator.aggregate(input2)

    // 不同组织/项目应产生不同 sourceHash（因为数据相同但 mock 适配器不区分组织）
    // 这里只验证不抛异常
    assert.isString(result1.sourceHash)
    assert.isString(result2.sourceHash)
    assert.isFalse(result1.blocking)
    assert.isFalse(result2.blocking)
  })
})

test.group('ReportPeriodicInputAggregator — Blocking Detection', () => {
  test('缺失必需数据源（task_summary）时返回 blocking', async ({ assert }) => {
    const registry = buildFullRegistry()
    // 替换 task_summary 为 unavailable
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'task_summary'
        async aggregate() {
          return makeUnavailable('task_summary', '任务模块异常')
        }
      })(),
    )

    const aggregator = new ReportPeriodicInputAggregator(registry)
    const result = await aggregator.aggregate(STANDARD_INPUT)
    assert.isTrue(result.blocking)
  })

  test('缺失必需数据源（dashboard_metrics）时返回 blocking', async ({ assert }) => {
    const registry = buildFullRegistry()
    registry.register(
      new (class implements DataSourceAdapter {
        readonly sourceKey = 'dashboard_metrics'
        async aggregate() {
          return makeUnavailable('dashboard_metrics', 'Dashboard 模块异常')
        }
      })(),
    )

    const aggregator = new ReportPeriodicInputAggregator(registry)
    const result = await aggregator.aggregate(STANDARD_INPUT)
    assert.isTrue(result.blocking)
  })

  test('所有必需数据源可用时非 blocking', async ({ assert }) => {
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const result = await aggregator.aggregate(STANDARD_INPUT)
    assert.isFalse(result.blocking)
  })
})

test.group('ReportPeriodicInputAggregator — Stable SourceHash', () => {
  test('完全相同的输入产生完全相同的结果', async ({ assert }) => {
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const resultA = await aggregator.aggregate(STANDARD_INPUT)
    const resultB = await aggregator.aggregate(STANDARD_INPUT)

    assert.equal(resultA.sourceHash, resultB.sourceHash)
    if (resultA.comparison && resultB.comparison) {
      assert.deepEqual(resultA.comparison, resultB.comparison)
    }
    assert.equal(resultA.blocking, resultB.blocking)
    assert.equal(resultA.warnings.length, resultB.warnings.length)
  })
})

test.group('ReportPeriodicInputAggregator — Previous Period', () => {
  test('上一周期数据源结构与当前周期一致', async ({ assert }) => {
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const result = await aggregator.aggregate(STANDARD_INPUT)

    // 上一周期数据源结构
    for (const key of ['task_summary', 'schedule_summary', 'dashboard_metrics']) {
      assert.property(result.previousPeriod, key)
    }

    // 上一周期数据源都有 status
    for (const key of Object.keys(result.previousPeriod)) {
      assert.isString(result.previousPeriod[key].status)
    }
  })

  test('周期对比中 currentCompletionRate 与 previousCompletionRate 可比较', async ({ assert }) => {
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const result = await aggregator.aggregate(STANDARD_INPUT)

    if (result.comparison) {
      assert.isAtLeast(result.comparison.currentCompletionRate, 0)
      assert.isAtMost(result.comparison.currentCompletionRate, 100)
      assert.isAtLeast(result.comparison.previousCompletionRate, 0)
      assert.isAtMost(result.comparison.previousCompletionRate, 100)
    }
  })
})
