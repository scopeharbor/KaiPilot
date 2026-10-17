/**
 * v3-copilot-intent-catalog-and-router —— 确定性意图分类器（任务组 3）。
 *
 * 纯函数：输入归一化文本 + 上下文 → 意图分类结果。零 Adonis/React/数据库/网络/时钟/随机依赖。
 *
 * 规则管线优先级（design D1 / spec Requirement 2）：
 * 显式斜杠命令 → 显式 destination 指名 → 实体引用 → 当前路由上下文 → 结构化槽位 → 关键词与模式。
 *
 * 模型候选接口（design D1 / spec Requirement 2）：
 * 仅当规则管线零命中时被咨询，输出必须先经目录校验，且不得覆盖/重排/改分规则已确定的分类。
 */
import { type CopilotDestination, type CopilotIntentClass } from './copilot-shared-contracts.js'
import {
  COPILOT_INTENT_MAX_INPUT_LENGTH,
  COPILOT_INTENT_SUMMARY_MAX_LENGTH,
  COPILOT_RULE_PIPELINE_ORDER,
  COPILOT_RULE_STRENGTH_CONFIDENCE,
  COPILOT_SUB_INTENT_REGISTRY,
  type CopilotEntityReference,
  type CopilotExtractedSlot,
  type CopilotIntentModelCandidateSource,
  type CopilotIntentRuleDeclaration,
  type CopilotRuleStrength,
  type CopilotSubIntentEntry,
} from './copilot-intent-catalog.js'

// ===========================================================================
// 结构类型 — 分类结果
// ===========================================================================

export interface CopilotClassifierResult {
  /** 命中的子意图（null = 无法分类，走安全兜底）。 */
  readonly subIntentId: string | null
  readonly intentClass: CopilotIntentClass | null
  /** 命中的规则强度（null = 模型候选或兜底）。 */
  readonly matchedRuleStrength: CopilotRuleStrength | null
  /** 命中的规则 ID（null = 模型候选或兜底）。 */
  readonly matchedRuleId: string | null
  /** 0–100 置信度值。 */
  readonly confidence: number
  /** 归一化输入摘要（有界低敏）。 */
  readonly intentSummary: string
  /** 规则命中 → true；模型候选 → false。 */
  readonly isRuleHit: boolean
  /** 候选 destination（按置信度从高到低排序）。 */
  readonly candidateDestinations: readonly CopilotDestination[]
}

// ===========================================================================
// 归一化（3.1）
// ===========================================================================

/** 中文输入去噪、空白与标点归一、长度上下界。 */
export function normalizeCopilotInput(input: string): string {
  if (typeof input !== 'string') return ''
  let normalized = input
  // 去除首尾空白
  normalized = normalized.trim()
  // 归一化连续空白为单空格
  normalized = normalized.replace(/\s+/g, ' ')
  // 去除多余标点（保留中文标点与斜杠）
  normalized = normalized.replace(/[，。！？；：、]/g, (m) => {
    // 保留中文标点但去除重复
    return m
  })
  // 长度截断
  if (normalized.length > COPILOT_INTENT_MAX_INPUT_LENGTH) {
    normalized = normalized.slice(0, COPILOT_INTENT_MAX_INPUT_LENGTH)
  }
  return normalized
}

/** 生成有界低敏意图摘要（从归一化输入截取）。 */
export function deriveIntentSummary(normalizedInput: string): string {
  if (normalizedInput.length <= COPILOT_INTENT_SUMMARY_MAX_LENGTH) {
    return normalizedInput
  }
  return normalizedInput.slice(0, COPILOT_INTENT_SUMMARY_MAX_LENGTH - 3) + '…'
}

// ===========================================================================
// 实体引用抽取（3.1 辅助）
// ===========================================================================

/** 从归一化输入中抽取实体引用（task/member/milestone/wbs/document）。 */
export function extractEntityReferences(
  normalizedInput: string,
): readonly CopilotEntityReference[] {
  const refs: CopilotEntityReference[] = []
  // 简单模式匹配（规则管线会进一步精炼）
  const taskPatterns = [/任务[「「]?(.+?)[」」]?/g, /子任务[「「]?(.+?)[」」]?/g]
  const memberPatterns = [/成员[「「]?(.+?)[」」]?/g, /负责人[「「]?(.+?)[」」]?/g]
  const milestonePatterns = [/里程碑[「「]?(.+?)[」」]?/g]
  const wbsPatterns = [/[Ww][Bb][Ss]\s*[「「]?(.+?)[」」]?/g]

  for (const pattern of taskPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(normalizedInput)) !== null) {
      if (match[1]) refs.push({ kind: 'task', text: match[1] })
    }
  }
  for (const pattern of memberPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(normalizedInput)) !== null) {
      if (match[1]) refs.push({ kind: 'member', text: match[1] })
    }
  }
  for (const pattern of milestonePatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(normalizedInput)) !== null) {
      if (match[1]) refs.push({ kind: 'milestone', text: match[1] })
    }
  }
  for (const pattern of wbsPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(normalizedInput)) !== null) {
      if (match[1]) refs.push({ kind: 'wbs_node', text: match[1] })
    }
  }
  return refs
}

