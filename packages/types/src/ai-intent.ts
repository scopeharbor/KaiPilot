import type { AiMarker, Marked } from './ai-m0.js'

export const AI_INTENT_SCHEMA_VERSION = '1.0' as const
export const ADAPTIVE_CLARIFICATION_SCHEMA_VERSION = '2.0' as const

export const INFORMATION_NEED_DECISION_AREAS = [
  'scope',
  'deliverable',
  'schedule',
  'resource',
  'dependency',
  'risk',
  'acceptance',
] as const
export type InformationNeedDecisionArea = (typeof INFORMATION_NEED_DECISION_AREAS)[number]

export const INFORMATION_NEED_PRIORITIES = ['blocking', 'high', 'useful', 'optional'] as const
export type InformationNeedPriority = (typeof INFORMATION_NEED_PRIORITIES)[number]

export const INFORMATION_NEED_ANSWER_KINDS = [
  'single_choice',
  'multi_choice',
  'date',
  'number',
  'money',
  'short_text',
] as const
export type InformationNeedAnswerKind = (typeof INFORMATION_NEED_ANSWER_KINDS)[number]

export const PROJECT_KNOWN_FACT_SOURCES = [
  'initial_intent',
  'confirmed_answer',
  'user_context',
] as const
export type ProjectKnownFactSource = (typeof PROJECT_KNOWN_FACT_SOURCES)[number]

export interface ProjectKnownFact {
  id: string
  topic: string
  value: string
  evidence: string
  confidence: number
  source: ProjectKnownFactSource
}

export interface InformationNeedOption {
  id: string
  label: string
  value: string
  description?: string
}

export interface InformationNeed {
  id: string
  /** Model-generated storage key. Never display this value in the UI. */
  topic: string
  missingInformation: string
  decisionImpact: InformationNeedDecisionArea[]
  whyItMatters: string
  priority: InformationNeedPriority
  answerKind: InformationNeedAnswerKind
  suggestedOptions?: InformationNeedOption[]
  dependsOn?: string[]
  confidence: number
  uncertainty: number
  userEffort: 'low' | 'medium' | 'high'
  sensitivity: 'none' | 'low' | 'high'
}

export interface ProjectUnderstanding {
  schemaVersion: typeof ADAPTIVE_CLARIFICATION_SCHEMA_VERSION
  summaryForUser: string
  inferredDomainLabel: string
  intendedOutcome?: string
  likelyDeliverables: string[]
  knownFacts: ProjectKnownFact[]
  informationNeeds: InformationNeed[]
  sufficientForPreliminaryDraft: boolean
}

export interface QuestionCardProposal {
  needId: string
  question: string
  reason?: string
  answerKind: InformationNeedAnswerKind
  options?: InformationNeedOption[]
  allowOther: boolean
  allowUnknown: boolean
  unknownImpact?: string
}

export const CLARIFICATION_RESPONSE_INTENTS = [
  'answer',
  'ask_meaning',
  'ask_why',
  'request_recommendation',
  // 「给我几个选项」：模型当轮没给 suggestedOptions 时，用户可以要求为当前这道题
  // 补候选项。只补选项、不推进到下一题，也不代替用户作答。
  'request_options',
  'add_context',
  'unknown',
  'edit_answer',
] as const
export type ClarificationResponseIntent = (typeof CLARIFICATION_RESPONSE_INTENTS)[number]

export interface ClassifiedClarificationIntent {
  intent: ClarificationResponseIntent
  text: string
  extractedValue?: string | number | string[]
  targetNeedId?: string
  confidence: number
}

export interface MultiIntentUserResponse {
  text: string
  intents: ClassifiedClarificationIntent[]
}

export interface KnownUnknown {
  needId: string
  topic: string
  impact: string
  owner?: string
  targetDecisionDate?: string
  recordedAt: string
}

export type ClarificationLedgerEntryStatus = 'answered' | 'known_unknown' | 'superseded'

/**
 * 需求覆盖矩阵的槽位。
 *
 * decisionImpact 只有 7 个取值，粒度太粗：角色、平台、通知、权限这些用户实际会被
 * 反复追问的主题全挤在 scope/resource 里，于是「这个主题已经答过了」根本无从判断。
 * 覆盖矩阵按用户看得见的主题分槽，用来做两件事：
 * 1. 已覆盖的槽位不再重复出题，只允许更细的缺口；
 * 2. 关键槽位齐了就开放草案生成入口，不再无限追问。
 */
export const CLARIFICATION_COVERAGE_SLOTS = [
  'scope',
  'deliverable',
  'schedule',
  'resource',
  'role',
  'platform',
  'integration',
  'permission',
  'notification',
  'acceptance',
  'data',
  'risk',
] as const
export type ClarificationCoverageSlot = (typeof CLARIFICATION_COVERAGE_SLOTS)[number]

/** covered=已有确认答案；deferred=用户明确记为待决定；open=仍是缺口。 */
export type ClarificationCoverageStatus = 'covered' | 'deferred' | 'open'

export interface ClarificationCoverageEntry {
  slot: ClarificationCoverageSlot
  status: ClarificationCoverageStatus
}

/**
 * 关键槽位：全部 covered/deferred 即认为信息足以生成初步草案。
 * 其余槽位只影响草案精细度，不构成阻断。
 */
export const CLARIFICATION_CORE_COVERAGE_SLOTS: readonly ClarificationCoverageSlot[] = [
  'scope',
  'deliverable',
  'schedule',
  'resource',
]

export interface ClarificationLedgerEntry {
  needId: string
  topic: string
  status: ClarificationLedgerEntryStatus
  questionSummary: string
  answer?: string | number | string[]
  knownUnknown?: KnownUnknown
  revision: number
  updatedAt: string
  /**
   * direct=用户针对当前这道题给出的答案；
   * absorbed=从同一段自由文本里额外读到、归属到另一道题的答案。
   * absorbed 条目在界面上标明来源，用户可以直接改。
   */
  source?: 'direct' | 'absorbed'
  /** 本条答案覆盖到的矩阵槽位，用于「同主题不重复追问」。 */
  coverageSlots?: ClarificationCoverageSlot[]
}

export interface ClarificationLedger {
  schemaVersion: typeof ADAPTIVE_CLARIFICATION_SCHEMA_VERSION
  revision: number
  entries: ClarificationLedgerEntry[]
}

