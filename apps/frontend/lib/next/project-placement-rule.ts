import { z } from 'zod'
import type { CreateProjectInput, ProjectPriority, ProjectStatus } from '@/lib/api/projects'

/**
 * 项目放置立项规则式推断引擎（v3-ui-next-batch1-strategy-launch-tasks W2 任务 2.5/2.6）。
 *
 * 严格恪守：
 * 1. 本地确定性规则推断（零外部真实模型调用）；
 * 2. RL-01：AI 只建议不自动落库，挂载琥珀色 AIMarker（confidence 0.85 / needsConfirmation true）；
 * 3. 人工显式确认（Ctrl+Enter 或点击）后才提交落库。
 */

export interface ProjectAIMarker {
  source: 'rule_based'
  confidence: number
  needsConfirmation: true
  reason: string
}

export const PROJECT_PLACEMENT_CONFIDENCE = 0.85
export const PROJECT_PLACEMENT_DEFAULT_PRIORITY: ProjectPriority = 'medium'
export const PROJECT_PLACEMENT_DEFAULT_STATUS: ProjectStatus = 'planning'

export interface ProjectPlacementDraft {
  name: string
  code: string
  priority: ProjectPriority
  status: ProjectStatus
  startDate: string
  endDate: string | null
  description: string | null
  marker: ProjectAIMarker
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 词汇到项目标识代码代号的映射表（用于辅助生成紧凑业务 code） */
const KEYWORD_CODE_MAP: Record<string, string> = {
  支付: 'PAY',
  网关: 'GW',
  电商: 'SHOP',
  商城: 'MALL',
  用户: 'USER',
  认证: 'AUTH',
  权限: 'RBAC',
  中心: 'CTR',
  系统: 'SYS',
  平台: 'PLT',
  移动: 'APP',
  前端: 'FE',
  后端: 'BE',
  数据: 'DATA',
  智能: 'AI',
  算法: 'ALG',
  协同: 'COOP',
  驾驶舱: 'CKPT',
  风控: 'RISK',
  财务: 'FIN',
  订单: 'ORD',
  营销: 'MKT',
}

/** 推断建议代码 */
export function inferProjectCode(name: string): string {
  // 1. 若名称包含英文单词，优先提取大写字母缩写
  const englishWords = name.match(/[a-zA-Z]+/g)
  if (englishWords && englishWords.length > 0) {
    const combined = englishWords.map((w) => w.toUpperCase()).join('-')
    if (combined.length <= 18) return combined
    const initials = englishWords.map((w) => (w[0] ? w[0].toUpperCase() : '')).join('')
    if (initials.length >= 2) return initials
  }

  // 2. 经典复合业务场景优先（如支付网关 -> PAY-GW）
  if (name.includes('支付') && name.includes('网关')) {
    return 'PAY-GW'
  }

  // 3. 匹配中文业务关键词组合
  const matchedCodes: string[] = []
  for (const [kw, code] of Object.entries(KEYWORD_CODE_MAP)) {
    if (name.includes(kw)) {
      matchedCodes.push(code)
    }
  }
  if (matchedCodes.length > 0) {
    return matchedCodes.slice(0, 2).join('-')
  }

  // 3. 通用兜底：PRJ-前缀加截取无特殊符号字符哈希/序号
  const clean = name.replace(/[^\w\u4e00-\u9fa5]/g, '')
  if (clean.length > 0) {
    let codeStr = 'PRJ'
    if (clean.length >= 2) {
      codeStr += `-${clean.charCodeAt(0).toString(16).slice(-2).toUpperCase()}${clean.charCodeAt(1).toString(16).slice(-2).toUpperCase()}`
    } else {
      codeStr += `-${clean.charCodeAt(0).toString(16).slice(-3).toUpperCase()}`
    }
    return codeStr
  }

  return 'PROJ-01'
}

/** 提取优先级 */
export function inferPriority(text: string): { priority: ProjectPriority; matchedText?: string } {
  if (/紧急|最高|特急|critical|p0|blocker/i.test(text)) {
    return {
      priority: 'critical',
      matchedText: text.match(/紧急|最高|特急|critical|p0|blocker/i)?.[0],
    }
  }
  if (/高优先级|高优|重要|high|p1/i.test(text)) {
    return { priority: 'high', matchedText: text.match(/高优先级|高优|重要|high|p1/i)?.[0] }
  }
  if (/低优先级|低优|次要|low|p3/i.test(text)) {
    return { priority: 'low', matchedText: text.match(/低优先级|低优|次要|low|p3/i)?.[0] }
  }
  if (/中优先级|中等|普通|medium|p2/i.test(text)) {
    return { priority: 'medium', matchedText: text.match(/中优先级|中等|普通|medium|p2/i)?.[0] }
  }
  return { priority: PROJECT_PLACEMENT_DEFAULT_PRIORITY }
}

/** 提取截止/上线日期 */
export function inferEndDate(
  text: string,
  today: Date = new Date(),
): { endDate: string | null; matchedText?: string } {
  const currentYear = today.getFullYear()

  // 1. 完整年份 YYYY-MM-DD 或 YYYY年MM月DD日
  const fullDateMatch = text.match(/(20\d\d)[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/)
  if (fullDateMatch && fullDateMatch[1] && fullDateMatch[2] && fullDateMatch[3]) {
    const y = fullDateMatch[1]
    const m = fullDateMatch[2].padStart(2, '0')
    const d = fullDateMatch[3].padStart(2, '0')
    return { endDate: `${y}-${m}-${d}`, matchedText: fullDateMatch[0] }
  }

  // 2. 简略月份日期 MM月DD日 或 MM/DD
  const monthDayMatch = text.match(/(\d{1,2})[月/-](\d{1,2})[日号]?(?:\s*(?:上线|交付|截止|完成))?/)
  if (monthDayMatch && monthDayMatch[1] && monthDayMatch[2]) {
    const m = monthDayMatch[1].padStart(2, '0')
    const d = monthDayMatch[2].padStart(2, '0')
    return { endDate: `${currentYear}-${m}-${d}`, matchedText: monthDayMatch[0] }
  }

  // 3. 相对工期，如 "30天后", "2周后", "1个月后"
  const daysMatch = text.match(/(\d+)\s*(?:天|日)后/)
  if (daysMatch) {
    const target = new Date(today.getTime() + Number(daysMatch[1]) * 86400000)
    return { endDate: formatDateKey(target), matchedText: daysMatch[0] }
  }

  const weeksMatch = text.match(/(\d+)\s*(?:周|个星期)后/)
  if (weeksMatch) {
    const target = new Date(today.getTime() + Number(weeksMatch[1]) * 7 * 86400000)
    return { endDate: formatDateKey(target), matchedText: weeksMatch[0] }
  }

  const monthsMatch = text.match(/(\d+)\s*(?:个月|月)后/)
  if (monthsMatch) {
    const target = new Date(today)
    target.setMonth(target.getMonth() + Number(monthsMatch[1]))
    return { endDate: formatDateKey(target), matchedText: monthsMatch[0] }
  }

  return { endDate: null }
}

/**
 * 规则式补全：从一句话意图提取项目名称、优先级、周期与建议代号。
 */
export function inferProjectPlacementDraft(
  input: string,
  today: Date = new Date(),
): ProjectPlacementDraft | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const priorityResult = inferPriority(trimmed)
  const endDateResult = inferEndDate(trimmed, today)

  // 清洗名称：移除优先级与日期特征词及标点
  let cleanName = trimmed
  if (priorityResult.matchedText) {
    cleanName = cleanName.replace(priorityResult.matchedText, '')
  }
  if (endDateResult.matchedText) {
    cleanName = cleanName.replace(endDateResult.matchedText, '')
  }

  cleanName = cleanName
    .replace(/(?:高|中|低)优先级/g, '')
    .replace(/(?:上线|交付|完成|截止)$/g, '')
    .replace(/^[，,、\s]+|[，,、\s]+$/g, '')
    .trim()

  const finalName = cleanName || trimmed
  const code = inferProjectCode(finalName)

  return {
    name: finalName,
    code,
    priority: priorityResult.priority,
    status: PROJECT_PLACEMENT_DEFAULT_STATUS,
    startDate: formatDateKey(today),
    endDate: endDateResult.endDate,
    description: null,
    marker: {
      source: 'rule_based',
      confidence: PROJECT_PLACEMENT_CONFIDENCE,
      needsConfirmation: true,
      reason: '根据一句话自然语言与本地规则推断',
    },
  }
}

/** 全量字段模式 Zod 校验 Schema（失焦与输入即时校验，杜绝提交无效数据） */
export const projectFormSchema = z.object({
  name: z.string().trim().min(1, '项目名称不能为空').max(100, '项目名称不能超过 100 字符'),
  code: z
    .string()
    .trim()
    .min(1, '项目标识代码不能为空')
    .max(32, '代码不能超过 32 字符')
    .regex(/^[A-Za-z0-9_-]+$/, '代码仅支持字母、数字、下划线与中划线'),
  description: z.string().max(1000, '描述不能超过 1000 字符').optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  status: z
    .enum(['draft', 'planning', 'active', 'on_hold', 'completed', 'cancelled', 'archived'])
    .default('planning'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional()
    .nullable()
    .or(z.literal('')),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional()
    .nullable()
    .or(z.literal('')),
})

export type ProjectFormData = z.infer<typeof projectFormSchema>

/**
 * 由待确认草案组装 `CreateProjectInput`（对齐 projectsApi.create 契约，RL-04）。
 * 绝不向后端携带 `marker` 字段。
 */
export function buildProjectCreateInput(
  draft: ProjectPlacementDraft,
  overrides: Partial<CreateProjectInput> = {},
): CreateProjectInput {
  const input: CreateProjectInput = {
    name: overrides.name ?? draft.name,
    code: overrides.code ?? draft.code,
    priority: overrides.priority ?? draft.priority,
    status: overrides.status ?? draft.status,
    startDate: overrides.startDate ?? draft.startDate,
  }
  const endDate = overrides.endDate !== undefined ? overrides.endDate : draft.endDate
  if (endDate) input.endDate = endDate
  const description =
    overrides.description !== undefined ? overrides.description : draft.description
  if (description) input.description = description

  return input
}
