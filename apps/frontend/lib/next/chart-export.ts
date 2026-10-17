/**
 * 统一客户端图表汇出引擎（v3-ui-next-chart-export design §1-§4 / §6 / §9）。
 *
 * 纯客户端零网络请求（RL-01）铁律实现：
 * - `skipFonts: true` + `cacheBust: false` 彻底关闭 html-to-image 的 WebFont fetch
 *   与缓存击穿请求，全流程运行于浏览器内存沙箱，断网可用；
 * - 严禁导入 `lib/api-client.ts`（设计 §9.1），文件命名、Blob 编码均本地完成；
 * - 本地下载走 `URL.createObjectURL` → 动态 `<a download>` → `click()` →
 *   `revokeObjectURL` 及时释放内存。
 *
 * 字体保真（design §3）：导出时在克隆根节点注入跨平台系统级中文字体栈
 * （PingFang SC / Microsoft YaHei / WenQuanYi Micro Hei），度量字段使用
 * JetBrains Mono 等宽栈，杜绝 Tofu 方块与数字错位。
 */
import { toast } from '@/components/ui/Toast'
import { toBlob, toJpeg, toPng, toSvg } from 'html-to-image'
import {
  nextFrame,
  planExportTiles,
  prepareFullContentCapture,
  tileStyle,
} from './chart-export-full-content'

export type ExportImageFormat = 'svg' | 'png' | 'jpeg'

export interface ChartExportOptions {
  /** 导出文件名（不含扩展名），若不提供则根据实体名和视图自动生成 */
  filename?: string
  /** 实体标识（项目名或草案编号），用于构建规范文件名 */
  entityName?: string
  /** 视图类型描述（如 '看板工作面'、'反幻觉自检报告'、'分享卡'） */
  viewType?: string
  /** 采样像素比，默认 2（2x 超采样） */
  pixelRatio?: number
  /** 背景填充色，JPG 默认 '#ffffff'，PNG/SVG 默认 undefined（透明或跟随节点） */
  backgroundColor?: string
  /** 是否应用垫白打印模式（强制将深色工作面转换为纯白背景与深色文字） */
  whiteBackdrop?: boolean
  /** 节点过滤器，返回 false 的节点将被剔除，默认剥离 [data-export-ignore="true"] */
  filter?: (node: HTMLElement) => boolean
  /**
   * 完整内容重渲染：按内容真实范围重新排版后导出（React Flow 全部节点 1:1、滚动区全部展开），
   * 而不是截取屏幕上当前可见的一块；像素比不变，超出画布上限时切成多块同样清晰的图。
   */
  fullContent?: boolean
  /** 完整重渲染的进度回调（导出动画用） */
  onProgress?: (progress: ChartExportProgress) => void
}

export interface ChartExportProgress {
  phase: 'prepare' | 'render' | 'done'
  /** 完整内容尺寸（CSS 像素） */
  width?: number
  height?: number
  pixelRatio?: number
  nodeCount?: number
  tileIndex?: number
  tileTotal?: number
}

export interface ShareCardExportOptions extends Omit<ChartExportOptions, 'viewType'> {
  /** 是否直接复制到剪贴板，默认 false */
  copyToClipboard?: boolean
}

/** 跨平台系统级无衬线中文字体栈（macOS / Windows / Linux 全覆盖，断网零缺字）。 */
export const SYSTEM_CN_FONT_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"WenQuanYi Micro Hei"',
  'sans-serif',
].join(', ')

/** 等宽数字与代码字体栈（JetBrains Mono 优先，纵向列对齐）。 */
export const MONO_FONT_STACK = [
  '"JetBrains Mono"',
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  'monospace',
].join(', ')

/**
 * 高对比垫白模式自包含设计令牌（design §4 打印适配对照表）。
 *
 * 镜像 SHARE_CARD_TOKENS 的自包含机制：垫白导出时给捕获根节点添加
 * `data-export-theme="white"` 并以**内联 CSS 自定义属性**覆盖各 `--nx-*` 令牌，
 * 使浅白文字（#f1f5f9）→ 深蓝灰（#0f172a）、次级/微弱文字 → 中灰、发丝线 →
 * 中性浅灰实体线（#cbd5e1）、信号色适度深色化（#0284c7 系），
 * 保证白底打印 / 浅色文档对比度；捕获完成即还原，绝不污染实时工作面。
 */