export const CLARIFICATION_CONVERSATION_STATUSES = [
  'awaiting_response',
  'explaining',
  'recommending',
  'awaiting_confirmation',
  'resolved',
  'needs_human_review',
] as const
export type ClarificationConversationStatus = (typeof CLARIFICATION_CONVERSATION_STATUSES)[number]

export interface ClarificationConversationTurn {
  id: string
  role: 'assistant' | 'user'
  kind:
    | 'question'
    | 'answer'
    | 'follow_up'
    | 'explanation'
    | 'recommendation'
    | 'context'
    | 'confirmation'
    | 'system_notice'
  text: string
  createdAt: string
}

export interface ClarificationConversationState {
  schemaVersion: typeof ADAPTIVE_CLARIFICATION_SCHEMA_VERSION
  activeNeedId: string
  activeQuestion: QuestionCardProposal
  status: ClarificationConversationStatus
  turns: ClarificationConversationTurn[]
  proposedAnswer?: string | number | string[]
  resolvedAnswer?: string | number | string[]
  understandingRevision: number
  ledgerRevision: number
  completedCount: number
  remainingEstimate: number
  /**
   * remainingEstimate 的分档拆解。左侧「澄清进度」直接渲染这里的值，
   * 三项之和恒等于 remainingEstimate——两侧不可能再各算各的。
   * 旧 token（本字段上线前签发）里没有它，界面按缺省回退。
   */
  remainingBreakdown?: {
    critical: number
    recommended: number
    optional: number
  }
  /** 需求覆盖矩阵快照，供界面显示「哪些主题已经问过了」。 */
  coverage?: ClarificationCoverageEntry[]
  remainingEstimateReason: string
  canGeneratePreliminaryDraft: boolean
  /** canGeneratePreliminaryDraft 为真时给用户的一句理由；为假时说明还差什么。 */
  preliminaryDraftReason?: string
  currentUnderstanding: string
}

export interface AdaptiveClarificationSession {
  schemaVersion: typeof ADAPTIVE_CLARIFICATION_SCHEMA_VERSION
  sessionId: string
  round: number
  understanding: ProjectUnderstanding
  ledger: ClarificationLedger
  knownUnknowns: KnownUnknown[]
  conversation: ClarificationConversationState | null
  status: 'clarifying' | 'ready' | 'needs_human_review'
  guardReason?: string
  /**
   * 检查点 A：这一轮答完开工日 / 工期后程序查日历得到的提醒。有下一题时同时附在下一题说明里；
   * 追问就此结束（conversation 为 null）时靠这个字段在就绪页显示。
   */
  calendarNote?: string | null
}

export const ADAPTIVE_CLARIFICATION_LIMITS = {
  maxPayloadBytes: 48_000,
  maxDepth: 7,
  maxKnownFacts: 40,
  maxNeeds: 24,
  maxOptions: 8,
  maxTextLength: 600,
  maxTurnsPerNeed: 16,
  maxSessionRounds: 40,
  maxRepairAttempts: 2,
} as const

