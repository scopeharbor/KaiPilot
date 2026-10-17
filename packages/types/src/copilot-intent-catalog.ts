/**
 * v3-copilot-intent-catalog-and-router —— Copilot 意图目录共享契约（任务组 2 / 7.1 / 6.11）。
 *
 * 纯类型 + 确定性常量 + 目录校验 helper，零 Adonis/React/数据库/网络依赖。
 * 消费 `copilot-shared-contracts` 的 COPILOT_INTENT_CLASSES / COPILOT_DESTINATIONS /
 * COPILOT_DESTINATION_REGISTRY / COPILOT_INTENT_CLASS_RULES / CopilotAssumptionEntry 等。
 *
 * 命名纪律：全部导出使用 Copilot / COPILOT / copilot 前缀（避免 barrel 撞名，与
 * copilot-shared-contracts / copilot-action-boundary 同纪律）。
 *
 * 关键设计点（与共享地基对齐，见 observation-and-inventory.md §2/§9）：
 * - 「变更类可到达可持久化 destination」的判定使用共享契约的
 *   COPILOT_INTENT_CLASS_RULES[cls].persistenceReachable 派生集合
 *   （generation/mutation/instruction 三类），而非字面 COPILOT_MUTATION_INTENT_CLASSES
 *   （后者仅含 mutation/instruction）——生成类（如周报）在共享地基中同样
 *   persistenceReachable=true 且 requiresUserConfirmation=true，目录校验与其保持一致，
 *   避免 query/analysis/meta 只读类经目录误达可持久化 destination。
 * - 置信度为规则强度档的确定性映射（0–100 数值），共享契约的 CopilotRouteDecision
 *   使用置信度档位（band），由 router 侧 mapCopilotConfidenceToBand 桥接。
 */
import {
  COPILOT_DESTINATIONS,
  COPILOT_DESTINATION_REGISTRY,
  COPILOT_INTENT_CLASS_RULES,
  COPILOT_INTENT_CLASSES,
  type CopilotDestination,
  type CopilotIntentClass,
  type CopilotIntentClassRule,
  type CopilotScope,
} from './copilot-shared-contracts.js'

// ===========================================================================
// 常量 — 目录版本 / 歧义边距 / 长度与轮数上界（2.9 / 5.6）
// ===========================================================================

/** 目录版本号：进入可复现性输入元组，版本变化是路由输出变化的可见原因。 */
export const COPILOT_INTENT_CATALOG_VERSION = '1.0.0'

/** 歧义置信度边距（0–100 数值置信度的百分点差）。diff ≤ 边距 ⇒ 返回候选集合。 */
export const COPILOT_INTENT_AMBIGUITY_MARGIN = 8

/** 归一化输入最大长度（安全兜底上界，超长输入不进规则管线）。 */
export const COPILOT_INTENT_MAX_INPUT_LENGTH = 400

/**
 * 每会话轮澄清轮数上界；达到后只提供「按记录默认值继续」或结束本轮。
 * 2026 调大：原值 2 导致信息不全时仅能追问两轮，第三轮起强制按默认值放行，
 * 用户体验为「AI 只对话两次」。现放宽至 99（实际上不限制，交给澄清状态机与
 * bug 修复用户自行把关；如需恢复紧上限可改回小值）。
 */
export const COPILOT_INTENT_MAX_CLARIFICATION_ROUNDS = 99

/** 路由决策记录里的意图摘要最大长度（低敏有界摘要）。 */
export const COPILOT_INTENT_SUMMARY_MAX_LENGTH = 40

/** 同子意图内非首选 destination 的确定性置信度衰减（百分点）。 */
export const COPILOT_INTENT_DESTINATION_RANK_PENALTY = 3

/** 通用问答分流（无子意图命中且命中通用触发词）的确定性置信度。 */
export const COPILOT_INTENT_GENERAL_QA_CONFIDENCE = 70

/** 安全兜底的确定性置信度（占位，不参与排序）。 */
export const COPILOT_INTENT_SAFE_FALLBACK_CONFIDENCE = 30

// ===========================================================================
// 枚举 — 槽位档位（与 ai_intent/catalog 三档语义对齐：critical/recommended/optional）
// ===========================================================================

export const COPILOT_SLOT_TIERS = ['critical', 'recommended', 'optional'] as const
export type CopilotSlotTier = (typeof COPILOT_SLOT_TIERS)[number]

// ===========================================================================
// 枚举 — 规则强度档 → 确定性置信度（3.2 / 3.3 / 3.4）
// ===========================================================================

export const COPILOT_RULE_STRENGTHS = [
  'slash_command',
  'explicit_destination',
  'entity_reference',
  'route_context',
  'structured_slot',
  'keyword_pattern',
] as const
export type CopilotRuleStrength = (typeof COPILOT_RULE_STRENGTHS)[number]

/**
 * 规则管线优先级顺序（spec Requirement 2）：显式斜杠命令 → 显式 destination 指名 →
 * 实体引用 → 当前路由上下文 → 结构化槽位 → 关键词与模式。前序规则命中优先级更高。
 */
