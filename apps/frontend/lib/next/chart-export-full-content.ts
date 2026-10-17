/**
 * 图表导出「完整内容重渲染」（全图导出，而非截取屏幕上当前可见的一块）。
 *
 * 屏幕视口只是完整图表的一个窗口：React Flow 画布受当前缩放 / 平移影响（207 个节点的 AON
 * 缩到全景时每个六格只有几像素），表格 / 时间线类镜头的滚动区外内容直接被裁掉。
 * 导出前按内容的真实范围重新排版：
 *
 * - React Flow 画布：取 `.react-flow__viewport`，按全部节点包围盒以 1:1 原始尺寸重新定位
 *   （覆盖视口 transform），与屏幕缩放 / 平移完全无关；
 * - 其余镜头：临时展开捕获根内所有 `overflow: auto | scroll` 的滚动区（及被限高 / 限宽的容器），
 *   按展开后的完整尺寸捕获；导出完成即逐个还原内联样式，实时工作面零残留。
 *
 * 像素比保持不变（清晰度优先）；超出浏览器画布上限时切成多块同样清晰的图，
 * 而不是降采样或生成空白图。
 */

/** 按分块生成克隆根的覆盖样式：完整内容尺寸 + 平移到该块。 */
export function tileStyle(capture: FullContentCapture, tile: ExportTile): Record<string, string> {
  return {
    width: `${capture.width}px`,
    height: `${capture.height}px`,
    transform: `translate(${capture.originX - tile.x}px, ${capture.originY - tile.y}px) scale(1)`,
    transformOrigin: '0 0',
    // 只要图本身：导出图里不出现任何滚动条
    overflow: 'hidden',
    scrollbarWidth: 'none',
  }
}

export interface FullContentCapture {
  /** 实际交给 html-to-image 的节点 */
  node: HTMLElement
  /** 完整内容尺寸（CSS 像素）；0 表示无法测量（如 jsdom），调用方不传尺寸 */
  width: number
  height: number
  /** 内容原点相对捕获根的平移（React Flow 模式抵消节点坐标最小值；其余为 0） */
  originX: number
  originY: number
  /** 捕获根的实际底色，避免 PNG 透明底上深色主题文字不可读 */
  backgroundColor?: string
  /** React Flow 节点数（进度提示用） */
  nodeCount?: number
  /** 还原所有临时样式 */
  restore: () => void
}

const FLOW_PADDING = 48
/**
 * 单张画布的单边 / 总像素上限：取 Chromium / Firefox / Safari 桌面版共同可用的 16384 × 16384
 * （约 2.68 亿像素）。超出才分块；200+ 节点的 AON（2x 后约 1 万 × 1.3 万）仍是一张图。
 */
const MAX_CANVAS_SIDE = 16_384
const MAX_CANVAS_AREA = 16_384 * 16_384

const TRANSLATE_RE = /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/

function isTransparent(color: string): boolean {
  return (
    color === '' ||
    color === 'transparent' ||
    /rgba\([^)]*,\s*0\)$/.test(color) ||
    /\/\s*0\)$/.test(color)
  )
}

/** 从 start 向上找第一个不透明底色（最多到 document.body）。 */
function resolveBackgroundColor(start: HTMLElement): string | undefined {
  let el: HTMLElement | null = start
  while (el) {
    const color = getComputedStyle(el).backgroundColor
    if (!isTransparent(color)) return color
    if (el === document.body) break
    el = el.parentElement
  }
  return undefined
}

function prepareFlowCapture(viewport: HTMLElement): FullContentCapture | null {
  const nodes = viewport.querySelectorAll<HTMLElement>('.react-flow__node')
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const match = TRANSLATE_RE.exec(node.style.transform)
    if (!match) continue
    const x = Number(match[1])
    const y = Number(match[2])
    const w = node.offsetWidth || parseFloat(node.style.width) || 0
    const h = node.offsetHeight || parseFloat(node.style.height) || 0
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  if (!Number.isFinite(minX)) return null
  const width = Math.ceil(maxX - minX + FLOW_PADDING * 2)
  const height = Math.ceil(maxY - minY + FLOW_PADDING * 2)
  const flowRoot = viewport.closest<HTMLElement>('.react-flow') ?? viewport

  // 每条边是一个未设尺寸的 <svg>（浏览器默认 300×150），靠 overflow: visible 露出远处的线段；
  // 导出时 DOM 会先转成 SVG 再栅格化，这一步不认 overflow: visible，连线被裁得只剩标签。
  // 临时把边 svg 撑满整张图（viewBox 与定位同原点，坐标不变），导出后还原。
  const originLeft = minX - FLOW_PADDING
  const originTop = minY - FLOW_PADDING
  const edgeSvgs = viewport.querySelectorAll<SVGSVGElement>('.react-flow__edges svg')
  const savedEdges: Array<[SVGSVGElement, Record<string, string | null>]> = []
  for (const svg of edgeSvgs) {
    savedEdges.push([
      svg,
      {
        style: svg.getAttribute('style'),
        width: svg.getAttribute('width'),
        height: svg.getAttribute('height'),
        viewBox: svg.getAttribute('viewBox'),
      },
    ])
    svg.style.left = `${originLeft}px`
    svg.style.top = `${originTop}px`
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('viewBox', `${originLeft} ${originTop} ${width} ${height}`)
  }
  const restoreEdges = () => {
    for (const [svg, attrs] of savedEdges) {
      for (const [name, value] of Object.entries(attrs)) {
        if (value === null) svg.removeAttribute(name)
        else svg.setAttribute(name, value)
      }
    }
  }
  return {
    node: viewport,
    width,
    height,
    originX: FLOW_PADDING - minX,
    originY: FLOW_PADDING - minY,
    backgroundColor: resolveBackgroundColor(flowRoot),
    nodeCount: nodes.length,
    restore: restoreEdges,
  }
}

