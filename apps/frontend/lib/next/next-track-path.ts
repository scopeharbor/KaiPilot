/**
 * 把旧版路径换算成新版 UI 路径（AI 同事等新版入口的导航用）。
 *
 * 后端 navigate_to_space 对看板/甘特/WBS/列表/日历/时间线仍返回旧版地址
 * `/projects/:id/:lens[/:taskId]`（旧版界面还在用）；在新版里要进入
 * `/next/projects/:id?lens=:lens[&focusTask=:taskId]`，否则会跳回旧版或原地不动。
 * 已是 `/next` 开头或无法识别的路径原样返回。
 */
const PROJECT_LENSES = new Set(['kanban', 'gantt', 'wbs', 'list', 'calendar', 'timeline'])

export function toNextTrackPath(path: string): string {
  if (path.startsWith('/next')) return path
  const match = /^\/projects\/(\d+)(?:\/([a-z_-]+))?(?:\/(\d+))?\/?(\?.*)?$/.exec(path)
  if (!match) return path
  const [, projectId, lens, taskId] = match
  const params = new URLSearchParams()
  if (lens && lens !== 'kanban') {
    if (!PROJECT_LENSES.has(lens)) return path
    params.set('lens', lens)
  }
  if (taskId) params.set('focusTask', taskId)
  const query = params.toString()
  return `/next/projects/${projectId}${query ? `?${query}` : ''}`
}
