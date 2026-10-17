import { test } from '@japa/runner'
import { generateWbsTreeDiagramSpec } from '#services/diagram_spec_generators/wbs_tree_generator'
import { generateGanttDiagramSpec } from '#services/diagram_spec_generators/gantt_generator'
import {
  generateDependencyGraphDiagramSpec,
  generateCriticalPathDiagramSpec,
} from '#services/diagram_spec_generators/dependency_generators'

function makeMockWbsNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 1,
    parentId: null,
    name: '根节点',
    code: '1',
    depth: 0,
    isLeaf: false,
    collapsed: false,
    displayOrder: 0,
    taskId: null,
    path: '/1/',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

function makeMockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 1,
    name: '任务 A',
    status: 'todo',
    priority: 'medium',
    progressPercent: 0,
    isCriticalPath: false,
    isOnLongestPath: false,
    totalFloat: 0,
    startDate: null,
    endDate: null,
    earliestStart: null,
    earliestFinish: null,
    latestStart: null,
    latestFinish: null,
    parentTaskId: null,
    assigneeId: null,
    reviewerId: null,
    milestoneId: null,
    wbsNodeId: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeMockMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    projectId: 1,
    name: '里程碑 1',
    plannedDate: null,
    achievedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

test.group('DiagramSpec 生成器', () => {
  test('WBS 树生成器保留编码和实体引用', ({ assert }) => {
    const nodes = [
      makeMockWbsNode({ id: 1, code: '1', name: '项目', parentId: null, isLeaf: false }),
      makeMockWbsNode({
        id: 2,
        code: '1.1',
        name: '子节点',
        parentId: 1,
        isLeaf: true,
        taskId: 10,
      }),
    ]
    const spec = generateWbsTreeDiagramSpec(1, nodes as any, '测试 WBS')

    assert.equal(spec.version, '1.0')
    assert.equal(spec.type, 'wbs_tree')
    assert.equal(spec.title, '测试 WBS')
    assert.equal(spec.metadata.generatedBy, 'system')
    assert.equal(spec.metadata.sourceProjectId, 1)
    assert.isString(spec.metadata.sourceDataHash)
    assert.isString(spec.metadata.sourceDataTimestamp)

    const data = spec.data as any
    assert.lengthOf(data.nodes, 2)
    assert.equal(data.nodes[0].code, '1')
    assert.equal(data.nodes[1].entityRef.entityType, 'task')
    assert.equal(data.nodes[1].entityRef.entityId, 10)
  })

  test('甘特图生成器保留时间轴和关键路径', ({ assert }) => {
    const tasks = [
      makeMockTask({
        id: 1,
        name: '任务 A',
        isCriticalPath: true,
        startDate: { toISODate: () => '2026-01-01' },
        endDate: { toISODate: () => '2026-01-10' },
      }),
    ]
    const milestones = [makeMockMilestone()]
    const spec = generateGanttDiagramSpec(1, tasks as any, milestones as any, '测试甘特')

    assert.equal(spec.type, 'gantt')
    assert.equal(spec.title, '测试甘特')
    assert.isString(spec.metadata.sourceDataHash)

    const data = spec.data as any
    assert.lengthOf(data.bars, 1)
    assert.isTrue(data.bars[0].isCriticalPath)
    assert.equal(data.bars[0].startDate, '2026-01-01')
  })

  test('依赖图生成器保留边和实体引用', ({ assert }) => {
    const tasks = [
      makeMockTask({ id: 1, name: 'A' }),
      makeMockTask({ id: 2, name: 'B', parentTaskId: 1 }),
    ]
    const spec = generateDependencyGraphDiagramSpec(1, tasks as any)

    assert.equal(spec.type, 'dependency_graph')
    const data = spec.data as any
    assert.lengthOf(data.nodes, 2)
    assert.lengthOf(data.edges, 1)
    assert.equal(data.edges[0].fromTaskId, 1)
    assert.equal(data.edges[0].toTaskId, 2)
  })

  test('关键路径生成器仅包含关键路径节点', ({ assert }) => {
    const tasks = [
      makeMockTask({ id: 1, name: '关键', isCriticalPath: true, totalFloat: 0 }),
      makeMockTask({ id: 2, name: '非关键', isCriticalPath: false, totalFloat: 5 }),
    ]
    const spec = generateCriticalPathDiagramSpec(1, tasks as any)

    assert.equal(spec.type, 'critical_path')
    const data = spec.data as any
    assert.lengthOf(data.nodes, 1)
    assert.equal(data.nodes[0].name, '关键')
    assert.deepEqual(data.path, [1])
  })

  test('生成器禁止反写（只读派生设计）', ({ assert }) => {
    const nodes = [makeMockWbsNode()]
    const spec = generateWbsTreeDiagramSpec(1, nodes as any)

    // DiagramSpec 不包含修改源数据的方法
    assert.notProperty(spec, 'save')
    assert.notProperty(spec, 'update')
    assert.notProperty(spec, 'delete')
    // data 是纯数据结构
    assert.isObject(spec.data)
  })
})
