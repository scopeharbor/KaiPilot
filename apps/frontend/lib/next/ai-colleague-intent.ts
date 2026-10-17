/**
 * 新轨 AI 同事轻量意图路由器与规则编排器（v3-ui-next-ai-colleague W1 · tasks 1.3）。
 *
 * v1 阶段恪守 Non-Goal 4：不引入 LLM 意图理解依赖，全部由确定性关键词/正则规则
 * 分发（design Decision 1「意图分发规则表」）。所有命中的卡面都必须由 UI 层标注
 * 「⚡ 快捷规则匹配 · <toolName>」诚实披露（RL-07），严禁以规则匹配冒充模型推理。
 *
 * 防误触设计：
 * - 写操作意图（延期/改期/推迟/提前/调整排程 + 任务/排程/工期语境）优先级最高，
 *   先于列表类规则判定，杜绝「延期任务 12 至 2026-09-15」被 `list_project_tasks`
 *   误吞；
 * - 解析不完整防猜忌（design D1 §3）：命中写操作意图但缺少任务编号或目标日期时
 *   坚决不猜测默认值，返回 `toolName: null` + 诚实引导文案；
 * - 单项目领域工具（summary/tasks/risks/schedule）自动注入当前 `projectId`，
 *   缺少项目上下文时抛出 `ContextMissingError`，由调用方友好引导（D-context §2）。
 */
import type { TaskStatus } from '@/lib/api/tasks'
import { searchApi } from '@/lib/api/search'
import type { SearchEntityType } from '@aiproj/types'
import { resolveMorningBriefingIntent } from './ai-morning-briefing'

export type ColleagueIntentSource = 'rule_preset' | 'llm_inference'

export interface ParsedColleagueIntent {
  toolName: string | null
  parameters: Record<string, unknown>
  intentSource: ColleagueIntentSource
  /** 1.0 为规则确定性命中，0 为未识别/未完整解析。 */
  confidence: number
  matchedRuleId?: string
  /** 未识别或解析不完整时的诚实引导文案。 */
  fallbackPrompt?: string
}

export type ColleagueContextType = 'project_space' | 'role_home' | 'theater_create' | 'unknown'

/** 情境感知器输入（W4 由 `usePathname` + `useProjectSpaceEntityStore` 组装）。 */
export interface ColleagueContext {
  contextType: ColleagueContextType
  currentProjectId: number | null
  pathname?: string
  /**
   * 会话权限码（W5 增补）：矛盾求解的前端**物理阻断**判据（无权限零请求）。
   * 这不是安全边界——真正的门在服务端每个请求上重算（RL-05）。
   */
  permissions?: readonly string[]
  /** 超管哨兵（与 `system:admin` 权限码同义放行）。 */
  isSuperAdmin?: boolean
  /**
   * 来源被动雷达信号 ID（v3-triz-copilot-followups B2 增补）：信号卡跳转求解流时
   * 结构化带入，供矛盾求解意图直接注入 `sourceSignalId` 参数（文本正则解析仅作兜底）。
   */
  sourceSignalId?: number | null
}

/** 缺少项目上下文时抛出（D-context §2：全域视图提问单项目工具）。 */
export class ContextMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextMissingError'
  }
}

/** 项目空间路径正则（对齐 `space-breadcrumbs` 的 PROJECT_SPACE_PATH_RE）。 */
export const PROJECT_SPACE_PATH_RE = /^\/next\/projects\/(\d+)/

/** 未识别意图的诚实回退文案（design D1 §4）。 */
export const COLLEAGUE_FALLBACK_TEXT =
  '未能识别与当前工作空间匹配的可用操作，请从下方快捷入口选择或换一种说法。'

/** 写操作解析不完整引导文案（design D1 §3）。 */
export const COLLEAGUE_SCHEDULE_INCOMPLETE_TEXT =
  '识别到你希望调整任务排程，但缺少目标任务编号或日期。请按格式输入，例如：`延期任务 12 至 2026-09-15`，或点击下方演练快捷按钮。'

/** 缺项目上下文引导文案（spec「非项目空间缺省处理」）。 */
export const COLLEAGUE_CONTEXT_MISSING_TEXT =
  '当前操作需要项目环境，请先进入目标项目空间或在指令中指明项目编号。'

// ---------------------------------------------------------------------------
// 矛盾求解意图（v3-triz-contradiction-copilot W5 · tasks 5.1）
// ---------------------------------------------------------------------------

/** 矛盾求解工具名（后端 AI 工具注册表 / 对话流端点同源语义）。 */
export const ANALYZE_CONTRADICTION_TOOL_NAME = 'analyze_project_contradiction'

/** 命中矛盾求解意图但未给出陈述时的诚实引导（防猜忌：绝不替用户编造矛盾）。 */
export const COLLEAGUE_TRIZ_STATEMENT_REQUIRED_TEXT =
  '识别到矛盾求解意图，但还没描述具体矛盾。请用一句大白话说清「想改善什么、因此什么变差了」，例如：`矛盾求解：客户催进度，但再加人测试就跟不上了`。'

/**
 * 意图命中但输入不完整（如矛盾求解缺陈述）：携带诚实引导文案，
 * 由调用方原样呈现，MUST NOT 猜测默认值后继续执行。
 */
export class IntentIncompleteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntentIncompleteError'
  }
}

/** 显式命令式触发（「矛盾求解：…」），陈述取命令后的正文。 */
const TRIZ_SOLVE_COMMAND =
  /^(?:请|帮我|请帮我|我要|我想)?(?:做|来|用|进行)?(?:矛盾求解|求解矛盾|矛盾分析|破局分析)/

/** 是否为命令式矛盾求解（「矛盾求解：…」）：澄清追问期间的命令式输入按新一次求解处理。 */
export function isTrizSolveCommand(input: string): boolean {
  return TRIZ_SOLVE_COMMAND.test(input)
}

/**
 * 大白话触发词（意图先行：用户不需要认识 TRIZ 术语）。
 * 关键词刻意保持高辨识度，避免与既有导航 / 查询规则的令牌重叠（规则次序见本文件末尾注释）。
 */
const TRIZ_CONTRADICTION_KEYWORDS =
  /矛盾|两难|顾此失彼|左右为难|鱼与熊掌|不可兼得|既要.{0,24}又要|又要.{0,24}又要|互相冲突|相互冲突|各有得失/

/**
 * 图表馆 TRIZ 分馆令牌（矛盾矩阵 / 九屏幕 / 功能分析）：这些诉求属于**看图表**，
 * 不是求解意图，交给图表馆导航规则（W7）判定；只有显式命令式（「矛盾求解：…」）
 * 才优先于导航。
 */
const TRIZ_GALLERY_TOKENS = /(矛盾矩阵|九宫格|九屏幕|功能分析|矛盾图谱)/

/** 从输入提取矛盾陈述（命令式剥离前缀；大白话式整句即为陈述）。 */
export function extractTrizStatement(input: string): string {
  if (TRIZ_SOLVE_COMMAND.test(input)) {
    return input
      .replace(TRIZ_SOLVE_COMMAND, '')
      .replace(/^[\s:：,，、\-—]+/, '')
      .trim()
  }
  return input.trim()
}

/** 快捷入口（空态引导与未识别回退共用；点击后以 `fill` 作为输入发送）。 */
export interface ColleagueQuickEntry {
  id: string
  label: string
  fill: string
}

export const COLLEAGUE_QUICK_ENTRIES: readonly ColleagueQuickEntry[] = [
  { id: 'quick-summary', label: '查看当前项目摘要', fill: '查看当前项目摘要' },
  { id: 'quick-tasks', label: '列出进行中的任务', fill: '列出进行中的任务' },
  { id: 'quick-gantt', label: '前往甘特图镜头', fill: '去甘特图' },
  { id: 'quick-schedule-demo', label: '任务排程延期演练', fill: '延期任务 12 至 2026-09-15' },
  {
    id: 'quick-triz-solve',
    label: '矛盾求解（大白话）',
    fill: '矛盾求解：客户催进度，但再加人测试就跟不上了',
  },
]

export const RECYCLE_BIN_SEARCH_TOOL_NAME = 'recycle_bin_search'

