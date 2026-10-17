/**
 * AI 同事 · 路由前的繁转简（只用于本地规则判断，交给模型的仍是用户原话）。
 *
 * 快捷规则与「像不像要做事」的判断全部按简体中文书写；「帶我去風險管理」「打開項目一」
 * 这类繁体输入此前一条都匹配不上，只能落到问答通道、得到一个链接。这里用界面已有的
 * opencc-js（台湾词汇 → 大陆简体，含「專案 → 项目」这类词组）先转换再判断。
 * 词典较大，首次使用时才懒加载并缓存；加载失败时原样返回，不影响使用。
 */
import { getVariant } from '@/lib/locale/variant-store'
import { TRADITIONAL_ONLY_CHARS } from '@/lib/next/ai-colleague-traditional-chars'

type Convert = (text: string) => string

let converterPromise: Promise<Convert> | null = null

function loadConverter(): Promise<Convert> {
  converterPromise ??= import('opencc-js').then((mod) => mod.Converter({ from: 'twp', to: 'cn' }))
  return converterPromise
}

/** 含任一繁体专用字才转换；纯简体不加载词典、不多等。 */
const TRADITIONAL_CHAR_SET: ReadonlySet<string> = new Set(TRADITIONAL_ONLY_CHARS)

/** 这句话是否需要先繁转简（含常用繁体专用字）。 */
export function needsRoutingConversion(text: string): boolean {
  for (const char of text) {
    if (TRADITIONAL_CHAR_SET.has(char)) return true
  }
  return false
}

export async function toSimplifiedForRouting(text: string): Promise<string> {
  if (!needsRoutingConversion(text)) return text
  try {
    const convert = await loadConverter()
    return convert(text)
  } catch {
    converterPromise = null
    return text
  }
}

/** 面板打开时预热词典（界面是繁体时才预热，简体用户不多下载），避免第一句话多等一下。 */
export function preloadColleagueNormalizer(): void {
  if (getVariant() === 'cn') return
  void loadConverter().catch(() => {
    converterPromise = null
  })
}