export const PROJECT_TYPES = ['software', 'event', 'research', 'product', 'general'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const INTENT_ENTITY_TYPES = [
  'project_name',
  'objective',
  'deliverable',
  'start_date',
  'deadline',
  'duration',
  'team_size',
  'technology',
  'platform',
  'role',
  'constraint',
] as const
export type IntentEntityType = (typeof INTENT_ENTITY_TYPES)[number]

export interface IntentEntity {
  type: IntentEntityType
  value: string | number
  text: string
  start: number
  end: number
  confidence: number
  source: 'explicit' | 'inferred'
}

export interface ProjectTimelineIntent {
  startDate: string | null
  deadline: string | null
  durationDays: number | null
}

export interface ParsedIntent {
  schemaVersion: typeof AI_INTENT_SCHEMA_VERSION
  projectType: ProjectType
  projectName: string | null
  objectives: string[]
  deliverables: string[]
  timeline: ProjectTimelineIntent
  constraints: string[]
  entities: IntentEntity[]
  overallConfidence: number
}

export const CLARIFICATION_CATEGORIES = ['critical', 'recommended', 'optional'] as const
export type ClarificationCategory = (typeof CLARIFICATION_CATEGORIES)[number]

export const CLARIFICATION_FIELDS = [
  'projectGoal',
  'corePain',
  'targetUser',
  'successMetrics',
  'scopeBoundary',
  'startDate',
  'teamSize',
  'techStack',
  'methodology',
  'qualityStandard',
  'communicationFreq',
  'integration',
  'compliance',
  'designPreference',
  'hosting',
  'thirdPartyServices',
  'securityControls',
  'performanceTarget',
  'migrationScope',
  'rolloutStrategy',
  'agentRisk',
  'agentDependency',
  'agentAcceptance',
  'agentStakeholder',
  'agentConstraint',
] as const
export type ClarificationField = (typeof CLARIFICATION_FIELDS)[number]

export const CORE_CLARIFICATION_FIELDS = [
  'projectGoal',
  'corePain',
  'targetUser',
  'successMetrics',
  'scopeBoundary',
  'teamSize',
  'startDate',
] as const satisfies readonly ClarificationField[]
export type CoreClarificationField = (typeof CORE_CLARIFICATION_FIELDS)[number]

export const CLARIFICATION_PHASES = ['core', 'conditional', 'agent', 'ready'] as const
export type ClarificationPhase = (typeof CLARIFICATION_PHASES)[number]

export const CLARIFICATION_SOURCES = ['core', 'conditional', 'agent', 'triz'] as const
export type ClarificationSource = (typeof CLARIFICATION_SOURCES)[number]

export const CLARIFICATION_QUESTION_TYPES = [
  'single_choice',
  'multi_choice',
  'number',
  'date',
  'text',
] as const
export type ClarificationQuestionType = (typeof CLARIFICATION_QUESTION_TYPES)[number]

export interface ClarificationImpact {
  domain: string
  severity: 'high' | 'medium' | 'low'
}

export type ClarificationValue = string | number | string[] | null

export interface ClarificationQuickOption {
  label: string
  value: string | number
  description: string
  recommended?: boolean
}

export interface ClarificationCustomInput {
  enabled: true
  label: string
  placeholder: string
  description: string
}

export interface ClarificationDefault {
  value: Exclude<ClarificationValue, null>
  marker: AiMarker
}

export interface ClarificationCard {
  cardId: string
  field: ClarificationField
  category: ClarificationCategory
  title: string
  description: string
  impactScope: ClarificationImpact[]
  questionType: ClarificationQuestionType
  quickOptions: ClarificationQuickOption[]
  customInput: ClarificationCustomInput
  defaultValue: ClarificationDefault | null
  confidence: number
  reasoning: string
  allowSkip: boolean
  isRequired: boolean
  /** Migration-compatible stage metadata. New responses always populate these fields. */
  phase?: Exclude<ClarificationPhase, 'ready'>
  source?: ClarificationSource
  packId?: string | null
  triggerEvidence?: string[]
  /** Parsed explicit fact that still requires the user to confirm this core card. */
  suggestedValue?: ClarificationValue
}

export const CLARIFICATION_ACTIONS = ['answer', 'default', 'skip'] as const
export type ClarificationAction = (typeof CLARIFICATION_ACTIONS)[number]

export interface ClarificationAnswer {
  field: ClarificationField
  action: ClarificationAction
  value: ClarificationValue
  marker: AiMarker | null
  cardId?: string
  source?: ClarificationSource
}

export type ClarificationAnswers = Partial<Record<ClarificationField, ClarificationAnswer>>

/**
 * 项目理解层（生成前由 AI 产出、用户确认）：把「一句话 + 澄清答案」整理成问题、成功画面、
 * 业务流程与能力地图。后续拆解的每一次模型调用都以它为主干记忆（spine），
 * 能力地图直接决定 WBS 一级分支，避免模型边拆边猜项目到底要解决什么。
 */
export interface ProjectPlanUnderstanding {
  version: '1.0'
  /** 要解决的问题（谁、在什么场景、遇到什么困难）。 */
  problemStatement: string
  /** 成功画面：项目结束时可观察、可验证的状态。 */
  successPicture: string
  /** 现状：已有什么、缺什么。 */
  currentState: string
  stakeholders: string[]
  /** 核心业务流程（端到端路径），每条 3–8 步。 */
  businessFlows: Array<{ id: string; name: string; steps: string[] }>
  /** 能力地图：要建设 / 交付的能力，dependsOn 引用其它能力 id。 */
  capabilities: Array<{
    id: string
    name: string
    purpose: string
    deliverables: string[]
    dependsOn: string[]
  }>
  constraints: string[]
  assumptions: Array<{ id: string; statement: string; impact: string }>
  openQuestions: string[]
  /** 用户在就绪页直接回答了的待确认问题（从 openQuestions 移出，作为已确认信息进入后续拆解与生成）。 */
  answeredQuestions?: Array<{ question: string; answer: string }>
  /**
   * 用户选「先按角色估算」或没给团队时，理解层按范围与工期建议的团队（AI 假设）。
   * 后续所有调用只用这些角色名，资源平衡与人员分配也以它为准。
   */
  suggestedTeam?: Array<{ role: string; headcount: number; reason: string }>
  /** 用户已在就绪页确认（或编辑后确认）。 */
  confirmedByUser: boolean
  editedByUser?: boolean
}

/** 团队中的一个角色（计划工具箱与可行性评估用）。 */
export interface PlanningTeamMember {
  role: string
  headcount: number
}

/**
 * 用户就「能不能如期完成」做出的决定（生成前在项目理解阶段、或生成后在审查页协商得出）。
 * 生成时由程序套用：改截止日、改团队、把部分能力移到第二期；AI 只提建议，决定一律由用户确认。
 */
export interface FeasibilityDecision {
  kind: 'extend' | 'add_people' | 'defer' | 'as_is' | 'finish_early' | 'custom'
  /** 给人看的一句话（进审查页的决策记录）。 */
  summary: string
  /** 新的截止日（extend / finish_early / custom）。 */
  deadline?: string | null
  /** 调整后的完整团队（add_people / custom）。 */
  team?: PlanningTeamMember[] | null
  /** 移到第二期的能力 id 与名称（defer / custom）。 */
  deferredCapabilityIds?: string[] | null
  deferredNames?: string[] | null
  decidedAt: string
}

export interface FeasibilityCapabilityEstimate {
  capabilityId: string
  name: string
  /** 人日（含设计、开发、测试）。 */
  low: number
  high: number
  /** 可以放第二期（没有必须保留的能力依赖它）。 */
  deferrable: boolean
  /** 1 = 最核心；数字越大越可以往后放。 */
  priority: number
  reason: string
}

export interface FeasibilityOption {
  id: string
  kind: FeasibilityDecision['kind']
  label: string
  detail: string
  /** 选中后写进上下文的决定（decidedAt 由选中时补）。 */
  decision: Omit<FeasibilityDecision, 'decidedAt'>
  recommended?: boolean
}

/** 生成前的可行性评估：工作量（模型估）对比团队产能（程序算）。 */
export interface FeasibilityAssessment {
  verdict: 'fits' | 'tight' | 'over' | 'early' | 'unknown'
  startDate: string | null
  deadline: string | null
  workdays: number | null
  team: PlanningTeamMember[]
  /** user = 用户给的团队；ai = 理解层建议的团队（人数可以再调）。 */
  teamSource: 'user' | 'ai' | 'none'
  capacityPersonDays: number | null
  effortPersonDays: { low: number; high: number; expected: number }
  /** 按本组织历史执行偏差校准的系数（没有足够样本时为 null）。 */
  historyFactor: number | null
  estimates: FeasibilityCapabilityEstimate[]
  /** 日历提醒：假期占用、截止日落在假期等（程序算）。 */
  calendarNotices: string[]
  /** 模型发现的前后矛盾或缺失信息。 */
  contradictions: string[]
  summary: string
  options: FeasibilityOption[]
  /**
   * 审查页（草案已排好）才有：真实排期的完工日。能否按期以它与截止日比较为准；
   * 人日数只是粗估（依赖链、角色分工会让两者不一致）。
   */
  plannedEndDate?: string | null
}

export interface FeasibilityNegotiationTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface FeasibilityNegotiationReply {
  reply: string
  /** 模型根据对话提出的决定（数字已由程序核算）；用户点「就这样」才生效。 */
  proposal: FeasibilityOption | null
}

/** 审查页重排前后的一个快照。 */
export interface ReplanSnapshot {
  plannedEndDate: string | null
  deadline: string | null
  exceededWorkdays: number
  taskCount: number
  team: PlanningTeamMember[]
}

/** 审查页按决定重排后的前后对比（预览，不落库）。 */
export interface ReplanPreview {
  decision: Omit<FeasibilityDecision, 'decidedAt'>
  before: ReplanSnapshot
  after: ReplanSnapshot
  removedTasks: number
  /** 完工日变化最大的几项任务。 */
  movedTasks: Array<{ name: string; fromEnd: string; toEnd: string }>
  summary: string
  /** 改了团队或范围、完工日却没有提前时的说明（瓶颈在依赖链上）。 */
  note?: string | null
}

export interface ConfirmedProjectContext {
  schemaVersion: typeof AI_INTENT_SCHEMA_VERSION
  rawInput: string
  parsedIntent: ParsedIntent
  resolvedFields: Partial<Record<ClarificationField, Marked<Exclude<ClarificationValue, null>>>>
  assumptions: Partial<Record<ClarificationField, Marked<Exclude<ClarificationValue, null>>>>
  unresolvedCriticalFields: ClarificationField[]
  unansweredOptionalFields: ClarificationField[]
  adaptiveUnderstanding?: ProjectUnderstanding
  adaptiveLedger?: ClarificationLedger
  knownUnknowns?: KnownUnknown[]
  /** 生成前确认的项目理解；缺失时生成管线自行产出并标为未确认。 */
  planUnderstanding?: ProjectPlanUnderstanding
  /**
   * 输入框 @ 的组织成员（handle 为 @ 后的原文，发给模型前一律替换成「成员#id」，姓名不进模型）。生成时按角色计入团队名册，
   * 审查页可据此建议负责人。
   */
  mentionedMembers?: Array<{ userId: number; handle: string; role: string | null }>
  /**
   * 服务端从本组织历史推出的规划记忆（用户删过 / 补过的任务、工期偏差、阶段偏好）。
   * 每次由服务端重新计算并覆盖，不采信客户端传入值。
   */
  /**
   * 长需求（超过 8,000 字）的整理稿：逐条保留原文具体事项并标注段落出处。
   * 原文仍完整保存在 rawInput；追问读整理稿，项目理解读原文 + 整理稿，拆解按能力取相关条目。
   */
  requirementBrief?: string
  planningMemory?: {
    facts: string[]
    durationFactor: { factor: number; basis: string } | null
  }
  /** 生成前就「能不能如期完成」协商出的决定；生成时由程序套用到截止日 / 团队 / 范围。 */
  feasibilityDecision?: FeasibilityDecision
}

export interface AnalyzeProjectIntentRequest {
  rawInput: string
  /** 实时输出频道编号（UUID）：等待期间经 GET /ai/live-output/:id 看到模型正在吐出的文字。 */
  liveOutputId?: string
  /** 长需求（超过 8,000 字）的整理稿，用户确认后随追问请求带上。 */
  requirementBrief?: string
  answers?: ClarificationAnswers
  /** V2 adaptive planner state. New sessions use this instead of fixed field answers. */
  adaptiveSession?: AdaptiveClarificationSession
  /** Natural-language response for the pinned adaptive question. */
  adaptiveResponse?: MultiIntentUserResponse
  /** Opaque server-signed adaptive session; clients must not interpret or mutate it. */
  adaptiveSessionToken?: string
  requestPreliminaryDraft?: boolean
  /**
   * 守卫态（needs_human_review）下重跑这一步。用会话已有的 ledger 重新生成理解，
   * 已确认的答案不受影响；不带这个标志时守卫态会原样返回，点什么都出不来。
   */
  retryGuardedSession?: boolean
  questionPlanRevision?: string
  /**
   * Opaque, server-signed snapshot of the bounded Agent question batch.
   * The client only persists and echoes this value; it must never interpret or mutate it.
   */
  agentQuestionPlanToken?: string
  connectionId?: number
  modelId?: number
  /**
   * 是否允许本次 AI 快速创建使用外部网页搜索（按次同意，缺省 false；
   * v3-copilot-optional-web-search-configuration）。组织未启用 / 场景未允许时
   * 服务端不会发起任何外部请求。
   */
  webSearchConsent?: boolean
}

export interface ClarificationSummary {
  critical: number
  recommended: number
  optional: number
}

export const QUESTION_PLAN_REASON_CODES = [
  'MISSING_REQUIRED_ID',
  'INCOMPLETE_TRIGGERED_PACK',
  'DUPLICATE_FIELD',
  'ANSWERED_FIELD_REPEATED',
  'INVALID_QUESTION_TYPE',
  'UNANSWERABLE_QUESTION',
  'SENSITIVE_TEXT_EXPOSED',
  'QUESTION_LIMIT_EXCEEDED',
  'MULTIPLE_PRIMARY_QUESTIONS',
  'INTERNAL_TERM_EXPOSED',
  'OVERLAPPING_OPTIONS',
  'MISSING_OTHER_PATH',
  'MISSING_UNKNOWN_PATH',
  'SEMANTIC_DRIFT',
  'IRRELEVANT_QUESTION',
  'KNOWN_UNKNOWN_REPEATED',
] as const
export type QuestionPlanReasonCode = (typeof QUESTION_PLAN_REASON_CODES)[number]

export interface QuestionPlanCoverage {
  valid: boolean
  requiredIds: string[]
  coveredIds: string[]
  missingIds: string[]
  rejectedIds: string[]
  reasonCodes: QuestionPlanReasonCode[]
  selectedPackIds: string[]
}

// ---------------------------------------------------------------------------
// QuestionPlan —— 服务端权威的三层逐题计划（design D9）
// ---------------------------------------------------------------------------

export const QUESTION_PLAN_LIMITS = {
  maxCards: 20,
  maxTriggerEvidencePerCard: 3,
  maxSelectedPacks: 8,
  maxRevisionLength: 64,
} as const

export interface QuestionPlanEntry {
  cardId: string
  field: ClarificationField
  /** 卡片归属阶段；ready 阶段不应再有待答条目。 */
  phase: Exclude<ClarificationPhase, 'ready'>
  source: ClarificationSource
  packId: string | null
  questionType: ClarificationQuestionType
  isRequired: boolean
  triggerEvidence: string[]
}

export interface QuestionPlan {
  revision: string
  phase: Exclude<ClarificationPhase, 'ready'>
  entries: QuestionPlanEntry[]
  coverage: QuestionPlanCoverage
}

const QUESTION_PLAN_SENSITIVE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/(?:bearer\s+)?sk-[a-z0-9_-]{12,}/giu, '[REDACTED_SECRET]'],
  [/authorization\s*[:=]\s*[^\s]+/giu, '[REDACTED_AUTH]'],
  [/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[REDACTED_EMAIL]'],
  [/\b1[3-9]\d{9}\b/gu, '[REDACTED_PHONE]'],
]

