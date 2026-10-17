import { test } from '@japa/runner'
import { convertWbsTreeToMermaid } from '#services/mermaid_converters/wbs_tree_converter'
import { convertGanttToMermaid } from '#services/mermaid_converters/gantt_converter'
import { convertDependencyGraphToMermaid } from '#services/mermaid_converters/dependency_graph_converter'
import { convertCriticalPathToMermaid } from '#services/mermaid_converters/critical_path_converter'
import type { WbsTreeData, GanttData, DependencyGraphData, CriticalPathData } from '@aiproj/types'

test.group('Mermaid 转换器', () => {
  test('WBS 树转换为 Mermaid graph', ({ assert }) => {
    const data: WbsTreeData = {
      nodes: [
        { id: 1, code: '1', name: '项目', parentId: null, isLeaf: false, depth: 0 },
        { id: 2, code: '1.1', name: '规划', parentId: 1, isLeaf: true, depth: 1 },
      ],
    }
    const result = convertWbsTreeToMermaid(data)
    assert.include(result.mermaid, 'graph TD')
    assert.include(result.mermaid, 'n1["1 项目"]')
    assert.include(result.mermaid, 'n2["1.1 规划"]')
    assert.include(result.mermaid, 'n1 --> n2')
    assert.isArray(result.warnings)
  })

  test('WBS 树标签转义特殊字符', ({ assert }) => {
    const data: WbsTreeData = {
      nodes: [{ id: 1, code: '1', name: '测试[节点]', parentId: null, isLeaf: true, depth: 0 }],
    }
    const result = convertWbsTreeToMermaid(data)
    assert.notInclude(result.mermaid, '测试[节点]')
    assert.include(result.mermaid, 'n1[')
  })

  test('甘特图转换为 Mermaid gantt', ({ assert }) => {
    const data: GanttData = {
      bars: [
        {
          taskId: 1,
          name: '任务A',
          startDate: '2026-01-01',
          endDate: '2026-01-10',
          progress: 50,
          isCriticalPath: false,
          dependencies: [],
          entityRef: { entityType: 'task', entityId: 1 },
        },
      ],
      milestones: [],
      timelineStart: '2026-01-01',
      timelineEnd: '2026-01-10',
    }
    const result = convertGanttToMermaid(data)
    assert.include(result.mermaid, 'gantt')
    assert.include(result.mermaid, 'dateFormat YYYY-MM-DD')
    assert.include(result.mermaid, '任务A')
  })

  test('甘特图输出依赖警告', ({ assert }) => {
    const data: GanttData = {
      bars: [
        {
          taskId: 1,
          name: 'A',
          startDate: '2026-01-01',
          endDate: '2026-01-05',
          progress: 0,
          isCriticalPath: true,
          dependencies: [2],
          entityRef: { entityType: 'task', entityId: 1 },
        },
      ],
      milestones: [],
      timelineStart: '2026-01-01',
      timelineEnd: '2026-01-05',
    }
    const result = convertGanttToMermaid(data)
    assert.isTrue(result.warnings.length > 0)
  })

  test('依赖图转换为 Mermaid graph', ({ assert }) => {
    const data: DependencyGraphData = {
      nodes: [
        { taskId: 1, name: 'A', entityRef: { entityType: 'task', entityId: 1 } },
        { taskId: 2, name: 'B', entityRef: { entityType: 'task', entityId: 2 } },
      ],
      edges: [{ fromTaskId: 1, toTaskId: 2, type: 'FS' }],
    }
    const result = convertDependencyGraphToMermaid(data)
    assert.include(result.mermaid, 'graph LR')
    assert.include(result.mermaid, 't1["A"]')
    assert.include(result.mermaid, 't2["B"]')
    assert.include(result.mermaid, 't1 -->')
  })

  test('关键路径转换为 Mermaid graph', ({ assert }) => {
    const data: CriticalPathData = {
      nodes: [
        {
          taskId: 1,
          name: '关键任务',
          earliestStart: '2026-01-01',
          earliestFinish: '2026-01-05',
          latestStart: '2026-01-01',
          latestFinish: '2026-01-05',
          totalFloat: 0,
          entityRef: { entityType: 'task', entityId: 1 },
        },
      ],
      path: [1],
    }
    const result = convertCriticalPathToMermaid(data)
    assert.include(result.mermaid, 'graph LR')
    assert.include(result.mermaid, '关键任务')
    assert.include(result.mermaid, ':::critical')
  })

  test('关键路径非关键节点无样式标记', ({ assert }) => {
    const data: CriticalPathData = {
      nodes: [
        {
          taskId: 1,
          name: '关键',
          earliestStart: null,
          earliestFinish: null,
          latestStart: null,
          latestFinish: null,
          totalFloat: 0,
          entityRef: { entityType: 'task', entityId: 1 },
        },
        {
          taskId: 2,
          name: '非关键',
          earliestStart: null,
          earliestFinish: null,
          latestStart: null,
          latestFinish: null,
          totalFloat: 5,
          entityRef: { entityType: 'task', entityId: 2 },
        },
      ],
      path: [1],
    }
    const result = convertCriticalPathToMermaid(data)
    assert.include(result.mermaid, 't1["关键"]:::critical')
    assert.include(result.mermaid, 't2["非关键 (浮动5d)"]')
    assert.notInclude(result.mermaid, 't2["非关键"]:::critical')
  })
})