export const WHITE_BACKDROP_TOKENS = {
  '--nx-space-bg': '#ffffff',
  '--nx-workspace-bg': '#ffffff',
  '--nx-workspace-surface': '#f8fafc',
  '--nx-bg-0': '#ffffff',
  '--nx-bg-1': '#f8fafc',
  '--nx-accent': '#0284c7',
  '--nx-ai': '#0e7490',
  '--nx-text-primary': '#0f172a',
  '--nx-text-secondary': '#475569',
  '--nx-text-muted': '#64748b',
  '--nx-border-hairline': '#cbd5e1',
  '--nx-border-focus': '#0284c7',
  '--nx-status-success': '#047857',
  '--nx-status-warning': '#b45309',
  '--nx-status-danger': '#b91c1c',
  '--nx-chart-1': '#0284c7',
  '--nx-chart-2': '#4f46e5',
  '--nx-chart-3': '#059669',
  '--nx-chart-4': '#d97706',
  '--nx-chart-5': '#dc2626',
  '--nx-chart-6': '#0891b2',
  '--nx-chart-7': '#9333ea',
  '--nx-chart-8': '#65a30d',
} as const satisfies Record<string, string>

/**
 * 沉浸档深空光晕平整化样式（design「沉浸档位导出表现一致性」/ spec 对应场景）。
 *
 * html-to-image 克隆阶段（clone-pseudos）会读取元素 `::before` 的计算样式并
 * 序列化进导出图；`.nx-space-atmosphere::before` 的径向渐变光晕因此在沉浸档/
 * 轻量档导出中残留。捕获期间临时注入本规则（`content: none` 使克隆直接跳过
 * 伪元素），将光晕平整为静止纯色，与精确档导出的几何恒等；捕获完成即移除。
 */
export const ATMOSPHERE_FLATTEN_CSS = [
  '.nx-space-atmosphere::before {',
  '  content: none !important;',
  '  display: none !important;',
  '  background: none !important;',
  '  opacity: 0 !important;',
  '  transition: none !important;',
  '}',
].join('\n')

/**
 * 垫白模式 DOM 注入（design §4 样式隔离铁律）：
 * 捕获根节点添加 `data-export-theme="white"` 并以内联 CSS 自定义属性覆盖
 * `--nx-*` 令牌（参照 SHARE_CARD_TOKENS 机制）。返回恢复句柄：导出完成后
 * 同步还原真实主题与既有内联值，注入仅存活于本次捕获，绝不残留。
 */
export function applyWhiteBackdrop(node: HTMLElement): () => void {
  const previousTheme = node.getAttribute('data-export-theme')
  const previousValues = new Map<string, string>()
  for (const [property, value] of Object.entries(WHITE_BACKDROP_TOKENS)) {
    const previous = node.style.getPropertyValue(property)
    if (previous !== '') previousValues.set(property, previous)
    node.style.setProperty(property, value)
  }
  node.setAttribute('data-export-theme', 'white')

  return () => {
    if (previousTheme === null) node.removeAttribute('data-export-theme')
    else node.setAttribute('data-export-theme', previousTheme)
    for (const [property, value] of previousValues) {
      node.style.setProperty(property, value)
    }
    for (const property of Object.keys(WHITE_BACKDROP_TOKENS)) {
      if (!previousValues.has(property)) node.style.removeProperty(property)
    }
  }
}

/** 捕获子树是否包含深空氛围层（`.nx-space-atmosphere`，需平整化光晕）。 */
function containsAtmosphereLayer(node: HTMLElement): boolean {
  if (node.classList.contains('nx-space-atmosphere')) return true
  return node.querySelector('.nx-space-atmosphere') !== null
}

/**
 * 注入氛围平整化样式（document 级临时规则，仅作用于离屏克隆计算阶段）。
 * 精确档（precise）由 next-tokens.css `[data-immersion='precise']` 规则原生
 * 停用光晕，无需重复注入。
 */
