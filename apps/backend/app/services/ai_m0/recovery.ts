/**
 * ai-structured-output-poc / M0 —— 六类错误恢复层。
 *
 * spec 硬约束「六类错误均有恢复路径」：truncated / malformed_json / field_missing_or_type_error /
 * token_limit_exceeded / sse_interrupted / model_refusal_or_empty。
 *
 * 本文件提供两级恢复：
 *   1) `preClean(raw)` —— 轻量文本清洗（剥 markdown 代码块、去 BOM、修尾逗号、修单/双引号混用）；
 *   2) `attemptRepair(raw, issues)` —— 结合 zod issues 做启发式修补：补缺 marker、把 markdown 引号
 *      归一、把不完整 JSON 尾部截断到最后一个合法 `}` 的位置。
 *
 * 恢复策略是**保守**的：只做「显然可救」的编辑，不改语义。任何修补都会把 outcome bucket 归为
 * `repaired`（而非 `strict`），供 judge 分档。
 */

import type { AiM0ErrorKind } from '@aiproj/types'

export interface CleanResult {
  cleaned: string
  applied: string[]
}

/** 去掉最常见的干扰：markdown code fence、BOM、前后空白。 */
export function preClean(raw: string): CleanResult {
  const applied: string[] = []
  let out = raw
  // BOM
  if (out.charCodeAt(0) === 0xfeff) {
    out = out.slice(1)
    applied.push('strip_bom')
  }
  // ```json ... ``` 或 ``` ... ```
  const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    out = fence[1]
    applied.push('strip_code_fence')
  }
  const firstBrace = out.indexOf('{')
  if (firstBrace > 0) {
    out = out.slice(firstBrace)
    applied.push('trim_before_first_brace')
  }
  // 尾部截断到最后一个 `}` —— 保守剪断，避免尾部半句话破坏 JSON。
  const lastBrace = out.lastIndexOf('}')
  if (lastBrace >= 0 && lastBrace < out.length - 1) {
    const tail = out.slice(lastBrace + 1).trim()
    // 只在尾部剩余非空白且不是合法 JSON 尾时剪断，避免误伤（如 `}\n`）。
    if (tail.length > 0) {
      out = out.slice(0, lastBrace + 1)
      applied.push('trim_after_last_brace')
    }
  }
  // 尾逗号 `,}` 或 `,]`
  const trimmed = out.replace(/,(\s*[}\]])/g, '$1')
  if (trimmed !== out) {
    out = trimmed
    applied.push('remove_trailing_comma')
  }
  return { cleaned: out.trim(), applied }
}

/**
 * 从模型回复中提取所有闭合的顶层 JSON 对象候选。模型偶尔会在正式 JSON 前先
 * 输出一个带花括号的说明片段；只用 firstBrace/lastBrace 会把两段拼成非法 JSON。
 */
function balancedObjectCandidates(raw: string): string[] {
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char !== '}' || depth === 0) continue
    depth -= 1
    if (depth === 0 && start >= 0) {
      candidates.push(raw.slice(start, index + 1))
      start = -1
    }
  }
  return candidates.sort((left, right) => right.length - left.length).slice(0, 8)
}

/** 只在 JSON 字符串内部转义模型偶发输出的裸换行/制表符，不改动结构字符。 */
function escapeRawControlsInStrings(raw: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (const char of raw) {
    if (!inString) {
      out += char
      if (char === '"') inString = true
      continue
    }
    if (escaped) {
      out += char
      escaped = false
      continue
    }
    if (char === '\\') {
      out += char
      escaped = true
      continue
    }
    if (char === '"') {
      out += char
      inString = false
      continue
    }
    if (char === '\n') out += '\\n'
    else if (char === '\r') out += '\\r'
    else if (char === '\t') out += '\\t'
    else out += char
  }
  return out
}

/**
 * 尝试将 raw 文本解析为 JSON；先尝试 JSON.parse，失败则 preClean 后重试。
 * 返回 { ok, value, appliedFixes }，供三档判定使用（`strict` 要求 appliedFixes 为空）。
 */
export interface ParseAttempt {
  ok: boolean
  value?: unknown
  appliedFixes: string[]
  errorKind?: AiM0ErrorKind
}

/** 结尾允许补齐的最多收尾括号数：更多就更像是被截断，而不是漏写。 */
const MAX_MISSING_CLOSERS = 2

/**
 * 模型把内容写完了、只漏了最后一两个收尾括号（实测 gpt-5.6-luna 资源阶段 2.2 万字符完整输出，
 * 结尾 `…]}` 少了关闭顶层对象的 `}`，整段被判非法重跑 4 分钟）。
 *
 * 只在「确实是漏写」时补齐：结尾不在字符串里、最后一个字符是完整值的结尾（不是 `,` / `:`），
 * 且缺的括号不超过 2 个；否则返回 null，按原失败处理（截断仍走重试，不接受残缺内容）。
 */
export function closeUnbalancedTail(text: string): string | null {
  const trimmed = text.trimEnd()
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const char of trimmed) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return null
    }
  }
  if (inString || stack.length === 0 || stack.length > MAX_MISSING_CLOSERS) return null
  if (!/(?:[}\]"\d]|true|false|null)$/.test(trimmed)) return null
  if (/[,:]$/.test(trimmed)) return null
  return trimmed + stack.reverse().join('')
}

export function tryParseJson(raw: string): ParseAttempt {
  // 一次直接尝试
  try {
    return { ok: true, value: JSON.parse(raw), appliedFixes: [] }
  } catch {
    // 走清洗
  }
  const { cleaned, applied } = preClean(raw)
  try {
    return { ok: true, value: JSON.parse(cleaned), appliedFixes: applied }
  } catch (err: any) {
    for (const candidate of balancedObjectCandidates(cleaned)) {
      try {
        return {
          ok: true,
          value: JSON.parse(candidate),
          appliedFixes: [...applied, 'extract_balanced_json_object'],
        }
      } catch {
        const escapedControls = escapeRawControlsInStrings(candidate)
        if (escapedControls === candidate) continue
        try {
          return {
            ok: true,
            value: JSON.parse(escapedControls),
            appliedFixes: [
              ...applied,
              'extract_balanced_json_object',
              'escape_raw_string_controls',
            ],
          }
        } catch {
          // 尝试下一个有界候选。
        }
      }
    }
    const closed = closeUnbalancedTail(cleaned)
    if (closed !== null) {
      try {
        return {
          ok: true,
          value: JSON.parse(closed),
          appliedFixes: [...applied, 'close_unbalanced_tail'],
        }
      } catch {
        // 补齐后仍非法：按原错误分类。
      }
    }
    // 判定错误分类
    const msg = String(err?.message ?? '').toLowerCase()
    let kind: AiM0ErrorKind = 'malformed_json'
    if (msg.includes('unexpected end') || msg.includes('unterminated')) {
      kind = 'truncated'
    }
    return { ok: false, appliedFixes: applied, errorKind: kind }
  }
}

/**
 * 判定字符串是否「疑似截断」：常见征兆是缺少匹配的括号。
 * 用于 gateway 层在 finish_reason=length 时决定重试策略。
 */
export function looksTruncated(raw: string): boolean {
  const opens = (raw.match(/[{[]/g) ?? []).length
  const closes = (raw.match(/[}\]]/g) ?? []).length
  return opens > closes
}
