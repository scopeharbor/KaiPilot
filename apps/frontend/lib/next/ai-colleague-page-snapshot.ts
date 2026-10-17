/**
 * AI 同事 · 看当前页面。
 *
 * - `capturePageText()`：每次理解操作都带上的「页面可见文字」——页面标题、各级标题、按钮、
 *   表格行、卡片与列表文字，按出现顺序去重、截断。所有模型都能用，零额外请求。
 * - `capturePageImage()`：把页面渲染成截图（JPEG data URL），交给能看图的模型描述
 *   （AI 主动「看一眼页面」或用户点 📷 时才截）。
 * 都会排除 AI 同事面板本身与浮层遮罩，只看用户正在用的页面。
 */
import { toJpeg } from 'html-to-image'

/** 可见文字上限（字符）。 */
export const PAGE_TEXT_MAX = 4000
/** 截图最大宽度（像素）：再宽对看图模型没有帮助，只会变慢。 */
const SCREENSHOT_MAX_WIDTH = 1600

const EXCLUDED_SELECTOR =
  '[data-ai-colleague-panel], [data-ai-colleague-overlay], script, style, noscript, svg title'

/** 页面主体：新版壳层的 <main>，没有时用 body。 */
function pageRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>('main') ?? document.body
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true
  if (element.closest(EXCLUDED_SELECTOR)) return false
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false
  const style = typeof window !== 'undefined' ? window.getComputedStyle(element) : null
  return !(style && (style.display === 'none' || style.visibility === 'hidden'))
}

const BLOCK_SELECTOR =
  'h1, h2, h3, h4, [role="heading"], button, a[href], [role="tab"], label, th, tr, li, p, dt, dd, [data-card-title], [role="status"], [role="alert"], input[placeholder], textarea[placeholder]'

/**
 * 页面可见文字（按出现顺序，去重、去掉过短的碎片）。标题前加「#」、按钮前加「[按钮]」，
 * 表格行用「|」分隔单元格，便于模型分辨页面结构。
 */
export function capturePageText(maxLength = PAGE_TEXT_MAX): string {
  const root = pageRoot()
  if (!root) return ''
  const lines: string[] = []
  const seen = new Set<string>()
  const push = (line: string) => {
    const text = line.replace(/\s+/g, ' ').trim()
    if (text.length < 2 || seen.has(text)) return
    seen.add(text)
    lines.push(text)
  }
  if (typeof document !== 'undefined' && document.title) push(`页面标题：${document.title}`)
  for (const element of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
    if (!isVisible(element)) continue
    const tag = element.tagName.toLowerCase()
    // 已被更外层的行（tr / li）收录的文字不再重复
    if (tag !== 'tr' && tag !== 'li' && element.closest('tr, li') && !/^h[1-4]$/.test(tag)) continue
    if (tag === 'tr') {
      const cells = Array.from(element.querySelectorAll('th, td'))
        .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      if (cells.length > 0) push(cells.join(' | '))
      continue
    }
    if (tag === 'input' || tag === 'textarea') {
      const placeholder = element.getAttribute('placeholder')
      if (placeholder) push(`[输入框] ${placeholder}`)
      continue
    }
    const text = (element.textContent ?? '').trim()
    if (!text) continue
    if (/^h[1-4]$/.test(tag) || element.getAttribute('role') === 'heading') push(`# ${text}`)
    else if (tag === 'button' || element.getAttribute('role') === 'tab') push(`[按钮] ${text}`)
    else push(text.length > 300 ? `${text.slice(0, 300)}…` : text)
  }
  const joined = lines.join('\n')
  return joined.length > maxLength ? `${joined.slice(0, maxLength)}…` : joined
}

/** 页面截图（JPEG data URL）；截不到时抛错。 */
export async function capturePageImage(): Promise<string> {
  const root = pageRoot()
  if (!root) throw new Error('当前页面无法截图')
  const width = root.scrollWidth || root.clientWidth || 1280
  const pixelRatio = Math.min(1, SCREENSHOT_MAX_WIDTH / Math.max(width, 1))
  return toJpeg(root, {
    quality: 0.72,
    pixelRatio,
    cacheBust: true,
    // 截图时剔除 AI 同事面板与浮层（面板挂在 body 下的 portal，这里再保险过滤一次）
    filter: (node) =>
      !(
        node instanceof HTMLElement &&
        node.matches?.('[data-ai-colleague-panel], [data-ai-colleague-overlay]')
      ),
    backgroundColor:
      typeof window !== 'undefined'
        ? window.getComputedStyle(document.body).backgroundColor || '#0b0f17'
        : '#0b0f17',
  })
}

/** 当前路由（路径 + 查询串）。 */
export function currentPageRoute(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}`
}
