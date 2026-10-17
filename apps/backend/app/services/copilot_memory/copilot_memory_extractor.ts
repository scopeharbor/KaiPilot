/**
 * v3-copilot-memory-user-and-project —— 记忆抽取器
 *
 * 从已持久化会话事实确定性抽取记忆候选。
 * 核心约束：
 * - 仅从对话与已授权项目事实抽取，不从 L3 Synthetic 抽取
 * - 每会话候选数量上界为 5
 * - 置信度由来源强度派生，禁止模型自报
 * - 相同输入两次抽取产出相同候选集合与排序
 */

import type {
  CopilotMemoryCandidate,
  CopilotMemoryExtractionResult,
  CopilotMemoryConfidenceSource,
  CopilotMemoryScope,
} from '@aiproj/types'
import { deriveMemoryConfidence, COPILLOT_MEMORY_CANDIDATE_BOUND_PER_SESSION } from '@aiproj/types'

/**
 * 会话事实输入（从 copilot_messages 表读取）。
 */
export interface SessionMessageFact {
  readonly sessionId: string
  readonly messageId: string
  readonly role: 'user' | 'assistant'
  readonly contentSummary: string
  readonly sourceRefs?: readonly string[]
}

/**
 * 抽取器输入。
 */
export interface MemoryExtractionInput {
  readonly organizationId: number
  readonly projectId: number | null
  readonly actorId: number
  readonly scope: CopilotMemoryScope
  readonly messages: readonly SessionMessageFact[]
}

/**
 * 从会话消息事实确定性抽取记忆候选。
 *
 * 抽取策略（确定性，不调用模型）：
 * 1. 仅处理 user 角色消息（assistant 消息为回复，非用户意图）
 * 2. 按消息顺序逐条评估是否包含可记忆信息
 * 3. 提取显式约束、偏好、约定类表述
 * 4. 为每条候选生成 basis 引用
 * 5. 超过上界时按价值档截断并报告省略
 */
export function extractMemoryCandidates(
  input: MemoryExtractionInput,
): CopilotMemoryExtractionResult {
  const { organizationId, projectId, actorId, scope, messages } = input

  // 1. 过滤：仅处理 user 消息（assistant 消息不抽取）
  const userMessages = messages.filter((m) => m.role === 'user')

  // 2. 确定性抽取：逐条评估
  const candidates: CopilotMemoryCandidate[] = []
  const seenSummaries = new Set<string>()

  for (const msg of userMessages) {
    // 跳过空消息
    if (!msg.contentSummary || msg.contentSummary.trim().length === 0) continue

    // 跳过过短消息（<10 字符，不太可能是可记忆信息）
    if (msg.contentSummary.trim().length < 10) continue

    // 检查消息是否包含可记忆的约束/偏好/约定
    const extracted = extractCandidateFromMessage(msg, organizationId, projectId, actorId, scope)
    if (!extracted) continue

    // 去重（相同摘要不重复抽取）
    const dedupeKey = extracted.entry.summary
    if (seenSummaries.has(dedupeKey)) continue
    seenSummaries.add(dedupeKey)

    candidates.push(extracted)
  }

  // 3. 按置信度排序（高 → 低）
  const sorted = candidates.sort((a, b) => {
    const confA = deriveMemoryConfidence(a.confidenceSource)
    const confB = deriveMemoryConfidence(b.confidenceSource)
    return confB - confA || a.entry.summary.localeCompare(b.entry.summary)
  })

  // 4. 截断到上界
  const totalProduced = sorted.length
  const omittedCount = Math.max(0, totalProduced - COPILLOT_MEMORY_CANDIDATE_BOUND_PER_SESSION)
  const boundedCandidates = sorted.slice(0, COPILLOT_MEMORY_CANDIDATE_BOUND_PER_SESSION)

  return {
    candidates: boundedCandidates,
    totalProduced,
    omittedCount,
    sanitizerRejectedCount: 0,
    sourceSessionIds: [...new Set(userMessages.map((m) => m.sessionId))],
    deterministic: true,
  }
}

