/**
 * 任务数据变更通知（非 React 代码 → QueryProvider）。
 *
 * Zustand store 等拿不到 QueryClient 的写入方（如 AI 同事确认写操作）在落库后调用
 * `notifyTaskDataChanged(projectId)`，由 QueryProvider 注册的监听统一走
 * `invalidateTaskQueries`，让看板 / 列表 / 日历 / 甘特 / WBS / 时间线同步刷新。
 */
type Listener = (projectId: number) => void

let listener: Listener | null = null

export function setTaskDataChangeListener(next: Listener | null): void {
  listener = next
}

export function notifyTaskDataChanged(projectId: number | null | undefined): void {
  if (!listener || typeof projectId !== 'number' || !Number.isInteger(projectId) || projectId <= 0)
    return
  try {
    listener(projectId)
  } catch {
    // 刷新失败不影响写入结果；TanStack Query 会在下次聚焦时兜底重取
  }
}

/**
 * 信号状态变更通知（AI 同事里确认落库后信号被采纳）：由 QueryProvider 失效信号列表缓存，
 * 已解决的信号卡立刻从「信号建议」与项目空间信号卡里消失，不必等下次重新进入页面。
 */
let signalsListener: (() => void) | null = null

export function setSignalsChangeListener(next: (() => void) | null): void {
  signalsListener = next
}

export function notifySignalsChanged(): void {
  if (!signalsListener) return
  try {
    signalsListener()
  } catch {
    // 刷新失败不影响采纳结果；下次聚焦时兜底重取
  }
}
