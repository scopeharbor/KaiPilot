'use client'

import * as React from 'react'
import DOMPurify from 'dompurify'
import { useTheme } from 'next-themes'
import {
  Check,
  Code2,
  Copy,
  Download,
  ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useVariantText } from '@/lib/locale/use-variant-text'

/**
 * AI 回答里的图：Markdown 代码块按语言渲染成图形。
 *
 * - ```mermaid —— 流程图 / 时序图 / 甘特图 / 思维导图 / 饼图等（mermaid 按需加载，strict 安全级别）；
 * - ```svg     —— 模型直接画的 SVG（DOMPurify 清洗：去脚本、事件属性与外链）；
 * - ```html    —— HTML/CSS 静态图示，放进沙箱 iframe（禁脚本、禁外部资源）。
 *
 * 流式输出中代码块还没写完，先显示「正在绘图…」，写完再渲染，避免半截代码反复报错。
 * 图区右上角提供 源码 / 复制 / 下载 / 全屏：全屏走原生 Fullscreen API（Esc 退出），
 * 图以全视口呈现，布局随 fullscreenchange 状态还原。
 */
export type DiagramLanguage = 'mermaid' | 'svg' | 'html'

export const DIAGRAM_LANGUAGES: ReadonlySet<string> = new Set(['mermaid', 'svg', 'html'])

const LANGUAGE_LABEL: Record<DiagramLanguage, string> = {
  mermaid: 'Mermaid 图',
  svg: 'SVG 图',
  html: 'HTML 图示',
}

/**
 * SVG 清洗：只留 SVG 元素与样式，去掉脚本、事件属性与外部引用。
 * 渲染时再以 `<img>` 数据 URI 呈现——图里的样式与脚本都碰不到页面（双重隔离）。
 */
export function sanitizeSvg(
  markup: string,
  options: { allowForeignObject?: boolean } = {},
): string {
  const clean = DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ...(options.allowForeignObject ? { ADD_TAGS: ['foreignObject'] } : {}),
    FORBID_TAGS: [
      'script',
      'iframe',
      'image',
      ...(options.allowForeignObject ? [] : ['foreignObject']),
    ],
    FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onfocus'],
  })
  // 外部引用（http/https、//）一律去掉，只允许文档内锚点 #id
  return clean.replace(/\s(?:xlink:)?href\s*=\s*(["'])(?!#)[^"']*\1/gi, '')
}

/** SVG 文本 → `<img>` 可用的数据 URI。 */
export function svgDataUri(svg: string): string {
  const withNamespace = /xmlns=/.test(svg)
    ? svg
    : svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNamespace)}`
}

/** HTML 图示：放进沙箱前加一道 CSP（禁脚本、禁一切外部资源，仅允许内联样式与 data: 图片）。 */
export function buildSandboxedHtml(markup: string, dark: boolean): string {
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'"
  const base = dark ? 'background:#0b0d12;color:#d7dce5;' : 'background:#ffffff;color:#1f2329;'
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;padding:8px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;${base}}</style></head><body>${markup}</body></html>`
}

let mermaidLoader: Promise<typeof import('mermaid').default> | null = null
let renderSeq = 0

