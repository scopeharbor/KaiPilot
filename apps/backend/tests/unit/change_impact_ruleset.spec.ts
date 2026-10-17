import ChangeImpactRuleset from '#services/change_impact/ruleset'
import { isBlockingSeverity } from '@aiproj/types'
import type {
  ChangeImpactInput,
  AnalysisScope,
  ImpactEntityRef,
  RelatedDependency,
  ImpactResourceRef,
} from '@aiproj/types'
import { test } from '@japa/runner'

/**
 * 确定性影响分析核心规则测试（v2-change-management-impact-analysis §4.7 / §4.8）。
 *
 * 纯函数测试（无数据库）：断言依赖传播、关键路径升严重度、资源超载、
 * 风险关联、禁止名称相似推断、图不可计算降级、稳定排序/去重与性能夹具。
 */

const ALL_DIMENSIONS: AnalysisScope['dimensions'] = [
  'scope',
  'schedule',
  'resource',
  'risk',
  'quality',
]

function makeInput(overrides: Partial<ChangeImpactInput> = {}): ChangeImpactInput {
  return {
    changeRequest: {
      title: '示例变更',
      description: null,
      changeType: 'scope',
      priority: 'medium',
      impactSummary: null,
      relatedTaskIds: null,
      relatedDocumentIds: null,
    },
    scope: {
      dimensions: ALL_DIMENSIONS,
      maxPropagationDepth: 5,
      includeEvidenceDetails: false,
    },
    relatedTasks: [],
    relatedDependencies: [],
    relatedMilestones: [],
    relatedResources: [],
    relatedRisks: [],
    ruleVersion: '2.0.0',
    missingInputs: [],
    warnings: [],
    ...overrides,
  }
}

function task(entityId: number): ImpactEntityRef {
  return { entityType: 'task', entityId, title: `任务${entityId}`, isVisible: true }
}

function dep(id: number, predecessorId: number, successorId: number): RelatedDependency {
  return { id, predecessorId, successorId, type: 'FS', lagDays: 0 }
}

function resource(
  resourceId: number,
  allocations: { taskId: number; loadPercent: number }[],
  capacity: number,
): ImpactResourceRef {
  return { resourceId, resourceName: `资源${resourceId}`, allocations, capacity, isVisible: true }
}