export const COPILOT_RULE_PIPELINE_ORDER: readonly CopilotRuleStrength[] = [
  ...COPILOT_RULE_STRENGTHS,
]

/**
 * 规则强度档 → 置信度（0–100）确定性映射。相同强度产出相同置信度（3.4 断言），
 * 置信度不来自自由浮动数值。
 */
export const COPILOT_RULE_STRENGTH_CONFIDENCE: Record<CopilotRuleStrength, number> = {
  slash_command: 95,
  explicit_destination: 90,
  entity_reference: 84,
  route_context: 76,
  structured_slot: 70,
  keyword_pattern: 62,
}

/** 由共享契约派生的「可到达可持久化 destination」的意图分类集合（2.12 判定依据）。 */
export const COPILOT_INTENT_PERSISTENCE_CAPABLE_CLASSES: readonly CopilotIntentClass[] = (
  Object.entries(COPILOT_INTENT_CLASS_RULES) as [CopilotIntentClass, CopilotIntentClassRule][]
)
  .filter(([, rule]) => rule.persistenceReachable)
  .map(([cls]) => cls)

// ===========================================================================
// 结构类型 — 槽位 / 规则声明 / 子意图条目（2.1 / 2.2）
// ===========================================================================

export interface CopilotSlotDefault {
  readonly value: string
  /** 0–100 置信度。 */
  readonly confidence: number
  readonly reason: string
}

export interface CopilotSlotSpec {
  readonly slotId: string
  readonly label: string
  readonly tier: CopilotSlotTier
  /** recommended 档可声明默认值；critical 档不得声明（缺失必须澄清）。 */
  readonly defaultValue?: CopilotSlotDefault
  /** 结构化槽位模式（正则字符串，路由侧据此做确定性槽位提取）。 */
  readonly patterns?: readonly string[]
}

export interface CopilotIntentRuleDeclaration {
  readonly ruleId: string
  readonly strength: CopilotRuleStrength
  /** 显式斜杠命令（如 '/risk 新增'）。 */
  readonly slashCommands?: readonly string[]
  /** 显式 destination 指名的中文别名（如 '甘特图'、'风险登记'）。 */
  readonly destinationMentions?: readonly string[]
  /** 实体引用类型（与输入元组的 entityRefs[].kind 匹配）。 */
  readonly entityKinds?: readonly string[]
  /** 当前路由上下文模式（前缀匹配，如 '/projects/'、'/list'）。 */
  readonly routePatterns?: readonly string[]
  /** 结构化槽位模式（正则字符串）。 */
  readonly slotPatterns?: readonly string[]
  readonly keywords?: readonly string[]
}

export interface CopilotSubIntentEntry {
  readonly subIntentId: string
  readonly intentClass: CopilotIntentClass
  /** 中文名。 */
  readonly label: string
  /** 代表性简体中文表述（3.7 断言：必须由规则命中，不得落到模型兜底）。 */
  readonly examplePhrasings: readonly string[]
  readonly requiredSlots: readonly CopilotSlotSpec[]
  readonly optionalSlots: readonly CopilotSlotSpec[]
  readonly candidateDestinations: readonly CopilotDestination[]
  /** 子意图级所需权限（候选 destination 所需权限的并集，目录校验强制超集）。 */
  readonly requiredPermissions: readonly string[]
  readonly ruleDeclarations: readonly CopilotIntentRuleDeclaration[]
  /** 置信度档：模型候选路径的置信度上限依据。 */
  readonly confidenceTier: CopilotRuleStrength
  readonly catalogVersion: string
}

// ===========================================================================
// 目录校验（2.10 / 2.11 / 2.12）
// ===========================================================================

/**
 * 目录完整性校验：
 * - 每条子意图必有：合法分类、版本号、至少一个槽位声明、至少一个候选 destination、
 *   至少一个权限、至少一条规则声明、合法置信度档；
 * - 每个候选 destination 必须存在于共享 destination 注册表（2.11）；
 * - 可导致持久化的 destination 只能出现在可持久化分类（generation/mutation/instruction）
 *   的子意图中（2.12，与共享契约 COPILOT_INTENT_CLASS_RULES 对齐）；
 * - 子意图权限必须是其候选 destination 所需权限的超集（防止意图级权限门泄露）。
 */