const PROJECT_SCOPED_TOOLS = [
  'get_project_summary',
  'list_project_tasks',
  'list_project_risks',
  'update_task_schedule',
  ANALYZE_CONTRADICTION_TOOL_NAME,
  RECYCLE_BIN_SEARCH_TOOL_NAME,
]

const UNRECOGNIZED: ParsedColleagueIntent = {
  toolName: null,
  parameters: {},
  intentSource: 'rule_preset',
  confidence: 0,
  fallbackPrompt: COLLEAGUE_FALLBACK_TEXT,
}

// ---------------------------------------------------------------------------
// 写操作意图（优先级最高，含解析不完整防猜忌）
// ---------------------------------------------------------------------------

const WRITE_SCHEDULE_KEYWORDS = /(延期|改期|推迟|提前|调整排程)/i
const WRITE_TASK_CONTEXT = /(任务|排程|工期)/i
const TASK_ID_PATTERN = /任务\s*#?\s*(\d+)|(\d+)\s*(?:号)?\s*任务/i
const ISO_DATE_PATTERN = /(\d{4}-\d{2}-\d{2})/

function extractTaskId(input: string): number | null {
  const match = TASK_ID_PATTERN.exec(input)
  const raw = match?.[1] ?? match?.[2]
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

function extractIsoDate(input: string): string | null {
  return ISO_DATE_PATTERN.exec(input)?.[1] ?? null
}

/**
 * 命中矛盾求解意图则返回结构化意图；未命中返回 null 交由其余规则继续。
 *
 * 两条入口（design D1「意图先行」）：
 * - 命令式 `矛盾求解：<大白话>`：陈述取命令后正文，空陈述抛 `IntentIncompleteError`
 *   诚实引导（防猜忌：绝不替用户编造矛盾内容）；
 * - 大白话式（含 矛盾 / 两难 / 既要…又要 等触发词）：整句即为陈述。
 * 项目编号由 `injectContextParameters` 注入，缺项目上下文抛 `ContextMissingError`
 * （与既有项目域工具同口径，由调用方转友好引导）。
 */
function tryResolveTrizSolve(
  input: string,
  context: ColleagueContext,
): ParsedColleagueIntent | null {
  const commandMatched = TRIZ_SOLVE_COMMAND.test(input)
  const keywordMatched = TRIZ_CONTRADICTION_KEYWORDS.test(input)
  if (!commandMatched && !keywordMatched) return null
  // 图表馆分馆令牌（如「查看矛盾矩阵」）不是求解意图，交给导航规则（W7）
  if (!commandMatched && TRIZ_GALLERY_TOKENS.test(input)) return null

  const statement = extractTrizStatement(input)
  if (commandMatched && statement === '') {
    throw new IntentIncompleteError(COLLEAGUE_TRIZ_STATEMENT_REQUIRED_TEXT)
  }
  if (statement.length < 4) {
    throw new IntentIncompleteError(COLLEAGUE_TRIZ_STATEMENT_REQUIRED_TEXT)
  }

  const parameters = injectContextParameters(
    ANALYZE_CONTRADICTION_TOOL_NAME,
    { statement },
    context,
  )
  // 结构化血缘带入（B2）：信号卡跳转求解流时 context 携带 sourceSignalId，
  // 直接注入意图参数；未命中时留给调用方的文本正则兜底解析。
  if (typeof context.sourceSignalId === 'number') {
    parameters.sourceSignalId = context.sourceSignalId
  }

  return {
    toolName: ANALYZE_CONTRADICTION_TOOL_NAME,
    parameters,
    intentSource: 'rule_preset',
    confidence: 1,
    matchedRuleId: 'rule_triz_contradiction',
  }
}

/** 命中写操作意图则返回解析结果；未命中返回 null 交由其余规则继续。 */
function tryResolveWriteSchedule(input: string): ParsedColleagueIntent | null {
  if (!WRITE_SCHEDULE_KEYWORDS.test(input) || !WRITE_TASK_CONTEXT.test(input)) return null

  const taskId = extractTaskId(input)
  const startDate = extractIsoDate(input)
  if (taskId === null || startDate === null) {
    return {
      toolName: null,
      parameters: {},
      intentSource: 'rule_preset',
      confidence: 0,
      matchedRuleId: 'rule_write_schedule',
      fallbackPrompt: COLLEAGUE_SCHEDULE_INCOMPLETE_TEXT,
    }
  }
  return {
    toolName: 'update_task_schedule',
    parameters: { taskId, startDate, operation: 'move' },
    intentSource: 'rule_preset',
    confidence: 1,
    matchedRuleId: 'rule_write_schedule',
  }
}

// ---------------------------------------------------------------------------
// 全域跨实体搜索意图（v3-ui-next-batch3-global-convergence W1 · tasks 1.5）
// ---------------------------------------------------------------------------

export const GLOBAL_SEARCH_ENTITIES_TOOL_NAME = 'search_global_entities'

/** 全域跨实体搜索缺少关键词时的诚实引导文案（RL-07 / spec「诚实引导」）。 */
export const COLLEAGUE_SEARCH_INCOMPLETE_TEXT =
  '识别到全域查找意图，但缺少搜索关键词。请给出具体要查找的实体或内容，例如：`找一下关于登录的设计文档` 或 `搜索任务 支付接口`。'

export interface ExtractedSearchParams {
  keyword: string
  entityTypes?: SearchEntityType[]
}

const SEARCH_VERBS_PREFIX_RE =
  /^(?:请|帮我|请帮我|我要|我想)?(?:全域|全局)?(?:搜索|查找|找一下|找找|帮我找|搜一下|搜搜|搜|查一下|查找一下|检索|查查|查)/i

const SEARCH_INTENT_TRIGGER_RE =
  /(?:全域|全局)?(?:搜索|查找|找一下|找找|帮我找|搜一下|搜搜|搜|查一下|查找一下|检索)/i

export function extractSearchEntitiesParams(input: string): ExtractedSearchParams | null {
  // 回收站专有搜索与自然语言找回话术不在此处被全域搜索抢占（v3-frontend-test-baseline-zero 亲裁 3）
  if (/(?:回收站|找回.*(?:误删|已删|删掉|删除)|(?:误删|已删|删掉|删除).*找回)/i.test(input)) {
    return null
  }
  if (!SEARCH_INTENT_TRIGGER_RE.test(input)) return null

  let cleaned = input.replace(SEARCH_VERBS_PREFIX_RE, '').trim()
  cleaned = cleaned.replace(/^[\s:：,，、\-—]+/, '').trim()

  let entityTypes: SearchEntityType[] | undefined = undefined
  if (/(?:设计文档|技术文档|文档|文件|资料|附件|doc|pdf)/i.test(cleaned)) {
    entityTypes = ['file']
    cleaned = cleaned.replace(/(?:设计文档|技术文档|文档|文件|资料|附件|doc|pdf)/gi, '').trim()
  } else if (/(?:任务|待办|工作项)/i.test(cleaned)) {
    entityTypes = ['task']
    cleaned = cleaned.replace(/(?:任务|待办|工作项)/gi, '').trim()
  } else if (/(?:项目|工程)/i.test(cleaned)) {
    entityTypes = ['project']
    cleaned = cleaned.replace(/(?:项目|工程)/gi, '').trim()
  } else if (/(?:成员|人员|同事|用户|谁)/i.test(cleaned)) {
    entityTypes = ['member' as SearchEntityType]
    cleaned = cleaned.replace(/(?:成员|人员|同事|用户|谁)/gi, '').trim()
  }

  cleaned = cleaned
    .replace(/^(?:关于|有关|查找|搜索)/, '')
    .replace(/(?:相关|的|的信息|的内容)$/, '')
    .replace(/^[\s:：,，、\-—]+/, '')
    .trim()

  return {
    keyword: cleaned,
    entityTypes,
  }
}

export function tryResolveGlobalSearch(input: string): ParsedColleagueIntent | null {
  const params = extractSearchEntitiesParams(input)
  if (!params) return null

  if (!params.keyword) {
    return {
      toolName: null,
      parameters: {},
      intentSource: 'rule_preset',
      confidence: 0,
      matchedRuleId: 'rule_global_search_entities',
      fallbackPrompt: COLLEAGUE_SEARCH_INCOMPLETE_TEXT,
    }
  }

  return {
    toolName: GLOBAL_SEARCH_ENTITIES_TOOL_NAME,
    parameters: {
      keyword: params.keyword,
      ...(params.entityTypes ? { entityTypes: params.entityTypes } : {}),
    },
    intentSource: 'rule_preset',
    confidence: 1,
    matchedRuleId: 'rule_global_search_entities',
  }
}

export async function executeGlobalSearchEntities(params: {
  keyword: string
  entityTypes?: SearchEntityType[]
}) {
  return searchApi.search({
    keyword: params.keyword,
    entityTypes: params.entityTypes,
    perPage: 10,
  })
}

// ---------------------------------------------------------------------------
// 导航与只读查询规则表（design Decision 1「意图分发规则表」）
// ---------------------------------------------------------------------------

interface IntentRule {
  id: string
  toolName: string
  pattern: RegExp
  buildParameters: (input: string, context: ColleagueContext) => Record<string, unknown>
}

function navParameters(lens: string, context: ColleagueContext): Record<string, unknown> {
  // depth 须与后端 navigate_to_space 的 JSON Schema 一致（仅 'workbench'）；
  // 此前发 'normal'，所有跳转指令都被 422 拒绝
  const base = { lens, depth: 'workbench' }
  return context.currentProjectId ? { ...base, projectId: context.currentProjectId } : base
}

/** 图表馆导航参数（v3-ui-next-chart-gallery design §6.3）：lens='charts' + 具体 chart 标识。 */
function navChartParameters(chart: string, context: ColleagueContext): Record<string, unknown> {
  return { ...navParameters('charts', context), chart }
}

/**
 * 项目治理功能域导航参数（v3-ui-next-risk-change-domains design「通道三」）：
 * 风险管理 / 变更请求为项目级操作面，与周期报表规则同口径——必须绑定项目上下文，
 * 缺失时抛 ContextMissingError 由调用方输出诚实引导（spec「全局非项目环境缺省处理」），
 * 绝不拼装缺项目假链接。
 */
function projectScopedNavParameters(
  lens: string,
  context: ColleagueContext,
): Record<string, unknown> {
  if (!context.currentProjectId) {
    throw new ContextMissingError(COLLEAGUE_CONTEXT_MISSING_TEXT)
  }
  return { lens, depth: 'workbench', projectId: context.currentProjectId }
}

/**
 * 周期报表直达参数（v3-ui-next-reports-domain design「通道二」）：
 * 携带 lens='reports' + tab='periodic' + 模板标识直达报表中心周期模式并预填；
 * 周期报表生成入口必须绑定项目上下文，缺失时抛 ContextMissingError 诚实引导。
 */
function periodicReportParameters(
  template: 'weekly-ai-summary' | 'monthly-ai-summary',
  context: ColleagueContext,
): Record<string, unknown> {
  if (!context.currentProjectId) {
    throw new ContextMissingError(COLLEAGUE_CONTEXT_MISSING_TEXT)
  }
  return {
    lens: 'reports',
    depth: 'workbench',
    projectId: context.currentProjectId,
    tab: 'periodic',
    template,
  }
}

const RULES: readonly IntentRule[] = [
  // Google 登录身份治理不是 OAuth/日历集成，先于泛化设置和 AI 连接导航。
  {
    id: 'rule_nav_admin_google_users',
    toolName: 'navigate_to_space',
    pattern:
      /google\s*(登录|登陆|登入|sign[ -]?in|login).*?(账号|账户|用户|帳號|帳戶|用戶|accounts?|users?)|(账号|账户|用户|帳號|帳戶|用戶|accounts?|users?).*?google\s*(登录|登陆|登入|sign[ -]?in|login)/i,
    buildParameters: () => ({ lens: 'admin', target: 'users' }),
  },
  // ---------------------------------------------------------------------------
  // 图表馆直达规则（v3-ui-next-chart-gallery design §6.3 / spec「三通道可达」）：
  // 置于既有查询/导航规则之前，确保「打开风险矩阵」等具体图表诉求不被
  // list_project_risks（风险/隐患）或 WBS（分解结构）等旧规则误吞；
  // 具体图表规则先于泛化 rule_nav_charts 判定，命中即携带 chart 参数直达深层路由。
  // ---------------------------------------------------------------------------
  {
    id: 'rule_nav_chart_resource_load',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开)?.*(资源负荷|资源直方图|人员负荷)/i,
    buildParameters: (_input, context) => navChartParameters('resource-load', context),
  },
  {
    id: 'rule_nav_chart_risk_register',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开)?.*(风险登记|风险矩阵|5x5)/i,
    buildParameters: (_input, context) => navChartParameters('risk-register', context),
  },
  {
    id: 'rule_nav_chart_aon',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开)?.*(aon|紧前节点|单代号|网络图)/i,
    buildParameters: (_input, context) => navChartParameters('aon-network', context),
  },
  {
    id: 'rule_nav_chart_milestone',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开)?.*(里程碑|里程碑图)/i,
    buildParameters: (_input, context) => navChartParameters('milestone-timeline', context),
  },
  {
    id: 'rule_nav_chart_fishbone',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开)?.*(鱼骨图|因果图|石川图)/i,
    buildParameters: (_input, context) => navChartParameters('fishbone', context),
  },
  {
    id: 'rule_nav_chart_rbs',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开)?.*(rbs|资源分解结构)/i,
    buildParameters: (_input, context) => navChartParameters('rbs', context),
  },
  {
    id: 'rule_nav_chart_scatter',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开)?.*(散布图|散点图|工时偏差|成本偏差)/i,
    buildParameters: (_input, context) => navChartParameters('scatter-plot', context),
  },
  {
    id: 'rule_nav_org_reports_wing',
    toolName: 'navigate_to_space',
    pattern: /(去|跳转|打开|查看)?.*(组织报表分馆|组织级报表|组织报表|报表分馆)/i,
    buildParameters: (_input, context) => ({
      ...navParameters('charts', context),
      tab: 'reports-wing',
    }),
  },
  {
    id: 'rule_nav_charts',
    toolName: 'navigate_to_space',
    pattern: /(去|跳转|打开|查看)?.*图表(馆)?/i,
    buildParameters: (_input, context) => navParameters('charts', context),
  },
  // ---------------------------------------------------------------------------
  // 报表中心直达规则（v3-ui-next-reports-domain design「通道二」）：
  // - rule_nav_periodic_weekly / rule_nav_periodic_monthly：周报/月报意图直达
  //   lens='reports' 的周期报表模式并预填模板（tab/template 参数由前端解析层
  //   携带，后端 navigate_to_space 对 reports 镜头拼装深链查询串）；
  // - 周期报表是写侧生成流程的入口，必须绑定项目：全局视图（无 currentProjectId）
  //   唤起时抛 ContextMissingError，由调用方输出诚实引导（spec「上下文缺失引导」），
  //   绝不拼装缺项目假链接；
  // - rule_nav_reports：泛化「查看报表 / 去报表中心」直达报表中心主页，与既有
  //   导航规则一致不抛错（全局下不注入 projectId）；
  // - 三者均先于 rule_query_summary 判定，避免「每月总结」被「总结」摘要规则误吞。
  // ---------------------------------------------------------------------------
  {
    id: 'rule_nav_periodic_weekly',
    toolName: 'navigate_to_space',
    pattern: /(帮我|我要|生成|出)?.*(周报|每周总结)/i,
    buildParameters: (_input, context) => periodicReportParameters('weekly-ai-summary', context),
  },
  {
    id: 'rule_nav_periodic_monthly',
    toolName: 'navigate_to_space',
    pattern: /(帮我|我要|生成|出)?.*(月报|每月总结)/i,
    buildParameters: (_input, context) => periodicReportParameters('monthly-ai-summary', context),
  },
  {
    id: 'rule_nav_pmo_reports',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|前往)?.*?(PMO\s*报表|组合报表|PMO\s*组合报表)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-reports' }),
  },
  {
    id: 'rule_nav_reports',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看)?.*报表(中心)?/i,
    buildParameters: (_input, context) => navParameters('reports', context),
  },
  {
    id: 'rule_nav_gantt',
    toolName: 'navigate_to_space',
    pattern: /(去|跳转|打开|查看)?.*甘特图/i,
    buildParameters: (_input, context) => navParameters('gantt', context),
  },
  {
    id: 'rule_nav_kanban',
    toolName: 'navigate_to_space',
    pattern: /(去|跳转|打开|查看)?.*看板/i,
    buildParameters: (_input, context) => navParameters('kanban', context),
  },
  {
    id: 'rule_nav_wbs',
    toolName: 'navigate_to_space',
    pattern: /(去|跳转|打开|查看)?.*(wbs|分解结构)/i,
    buildParameters: (_input, context) => navParameters('wbs', context),
  },
  // ---------------------------------------------------------------------------
  // 组织组合层 / 全局视窗全域导航规则（v3-ui-next-org-portfolio-domains W10 · tasks
  // 10.3）：组织概览/BI/OKR/资源分析/容量环/跨项目调配/插件治理与全局资源/技能
  // 矩阵/风险入口（/next/organization/**、/next/resources/**、/next/risks）——
  // 组织 ID 由 JWT 租户上下文决定，URL 不含 organizationId；
  // - 全部走「全域导航」分支：buildParameters 仅携带 lens（org_*），不注入
  //   projectId、不抛 ContextMissingError（与 rule_nav_home/help/knowledge 同口径，
  //   跨 project_space / role_home / theater_create 任何情境均正常分发）；
  // - 置于项目级治理规则（rule_nav_project_risks…rule_nav_files）之前：以
  //   「组织资源池/组织 OKR/技能矩阵/插件目录/容量环」等精确复合词抢占，避免
  //   歧义句被项目级泛化 资源/风险 规则误吞；「查看项目资源」等既有句不含组织
  //   令牌、维持原归属不变；
  // - 规则内序：OKR 仪表盘先于 OKR 层级（「组织 OKR 仪表盘」归仪表盘）、组织资源池
  //   先于全局资源、跨项目调配与插件目录/策略等复合词互相错峰。
  // ---------------------------------------------------------------------------
  {
    id: 'rule_nav_org_overview',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|返回)?.*(组织概览|组织总览|组织首页)/i,
    buildParameters: () => ({ lens: 'org_overview' }),
  },
  {
    id: 'rule_nav_org_bi_dashboards',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(组织\s*BI|BI\s*仪表盘|组织仪表盘)/i,
    buildParameters: () => ({ lens: 'org_bi_dashboards' }),
  },
  {
    id: 'rule_nav_org_bi_risk_heatmap',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(风险热力|热力图|组织风险热度)/i,
    buildParameters: () => ({ lens: 'org_bi_risk_heatmap' }),
  },
  {
    id: 'rule_nav_org_bi_trends',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(趋势分析|组织趋势|BI\s*趋势)/i,
    buildParameters: () => ({ lens: 'org_bi_trends' }),
  },
  {
    id: 'rule_nav_org_okr_dashboard',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*OKR\s*(仪表盘|达成概览|达成摘要)/i,
    buildParameters: () => ({ lens: 'org_okr_dashboard' }),
  },
  {
    id: 'rule_nav_org_okrs',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(组织\s*OKR|OKR\s*(层级|管理|目标树|进度|周期))/i,
    buildParameters: () => ({ lens: 'org_okrs' }),
  },
  {
    id: 'rule_nav_org_resource_pool',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(组织资源池|资源池|组织池)/i,
    buildParameters: () => ({ lens: 'org_resource_pool' }),
  },
  {
    id: 'rule_nav_org_resource_gaps',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(资源缺口|缺口分析)/i,
    buildParameters: () => ({ lens: 'org_resource_gaps' }),
  },
  {
    id: 'rule_nav_org_resource_contentions',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(资源争用|争用检测|争用分析)/i,
    buildParameters: () => ({ lens: 'org_resource_contentions' }),
  },
  {
    id: 'rule_nav_org_resource_demand',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(资源需求预测|需求预测|需求曲线)/i,
    buildParameters: () => ({ lens: 'org_resource_demand' }),
  },
  {
    id: 'rule_nav_org_capacity_loops',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(容量环|容量闭环|闭环计划)/i,
    buildParameters: () => ({ lens: 'org_capacity_loops' }),
  },
  {
    id: 'rule_nav_org_cross_project_allocation',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(跨项目调配|跨项目资源调配|调配草案)/i,
    buildParameters: () => ({ lens: 'org_cross_project_allocation' }),
  },
  {
    id: 'rule_nav_org_plugin_directory',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(插件目录|插件分发底册)/i,
    buildParameters: () => ({ lens: 'org_plugin_directory' }),
  },
  {
    id: 'rule_nav_org_plugin_policies',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(插件策略|策略包管理)/i,
    buildParameters: () => ({ lens: 'org_plugin_policies' }),
  },
  {
    id: 'rule_nav_global_resources',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(全局资源|资源入口|资源速览)/i,
    buildParameters: () => ({ lens: 'global_resources' }),
  },
  {
    id: 'rule_nav_global_skill_matrix',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(技能矩阵|技能覆盖|技能底册)/i,
    buildParameters: () => ({ lens: 'global_skill_matrix' }),
  },
  {
    id: 'rule_nav_global_risks',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(问题与风险|全局风险|风险入口)/i,
    buildParameters: () => ({ lens: 'global_risks' }),
  },
  // ---------------------------------------------------------------------------
  // 项目治理功能域导航规则（v3-ui-next-risk-change-domains W3 · tasks 3.7）：
  // - rule_nav_project_risks：风险管理操作面（/next/projects/:id/risks）直达，
  //   在 tasks 正则基础上追加「前缀动词必现 + 排除列表式查询词（列表/清单/排查）」
  //   守卫——若照录全可选模式并置于规则表前部，会把既有 rule_query_risks 的
  //   聊天列表语义（「查看风险列表 / 排查项目风险 / 项目隐患」等）静默改写为导航，
  //   破坏确定性分发（RL-07）；守卫后既存列表查询行为不变；
  // - rule_nav_project_change_requests：变更域操作面
  //   （/next/projects/:id/change-requests）直达（无既有规则冲突，保留全可选模式）；
  // - 两域均经 projectScopedNavParameters 注入当前 projectId；全局视图（无项目
  //   上下文）唤起抛 ContextMissingError 诚实引导；
  // - 置于 rule_nav_home 之前：避免「…风险工作台」中的「工作台」被 home 规则
  //   （overview）误吞；图表馆具体图表规则仍在更前位，风险矩阵/风险登记等专属
  //   图表诉求不被本规则抢占。
  // ---------------------------------------------------------------------------
  {
    id: 'rule_nav_project_risks',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)(?!.*(列表|清单|排查)).*?(项目)?(风险|隐患)(管理|工作台|列表)?/i,
    buildParameters: (_input, context) => projectScopedNavParameters('risks', context),
  },
  {
    id: 'rule_nav_pmo_change_queue',
    toolName: 'navigate_to_space',
    pattern:
      /(去|打开|查看|进入|前往)?.*?(全局变更审批|全局变更|变更审批队列|pmo\s*变更|变更队列)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-change-queue' }),
  },
  {
    id: 'rule_nav_project_change_requests',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|新建|申请)?.*(项目)?(变更|变更请求|cr|审批流)/i,
    buildParameters: (_input, context) => projectScopedNavParameters('change_requests', context),
  },
  // ---------------------------------------------------------------------------
  // 协同管理功能域导航规则（v3-ui-next-resource-team-domains W4 · tasks 4.5）：
  // - rule_nav_resources / rule_nav_members / rule_nav_files：资源工作台 / 成员团队 /
  //   项目文件库（/next/projects/:id/resources|members|files）操作面直达，
  //   正则照 spec「AI 同事三通道导航闭环」记录（spec.md §rule_nav_*）；
  // - 优先级核对（勿吞既有规则语义）：三规则置于全部图表馆具体图表规则之后——
  //   「资源负荷/资源直方图/人员负荷」由 rule_nav_chart_resource_load 先行抢占，
  //   「资源分解结构」由 rule_nav_chart_rbs 先行抢占；又置于风险/变更治理规则之后，
  //   含 风险/隐患/变更 令牌的诉求归属不变；「资源工作台」等以 工作台 收尾的短语
  //   在 rule_nav_home 之前判定，避免被 home 规则（overview）误吞；
  // - 三域均为项目级操作面：经 projectScopedNavParameters 注入当前 projectId；
  //   全局视图（无项目上下文）唤起抛 ContextMissingError 诚实引导，绝不拼装假链接。
  // ---------------------------------------------------------------------------
  {
    id: 'rule_nav_resources',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开|前往|管理)?.*(资源|人员分配|工时负荷|资源库|资源工作台)/i,
    buildParameters: (_input, context) => projectScopedNavParameters('resources', context),
  },
  {
    id: 'rule_nav_members',
    toolName: 'navigate_to_space',
    pattern:
      /^(?!.*组织).*(看|查|打开|前往|管理)?.*(项目成员|团队成员|人员列表|成员管理|邀请成员)/i,
    buildParameters: (_input, context) => projectScopedNavParameters('members', context),
  },
  {
    id: 'rule_nav_files',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开|前往|管理)?.*(项目文件|项目附件|文档资料|文件库|文件列表)/i,
    buildParameters: (_input, context) => projectScopedNavParameters('files', context),
  },
  // ---------------------------------------------------------------------------
  // 帮助中心 / 知识底座全域导航规则（v3-ui-next-help-knowledge-domain W3 · tasks 3.3）：
  // - rule_nav_help / rule_nav_knowledge：帮助中心（/next/help）与四层知识底座
  //   （/next/knowledge）为全局级/组织级独立视窗（design Decision 1 通道二），
  //   登录全员可达——参数仅携带 lens，不注入 projectId、不抛 ContextMissingError
  //   （与既有 rule_nav_home 全域规则同口径，跨 project_space / role_home /
  //   theater_create 任何情境均正常分发）；
  // - 优先级置于 rule_nav_home 之前：避免「…帮助中心…」「…知识底座…」中被
  //   home 规则的 首页/工作台 令牌（如「知识库首页」）误吞；
  // - 关键词冲突核对：帮助令牌（帮助/使用手册/操作指南/常见问题）与知识令牌
  //   （知识库/知识底座/四层知识/业务规范）与更前位规则关键词零交集——文件域
  //   「文档资料/文件库」、风险/变更治理域、图表馆专属规则均不受影响；
  //   更前位既有规则已命中的诉求（如「查看项目文件库帮助」先落 rule_nav_files）
  //   维持确定性先到先得，不引入负向前瞻。
  // ---------------------------------------------------------------------------
  {
    id: 'rule_nav_help',
    toolName: 'navigate_to_space',
    pattern: /(打开|查看|进入|去|怎么用)?.*(帮助|帮助中心|使用手册|操作指南|常见问题)/i,
    buildParameters: () => ({ lens: 'help' }),
  },
  {
    id: 'rule_nav_knowledge',
    toolName: 'navigate_to_space',
    pattern: /(打开|查看|进入|去)?.*(知识库|知识底座|四层知识|业务规范)/i,
    buildParameters: () => ({ lens: 'knowledge' }),
  },
  // ---------------------------------------------------------------------------
  // PMO 组合层全域导航规则（v3-ui-next-pmo-domain W9 · tasks 9.3）：
  // - rule_nav_pmo_overview…rule_nav_pmo_ai_priority：组合仪表盘与 7 个 PMO 功能页
  //   （/next/pmo 与 /next/pmo/{traffic-light,grouping-views,priority-scoring,
  //   ai-priority-recommendations,decisions,dependencies,impact-analysis}）直达；
  //   与 org 全域规则同口径：参数仅携带 lens='pmo' + target（无 depth/projectId——
  //   后端 schema depth 枚举仅接受 workbench，org 规则先例即不携带），
  //   不注入 projectId、不抛 ContextMissingError（PMO 属组织层全域视角，项目空间内
  //   发起同样跳转组织层坐标，镜像旧顶栏入口行为）；
  // - 规则内序：具体功能页在前、泛化 rule_nav_pmo_overview（裸 pmo 令牌）收尾，
  //   避免「去 PMO 决策工作台」等复合句被总览规则抢占；
  // - 整块置于 rule_nav_home 之前：避免「…决策工作台」等以 工作台 收尾的短语被
  //   home 规则（首页|工作台 宽口径）误吞；「优先级推荐/红绿灯」等 PMO 专属词不与
  //   图表馆/BI/项目级规则重叠（优先级推荐≠资源负荷、影响分析≠变更审批流——
  //   「变更…影响分析」仍由更前位的 rule_nav_project_change_requests 承接）；
  // - 命中卡由 UI 统一标注「⚡ 快捷规则匹配 · navigate_to_space」（RL-07）。
  // ---------------------------------------------------------------------------
  {
    id: 'rule_nav_pmo_traffic_light',
    toolName: 'navigate_to_space',
    pattern: /(看|查|打开|去|前往)?.*(红绿灯|交通灯|红黄绿)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-traffic-light' }),
  },
  {
    id: 'rule_nav_pmo_grouping',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(分组视图|组合分组|分组预览)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-grouping-views' }),
  },
  {
    id: 'rule_nav_pmo_priority',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(优先级评分|优先级打分|评分表)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-priority-scoring' }),
  },
  {
    id: 'rule_nav_pmo_ai_priority',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(优先级推荐|AI\s*推荐|智能推荐|推荐队列)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-ai-priority-recommendations' }),
  },
  {
    id: 'rule_nav_pmo_decisions',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(决策工作台|决策队列|决策议题|pmo\s*决策)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-decisions' }),
  },
  {
    id: 'rule_nav_pmo_dependencies',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(跨项目依赖|组合依赖|依赖图谱|依赖关系)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-dependencies' }),
  },
  {
    id: 'rule_nav_pmo_impact',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*(影响分析|impact)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-impact-analysis' }),
  },
  {
    id: 'rule_nav_pmo_overview',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|返回)?.*(组合总览|组合仪表盘|组合看板|pmo)/i,
    buildParameters: () => ({ lens: 'pmo', target: 'pmo-overview' }),
  },
  // ---------------------------------------------------------------------------
  // 项目设置 / 全域设置 / 管理后台导航规则（v3-ui-next-settings-admin-domains W9 · tasks 9.5 / 9.6）：
  // - rule_nav_project_settings：项目级治理配置（/next/projects/:id/settings），
  //   经 projectScopedNavParameters 注入当前 projectId；必须置于全局设置规则之前，
  //   避免「项目设置」被「设置」泛化规则误吞；全局视图缺上下文抛 ContextMissingError；
  // - settings 系列规则：profile、two-factor、sso、kms、dlp、compliance、ai、
  //   integrations、organization、audit-logs 与泛化 rule_nav_settings。全域导航不注入
  //   projectId、不抛 ContextMissingError；
  // - admin 系列规则：admin 门户、users、audit-logs、multitenancy、ai-quality-cost、
  //   compiler-routing、release-trust。全域导航直达管理后台；
  // - 规则次序守卫：
  //   1. rule_nav_project_settings 置于 rule_nav_settings 之前；
  //   2. 歧义词分派：平台/全局/系统审计 → rule_nav_admin_audit；无前缀默认组织审计 → rule_nav_settings_audit；
  //   3. 「组织成员管理/组织设置」与 B7 组织概览通过次序 + 负向守卫隔离；
  //   4. settings/admin 系列规则全部置于 rule_nav_home 之前，避免「工作台」收尾词误吞。
  // ---------------------------------------------------------------------------
  {
    id: 'rule_nav_project_settings',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|修改|配置|编辑)?.*?(项目设置|项目日历|工作日历|节假日|调休)/i,
    buildParameters: (_input, context) => projectScopedNavParameters('project_settings', context),
  },
  {
    id: 'rule_nav_settings_profile',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*?(个人资料|我的账号|账户信息)/i,
    buildParameters: () => ({ lens: 'settings', target: 'profile' }),
  },
  {
    id: 'rule_nav_settings_two_factor',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|配置)?.*?(两步验证|2fa|动态口令|恢复码)/i,
    buildParameters: () => ({ lens: 'settings', target: 'security/two-factor' }),
  },
  {
    id: 'rule_nav_settings_sso',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|配置)?.*?(单点登录|saml|oidc|scim|企业登录)/i,
    buildParameters: () => ({ lens: 'settings', target: 'security/sso' }),
  },
  {
    id: 'rule_nav_settings_kms',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|配置)?.*?(密钥管理|kms\s*密钥|密钥轮换|kms)/i,
    buildParameters: () => ({ lens: 'settings', target: 'security/kms' }),
  },
  {
    id: 'rule_nav_settings_dlp',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|配置)?.*?(防泄漏|dlp|数据外发防护)/i,
    buildParameters: () => ({ lens: 'settings', target: 'security/dlp' }),
  },
  {
    id: 'rule_nav_settings_compliance',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|配置)?.*?(合规准备度|合规|等保)/i,
    buildParameters: () => ({ lens: 'settings', target: 'security/compliance' }),
  },
  {
    id: 'rule_nav_settings_ai',
    toolName: 'navigate_to_space',
    pattern:
      /(去|打开|查看|进入|配置)?.*?(ai\s*用量|用量与额度|编译器技能|技能注册|ai\s*连接|模型连接|api\s*key)/i,
    buildParameters: (input) => {
      let target = 'ai-connections'
      if (/用量/i.test(input)) {
        target = 'ai-usage'
      } else if (/(编译器技能|技能注册)/i.test(input)) {
        target = 'compiler-skills'
      }
      return { lens: 'settings', target }
    },
  },
  {
    id: 'rule_nav_settings_integrations',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|配置)?.*?(第三方集成|oauth\s*连接|日历集成)/i,
    buildParameters: () => ({ lens: 'settings', target: 'integrations' }),
  },
  {
    id: 'rule_nav_settings_organization',
    toolName: 'navigate_to_space',
    pattern:
      /(去|打开|查看|进入|管理)?(?!.*(组织概览|组织总览|组织首页|组织看板|组织仪表盘|组织资源池)).*?(组织设置|组织资料|组织成员)/i,
    buildParameters: () => ({ lens: 'settings', target: 'organization' }),
  },
  {
    id: 'rule_nav_admin_audit',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*?(平台|全局|系统).*?审计/i,
    buildParameters: () => ({ lens: 'admin', target: 'audit-logs' }),
  },
  {
    id: 'rule_nav_settings_audit',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?(?!.*(平台|全局|系统)).*?审计/i,
    buildParameters: () => ({ lens: 'settings', target: 'audit-logs' }),
  },
  {
    id: 'rule_nav_settings',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|返回)?.*?(设置中心|偏好设置|设置)/i,
    buildParameters: () => ({ lens: 'settings' }),
  },
  {
    id: 'rule_nav_admin_users',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|管理)?.*?(用户管理|账号管理|启用账号|禁用账号)/i,
    buildParameters: () => ({ lens: 'admin', target: 'users' }),
  },
  {
    id: 'rule_nav_admin_tenancy',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*?(全局多租户|租户控制台|平台租户)/i,
    buildParameters: () => ({ lens: 'admin', target: 'multitenancy' }),
  },
  {
    id: 'rule_nav_admin_quality_cost',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*?(ai\s*质量|成本控制台|token\s*成本|质量成本)/i,
    buildParameters: () => ({ lens: 'admin', target: 'ai-quality-cost' }),
  },
  {
    id: 'rule_nav_admin_routing',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|配置)?.*?(编译器路由|routing\s*规则|ai\s*路由)/i,
    buildParameters: () => ({ lens: 'admin', target: 'compiler-routing' }),
  },
  {
    id: 'rule_nav_admin_release_trust',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*?(发布信任|信任中心|凭证验证)/i,
    buildParameters: () => ({ lens: 'admin', target: 'release-trust' }),
  },
  {
    id: 'rule_nav_admin',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入|返回)?.*?(管理后台|治理控制台|平台管理)/i,
    buildParameters: () => ({ lens: 'admin' }),
  },
  // 战略执行驾驶舱全域导航规则（v3-ui-next-batch1-strategy-launch-tasks W5 · tasks 5.1）
  {
    id: 'rule_nav_strategy_cockpit',
    toolName: 'navigate_to_space',
    pattern:
      /(去|打开|查看|进入|返回|前往)?.*?(战略执行驾驶舱|战略驾驶舱|战略执行|战略对齐|驾驶舱|战略)/i,
    buildParameters: () => ({ lens: 'strategy_cockpit' }),
  },
  // 全域任务、全域主轴、通知中心与全域搜索导航规则（v3-ui-next-batch3-global-convergence W5 · tasks 5.3）
  {
    id: 'rule_nav_cross_project_tasks',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*?(跨项目任务|全域任务|任务\s*hud|全部任务)/i,
    buildParameters: () => ({ lens: 'tasks' }),
  },
  {
    id: 'rule_nav_global_timeline',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*?(全域主轴|全域时间主轴|时间主轴|全域日历)/i,
    buildParameters: () => ({ lens: 'calendar' }),
  },
  {
    id: 'rule_nav_notifications',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|查看|进入)?.*?(通知中心|我的通知|全部通知)/i,
    buildParameters: () => ({ lens: 'notifications' }),
  },
  {
    id: 'rule_nav_global_search',
    toolName: 'navigate_to_space',
    pattern: /(去|打开|进入)?.*?(全域搜索|全局搜索)/i,
    buildParameters: () => ({ lens: 'search' }),
  },
  {
    id: 'rule_nav_home',
    toolName: 'navigate_to_space',
    pattern: /(返回|回到|去)?.*(角色)?(首页|工作台)/i,
    buildParameters: () => ({ lens: 'overview' }),
  },
  {
    id: 'rule_query_summary',
    toolName: 'get_project_summary',
    pattern: /(项目)?(概况|摘要|进度|总结|基本信息|大盘)/i,
    buildParameters: () => ({}),
  },
  // 回收站自然语言找回规则（v3-ui-next-batch1-strategy-launch-tasks W4 · tasks 4.7）
  {
    id: 'rule_recycle_bin_search',
    toolName: RECYCLE_BIN_SEARCH_TOOL_NAME,
    pattern:
      /(?:找回|恢复|还原|搜索|查|查询).*?(?:误删|已删|删掉|删除|回收站)|(?:误删|已删|删掉|删除|回收站).*?(?:找回|恢复|还原|任务)|帮我找回.*任务/i,
    buildParameters: (input) => {
      const taskId = extractTaskId(input)
      let cleaned = input
        .replace(/^(?:请|帮我|请帮我|我要|我想)?(?:从回收站|在回收站)?(?:中|里)?/i, '')
        .replace(/(?:找回|恢复|还原|搜索|查一下|查询|帮我查|看看)/g, '')
        .replace(/(?:上周|昨天|前天|刚才|刚刚|最近)?(?:误删|已删|删掉|删除)的?/g, '')
        .replace(/(?:任务|事项|工作项)/g, '')
        .replace(/[#号]/g, '')
        .trim()

      if (taskId !== null && cleaned === String(taskId)) {
        cleaned = ''
      }

      return {
        search: cleaned || undefined,
        taskId: taskId ?? undefined,
      }
    },
  },
  {
    id: 'rule_query_tasks',
    toolName: 'list_project_tasks',
    pattern: /(查看|列出|当前)?.*(任务|待办|工作项)(列表|清单)?/i,
    buildParameters: (input) => {
      const status = extractTaskStatus(input)
      return status ? { status } : {}
    },
  },
  {
    id: 'rule_query_risks',
    toolName: 'list_project_risks',
    pattern: /(查看|列出|排查)?.*(项目)?(风险|隐患)(列表|清单)?/i,
    buildParameters: () => ({}),
  },
]

const TASK_STATUS_KEYWORDS: ReadonlyArray<{ status: TaskStatus; keywords: readonly string[] }> = [
  { status: 'not_started', keywords: ['未开始', '待开始'] },
  { status: 'in_progress', keywords: ['进行中', '正在做', '实施中', '在办'] },
  { status: 'completed', keywords: ['已完成'] },
  { status: 'blocked', keywords: ['受阻', '阻塞', '卡住', '被阻断'] },
  { status: 'on_hold', keywords: ['暂停', '挂起', '搁置', '暂缓'] },
  { status: 'cancelled', keywords: ['已取消', '取消'] },
]

/** 从输入提取任务状态过滤词（spec 场景：受阻任务 → status: 'blocked'）。 */
export function extractTaskStatus(input: string): TaskStatus | null {
  for (const entry of TASK_STATUS_KEYWORDS) {
    if (entry.keywords.some((keyword) => input.includes(keyword))) return entry.status
  }
  return null
}

// ---------------------------------------------------------------------------
// 上下文参数注入（design Decision 4 §2）
// ---------------------------------------------------------------------------

export function injectContextParameters(
  toolName: string,
  rawParams: Record<string, unknown>,
  context: ColleagueContext,
): Record<string, unknown> {
  if (PROJECT_SCOPED_TOOLS.includes(toolName) && rawParams.projectId === undefined) {
    if (context.currentProjectId) {
      return { ...rawParams, projectId: context.currentProjectId }
    }
    throw new ContextMissingError(COLLEAGUE_CONTEXT_MISSING_TEXT)
  }
  return rawParams
}

// ---------------------------------------------------------------------------
// 主编排入口
// ---------------------------------------------------------------------------

const KNOWLEDGE_QUESTION_RE =
  /(什么是|是什么|什么意思|啥是|解释|为什么|为何|有什么区别|有何区别|区别是|的区别|介绍一下|原理|怎么理解|如何理解|举个?例|讲讲|定义|含义)/
const EXPLICIT_COMMAND_RE =
  /^(请|帮我|麻烦)?\s*(去|打开|跳转|跳到|前往|进入|切换到|返回|带我去|查看|列出|显示)/

const COMPLEX_QUESTION_RE = /[？?]|哪些|怎样|怎么样|如何|为什么|分析|对比|建议|评估|原因|影响/

/**
 * 具体的复杂提问（「灰度切流和双轨并行相关的任务进度怎样？哪些有风险？」）交给模型：
 * 模型能拿到项目事实与网页资料，比「进度」「风险」等泛化快捷规则给的通用卡片更切题。
 * 短问题（「当前项目有哪些风险？」）与明确指令仍走快捷规则。
 */
export function isComplexQuestion(input: string): boolean {
  const text = input.trim()
  return text.length >= 14 && COMPLEX_QUESTION_RE.test(text) && !EXPLICIT_COMMAND_RE.test(text)
}

/** 知识性提问：含解释/定义/区别类措辞，且不是以「去、打开、查看…」开头的明确指令。 */
export function isKnowledgeQuestion(input: string): boolean {
  return KNOWLEDGE_QUESTION_RE.test(input) && !EXPLICIT_COMMAND_RE.test(input.trim())
}

/**
 * 解析用户输入为结构化工具意图。任何输入都返回确定性结果：
 * 规则命中 → `confidence: 1` + `matchedRuleId`；未识别/解析不完整 →
 * `toolName: null` + `confidence: 0` + `fallbackPrompt`，绝不抛出（唯一例外：
 * 项目域工具缺上下文时抛 `ContextMissingError`，由调用方转为友好引导消息）。
 */
export function parseColleagueIntent(
  rawInput: string,
  context: ColleagueContext,
): ParsedColleagueIntent {
  const input = rawInput.trim()
  if (input === '') return UNRECOGNIZED

  // 矛盾求解优先判定（v3-triz-contradiction-copilot W5）：触发词（矛盾/两难/既要…又要）
  // 与既有导航、查询、写排程规则零重叠；命令式 `矛盾求解：…` 亦只在此命中。
  // 置于全部规则之前，避免「客户催进度…」被 rule_query_summary 的「进度」令牌误吞。
  const triz = tryResolveTrizSolve(input, context)
  if (triz) return triz

  const write = tryResolveWriteSchedule(input)
  if (write) {
    if (write.toolName) {
      write.parameters = injectContextParameters(write.toolName, write.parameters, context)
    }
    return write
  }

  // 全域跨实体搜索意图（v3-ui-next-batch3-global-convergence W1 · tasks 1.5）
  const search = tryResolveGlobalSearch(input)
  if (search) return search

  // 晨报式主动简报卡意图（v3-ui-next-batch3-global-convergence W2 · tasks 2.7 / W5）
  const briefing = resolveMorningBriefingIntent(input)
  if (briefing) return briefing

  // 知识性提问（「什么是 WBS」「甘特图和看板有什么区别」）交给模型回答：导航/查询规则的动词是可选的，
  // 只要提到「看板、WBS、报表」就会命中，此前这类问题会被误当成跳转指令执行。
  if (isKnowledgeQuestion(input) || isComplexQuestion(input)) return UNRECOGNIZED

  for (const rule of RULES) {
    if (!rule.pattern.test(input)) continue
    const rawParams = rule.buildParameters(input, context)
    const parameters = injectContextParameters(rule.toolName, rawParams, context)
    return {
      toolName: rule.toolName,
      parameters,
      intentSource: 'rule_preset',
      confidence: 1,
      matchedRuleId: rule.id,
    }
  }

  return UNRECOGNIZED
}

/**
 * 从 pathname + 上下文实体 Store 派生情境（D-context §1）：
 * 项目空间 → `project_space`；角色首页 → `role_home`；生成剧场 → `theater_create`；
 * parse 出项目 ID 优先，其次回退实体 Store 上报的 projectId。
 */
export function deriveColleagueContext(
  pathname: string,
  entityProjectId?: number | null,
): ColleagueContext {
  const match = PROJECT_SPACE_PATH_RE.exec(pathname)
  if (match?.[1] !== undefined) {
    return { contextType: 'project_space', currentProjectId: Number(match[1]), pathname }
  }
  if (pathname === '/next' || pathname === '/next/') {
    return { contextType: 'role_home', currentProjectId: null, pathname }
  }
  if (pathname === '/next/create') {
    return { contextType: 'theater_create', currentProjectId: null, pathname }
  }
  if (entityProjectId != null) {
    return { contextType: 'project_space', currentProjectId: entityProjectId, pathname }
  }
  return { contextType: 'unknown', currentProjectId: null, pathname }
}

// ---------------------------------------------------------------------------
// 自然语言操作（模型理解）：一句话 → 操作序列（勾选完成 / 移到进行中 / 改日期 / 打开页面…）
// ---------------------------------------------------------------------------

/** 修改类动词：出现即值得请模型理解成操作。 */
const NL_MUTATION_VERBS =
  /(新建|新增|添加|增加|创建|加(?:一)?(?:个|条|项)(?:子)?任务|子任务|步骤|完成|做完|搞定|勾选|勾掉|打勾|打钩|勾上|标记|标成|标为|设为|设成|改成|改为|改到|换成|移到|移动到|挪到|拖到|放到|放进|丢到|开始做|开工|重新打开|重开|退回|卡住了|受阻|暂停|取消掉|延期|推迟|延后|延到|推到|顺延|指派|分派|分配给|交给|转给|派给|负责人|取消指派|往后|提前|往前|截止|改期|排到|第[一二三四五六七八九十两\d]+(?:个|条|项))/
/** 查看 / 跳转类动词。 */
const NL_VIEW_VERBS =
  /(打开|切换到|切到|跳到|跳转|带我|前往|进入|去看|去到|看一下|看看|查看|列出|显示|找一下|找到|过去|回到|我要去|我想去)/
/** 界面偏好词（浅色/深色、密度、简繁体）。 */
const NL_PREFERENCE_WORDS =
  /(深色|浅色|暗色|亮色|黑色主题|白色主题|夜间模式|日间模式|跟随系统|紧凑|舒适|繁体|繁體|简体|簡體)/
/** 多步连接词：一句话里要做几件事。 */
const NL_CHAIN_CONNECTORS = /(然后|接着|再把|再去|再打开|之后|并且|顺便|同时|，再|,再|；|;)/
/** 明显是提问（交给问答，不做操作理解）。 */
const NL_QUESTION_MARKERS =
  /(吗|么|多少|几个|几项|哪些|哪个|哪里|哪儿|什么|怎么|为什么|为何|是否|有没有|能不能|可不可以|如何)|[?？]\s*$/
/** 指向某个具体东西（「登录那个风险」「叫支付的任务」）：快捷规则只会打开总览页，交给模型搜索直达。 */
const NL_SPECIFIC_REFERENCE = /(那个|这个|那条|这条|那份|叫做?|名为|名叫|关于|相关|有关)/
/** 「我的工作」类说法（即使是问句也要拿到跨项目清单）：今天还有什么没做完 / 先做哪个 / 帮我排优先级。 */
const NL_MY_WORK =
  /(我(?:今天|今日|明天|这周|本周|这星期)?(?:还)?有?(?:哪些|什么|几项|几个|多少)?.{0,4}(?:工作|任务|待办|事情?)(?:没|还没|未)?(?:做完|完成|处理)?|待办|先做哪|做不完|排优先级|优先级排|怎么排|排一下)/
/** 「我要 / 我想 / 我需要…」开头：表达要做某件事（「我要配置 AI 模型」「我想办一场演唱会」）。 */
const NL_WANT_TO =
  /^(?:呃|嗯|那个|就是|好|那)?[，,\s]*(?:我|请你|你)?(?:现在|今天)?(?:要|想|想要|需要|打算|准备|希望|得)(?!.{0,2}(?:问|知道|了解|请教))/
/** 一键生成项目的说法（「帮我办一场校园演唱会」「建个项目」「生成项目计划」）。 */
const NL_CREATE_PROJECT =
  /((?:办|举办|筹办|策划|组织|搞|弄|做)(?:一|个|场|次)+|(?:新建|创建|建立|建|生成|产生|开|立)(?:一)?(?:个|份)?(?:新)?(?:的)?项目|项目计划)/
/** 删除任务（「删除 #551」「把测试任务删掉」）；「找回误删的任务」是回收站搜索，不算。 */
const NL_DELETE = /(删除|删掉|删了|删去|移除|移到回收站|丢进回收站)/
const NL_RECOVER = /(找回|恢复|还原)/
function isDeleteRequest(text: string): boolean {
  return NL_DELETE.test(text) && !NL_RECOVER.test(text)
}
/** 客气的请求（「能帮我切到深色吗」仍是让系统做事）。 */
const NL_POLITE_REQUEST = /(帮我|帮忙|请你|请帮|麻烦你?|能不能帮|可不可以帮|可以帮)/

/**
 * 是否先请模型把这句话理解成操作序列（再逐条执行，写操作逐条确认）。
 *
 * - 规则已命中写工具（如「延期任务 12 至 2026-09-15」）或矛盾求解时不重复理解；
 * - 明显是提问时不理解（交给问答；问答会按应用地图告诉你在哪里），客气请求除外；
 * - 含修改类动词或界面偏好词 → 理解；
 * - 复合句含查看/跳转动词 → 理解（避免快捷规则只吞掉其中一步）；
 * - 查看/跳转指向具体东西（「登录那个风险」）→ 理解（快捷规则只会打开总览页）；
 * - 快捷规则没命中且含查看/跳转动词 → 理解。
 * 不在项目空间也可以：此时只能打开页面、搜索前往、切换界面偏好。
 */
export function shouldPlanColleagueActions(
  input: string,
  intent: ParsedColleagueIntent,
  context: ColleagueContext,
): boolean {
  const text = input.trim()
  if (text.length < 2 || text.length > 500) return false
  // 不在项目空间、快捷规则已给出更具体的引导（如排程缺编号/日期）：不必请模型
  if (
    !context.currentProjectId &&
    intent.fallbackPrompt &&
    intent.fallbackPrompt !== COLLEAGUE_FALLBACK_TEXT
  ) {
    return false
  }
  if (
    intent.toolName === 'update_task_schedule' ||
    intent.toolName === ANALYZE_CONTRADICTION_TOOL_NAME
  ) {
    return false
  }
  if (NL_MY_WORK.test(text)) return true
  if (NL_QUESTION_MARKERS.test(text) && !NL_POLITE_REQUEST.test(text)) return false
  if (NL_MUTATION_VERBS.test(text) || NL_PREFERENCE_WORDS.test(text)) return true
  const viewing = NL_VIEW_VERBS.test(text)
  if (viewing && NL_CHAIN_CONNECTORS.test(text)) return true
  if (viewing && NL_SPECIFIC_REFERENCE.test(text)) return true
  return intent.toolName === null && viewing
}

/** 客套与语气词（判断是否「简单固定指令」时忽略）。 */
const NL_FILLER = /(请你?|帮我|帮忙|麻烦你?|给我|一下|吧|呢|啊|呀|哦|好吗|谢谢|[\s，,。.!！~～、])/g
/** 简单固定指令的最大长度（去掉客套后）：「打开甘特图」「查看当前项目摘要」「去回收站」。 */
const SIMPLE_COMMAND_MAX_LENGTH = 10

/**
 * 是否「简单固定指令」——只有这种才走本地快捷规则、不调用模型。
 *
 * 条件：快捷规则已命中，且去掉客套后是一句很短的直接指令（不带提问、不带多步、
 * 不指代具体对象、不是修改操作）。固定格式的排程演练（「延期任务 12 至 2026-09-15」）
 * 与命令式「矛盾求解：…」也算固定指令。其余一律交给模型理解。
 */
export function isSimpleFixedCommand(input: string, intent: ParsedColleagueIntent): boolean {
  if (!intent.toolName) return false
  const text = input.trim()
  if (intent.toolName === ANALYZE_CONTRADICTION_TOOL_NAME) return isTrizSolveCommand(text)
  // 排程：只有规则把编号与日期都解析齐了才算固定格式
  if (intent.toolName === 'update_task_schedule') {
    return typeof intent.parameters.taskId === 'number' && !NL_CHAIN_CONNECTORS.test(text)
  }
  const core = text.replace(NL_FILLER, '')
  if (core.length === 0 || core.length > SIMPLE_COMMAND_MAX_LENGTH) return false
  return !(
    NL_QUESTION_MARKERS.test(text) ||
    NL_CHAIN_CONNECTORS.test(text) ||
    NL_SPECIFIC_REFERENCE.test(text) ||
    NL_MUTATION_VERBS.test(text) ||
    NL_PREFERENCE_WORDS.test(text) ||
    NL_MY_WORK.test(text) ||
    isDeleteRequest(text) ||
    /\d|#/.test(core)
  )
}

/**
 * 这句话像不像要系统去做事（修改、查看/跳转、界面偏好、我的工作、多步、点名具体对象、客气的请求）。
 * 像 → 交给模型理解成操作序列；不像（纯提问、闲聊）→ 直接交给模型问答。两条路都调用模型。
 */
export function looksLikeColleagueRequest(
  input: string,
  destinationTitles: readonly string[] = [],
): boolean {
  const text = input.trim()
  if (NL_MY_WORK.test(text)) return true
  if (NL_QUESTION_MARKERS.test(text) && !NL_POLITE_REQUEST.test(text)) {
    // 问句里带了明确的修改 / 界面偏好也算请求（「能把登录页标成完成吗」）
    return NL_MUTATION_VERBS.test(text) || NL_PREFERENCE_WORDS.test(text) || isDeleteRequest(text)
  }
  return (
    NL_MUTATION_VERBS.test(text) ||
    NL_VIEW_VERBS.test(text) ||
    NL_PREFERENCE_WORDS.test(text) ||
    NL_CHAIN_CONNECTORS.test(text) ||
    NL_SPECIFIC_REFERENCE.test(text) ||
    NL_POLITE_REQUEST.test(text) ||
    NL_WANT_TO.test(text) ||
    NL_CREATE_PROJECT.test(text) ||
    isDeleteRequest(text) ||
    mentionsDestination(text, destinationTitles)
  )
}

/**
 * 不是提问却点名了界面上的某个页面（「AI 连接」「风险管理」「图表馆」）：多半是想去那里，
 * 交给模型理解（不是操作时模型会转为问答）。忽略大小写与空格（「ai连接」=「AI 连接」）。
 */
function mentionsDestination(text: string, titles: readonly string[]): boolean {
  const compact = (value: string) => value.replace(/\s+/g, '').toLowerCase()
  const haystack = compact(text)
  return titles.some((title) => {
    const needle = compact(title)
    return needle.length >= 3 && haystack.includes(needle)
  })
}