// ===========================================================================
// 规则管线（3.2 / 3.3）
// ===========================================================================

/**
 * 规则管线求值：按优先级顺序遍历子意图的规则声明，返回首个命中结果。
 * 确定性：相同输入 + 相同上下文 = 相同结果。
 */
export function evaluateRulePipeline(params: {
  readonly normalizedInput: string
  readonly currentRoute?: string
  readonly entityRefs?: readonly CopilotEntityReference[]
  readonly extractedSlots?: readonly CopilotExtractedSlot[]
  readonly slashCommand?: string
  readonly destinationMention?: string
}): CopilotClassifierResult | null {
  const {
    normalizedInput,
    currentRoute,
    entityRefs = [],
    extractedSlots = [],
    slashCommand,
    destinationMention,
  } = params

  // 按规则管线优先级遍历
  for (const strength of COPILOT_RULE_PIPELINE_ORDER) {
    if (strength === 'entity_reference' && requestsCopilotProjectCreation(normalizedInput)) {
      const entry = COPILOT_SUB_INTENT_REGISTRY.find(
        (e) => e.subIntentId === 'generation.project_creation',
      )
      if (entry)
        return buildClassifierResult(entry, {
          ruleId: 'g.project_creation.natural',
          strength: 'keyword_pattern',
        })
    }
    const result = evaluateRuleStrength(strength, {
      normalizedInput,
      currentRoute,
      entityRefs,
      extractedSlots,
      slashCommand,
      destinationMention,
    })
    if (result !== null) return result
  }
  return inferNaturalGeneralQaIntent(normalizedInput)
}

/**
 * 自然问答兜底：用户不需要知道目录里的“规范句式”。当文本具有明显的提问、
 * 分析或建议语义，且没有正向的落库/执行请求时，直接进入只读 general_qa。
 * 否定式边界（“不要修改”“只能给建议”）优先于字面上的“修改/确认”动词，
 * 避免把安全边界说明误判成变更意图。
 */
function inferNaturalGeneralQaIntent(normalizedInput: string): CopilotClassifierResult | null {
  const text = normalizedInput.toLowerCase()
  if (!text) return null

  const explicitlyReadOnly =
    /(?:只|仅|明确只|纯|只做).{0,8}(?:建议|回答|分析|说明|解释|提建议|给建议)/.test(text) ||
    /(?:不要|不能|无需|不需要|不可|禁止|切勿|不需).{0,12}(?:修改|确认|执行|创建|新增|删除|保存|提交|导入|操作|动工)/.test(
      text,
    ) ||
    /(?:给出建议|给点建议|提点建议|给些建议|提建议|给建议|只做建议|明确只建议)/.test(text)
  const naturalQuestion =
    /(?:为什么|为何|怎么|如何|哪些|什么|是否|能否|哪里|哪儿|几种|请问|分析|解释|说明|建议|风险|问题|失败|可行|注意|坑|影响|难点|弱点|缺陷|瓶颈|三点|评估|诊断|探讨|聊聊)/.test(
      text,
    ) || /[?？]$/.test(text)
  const positiveMutation =
    /(?:帮我|请|立即|现在|直接|需要|要|把).{0,10}(?:创建|新增|修改|更新|删除|调整|安排|指派|确认|导入|保存|提交|执行|生成周报)/.test(
      text,
    )

  if (!naturalQuestion || (positiveMutation && !explicitlyReadOnly)) return null

  // 若明确涉及草案与需求比较或草案质量诊断，优先路由到草案质量分析
  if (/(?:草案|需求).{0,8}(?:质量|比较|遗漏|诊断|评估|风险)/.test(text)) {
    const draftEntry = COPILOT_SUB_INTENT_REGISTRY.find(
      (candidate) => candidate.subIntentId === 'analysis.draft_quality',
    )
    if (draftEntry) {
      return buildClassifierResult(draftEntry, {
        ruleId: 'a.draft_quality.natural_query',
        strength: 'keyword_pattern',
      })
    }
  }

  const entry = COPILOT_SUB_INTENT_REGISTRY.find(
    (candidate) => candidate.subIntentId === 'instruction.general_explanation',
  )
  if (!entry) return null
  return buildClassifierResult(entry, {
    ruleId: 'i.general_explanation.natural_query',
    strength: 'keyword_pattern',
  })
}

function evaluateRuleStrength(
  strength: CopilotRuleStrength,
  params: {
    readonly normalizedInput: string
    readonly currentRoute?: string
    readonly entityRefs: readonly CopilotEntityReference[]
    readonly extractedSlots: readonly CopilotExtractedSlot[]
    readonly slashCommand?: string
    readonly destinationMention?: string
  },
): CopilotClassifierResult | null {
  for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
    for (const rule of entry.ruleDeclarations) {
      if (rule.strength !== strength) continue
      if (matchRule(rule, params)) {
        return buildClassifierResult(entry, rule)
      }
    }
  }
  return null
}