function isScrollable(value: string): boolean {
  return value === 'auto' || value === 'scroll'
}

function prepareScrollCapture(target: HTMLElement): FullContentCapture {
  const saved: Array<[HTMLElement, string | null]> = []
  const expand = (el: HTMLElement) => {
    const cs = getComputedStyle(el)
    const overflowY = isScrollable(cs.overflowY) && el.scrollHeight > el.clientHeight + 1
    const overflowX = isScrollable(cs.overflowX) && el.scrollWidth > el.clientWidth + 1
    if (!overflowX && !overflowY) return
    saved.push([el, el.getAttribute('style')])
    el.style.overflow = 'visible'
    if (overflowY) {
      el.style.maxHeight = 'none'
      el.style.height = `${el.scrollHeight}px`
    }
    if (overflowX) {
      el.style.maxWidth = 'none'
      el.style.width = `${el.scrollWidth}px`
    }
  }
  // 先测量后展开：展开外层会改变内层尺寸，统一以原始状态判定
  const candidates = [target, ...target.querySelectorAll<HTMLElement>('*')].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  )
  for (const el of candidates) expand(el)
  const width = Math.max(target.scrollWidth, target.offsetWidth)
  const height = Math.max(target.scrollHeight, target.offsetHeight)
  return {
    node: target,
    width,
    height,
    originX: 0,
    originY: 0,
    backgroundColor: resolveBackgroundColor(target),
    restore: () => {
      for (const [el, style] of saved.reverse()) {
        if (style === null) el.removeAttribute('style')
        else el.setAttribute('style', style)
      }
    },
  }
}

const SVG_PAINT_ATTRIBUTES = ['stroke', 'fill', 'stop-color', 'color', 'flood-color'] as const

/**
 * SVG 内部元素的 CSS 变量落成实际值：html-to-image 对 HTML 元素会内联计算样式，
 * 对 SVG 子元素却原样保留 `style="stroke: var(--nx-…)"` / `stroke="var(--…)"`，
 * 而导出图是独立文档、没有这些变量 → 颜色为空、线条全部透明（AON 连线曾整片消失）。
 */
function resolveSvgCssVariables(root: HTMLElement): () => void {
  const saved: Array<[Element, string, string | null]> = []
  for (const el of root.querySelectorAll<SVGElement>('svg *, svg')) {
    const computed = getComputedStyle(el)
    const style = el.getAttribute('style')
    if (style?.includes('var(')) {
      saved.push([el, 'style', style])
      for (let i = el.style.length - 1; i >= 0; i--) {
        const prop = el.style.item(i)
        if (el.style.getPropertyValue(prop).includes('var(')) {
          el.style.setProperty(prop, computed.getPropertyValue(prop))
        }
      }
    }
    for (const attr of SVG_PAINT_ATTRIBUTES) {
      const value = el.getAttribute(attr)
      if (value?.includes('var(')) {
        saved.push([el, attr, value])
        el.setAttribute(attr, computed.getPropertyValue(attr))
      }
    }
  }
  return () => {
    for (const [el, name, value] of saved.reverse()) {
      if (value === null) el.removeAttribute(name)
      else el.setAttribute(name, value)
    }
  }
}

/** 按内容真实范围准备捕获（React Flow 优先，其余走滚动区展开）。 */
export function prepareFullContentCapture(target: HTMLElement): FullContentCapture {
  const restoreSvgVariables = resolveSvgCssVariables(target)
  const viewport = target.querySelector<HTMLElement>('.react-flow__viewport')
  const capture = (viewport ? prepareFlowCapture(viewport) : null) ?? prepareScrollCapture(target)
  const restoreLayout = capture.restore
  return {
    ...capture,
    restore: () => {
      restoreLayout()
      restoreSvgVariables()
    },
  }
}

export interface ExportTile {
  /** 分块在完整内容中的偏移与尺寸（CSS 像素） */
  x: number
  y: number
  width: number
  height: number
  /** 1 起编号与总块数 */
  index: number
  total: number
}

/**
 * 分块规划：像素比保持不变（清晰度优先，绝不为塞进一张画布而降采样），
 * 超出浏览器画布上限时按行 / 列切成多块，每块同样清晰。
 */
export function planExportTiles(width: number, height: number, pixelRatio: number): ExportTile[] {
  const maxSide = Math.floor(MAX_CANVAS_SIDE / pixelRatio)
  const tileWidth = Math.min(width, maxSide)
  const maxHeightByArea = Math.floor(MAX_CANVAS_AREA / (pixelRatio * pixelRatio * tileWidth))
  const tileHeight = Math.min(height, maxSide, maxHeightByArea)
  const columns = Math.ceil(width / tileWidth)
  const rows = Math.ceil(height / tileHeight)
  const tiles: ExportTile[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x = col * tileWidth
      const y = row * tileHeight
      tiles.push({
        x,
        y,
        width: Math.min(tileWidth, width - x),
        height: Math.min(tileHeight, height - y),
        index: tiles.length + 1,
        total: rows * columns,
      })
    }
  }
  return tiles
}

/**
 * 等到浏览器真正把当前状态画到屏幕上再继续：rAF 回调在绘制之前执行，
 * 再接一个宏任务才会落在绘制之后。html-to-image 的克隆是一长串连续微任务，
 * 期间计时器与重绘都排不上，不先让出就开始会让进度层根本画不出来。
 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0))
    } else setTimeout(resolve, 0)
  })
}