async function renderMermaid(code: string, dark: boolean): Promise<string> {
  mermaidLoader ??= import('mermaid').then((module) => module.default)
  const mermaid = await mermaidLoader
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  })
  renderSeq += 1
  const { svg } = await mermaid.render(`ai-colleague-mermaid-${renderSeq}`, code)
  // mermaid 的节点文字用 foreignObject（HTML 标签）排版；以 <img> 呈现时不会执行任何内容
  return sanitizeSvg(svg, { allowForeignObject: true })
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function AiDiagramBlock({
  language,
  code,
  streaming,
}: {
  language: DiagramLanguage
  code: string
  /** 回答仍在流式输出：代码块可能没写完，先不渲染。 */
  streaming: boolean
}) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  const [showSource, setShowSource] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [svg, setSvg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [frameHeight, setFrameHeight] = React.useState(240)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const source = code.replace(/\n$/, '')
  // 图里的文字跟随简繁切换：图是图片 / iframe，DOM 层转换不到，渲染前先转（只动中文字，不影响语法）
  const { display } = useVariantText()
  const rendered = React.useMemo(() => display(source), [display, source])

  React.useEffect(() => {
    if (streaming) return
    let cancelled = false
    setError(null)
    if (language === 'mermaid') {
      setSvg(null)
      renderMermaid(rendered, dark)
        .then((markup) => {
          if (!cancelled) setSvg(markup)
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setError(reason instanceof Error ? reason.message.split('\n')[0]! : '图形语法有误')
          }
        })
    } else if (language === 'svg') {
      const markup = sanitizeSvg(rendered)
      if (/<svg[\s>]/i.test(markup)) setSvg(markup)
      else setError('不是有效的 SVG')
    }
    return () => {
      cancelled = true
    }
  }, [language, rendered, dark, streaming])

  const copySource = () => {
    void copyTextToClipboard(source).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  // 原生 Fullscreen API：Esc 退出时 fullscreenchange 同步状态，布局随状态还原。
  React.useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement === stageRef.current) {
      void document.exitFullscreen()
    } else {
      void stageRef.current?.requestFullscreen()
    }
  }

  const download = () => {
    if (language === 'html') {
      downloadText('ai-diagram.html', buildSandboxedHtml(rendered, dark), 'text/html')
    } else if (svg) {
      downloadText('ai-diagram.svg', svg, 'image/svg+xml')
    }
  }

  const toolButton =
    'inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-[10px] text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] disabled:opacity-40'

  return (
    <figure
      data-ai-diagram={language}
      data-diagram-state={streaming ? 'streaming' : error ? 'error' : 'ready'}
      className="my-2 overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
    >
      <figcaption className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-2 py-1">
        <span className="flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
          <ImageIcon className="h-3 w-3" aria-hidden />
          {LANGUAGE_LABEL[language]}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            className={toolButton}
            onClick={() => setShowSource((value) => !value)}
            aria-pressed={showSource}
            data-diagram-toggle-source
          >
            <Code2 className="h-3 w-3" aria-hidden />
            {showSource ? '看图' : '源码'}
          </button>
          <button type="button" className={toolButton} onClick={copySource}>
            {copied ? (
              <Check className="h-3 w-3" aria-hidden />
            ) : (
              <Copy className="h-3 w-3" aria-hidden />
            )}
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            className={toolButton}
            onClick={download}
            disabled={streaming || (language !== 'html' && !svg)}
          >
            <Download className="h-3 w-3" aria-hidden />
            下载
          </button>
          <button
            type="button"
            className={toolButton}
            onClick={toggleFullscreen}
            disabled={showSource || streaming || (language !== 'html' && !svg)}
            aria-pressed={isFullscreen}
            data-diagram-fullscreen
          >
            {isFullscreen ? (
              <Minimize2 className="h-3 w-3" aria-hidden />
            ) : (
              <Maximize2 className="h-3 w-3" aria-hidden />
            )}
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
        </span>
      </figcaption>

      {showSource || error ? (
        <div>
          {error ? (
            <p className="px-2 pt-1.5 text-[11px] text-[var(--nx-status-warning)]" role="alert">
              图没能画出来（{error}），下面是原始代码。
            </p>
          ) : null}
          <pre className="m-0 max-h-80 overflow-auto p-2 text-[11px] leading-4 text-[var(--nx-text-secondary)]">
            <code>{source}</code>
          </pre>
        </div>
      ) : streaming ? (
        <p className="flex items-center gap-1.5 px-3 py-4 text-xs text-[var(--nx-text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          正在绘图…
        </p>
      ) : language === 'html' ? (
        <div
          ref={stageRef}
          data-diagram-stage
          className={cn(isFullscreen && 'h-full w-full bg-[var(--nx-bg-0)]')}
        >
          <iframe
            title="AI 图示"
            data-diagram-frame
            // 不给 allow-scripts：iframe 里的任何脚本都不会执行；同源只用于量高度
            sandbox="allow-same-origin"
            srcDoc={buildSandboxedHtml(rendered, dark)}
            onLoad={(event) => {
              const doc = event.currentTarget.contentDocument
              const height = doc?.documentElement?.scrollHeight
              if (height) setFrameHeight(Math.min(640, Math.max(80, height)))
            }}
            className="block w-full border-0"
            style={{ height: isFullscreen ? '100%' : frameHeight }}
          />
        </div>
      ) : svg ? (
        <div
          ref={stageRef}
          data-diagram-stage
          className={cn(
            'bg-[var(--nx-bg-0)]',
            isFullscreen && 'flex h-full w-full items-center justify-center',
          )}
        >
          <div
            data-diagram-svg
            className={cn(
              'flex w-full justify-center overflow-auto p-2',
              isFullscreen && 'h-full items-center',
            )}
          >
            <img
              src={svgDataUri(svg)}
              alt={LANGUAGE_LABEL[language]}
              className={cn('h-auto max-w-full', isFullscreen ? 'max-h-full' : 'max-h-[520px]')}
            />
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 px-3 py-4 text-xs text-[var(--nx-text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          正在绘图…
        </p>
      )}
    </figure>
  )
}

export default AiDiagramBlock