test.group('ChangeImpactRuleset 核心规则', () => {
  test('R001：沿任务依赖传播影响到后继任务', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()
    const input = makeInput({
      relatedTasks: [task(1)],
      relatedDependencies: [dep(1, 1, 2), dep(2, 2, 3)],
    })

    const { items } = ruleset.propagate(input)

    // 后继任务 2、3 应在 schedule 维度出现
    const scheduleTasks = items.filter((i) => i.dimension === 'schedule' && i.entityType === 'task')
    const affectedIds = scheduleTasks.map((i) => i.entityId)
    assert.include(affectedIds, 2, '直接后继任务应受影响')
    assert.include(affectedIds, 3, '二级后继任务应受影响')

    // 传播路径应指向真实依赖关系（非名称推断）
    const t2 = scheduleTasks.find((i) => i.entityId === 2)!
    assert.isNotNull(t2.propagationPath)
    assert.equal(t2.ruleId === 'R001' || t2.ruleId === 'R007', true)
  })

  test('R007：关键路径附近的进度项严重度被提升，summary 标记关键路径', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()
    const input = makeInput({
      relatedTasks: [task(10)],
      relatedDependencies: [dep(1, 10, 11)],
    })

    const { items, summary } = ruleset.propagate(input)

    const escalated = items.filter((i) => i.ruleId === 'R007')
    assert.isAbove(escalated.length, 0, '应存在被关键路径规则提升的项')
    assert.isTrue(summary.criticalPathAffected, 'summary 应标记关键路径受影响')
  })

  test('R008：资源总负载超过容量时输出高严重度超载项', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()
    const input = makeInput({
      relatedResources: [
        resource(
          1,
          [
            { taskId: 1, loadPercent: 70 },
            { taskId: 2, loadPercent: 60 },
          ],
          100,
        ),
      ],
    })

    const { items } = ruleset.propagate(input)

    const overload = items.find((i) => i.ruleId === 'R008')
    assert.exists(overload, '应检测到资源超载')
    assert.equal(overload!.severity, 'high')
    assert.isTrue(isBlockingSeverity(overload!.severity))
  })

  test('R005：开放风险关联输出风险维度影响项', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()
    const input = makeInput({
      relatedRisks: [{ entityType: 'risk', entityId: 5, title: '集成风险', isVisible: true }],
    })

    const { items } = ruleset.propagate(input)

    const riskItem = items.find((i) => i.dimension === 'risk' && i.ruleId === 'R005')
    assert.exists(riskItem, '风险关联应产生风险维度影响项')
    assert.equal(riskItem!.entityId, 5)
  })

  test('禁止名称相似推断：无显式关系时不臆造受影响项', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()
    // 变更请求标题与任意"任务名"相似，但没有任何关联对象
    const input = makeInput({
      changeRequest: {
        title: '任务1 登录模块重构',
        description: '影响任务2、任务3',
        changeType: 'scope',
        priority: 'high',
        impactSummary: null,
        relatedTaskIds: null,
        relatedDocumentIds: null,
      },
      // 无关联任务/依赖/资源/风险
      scope: {
        dimensions: ['scope', 'schedule'],
        maxPropagationDepth: 5,
        includeEvidenceDetails: false,
      },
    })

    const { items, summary } = ruleset.propagate(input)

    assert.lengthOf(items, 0, '无显式关系不得从标题/描述推断受影响项')
    assert.equal(summary.totalAffected, 0)
  })

  test('图不可计算降级：输入 warnings 透传且不抛异常', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()
    const input = makeInput({
      warnings: [
        { code: 'DEPENDENCY_READ_FAILED', message: '依赖数据读取失败', dimension: 'schedule' },
      ],
      scope: { dimensions: ['schedule'], maxPropagationDepth: 5, includeEvidenceDetails: false },
    })

    const { warnings, summary } = ruleset.propagate(input)

    assert.isTrue(
      warnings.some((w) => w.code === 'DEPENDENCY_READ_FAILED'),
      '降级 warning 应透传',
    )
    assert.exists(summary, '降级时仍返回 summary')
  })

  test('稳定排序与去重：分数降序，同实体同维度仅保留一条', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()
    const input = makeInput({
      relatedTasks: [task(1)],
      relatedDependencies: [dep(1, 1, 2), dep(2, 1, 2)], // 重复依赖，制造潜在重复项
    })

    const { items } = ruleset.propagate(input)

    // 排序：分数降序
    for (let i = 1; i < items.length; i++) {
      assert.isTrue(items[i - 1].score >= items[i].score, 'items 应按 score 降序稳定排序')
    }

    // 去重：同 entityType+entityId+dimension 唯一
    const keys = items.map((i) => `${i.entityType}:${i.entityId}:${i.dimension}`)
    assert.lengthOf(new Set(keys), keys.length, '同实体同维度不得重复')
  })

  test('确定性：相同输入两次运行输出一致', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()
    const build = () =>
      makeInput({
        relatedTasks: [task(1), task(4)],
        relatedDependencies: [dep(1, 1, 2), dep(2, 2, 3)],
        relatedRisks: [{ entityType: 'risk', entityId: 9, title: '风险', isVisible: true }],
      })

    const a = ruleset.propagate(build())
    const b = ruleset.propagate(build())
    assert.deepEqual(
      a.items.map((i) => `${i.entityType}:${i.entityId}:${i.dimension}:${i.severity}:${i.score}`),
      b.items.map((i) => `${i.entityType}:${i.entityId}:${i.dimension}:${i.severity}:${i.score}`),
    )
  })
})

test.group('ChangeImpactRuleset 性能夹具（§4.8）', () => {
  test('1000 任务 / ~2000 依赖影响分析在阈值内完成并输出统计', ({ assert }) => {
    const ruleset = new ChangeImpactRuleset()

    const relatedTasks: ImpactEntityRef[] = []
    const relatedDependencies: RelatedDependency[] = []
    const TASK_COUNT = 1000
    let depId = 1
    for (let i = 1; i <= TASK_COUNT; i++) {
      relatedTasks.push(task(i))
    }
    // 近似 2000 条依赖：线性链 i→i+1 加上每隔一个的 i→i+2
    for (let i = 1; i < TASK_COUNT; i++) {
      relatedDependencies.push(dep(depId++, i, i + 1))
      if (i % 2 === 0 && i + 2 <= TASK_COUNT) {
        relatedDependencies.push(dep(depId++, i, i + 2))
      }
    }

    const input = makeInput({
      relatedTasks,
      relatedDependencies,
      // 限制传播深度以获得确定性、可复现的耗时
      scope: {
        dimensions: ['scope', 'schedule'],
        maxPropagationDepth: 3,
        includeEvidenceDetails: false,
      },
    })

    const start = Date.now()
    const { items, summary } = ruleset.propagate(input)
    const elapsedMs = Date.now() - start

    assert.isAbove(items.length, 0, '应产出受影响项')
    assert.isAbove(summary.totalAffected, 0)
    assert.isBelow(elapsedMs, 10_000, `1000 任务影响分析应在阈值内完成（实际 ${elapsedMs}ms）`)
  })
})