function injectAtmosphereFlatten(): (() => void) | undefined {
  if (typeof document === 'undefined' || document.head === null) return undefined
  if (document.documentElement.getAttribute('data-immersion') === 'precise') return undefined
  const style = document.createElement('style')
  style.setAttribute('data-export-atmosphere-flatten', 'true')
  style.textContent = ATMOSPHERE_FLATTEN_CSS
  document.head.appendChild(style)
  return () => {
    style.remove()
  }
}

/**
 * 导出期主题包装（design §4 样式隔离铁律）：
 * 垫白模式注入内联令牌覆盖 + 沉浸档光晕平整化；二者均于捕获完成后同步还原，
 * 实时工作面主题零污染。
 */
async function withExportTheme<T>(
  node: HTMLElement,
  options: ChartExportOptions | undefined,
  action: () => Promise<T>,
): Promise<T> {
  const restoreWhiteBackdrop =
    options?.whiteBackdrop === true ? applyWhiteBackdrop(node) : undefined
  const restoreAtmosphere = containsAtmosphereLayer(node) ? injectAtmosphereFlatten() : undefined
  try {
    return await action()
  } finally {
    restoreAtmosphere?.()
    restoreWhiteBackdrop?.()
  }
}

/** 操作系统保留非法字符：`\ / : * ? " < > |` 及 ASCII 0-31 控制字符。 */
// eslint-disable-next-line no-control-regex -- 设计 §2：文件名必须剥离 ASCII 0-31 控制字符
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g

/**
 * 文件名部件安全清洗（design §2）：
 * 剥离 OS 保留非法字符与控制字符，中文 / 英文 / 数字 / 中英文括号原样保留，
 * 连续空白归一化为单个空格；空值或全非法字符时返回 ''（由调用方兜底）。
 */
export function sanitizeFilenamePart(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''
  return raw.replace(ILLEGAL_FILENAME_CHARS, '').replace(/\s+/g, ' ').trim()
}

/**
 * 结构化语义文件名：`[实体标识]-[视图类型]-[YYYYMMDD]_[HHmmss].[扩展名]`。
 * 实体标识为空 / 清洗后为空时兜底为 `开项导出`，绝不生成无名文件（spec §文件名规范）。
 */
export function buildExportFilename(
  entityName: string | undefined,
  viewType: string,
  extension: string,
  now: Date = new Date(),
): string {
  const cleanEntity = sanitizeFilenamePart(entityName ?? '')
  const cleanView = sanitizeFilenamePart(viewType) || '图表视图'
  const prefix = cleanEntity.length > 0 ? cleanEntity : '开项导出'

  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const timestamp = `${yyyy}${mm}${dd}_${hh}${min}${ss}`

  const ext = extension.replace(/^\./, '').toLowerCase()
  return `${prefix}-${cleanView}-${timestamp}.${ext}`
}

/** 默认 DOM 噪点过滤器：剥离交互浮动元素与导出忽略标记（design §3.4）。 */
export function defaultExportFilter(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return true
  const el = node as HTMLElement
  if (el.dataset?.exportIgnore === 'true') return false
  if (el.classList?.contains('export-ignore')) return false
  if (el.getAttribute?.('role') === 'tooltip') return false
  return true
}

/** 导出文件名解析：显式 filename 优先，否则按实体/视图规范拼接。 */
function resolveExportFilename(
  options: ChartExportOptions | undefined,
  extension: string,
  now: Date,
): string {
  if (options?.filename) {
    return `${sanitizeFilenamePart(options.filename) || '开项导出'}.${extension}`
  }
  return buildExportFilename(options?.entityName, options?.viewType ?? '图表视图', extension, now)
}

/** 零网络基础选项：杜绝 WebFont fetch、注入系统级中文字体栈、滤除交互噪点。 */
function baseHtmlToImageOptions(options?: ChartExportOptions) {
  return {
    skipFonts: true,
    cacheBust: false,
    style: { fontFamily: SYSTEM_CN_FONT_STACK },
    filter: (node: Node) => {
      if (!defaultExportFilter(node)) return false
      // 用户自定义过滤器仅接收元素节点（设计契约 filter: (node: HTMLElement) => boolean）。
      if (node.nodeType === Node.ELEMENT_NODE && options?.filter) {
        return options.filter(node as HTMLElement)
      }
      return true
    },
  }
}

