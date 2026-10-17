import type Task from '#models/task'
import type {
  DiagramSpec,
  DependencyGraphData,
  DependencyGraphNode,
  DependencyEdge,
  CriticalPathData,
  CriticalPathNode,
} from '@aiproj/types'
import { createHash } from 'node:crypto'

/**
 * 从任务列表生成 dependency_graph DiagramSpec。
 */
export function generateDependencyGraphDiagramSpec(
  projectId: number,
  tasks: Task[],
  title?: string,
): DiagramSpec {
  const activeTasks = tasks.filter((t) => !t.deletedAt)

  const nodes: DependencyGraphNode[] = activeTasks.map((task) => ({
    taskId: task.id,
    name: task.name,
    entityRef: { entityType: 'task' as const, entityId: task.id },
  }))

  const edges: DependencyEdge[] = []
  // 从任务的 parentTaskId 推导依赖边（简化版，完整版需查 task_dependencies 表）
  for (const task of activeTasks) {
    if (task.parentTaskId) {
      edges.push({
        fromTaskId: Number(task.parentTaskId),
        toTaskId: task.id,
        type: 'FS',
      })
    }
  }

  const data: DependencyGraphData = { nodes, edges }
  const sourceHash = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 128)

  return {
    version: '1.0',
    type: 'dependency_graph',
    title: title ?? '依赖关系图',
    data,
    metadata: {
      generatedBy: 'system',
      generatedAt: new Date().toISOString(),
      sourceProjectId: projectId,
      sourceDataHash: sourceHash,
      sourceDataTimestamp: new Date().toISOString(),
    },
    exports: {
      mermaid: { supported: true },
    },
  }
}

/**
 * 从任务列表生成 critical_path DiagramSpec。
 */
export function generateCriticalPathDiagramSpec(
  projectId: number,
  tasks: Task[],
  title?: string,
): DiagramSpec {
  const activeTasks = tasks.filter((t) => !t.deletedAt)

  const nodes: CriticalPathNode[] = activeTasks
    .filter((t) => t.isCriticalPath || t.isOnLongestPath)
    .map((task) => ({
      taskId: task.id,
      name: task.name,
      earliestStart: task.earliestStart?.toISODate() ?? null,
      earliestFinish: task.earliestFinish?.toISODate() ?? null,
      latestStart: task.latestStart?.toISODate() ?? null,
      latestFinish: task.latestFinish?.toISODate() ?? null,
      totalFloat: task.totalFloat ?? 0,
      entityRef: { entityType: 'task' as const, entityId: task.id },
    }))

  const path = nodes.map((n) => n.taskId)

  const data: CriticalPathData = { nodes, path }
  const sourceHash = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 128)

  return {
    version: '1.0',
    type: 'critical_path',
    title: title ?? '关键路径',
    data,
    metadata: {
      generatedBy: 'system',
      generatedAt: new Date().toISOString(),
      sourceProjectId: projectId,
      sourceDataHash: sourceHash,
      sourceDataTimestamp: new Date().toISOString(),
    },
    exports: {
      mermaid: { supported: true },
    },
  }
}