/** 对问题计划允许出现的自由文本做确定性脱敏，不依赖第三方运行时。 */
export function redactQuestionPlanText(value: string): string {
  let result = value
  for (const [pattern, replacement] of QUESTION_PLAN_SENSITIVE_REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/** 问题计划触发证据脱敏（不修改 coverage 中的稳定 ID/hash）。 */
export function redactQuestionPlan(plan: QuestionPlan): QuestionPlan {
  return {
    ...plan,
    entries: plan.entries.map((entry) => ({
      ...entry,
      triggerEvidence: entry.triggerEvidence.map(redactQuestionPlanText),
    })),
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return (
      '{' +
      keys.map((key) => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') +
      '}'
    )
  }
  return JSON.stringify(value ?? null)
}

/** 有界确定性序列化；超出上界的条目按顺序截断，供审计与 revision 派生使用。 */
export function serializeQuestionPlan(plan: QuestionPlan): string {
  const bounded: QuestionPlan = {
    ...plan,
    entries: plan.entries.slice(0, QUESTION_PLAN_LIMITS.maxCards).map((entry) => ({
      ...entry,
      triggerEvidence: entry.triggerEvidence
        .slice(0, QUESTION_PLAN_LIMITS.maxTriggerEvidencePerCard)
        .map(redactQuestionPlanText),
    })),
    coverage: {
      ...plan.coverage,
      selectedPackIds: plan.coverage.selectedPackIds.slice(
        0,
        QUESTION_PLAN_LIMITS.maxSelectedPacks,
      ),
    },
  }
  return stableStringify(bounded)
}

/** 纯函数 revision：同计划同值，条目/触发证据顺序变化会产生不同 revision。 */
export function computeQuestionPlanRevision(plan: QuestionPlan): string {
  let hash = 0x811c9dc5
  const text = serializeQuestionPlan(plan)
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, QUESTION_PLAN_LIMITS.maxRevisionLength)
}

export interface AnalyzeProjectIntentResponse {
  parsedIntent: ParsedIntent
  cards: ClarificationCard[]
  confirmedContext: ConfirmedProjectContext
  branch: 'clarify' | 'ready'
  summary: ClarificationSummary
  /** Server-authoritative staged projection. Optional only for rolling compatibility. */
  phase?: ClarificationPhase
  activeCard?: ClarificationCard | null
  remainingCount?: number
  completedCount?: number
  totalCount?: number
  questionPlanRevision?: string
  /** Opaque continuation token for consuming a multi-card Agent batch without a second model call. */
  agentQuestionPlanToken?: string | null
  coverage?: QuestionPlanCoverage
  /** Present for model-driven sessions; omitted when replaying a legacy fixed-field session. */
  adaptiveSession?: AdaptiveClarificationSession
  adaptiveSessionToken?: string | null
}

export interface AdaptiveContractValidationResult<T> {
  success: boolean
  data?: T
  errors: string[]
  /**
   * 逐条定位的校验问题。原先只回一串错误码（`INVALID_SENSITIVITY`），既没说是哪一条
   * 需求、也没说收到的是什么值——修复提示词无从下手，用户界面上更只剩「重试」。
   */
  details?: AdaptiveValidationIssue[]
}

export interface AdaptiveValidationIssue {
  /** 与 errors 中的错误码一致。 */
  code: string
  /** JSON 路径，例如 `informationNeeds[2].sensitivity`。 */
  path: string
  /** 收到的值（已截断/脱敏），用于让模型和用户都能看懂到底哪里不对。 */
  received?: string
}

const ADAPTIVE_SECRET_PATTERN =
  /(?:bearer\s+)?sk-[a-z0-9_-]{8,}|authorization\s*[:=]\s*[^\s]+|(?:password|密码)\s*[:=]\s*[^\s]+/iu

const PROJECT_UNDERSTANDING_KEYS = new Set([
  'schemaVersion',
  'summaryForUser',
  'inferredDomainLabel',
  'intendedOutcome',
  'likelyDeliverables',
  'knownFacts',
  'informationNeeds',
  'sufficientForPreliminaryDraft',
])

const INFORMATION_NEED_KEYS = new Set([
  'id',
  'topic',
  'missingInformation',
  'decisionImpact',
  'whyItMatters',
  'priority',
  'answerKind',
  'suggestedOptions',
  'dependsOn',
  'confidence',
  'uncertainty',
  'userEffort',
  'sensitivity',
])
const KNOWN_FACT_KEYS = new Set(['id', 'topic', 'value', 'evidence', 'confidence', 'source'])
const INFORMATION_NEED_OPTION_KEYS = new Set(['id', 'label', 'value', 'description'])

function adaptiveDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  return children.reduce((max, child) => Math.max(max, adaptiveDepth(child, depth + 1)), depth)
}

function isBoundedText(value: unknown, max: number = ADAPTIVE_CLARIFICATION_LIMITS.maxTextLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

/**
 * 模型常把决策影响面写成同义词或英文。这些别名是无害的表述差异，
 * 就地映射回闭集即可，没必要为此整轮重来。
 */
const DECISION_AREA_ALIASES: Record<string, InformationNeedDecisionArea> = {
  timeline: 'schedule',
  timing: 'schedule',
  date: 'schedule',
  time: 'schedule',
  时间: 'schedule',
  日期: 'schedule',
  工期: 'schedule',
  budget: 'resource',
  cost: 'resource',
  people: 'resource',
  team: 'resource',
  staffing: 'resource',
  人员: 'resource',
  人力: 'resource',
  预算: 'resource',
  safety: 'risk',
  security: 'risk',
  compliance: 'risk',
  privacy: 'risk',
  安全: 'risk',
  合规: 'risk',
  风险: 'risk',
  quality: 'acceptance',
  success: 'acceptance',
  criteria: 'acceptance',
  验收: 'acceptance',
  标准: 'acceptance',
  output: 'deliverable',
  result: 'deliverable',
  artifact: 'deliverable',
  交付: 'deliverable',
  产出: 'deliverable',
  integration: 'dependency',
  external: 'dependency',
  interface: 'dependency',
  对接: 'dependency',
  外部依赖: 'dependency',
  依赖: 'dependency',
  feature: 'scope',
  functionality: 'scope',
  范围: 'scope',
  功能: 'scope',
}

/**
 * 把模型返回里最常见的形状错误就地修好，不再为此多跑一次模型。
 *
 * 原来的链路是：模型输出 → 严格校验 → 任何一处不合规就整轮作废，带着错误码再问模型一次。
 * 实际踩到的绝大多数却是同一批机械性问题：null 占位、decisionImpact 写成字符串、
 * 少了 confidence/sensitivity、选项缺 value。这些都能在本地确定性地补齐，
 * 省掉一到两次动辄一两分钟的往返。
 *
 * 边界：只修**结构**，绝不发明事实——不会补 topic/missingInformation 这类内容字段，
 * 修不出来的条目直接丢弃，让下面的严格校验继续把关。
 */
export function repairProjectUnderstandingShape(value: unknown): unknown {
  const root = unwrapRoot(value)
  if (!root) return value
  const out: Record<string, unknown> = {}
  for (const key of PROJECT_UNDERSTANDING_KEYS) {
    if (root[key] !== undefined && root[key] !== null) out[key] = root[key]
  }
  out.schemaVersion = ADAPTIVE_CLARIFICATION_SCHEMA_VERSION
  out.summaryForUser = clampText(out.summaryForUser, ADAPTIVE_CLARIFICATION_LIMITS.maxTextLength)
  out.inferredDomainLabel = clampText(out.inferredDomainLabel, 120) || '待人工确认的项目'
  if (out.intendedOutcome !== undefined) {
    const outcome = clampText(out.intendedOutcome, ADAPTIVE_CLARIFICATION_LIMITS.maxTextLength)
    if (outcome) out.intendedOutcome = outcome
    else delete out.intendedOutcome
  }
  out.likelyDeliverables = toRepairArray(out.likelyDeliverables)
    .map((item) => clampText(item, 240))
    .filter(Boolean)
    .slice(0, 20)
  out.knownFacts = toRepairArray(out.knownFacts)
    .map((item, index) => repairKnownFact(item, index))
    .filter((item): item is Record<string, unknown> => item !== null)
    .slice(0, ADAPTIVE_CLARIFICATION_LIMITS.maxKnownFacts)
  const seenNeedIds = new Set<string>()
  out.informationNeeds = toRepairArray(out.informationNeeds)
    .map((item, index) => repairInformationNeed(item, index, seenNeedIds))
    .filter((item): item is Record<string, unknown> => item !== null)
    .slice(0, ADAPTIVE_CLARIFICATION_LIMITS.maxNeeds)
  out.sufficientForPreliminaryDraft = toRepairBoolean(out.sufficientForPreliminaryDraft)
  return out
}

/** 顶层不是对象时的抢救：包在数组里、或整段 JSON 又被套了一层字符串，都还原得回来。 */
function unwrapRoot(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return unwrapRoot(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) {
    const first = value.find((item) => item && typeof item === 'object' && !Array.isArray(item))
    return first ? (first as Record<string, unknown>) : null
  }
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function toRepairArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined)
  if (value === undefined || value === null) return []
  return [value]
}

function clampText(value: unknown, max: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function clampUnit(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(1, Math.max(0, numeric))
}

function toRepairBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLocaleLowerCase() === 'true'
  return false
}

function repairKnownFact(value: unknown, index: number): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const topic = clampText(raw.topic, 160)
  const factValue = clampText(raw.value, ADAPTIVE_CLARIFICATION_LIMITS.maxTextLength)
  // 内容字段缺失就整条丢掉——补一个占位事实等于替用户编事实。
  if (!topic || !factValue) return null
  const source = String(raw.source ?? '')
  return {
    id: clampText(raw.id, 120) || 'fact:' + (index + 1),
    topic,
    value: factValue,
    evidence: clampText(raw.evidence, ADAPTIVE_CLARIFICATION_LIMITS.maxTextLength) || factValue,
    confidence: clampUnit(raw.confidence, 0.6),
    source: PROJECT_KNOWN_FACT_SOURCES.includes(source as ProjectKnownFactSource)
      ? source
      : 'initial_intent',
  }
}

