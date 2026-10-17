/**
 * v3-copilot-web-search-tool — 外部检索共享契约
 *
 * 设计纪律（D1-D7）：
 * - D1：授权门短路点在"发出请求之前"
 * - D2：域名白名单准入制
 * - D3：外部检索单独计量，不与模型调用共用额度
 * - D4：超额与域名拒绝明确拒绝；抓取失败可降级
 * - D5：落账记录搜索词类别，不落原文
 * - D6：抓取结果不建索引、不进生产知识层
 * - D7：与 external-content-safety 同期落地
 *
 * 禁存边界：落账不含搜索词原文、网页正文、prompt、模型输出、token 与 secret。
 */

// ---------------------------------------------------------------------------
// 拒绝原因枚举
// ---------------------------------------------------------------------------

/** 检索决策中的拒绝原因。 */
export const RETRIEVAL_REJECTION_REASONS = [
  'authorization_gated', // 授权门未开
  'domain_not_in_allowlist', // 域名不在白名单
  'domain_in_denylist', // 域名在黑名单
  'quota_exhausted', // 超配额
  'fetch_timeout', // 抓取超时
  'fetch_failed', // 抓取失败
] as const

export type RetrievalRejectionReason = (typeof RETRIEVAL_REJECTION_REASONS)[number]

/** 拒绝原因标签（低敏展示）。 */
export const RETRIEVAL_REJECTION_REASON_LABELS: Record<RetrievalRejectionReason, string> = {
  authorization_gated: '授权门未开',
  domain_not_in_allowlist: '域名不在白名单',
  domain_in_denylist: '域名在黑名单',
  quota_exhausted: '超配额',
  fetch_timeout: '抓取超时',
  fetch_failed: '抓取失败',
}

// ---------------------------------------------------------------------------
// 搜索词类别（不落原文）
// ---------------------------------------------------------------------------

/** 搜索词类别枚举（用于落账，替代搜索词原文）。 */
export const RETRIEVAL_QUERY_CATEGORIES = [
  'technical', // 技术类
  'regulatory', // 法规类
  'vendor', // 供应商类
  'general', // 通用类
] as const

export type RetrievalQueryCategory = (typeof RETRIEVAL_QUERY_CATEGORIES)[number]

/** 搜索词类别标签。 */
export const RETRIEVAL_QUERY_CATEGORY_LABELS: Record<RetrievalQueryCategory, string> = {
  technical: '技术',
  regulatory: '法规',
  vendor: '供应商',
  general: '通用',
}

// ---------------------------------------------------------------------------
// 域名策略
// ---------------------------------------------------------------------------

/** 域名策略条目类型。 */
export type DomainPolicyEntryType = 'exact' | 'suffix_wildcard'

/** 域名策略条目。 */
export interface DomainPolicyEntry {
  /** 域名模式（精确匹配或后缀通配，如 "*.gov.cn"） */
  pattern: string
  /** 条目类型：精确匹配或后缀通配 */
  type: DomainPolicyEntryType
}

