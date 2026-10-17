/**
 * AI 同事 · 应用地图（前后端共享）。
 *
 * 前端从界面**自己在用**的目录实时生成（空间地图坐标、设置分区、管理后台控制台、
 * 项目视图），按当前用户权限过滤后随请求发送；后端只做形状清洗，不另存一份目录——
 * 这样 AI 同事回答「XX 在哪里」、执行「带我去 XX」时永远与当前版本界面一致，
 * 不依赖可能过时的文档。
 */

export interface ColleagueAppDestination {
  /** 目录内唯一 ID（如 `settings:ai-connections`、`space:notifications`、`lens:gantt`）。 */
  id: string
  title: string
  /** 所在分组（如「设置 · AI 与集成」「组织」「项目视图」）。 */
  group: string
  /** 路径模板（`/next` 开头；含 `:id` 表示需要当前项目）。 */
  path: string
  description?: string
}

/** 界面偏好的可选值（来自界面自己的选项常量）。 */
export interface ColleagueUiPreferenceOptions {
  themes: readonly { value: string; label: string }[]
  densities: readonly { value: string; label: string }[]
  textVariants: readonly { value: string; label: string }[]
}

export const COLLEAGUE_APP_MAP_MAX_ENTRIES = 250

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** 清洗客户端送来的应用地图：只保留形状合法、`/next` 开头的条目，去重并限量。 */
export function sanitizeColleagueAppMap(raw: unknown): ColleagueAppDestination[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const result: ColleagueAppDestination[] = []
  for (const item of raw) {
    if (result.length >= COLLEAGUE_APP_MAP_MAX_ENTRIES) break
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const id = cleanText(entry.id, 80)
    const title = cleanText(entry.title, 60)
    const path = cleanText(entry.path, 200)
    if (!id || !title || !path.startsWith('/next') || /\s/.test(path) || seen.has(id)) continue
    seen.add(id)
    const description = cleanText(entry.description, 80)
    result.push({
      id,
      title,
      group: cleanText(entry.group, 40),
      path,
      ...(description ? { description } : {}),
    })
  }
  return result
}

/** 清洗界面偏好选项（每类最多 8 项）。 */
export function sanitizeColleagueUiPreferences(raw: unknown): ColleagueUiPreferenceOptions | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const list = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .slice(0, 8)
      .map((option) => {
        const entry = (option ?? {}) as Record<string, unknown>
        return { value: cleanText(entry.value, 20), label: cleanText(entry.label, 30) }
      })
      .filter((option) => /^[a-z_-]+$/.test(option.value) && option.label)
  return {
    themes: list(source.themes),
    densities: list(source.densities),
    textVariants: list(source.textVariants),
  }
}

// ---------------------------------------------------------------------------
// AI 同事问答通道 → 执行器的交接标记（模型输出、界面解析，不展示给用户）
// ---------------------------------------------------------------------------

/** 问答模型判断「这句话是要做事」时只输出这一行，界面转交操作执行器。 */
export const COLLEAGUE_HANDOFF_MARKER = '[[AI同事:执行]]'
/** 问答模型确定唯一目标页面时在末尾输出 `[[AI同事:打开:/next/...]]`，界面自动打开。 */
export const COLLEAGUE_OPEN_MARKER_PREFIX = '[[AI同事:打开:'

export interface ColleagueAnswerDirectives {
  /** 去掉标记后的回答正文。 */
  text: string
  /** 是否要求交给操作执行器。 */
  handoff: boolean
  /** 要自动打开的站内页面（只认 `/next` 开头、无空白、无 `:id` 占位的路径）。 */
  openPath: string | null
}

const OPEN_MARKER_RE = /\[\[AI同事:打开:([^\]\s]*)\]\]/g
/** 流式输出中还没写完的标记尾巴（如 `[[AI同`），展示时先藏起来。 */
const PARTIAL_MARKER_RE = /\[\[?(?:A(?:I(?:同(?:事(?::[^\]\n]*)?)?)?)?)?$/

/**
 * 解析问答回答里的交接标记（纯函数）。
 * `streaming=true` 时额外隐藏末尾未写完的标记片段，避免界面闪出半截 `[[AI同事:`。
 */
export function parseColleagueAnswerDirectives(
  raw: string,
  options: { streaming?: boolean } = {},
): ColleagueAnswerDirectives {
  const handoff = raw.includes(COLLEAGUE_HANDOFF_MARKER)
  let openPath: string | null = null
  let text = raw.split(COLLEAGUE_HANDOFF_MARKER).join('')
  text = text.replace(OPEN_MARKER_RE, (_match, path: string) => {
    if (openPath === null && path.startsWith('/next') && !path.includes(':id')) openPath = path
    return ''
  })
  if (options.streaming) text = text.replace(PARTIAL_MARKER_RE, '')
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), handoff, openPath }
}
