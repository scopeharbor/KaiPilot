// AI 同事 —— 辅助能力（零写入）：
// - describePage：页面截图 → 能看图的模型描述成文字（「看一眼当前页面」），交给操作理解 / 问答作为页面语境；
// - suggestReplies：按对话与正在回答的问题，给出 1–3 条用户可能要说的话（输入框里按 Tab 采用）。
// - chooseTheaterAnswer：全自动一键生成时，由模型独立审阅生成剧场的一个追问与它的全部选项
//   （含推荐标记、默认值、选项说明），结合项目原话与之前的回答选出答案并说明理由；
//   推荐 / 默认只是参考，不是自动采纳。只回答问题，不写任何业务数据。
//
// 看图模型的挑选顺序与需求附件识别一致：当前选用的模型（若能看图）→ 组织里能看图的模型 → OCR 模型。
// 只认组织自己配置的真实连接（source=user），不落到无 key 联调 Mock。
import ApiException from '#exceptions/api_exception'
import type User from '#models/user'
import AiToolsPolicy from '#policies/ai_tools_policy'
import MemberDirectoryService, {
  pseudonymizeText,
  resolveAliasesToNames,
} from '#services/ai_colleague/member_directory_service'
import { extractJsonObject } from '#services/ai_colleague/action_planner_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import SearchPolicy from '#policies/search_policy'
import type { AiModelCapability } from '@aiproj/types'
import { inject } from '@adonisjs/core'

/** 看图描述的提示：说清页面是什么、有哪些区域与数据、能做什么。 */
export const PAGE_VISION_PROMPT =
  '这是项目管理平台「开项」的一张页面截图。请用简体中文描述：1) 这是什么页面（标题、所在模块）；2) 页面上的主要区域与其中看得到的数据（列表、卡片、图表、数字，尽量照抄文字）；3) 页面上有哪些按钮与可执行的操作；4) 是否有弹窗、报错或提示。只描述看到的内容，不要编造。'

/** 输入建议最多几条。 */
export const COLLEAGUE_SUGGESTION_MAX = 3

export interface DescribePageInput {
  user: User
  organizationId: number
  imageDataUrl: string
  question?: string | null
  connectionId?: number | null
  modelId?: number | null
}

export interface SuggestRepliesInput {
  user: User
  organizationId: number
  conversation: readonly { role: 'user' | 'assistant'; text: string }[]
  question?: string | null
  options?: readonly string[]
  draft?: string | null
  connectionId?: number | null
  modelId?: number | null
}

/** 规范化建议：去空去重、限长、不与已输入内容重复，最多 3 条。 */
export function normalizeSuggestions(raw: unknown, draft: string | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const result: string[] = []
  const typed = (draft ?? '').trim()
  for (const item of list) {
    if (typeof item !== 'string') continue
    let text = item.trim().replace(/\s+/g, ' ')
    if (!text) continue
    if (text.length > 200) text = text.slice(0, 200)
    // 补全：建议必须以已输入内容开头；不是的话丢弃
    if (typed && !text.startsWith(typed)) continue
    if (text === typed || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= COLLEAGUE_SUGGESTION_MAX) break
  }
  return result
}

export interface TheaterQuestionOption {
  label: string
  value: string | number
  description?: string | null
  recommended?: boolean
}

export interface TheaterQuestion {
  title: string
  description?: string | null
  reasoning?: string | null
  questionType: 'single_choice' | 'multi_choice' | 'number' | 'date' | 'text'
  options: readonly TheaterQuestionOption[]
  /** 允许自填（剧场题都有自填框）。 */
  customInput?: boolean
  defaultValue?: string | number | string[] | null
  suggestedValue?: string | number | string[] | null
  allowSkip?: boolean
  isRequired?: boolean
}

export interface ChooseTheaterAnswerInput {
  user: User
  organizationId: number
  projectInput: string
  /** 之前已经回答过的问题（题目 → 答案文字），保持前后一致。 */
  previousAnswers?: readonly { question: string; answer: string }[]
  question: TheaterQuestion
  connectionId?: number | null
  modelId?: number | null
}