function repairInformationNeed(
  value: unknown,
  index: number,
  seenIds: Set<string>,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const topic = clampText(raw.topic, 160)
  const missingInformation = clampText(
    raw.missingInformation,
    ADAPTIVE_CLARIFICATION_LIMITS.maxTextLength,
  )
  if (!topic || !missingInformation) return null
  let id = clampText(raw.id, 120) || 'need:' + (index + 1)
  while (seenIds.has(id)) id = id + ':' + (index + 1)
  seenIds.add(id)

  const rawAreas = Array.isArray(raw.decisionImpact)
    ? raw.decisionImpact
    : typeof raw.decisionImpact === 'string'
      ? raw.decisionImpact.split(/[,，、/|]+/u)
      : []
  const decisionImpact = [
    ...new Set(
      rawAreas.flatMap((area) => {
        const key = String(area).trim().toLocaleLowerCase()
        if (INFORMATION_NEED_DECISION_AREAS.includes(key as InformationNeedDecisionArea)) {
          return [key]
        }
        const mapped = DECISION_AREA_ALIASES[key]
        return mapped ? [mapped] : []
      }),
    ),
  ]

  const priority = String(raw.priority ?? '')
  const answerKind = String(raw.answerKind ?? '')
  const effort = String(raw.userEffort ?? '')
  const sensitivity = String(raw.sensitivity ?? '')
  const options = toRepairArray(raw.suggestedOptions)
    .map((option, optionIndex) => repairOption(option, id, optionIndex))
    .filter((option): option is Record<string, unknown> => option !== null)
    .slice(0, ADAPTIVE_CLARIFICATION_LIMITS.maxOptions)
  const dependsOn = toRepairArray(raw.dependsOn)
    .map((item) => clampText(item, 120))
    .filter(Boolean)

  const need: Record<string, unknown> = {
    id,
    topic,
    missingInformation,
    // 影响面全军覆没时兜底成 scope：这是「不确定会影响什么」里最保守的取值，
    // 只会让这条需求排序靠后，不会凭空放大它的优先级。
    decisionImpact: decisionImpact.length > 0 ? decisionImpact : ['scope'],
    whyItMatters:
      clampText(raw.whyItMatters, ADAPTIVE_CLARIFICATION_LIMITS.maxTextLength) ||
      '这个答案会改变后续的工作安排。',
    priority: INFORMATION_NEED_PRIORITIES.includes(priority as InformationNeedPriority)
      ? priority
      : 'useful',
    answerKind: INFORMATION_NEED_ANSWER_KINDS.includes(answerKind as InformationNeedAnswerKind)
      ? answerKind
      : 'short_text',
    confidence: clampUnit(raw.confidence, 0.6),
    uncertainty: clampUnit(raw.uncertainty, 0.5),
    userEffort: ['low', 'medium', 'high'].includes(effort) ? effort : 'low',
    sensitivity: ['none', 'low', 'high'].includes(sensitivity) ? sensitivity : 'none',
  }
  if (options.length > 0) need.suggestedOptions = options
  // 选择题没凑够选项就降级成自由作答，而不是让整轮理解作废。
  if (
    options.length < 2 &&
    (need.answerKind === 'single_choice' || need.answerKind === 'multi_choice')
  ) {
    need.answerKind = 'short_text'
  }
  if (dependsOn.length > 0) need.dependsOn = dependsOn
  return need
}

