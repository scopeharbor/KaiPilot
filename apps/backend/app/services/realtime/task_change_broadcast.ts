/**
 * 任务写入提交后的项目频道广播（尽力而为的旁路，失败不抛错）。
 *
 * 在事务里写任务的路径（AI 工具确认、甘特排程提交）由 TaskService 写方法带 client，
 * 不会自动广播——提交成功后调用本函数，让同项目其他打开的视图与协作者即时刷新。
 */
import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import { RealtimeEvents } from '#types/realtime_events'

export function broadcastTasksUpdated(
  organizationId: number,
  projectId: number,
  taskIds: readonly number[],
  actorUserId: number,
): void {
  const broadcaster = new RealtimeBroadcaster()
  const occurredAt = new Date().toISOString()
  for (const taskId of new Set(taskIds)) {
    broadcaster.broadcastToProject(organizationId, projectId, {
      type: RealtimeEvents.TASK_UPDATED,
      projectId,
      entityId: taskId,
      actorId: actorUserId,
      occurredAt,
    })
  }
}
