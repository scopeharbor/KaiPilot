import { type FencedCodeBlockMeta, SUPPORTED_CODE_LANGUAGES } from '@aiproj/types'

/**
 * 确定性围栏代码块提取器（v3-document-code-block-support §D6）。
 *
 * 逐行扫描 backtick/tilde 围栏，提取 FencedCodeBlockMeta[]。
 * - 处理 ≤3 空格缩进的围栏
 * - info string 取首个 token 为语言（小写）
 * - 未闭合围栏标记 closed:false，仍返回
 * - 不改变输入、不引入 markdown 解析器
 *
 * 纯函数：同一输入两次调用结果深等。
 */
export function extractFencedCodeBlocks(normalized: string): FencedCodeBlockMeta[] {
  if (!normalized || normalized.length === 0) return []

  const lines = normalized.split('\n')
  const blocks: FencedCodeBlockMeta[] = []
  let inFence = false
  let fenceMarker = '' // '```' or '~~~'
  let infoToken: string | null = null
  let startLine = 0
  let contentStartLine = 0

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]

    if (!inFence) {
      // 检查是否进入围栏
      const trimmed = rawLine.trimStart()
      const indent = rawLine.length - trimmed.length

      if (indent <= 3) {
        const parsed = parseFenceOpen(trimmed)
        if (parsed) {
          inFence = true
          fenceMarker = parsed.marker
          infoToken = parsed.language
          startLine = i + 1 // 1-based
          contentStartLine = i + 2 // 下一行开始是内容
          continue
        }
      }
    } else {
      // 在围栏内：检查是否闭合
      const trimmed = rawLine.trimStart()
      const indent = rawLine.length - trimmed.length

      if (indent <= 3 && trimmed.startsWith(fenceMarker) && isClosingFence(trimmed, fenceMarker)) {
        // 围栏闭合
        const endLine = i + 1
        const contentLines = lines.slice(contentStartLine - 1, i) // 排除闭合行
        const body = contentLines.join('\n')

        blocks.push({
          language: infoToken,
          labeled: infoToken !== null,
          supported: infoToken !== null && isRegisteredLanguage(infoToken),
          startLine,
          endLine,
          lineCount: contentLines.length,
          byteCount: Buffer.byteLength(body, 'utf8'),
          closed: true,
        })

        inFence = false
        fenceMarker = ''
        infoToken = null
        startLine = 0
        contentStartLine = 0
      }
    }
  }

  // 处理未闭合围栏
  if (inFence) {
    const contentLines = lines.slice(contentStartLine - 1)
    const body = contentLines.join('\n')

    blocks.push({
      language: infoToken,
      labeled: infoToken !== null,
      supported: infoToken !== null && isRegisteredLanguage(infoToken),
      startLine,
      endLine: lines.length,
      lineCount: contentLines.length,
      byteCount: Buffer.byteLength(body, 'utf8'),
      closed: false,
    })
  }

  return blocks
}

/**
 * 解析围栏起始行。返回 { marker, language } 或 null。
 * 支持 ``` 和 ~~~ 两种围栏。
 */
function parseFenceOpen(trimmed: string): { marker: string; language: string | null } | null {
  // 三个或以上 backtick
  const backtickMatch = trimmed.match(/^(`{3,})\s*(\S*)/)
  if (backtickMatch) {
    const marker = '```'
    const infoString = backtickMatch[2]
    const language = extractLanguage(infoString)
    return { marker, language }
  }

  // 三个或以上 tilde
  const tildeMatch = trimmed.match(/^(~{3,})\s*(\S*)/)
  if (tildeMatch) {
    const marker = '~~~'
    const infoString = tildeMatch[2]
    const language = extractLanguage(infoString)
    return { marker, language }
  }

  return null
}

/**
 * 从 info string 提取语言标识。
 * 取首个空格/制表符前的 token，转小写；空则返回 null。
 */
function extractLanguage(infoString: string): string | null {
  if (!infoString) return null
  const token = infoString.split(/\s/)[0]
  if (!token) return null
  return token.toLowerCase()
}

/**
 * 判断是否为闭合围栏。
 * 闭合行必须是 backtick/tilde 围栏且 info string 排除了非空语言标记。
 * （根据 CommonMark spec，闭合行仅由围栏字符+空白组成）
 */
function isClosingFence(trimmed: string, marker: string): boolean {
  if (!trimmed.startsWith(marker)) return false
  // 闭合行必须只有围栏字符和空白，不能有语言标记
  const afterMarker = trimmed.slice(marker.length)
  return afterMarker.trim().length === 0
}

/**
 * 检查语言是否在 supported 白名单中。
 */
function isRegisteredLanguage(lang: string): boolean {
  return (SUPPORTED_CODE_LANGUAGES as readonly string[]).includes(lang)
}