function repairOption(
  value: unknown,
  needId: string,
  index: number,
): Record<string, unknown> | null {
  const fallbackId = needId + ':option:' + (index + 1)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const label = clampText(value, 160)
    return label ? { id: fallbackId, label, value: label } : null
  }
  const raw = value as Record<string, unknown>
  const label = clampText(raw.label, 160)
  if (!label) return null
  const description = clampText(raw.description, 300)
  return {
    id: clampText(raw.id, 120) || fallbackId,
    label,
    value: clampText(raw.value, 240) || label,
    ...(description ? { description } : {}),
  }
}

/**
 * Strict runtime gate for the model's first structured output. It rejects unknown keys,
 * excessive nesting/size and credential-like values before any UI or token is created.
 */
export function validateProjectUnderstanding(
  value: unknown,
): AdaptiveContractValidationResult<ProjectUnderstanding> {
  const errors: string[] = []
  const details: AdaptiveValidationIssue[] = []
  const fail = (code: string, path: string, received?: unknown) => {
    errors.push(code)
    details.push({
      code,
      path,
      ...(received === undefined ? {} : { received: describeReceived(received) }),
    })
  }
  let serialized = ''
  try {
    serialized = JSON.stringify(value)
  } catch {
    return {
      success: false,
      errors: ['NOT_SERIALIZABLE'],
      details: [{ code: 'NOT_SERIALIZABLE', path: '$' }],
    }
  }
  const payloadBytes = new TextEncoder().encode(serialized).length
  if (payloadBytes > ADAPTIVE_CLARIFICATION_LIMITS.maxPayloadBytes) {
    fail('PAYLOAD_TOO_LARGE', '$', payloadBytes + ' 字节')
  }
  if (adaptiveDepth(value) > ADAPTIVE_CLARIFICATION_LIMITS.maxDepth) {
    fail('NESTING_TOO_DEEP', '$')
  }
  const secretMatch = ADAPTIVE_SECRET_PATTERN.exec(serialized)
  if (secretMatch) fail('SENSITIVE_VALUE_EXPOSED', '$', maskSecret(secretMatch[0]))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_ROOT', '$', Array.isArray(value) ? 'array' : typeof value)
    return { success: false, errors: [...new Set(errors)], details }
  }
  const root = value as Record<string, unknown>
  const unknownRootKeys = Object.keys(root).filter((key) => !PROJECT_UNDERSTANDING_KEYS.has(key))
  if (unknownRootKeys.length > 0) fail('UNKNOWN_FIELD', '$', unknownRootKeys.join(','))
  if (root.schemaVersion !== ADAPTIVE_CLARIFICATION_SCHEMA_VERSION) {
    fail('INVALID_VERSION', '$.schemaVersion', root.schemaVersion)
  }
  if (!isBoundedText(root.summaryForUser)) fail('INVALID_SUMMARY', '$.summaryForUser')
  if (!isBoundedText(root.inferredDomainLabel, 120)) {
    fail('INVALID_DOMAIN_LABEL', '$.inferredDomainLabel')
  }
  if (root.intendedOutcome !== undefined && !isBoundedText(root.intendedOutcome)) {
    fail('INVALID_OUTCOME', '$.intendedOutcome')
  }
  if (
    !Array.isArray(root.likelyDeliverables) ||
    root.likelyDeliverables.length > 20 ||
    root.likelyDeliverables.some((item) => !isBoundedText(item, 240))
  ) {
    fail('INVALID_DELIVERABLES', '$.likelyDeliverables')
  }
  if (
    !Array.isArray(root.knownFacts) ||
    root.knownFacts.length > ADAPTIVE_CLARIFICATION_LIMITS.maxKnownFacts
  ) {
    fail('INVALID_KNOWN_FACTS', '$.knownFacts')
  } else {
    root.knownFacts.forEach((rawFact, index) => {
      const path = '$.knownFacts[' + index + ']'
      if (!rawFact || typeof rawFact !== 'object' || Array.isArray(rawFact)) {
        fail('INVALID_KNOWN_FACT', path, rawFact)
        return
      }
      const fact = rawFact as Record<string, unknown>
      const unknownKeys = Object.keys(fact).filter((key) => !KNOWN_FACT_KEYS.has(key))
      if (unknownKeys.length > 0) fail('UNKNOWN_KNOWN_FACT_FIELD', path, unknownKeys.join(','))
      if (
        !isBoundedText(fact.id, 120) ||
        !isBoundedText(fact.topic, 160) ||
        !isBoundedText(fact.value) ||
        !isBoundedText(fact.evidence)
      ) {
        fail('INVALID_KNOWN_FACT_TEXT', path)
      }
      if (typeof fact.confidence !== 'number' || fact.confidence < 0 || fact.confidence > 1) {
        fail('INVALID_KNOWN_FACT_CONFIDENCE', path + '.confidence', fact.confidence)
      }
      if (!PROJECT_KNOWN_FACT_SOURCES.includes(String(fact.source) as ProjectKnownFactSource)) {
        fail('INVALID_KNOWN_FACT_SOURCE', path + '.source', fact.source)
      }
    })
  }
  const needs = Array.isArray(root.informationNeeds) ? root.informationNeeds : []
  if (
    !Array.isArray(root.informationNeeds) ||
    needs.length > ADAPTIVE_CLARIFICATION_LIMITS.maxNeeds
  ) {
    fail('INVALID_INFORMATION_NEEDS', '$.informationNeeds', needs.length)
  }
  const needIds = new Set<string>()
  needs.forEach((rawNeed, index) => {
    const path = '$.informationNeeds[' + index + ']'
    if (!rawNeed || typeof rawNeed !== 'object' || Array.isArray(rawNeed)) {
      fail('INVALID_INFORMATION_NEED', path, rawNeed)
      return
    }
    const need = rawNeed as Record<string, unknown>
    const unknownKeys = Object.keys(need).filter((key) => !INFORMATION_NEED_KEYS.has(key))
    if (unknownKeys.length > 0) fail('UNKNOWN_NEED_FIELD', path, unknownKeys.join(','))
    if (!isBoundedText(need.id, 120) || needIds.has(String(need.id))) {
      fail('INVALID_NEED_ID', path + '.id', need.id)
    }
    needIds.add(String(need.id))
    if (!isBoundedText(need.topic, 160) || !isBoundedText(need.missingInformation)) {
      fail('INVALID_NEED_TEXT', path)
    }
    if (!isBoundedText(need.whyItMatters)) fail('INVALID_NEED_REASON', path + '.whyItMatters')
    if (
      !Array.isArray(need.decisionImpact) ||
      need.decisionImpact.length === 0 ||
      need.decisionImpact.some(
        (area) => !INFORMATION_NEED_DECISION_AREAS.includes(area as InformationNeedDecisionArea),
      )
    ) {
      fail('INVALID_DECISION_IMPACT', path + '.decisionImpact', need.decisionImpact)
    }
    if (!INFORMATION_NEED_PRIORITIES.includes(need.priority as InformationNeedPriority)) {
      fail('INVALID_PRIORITY', path + '.priority', need.priority)
    }
    if (!INFORMATION_NEED_ANSWER_KINDS.includes(need.answerKind as InformationNeedAnswerKind)) {
      fail('INVALID_ANSWER_KIND', path + '.answerKind', need.answerKind)
    }
    if (typeof need.confidence !== 'number' || need.confidence < 0 || need.confidence > 1) {
      fail('INVALID_CONFIDENCE', path + '.confidence', need.confidence)
    }
    if (typeof need.uncertainty !== 'number' || need.uncertainty < 0 || need.uncertainty > 1) {
      fail('INVALID_UNCERTAINTY', path + '.uncertainty', need.uncertainty)
    }
    if (!['low', 'medium', 'high'].includes(String(need.userEffort))) {
      fail('INVALID_EFFORT', path + '.userEffort', need.userEffort)
    }
    if (!['none', 'low', 'high'].includes(String(need.sensitivity))) {
      fail('INVALID_SENSITIVITY', path + '.sensitivity', need.sensitivity)
    }
    if (
      need.suggestedOptions !== undefined &&
      (!Array.isArray(need.suggestedOptions) ||
        need.suggestedOptions.length > ADAPTIVE_CLARIFICATION_LIMITS.maxOptions)
    ) {
      fail('INVALID_OPTIONS', path + '.suggestedOptions', need.suggestedOptions)
    } else if (Array.isArray(need.suggestedOptions)) {
      need.suggestedOptions.forEach((rawOption, optionIndex) => {
        const optionPath = path + '.suggestedOptions[' + optionIndex + ']'
        if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) {
          fail('INVALID_OPTION', optionPath, rawOption)
          return
        }
        const option = rawOption as Record<string, unknown>
        const unknownOptionKeys = Object.keys(option).filter(
          (key) => !INFORMATION_NEED_OPTION_KEYS.has(key),
        )
        if (unknownOptionKeys.length > 0) {
          fail('UNKNOWN_OPTION_FIELD', optionPath, unknownOptionKeys.join(','))
        }
        if (
          !isBoundedText(option.id, 120) ||
          !isBoundedText(option.label, 160) ||
          !isBoundedText(option.value, 240) ||
          (option.description !== undefined && !isBoundedText(option.description, 300))
        ) {
          fail('INVALID_OPTION_TEXT', optionPath)
        }
      })
    }
  })
  if (typeof root.sufficientForPreliminaryDraft !== 'boolean') {
    fail(
      'INVALID_SUFFICIENCY',
      '$.sufficientForPreliminaryDraft',
      root.sufficientForPreliminaryDraft,
    )
  }
  return errors.length === 0
    ? { success: true, data: value as ProjectUnderstanding, errors: [] }
    : { success: false, errors: [...new Set(errors)], details }
}