/** 位图（PNG/JPG）选项：2x 超采样；垫白模式强制纯白底，JPG 默认纯白垫底（design §1/§4）。 */
function buildImageOptions(format: 'png' | 'jpeg', options?: ChartExportOptions) {
  const isJpeg = format === 'jpeg'
  const useWhiteBackdrop = options?.whiteBackdrop === true
  const backgroundColor = useWhiteBackdrop
    ? '#ffffff'
    : isJpeg
      ? (options?.backgroundColor ?? '#ffffff')
      : options?.backgroundColor
  return {
    ...baseHtmlToImageOptions(options),
    pixelRatio: options?.pixelRatio ?? 2,
    type: isJpeg ? 'image/jpeg' : 'image/png',
    ...(backgroundColor !== undefined ? { backgroundColor } : {}),
  }
}

/** 数据 URL（base64）本地解码为 Blob，全程零网络（禁止 fetch(dataUrl) 外发）。 */
function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',')
  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  const mime = /data:([^;,]+)/.exec(meta)?.[1] ?? 'image/png'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * 本地内存沙箱下载调度（design §9.2）：
 * Object URL → 动态 `<a download>` → click → 立即自 DOM 移除 → 异步 revoke 释放内存。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 异步调度 revoke：确保浏览器已启动下载后再释放 Blob 内存。
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

/**
 * 核心底层函数：将 DOM 节点转换为目标格式的 Blob（design API 契约）。
 * - svg：toSvg 序列化 → `image/svg+xml` Blob（纯净矢量，保留内联令牌）；
 * - png / jpeg：toBlob 2x 超采样，jpeg 强制 `#ffffff` 白底。
 */
export async function exportNodeToBlob(
  node: HTMLElement,
  format: ExportImageFormat,
  options?: ChartExportOptions,
): Promise<Blob> {
  return withExportTheme(node, options, async () => {
    if (format === 'svg') {
      const svg = await toSvg(node, baseHtmlToImageOptions(options))
      return new Blob([svg], { type: 'image/svg+xml' })
    }
    const blob = await toBlob(node, buildImageOptions(format, options))
    if (!blob) throw new Error('图表渲染失败：未能生成图片数据')
    return blob
  })
}

/** 多块导出时的文件名：`…_第2部分共3部分.png`（单块不加后缀）。 */
function tileFilename(filename: string, index: number, total: number): string {
  if (total <= 1) return filename
  return filename.replace(/(\.[a-z0-9]+)$/i, `_第${index}部分共${total}部分$1`)
}

/**
 * 完整内容重渲染导出（见 chart-export-full-content）：
 * 先展开 / 重新定位到完整内容，再逐块以原像素比渲染并下载，最后还原工作面。
 * 无法测量尺寸（如 jsdom）时退回整节点捕获，行为与普通导出一致。
 */
async function exportFullContent(
  node: HTMLElement,
  format: ExportImageFormat,
  options: ChartExportOptions,
): Promise<string> {
  return withExportTheme(node, options, async () => {
    options.onProgress?.({ phase: 'prepare' })
    await nextFrame()
    const capture = prepareFullContentCapture(node)
    try {
      const measurable = capture.width > 0 && capture.height > 0
      const now = new Date()
      const base =
        format === 'svg' ? baseHtmlToImageOptions(options) : buildImageOptions(format, options)
      // 位图像素比与 buildImageOptions 同口径（默认 2x），完整重渲染绝不降采样
      const pixelRatio = format === 'svg' ? 1 : (options.pixelRatio ?? 2)
      const tiles = measurable
        ? format === 'svg'
          ? [{ x: 0, y: 0, width: capture.width, height: capture.height, index: 1, total: 1 }]
          : planExportTiles(capture.width, capture.height, pixelRatio)
        : [null]
      const fillColor =
        (base as { backgroundColor?: string }).backgroundColor ?? capture.backgroundColor
      let first = ''
      for (const tile of tiles) {
        options.onProgress?.({
          phase: 'render',
          width: capture.width,
          height: capture.height,
          pixelRatio,
          nodeCount: capture.nodeCount,
          tileIndex: tile?.index ?? 1,
          tileTotal: tile?.total ?? 1,
        })
        await nextFrame()
        const renderOptions = tile
          ? {
              ...base,
              width: tile.width,
              height: tile.height,
              style: { ...base.style, ...tileStyle(capture, tile) },
              ...(fillColor ? { backgroundColor: fillColor } : {}),
            }
          : base
        const extension = format === 'jpeg' ? 'jpg' : format
        const filename = tileFilename(
          resolveExportFilename(options, extension, now),
          tile?.index ?? 1,
          tile?.total ?? 1,
        )
        if (format === 'svg') {
          const svg = await toSvg(capture.node, renderOptions)
          downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), filename)
          first ||= svg
        } else {
          const dataUrl =
            format === 'png'
              ? await toPng(capture.node, renderOptions)
              : await toJpeg(capture.node, renderOptions)
          downloadBlob(dataUrlToBlob(dataUrl), filename)
          first ||= dataUrl
        }
      }
      options.onProgress?.({ phase: 'done' })
      return first
    } finally {
      capture.restore()
    }
  })
}