function matchRule(
  rule: CopilotIntentRuleDeclaration,
  params: {
    readonly normalizedInput: string
    readonly currentRoute?: string
    readonly entityRefs: readonly CopilotEntityReference[]
    readonly extractedSlots: readonly CopilotExtractedSlot[]
    readonly slashCommand?: string
    readonly destinationMention?: string
  },
): boolean {
  switch (rule.strength) {
    case 'slash_command': {
      if (!rule.slashCommands || params.slashCommand === undefined) return false
      return rule.slashCommands.some((cmd) =>
        params.slashCommand!.toLowerCase().startsWith(cmd.toLowerCase()),
      )
    }
    case 'explicit_destination': {
      if (!rule.destinationMentions || params.destinationMention === undefined) return false
      return rule.destinationMentions.some((mention) =>
        params.destinationMention!.toLowerCase().includes(mention.toLowerCase()),
      )
    }
    case 'entity_reference': {
      if (!rule.entityKinds || params.entityRefs.length === 0) return false
      return params.entityRefs.some((ref) => rule.entityKinds!.includes(ref.kind))
    }
    case 'route_context': {
      if (!rule.routePatterns || params.currentRoute === undefined) return false
      // 页面是取数范围，不是用户意图。问候和日常聊天不能被项目路由劫持。
      if (!/(?:项目|专案|專案|当前|目前|进度|状态|整体|这里|这个)/.test(params.normalizedInput))
        return false
      return rule.routePatterns.some((pattern) =>
        params.currentRoute!.toLowerCase().includes(pattern.toLowerCase()),
      )
    }
    case 'structured_slot': {
      if (!rule.slotPatterns || params.extractedSlots.length === 0) return false
      return params.extractedSlots.some((slot) =>
        rule.slotPatterns!.some((pattern) =>
          slot.value.toLowerCase().includes(pattern.toLowerCase()),
        ),
      )
    }
    case 'keyword_pattern': {
      if (!rule.keywords) return false
      return rule.keywords.some((keyword) =>
        params.normalizedInput.toLowerCase().includes(keyword.toLowerCase()),
      )
    }
    default:
      return false
  }
}

/** 只产生受控创建入口，疑问与否定句仍交给问答。 */
export function requestsCopilotProjectCreation(text: string): boolean {
  if (
    /(?:不要|别|不想|无需|不用|如何|怎么|怎样|是否|能否).{0,12}(?:建|建立|创建|新增|做|规划)/.test(
      text,
    )
  )
    return false
  return (
    /(?:创建|建立|新建|新增|启动|开|做|规划).{0,16}(?:项目|专案|專案|計畫)/.test(text) ||
    /(?:项目|专案|專案).{0,12}(?:创建|建立|新建|启动)/.test(text)
  )
}

function buildClassifierResult(
  entry: CopilotSubIntentEntry,
  rule: CopilotIntentRuleDeclaration,
): CopilotClassifierResult {
  const confidence = COPILOT_RULE_STRENGTH_CONFIDENCE[rule.strength]
  return {
    subIntentId: entry.subIntentId,
    intentClass: entry.intentClass,
    matchedRuleStrength: rule.strength,
    matchedRuleId: rule.ruleId,
    confidence,
    intentSummary: deriveIntentSummary(entry.examplePhrasings[0] ?? ''),
    isRuleHit: true,
    candidateDestinations: [...entry.candidateDestinations],
  }
}

// ===========================================================================
// 模型候选接口（3.5）
// ===========================================================================

/**
 * 咨询模型候选（仅当规则管线零命中时调用）。
 * 模型输出必须先经目录校验：未知子意图 → null；已知子意图 → 按置信度档封顶。
 */
export function consultModelCandidate(params: {
  readonly normalizedInput: string
  readonly catalogVersion: string
  readonly modelSource?: CopilotIntentModelCandidateSource
}): CopilotClassifierResult | null {
  if (!params.modelSource) return null
  const candidates = params.modelSource.suggestCandidates({
    normalizedInput: params.normalizedInput,
    catalogVersion: params.catalogVersion,
  })
  if (candidates.length === 0) return null

  // 选择置信度最高的候选
  const best = candidates.reduce((a, b) => (a.confidence >= b.confidence ? a : b))

  // 目录校验：必须存在于注册表
  const entry = COPILOT_SUB_INTENT_REGISTRY.find((e) => e.subIntentId === best.subIntentId)
  if (!entry) return null

  // 模型置信度按条目置信度档封顶
  const maxConfidence = COPILOT_RULE_STRENGTH_CONFIDENCE[entry.confidenceTier]
  const cappedConfidence = Math.min(best.confidence, maxConfidence)

  return {
    subIntentId: entry.subIntentId,
    intentClass: entry.intentClass,
    matchedRuleStrength: null,
    matchedRuleId: null,
    confidence: cappedConfidence,
    intentSummary: deriveIntentSummary(entry.examplePhrasings[0] ?? ''),
    isRuleHit: false,
    candidateDestinations: [...entry.candidateDestinations],
  }
}