export function validateCopilotIntentCatalog(
  registry: readonly CopilotSubIntentEntry[] = COPILOT_SUB_INTENT_REGISTRY,
): { valid: boolean; issues: readonly string[] } {
  const issues: string[] = []
  const seenIds = new Set<string>()

  for (const entry of registry) {
    if (seenIds.has(entry.subIntentId)) {
      issues.push(`subIntentId 重复: ${entry.subIntentId}`)
    }
    seenIds.add(entry.subIntentId)

    if (!COPILOT_INTENT_CLASSES.includes(entry.intentClass)) {
      issues.push(`${entry.subIntentId}: intentClass 非法 ${entry.intentClass}`)
    }
    if (entry.catalogVersion !== COPILOT_INTENT_CATALOG_VERSION) {
      issues.push(
        `${entry.subIntentId}: catalogVersion ${entry.catalogVersion} ≠ ${COPILOT_INTENT_CATALOG_VERSION}`,
      )
    }
    if (entry.requiredSlots.length + entry.optionalSlots.length === 0) {
      issues.push(`${entry.subIntentId}: 缺少槽位声明`)
    }
    for (const slot of [...entry.requiredSlots, ...entry.optionalSlots]) {
      if (!COPILOT_SLOT_TIERS.includes(slot.tier)) {
        issues.push(`${entry.subIntentId}: 槽位 ${slot.slotId} 档位非法 ${slot.tier}`)
      }
      if (slot.tier === 'critical' && slot.defaultValue !== undefined) {
        issues.push(`${entry.subIntentId}: critical 槽位 ${slot.slotId} 不得声明默认值`)
      }
    }
    if (entry.candidateDestinations.length === 0) {
      issues.push(`${entry.subIntentId}: 缺少候选 destination`)
    }
    if (entry.requiredPermissions.length === 0) {
      issues.push(`${entry.subIntentId}: 缺少权限声明`)
    }
    if (entry.ruleDeclarations.length === 0) {
      issues.push(`${entry.subIntentId}: 缺少规则声明`)
    }
    if (!COPILOT_RULE_STRENGTHS.includes(entry.confidenceTier)) {
      issues.push(`${entry.subIntentId}: 置信度档非法 ${entry.confidenceTier}`)
    }
    if (entry.examplePhrasings.length === 0) {
      issues.push(`${entry.subIntentId}: 缺少中文示例表述`)
    }

    for (const destination of entry.candidateDestinations) {
      if (!COPILOT_DESTINATIONS.includes(destination)) {
        issues.push(`${entry.subIntentId}: 未知 destination ${destination}`)
        continue
      }
      const metadata = COPILOT_DESTINATION_REGISTRY[destination]
      if (metadata === undefined) {
        issues.push(`${entry.subIntentId}: destination ${destination} 不在共享注册表中`)
        continue
      }
      if (metadata.persistenceReachable) {
        if (!COPILOT_INTENT_PERSISTENCE_CAPABLE_CLASSES.includes(entry.intentClass)) {
          issues.push(
            `${entry.subIntentId}: 可持久化 destination ${destination} 只能从可持久化分类子意图到达（当前 ${entry.intentClass}）`,
          )
        }
      }
      for (const permission of metadata.requiredPermissions) {
        if (!entry.requiredPermissions.includes(permission)) {
          issues.push(
            `${entry.subIntentId}: 权限声明缺少 destination ${destination} 所需权限 ${permission}`,
          )
        }
      }
    }
  }

  return { valid: issues.length === 0, issues }
}

// ===========================================================================
// 结构类型 — 输入元组组成（4.3）与模型候选（3.5）
// ===========================================================================

export interface CopilotEntityReference {
  readonly kind: string
  readonly text: string
}

export interface CopilotExtractedSlot {
  readonly slotId: string
  readonly value: string
}

export type CopilotDestinationUnavailabilityKind = 'not-enabled' | 'authorization-gated'

/**
 * 可用性输入：只登记「存在但不可用」的 destination（not-enabled / authorization-gated）。
 * 缺席 = 可用；无权限的 destination 由 permissions 与共享注册表派生，不进入本输入
 * （路由侧缺席过滤，非泄露语义）。
 */
export interface CopilotDestinationAvailability {
  readonly destination: CopilotDestination
  readonly kind: CopilotDestinationUnavailabilityKind
  readonly hint?: string
}

export interface CopilotModelIntentCandidate {
  readonly subIntentId: string
  /** 0–100 置信度（模型候选路径：目录校验后按条目置信度档封顶）。 */
  readonly confidence: number
}

/**
 * 模型候选接口（可注入，默认关闭）。仅当规则管线零命中时被咨询；
 * 输出必须先经目录校验，且不得覆盖/重排/改分规则已确定的分类。
 */
export interface CopilotIntentModelCandidateSource {
  readonly suggestCandidates: (params: {
    readonly normalizedInput: string
    readonly catalogVersion: string
  }) => readonly CopilotModelIntentCandidate[]
}

// ===========================================================================
// 结构类型 — 低敏路由决策记录（7.1，本 change 只产出不落库）
// ===========================================================================

export interface CopilotRoutingDecisionRecord {
  readonly recordId: string
  readonly catalogVersion: string
  readonly intentClass: CopilotIntentClass | null
  readonly subIntentId: string | null
  /** 归一化意图摘要（有界低敏，上限 COPILOT_INTENT_SUMMARY_MAX_LENGTH）。 */
  readonly intentSummary: string
  /** destination 排序（最终有序结果里的 destination id）。 */
  readonly destinationOrder: readonly string[]
  readonly confidences: readonly number[]
  readonly clarificationRoundCount: number
  readonly ambiguous: boolean
  readonly unavailabilityKinds: readonly CopilotDestinationUnavailabilityKind[]
  readonly ruleHitCount: number
  readonly fallbackCount: number
  /** 「是否被用户改道」占位：本 change 恒 false，由路由决策账本 change 填充。 */
  readonly userRerouted: boolean
  readonly scope: CopilotScope
}