/** 导出纯净矢量 SVG 文件并触发下载，返回 SVG 字符串。 */
export async function exportNodeToSvg(
  node: HTMLElement,
  options?: ChartExportOptions,
): Promise<string> {
  if (options?.fullContent) return exportFullContent(node, 'svg', options)
  return withExportTheme(node, options, async () => {
    const svg = await toSvg(node, baseHtmlToImageOptions(options))
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml' }),
      resolveExportFilename(options, 'svg', new Date()),
    )
    return svg
  })
}

/** 导出 2x 超采样高清 PNG 文件并触发下载，返回 data URL。 */
export async function exportNodeToPng(
  node: HTMLElement,
  options?: ChartExportOptions,
): Promise<string> {
  if (options?.fullContent) return exportFullContent(node, 'png', options)
  return withExportTheme(node, options, async () => {
    const dataUrl = await toPng(node, buildImageOptions('png', options))
    downloadBlob(dataUrlToBlob(dataUrl), resolveExportFilename(options, 'png', new Date()))
    return dataUrl
  })
}

/** 导出白底垫底兼容 JPG 文件并触发下载，返回 data URL。 */
export async function exportNodeToJpeg(
  node: HTMLElement,
  options?: ChartExportOptions,
): Promise<string> {
  if (options?.fullContent) return exportFullContent(node, 'jpeg', options)
  return withExportTheme(node, options, async () => {
    const dataUrl = await toJpeg(node, buildImageOptions('jpeg', options))
    downloadBlob(dataUrlToBlob(dataUrl), resolveExportFilename(options, 'jpg', new Date()))
    return dataUrl
  })
}

/** 剪贴板写入能力检测：安全上下文中需同时具备 `clipboard.write` 与 `ClipboardItem`。 */
function isClipboardWriteSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  )
}

/**
 * 将 PNG Blob 写入操作系统剪贴板，平滑降级（design §6）：
 * - 成功 → Toast「分享卡已复制到剪贴板」，返回 'copied'；
 * - 环境不支持 / 用户拒绝授权（NotAllowedError）→ 自动降级本地下载 + 降级 Toast，返回 'downloaded'。
 */
export async function copyBlobToClipboard(
  blob: Blob,
  fallbackDownloadFilename?: string,
): Promise<'copied' | 'downloaded'> {
  const fallbackName = fallbackDownloadFilename ?? buildExportFilename(undefined, '分享卡', 'png')

  if (!isClipboardWriteSupported()) {
    downloadBlob(blob, fallbackName)
    toast({
      variant: 'warning',
      title: '浏览器不支持复制图片',
      description: '已为你自动保存为文件',
    })
    return 'downloaded'
  }

  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast({ variant: 'success', title: '分享卡已复制到剪贴板' })
    return 'copied'
  } catch {
    downloadBlob(blob, fallbackName)
    toast({ variant: 'warning', title: '剪贴板权限受限', description: '已为你自动保存为文件' })
    return 'downloaded'
  }
}