/** 把收到的值压成一句可读、能同时放进提示词与界面的短描述。 */
function describeReceived(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value.slice(0, 80)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value).slice(0, 120)
  } catch {
    return typeof value
  }
}

/** 命中密钥模式时只回显头尾：够用户认出是哪一段，又不会把凭据再抄一遍。 */
function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return '***'
  return trimmed.slice(0, 4) + '***' + trimmed.slice(-2)
}

/** Convert old fixed-field answers into a read-only adaptive ledger without losing values. */
export function adaptLegacyClarificationAnswers(
  answers: ClarificationAnswers,
  now = new Date().toISOString(),
): ClarificationLedger {
  const entries: ClarificationLedgerEntry[] = []
  for (const [field, answer] of Object.entries(answers)) {
    if (!answer) continue
    const needId = `legacy:${field}`
    if (answer.action === 'skip') {
      entries.push({
        needId,
        topic: field,
        status: 'known_unknown',
        questionSummary: field,
        knownUnknown: {
          needId,
          topic: field,
          impact: '旧版会话中未确认，生成时必须作为待决定事项处理。',
          recordedAt: now,
        },
        revision: 1,
        updatedAt: now,
      })
      continue
    }
    if (answer.value === null) continue
    entries.push({
      needId,
      topic: field,
      status: 'answered',
      questionSummary: field,
      answer: answer.value,
      revision: 1,
      updatedAt: now,
    })
  }
  return {
    schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
    revision: entries.length,
    entries,
  }
}