/**
 * 低敏校验：记录不得包含原始输入全文、prompt、模型输出、token 或 secret。
 * 传入敏感样本（原始输入、secret 等），任一命中即视为不合规（7.3 测试用）。
 */
export function containsSensitiveRoutingPayload(
  record: CopilotRoutingDecisionRecord,
  sensitiveSamples: readonly string[],
): boolean {
  const serialized = JSON.stringify(record)
  if (serialized.length > COPILOT_INTENT_SUMMARY_MAX_LENGTH * 4 + 512) {
    // 低敏记录应当有界；超出明显异常上限视为不合规
    return true
  }
  for (const sample of sensitiveSamples) {
    if (sample.length > 0 && serialized.includes(sample)) {
      return true
    }
  }
  return false
}

// ===========================================================================
// 结构类型 — 命令注册表可用性适配（6.11，P1）
// ===========================================================================

/**
 * 命令注册表声明的可移植形态（对应 frontend command-registry 的
 * RegisteredCommand.when(ctx) 求值结果 + requiresPermission + 启用/授权门状态）。
 * 适配层把声明派生为路由器的可用性输入，避免另建并行可用性表。
 */
export interface CopilotCommandAvailabilityDeclaration {
  readonly destination: CopilotDestination
  readonly requiresPermission: readonly string[]
  /** 命令注册表 when(ctx) 谓词求值结果；false = 当前上下文不可用（缺席）。 */
  readonly whenResult: boolean
  readonly enabled: boolean
  readonly authorizationGated: boolean
}

export function deriveAvailabilityFromCommandDeclarations(
  declarations: readonly CopilotCommandAvailabilityDeclaration[],
  permissions: readonly string[],
): readonly CopilotDestinationAvailability[] {
  const result: CopilotDestinationAvailability[] = []
  for (const declaration of declarations) {
    if (!declaration.whenResult) continue
    const permitted = declaration.requiresPermission.every((permission) =>
      permissions.includes(permission),
    )
    if (!permitted) continue
    if (!declaration.enabled) {
      result.push({
        destination: declaration.destination,
        kind: 'not-enabled',
        hint: '该能力未启用，可在设置中开启',
      })
      continue
    }
    if (declaration.authorizationGated) {
      result.push({
        destination: declaration.destination,
        kind: 'authorization-gated',
        hint: '需要用户授权后才能使用该能力',
      })
    }
  }
  return result
}

// ===========================================================================
// 目录注册表（2.3 – 2.8，六类 30 条子意图）
// ===========================================================================

function kw(ruleId: string, keywords: readonly string[]): CopilotIntentRuleDeclaration {
  return { ruleId, strength: 'keyword_pattern', keywords }
}

function slash(ruleId: string, commands: readonly string[]): CopilotIntentRuleDeclaration {
  return { ruleId, strength: 'slash_command', slashCommands: commands }
}

function dest(ruleId: string, mentions: readonly string[]): CopilotIntentRuleDeclaration {
  return { ruleId, strength: 'explicit_destination', destinationMentions: mentions }
}