/** 域名策略。 */
export interface DomainPolicy {
  /** 组织 ID（组织隔离） */
  organizationId: number
  /** 白名单（准入制：不在白名单内一律不抓） */
  allowlist: DomainPolicyEntry[]
  /** 黑名单（在白名单之上再排除） */
  denylist: DomainPolicyEntry[]
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 检索请求
// ---------------------------------------------------------------------------

/** 外部检索请求。 */
export interface RetrievalRequest {
  /** 组织 ID */
  organizationId: number
  /** 用户 ID */
  userId: number
  /** 搜索查询词（仅用于构造搜索请求，不落库） */
  query: string
  /** 搜索词类别（落账用，由分类器从 query 派生） */
  queryCategory: RetrievalQueryCategory
  /** 最大结果数 */
  maxResults: number
  /** 回合 ID（用于关联决策记录） */
  turnId: string
}

// ---------------------------------------------------------------------------
// 检索结果条目
// ---------------------------------------------------------------------------

/** 检索结果条目。 */
export interface RetrievalResultEntry {
  /** 结果 URL */
  url: string
  /** 结果标题 */
  title: string
  /** 结果摘要（模型生成的摘要，非网页正文） */
  snippet: string
  /** 抓取时间 ISO */
  fetchedAt: string
  /** 快照 hash（网页正文的确定性摘要，不存正文本身） */
  snapshotHash: string
  /** 来源标记 */
  source: 'external'
  /** 抓取是否完整（部分失败时为 false） */
  isComplete: boolean
  /** 抓取失败原因（仅 isComplete=false 时有值） */
  failureReason?: RetrievalRejectionReason
}

// ---------------------------------------------------------------------------
// 检索结果集
// ---------------------------------------------------------------------------

/** 检索结果集（含完整性标记）。 */
export interface RetrievalResultSet {
  /** 结果条目列表 */
  entries: RetrievalResultEntry[]
  /** 是否完整（所有抓取均成功为 true） */
  isComplete: boolean
  /** 被拒域名计数（不暴露具体 URL） */
  rejectedDomainCount: number
  /** 搜索词类别（落账用） */
  queryCategory: RetrievalQueryCategory
  /** 检索耗时（毫秒） */
  elapsedMs: number
}

// ---------------------------------------------------------------------------
// 检索决策记录（低敏）
// ---------------------------------------------------------------------------

/**
 * 检索决策记录（低敏形状）。
 *
 * 禁存：搜索词原文、网页正文、prompt、模型输出、token 与 secret。
 * 只存：搜索词类别、命中域名、被拒域名、失败原因、耗时。
 */
export interface RetrievalDecisionRecord {
  /** 决策记录 ID */
  id: string
  /** 组织 ID（组织隔离） */
  organizationId: number
  /** 用户 ID */
  userId: number
  /** 回合 ID */
  turnId: string
  /** 搜索词类别（不落原文，也不落 hash） */
  queryCategory: RetrievalQueryCategory
  /** 命中域名列表（去重后的域名集合） */
  matchedDomains: string[]
  /** 被拒域名计数（不暴露具体 URL） */
  rejectedDomainCount: number
  /** 拒绝原因计数（按原因分类） */
  rejectionReasonCounts: Record<RetrievalRejectionReason, number>
  /** 检索耗时（毫秒） */
  elapsedMs: number
  /** 结果数量 */
  resultCount: number
  /** 是否完整 */
  isComplete: boolean
  /** 创建时间 ISO */
  createdAt: string
}

// ---------------------------------------------------------------------------
// 授权状态
// ---------------------------------------------------------------------------

/** 外部检索授权状态。 */
export interface RetrievalAuthorizationState {
  /** 组织 ID */
  organizationId: number
  /** 是否已授权 */
  authorized: boolean
  /** 授权人用户 ID */
  authorizedByUserId: number | null
  /** 授权时间 */
  authorizedAt: string | null
}

// ---------------------------------------------------------------------------
// Provider 适配器接口
// ---------------------------------------------------------------------------

/** 搜索 provider 适配器接口（可替换）。 */
export interface RetrievalSearchProvider {
  /** 搜索：返回候选 URL 列表 */
  search(query: string, maxResults: number): Promise<RetrievalSearchResult[]>
}

/** 搜索结果候选（来自搜索 provider）。 */
export interface RetrievalSearchResult {
  url: string
  title: string
  snippet: string
}

/** 抓取 provider 适配器接口（可替换）。 */
export interface RetrievalFetchProvider {
  /** 抓取单个 URL 的内容 */
  fetch(url: string, timeoutMs: number): Promise<RetrievalFetchResult>
}

/** 抓取结果。 */
export interface RetrievalFetchResult {
  /** 是否成功 */
  success: boolean
  /** 网页正文（仅用于构造摘要，不落库不缓存） */
  body?: string
  /** 失败原因 */
  failureReason?: RetrievalRejectionReason
}

/** 摘要 provider 适配器接口（可替换）。 */
export interface RetrievalSummaryProvider {
  /** 从网页正文生成摘要 */
  summarize(body: string, query: string): Promise<string>
}

// ---------------------------------------------------------------------------
// 配额
// ---------------------------------------------------------------------------

/** 外部检索配额策略。 */
export interface RetrievalQuotaPolicy {
  /** 组织 ID */
  organizationId: number
  /** 窗口内最大检索次数 */
  maxRetrievalsPerWindow: number
  /** 窗口大小（毫秒），默认 60000（1 分钟） */
  windowMs: number
}

/** 配额判定结果。 */
export interface RetrievalQuotaResult {
  /** 是否允许 */
  allowed: boolean
  /** 当前窗口已用次数 */
  currentCount: number
  /** 窗口内上限 */
  limit: number
  /** 重试建议秒数（仅 allowed=false 时有值） */
  retryAfterSeconds: number | null
}

// ---------------------------------------------------------------------------
// v3-copilot-optional-web-search-configuration — 组织级可配置工具合同
// ---------------------------------------------------------------------------
//
// 设计纪律（design B-G）：
// - 默认关闭：无设置 = 不联网；组织开启 + provider 配置 + 权限 + 按次同意才可调用
// - secret-safe：API key 只存在 AI connection 密文存储；GET 只回 configured/masked
// - 双门授权：组织 policy ∧ 用户 per-turn consent；router 仍可拒绝不必要的搜索
// - internal/external 分区：外部 evidence 不得冒充项目事实
// - 真实 provider conditional：本模块只定义 provider 中立合同，不接真实网络

// ---------------------------------------------------------------------------
// 组织设置（B）
// ---------------------------------------------------------------------------

/** 组织级外部网页搜索设置（JSON 序列化到 OrganizationSetting 值）。 */
export interface CopilotWebSearchSettings {
  /** 组织 ID（组织隔离） */
  organizationId: number
  /** 总开关，默认 false */
  enabled: boolean
  /** 搜索 provider 连接 ID（指向既有 AI connection，key 存密文） */
  providerConnectionId: number | null
  /** 域名 allow（留空 = 不限制；设置后为准入制，不在名单一律不抓；`*.gov.cn` 后缀通配） */
  allowedDomains: string[]
  /** 域名 deny（在白名单之上再排除） */
  deniedDomains: string[]
  /** 每个自然日搜索额度（组织级） */
  dailyQueryLimit: number
  /** 单次查询最大结果数 */
  maxResultsPerQuery: number
  /** 单次抓取超时（毫秒） */
  timeoutMs: number
  /** 结果缓存新鲜度（分钟） */
  cacheTtlMinutes: number
  /** 决策记录保留天数 */
  retainDecisionDays: number
  /** 必须按次同意（本版本锁定为 true） */
  requirePerTurnConsent: true
  /** 是否允许用于 AI 快速创建 */
  allowForAiCreate: boolean
  /** 是否允许用于通用 Copilot */
  allowForGeneralCopilot: boolean
  /** 搜索提供方（旧记录无此字段 = free：免密钥公开搜索）。 */
  providerKind?: CopilotWebSearchProviderKind
  /** 自建 SearXNG 等需要的服务地址。 */
  providerBaseUrl?: string | null
}

/**
 * 网页搜索提供方。
 * - free：免密钥公开接口（DuckDuckGo 网页结果 + 维基百科），默认与兜底；
 * - tavily / brave / bocha：商业搜索 API，需要密钥；
 * - searxng：自建 SearXNG 实例，需要服务地址（JSON 输出需在实例里开启）。
 * 选了需要密钥的提供方但调用失败时，自动退回 free。
 */
export const COPILOT_WEB_SEARCH_PROVIDER_KINDS = [
  'free',
  'tavily',
  'brave',
  'bocha',
  'searxng',
] as const
export type CopilotWebSearchProviderKind = (typeof COPILOT_WEB_SEARCH_PROVIDER_KINDS)[number]

export const COPILOT_WEB_SEARCH_PROVIDER_META: Record<
  CopilotWebSearchProviderKind,
  { label: string; description: string; requiresKey: boolean; requiresBaseUrl: boolean }
> = {
  free: {
    label: '免费公开搜索（无需密钥）',
    description: 'DuckDuckGo 网页结果 + 维基百科，开箱即用；频繁调用可能被限流',
    requiresKey: false,
    requiresBaseUrl: false,
  },
  tavily: {
    label: 'Tavily',
    description: '面向 AI 的搜索 API，返回正文摘要；需要 API Key',
    requiresKey: true,
    requiresBaseUrl: false,
  },
  brave: {
    label: 'Brave Search',
    description: '独立索引的网页搜索 API；需要订阅 Token',
    requiresKey: true,
    requiresBaseUrl: false,
  },
  bocha: {
    label: '博查 Bocha',
    description: '中文网页搜索 API，国内访问友好；需要 API Key',
    requiresKey: true,
    requiresBaseUrl: false,
  },
  searxng: {
    label: '自建 SearXNG',
    description: '开源元搜索，填自建实例地址（需在实例里开启 JSON 输出）；无需密钥',
    requiresKey: false,
    requiresBaseUrl: true,
  },
}

/** OrganizationSetting 中网页搜索提供方密钥（密文）的键。 */
export const COPILOT_WEB_SEARCH_PROVIDER_KEY_KEY = 'copilot.web_search.provider_key'

/** OrganizationSetting 中设置 JSON 的键。 */
export const COPILOT_WEB_SEARCH_SETTINGS_KEY = 'copilot.web_search.settings'

/** OrganizationSetting 中每日配额计数 JSON 的键前缀（后接 organizationId）。 */
export const COPILOT_WEB_SEARCH_QUOTA_KEY_PREFIX = 'copilot.web_search.quota.'

/** 管理组织级网页搜索设置所需的权限。 */
export const COPILOT_WEB_SEARCH_MANAGE_PERMISSION = 'copilot:web_search:manage'

/** 默认每自然日查询额度。 */
export const COPILOT_WEB_SEARCH_DEFAULT_DAILY_QUERY_LIMIT = 50
/** 默认单次查询最大结果数。 */
export const COPILOT_WEB_SEARCH_DEFAULT_MAX_RESULTS = 5
/** 默认抓取超时（毫秒）。 */
export const COPILOT_WEB_SEARCH_DEFAULT_TIMEOUT_MS = 15_000
/** 默认缓存新鲜度（分钟）。 */
export const COPILOT_WEB_SEARCH_DEFAULT_CACHE_TTL_MINUTES = 60
/** 默认决策记录保留天数。 */
export const COPILOT_WEB_SEARCH_DEFAULT_RETAIN_DAYS = 30

/** 构造默认（关闭）设置。 */
export function defaultCopilotWebSearchSettings(organizationId: number): CopilotWebSearchSettings {
  return {
    organizationId,
    enabled: false,
    providerConnectionId: null,
    allowedDomains: [],
    deniedDomains: [],
    dailyQueryLimit: COPILOT_WEB_SEARCH_DEFAULT_DAILY_QUERY_LIMIT,
    maxResultsPerQuery: COPILOT_WEB_SEARCH_DEFAULT_MAX_RESULTS,
    timeoutMs: COPILOT_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
    cacheTtlMinutes: COPILOT_WEB_SEARCH_DEFAULT_CACHE_TTL_MINUTES,
    retainDecisionDays: COPILOT_WEB_SEARCH_DEFAULT_RETAIN_DAYS,
    requirePerTurnConsent: true,
    allowForAiCreate: false,
    allowForGeneralCopilot: false,
    providerKind: 'free',
    providerBaseUrl: null,
  }
}

/**
 * 网页搜索授权来源（2026-10-05：超级管理员 + 组织管理员双层同意）。
 * - platform：平台统一 AI 配置组织（超级管理员所在），自己的开关即平台同意；
 * - personal：个人帐号（free 且只有本人的个人组织，如 Google 登录自动建立的），
 *   只要超级管理员在平台同意即可使用，沿用平台的提供方与来源限制；
 * - organization：团队 / 企业组织，须超级管理员（平台）与组织管理员（本组织开关）都同意。
 */
export type CopilotWebSearchGovernanceMode = 'platform' | 'personal' | 'organization'

export interface CopilotWebSearchGovernance {
  mode: CopilotWebSearchGovernanceMode
  /** 超级管理员是否已在平台开放网页搜索（未建立平台组织的部署视为已开放）。 */
  platformApproved: boolean
  /** 本组织管理员是否已开启（personal 模式与平台同意一致）。 */
  organizationApproved: boolean
  /** 两层都同意后，成员在 AI 同事里是否真的能打开网页搜索。 */
  effectiveEnabled: boolean
}

/** 设置低敏投影（GET 用；永不含 credential）。 */
export interface CopilotWebSearchSettingsSummary {
  organizationId: number
  /** 总开关。 */
  enabled: boolean
  /** provider 是否已配置（连接存在且有 key）。 */
  configured: boolean
  /** 脱敏 provider 标签（如 `openai-compatible •••••1234`），未配置为 null。 */
  maskedProviderLabel: string | null
  providerConnectionId: number | null
  /** 允许域名列表（域名策略非 secret，回列表供编辑）。 */
  allowedDomains: string[]
  /** 拒绝域名列表。 */
  deniedDomains: string[]
  allowedDomainCount: number
  deniedDomainCount: number
  dailyQueryLimit: number
  maxResultsPerQuery: number
  timeoutMs: number
  cacheTtlMinutes: number
  retainDecisionDays: number
  requirePerTurnConsent: true
  allowForAiCreate: boolean
  allowForGeneralCopilot: boolean
  /** 当前搜索提供方。 */
  providerKind: CopilotWebSearchProviderKind
  /** 自建服务地址（非 secret）。 */
  providerBaseUrl: string | null
  /** 提供方密钥是否已设置（永不回明文）。 */
  providerKeyConfigured: boolean
  /** 密钥末四位提示（如 …ab12），未设置为 null。 */
  providerKeyHint: string | null
  /** 授权来源与生效状态（旧服务端无此字段时按 enabled && allowForGeneralCopilot 判断）。 */
  governance?: CopilotWebSearchGovernance
}

// ---------------------------------------------------------------------------
// 按次同意与降级码（B/F）
// ---------------------------------------------------------------------------

/**
 * 网页搜索门结果码（typed degraded / no-call）。
 * 对应 design F 文案；`called` / `not_needed` 为正常态非降级。
 */
export const COPILOT_WEB_SEARCH_GATE_CODES = [
  'web_search_disabled', //   组织未启用
  'web_search_consent_required', // 用户未开启本次同意
  'web_search_quota_exceeded', // 组织额度用完
  'web_search_domain_blocked', // 结果来源被域名策略拒绝
  'web_search_timeout', //      provider 超时
  'web_search_content_unsafe', // 外部内容未过安全检查
  'web_search_no_results', //  搜索没有找到任何结果（与「未过安全检查」区分，避免误导）
  'web_search_permission_denied', // 无权限（非泄露语义）
  'web_search_called', //      正常调用完成
  'web_search_not_needed', //  router 判断本次不需要外部资料
] as const

export type CopilotWebSearchGateCode = (typeof COPILOT_WEB_SEARCH_GATE_CODES)[number]

/** 门结果码 UI 文案（低敏）。 */
export const COPILOT_WEB_SEARCH_GATE_LABELS: Record<CopilotWebSearchGateCode, string> = {
  web_search_disabled: '网页搜索未开启；本次仅使用项目和内部知识。',
  web_search_consent_required: '若希望查询外部资料，请开启「允许本次使用网页搜索」。',
  web_search_quota_exceeded: '今日组织搜索额度已用完；已改用内部资料。',
  web_search_domain_blocked: '结果来自组织禁止的来源，未用于回答。',
  web_search_timeout: '外部搜索超时；已继续使用内部资料。',
  web_search_content_unsafe: '外部内容未通过安全检查，未交给模型。',
  web_search_no_results: '外部搜索没有找到相关结果；已改用内部资料作答。',
  web_search_permission_denied: '你没有使用外部搜索的权限；本次仅使用项目和内部知识。',
  web_search_called: '已使用外部网页搜索（结果带引用来源）。',
  web_search_not_needed: '本次问题不需要外部资料。',
}

/** 正常态（非降级）门码。 */
export const COPILOT_WEB_SEARCH_OK_GATE_CODES: readonly CopilotWebSearchGateCode[] = [
  'web_search_called',
  'web_search_not_needed',
]

// ---------------------------------------------------------------------------
// 外部证据（E）与门结果
// ---------------------------------------------------------------------------

/** 单条外部证据：可追溯、可分区、不可冒充项目事实。 */
export interface ExternalEvidence {
  /** 标题 */
  title: string
  /** 规范化 URL */
  canonicalUrl: string
  /** 访问时间 ISO */
  accessedAt: string
  /** provider 标识（低敏，如 fixture） */
  provider: string
  /** 摘要节选（有界） */
  excerpt: string
  /** 内容确定性 hash */
  contentHash: string
  /** 可信带：官方来源 / 已知来源 / 未验证 */
  trustBand: 'official' | 'known' | 'unverified'
  /** 政策决策记录引用（关联 audit/ledger） */
  policyDecisionRef: string
}

/** 外部证据摘要最大长度（防上下文膨胀）。 */
export const EXTERNAL_EVIDENCE_MAX_EXCERPT = 600

/** 单次门判定产出：typed no-call / degraded / called。 */
export type CopilotWebSearchGateResult =
  | {
      readonly status: 'called'
      /** 通过全部检查并被安全管线放行的证据（零假引用：未通过的一律不出现）。 */
      readonly evidence: readonly ExternalEvidence[]
      /** 结果集（供用量统计）。 */
      readonly resultCount: number
      /** 决策记录引用。 */
      readonly policyDecisionRef: string
    }
  | {
      readonly status: 'not_called'
      readonly code: Extract<
        CopilotWebSearchGateCode,
        | 'web_search_disabled'
        | 'web_search_consent_required'
        | 'web_search_permission_denied'
        | 'web_search_not_needed'
      >
      readonly message: string
    }
  | {
      readonly status: 'degraded'
      readonly code: Extract<
        CopilotWebSearchGateCode,
        | 'web_search_quota_exceeded'
        | 'web_search_domain_blocked'
        | 'web_search_timeout'
        | 'web_search_content_unsafe'
        | 'web_search_no_results'
      >
      readonly message: string
      /** 降级但仍有通过检查的证据（部分失败时可为空）。 */
      readonly evidence: readonly ExternalEvidence[]
    }

// ---------------------------------------------------------------------------
// 审计合同（低敏）
// ---------------------------------------------------------------------------

/**
 * 网页搜索审计形状（落 audit_logs metadata；禁存：key、完整 query、正文、prompt、输出）。
 */
export interface CopilotWebSearchAuditShape {
  organizationId: number
  actorId: number
  turnId: string | null
  /** 落账用搜索词类别（不落原文，也不落 hash）。 */
  queryCategory: RetrievalQueryCategory | null
  gateCode: CopilotWebSearchGateCode
  resultCount: number
  degraded: boolean
  elapsedMs: number
  domainDecision: 'allowed' | 'blocked' | 'mixed'
  /** 低敏用途摘要（≤ 48 字符）。 */
  queryPurpose: string
  /** 常量真值：本记录不含 secret（防漂移）。 */
  noSecret: true
}

// ---------------------------------------------------------------------------
// router 必要性判断（D）
// ---------------------------------------------------------------------------

/**
 * 触发外部搜索的窄意图关键词（闭集）。
 *
 * 典型意图：当前法规/票价/供应商市场/公开场地信息/最新行业数据。
 * 不能触发：项目当前进度、内部任务、成员负载、普通问候、未开启的任何问题。
 */
export const COPILOT_WEB_SEARCH_TRIGGER_KEYWORDS = [
  '申报要求',
  '申报',
  '消防',
  '法规',
  '政策',
  '条例',
  '规定',
  '标准',
  '票价',
  '价格',
  '行情',
  '市场',
  '供应商',
  '报价',
  '公开',
  '场地',
  '展馆',
  '开放时间',
  '最新',
  '行业数据',
  '现状',
  // 外部经验类线索：即使同时提到「本项目」，也需要外部资料（2026-09-26）
  '行业',
  '业界',
  '最佳实践',
  '同业',
  '案例',
  '监管',
  '趋势',
  '官方文档',
  '开源',
  // 时效性公共信息（2026-10-05）：股价、现任职位、新闻等永远是外部资料
  '股价',
  '股價',
  '股票',
  '汇率',
  '匯率',
  '新闻',
  '新聞',
  '现任',
  '現任',
  '总统',
  '總統',
  '首相',
  '总理',
  '總理',
  '天气',
  '天氣',
  '比分',
  '实时',
  '即時',
] as const

/**
 * 明显在问本平台内部数据的标记词：这类问题答案在项目数据里，搜网页没有意义。
 */
export const COPILOT_WEB_SEARCH_INTERNAL_MARKERS = [
  '项目',
  '任务',
  '里程碑',
  '甘特',
  '看板',
  'WBS',
  '成员',
  '负载',
  '工时',
  '排期',
  '我的',
  '本周',
  '本月',
  '团队',
] as const

/**
 * router 必要性判定：文本是否可能依赖外部资料。
 *
 * 纯确定性函数（无时钟、无外部依赖），供 tool gate 在
 * 组织允许 + 用户本次开启网页搜索之后做最后一道「是否真的需要」判断：
 * - 命中外部意图关键词（法规/价格/最新…）→ 需要；
 * - 明显在问项目内部数据（任务/成员/里程碑…）→ 不需要；
 * - 其余一般性问题（概念、技术、新闻、对比…）→ 需要。原先只认闭集关键词，
 *   用户开了网页搜索问「Kubernetes 1.31 有什么变化」也不会搜，与开关语义不符。
 */
export function copilotWebSearchNeedsExternal(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 4) return false
  if (COPILOT_WEB_SEARCH_TRIGGER_KEYWORDS.some((keyword) => trimmed.includes(keyword))) return true
  if (COPILOT_WEB_SEARCH_INTERNAL_MARKERS.some((marker) => trimmed.includes(marker))) return false
  return true
}
