/**
 * 长需求整理（2026-09-27）。
 *
 * 需求原文最多 5 万字，原文始终完整保存；超过 BRIEF_THRESHOLD_CHARS 时先整理成「需求清单」：
 * 逐条保留所有具体事项（功能点、数字、日期、角色、约束、验收），只合并重复、去掉客套，
 * 不做概括；每条标注出自原文第几段，便于用户核对、防止编造。
 *
 * 用法分层：追问每答一题都调模型，读整理稿（省时省钱）；项目理解只读一次，读全文 + 整理稿；
 * 拆解每项能力时从整理稿里挑相关条目，后续阶段也拿得到细节。
 */
import type { GenerateOptions, GenerateResult } from '#services/ai_m0/gateway'

/** 超过这个长度才整理；以内的需求各阶段直接读全文。 */
export const BRIEF_THRESHOLD_CHARS = 8_000
/** 原文上限（前后端校验一致）。 */
export const REQUIREMENT_INPUT_MAX_CHARS = 50_000
const BRIEF_MIN_CHARS = 6_000
const BRIEF_MAX_CHARS = 20_000

interface BriefGateway {
  generate(options: GenerateOptions): Promise<GenerateResult>
}

/** 整理稿篇幅：约原文的 40%，6,000–20,000 字之间。 */
export function briefBudget(rawLength: number): number {
  return Math.min(BRIEF_MAX_CHARS, Math.max(BRIEF_MIN_CHARS, Math.round(rawLength * 0.4)))
}

export function needsRequirementBrief(rawInput: string): boolean {
  return rawInput.trim().length > BRIEF_THRESHOLD_CHARS
}

/** 原文按空行 / 换行切段并编号（整理稿用「〔段N〕」回指）。 */
export function numberParagraphs(rawInput: string): string {
  return rawInput
    .split(/\n\s*\n|\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => `〔段${index + 1}〕${paragraph}`)
    .join('\n')
}

const SYSTEM_PROMPT = `你是项目需求整理员。把用户给的需求原文整理成一份「需求清单」，供后续规划使用。
规则：
1. 这是整理，不是摘要：原文里每一个具体事项都要保留——功能点、业务规则、数字、日期、人名代号、角色、系统名、约束、验收标准、风险。宁可多留，不可漏掉。
2. 只做三件事：合并重复表述、去掉客套与无信息的话、把散落的同类事项归到同一小节。
3. 不得添加原文没有的内容，不得推测、不得改写数字和名称。「成员#N」这类代号原样保留。
4. 每条末尾标注出处，格式「〔段N〕」（可多个，如「〔段3〕〔段7〕」），N 是原文里的段落编号。
5. 按以下小节组织（原文没有的小节省略）：项目目标与背景 / 范围与功能清单 / 业务规则 / 时间与里程碑 / 团队与角色 / 约束与限制 / 验收标准 / 风险与疑问 / 其他要点。
6. 每条一行，以「- 」开头；用简体中文；直接输出清单正文，不要前言、不要 JSON。`

/** 让模型整理需求清单；失败时抛错，由调用方决定是否退回直接使用原文。 */
export async function buildRequirementBrief(args: {
  rawInput: string
  gateway: BriefGateway
  signal?: AbortSignal
}): Promise<string> {
  const raw = args.rawInput.trim().slice(0, REQUIREMENT_INPUT_MAX_CHARS)
  const budget = briefBudget(raw.length)
  const generated = await args.gateway.generate({
    sentence: '整理需求清单（保留全部具体事项）',
    promptName: 'intent.requirement_brief',
    promptSet: {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `整理稿篇幅约 ${budget} 字以内（内容多时可以写满，但不要超过 ${Math.round(budget * 1.2)} 字）。\n\n需求原文（已按段编号）：\n${numberParagraphs(raw)}`,
    },
    strategy: 'prompt',
    temperature: 0.1,
    // 中文约 1 字 ≈ 1–1.5 token，留足余量避免截断。
    maxOutputTokens: Math.round(budget * 2),
    ...(args.signal ? { signal: args.signal } : {}),
  })
  if (generated.triggeredErrors.length > 0) {
    throw new Error(
      `需求整理失败：${(generated.triggeredErrorMessages ?? generated.triggeredErrors).join('；')}`,
    )
  }
  const brief = generated.rawText
    .replace(/^```[a-z]*\s*/iu, '')
    .replace(/```\s*$/u, '')
    .trim()
  if (brief.length < 200) throw new Error('需求整理结果过短，未通过检查')
  return brief.slice(0, Math.round(BRIEF_MAX_CHARS * 1.2))
}

/**
 * 追问、解释等「每轮都调」的环节读哪份需求：有整理稿读整理稿，否则读原文（原文以内不超过阈值）。
 */
export function requirementTextForPrompt(rawInput: string, brief?: string | null): string {
  if (brief && brief.trim()) return brief.trim().slice(0, Math.round(BRIEF_MAX_CHARS * 1.2))
  return rawInput.trim().slice(0, BRIEF_THRESHOLD_CHARS)
}

/**
 * 从整理稿里挑与某项能力相关的条目（按双字重合打分），拆解该能力时带上，避免细节只停留在理解层。
 */
export function relevantBriefLines(brief: string | null | undefined, topic: string, limit = 3_000) {
  if (!brief) return ''
  const grams = (text: string) => {
    const compact = text.replace(/[^㐀-鿿A-Za-z0-9]/gu, '')
    const set = new Set<string>()
    for (let index = 0; index < compact.length - 1; index++)
      set.add(compact.slice(index, index + 2))
    return set
  }
  const target = grams(topic)
  if (target.size === 0) return ''
  const entries = brief
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line, order) => ({ line, order, grams: grams(line) }))
  // 在大量条目里都出现的字眼（「项目」「系统」）不说明相关性。
  const frequency = new Map<string, number>()
  for (const entry of entries)
    for (const gram of entry.grams) frequency.set(gram, (frequency.get(gram) ?? 0) + 1)
  const common = entries.length >= 5 ? entries.length * 0.4 : Number.POSITIVE_INFINITY
  const scored = entries
    .map((entry) => {
      let overlap = 0
      for (const gram of entry.grams) {
        if (target.has(gram) && (frequency.get(gram) ?? 0) <= common) overlap++
      }
      return {
        line: entry.line,
        order: entry.order,
        overlap,
        score: overlap / Math.sqrt(entry.grams.size + 1),
      }
    })
    .filter((item) => item.overlap >= 1)
    .sort((a, b) => b.score - a.score)
  const picked: typeof scored = []
  let used = 0
  for (const item of scored) {
    if (used + item.line.length > limit) continue
    picked.push(item)
    used += item.line.length + 1
  }
  return picked
    .sort((a, b) => a.order - b.order)
    .map((item) => item.line)
    .join('\n')
}
