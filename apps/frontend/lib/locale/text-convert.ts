/**
 * 文字变体的程序化转换（给运行时 DOM 层够不到的地方用）。
 *
 * DOM 层按设计不碰输入框的值、<pre>/<code>、图片与 iframe。AI 写的内容常常落在这些地方
 * （可编辑的 AI 草稿、实时输出、AI 画的图），这里提供同一套转换：
 * - display：简体 → 当前变体（台繁 / 港繁，含 glossary 词汇覆写）；
 * - canonical：当前变体 → 简体（用户在繁体界面里改了 AI 写的内容，存回去仍是简体，
 *   与「简体为唯一事实来源」一致，简体界面的人看到的不会是繁体）。
 *
 * opencc-js 词典较大，按需加载、模块级缓存一次；加载完成前原样返回。
 */
import type { ConverterFunction } from 'opencc-js'
import glossary from './glossary'
import { registerConvertedOutput } from './converted-outputs'

export type ConvertibleVariant = 'tw' | 'hk'

interface GlossaryEntry {
  s: string
  tw?: string
  hk?: string
}

const glossaryEntries = (Array.isArray(glossary) ? glossary : []) as readonly GlossaryEntry[]

/**
 * opencc 结果再套 glossary 覆写：把 opencc(entry.s) 的结果替换为 entry[variant]。
 * 与运行时 DOM 层同一规则（dom-converter 也调用这里）。
 */
export function applyGlossary(
  text: string,
  variant: ConvertibleVariant,
  toVariant: ConverterFunction,
): string {
  let out = toVariant(text)
  for (const entry of glossaryEntries) {
    const replacement = variant === 'tw' ? entry.tw : entry.hk
    if (!replacement) continue
    const from = toVariant(entry.s)
    if (!from || from === replacement) continue
    if (out.includes(from)) out = out.split(from).join(replacement)
  }
  return out
}

export interface TextConverters {
  display(variant: ConvertibleVariant, text: string): string
  canonical(variant: ConvertibleVariant, text: string): string
}

let loaded: TextConverters | null = null
let loading: Promise<TextConverters> | null = null

/** 已加载的转换器（未加载返回 null，不触发加载）。 */
export function loadedTextConverters(): TextConverters | null {
  return loaded
}

/** 按需加载转换器（幂等）。 */
export function loadTextConverters(): Promise<TextConverters> {
  loading ??= import('opencc-js').then((mod) => {
    const toVariant = {
      tw: mod.Converter({ from: 'cn', to: 'twp' }),
      hk: mod.Converter({ from: 'cn', to: 'hk' }),
    }
    const toCn = {
      tw: mod.Converter({ from: 'twp', to: 'cn' }),
      hk: mod.Converter({ from: 'hk', to: 'cn' }),
    }
    loaded = {
      display(variant, text) {
        if (!text) return text
        const out = applyGlossary(text, variant, toVariant[variant])
        // 与 DOM 层共享「可信输出」：同值文本节点不再被二次转换
        registerConvertedOutput(out)
        return out
      },
      canonical(variant, text) {
        if (!text) return text
        return toCn[variant](text)
      },
    }
    return loaded
  })
  return loading
}