export interface TheaterChoice {
  action: 'answer' | 'default' | 'skip'
  value: string | number | string[] | null
  reason: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 模型的选择 → 剧场能收的答案（防幻觉：选项只认题目里真有的；题型不符的丢弃；
 * 不能跳过的题不许跳过；没有默认值的题不许「用默认值」）。给不出合法答案返回 null。
 */
export function normalizeTheaterChoice(
  raw: Record<string, unknown> | null,
  question: TheaterQuestion,
): TheaterChoice | null {
  if (!raw) return null
  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 300) : ''
  const action = raw.action
  if (action === 'skip') {
    return question.allowSkip ? { action: 'skip', value: null, reason } : null
  }
  if (action === 'default') {
    const fallback = question.defaultValue
    return fallback === undefined || fallback === null
      ? null
      : { action: 'default', value: fallback, reason }
  }
  const matchOption = (item: unknown) => {
    const text =
      typeof item === 'number' ? String(item) : typeof item === 'string' ? item.trim() : ''
    if (!text) return null
    return (
      question.options.find((option) => String(option.value) === text) ??
      question.options.find((option) => option.label === text) ??
      null
    )
  }
  const custom = (item: unknown) =>
    question.customInput !== false && typeof item === 'string' && item.trim()
      ? item.trim().slice(0, 500)
      : null
  const value = raw.value
  switch (question.questionType) {
    case 'multi_choice': {
      const items = Array.isArray(value)
        ? value
        : value === undefined || value === null
          ? []
          : [value]
      const picked: string[] = []
      for (const item of items) {
        const option = matchOption(item)
        const text = option ? String(option.value) : custom(item)
        if (text && !picked.includes(text)) picked.push(text)
      }
      return picked.length > 0 ? { action: 'answer', value: picked.slice(0, 20), reason } : null
    }
    case 'single_choice': {
      const option = matchOption(Array.isArray(value) ? value[0] : value)
      if (option) return { action: 'answer', value: option.value, reason }
      const text = custom(Array.isArray(value) ? value[0] : value)
      return text ? { action: 'answer', value: text, reason } : null
    }
    case 'number': {
      const option = matchOption(value)
      if (option) return { action: 'answer', value: option.value, reason }
      const number = typeof value === 'number' ? value : Number(String(value ?? '').trim())
      return Number.isFinite(number) && String(value ?? '').trim() !== ''
        ? { action: 'answer', value: number, reason }
        : null
    }
    case 'date': {
      const option = matchOption(value)
      if (option) return { action: 'answer', value: option.value, reason }
      const text = typeof value === 'string' ? value.trim() : ''
      return ISO_DATE.test(text) && !Number.isNaN(Date.parse(text))
        ? { action: 'answer', value: text, reason }
        : null
    }
    default: {
      const option = matchOption(value)
      if (option) return { action: 'answer', value: option.value, reason }
      const text = typeof value === 'string' ? value.trim().slice(0, 500) : ''
      return text ? { action: 'answer', value: text, reason } : null
    }
  }
}

@inject()
export default class AiColleagueAssistService {
  constructor(
    private policy: AiToolsPolicy,
    private searchPolicy: SearchPolicy,
  ) {}

  /** 测试可覆写。 */
  adapterResolver: typeof resolveAdapter = resolveAdapter

