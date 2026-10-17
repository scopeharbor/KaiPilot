import type { Task, TaskPriority, TaskStatus } from '@/lib/api/tasks'

/**
 * 跨项目任务聚合（`/tasks`、`/calendar`）共享的纯函数与中文标签。
 * 页面文件只允许导出默认组件，故抽到这里便于复用与单测。
 */

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '阻塞',
  on_hold: '暂停',
  cancelled: '已取消',
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

/** 「未完成」口径：未开始 / 进行中 / 阻塞 / 暂停。 */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'not_started',
  'in_progress',
  'blocked',
  'on_hold',
]

/** 按截止日升序；无截止日排最后。 */
export function sortTasksByDue(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (!a.endDate && !b.endDate) return a.id - b.id
    if (!a.endDate) return 1
    if (!b.endDate) return -1
    return a.endDate.localeCompare(b.endDate)
  })
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地时区的 YYYY-MM-DD。 */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 月视图窗口：当月首尾日期 + 周一开头的 6×7 网格。month 为 0 起。 */
export function buildMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const offset = (first.getDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - offset + i)
    return { iso: toIsoDate(d), day: d.getDate(), inMonth: d.getMonth() === month }
  })
  return { dateFrom: toIsoDate(first), dateTo: toIsoDate(last), days }
}

/** 按截止日（endDate 日期部分）分组，无截止日的任务忽略。 */
export function groupTasksByDue(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const task of tasks) {
    const due = task.endDate?.slice(0, 10)
    if (!due) continue
    const list = map.get(due) ?? []
    list.push(task)
    map.set(due, list)
  }
  return map
}
