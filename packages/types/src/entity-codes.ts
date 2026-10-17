/**
 * 项目编号 / 任务编号（前后端共享，纯函数）。
 *
 * - 项目编号：项目自身的 `code`（如 `PROJ-5`）；未设置时用 `PROJ-{项目ID}`（与界面项目头部一致）；
 * - 任务编号：`项目编号#任务号`（如 `PROJ-5#128`），任务号即任务 ID（全局唯一）。
 *   风格同 GitHub 的 `仓库#123`：短、一眼看出属于哪个项目，只输 `#128` 也能定位。
 */

export function formatProjectCode(project: { id: number; code?: string | null }): string {
  const code = typeof project.code === 'string' ? project.code.trim() : ''
  return code || `PROJ-${project.id}`
}

export function formatTaskCode(
  project: { id: number; code?: string | null },
  taskId: number,
): string {
  return `${formatProjectCode(project)}#${taskId}`
}

export interface ParsedEntityCodes {
  /** `#128` / `PROJ-5#128` 里的任务号。 */
  taskIds: number[]
  /** `PROJ-5#128` 里的项目编号（与任务号一一对应，裸 `#128` 为 null）。 */
  taskProjectCodes: (string | null)[]
  /** 单独出现的项目编号（如 `PROJ-5`、`ABC-12`）。 */
  projectCodes: string[]
}

const TASK_CODE_RE = /(?:([A-Za-z][A-Za-z0-9_-]{0,30}))?#(\d{1,9})\b/g
const PROJECT_CODE_RE = /(?<![#\w-])([A-Za-z][A-Za-z0-9_]*-\d{1,9})(?![#\w-])/g

/** 从一段文字里找出任务编号与项目编号（去重，保持出现顺序）。 */
export function parseEntityCodes(text: string): ParsedEntityCodes {
  const taskIds: number[] = []
  const taskProjectCodes: (string | null)[] = []
  const projectCodes: string[] = []
  for (const match of text.matchAll(TASK_CODE_RE)) {
    const id = Number(match[2])
    if (!Number.isSafeInteger(id) || id <= 0 || taskIds.includes(id)) continue
    taskIds.push(id)
    taskProjectCodes.push(match[1] ? match[1] : null)
  }
  for (const match of text.matchAll(PROJECT_CODE_RE)) {
    const code = match[1]!
    if (!projectCodes.includes(code)) projectCodes.push(code)
  }
  return { taskIds, taskProjectCodes, projectCodes }
}

/** 整个关键词就是一个任务编号时返回任务号（`#128`、`PROJ-5#128`），否则 null。 */
export function matchTaskCodeKeyword(
  keyword: string,
): { taskId: number; projectCode: string | null } | null {
  const match = /^\s*(?:([A-Za-z][A-Za-z0-9_-]{0,30}))?#(\d{1,9})\s*$/.exec(keyword)
  if (!match) return null
  const taskId = Number(match[2])
  return Number.isSafeInteger(taskId) && taskId > 0
    ? { taskId, projectCode: match[1] ?? null }
    : null
}

/** 兜底编号 `PROJ-12` 对应的项目 ID（没设置 code 的项目用它作编号）。 */
export function projectIdFromFallbackCode(code: string): number | null {
  const match = /^PROJ-(\d{1,9})$/i.exec(code)
  return match ? Number(match[1]) : null
}

/**
 * 信号编号：`项目编号#S信号号`（如 `PROJ-8#S10`），信号号即信号 ID（全局唯一）。
 * 与任务编号同一风格；`S` 前缀与任务号区分（任务编号规则只认 `#` 后紧跟数字，不会误判）。
 * 复制后在 AI 同事里说「矛盾求解 PROJ-8#S10」或只贴编号，即可直接对该信号发起求解。
 */
export function formatSignalCode(
  project: { id: number; code?: string | null },
  signalId: number,
): string {
  return `${formatProjectCode(project)}#S${signalId}`
}

const SIGNAL_CODE_RE = /(?:([A-Za-z][A-Za-z0-9_-]{0,30}))?#S(\d{1,9})\b/gi

/** 从一段文字里找出信号编号（`PROJ-8#S10`、`#S10`；去重，保持出现顺序）。 */
export function parseSignalCodes(
  text: string,
): Array<{ signalId: number; projectCode: string | null }> {
  const found: Array<{ signalId: number; projectCode: string | null }> = []
  for (const match of text.matchAll(SIGNAL_CODE_RE)) {
    const signalId = Number(match[2])
    if (!Number.isSafeInteger(signalId) || signalId <= 0) continue
    if (found.some((entry) => entry.signalId === signalId)) continue
    found.push({ signalId, projectCode: match[1] ? match[1] : null })
  }
  return found
}