/**
 * 从单条消息抽取候选（内部函数）。
 *
 * 抽取规则（确定性，模式匹配）：
 * - 包含「我们」「我们的」+ 约束词 → 项目/团队约定
 * - 包含「不要」「别」「禁止」+ 动作 → 拒绝偏好
 * - 包含「按照」「遵循」「用」+ 方法 → 方法论偏好
 * - 包含数字 + 单位 + 约束词 → 量化约束
 */
function extractCandidateFromMessage(
  msg: SessionMessageFact,
  organizationId: number,
  projectId: number | null,
  actorId: number,
  scope: CopilotMemoryScope,
): CopilotMemoryCandidate | null {
  const text = msg.contentSummary.toLowerCase()

  // 确定置信度来源
  let confidenceSource: CopilotMemoryConfidenceSource = 'inferred_from_context'

  // 显式表述标记词
  const explicitMarkers = ['我们', '我们的', '我的', '我', '项目', '团队', '公司']
  const constraintMarkers = [
    '不要',
    '别',
    '禁止',
    '必须',
    '需要',
    '按照',
    '遵循',
    '用',
    '使用',
    '不许',
    '不允许',
  ]
  const hasExplicitMarker = explicitMarkers.some((m) => text.includes(m))
  const hasConstraint = constraintMarkers.some((m) => text.includes(m))

  if (hasExplicitMarker && hasConstraint) {
    confidenceSource = 'explicit_user_statement'
  } else if (hasExplicitMarker || hasConstraint) {
    confidenceSource = 'single_observation'
  } else {
    // 不含明确标记，跳过（避免低质量候选）
    return null
  }

  // 提取摘要（原始文本，≤512 字符）
  const summary = msg.contentSummary.slice(0, 512)

  // 生成确定性 ID
  const now = new Date().toISOString()

  // 生成 tags
  const tags = extractTags(text)

  return {
    entry: {
      organizationId,
      projectId: projectId ?? undefined,
      actorId,
      scope,
      summary,
      tags,
      confidence: deriveMemoryConfidence(confidenceSource),
      confidenceSource,
      basis: [
        {
          sessionId: msg.sessionId,
          messageId: msg.messageId,
          summary: msg.contentSummary.slice(0, 256),
          role: msg.role,
        },
      ],
      observedAt: now,
      lastConfirmedAt: undefined,
      status: 'candidate',
      validityTier: inferValidityTier(text),
    },
    confidenceSource,
  }
}

/**
 * 从文本提取标签（确定性）。
 */
function extractTags(text: string): string[] {
  const tags: string[] = []

  // 方法论标签
  if (/scrum|敏捷|agile|迭代|冲刺|sprint/.test(text)) tags.push('methodology')
  if (/瀑布|waterfall/.test(text)) tags.push('methodology')

  // 流程标签
  if (/验收|审批|签字|review|approve/.test(text)) tags.push('process')
  if (/汇报|报告|report/.test(text)) tags.push('process')

  // 约束标签
  if (/不要|别|禁止|不许|不允许/.test(text)) tags.push('constraint')
  if (/必须|需要|要求/.test(text)) tags.push('requirement')

  // 技术标签
  if (/后端|前端|数据库|api|框架/.test(text)) tags.push('tech_stack')

  // 团队标签
  if (/团队|编制|人员|人|成员/.test(text)) tags.push('team')

  // 排程标签
  if (/截止|日期|deadline|排期|计划/.test(text)) tags.push('schedule')

  // 预算标签
  if (/预算|费用|成本|钱|budget/.test(text)) tags.push('budget')

  // 偏好标签
  if (/喜欢|偏好|习惯|常用/.test(text)) tags.push('preference')

  return tags.length > 0 ? tags : ['general']
}

/**
 * 推断时效档（确定性）。
 */
function inferValidityTier(text: string): 'ephemeral' | 'short' | 'medium' | 'long' | 'durable' {
  // 持久性约束（编制、预算、方法论）
  if (/编制|预算|方法论|战略|制度/.test(text)) return 'durable'

  // 长期约定（验收标准、流程）
  if (/验收|审批|流程|规范|标准/.test(text)) return 'long'

  // 中期偏好（技术栈、工具）
  if (/技术|框架|工具|平台/.test(text)) return 'medium'

  // 短期信息（排期、计划）
  if (/排期|日期|截止|计划|迭代/.test(text)) return 'short'

  // 默认中期
  return 'medium'
}