export const COPILOT_SUB_INTENT_REGISTRY: readonly CopilotSubIntentEntry[] = [
  {
    subIntentId: 'generation.project_creation',
    intentClass: 'generation',
    label: '创建项目',
    examplePhrasings: ['帮我创建一个项目', '我想建立一个专案'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'project_description', label: '项目描述', tier: 'recommended' }],
    candidateDestinations: ['project_creation'],
    requiredPermissions: ['ai:trigger', 'project:create'],
    ruleDeclarations: [slash('g.project_creation.command', ['/create-project'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  // ── 通用回答与草案审查（必须排在宽泛的项目现状规则之前）──
  {
    subIntentId: 'instruction.general_explanation',
    intentClass: 'instruction',
    label: '通用解释',
    examplePhrasings: [
      '请用三点回答',
      '请简要解释一下',
      '分步骤说明这个概念',
      '请用三点说明最容易失败的地方',
      '分析一下哪里容易出问题，只给建议',
      '三点风险说明',
      '明确只建议不执行',
      '给出建议',
      '分析项目实施难点与注意事项',
      '最容易失败的三个风险是什么',
    ],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'topic', label: '说明主题', tier: 'recommended' }],
    candidateDestinations: ['general_qa'],
    requiredPermissions: ['ai:trigger'],
    ruleDeclarations: [
      kw('i.general_explanation.keywords', [
        '用三点回答',
        '用三点说明',
        '三点回答',
        '三点说明',
        '三点阐述',
        '三点风险',
        '简要解释',
        '分步骤说明',
        '概括说明',
        '最容易失败的地方',
        '最容易失败',
        '容易失败',
        '哪里容易出问题',
        '只能给建议',
        '只给建议',
        '明确只建议',
        '只做建议',
        '给出建议',
        '给些建议',
        '不能修改或确认',
        '只回答不执行',
        '只回答不操作',
        '潜在风险',
        '实施难点',
        '注意事项',
      ]),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'analysis.draft_quality',
    intentClass: 'analysis',
    label: '草案质量诊断与比较',
    examplePhrasings: [
      '比较需求与草案',
      '检查草案是否遗漏需求',
      '诊断这个草案的质量问题',
      '草案风险诊断与质量评估',
      '分析草案实施难点并给出建议',
    ],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'comparison_focus', label: '比较重点', tier: 'recommended' }],
    candidateDestinations: ['general_qa', 'health_diagnosis'],
    requiredPermissions: ['ai:trigger', 'project:read'],
    ruleDeclarations: [
      kw('a.draft_quality.keywords', [
        '比较需求与草案',
        '需求与草案',
        '草案是否遗漏',
        '草案质量',
        '诊断这个草案',
        '草案诊断',
        '草案评估',
        '草案完整性',
        '草案风险',
        '质量诊断',
      ]),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  // ── 查询类（2.3）──
  {
    subIntentId: 'query.project_status',
    intentClass: 'query',
    label: '项目现状',
    examplePhrasings: ['项目现在怎么样', '这个项目进展如何', '当前项目进度', '项目整体情况如何'],
    requiredSlots: [],
    optionalSlots: [
      {
        slotId: 'project_scope',
        label: '项目范围',
        tier: 'recommended',
        defaultValue: {
          value: '当前项目',
          confidence: 55,
          reason: '未指定项目，按当前项目上下文回答',
        },
      },
    ],
    candidateDestinations: ['health_diagnosis', 'prediction'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [
      kw('q.project_status.keywords', [
        '项目进展',
        '项目状态',
        '项目进度',
        '项目现在怎么样',
        '项目整体情况',
      ]),
      {
        ruleId: 'q.project_status.route',
        strength: 'route_context',
        routePatterns: ['/projects/'],
      },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'query.task_lookup',
    intentClass: 'query',
    label: '任务查找',
    examplePhrasings: ['帮我找一下任务', '查找某个任务', '这个任务在哪', '搜索任务状态'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'task_keyword', label: '任务关键词', tier: 'recommended' }],
    candidateDestinations: ['advanced_search', 'knowledge_base'],
    requiredPermissions: ['project:read', 'search:read', 'knowledge:read'],
    ruleDeclarations: [
      kw('q.task_lookup.keywords', ['任务', '查找', '找一下', '搜索任务']),
      {
        ruleId: 'q.task_lookup.route',
        strength: 'route_context',
        routePatterns: ['/list', '/kanban', '/gantt', '/wbs'],
      },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'query.member_load',
    intentClass: 'query',
    label: '成员负载',
    examplePhrasings: ['谁的负载最重', '哪些成员超载了', '下周谁工作量最大', '成员的负载情况'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'member_scope', label: '成员范围', tier: 'recommended' }],
    candidateDestinations: ['resource_forecasting'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [
      kw('q.member_load.keywords', ['负载', '超载', '工作量', '忙不忙', '分配了多少']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'query.deadline_list',
    intentClass: 'query',
    label: '截止清单',
    examplePhrasings: ['哪些任务快截止了', '截止日期列表', '下周到期的事项', '这个月快到期的东西'],
    requiredSlots: [],
    optionalSlots: [
      {
        slotId: 'date_window',
        label: '时间窗口',
        tier: 'recommended',
        defaultValue: {
          value: '未来两周',
          confidence: 58,
          reason: '未指定时间窗口，按未来两周回答',
        },
        patterns: ['下周', '下月', '本月', '未来'],
      },
    ],
    candidateDestinations: ['prediction', 'advanced_search'],
    requiredPermissions: ['project:read', 'ai:trigger', 'search:read'],
    ruleDeclarations: [
      kw('q.deadline_list.keywords', ['截止', '到期', '快到期']),
      {
        ruleId: 'q.deadline_list.slots',
        strength: 'structured_slot',
        slotPatterns: ['下周', '下月', '本月', '快截止', '即将到期'],
      },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'query.dependency_query',
    intentClass: 'query',
    label: '依赖查询',
    examplePhrasings: ['这个任务依赖谁', '查一下依赖关系', '前置任务是什么', '谁被这个任务阻塞'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'target_task', label: '目标任务', tier: 'recommended' }],
    candidateDestinations: ['knowledge_base', 'advanced_search'],
    requiredPermissions: ['project:read', 'search:read', 'knowledge:read'],
    ruleDeclarations: [kw('q.dependency_query.keywords', ['依赖', '前置任务', '阻塞关系'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'query.document_retrieval',
    intentClass: 'query',
    label: '文档检索',
    examplePhrasings: ['帮我找项目文档', '这个项目的资料在哪', '查找说明书', 'wiki 在哪'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'doc_topic', label: '文档主题', tier: 'recommended' }],
    candidateDestinations: ['knowledge_base', 'advanced_search'],
    requiredPermissions: ['project:read', 'search:read', 'knowledge:read'],
    ruleDeclarations: [kw('q.document_retrieval.keywords', ['文档', '资料', '说明书', 'wiki'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },

  // ── 分析类（2.4）──
  {
    subIntentId: 'analysis.delay_attribution',
    intentClass: 'analysis',
    label: '延期归因',
    examplePhrasings: ['为什么这个任务延期', '什么导致延期', '项目为什么会延迟'],
    requiredSlots: [{ slotId: 'target_task', label: '目标任务', tier: 'critical' }],
    optionalSlots: [],
    candidateDestinations: ['health_diagnosis', 'prediction'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [kw('a.delay_attribution.keywords', ['延期', '延迟', '为什么会晚'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'analysis.bottleneck',
    intentClass: 'analysis',
    label: '瓶颈分析',
    examplePhrasings: ['项目的瓶颈在哪', '哪里卡住了', '关键路径分析', '用甘特图看瓶颈'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'scope', label: '分析范围', tier: 'recommended' }],
    candidateDestinations: ['health_diagnosis'],
    requiredPermissions: ['project:read'],
    ruleDeclarations: [
      kw('a.bottleneck.keywords', ['瓶颈', '卡住', '阻塞', '关键路径']),
      {
        ruleId: 'a.bottleneck.mentions',
        strength: 'explicit_destination',
        destinationMentions: ['甘特图'],
      },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'analysis.risk_identification',
    intentClass: 'analysis',
    label: '风险识别',
    examplePhrasings: ['这个项目有什么风险', '识别一下风险', '有哪些隐患'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'risk_area', label: '风险领域', tier: 'recommended' }],
    candidateDestinations: ['prediction', 'health_diagnosis'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [kw('a.risk_identification.keywords', ['风险', '隐患', '危险'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'analysis.critical_path_impact',
    intentClass: 'analysis',
    label: '关键路径影响',
    examplePhrasings: ['关键路径变更的影响', '任务 A 延期会不会拖累整个项目', '会影响交付吗'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'impact_scope', label: '影响范围', tier: 'recommended' }],
    candidateDestinations: ['health_diagnosis', 'gantt_what_if'],
    requiredPermissions: ['project:read'],
    ruleDeclarations: [
      kw('a.critical_path_impact.keywords', ['关键路径', '拖累', '连锁影响', '影响交付']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'analysis.resource_conflict',
    intentClass: 'analysis',
    label: '资源冲突',
    examplePhrasings: ['成员资源冲突了吗', '谁被重复分配任务', '资源分配有冲突吗'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'time_window', label: '时间窗口', tier: 'recommended' }],
    candidateDestinations: ['resource_forecasting', 'health_diagnosis'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [
      kw('a.resource_conflict.keywords', ['资源冲突', '重复分配', '抢资源', '分配了两次', '冲突']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'analysis.contradiction',
    intentClass: 'analysis',
    label: '矛盾分析',
    examplePhrasings: ['改进质量为什么让进度恶化', '这个矛盾怎么权衡', '技术矛盾分析'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'parameter_a', label: '矛盾参数', tier: 'recommended' }],
    candidateDestinations: [
      'triz_technical_contradiction',
      'triz_physical_contradiction',
      'triz_contradiction_matrix',
    ],
    requiredPermissions: ['triz:read', 'ai:trigger'],
    ruleDeclarations: [
      kw('a.contradiction.keywords', ['矛盾', '改进', '恶化', '权衡']),
      {
        ruleId: 'a.contradiction.mentions',
        strength: 'explicit_destination',
        destinationMentions: ['矛盾矩阵', '矛盾分析'],
      },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },

  // ── 生成类（2.5）──
  {
    subIntentId: 'generation.weekly_report',
    intentClass: 'generation',
    label: '周报月报',
    examplePhrasings: ['生成下周周报', '写这个月月报', '帮我生成一份周报'],
    requiredSlots: [
      {
        slotId: 'report_period',
        label: '报告周期',
        tier: 'critical',
        patterns: ['下周', '本月', '下月', '上周', '上月', '本周', '季度'],
      },
    ],
    optionalSlots: [],
    candidateDestinations: ['weekly_monthly_report'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [kw('g.weekly_report.keywords', ['周报', '月报', '双周报'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'generation.project_brief',
    intentClass: 'generation',
    label: '项目简报',
    examplePhrasings: ['生成项目简报', '给我一个项目概要', '写一份项目概述'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'brief_scope', label: '简报范围', tier: 'recommended' }],
    candidateDestinations: ['weekly_monthly_report', 'ai_draft_generation'],
    requiredPermissions: ['project:read', 'ai:trigger', 'project:update'],
    ruleDeclarations: [kw('g.project_brief.keywords', ['简报', '概要', '概述'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'generation.acceptance_criteria',
    intentClass: 'generation',
    label: '验收标准',
    examplePhrasings: ['生成验收标准', '这个功能的验收标准是什么', '写一下成功标准'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'deliverable', label: '交付物', tier: 'recommended' }],
    candidateDestinations: ['ai_draft_generation'],
    requiredPermissions: ['ai:trigger', 'project:update'],
    ruleDeclarations: [kw('g.acceptance_criteria.keywords', ['验收标准', '验收', '成功标准'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'generation.meeting_summary',
    intentClass: 'generation',
    label: '会议摘要',
    examplePhrasings: ['生成会议摘要', '把会议记录整理成纪要', '写一份会议纪要'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'meeting_ref', label: '会议引用', tier: 'recommended' }],
    candidateDestinations: ['ai_draft_generation'],
    requiredPermissions: ['ai:trigger', 'project:update'],
    ruleDeclarations: [kw('g.meeting_summary.keywords', ['会议摘要', '纪要', '会议记录'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'generation.chart',
    intentClass: 'generation',
    label: '图表',
    examplePhrasings: ['生成项目图表', '把这个做成甘特图', '数据可视化'],
    requiredSlots: [],
    optionalSlots: [
      {
        slotId: 'chart_kind',
        label: '图表类型',
        tier: 'recommended',
        defaultValue: { value: '甘特图', confidence: 52, reason: '未指定图表类型，默认甘特图' },
      },
    ],
    candidateDestinations: ['weekly_monthly_report', 'gantt_what_if'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [
      kw('g.chart.keywords', ['图表', '可视化', '甘特图']),
      {
        ruleId: 'g.chart.mentions',
        strength: 'explicit_destination',
        destinationMentions: ['甘特图'],
      },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },

  // ── 变更类（2.6）──
  {
    subIntentId: 'mutation.task_decomposition',
    intentClass: 'mutation',
    label: '任务拆解',
    examplePhrasings: ['把首页设计拆成子任务', '帮我拆解这个任务', '任务拆分'],
    requiredSlots: [{ slotId: 'task_description', label: '任务描述', tier: 'critical' }],
    optionalSlots: [],
    candidateDestinations: ['draft_layer', 'ai_draft_generation'],
    requiredPermissions: ['project:update', 'ai:trigger'],
    ruleDeclarations: [
      kw('m.task_decomposition.keywords', ['拆解', '拆分', '分解', '拆成']),
      {
        ruleId: 'm.task_decomposition.mentions',
        strength: 'explicit_destination',
        destinationMentions: ['任务拆解'],
      },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'mutation.schedule_adjustment',
    intentClass: 'mutation',
    label: '排期调整',
    examplePhrasings: ['调整项目排期', '把里程碑推迟一周', '排程调整'],
    requiredSlots: [{ slotId: 'target_milestone', label: '目标里程碑', tier: 'critical' }],
    optionalSlots: [],
    candidateDestinations: ['draft_layer', 'gantt_what_if'],
    requiredPermissions: ['project:read', 'project:update', 'ai:trigger'],
    ruleDeclarations: [
      kw('m.schedule_adjustment.keywords', ['排期', '排程', '调整进度', '推迟', '提前']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'mutation.resource_assignment',
    intentClass: 'mutation',
    label: '资源分配',
    examplePhrasings: ['把任务分配给小张', '重新分配资源', '指派新负责人'],
    requiredSlots: [
      { slotId: 'member_ref', label: '成员', tier: 'critical' },
      { slotId: 'assignment_change', label: '分配变更', tier: 'critical' },
    ],
    optionalSlots: [],
    candidateDestinations: ['draft_layer', 'resource_forecasting'],
    requiredPermissions: ['project:read', 'project:update', 'ai:trigger'],
    ruleDeclarations: [
      kw('m.resource_assignment.keywords', ['分配资源', '指派', '换人', '重新分配']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'mutation.risk_register',
    intentClass: 'mutation',
    label: '风险登记',
    examplePhrasings: ['登记一个新风险', '新增风险记录'],
    requiredSlots: [{ slotId: 'risk_description', label: '风险描述', tier: 'critical' }],
    optionalSlots: [],
    candidateDestinations: ['risk_suggestions', 'draft_layer'],
    requiredPermissions: ['risk:read', 'risk:update', 'project:update', 'ai:trigger'],
    ruleDeclarations: [
      slash('m.risk_register.slash', ['/risk']),
      kw('m.risk_register.keywords', ['登记风险', '新增风险', '记录风险']),
      dest('m.risk_register.mentions', ['风险登记']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'mutation.wbs_adjustment',
    intentClass: 'mutation',
    label: 'WBS 调整',
    examplePhrasings: ['调整 WBS 结构', 'wbs 节点调整', '重构 WBS 树'],
    requiredSlots: [{ slotId: 'wbs_change', label: 'WBS 变更', tier: 'critical' }],
    optionalSlots: [],
    candidateDestinations: ['draft_layer', 'ai_draft_generation'],
    requiredPermissions: ['project:update', 'ai:trigger'],
    ruleDeclarations: [
      kw('m.wbs_adjustment.keywords', ['调整 wbs', 'wbs 调整', '重构 wbs', 'wbs 节点']),
      {
        ruleId: 'm.wbs_adjustment.mentions',
        strength: 'explicit_destination',
        destinationMentions: ['wbs'],
      },
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'mutation.milestone_adjustment',
    intentClass: 'mutation',
    label: '里程碑调整',
    examplePhrasings: ['调整里程碑日期', '里程碑变更申请', '改一下里程碑'],
    requiredSlots: [{ slotId: 'milestone_change', label: '里程碑变更', tier: 'critical' }],
    optionalSlots: [],
    candidateDestinations: ['draft_layer'],
    requiredPermissions: ['project:update', 'ai:trigger'],
    ruleDeclarations: [
      kw('m.milestone_adjustment.keywords', ['调整里程碑', '里程碑变更', '改里程碑', '里程碑']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },

  // ── 教学类（2.7）──
  {
    subIntentId: 'instruction.page_help',
    intentClass: 'instruction',
    label: '本页怎么用',
    examplePhrasings: ['这个页面怎么用', '甘特图页如何使用', '本页怎么操作'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'topic', label: '页面主题', tier: 'recommended' }],
    candidateDestinations: ['help_and_terminology', 'general_qa'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [kw('i.page_help.keywords', ['怎么用', '如何使用', '本页', '这个页面'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'instruction.terminology',
    intentClass: 'instruction',
    label: '术语解释',
    examplePhrasings: ['关键路径是什么意思', '解释一下里程碑术语', 'WBS 是什么意思'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'term', label: '术语', tier: 'recommended' }],
    candidateDestinations: ['help_and_terminology', 'general_qa'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [kw('i.terminology.keywords', ['术语', '什么意思', '是什么含义'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'instruction.shortcut',
    intentClass: 'instruction',
    label: '快捷键',
    examplePhrasings: ['快捷键有哪些', '快捷方式列表'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'scope', label: '范围', tier: 'recommended' }],
    candidateDestinations: ['help_and_terminology'],
    requiredPermissions: ['project:read'],
    ruleDeclarations: [kw('i.shortcut.keywords', ['快捷键', '快捷方式', '键盘', '按键'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'instruction.capability_intro',
    intentClass: 'instruction',
    label: '能力介绍',
    examplePhrasings: ['AI 功能介绍', '有哪些功能', '能力介绍'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'interest', label: '关注点', tier: 'recommended' }],
    candidateDestinations: ['help_and_terminology', 'general_qa'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [kw('i.capability_intro.keywords', ['功能介绍', '能力介绍', '有哪些功能'])],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },

  // ── 元类（2.8）──
  {
    subIntentId: 'meta.capabilities',
    intentClass: 'meta',
    label: '你能做什么',
    examplePhrasings: ['你能做什么', '你会什么', '你能帮我什么'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'interest_area', label: '关注领域', tier: 'recommended' }],
    candidateDestinations: ['help_and_terminology', 'general_qa'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    ruleDeclarations: [
      kw('meta.capabilities.keywords', ['你能做什么', '你会什么', '你能帮我什么', '你的能力']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'meta.context_summary',
    intentClass: 'meta',
    label: '上下文里有什么',
    examplePhrasings: ['你看到了什么', '上下文里有什么', '你了解这个项目什么'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'scope', label: '范围', tier: 'recommended' }],
    candidateDestinations: ['knowledge_base', 'health_diagnosis', 'external_retrieval'],
    requiredPermissions: ['knowledge:read', 'project:read', 'ai:trigger', 'external:read'],
    ruleDeclarations: [
      kw('meta.context_summary.keywords', [
        '上下文',
        '你看到了什么',
        '你了解什么',
        '你了解这个项目什么',
        '有什么信息',
      ]),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'meta.reasoning',
    intentClass: 'meta',
    label: '为什么这么建议',
    examplePhrasings: ['为什么建议这样做', '推荐依据是什么', '这个结论怎么得出的'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'decision_ref', label: '决策引用', tier: 'recommended' }],
    candidateDestinations: ['recommendation', 'triz_recommendation_rationale'],
    requiredPermissions: ['project:read', 'ai:trigger', 'triz:read'],
    ruleDeclarations: [
      kw('meta.reasoning.keywords', ['为什么建议', '为什么推荐', '依据是什么', '怎么得出的']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
  {
    subIntentId: 'meta.cost_usage',
    intentClass: 'meta',
    label: '成本与用量',
    examplePhrasings: ['这个月 AI 成本多少', '用量统计', '花了多少费用'],
    requiredSlots: [],
    optionalSlots: [{ slotId: 'period', label: '统计周期', tier: 'recommended' }],
    candidateDestinations: ['general_qa', 'help_and_terminology'],
    requiredPermissions: ['ai:trigger', 'project:read'],
    ruleDeclarations: [
      kw('meta.cost_usage.keywords', ['成本', '用量', '费用', '花了多少', 'token 用量']),
    ],
    confidenceTier: 'keyword_pattern',
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  },
]

const SUB_INTENT_BY_ID = new Map<string, CopilotSubIntentEntry>(
  COPILOT_SUB_INTENT_REGISTRY.map((entry) => [entry.subIntentId, entry]),
)

export function copilotSubIntentById(subIntentId: string): CopilotSubIntentEntry | undefined {
  return SUB_INTENT_BY_ID.get(subIntentId)
}

export function isCopilotSubIntentId(value: string): boolean {
  return SUB_INTENT_BY_ID.has(value)
}

export function copilotSubIntentsByClass(
  intentClass: CopilotIntentClass,
): readonly CopilotSubIntentEntry[] {
  return COPILOT_SUB_INTENT_REGISTRY.filter((entry) => entry.intentClass === intentClass)
}

/** 子意图的置信度档对应置信度（模型候选路径封顶用）。 */
export function copilotSubIntentTierConfidence(entry: CopilotSubIntentEntry): number {
  return COPILOT_RULE_STRENGTH_CONFIDENCE[entry.confidenceTier]
}
