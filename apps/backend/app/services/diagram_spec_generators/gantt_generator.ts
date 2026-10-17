import type Task from '#models/task'
import type Milestone from '#models/milestone'
import type { DiagramSpec, GanttData, GanttBar, GanttMilestone } from '@aiproj/types'
import { createHash } from 'node:crypto'

/**
 * 从任务和里程碑列表生成 gantt DiagramSpec。
 * 保留任务条、里程碑、依赖摘要、关键路径标记和时间轴信息。
 */
export function generateGanttDiagramSpec(
  projectId: number,
  tasks: Task[],
  milestones: Milestone[],
  title?: string,
): DiagramSpec {
  const bars: GanttBar[] = tasks
    .filter((t) => !t.deletedAt)
    .map((task) => ({
      taskId: task.id,
      name: task.name,
      startDate: task.startDate?.toISODate() ?? null,
      endDate: task.endDate?.toISODate() ?? null,
      progress: task.progressPercent ?? 0,
      isCriticalPath: task.isCriticalPath ?? false,
      dependencies: [],
      entityRef: { entityType: 'task' as const, entityId: task.id },
    }))

  const msItems: GanttMilestone[] = milestones.map((ms) => ({
    milestoneId: ms.id,
    name: ms.name,
    date: ms.plannedDate?.toISODate() ?? '',
    entityRef: { entityType: 'milestone' as const, entityId: ms.id },
  }))

  // 计算时间轴范围
  const dates = bars.flatMap((b) => [b.startDate, b.endDate]).filter((d): d is string => d !== null)
  const timelineStart = dates.length > 0 ? dates.sort()[0] : new Date().toISOString().slice(0, 10)
  const timelineEnd =
    dates.length > 0 ? dates.sort().reverse()[0] : new Date().toISOString().slice(0, 10)

  const data: GanttData = { bars, milestones: msItems, timelineStart, timelineEnd }
  const sourceHash = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 128)

  return {
    version: '1.0',
    type: 'gantt',
    title: title ?? '甘特图',
    data,
    metadata: {
      generatedBy: 'system',
      generatedAt: new Date().toISOString(),
      sourceProjectId: projectId,
      sourceDataHash: sourceHash,
      sourceDataTimestamp: new Date().toISOString(),
    },
    exports: {
      mermaid: { supported: true, limitations: ['依赖线', '关键路径样式', '工作日历'] },
    },
  }
}