  async describePage(input: DescribePageInput): Promise<{ description: string; model: string }> {
    await this.policy.authorizeExecute(input.user, input.organizationId, [])
    const recordContext = {
      organizationId: input.organizationId,
      userId: input.user.id,
      capability: 'vision',
      surface: 'ai-colleague-page-vision',
      workflowName: 'ai-colleague-page-vision',
      source: 'user' as const,
    }
    const seeing: AiModelCapability[] = ['vision']
    const attempts: Array<Parameters<typeof resolveAdapter>[0]> = [
      ...(input.connectionId
        ? [
            {
              organizationId: input.organizationId,
              connectionId: input.connectionId,
              modelId: input.modelId ?? undefined,
              requiredCapabilities: seeing,
              recordContext,
            },
          ]
        : []),
      { organizationId: input.organizationId, requiredCapabilities: seeing, recordContext },
      { organizationId: input.organizationId, requiredCapabilities: ['ocr'], recordContext },
    ]
    const prompt = input.question?.trim()
      ? `${PAGE_VISION_PROMPT}\n用户的问题：${input.question.trim()}（描述时侧重与这个问题有关的部分）`
      : PAGE_VISION_PROMPT
    const seen = new Set<string>()
    const failures: string[] = []
    for (const attempt of attempts) {
      const resolved = await this.adapterResolver(attempt).catch(() => null)
      if (!resolved || resolved.unavailable || resolved.source !== 'user') continue
      const key = `${resolved.connectionId}:${resolved.modelId}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const result = await resolved.gateway.ocrPreview({
          imageDataUrl: input.imageDataUrl,
          promptHint: prompt,
          signal: AbortSignal.timeout(120_000),
        })
        if (result.ok && result.extractedText?.trim()) {
          return {
            description: result.extractedText.trim().slice(0, 6000),
            model: `${resolved.provider}/${resolved.model}`,
          }
        }
        failures.push(result.errorMessage ?? '模型没有返回描述')
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    throw new ApiException(
      seen.size === 0
        ? '组织里没有能看图的模型：请在「AI 连接」里给某个模型勾选「视觉」能力'
        : `看图模型没能描述这个页面（${failures[0] ?? '未知原因'}）`,
      { status: 503, code: 'AI_SERVICE_ERROR' },
    )
  }

  async suggestReplies(input: SuggestRepliesInput): Promise<{ suggestions: string[] }> {
    await this.policy.authorizeExecute(input.user, input.organizationId, [])
    const allowed = await this.searchPolicy.getAllowedProjectIds(input.user, input.organizationId)
    const members = await new MemberDirectoryService().listMembers(input.organizationId, allowed)
    const names = new Map(members.map((member) => [member.aliasCode, member.name]))
    const resolved = await this.adapterResolver({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? undefined,
      modelId: input.modelId ?? undefined,
      requiredCapabilities: ['chat'],
      recordContext: {
        organizationId: input.organizationId,
        userId: input.user.id,
        capability: 'chat',
        surface: 'ai-colleague-suggest',
        workflowName: 'ai-colleague-suggest',
        source: 'user',
      },
    })
    if (resolved.source === 'mock') return { suggestions: [] }
    const generated = await resolved.gateway.generate({
      sentence: input.question ?? input.conversation.at(-1)?.text ?? '',
      promptSet: {
        systemPrompt: [
          '你是项目管理平台「开项」AI 同事的输入建议器：预测用户下一句最可能要说的话，供用户按 Tab 一键采用。',
          '只输出一个 JSON 对象：{"suggestions":["…","…"]}，1–3 条，最可能的放第一条；每条是用户口吻的一句完整的话（简体中文，不超过 40 字），不要解释。',
          '有 question 时：建议是对这个问题的回答（有 options 时优先从中选最合理的，可加上必要的补充）。',
          '有 draft 时：每条建议都必须以 draft 原样开头，是对它的补全。',
          '没有 question 时：根据对话给出用户接下来最可能的追问或下一步指令（如确认、查看、修改、打开某页）。',
        ].join('\n'),
        userPrompt: JSON.stringify({
          conversation: input.conversation.slice(-10).map((turn) => ({
            role: turn.role,
            text: pseudonymizeText(turn.text.slice(0, 1500), members),
          })),
          ...(input.question ? { question: pseudonymizeText(input.question, members) } : {}),
          ...(input.options && input.options.length > 0 ? { options: input.options } : {}),
          ...(input.draft ? { draft: input.draft } : {}),
        }),
      },
      strategy: 'prompt',
      temperature: 0.3,
      promptName: 'ai_colleague.suggest_replies',
      requestTimeoutMs: 60_000,
    })
    const parsed = extractJsonObject(generated.rawText)
    const suggestions = normalizeSuggestions(parsed?.suggestions, input.draft).map((text) =>
      resolveAliasesToNames(text, names),
    )
    return { suggestions }
  }
  /**
   * 全自动代答：模型独立审阅剧场的一个追问与全部选项后作答（推荐 / 默认只作参考）。
   * 只有组织自己配置的真实模型可以代答（联调 Mock 返回 null，由前端按规则兜底）。
   */
  async chooseTheaterAnswer(
    input: ChooseTheaterAnswerInput,
  ): Promise<(TheaterChoice & { model: string }) | null> {
    await this.policy.authorizeExecute(input.user, input.organizationId, [])
    const resolved = await this.adapterResolver({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? undefined,
      modelId: input.modelId ?? undefined,
      requiredCapabilities: ['chat'],
      recordContext: {
        organizationId: input.organizationId,
        userId: input.user.id,
        capability: 'chat',
        surface: 'ai-colleague-theater-answer',
        workflowName: 'ai-colleague-theater-answer',
        source: 'user',
      },
    })
    if (resolved.source === 'mock' || resolved.unavailable) return null
    const question = input.question
    const generated = await resolved.gateway.generate({
      sentence: question.title,
      promptSet: {
        systemPrompt: [
          '你是项目管理平台「开项」的 AI 同事，当前处于【全自动模式】：用户已授权由你独立回答「AI 一键生成项目」提出的全部澄清问题，过程中不会再询问用户，你必须自己做出最合理的判断（不要因为不确定就跳过或回答「待定」）。',
          '请独立审阅这个问题和它的每一个选项（label、description、recommended 标记、默认值 defaultValue、从原话解析出的 suggestedValue），结合用户的项目原话与之前的回答，选出对这个项目最合理的答案。',
          '推荐项与默认值只是参考：先逐个比较所有选项再决定；原话里已经说明的事实（suggestedValue）优先；与之前的回答保持一致。',
          '只输出一个 JSON 对象：{"action":"answer"|"default"|"skip","value":…,"reason":"一句话理由（简体中文，不超过 60 字）"}。',
          'single_choice：value 填所选选项的 value；multi_choice：value 是选项 value 的数组（可多选）；number：数字；date：YYYY-MM-DD；text：一段简洁的中文回答。',
          '选项都不合适且允许自填时，value 直接写你的回答文字。action=default 表示采用默认值（只有 defaultValue 存在时可用）；action=skip 只有 allowSkip=true 且这个问题确实与项目无关时才用。不要解释，不要输出 JSON 以外的内容。',
        ].join('\n'),
        userPrompt: JSON.stringify({
          projectInput: input.projectInput.slice(0, 4000),
          previousAnswers: (input.previousAnswers ?? []).slice(-30).map((item) => ({
            question: item.question.slice(0, 200),
            answer: item.answer.slice(0, 300),
          })),
          question: {
            title: question.title,
            description: question.description ?? undefined,
            whyAsked: question.reasoning ?? undefined,
            questionType: question.questionType,
            options: question.options.map((option) => ({
              label: option.label,
              value: option.value,
              ...(option.description ? { description: option.description } : {}),
              ...(option.recommended ? { recommended: true } : {}),
            })),
            customInput: question.customInput !== false,
            defaultValue: question.defaultValue ?? null,
            suggestedValue: question.suggestedValue ?? null,
            allowSkip: Boolean(question.allowSkip),
            isRequired: Boolean(question.isRequired),
          },
        }),
      },
      strategy: 'prompt',
      temperature: 0.2,
      promptName: 'ai_colleague.theater_answer',
      requestTimeoutMs: 90_000,
    })
    const choice = normalizeTheaterChoice(extractJsonObject(generated.rawText), question)
    return choice ? { ...choice, model: `${resolved.provider}/${resolved.model}` } : null
  }
}
