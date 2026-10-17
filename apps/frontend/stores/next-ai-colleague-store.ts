/**
 * 新轨 AI 同事本地内存状态 Store（v3-ui-next-ai-colleague W1 · tasks 1.5；
 * W5 扩展矛盾求解卡组 · v3-triz-contradiction-copilot tasks 5.1/5.4/5.5）。
 *
 * 生命周期：会话状态全部驻留本地内存，刷新页面即初始化（design D-panel §3），
 * 零服务端冗余存储。状态机五态：
 * `idle → thinking → executing → awaiting_confirmation / error → idle`。
 *
 * RL-01 两阶段写确认闭环：
 * - `submitUserMessage` 命中写工具并收到 `PREVIEW_REQUIRED` 时，仅暂存
 *   `pendingAction`（previewToken + diff）并停在 `awaiting_confirmation`，绝不落库；
 * - `confirmPendingAction` 是唯一发往 `/confirm` 的通道，成功后清空 pendingAction；
 * - `cancelPendingAction` 本地销毁令牌、零网络请求（design D-write §1「放弃取消」）；
 * - 409 `SCHEDULE_STALE`/`TOKEN_EXPIRED` 冲突由 `aiToolsApi` 映射为
 *   `AiToolScheduleConflictError`，store 将其写入消息 `error` 槽、保留 pendingAction
 *   供「重新演练」（`redrillPendingAction`，以最新参数重发 execute 换新令牌）或取消。
 *
 * 写工具集合判定（RL-01 防串场，泛化自 W3 的 `update_task_schedule` 硬编码）：
 * `WRITE_TOOL_NAMES` 同时覆盖排程写试点与本 change 的三类落库写工具；任一新的写操作
 * 启动时，旧的待确认预览（排程 `pendingAction` 或矛盾落库 `pendingTriz`）立即作废，
 * 保证任何时刻面板内只有一张可确认卡。
 *
 * 矛盾求解卡组（W5）：
 * - 受理（`trizCopilotApi.solve`）→ 澄清（≤2 轮，触顶返回中间成果）→ Top 3 → 选定；
 * - 映射依据可查看（抽屉组件）与可改判（`overrideTrizParameters`，只改分析记录，业务表零变更）；
 * - 落库走既有 AI 工具两阶段：`previewTrizIntervention` 生成差异预览与 `previewToken`
 *   （业务表零写入），`confirmTrizIntervention` 是唯一发往 `/confirm` 的矛盾落库通道；
 * - 权限不足（`ai:trigger` / 目标实体写权限 / `ai:confirm`）一律**物理阻断**：
 *   不发起任何请求，只给中性提示（spec「对话求解的 RBAC 与组织隔离」第 4 条）。
 *
 * 组件边界：本 store 不持有任何 React/Query 依赖；确认成功后的 TanStack Query
 * 缓存失效由 W4 接线层订阅消息状态后触发（`taskKeys.lists(projectId)`）。
 */
import { create } from 'zustand'
import {
  aiToolsApi,
  isScheduleStaleError,
  type AiToolExecuteEnvelope,
  type ColleagueObservation,
  type ColleaguePageSnapshot,
  type ColleaguePlannedAction,
} from '@/lib/api/ai-tools'
import {
  capturePageImage,
  capturePageText,
  currentPageRoute,
} from '@/lib/next/ai-colleague-page-snapshot'
import {
  isConflictError,
  organizationSignalsApi,
  projectSignalsApi,
  signalCodeOf,
  type ProjectSignal,
} from '@/lib/api/project-signals'
import {
  AI_CONNECTION_REQUIRED_MESSAGE,
  AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND,
  isAiConnectionRequiredError,
  parseSignalCodes,
} from '@aiproj/types'
import { buildSignalSolverStatement } from '@/lib/next/signals/signal-solve-statement'
import { copilotApi } from '@/lib/api/copilot'
import { notifySignalsChanged, notifyTaskDataChanged } from '@/lib/task-data-change-bus'
import { derivePageContextDescriptor } from '@/lib/copilot/page-context'
import { buildColleagueAppMap, buildColleagueUiPreferences } from '@/lib/next/ai-colleague-app-map'
import { resolveEntityDirectUrl } from '@/components/next/navigation/SpaceMapGlobalSearchLens'
import { setVariant, type TextVariant } from '@/lib/locale/variant-store'
import { useUiStore, type Density } from '@/stores/ui-store'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore, type NxTheme } from '@/stores/next-track-store'
import type { ClarificationCard, SearchEntityType, SearchResultItem } from '@aiproj/types'
import type { AiToolCallingMode, CopilotStreamEvent } from '@aiproj/types'
import {
  AI_TOOL_CALLING_MODE_LABELS,
  COPILOT_DESTINATION_REGISTRY,
  parseColleagueAnswerDirectives,
  type CopilotDestination,
} from '@aiproj/types'
import { MAX_OPEN_TABS, conversationTitleOf } from '@/lib/next/ai-colleague-conversations'
import { needsRoutingConversion, toSimplifiedForRouting } from '@/lib/next/ai-colleague-normalize'
import { signOutSession } from '@/lib/auth/sign-out'
import {
  finishTheaterRoundIfDone,
  theaterAnswerFromText,
  theaterCardOptions,
  theaterCardPrompt,
} from '@/lib/next/ai-colleague-theater-bridge'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

export { MAX_OPEN_TABS, conversationTitleOf }
import {
  TRIZ_TARGET_TOOL_NAMES,
  TRIZ_TARGET_WRITE_PERMISSIONS,
  parseTrizInterventionDiff,
  parseTrizInterventionReceipt,
  resolveTrizMappingView,
  trizCopilotApi,
  trizExcludedPrincipleNumbers,
  type TrizInterventionDiff,
  type TrizInterventionReceipt,
  type TrizInterventionTarget,
  type TrizMappingPath,
  type TrizMappingView,
  type TrizOverrideInput,
  type TrizSolutionDraft,
} from '@/lib/api/triz-copilot'
import {
  ContextMissingError,
  COLLEAGUE_FALLBACK_TEXT,
  COLLEAGUE_CONTEXT_MISSING_TEXT,
  ANALYZE_CONTRADICTION_TOOL_NAME,
  IntentIncompleteError,
  isTrizSolveCommand,
  executeGlobalSearchEntities,
  parseColleagueIntent,
  looksLikeColleagueRequest,
  isKnowledgeQuestion,
  isSimpleFixedCommand,
  type ColleagueContext,
  type ColleagueIntentSource,
  type ParsedColleagueIntent,
} from '@/lib/next/ai-colleague-intent'

export type ColleagueExecutionState =
  'idle' | 'thinking' | 'executing' | 'awaiting_confirmation' | 'error'

export interface ColleagueToolExecution {
  toolName: string
  intentSource: ColleagueIntentSource
  status: 'executing' | 'success' | 'preview_required' | 'committed' | 'cancelled' | 'error'
  data?: unknown
  diff?: unknown
  previewToken?: string
  parameters?: Record<string, unknown>
  durationMs?: number
  error?: { code: string; message: string; status?: number }
  /** 作废说明（仅 status='cancelled' 时存在；缺省=用户主动放弃）。 */
  cancelNote?: string
  /** 模型理解出的操作序列中的第几步（如「第 2/3 步 · 把 #12 改为已完成」）。 */
  stepLabel?: string
  /** 理解这句话的模型（intentSource='llm_inference' 时披露）。 */
  modelLabel?: string | null
}

/** 模型理解出的操作序列（逐条执行；写操作逐条等用户确认后再继续下一步）。 */
export interface ColleagueActionQueue {
  /** 用户原话（步骤后续建议用）。 */
  userText: string
  steps: ColleaguePlannedAction[]
  /** 下一条待执行的步骤下标。 */
  nextIndex: number
  modelLabel: string | null
  /** 多步任务：第几轮（1 起）。 */
  iteration?: number
  /** 本轮执行完后把结果交回模型、再想下一步。 */
  continueAfter?: boolean
  /** 前几轮累积的观察结果。 */
  observations?: ColleagueObservation[]
  /** 本轮各步骤对应的消息（收集观察结果用）。 */
  stepMessageIds?: string[]
}

/** 多步任务：交回模型的单条观察结果上限（字符）。 */
const OBSERVATION_RESULT_MAX = 4000

export interface ColleagueMessage {
  id: string
  sender: 'user' | 'assistant'
  content?: string
  timestamp: number
  toolExecution?: ColleagueToolExecution
  /** 矛盾求解卡组载荷（W5）：与 `toolExecution` 互斥的专用卡片契约。 */
  trizRun?: ColleagueTrizRun
  /** 模型对话回答（没命中快捷规则的自由提问，经 Copilot 流式回合由大模型作答）。 */
  liveAnswer?: ColleagueLiveAnswer
  /** AI 向用户提问（选项卡片 + 自己输入），回答后连同原话重新交给模型理解。 */
  question?: ColleagueQuestion
}

/** AI 追问卡片：候选答案 + 最后一项「自己输入」。 */
export interface ColleagueQuestion {
  /**
   * plan（缺省）：操作理解的追问，回答后连同原话重新理解；
   * generation_mode：一键生成前问「全自动还是我来回答」；
   * theater_card：生成剧场的追问转到对话里回答（cardId 指向剧场的问题卡）。
   */
  kind?: 'plan' | 'generation_mode' | 'theater_card'
  /** kind 相关的附加信息（一键生成的需求 / 剧场问题卡 id）。 */
  meta?: { idea?: string; cardId?: string }
  prompt: string
  options: string[]
  /** 引发追问的原话（回答时一起交给模型，模型才知道在补充什么）。 */
  originalText: string
  status: 'open' | 'answered' | 'skipped'
  answer?: string
}

/** 模型对话回答的状态与披露信息。 */
export interface ColleagueLiveAnswer {
  status: 'streaming' | 'done' | 'error'
  /** 作答模型标签（用户选择的模型；缺省为组织默认模型）。 */
  modelLabel: string | null
  /** 本次是否开启了网页搜索（按次同意）。 */
  webSearchRequested: boolean
  /** 网页搜索门结果说明（已联网 / 未开启 / 额度用完 …）。 */
  webSearchNote?: string | null
  errorMessage?: string
  /** 失败分类（服务端 turn-error 的 errorKind；`ai-connection-required` 时界面附带设置入口）。 */
  errorKind?: string
  /** 提问时所在项目（回答里的〔成员·编码〕代号由后端按有权限项目的成员换回真实姓名）。 */
  projectId?: number | null
  /** 回答指明了唯一目标页面：界面自动打开它（站内 `/next` 路径）。 */
  autoOpenPath?: string | null
}

/** 对话中使用的模型偏好（对应 AI 连接及其模型）。 */
export interface ColleagueModelPreference {
  connectionId: number
  modelId: number
  label: string
}

/** 一段对话（本机保存，便于在历史对话间切换）。 */
export interface ColleagueConversation {
  id: string
  title: string
  messages: ColleagueMessage[]
  /** 服务端 Copilot 会话 ID：同一段对话的后续提问带上它，模型能看到上下文。 */
  sessionId: string | null
  updatedAt: number
}

export interface ColleaguePendingAction {
  toolName: string
  /** 预览令牌；`null` 表示 execute 阶段 409 的参数快照（无令牌，仅可重新演练/放弃）。 */
  previewToken: string | null
  parameters: Record<string, unknown>
  diff: unknown
}

// ---------------------------------------------------------------------------
// 矛盾求解卡组（v3-triz-contradiction-copilot W5 · tasks 5.1/5.4/5.5）
// ---------------------------------------------------------------------------

/** 矛盾求解卡组阶段闭集（澄清 → 方案 → 落库两阶段 → 终态）。 */
export type ColleagueTrizPhase =
  | 'clarifying'
  | 'answered'
  | 'solved'
  | 'exhausted'
  | 'previewing'
  | 'preview_ready'
  | 'committing'
  | 'committed'
  | 'cancelled'
  | 'conflict'
  | 'error'

/** 单次矛盾求解的运行态（随 AI 消息挂载；澄清链每一轮各成一条消息）。 */
export interface ColleagueTrizRun {
  phase: ColleagueTrizPhase
  projectId: number
  /** 来源被动雷达信号 ID（由信号卡跳转带入；自由求解为 null） */
  sourceSignalId?: number | null
  /** 来源信号编号（`PROJ-8#S10`）与类型（推荐落实方式用）；自由求解为 null */
  sourceSignalCode?: string | null
  sourceSignalType?: string | null
  /** 最近一次提交的陈述 / 澄清回答（仅用于重试；不落库、不回显原文） */
  statement: string
  /** 分析记录 ID（落库来源标注与改判 / 详情读取的锚点） */
  analysisId: number | null
  /** 澄清链上的上一轮分析记录 ID（重试 / 续轮时提交；初始受理为 null） */
  parentAnalysisId: number | null
  contradictionType: string | null
  contradictionTypeLabel: string | null
  /** 映射依据（受理响应顶层 `mapping`；改判后由分析记录派生，形状一致） */
  mapping: TrizMappingView | null
  /** Top 3 方案草案（一期上限 3 条） */
  solutions: TrizSolutionDraft[]
  /** 未进入 Top 3 的候选原则编号（映射依据抽屉按 spec 第 1 条必须展示） */
  excludedPrincipleNumbers: number[]
  path: TrizMappingPath
  confidence: number
  /** 已完成（含本轮）的澄清轮数与上限（硬上限 2） */
  clarificationRound: number
  maxClarificationRounds: number
  /** 本轮澄清追问文案（触顶时为 null，改用 budgetReason / clarificationReason 说明） */
  clarificationPrompt: string | null
  clarificationReason: string | null
  budgetState: 'within_budget' | 'exhausted'
  budgetReason: string | null
  /** 是否人工改判过（改判结果与模型推断值区分标注） */
  humanOverride: boolean
  /** Top 3 内选定的方案序号（1 起） */
  selectedSolutionIndex: number | null
  targetKind: TrizInterventionTarget | null
  previewToken: string | null
  diff: TrizInterventionDiff | null
  receipt: TrizInterventionReceipt | null
  error: { code: string; message: string; status?: number } | null
}

/** 待确认的矛盾落库现场（与排程 `pendingAction` 互斥：任一时刻仅一张可确认卡）。 */
export interface ColleaguePendingTrizAction {
  messageId: string
  toolName: string
  previewToken: string
  parameters: Record<string, unknown>
}

/** 写工具集合（RL-01 防串场判据）：排程 / 任务状态 + 矛盾求解三类落库写工具。 */
export const WRITE_TOOL_NAMES: readonly string[] = [
  'update_task_schedule',
  'update_task_status',
  'update_task_assignee',
  'delete_task',
  'create_task',
  'toggle_task_steps',
  'update_setting',
  ...Object.values(TRIZ_TARGET_TOOL_NAMES),
]

export function isWriteToolName(toolName: string): boolean {
  return WRITE_TOOL_NAMES.includes(toolName)
}

/** 权限不足的中性提示（不透露资源存在性，RL-05）：发起求解。 */
export const TRIZ_SOLVE_PERMISSION_DENIED_TEXT =
  '当前账号没有发起矛盾求解的权限（缺少 ai:trigger），本次未发起任何请求。如需使用请联系项目管理员。'

/** 权限不足的中性提示：目标实体写权限。 */
export const TRIZ_WRITE_PERMISSION_DENIED_TEXT =
  '当前账号没有把方案落库为该类型实体的权限，本次未发起任何写请求。可改选其他落库类型或联系项目管理员。'

/** 权限不足的中性提示：确认落库（`ai:confirm`）。 */
export const TRIZ_CONFIRM_PERMISSION_DENIED_TEXT =
  '当前账号没有确认落库的权限（缺少 ai:confirm），本次未发起任何写请求。'

/** 澄清预算触顶说明（中间成果仍然可用）。 */
export const TRIZ_CLARIFICATION_EXHAUSTED_TEXT =
  '澄清追问已达上限（2 轮），不再继续追问。下面是目前已有的中间成果，可直接选用方案或进入落库确认。'

/** 发起求解所需权限（spec「对话求解的 RBAC 与组织隔离」第 1 条）。 */
export const TRIZ_TRIGGER_PERMISSION = 'ai:trigger'

/** 确认落库所需权限（spec 第 2 条）。 */
export const TRIZ_CONFIRM_PERMISSION = 'ai:confirm'

export const SCHEDULE_STALE_DISPLAY_TEXT = '排程数据已被他人并发修改或预览已过期（版本冲突 409）'

/** 旧预览被新写操作取代时的作废提示（RL-01 确认语义：任何时刻仅一张可确认卡）。 */
export const PREVIEW_SUPERSEDED_TEXT = '该预览已被新操作取代，已自动作废'

// ── 对话历史与偏好的本机保存（每位用户自己的浏览器；读写失败不影响使用） ──────────

// 无归属的旧记录不迁移；用户已授权删除。新记录仅按已登录账号与组织恢复。
const HISTORY_STORAGE_KEY = 'aiproj-ai-colleague-history'
let colleagueScopeEpoch = 0
let changingColleagueScope = false
function historyScope(): string | null {
  const auth = useAuthStore.getState()
  const organizationId = selectEffectiveOrganizationId(auth)
  return auth.isAuthenticated && auth.user && organizationId !== null
    ? HISTORY_STORAGE_KEY + ':v2:' + auth.user.id + ':' + organizationId
    : null
}
let currentHistoryScope = historyScope()
const MAX_CONVERSATIONS = 30
const MAX_MESSAGES_PER_CONVERSATION = 80

interface PersistedColleagueHistory {
  /** 全部对话（含当前分页的快照）。 */
  conversations: ColleagueConversation[]
  /** 打开的分页顺序与当前分页（旧版本数据无此字段）。 */
  openTabIds?: string[]
  activeId?: string | null
  modelPreference: ColleagueModelPreference | null
}

function loadHistory(): PersistedColleagueHistory {
  try {
    if (typeof window === 'undefined') return { conversations: [], modelPreference: null }
    window.localStorage.removeItem(HISTORY_STORAGE_KEY)
    if (!currentHistoryScope) return { conversations: [], modelPreference: null }
    const raw = window.localStorage.getItem(currentHistoryScope)
    if (!raw) return { conversations: [], modelPreference: null }
    const parsed = JSON.parse(raw) as Partial<PersistedColleagueHistory>
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      openTabIds: Array.isArray(parsed.openTabIds) ? parsed.openTabIds : undefined,
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
      modelPreference: parsed.modelPreference ?? null,
    }
  } catch {
    return { conversations: [], modelPreference: null }
  }
}

/** 由持久化数据恢复分页：当前分页的消息进 state.messages，其余留在 conversations。 */
function restoreTabs(history: PersistedColleagueHistory): {
  conversationId: string
  sessionId: string | null
  messages: ColleagueMessage[]
  conversations: ColleagueConversation[]
  openTabIds: string[]
} {
  const known = new Set(history.conversations.map((c) => c.id))
  const openTabIds = (history.openTabIds ?? [])
    .filter((id) => known.has(id))
    .slice(0, MAX_OPEN_TABS)
  const active = history.conversations.find(
    (c) => c.id === history.activeId && openTabIds.includes(c.id),
  )
  if (active) {
    return {
      conversationId: active.id,
      sessionId: active.sessionId,
      messages: active.messages,
      conversations: history.conversations.filter((c) => c.id !== active.id),
      openTabIds,
    }
  }
  const fresh = createConversationId()
  return {
    conversationId: fresh,
    sessionId: null,
    messages: [],
    conversations: history.conversations,
    openTabIds: [...openTabIds, fresh].slice(-MAX_OPEN_TABS),
  }
}

function saveHistory(history: PersistedColleagueHistory): void {
  try {
    if (typeof window === 'undefined') return
    if (changingColleagueScope || !currentHistoryScope || currentHistoryScope !== historyScope())
      return
    window.localStorage.setItem(currentHistoryScope, JSON.stringify(history))
  } catch {
    // 存储不可用（隐私模式/配额）时只保留内存中的对话
  }
}

function createConversationId(): string {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 新版项目空间 → Copilot 页面语境描述（服务端据此重新授权、取项目事实交给模型）。
 * 不带它时服务端不附任何项目事实，模型只能回答「命中 N 条但没有正文」。
 * 描述符按旧版路由约定（/projects/:id[/视图]）派生，新版当前视图取自 ?lens=。
 */
function colleaguePageContext(context: ColleagueContext) {
  const projectId = context.currentProjectId
  if (!projectId) return undefined
  let searchParams = new URLSearchParams()
  try {
    if (typeof window !== 'undefined') searchParams = new URLSearchParams(window.location.search)
  } catch {
    searchParams = new URLSearchParams()
  }
  const lens = searchParams.get('lens')
  const view = lens && /^(gantt|wbs|list|calendar|timeline)$/.test(lens) ? `/${lens}` : '/kanban'
  // 页面上可见的筛选 / 选中任务一并带上（只取 allowlist 内键，后端二次校验）
  searchParams.delete('lens')
  const focusTask = searchParams.get('focusTask')
  if (focusTask && !searchParams.has('task')) searchParams.set('task', focusTask)
  return derivePageContextDescriptor({
    pathname: `/projects/${projectId}${view}`,
    params: {},
    searchParams,
  })
}

/** 展示层权限判定（与面板一致；真正的门在服务端）。 */
function contextCan(context: ColleagueContext): (permission: string) => boolean {
  return (permission) =>
    context.isSuperAdmin === true ||
    (context.permissions ?? []).includes('system:admin') ||
    (context.permissions ?? []).includes(permission)
}

/** 在浏览器本地执行的工具：打开页面 / 全域搜索 / 界面偏好（都没有服务端副作用）。 */
export const CLIENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'open_app_page',
  'search_global_entities',
  'set_ui_preference',
  'start_project_generation',
  'sign_out',
  'capture_page',
])

/**
 * 截图当前页面并交给能看图的模型描述（📷 与 AI「看一眼页面」共用）。
 * 截图前先让出一帧，确保 AI 同事面板的渲染不会挡住页面。
 */
async function describeCurrentPage(
  question: string | undefined,
  modelPreference: ColleagueModelPreference | null | undefined,
): Promise<{ description: string; model: string; route: string }> {
  const scopeEpoch = colleagueScopeEpoch
  const route = currentPageRoute()
  let imageDataUrl: string
  try {
    imageDataUrl = await capturePageImage()
    if (scopeEpoch !== colleagueScopeEpoch) throw new Error('COLLEAGUE_SCOPE_CHANGED')
  } catch (error) {
    if (scopeEpoch !== colleagueScopeEpoch)
      throw new Error('COLLEAGUE_SCOPE_CHANGED', { cause: error })
    throw Object.assign(
      new Error(`页面截图失败（${error instanceof Error ? error.message : '未知原因'}）`),
      { code: 'CAPTURE_FAILED' },
    )
  }
  const vision = await aiToolsApi.pageVision({
    imageDataUrl,
    ...(question ? { question: question.slice(0, 1000) } : {}),
    ...(modelPreference
      ? { connectionId: modelPreference.connectionId, modelId: modelPreference.modelId }
      : {}),
  })
  if (scopeEpoch !== colleagueScopeEpoch) throw new Error('COLLEAGUE_SCOPE_CHANGED')
  return { ...vision, route }
}

/** 生成剧场的最短需求长度（与剧场输入框 INTENT_INPUT_MIN 一致）。 */
const PROJECT_IDEA_MIN = 10

/**
 * 本地执行：
 * - open_app_page：返回目标路径，由消息列表跳转；
 * - search_global_entities：与空间地图同一个搜索接口；`open` 且唯一命中时给出直达路径；
 * - set_ui_preference：密度、简繁体在这里直接生效；主题由消息列表经 next-themes 生效。
 */
async function runClientTool(
  toolName: string,
  parameters: Record<string, unknown>,
  options: { modelPreference?: ColleagueModelPreference | null; question?: string } = {},
): Promise<Record<string, unknown>> {
  const scopeEpoch = colleagueScopeEpoch
  if (toolName === 'capture_page') {
    const vision = await describeCurrentPage(options.question, options.modelPreference)
    if (scopeEpoch !== colleagueScopeEpoch) throw new Error('COLLEAGUE_SCOPE_CHANGED')
    return { ...vision }
  }
  if (toolName === 'open_app_page') {
    const path = typeof parameters.path === 'string' ? parameters.path : ''
    if (!path.startsWith('/next') || path.includes(':id')) {
      throw Object.assign(new Error('这个页面需要先进入某个项目空间'), { code: 'CONTEXT_MISSING' })
    }
    return { path, title: parameters.title ?? '' }
  }
  if (toolName === 'search_global_entities') {
    const keyword = typeof parameters.keyword === 'string' ? parameters.keyword : ''
    const entityTypes = Array.isArray(parameters.entityTypes)
      ? (parameters.entityTypes as SearchEntityType[])
      : undefined
    const response = await executeGlobalSearchEntities({ keyword, entityTypes })
    if (scopeEpoch !== colleagueScopeEpoch) throw new Error('COLLEAGUE_SCOPE_CHANGED')
    const results: SearchResultItem[] = Array.isArray(response?.data) ? response.data : []
    const openPath =
      parameters.open === true && results.length === 1 ? resolveEntityDirectUrl(results[0]!) : null
    return { keyword, results, total: results.length, ...(openPath ? { openPath } : {}) }
  }
  if (toolName === 'start_project_generation') {
    // 一键生成：生成剧场填好需求并直接进入分析（与在剧场点「开始」同一条路径），
    // 之后的追问、生成、审查都在剧场里照常进行；手动模式由用户审查确认转正，全自动模式（用户明确选择）
    // 由 AI 同事在规则 / 反幻觉校验无阻断时代为确认（见 use-theater-colleague-bridge）。
    let idea = typeof parameters.idea === 'string' ? parameters.idea.trim() : ''
    if (idea === '') throw new Error('没有说清要生成什么项目')
    if (idea.length < PROJECT_IDEA_MIN) idea = `${idea}，请帮我生成完整的项目计划`
    const draftStore = useAiProjectDraftStore.getState()
    // 默认与 AI 同事用同一个模型；AI 同事没选过模型时沿用剧场上次选的
    const preference = options.modelPreference
    const modelSelection = preference
      ? { connectionId: preference.connectionId, modelId: preference.modelId }
      : draftStore.modelSelection
    draftStore.restart()
    if (modelSelection) draftStore.setModelSelection(modelSelection)
    draftStore.setRawInput(idea)
    // 全自动：剧场里的追问由 AI 审阅代答、就绪后自动开始生成，生成后校验无阻断即代为确认转正
    draftStore.setAutoPilot(parameters.mode === 'auto')
    draftStore.startAnalyzing()
    return {
      path: '/next/create',
      title: '生成剧场',
      idea,
      mode: parameters.mode === 'auto' ? 'auto' : 'manual',
    }
  }
  if (toolName === 'sign_out') {
    // 用户明确要求退出：与个人资料页同一实现；随后登录守卫把页面带回登录页
    await signOutSession()
    if (scopeEpoch !== colleagueScopeEpoch) throw new Error('COLLEAGUE_SCOPE_CHANGED')
    return { signedOut: true }
  }
  if (toolName === 'set_ui_preference') {
    const labels: string[] = []
    const preferences = buildColleagueUiPreferences()
    if (typeof parameters.density === 'string') {
      const option = preferences.densities.find((item) => item.value === parameters.density)
      if (option) {
        useUiStore.getState().setDensity(option.value as Density)
        labels.push(option.label)
      }
    }
    if (typeof parameters.textVariant === 'string') {
      const option = preferences.textVariants.find((item) => item.value === parameters.textVariant)
      if (option) {
        setVariant(option.value as TextVariant)
        labels.push(option.label)
      }
    }
    const theme =
      typeof parameters.theme === 'string'
        ? preferences.themes.find((item) => item.value === parameters.theme)
        : undefined
    if (theme) {
      // 新版界面的明暗由 next-track-store 驱动（<html data-nx-theme>），与旧版 next-themes 是两套；
      // 只改 next-themes 时新版页面看起来「说已切换却没变」。这里直接改新版，旧版由消息列表经 next-themes 同步。
      useNextTrackStore.getState().setNxTheme(resolveNxTheme(theme.value))
      labels.push(theme.label)
    }
    if (labels.length === 0) throw new Error('要切换的界面偏好无法识别')
    return { ...(theme ? { theme: theme.value } : {}), labels }
  }
  throw new Error(`未知的本地工具：${toolName}`)
}

/** 外观菜单的浅色 / 深色 / 跟随系统 → 新版界面只有明暗两档，跟随系统按当前系统配色取。 */
function resolveNxTheme(theme: string): NxTheme {
  if (theme === 'light' || theme === 'dark') return theme
  try {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: light)').matches
    ) {
      return 'light'
    }
  } catch {
    // matchMedia 不可用时按新版默认深色
  }
  return 'dark'
}

/** 跳转类说法（缺项目时交给模型追问项目，而不是只回一句「需要项目环境」）。 */
const NAVIGATION_VERB_RE =
  /(打开|切换到|切到|跳到|跳转|带我|前往|进入|去看|去到|过去|我要去|我想去)/

/** 徽标里的方式简称（中英对照，便于辨别四种工具调用方式）。 */
const TOOL_CALLING_MODE_SHORT: Readonly<Record<AiToolCallingMode, string>> = {
  prompt_json: '提示词 JSON（Prompt+JSON）',
  openai_chat_tools: 'OpenAI Chat Tools',
  openai_responses_tools: 'OpenAI Responses Tools',
  anthropic_tool_use: 'Claude Tool Use',
}

/** 当前打开详情抽屉的任务（`?focusTask=`）：让「这个任务」有指代对象。 */
function focusedTaskId(): number | null {
  try {
    if (typeof window === 'undefined') return null
    const id = Number(new URLSearchParams(window.location.search).get('focusTask'))
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

/** 当前页面（路径 + 查询串，便于区分项目内视图）：回答「我现在在哪里」。 */
function currentRouteOf(context: ColleagueContext): string | undefined {
  try {
    if (typeof window !== 'undefined' && window.location.pathname === context.pathname) {
      return `${window.location.pathname}${window.location.search}`
    }
  } catch {
    // 无 window（测试 / SSR）时只用路径
  }
  return context.pathname
}

/** 多步任务最多几轮（含第一轮；与服务端 COLLEAGUE_AGENT_MAX_ITERATIONS 一致）。 */
export const COLLEAGUE_AGENT_MAX_ITERATIONS = 30
/** 多步任务累积的观察结果上限（条）。 */
const MAX_OBSERVATIONS = 120

/** 一键生成前的两种模式（追问卡片选项）。 */
export const GENERATION_MODE_AUTO =
  '全自动（包括转为正式项目）：AI 审阅并代答追问、生成并修正草案后转为正式项目，可离开页面，之后改动走变更'
/** 没有转正权限（ai:confirm）时的全自动选项：一开始就说清只能做到草案。 */
export const GENERATION_MODE_AUTO_NO_CONFIRM =
  '全自动（到草案为止）：AI 审阅并代答追问、生成并修正草案；当前账号没有转正权限，转正需有权限的人确认'
export const GENERATION_MODE_MANUAL =
  '带我到生成剧场（自己回答追问；生成中可离开页面，需要我处理时会通知）'

/** 交给操作理解器的最近几轮对话（理解「直接带我过去」这类指代）。 */
const PLANNER_CONVERSATION_TURNS = 6

/**
 * Copilot 流式失败分类 → 用户可读说明（2026-10-06 细分）。
 *
 * 原先除了权限 / 登录 / 限流外一律显示「暂时连不上 AI 模型，请确认组织已在 AI 连接里配置可用模型」——
 * 供应商其实收到了请求（超时、中途断流、输出超长等），界面却说配置有问题。现在按服务端给出的
 * 分类说明真实原因；只有确实没有可用模型时才提示去「AI 连接」检查。
 * `reason` 为服务端附带的低敏原因（含上游 HTTP 状态码时一并显示）。
 */
export function describeLiveFailure(
  errorKind: string | undefined,
  status?: number,
  reason?: string,
): string {
  const detail = (text: string) =>
    reason && !text.includes(reason) ? `${text}（${reason}）` : text
  if (status === 403 || errorKind === 'permission') return '没有使用 AI 的权限，请联系组织管理员。'
  if (status === 401 || errorKind === 'auth') return '登录已过期，请重新登录后再试。'
  if (status === 429 || errorKind === 'rate-limit')
    return detail('AI 调用太频繁或额度已用完，请稍后再试。')
  if (errorKind === 'empty') return '模型没有返回内容，请换个问法再试。'
  // 组织没有任何可用连接、也没有实例级默认 Key（v3-personal-edition-open-source-export 4.6）
  if (errorKind === AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND) return AI_CONNECTION_REQUIRED_MESSAGE
  if (errorKind === 'model-unavailable') {
    return '没有可用的 AI 模型：所选模型连接不可用（可能已停用、缺少密钥或模型已删除），组织里也没有其他可用模型。请在「AI 连接」检查，或换一个模型再问。'
  }
  if (errorKind === 'validation') return '这次提问的内容无法处理，请缩短或换个问法。'
  if (errorKind === 'model-timeout')
    return detail('模型回答超时了：供应商太久没有返回。可以稍后重试，或换一个更快的模型。')
  if (errorKind === 'model-interrupted')
    return detail('与模型供应商的连接中途断开了，回答没有完成。请重试。')
  if (errorKind === 'model-auth')
    return detail(
      '模型供应商拒绝了这次调用（密钥无效、过期或没有该模型的权限）。请在「AI 连接」检查密钥。',
    )
  if (errorKind === 'model-not-found')
    return detail(
      '模型供应商找不到所选模型（名称可能有误或已下线）。请在「AI 连接」检查模型名称，或换一个模型。',
    )
  if (errorKind === 'model-rejected')
    return detail(
      '模型供应商拒绝了这次请求（可能是参数或内容不被接受）。请换个问法，或换一个模型再试。',
    )
  if (errorKind === 'model-output-limit')
    return detail('回答超过了模型的输出长度上限，没能写完。可以把问题拆小一点再问。')
  if (errorKind === 'model-loop')
    return detail('模型输出陷入了重复循环，已自动中止。请换个问法再试。')
  if (errorKind === 'model-error')
    return detail('模型供应商这次返回了错误，请稍后重试或换一个模型。')
  if (errorKind === 'retryable-service') return detail('服务端处理这次回答时出错了，请稍后重试。')
  // 没有服务端分类：多为浏览器到服务器的连接中途断开（网络切换、代理超时等）
  if (errorKind === undefined && status === undefined)
    return '与服务器的连接中途断开了，回答没有完成。请检查网络后重试。'
  if (status !== undefined && status >= 500) return 'AI 服务暂时不可用，请稍后重试。'
  return detail('AI 回答这次没有完成，请稍后重试。')
}

export interface NextAiColleagueState {
  isOpen: boolean
  executionState: ColleagueExecutionState
  messages: ColleagueMessage[]
  pendingAction: ColleaguePendingAction | null
  /** 矛盾落库待确认现场（W5）；与 `pendingAction` 互斥，保证唯一可确认卡。 */
  pendingTriz: ColleaguePendingTrizAction | null
  /** 自然语言操作序列（模型理解）：确认 / 放弃当前写操作后自动继续下一步。 */
  actionQueue: ColleagueActionQueue | null
  /** 最近一次提交消息时携带的情境（权限判定与项目上下文来源）。 */
  context: ColleagueContext | null
  /** 当前对话 ID 与服务端会话 ID。 */
  conversationId: string
  sessionId: string | null
  /** 其余对话（不含当前分页；包括打开着的其他分页与已关闭的历史对话；新到旧）。 */
  conversations: ColleagueConversation[]
  /** 打开的对话分页（顺序即分页栏顺序，含当前分页）。 */
  openTabIds: string[]
  /** 模型偏好（null = 组织默认模型）。 */
  modelPreference: ColleagueModelPreference | null
  /** 本段对话是否开启网页搜索（每次提问都作为按次同意发送）。 */
  webSearchEnabled: boolean
  /** 当前页面截图的看图描述（📷 或 AI「看一眼页面」后带上；离开该页面即失效）。 */
  pageVision: { description: string; model: string; route: string } | null
  /** 输入框预填建议（按 Tab 采用第一条）。 */
  suggestions: string[]
  /** 一键生成与生成剧场联动：全自动（AI 代答追问、生成、修正并转正）或手动（带到生成剧场，用户自己回答）。 */
  theaterLink: { mode: 'auto' | 'manual' } | null
  /** 一键生成前弹窗选择「全自动 / 带我到生成剧场」（对话里同时有同一个问题卡，答哪边都行）。 */
  pendingGenerationChoice: {
    idea: string
    messageId: string
    canConfirm: boolean
    modelLabel: string | null
  } | null
  /**
   * 在后台继续回答的对话（用户在它回答时切到了别的分页）；null = 没有，或正在回答的就是当前分页。
   * 同一时间只跑一轮：它的输出、思考与工具调用写回自己的对话，不会串到当前分页。
   */
  backgroundRunId: string | null
  /** 回答进行中发出的消息先排队，这一轮结束后自动发送（输入框不再锁定）。 */
  queuedMessage: { conversationId: string; text: string; context: ColleagueContext } | null
  /** 取消排队中的消息（文字回填由界面处理）。 */
  cancelQueuedMessage: () => void
  /** 弹窗里选好了：全自动 / 带我到生成剧场 / 先不生成。 */
  chooseGenerationMode: (choice: 'auto' | 'manual' | 'cancel') => Promise<void>
  /** 📷 看一眼当前页面：截图交给能看图的模型描述，下一句话会带上描述。 */
  attachPageVision: () => Promise<void>
  clearPageVision: () => void
  /** 按当前对话（与正在回答的问题）向模型要预填建议；`draft` 为已输入的开头。 */
  refreshSuggestions: (draft?: string) => Promise<void>
  clearSuggestions: () => void
  /** 生成剧场的追问转到对话里（手动模式）。 */
  relayTheaterCard: (card: ClarificationCard) => void
  /** 生成剧场进度播报（代答了什么、开始生成、草案已生成 / 失败）。 */
  noteTheaterEvent: (text: string) => void
  /** 结束联动（草案已生成 / 失败 / 用户离开）。 */
  endTheaterLink: () => void
  /** 用户停止全自动：结束联动、剧场不再自动开始生成，进行中的修正 / 转正在下一轮前停下。 */
  stopAutopilot: () => void
  /** 剧场里已经答掉（不在 `liveCardIds` 里）的转发问题标为已处理。 */
  settleTheaterQuestions: (liveCardIds: readonly string[]) => void
  /** 新分页：在当前分页右侧打开一个空对话（当前已是空对话时不重复新建）。 */
  newConversation: () => void
  /** 切换分页；也可从历史对话重新打开（加回分页栏）。 */
  switchConversation: (conversationId: string) => void
  /** 关闭分页：对话仍保留在历史里（空对话直接丢弃）；关的是当前分页则切到相邻分页。 */
  closeConversationTab: (conversationId: string) => void
  /** 彻底删除一段对话（同时关闭它的分页）。 */
  deleteConversation: (conversationId: string) => void
  setModelPreference: (preference: ColleagueModelPreference | null) => void
  setWebSearchEnabled: (enabled: boolean) => void
  openPanel: () => void
  closePanel: () => void
  toggleOpen: () => void
  submitUserMessage: (text: string, context: ColleagueContext) => Promise<void>
  /**
   * 写操作两阶段确认（RL-01）。`expectedPreviewToken`：调用方所持预览卡的令牌；
   * 提供且与当前 pendingAction 令牌不一致时拒绝执行（返回 false、零请求），
   * 杜绝旧预览卡确认新 pendingAction 的串场落库。
   * @returns 是否实际发起了 confirm 请求
   */
  confirmPendingAction: (expectedPreviewToken?: string) => Promise<boolean>
  cancelPendingAction: () => void
  /** 409 冲突自愈：以最新参数重新执行，换取新 previewToken 与 Diff（W3 重新演练按钮）。 */
  redrillPendingAction: () => Promise<void>
  clearMessages: () => void

  // ── 矛盾求解卡组（W5） ──────────────────────────────────────────────
  /** 澄清回答（快捷选项胶囊与自由文本共用；自动携带上一轮分析记录 ID）。 */
  answerTrizClarification: (messageId: string, answer: string) => Promise<void>
  /** 选定 Top 3 中的一条方案（零请求）。 */
  selectTrizSolution: (messageId: string, solutionIndex: number) => void
  /**
   * 选定落库类型并生成差异预览（写工具 execute）。
   * 阶段一：业务表零写入，只暂存差异与 `previewToken`；无写权限时零请求。
   */
  previewTrizIntervention: (messageId: string, target: TrizInterventionTarget) => Promise<void>
  /** 差异预览的重新生成（409 过期自愈：以最新事实重发 execute 换新令牌）。 */
  retryTrizPreview: (messageId: string) => Promise<void>
  /**
   * 显式确认落库（携带 `previewToken` 提交；无显式点击永不触发）。
   * `expectedPreviewToken` 与当前令牌不一致时拒绝（返回 false、零请求）。
   */
  confirmTrizIntervention: (messageId: string, expectedPreviewToken?: string) => Promise<boolean>
  /** 放弃落库：本地销毁令牌，零网络请求。 */
  cancelTrizIntervention: (messageId: string) => void
  /** 映射依据改判参数并重算（只改分析记录，业务数据零变更）。 */
  overrideTrizParameters: (messageId: string, input: TrizOverrideInput) => Promise<void>
  /** 求解失败重试（以同一陈述重发受理请求）。 */
  retryTrizSolve: (messageId: string) => Promise<void>
  /**
   * 暂存一条信号（信号卡点「进入矛盾求解」时调用），随后的「矛盾求解 <信号编号>」直接用它，
   * 不必再查一次。手动输入编号时没有暂存，按编号向服务端查。
   */
  rememberSignalForSolve: (signal: ProjectSignal) => void
}

/**
 * 正在进行的一轮（思考 / 输出 / 调用工具 / 多步执行）所属的对话。
 *
 * 2026-10-06：原先回答期间锁住输入框、新建分页与切换分页——因为回答流程直接写「当前分页」的
 * 状态，切走就会串到别的对话。现在这一轮绑定发起它的对话：用户切走后，它对按对话区分的字段
 * （消息、执行状态、待确认卡、行动队列、会话 ID、情境）的读写都改落到那段对话的存档里，
 * 切回来原样恢复。同一时间仍只跑一轮，其他分页发出的消息先排队。
 */
let runConversationId: string | null = null
type ColleagueRuntime = Pick<
  NextAiColleagueState,
  'executionState' | 'pendingAction' | 'pendingTriz' | 'actionQueue' | 'sessionId' | 'context'
>
/** 不在前台的对话的运行现场（正在后台回答，或停在待确认 / 行动队列中）。 */
const backgroundRuntime = new Map<string, ColleagueRuntime>()
const PER_CONVERSATION_KEYS = new Set<string>([
  'messages',
  'executionState',
  'pendingAction',
  'pendingTriz',
  'actionQueue',
  'sessionId',
  'context',
])
const IDLE_RUNTIME: Omit<ColleagueRuntime, 'sessionId'> = {
  executionState: 'idle',
  pendingAction: null,
  pendingTriz: null,
  actionQueue: null,
  context: null,
}
const isWorking = (state: ColleagueExecutionState) => state === 'thinking' || state === 'executing'
/** 身份 / 组织切换时清空（旧现场不得回填）。 */
function resetColleagueRuns(): void {
  runConversationId = null
  backgroundRuntime.clear()
}

let messageSeq = 0
/** 最近一次请求输入建议时的对话标识（结果回来时对话已变就丢弃）。 */
let suggestionKey: string | null = null
function createMessageId(): string {
  messageSeq += 1
  return `colleague-${Date.now().toString(36)}-${messageSeq}`
}

function toColleagueError(error: unknown): { code: string; message: string; status?: number } {
  // 没有可用 AI 连接（矛盾求解等）：用独立错误码，卡片据此给出设置入口
  if (isAiConnectionRequiredError(error)) {
    const status = (error as { status?: unknown }).status
    return {
      code: 'AI_CONNECTION_REQUIRED',
      message: AI_CONNECTION_REQUIRED_MESSAGE,
      status: typeof status === 'number' ? status : undefined,
    }
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown; status?: unknown }
    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        message: typeof candidate.message === 'string' ? candidate.message : '请求失败，请稍后重试',
        status: typeof candidate.status === 'number' ? candidate.status : undefined,
      }
    }
  }
  return { code: 'NETWORK_ERROR', message: '网络连接异常，请检查网络后重试' }
}

/** 信号卡交接暂存（信号 ID → 信号）：点「进入矛盾求解」时放入，求解开始时取出。 */
const signalSolveCache = new Map<number, ProjectSignal>()

const SIGNAL_CODE_STRIP_RE = /(?:[A-Za-z][A-Za-z0-9_-]{0,30})?#S\d{1,9}\b/gi
const SIGNAL_SOLVE_WORDS_RE = /矛盾|求解|解决|处理|分析|破局|搞定/

/**
 * 「矛盾求解 PROJ-8#S10」「帮我解决 #S10」或只贴编号 → 对该信号求解；
 * 带着编号问别的（「PROJ-8#S10 是什么意思」）不拦截，交给模型回答。
 */
export function matchSignalSolveRequest(
  text: string,
): { signalId: number; projectCode: string | null } | null {
  const codes = parseSignalCodes(text)
  if (codes.length === 0) return null
  const rest = text.replace(SIGNAL_CODE_STRIP_RE, '').replace(/[\s:：,，。.!！?？、]/g, '')
  return rest === '' || SIGNAL_SOLVE_WORDS_RE.test(rest) ? codes[0]! : null
}

const SIGNAL_CLOSED_TEXT: Record<string, string> = {
  adopted: '已经处理过（已采纳并落实）',
  dismissed: '已被忽略',
  expired: '已过期',
}

function extractSignalIdFromText(text: string): number | null {
  const match = /信号 ID：#?(\d+)/.exec(text)
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) && id > 0 ? id : null
}

export const useNextAiColleagueStore = create<NextAiColleagueState>()((rawSet, rawGet) => {
  /** 当前这一轮是否在后台（属于非当前分页的对话）。 */
  function routingToBackground(): string | null {
    return runConversationId !== null && runConversationId !== rawGet().conversationId
      ? runConversationId
      : null
  }

  /** 回答流程看到的状态：这一轮在后台时，按对话区分的字段换成那段对话的。 */
  const get = (): NextAiColleagueState => {
    const state = rawGet()
    const runId = routingToBackground()
    if (!runId) return state
    const conversation = state.conversations.find((c) => c.id === runId)
    const runtime = backgroundRuntime.get(runId) ?? {
      ...IDLE_RUNTIME,
      sessionId: conversation?.sessionId ?? null,
    }
    return { ...state, messages: conversation?.messages ?? [], ...runtime }
  }

  /** 回答流程的写入：这一轮在后台时，按对话区分的字段写回那段对话的存档。 */
  const set = ((
    partial:
      | Partial<NextAiColleagueState>
      | ((state: NextAiColleagueState) => Partial<NextAiColleagueState>),
  ) => {
    const runId = routingToBackground()
    if (!runId) {
      rawSet(partial)
      syncRun()
      return
    }
    const next = typeof partial === 'function' ? partial(get()) : partial
    const shared: Partial<NextAiColleagueState> = {}
    const scoped: Partial<NextAiColleagueState> = {}
    for (const [key, value] of Object.entries(next)) {
      ;(PER_CONVERSATION_KEYS.has(key) ? scoped : shared)[key as never] = value as never
    }
    if (Object.keys(shared).length > 0) rawSet(shared)
    if (Object.keys(scoped).length > 0) writeBackground(runId, scoped)
    syncRun()
  }) as typeof rawSet

  function writeBackground(runId: string, scoped: Partial<NextAiColleagueState>): void {
    const state = rawGet()
    const conversation = state.conversations.find((c) => c.id === runId)
    // 对话在回答途中被删掉：这一轮的写入丢弃，运行现场一并结束
    if (!conversation) {
      backgroundRuntime.delete(runId)
      return
    }
    const runtime: ColleagueRuntime = {
      ...(backgroundRuntime.get(runId) ?? { ...IDLE_RUNTIME, sessionId: conversation.sessionId }),
    }
    for (const key of Object.keys(scoped)) {
      if (key !== 'messages') runtime[key as never] = scoped[key as never] as never
    }
    backgroundRuntime.set(runId, runtime)
    const messages = scoped.messages ?? conversation.messages
    rawSet({
      conversations: state.conversations.map((c) =>
        c.id === runId
          ? {
              ...c,
              messages,
              title: conversationTitleOf(messages),
              sessionId: runtime.sessionId,
              updatedAt: Date.now(),
            }
          : c,
      ),
    })
  }

  /** 跟踪这一轮属于哪段对话；结束时保存并发送排队的消息。 */
  function syncRun(): void {
    const state = rawGet()
    if (runConversationId === null) {
      if (isWorking(state.executionState)) runConversationId = state.conversationId
    } else if (runConversationId === state.conversationId) {
      if (!isWorking(state.executionState)) runConversationId = null
    } else {
      const runtime = backgroundRuntime.get(runConversationId)
      if (!runtime || !isWorking(runtime.executionState)) {
        runConversationId = null
        persist()
      }
    }
    const backgroundRunId = routingToBackground()
    if (state.backgroundRunId !== backgroundRunId) rawSet({ backgroundRunId })
    if (runConversationId === null && state.queuedMessage) scheduleQueuedFlush()
  }

  let flushScheduled = false
  function scheduleQueuedFlush(): void {
    if (flushScheduled) return
    flushScheduled = true
    setTimeout(() => {
      flushScheduled = false
      const state = rawGet()
      const queued = state.queuedMessage
      if (!queued || runConversationId !== null) return
      // 只在排队的那段对话就是当前分页、且没有待确认的预览时发送（不替用户作废预览卡）
      if (queued.conversationId !== state.conversationId) return
      if (state.executionState !== 'idle' || state.pendingAction || state.pendingTriz) return
      rawSet({ queuedMessage: null })
      void rawGet().submitUserMessage(queued.text, queued.context)
    }, 0)
  }

  function patchToolExecution(messageId: string, patch: Partial<ColleagueToolExecution>): void {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId && message.toolExecution
          ? { ...message, toolExecution: { ...message.toolExecution, ...patch } }
          : message,
      ),
    }))
  }

  function findMessageByPreviewToken(previewToken: string): string | null {
    return (
      [...get().messages].reverse().find((m) => m.toolExecution?.previewToken === previewToken)
        ?.id ?? null
    )
  }

  /** 定位待确认现场的消息：有令牌按令牌精确匹配；无令牌（execute 409 快照）按「同工具 + 最新错误消息」定位。 */
  function findPendingMessageId(pendingAction: ColleaguePendingAction): string | null {
    if (pendingAction.previewToken) {
      return findMessageByPreviewToken(pendingAction.previewToken)
    }
    return (
      [...get().messages]
        .reverse()
        .find(
          (m) =>
            m.toolExecution?.toolName === pendingAction.toolName &&
            m.toolExecution?.status === 'error',
        )?.id ?? null
    )
  }

  function appendAssistant(
    content?: string,
    toolExecution?: ColleagueToolExecution,
    trizRun?: ColleagueTrizRun,
  ): string {
    const id = createMessageId()
    set((state) => ({
      messages: [
        ...state.messages,
        { id, sender: 'assistant', content, timestamp: Date.now(), toolExecution, trizRun },
      ],
    }))
    return id
  }

  /** 追加一张 AI 追问卡片。 */
  function appendQuestion(prompt: string, options: string[], originalText: string): string {
    const id = createMessageId()
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          sender: 'assistant',
          timestamp: Date.now(),
          question: { prompt, options, originalText, status: 'open' },
        },
      ],
    }))
    return id
  }

  /** 最近一条仍在等回答的追问卡（只认对话里最后一条助手消息）。 */
  function findOpenQuestion(): { id: string; question: ColleagueQuestion } | null {
    const messages = get().messages
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!
      if (message.sender !== 'assistant') continue
      return message.question?.status === 'open'
        ? { id: message.id, question: message.question }
        : null
    }
    return null
  }

  /** 对话里回答剧场的追问：写回剧场（剧场随即推进到下一题 / 重新分析）。 */
  function answerTheaterCard(cardId: string, text: string) {
    const draft = useAiProjectDraftStore.getState()
    const card =
      draft.cards.find((item) => item.cardId === cardId) ??
      (draft.activeCard?.cardId === cardId ? draft.activeCard : null)
    if (!card) {
      appendAssistant('这个问题已经在生成剧场里回答过了，不用再答。')
      return
    }
    draft.recordAnswer(theaterAnswerFromText(card, text))
    finishTheaterRoundIfDone()
  }

  function patchQuestion(messageId: string, patch: Partial<ColleagueQuestion>) {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId && message.question
          ? { ...message, question: { ...message.question, ...patch } }
          : message,
      ),
    }))
  }

  /** 回答追问（点卡片选项 / 自己输入 / 直接在输入框打字）：原话 + 追问 + 回答一起交给模型重新理解。 */
  function questionFollowUpText(question: ColleagueQuestion, answer: string): string {
    return `${question.originalText}\n（补充说明：${question.prompt} —— ${answer}）`
  }

  function patchLiveAnswer(
    messageId: string,
    patch: Partial<ColleagueLiveAnswer>,
    content?: (previous: string) => string,
  ): void {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId && message.liveAnswer
          ? {
              ...message,
              content: content ? content(message.content ?? '') : message.content,
              liveAnswer: { ...message.liveAnswer, ...patch },
            }
          : message,
      ),
    }))
  }

  /**
   * 自由提问 → Copilot 流式回合（真实模型；可选模型与网页搜索）。
   *
   * 问答模型判断「这句话其实是要做事」时只回交接标记，这里转交操作执行器（`allowHandoff`：
   * 执行器已判定不是操作后转来的问答传 false，避免两边来回推）；回答指明唯一页面时自动打开。
   */
  async function runLiveAnswer(
    text: string,
    context: ColleagueContext,
    options: { modelText?: string; allowHandoff?: boolean } = {},
  ): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    const allowHandoff = options.allowHandoff !== false
    const { modelPreference, webSearchEnabled, sessionId } = get()
    const placeholderId = createMessageId()
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: placeholderId,
          sender: 'assistant',
          content: '',
          timestamp: Date.now(),
          liveAnswer: {
            status: 'streaming',
            modelLabel: modelPreference?.label ?? null,
            webSearchRequested: webSearchEnabled,
            projectId: context.currentProjectId,
          },
        },
      ],
      executionState: 'thinking',
    }))

    const projectId = context.currentProjectId
    let terminal = false
    // 模型原文（含交接标记）；界面只显示去掉标记后的正文
    let raw = ''
    let handoffRequested = false
    const onEvent = (event: CopilotStreamEvent) => {
      if (scopeEpoch !== colleagueScopeEpoch) return
      switch (event.type) {
        case 'turn-meta':
          set({ sessionId: event.sessionId })
          break
        case 'answer-delta':
          raw += event.delta
          patchLiveAnswer(
            placeholderId,
            {},
            () => parseColleagueAnswerDirectives(raw, { streaming: true }).text,
          )
          break
        case 'answer-done': {
          terminal = true
          const directives = parseColleagueAnswerDirectives(raw.trim() ? raw : event.contentSummary)
          if (directives.handoff && allowHandoff) {
            handoffRequested = true
            break
          }
          patchLiveAnswer(
            placeholderId,
            {
              status: 'done',
              webSearchNote: event.webSearchStatus?.message ?? null,
              autoOpenPath: directives.openPath,
            },
            () =>
              directives.text ||
              (directives.handoff
                ? '这句话我没能理解成可以执行的操作。可以把要操作的对象说具体一些，例如「把 PROJ-4#226 取消指派」「带我去 AI 连接」。'
                : ''),
          )
          break
        }
        case 'turn-clarify':
          terminal = true
          patchLiveAnswer(placeholderId, { status: 'done' }, () =>
            [
              '需要再确认几点：',
              ...event.items.map((item, index) => `${index + 1}. ${item.question}`),
            ].join('\n'),
          )
          break
        case 'turn-route':
          terminal = true
          // 问答分类器认为该进业务流程（如「创建项目」）：AI 同事直接交给执行器去做
          if (allowHandoff) {
            handoffRequested = true
            break
          }
          patchLiveAnswer(placeholderId, { status: 'done' }, () =>
            event.destinations.length > 0
              ? `这件事需要在「${event.destinations
                  .map(
                    (d) =>
                      COPILOT_DESTINATION_REGISTRY[d.destination as CopilotDestination]?.label ??
                      d.destination,
                  )
                  .join(
                    '、',
                  )}」里完成。可以直接对我说具体要做什么，例如「帮我生成一个校园演唱会项目」。`
              : COLLEAGUE_FALLBACK_TEXT,
          )
          break
        case 'turn-error':
          terminal = true
          patchLiveAnswer(placeholderId, {
            status: 'error',
            errorMessage: describeLiveFailure(event.errorKind, undefined, event.degradedReason),
            errorKind: event.errorKind,
          })
          break
      }
    }

    try {
      await copilotApi.submitTurnStream(
        {
          sessionId,
          scope: projectId ? 'project' : 'global',
          attribution: projectId ? { projectId: String(projectId) } : {},
          text: options.modelText ?? text,
          mentions: [],
          ...(projectId ? { pageContext: colleaguePageContext(context) } : {}),
          ...(modelPreference
            ? {
                modelPreference: {
                  connectionId: modelPreference.connectionId,
                  modelId: modelPreference.modelId,
                  reason: 'user_selected',
                },
              }
            : {}),
          webSearchConsent: webSearchEnabled,
          appNavigation: buildColleagueAppMap(contextCan(context)),
          uiPreferences: buildColleagueUiPreferences(),
          currentRoute: currentRouteOf(context),
          ...(allowHandoff ? {} : { colleagueHandoff: false }),
          ...pageTextForAnswer(),
        },
        { onEvent },
      )
      if (scopeEpoch !== colleagueScopeEpoch) return
      if (handoffRequested) {
        // 交给操作执行器：去掉这条问答占位，按操作理解原话
        set((state) => ({
          messages: state.messages.filter((message) => message.id !== placeholderId),
          executionState: 'idle',
        }))
        await runActionPlan(text, context)
        if (scopeEpoch !== colleagueScopeEpoch) return
        return
      }
      if (!terminal) patchLiveAnswer(placeholderId, { status: 'done' })
      set({ executionState: 'idle' })
    } catch (error) {
      if (scopeEpoch !== colleagueScopeEpoch) return
      const status = (error as { status?: number }).status
      const errorKind = isAiConnectionRequiredError(error)
        ? AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND
        : undefined
      patchLiveAnswer(placeholderId, {
        status: 'error',
        errorMessage: describeLiveFailure(errorKind, status),
        errorKind,
      })
      set({ executionState: 'idle' })
    }
  }

  /** 问答通道带上的页面语境（可见文字 + 同一页面的截图描述）。 */
  function pageTextForAnswer(): { pageVisibleText?: string; pageVisualDescription?: string } {
    let visible = ''
    try {
      visible = capturePageText()
    } catch {
      visible = ''
    }
    const vision = get().pageVision
    return {
      ...(visible ? { pageVisibleText: visible } : {}),
      ...(vision && vision.route === currentPageRoute()
        ? { pageVisualDescription: vision.description }
        : {}),
    }
  }

  /** 当前分页快照（放进 conversations 之前）。 */
  function snapshotCurrent(): ColleagueConversation {
    const { messages, conversationId, sessionId } = rawGet()
    return {
      id: conversationId,
      title: conversationTitleOf(messages),
      messages: messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
      sessionId,
      updatedAt: Date.now(),
    }
  }

  /**
   * 把当前分页收进 conversations（离开当前分页前调用）。
   * 空对话只在它仍是打开的分页时保留（像浏览器的空白分页），不会出现在历史里。
   */
  function stashCurrent(openTabIds: string[]): ColleagueConversation[] {
    const current = snapshotCurrent()
    // 离开的分页若还在回答 / 停在待确认，把运行现场留下，切回来原样恢复
    const state = rawGet()
    if (
      isWorking(state.executionState) ||
      state.pendingAction ||
      state.pendingTriz ||
      state.actionQueue
    ) {
      backgroundRuntime.set(current.id, {
        executionState: state.executionState,
        pendingAction: state.pendingAction,
        pendingTriz: state.pendingTriz,
        actionQueue: state.actionQueue,
        sessionId: state.sessionId,
        context: state.context,
      })
    }
    const rest = state.conversations.filter((c) => c.id !== current.id)
    // 正在后台回答的对话即使还没有消息也保留（它的输出要写回来）
    const keep =
      current.messages.length > 0 ||
      openTabIds.includes(current.id) ||
      runConversationId === current.id
    return keep ? [current, ...rest] : rest
  }

  function persist(): void {
    const state = rawGet()
    const current = snapshotCurrent()
    const all = [current, ...state.conversations.filter((c) => c.id !== current.id)]
      // 已关闭的空对话没有保留价值
      .filter((c) => c.messages.length > 0 || state.openTabIds.includes(c.id))
      .slice(0, MAX_CONVERSATIONS)
    saveHistory({
      conversations: all,
      openTabIds: state.openTabIds,
      activeId: state.conversationId,
      modelPreference: state.modelPreference,
    })
  }

  function activate(
    target: ColleagueConversation,
    conversations: ColleagueConversation[],
    openTabIds: string[],
  ) {
    // 切回正在后台回答 / 停在待确认的对话：恢复它的运行现场
    const runtime = backgroundRuntime.get(target.id)
    backgroundRuntime.delete(target.id)
    rawSet({
      conversations: conversations.filter((c) => c.id !== target.id),
      openTabIds,
      conversationId: target.id,
      sessionId: runtime?.sessionId ?? target.sessionId,
      messages: target.messages,
      pendingAction: runtime?.pendingAction ?? null,
      pendingTriz: runtime?.pendingTriz ?? null,
      actionQueue: runtime?.actionQueue ?? null,
      executionState: runtime?.executionState ?? 'idle',
      ...(runtime?.context ? { context: runtime.context } : {}),
      suggestions: [],
    })
    syncRun()
  }

  // ── 矛盾求解卡组（W5）内部件 ──────────────────────────────────────────

  function patchTrizRun(messageId: string, patch: Partial<ColleagueTrizRun>): void {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId && message.trizRun
          ? { ...message, trizRun: { ...message.trizRun, ...patch } }
          : message,
      ),
    }))
  }

  function findTrizRun(messageId: string): ColleagueTrizRun | null {
    return get().messages.find((message) => message.id === messageId)?.trizRun ?? null
  }

  /** 最近一条仍在等待澄清回答的运行（自由文本回答据此路由，避免落成未识别回退）。 */
  function findActiveClarifyingTrizRun(): { messageId: string; run: ColleagueTrizRun } | null {
    for (const message of [...get().messages].reverse()) {
      if (message.trizRun?.phase === 'clarifying') {
        return { messageId: message.id, run: message.trizRun }
      }
    }
    return null
  }

  /** 展示层权限判定（真正的门在服务端）：超管 / `system:admin` 哨兵放行，其余按权限码。 */
  function hasColleaguePermission(permission: string): boolean {
    const context = get().context
    if (!context) return false
    if (context.isSuperAdmin) return true
    const permissions = context.permissions
    if (!permissions) return false
    if (permissions.includes('system:admin')) return true
    return permissions.includes(permission)
  }

  /** 作废排程待确认预览（被矛盾落库预览取代时调用，RL-01 唯一可确认卡）。 */
  function supersedePendingAction(): void {
    const pending = get().pendingAction
    if (!pending) return
    const messageId = findPendingMessageId(pending)
    if (messageId) {
      patchToolExecution(messageId, {
        status: 'cancelled',
        cancelNote: PREVIEW_SUPERSEDED_TEXT,
      })
    }
    set({ pendingAction: null })
  }

  /** 作废矛盾落库待确认预览（被新的写操作取代时调用）。 */
  function supersedePendingTriz(): void {
    const pending = get().pendingTriz
    if (!pending) return
    patchTrizRun(pending.messageId, {
      phase: 'cancelled',
      previewToken: null,
      receipt: null,
      error: { code: 'PREVIEW_SUPERSEDED', message: PREVIEW_SUPERSEDED_TEXT },
    })
    set({ pendingTriz: null })
  }

  /**
   * 受理并求解公共路径（受理与澄清链共用）：调用 `/triz-copilot/analyses`，
   * 按澄清状态落定阶段 —— 追问中（clarifying）/ 触顶（exhausted）/ 直接出方案（solved）。
   */
  async function runTrizSolve(args: {
    placeholderId: string
    projectId: number
    statement: string
    parentAnalysisId: number | null
    sourceSignalId?: number | null
  }): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    const { placeholderId, projectId, statement, parentAnalysisId, sourceSignalId } = args
    set({ executionState: 'executing' })
    try {
      const envelope = await trizCopilotApi.solve(projectId, {
        statement,
        ...(parentAnalysisId === null ? {} : { parentAnalysisId }),
        ...(typeof sourceSignalId === 'number' && sourceSignalId > 0 ? { sourceSignalId } : {}),
      })
      if (scopeEpoch !== colleagueScopeEpoch) return
      const data = envelope.data
      const clarification = data.clarification
      const phase: ColleagueTrizPhase = clarification.exhausted
        ? 'exhausted'
        : clarification.asked
          ? 'clarifying'
          : 'solved'
      patchTrizRun(placeholderId, {
        phase,
        statement,
        analysisId: data.id,
        parentAnalysisId: data.parentAnalysisId ?? parentAnalysisId,
        contradictionType: data.contradictionType,
        contradictionTypeLabel: data.contradictionTypeLabel,
        mapping: resolveTrizMappingView(data, data.mapping),
        solutions: Array.isArray(data.solutions) ? data.solutions : [],
        excludedPrincipleNumbers: trizExcludedPrincipleNumbers(data),
        path: data.path,
        confidence: data.confidence,
        clarificationRound: clarification.round,
        maxClarificationRounds: clarification.maxRounds,
        clarificationPrompt: clarification.prompt,
        clarificationReason: clarification.reason,
        budgetState: data.budget?.state ?? 'within_budget',
        budgetReason: data.budget?.reason ?? null,
        humanOverride: Boolean(data.humanOverride),
        error: null,
      })
      set({ executionState: 'idle' })
    } catch (error) {
      if (scopeEpoch !== colleagueScopeEpoch) return
      const mapped = toColleagueError(error)
      patchTrizRun(placeholderId, { phase: 'error', error: mapped })
      set({ executionState: 'error' })
    }
  }

  /**
   * 对一条信号发起矛盾求解（信号卡交接与手动输入信号编号共用）：
   * 取暂存或按编号查信号 → 已处理 / 查不到如实说明 → 用大白话陈述受理求解。
   */
  async function runSignalSolve(request: {
    signalId: number
    projectCode: string | null
  }): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    if (!hasColleaguePermission(TRIZ_TRIGGER_PERMISSION)) {
      appendAssistant(TRIZ_SOLVE_PERMISSION_DENIED_TEXT)
      set({ executionState: 'idle' })
      return
    }
    let signal = signalSolveCache.get(request.signalId) ?? null
    signalSolveCache.delete(request.signalId)
    if (!signal) {
      const organizationId = Number(selectEffectiveOrganizationId(useAuthStore.getState()))
      if (Number.isInteger(organizationId) && organizationId > 0) {
        try {
          const envelope = await organizationSignalsApi.list(organizationId, {
            signalId: request.signalId,
            status: 'all',
            perPage: 1,
          })
          signal = envelope.data.find((entry) => entry.id === request.signalId) ?? null
        } catch {
          signal = null
        }
        if (scopeEpoch !== colleagueScopeEpoch) return
      }
    }
    const code = signal ? signalCodeOf(signal) : `${request.projectCode ?? ''}#S${request.signalId}`
    if (!signal) {
      appendAssistant(`找不到信号 ${code}，或当前账号没有查看它的权限。`)
      set({ executionState: 'idle' })
      return
    }
    if (signal.status !== 'open') {
      appendAssistant(
        `信号 ${code} ${SIGNAL_CLOSED_TEXT[signal.status] ?? '已关闭'}，不需要再求解。`,
      )
      set({ executionState: 'idle' })
      return
    }
    const statement = buildSignalSolverStatement(signal)
    const placeholderId = appendAssistant(
      undefined,
      undefined,
      newTrizRun(
        {
          projectId: signal.projectId,
          sourceSignalId: signal.id,
          sourceSignalCode: code,
          sourceSignalType: signal.signalType,
        },
        statement,
      ),
    )
    await runTrizSolve({
      placeholderId,
      projectId: signal.projectId,
      statement,
      parentAnalysisId: null,
      sourceSignalId: signal.id,
    })
  }

  /** 澄清链续轮：新增一条运行消息，携带上一轮分析记录 ID（预算在服务端继承）。 */
  async function runTrizClarification(
    previousMessageId: string,
    previousRun: ColleagueTrizRun,
    answer: string,
  ): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    patchTrizRun(previousMessageId, { phase: 'answered', clarificationPrompt: null })
    const placeholderId = appendAssistant(
      undefined,
      undefined,
      newTrizRun(
        {
          projectId: previousRun.projectId,
          parentAnalysisId: previousRun.analysisId,
          sourceSignalId: previousRun.sourceSignalId,
          sourceSignalCode: previousRun.sourceSignalCode,
          sourceSignalType: previousRun.sourceSignalType,
        },
        answer,
      ),
    )
    await runTrizSolve({
      placeholderId,
      projectId: previousRun.projectId,
      statement: answer,
      parentAnalysisId: previousRun.analysisId,
      sourceSignalId: previousRun.sourceSignalId,
    })
    if (scopeEpoch !== colleagueScopeEpoch) return
  }

  /** 新建运行态骨架（默认全部未决，避免卡片读到半截状态）。 */
  function newTrizRun(
    seed: {
      projectId: number
      parentAnalysisId?: number | null
      sourceSignalId?: number | null
      sourceSignalCode?: string | null
      sourceSignalType?: string | null
    },
    statement: string,
  ): ColleagueTrizRun {
    return {
      phase: 'clarifying',
      projectId: seed.projectId,
      sourceSignalId: seed.sourceSignalId ?? null,
      sourceSignalCode: seed.sourceSignalCode ?? null,
      sourceSignalType: seed.sourceSignalType ?? null,
      statement,
      analysisId: null,
      parentAnalysisId: seed.parentAnalysisId ?? null,
      contradictionType: null,
      contradictionTypeLabel: null,
      mapping: null,
      solutions: [],
      excludedPrincipleNumbers: [],
      path: 'rule',
      confidence: 0,
      clarificationRound: 0,
      maxClarificationRounds: 2,
      clarificationPrompt: null,
      clarificationReason: null,
      budgetState: 'within_budget',
      budgetReason: null,
      humanOverride: false,
      selectedSolutionIndex: null,
      targetKind: null,
      previewToken: null,
      diff: null,
      receipt: null,
      error: null,
    }
  }

  /** 执行请求公共路径：占位消息置 executing → 调用 execute → 分发预览/成功/错误。 */
  async function runExecution(
    placeholderId: string,
    toolName: string,
    parameters: Record<string, unknown>,
  ): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    // 新的写操作开始前，作废还挂着的旧预览（RL-01：任何时刻只有一张可确认卡）
    if (isWriteToolName(toolName)) {
      const pending = get().pendingAction
      if (pending && findPendingMessageId(pending) !== placeholderId) supersedePendingAction()
      supersedePendingTriz()
    }
    set({ executionState: 'executing' })
    if (CLIENT_TOOL_NAMES.has(toolName)) {
      const startedAt = Date.now()
      try {
        const data = await runClientTool(toolName, parameters, {
          modelPreference: get().modelPreference,
          question: get().actionQueue?.userText,
        })
        if (scopeEpoch !== colleagueScopeEpoch) return
        // 看过的页面描述留给后续请求（同一页面内有效）
        if (toolName === 'capture_page') {
          set({
            pageVision: {
              description: String(data.description ?? ''),
              model: String(data.model ?? ''),
              route: String(data.route ?? ''),
            },
          })
        }
        patchToolExecution(placeholderId, {
          status: 'success',
          data,
          durationMs: Date.now() - startedAt,
        })
        set({ executionState: 'idle' })
      } catch (error) {
        if (scopeEpoch !== colleagueScopeEpoch) return
        patchToolExecution(placeholderId, { status: 'error', error: toColleagueError(error) })
        set({ executionState: 'error' })
      }
      return
    }
    try {
      const envelope: AiToolExecuteEnvelope = await aiToolsApi.execute(toolName, parameters)
      if (scopeEpoch !== colleagueScopeEpoch) return
      if (envelope.meta.status === 'PREVIEW_REQUIRED') {
        const previewToken = envelope.meta.previewToken
        if (typeof previewToken === 'string' && previewToken !== '') {
          patchToolExecution(placeholderId, {
            status: 'preview_required',
            data: envelope.data,
            diff: envelope.meta.diff,
            previewToken,
            durationMs: envelope.meta.durationMs,
          })
          set({
            pendingAction: {
              toolName,
              previewToken,
              parameters,
              diff: envelope.meta.diff,
            },
            executionState: 'awaiting_confirmation',
          })
          return
        }
        // 契约防御：PREVIEW_REQUIRED 必须携带令牌，缺省按错误失败关闭（RL-01）
        patchToolExecution(placeholderId, {
          status: 'error',
          error: { code: 'PREVIEW_TOKEN_MISSING', message: '预览令牌缺失，请重新发起操作' },
        })
        set({ executionState: 'error' })
        return
      }
      patchToolExecution(placeholderId, {
        status: 'success',
        data: envelope.data,
        durationMs: envelope.meta.durationMs,
      })
      set({ executionState: 'idle' })
    } catch (error) {
      if (scopeEpoch !== colleagueScopeEpoch) return
      patchToolExecution(placeholderId, { status: 'error', error: toColleagueError(error) })
      if (isScheduleStaleError(error)) {
        // execute 阶段即遭版本冲突：保留待确认现场供取消/重新演练——
        // 以无令牌参数快照暂存（重新演练用参数重发 execute；放弃则清现场），
        // 保证冲突卡的「重新演练/放弃」双按钮始终可用（D-write §3）。
        set({
          pendingAction: { toolName, previewToken: null, parameters, diff: null },
          executionState: 'awaiting_confirmation',
        })
        return
      }
      set({ executionState: 'error' })
    }
  }

  function patchMessageContent(messageId: string, content: string): void {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId ? { ...message, content } : message,
      ),
    }))
  }

  /**
   * 逐条执行模型理解出的操作序列：只读 / 导航直接执行；写操作生成预览后停下，
   * 等用户点「确认应用」或「放弃」（RL-01），之后由确认 / 放弃入口继续下一步。
   *
   * 多步任务（continueAfter）：本轮全部执行完后，把每一步的结果整理成观察交回模型，
   * 由它决定继续看、继续改还是给出结论（最多 COLLEAGUE_AGENT_MAX_ITERATIONS 轮）。
   * 某一步失败时停止本轮后续步骤；多步任务里把失败也交回模型，让它换个办法。
   */
  async function runNextQueuedAction(): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    for (;;) {
      const queue = get().actionQueue
      if (!queue) return
      if (queue.nextIndex >= queue.steps.length) {
        set({ actionQueue: null })
        await continueAgentRun(queue)
        if (scopeEpoch !== colleagueScopeEpoch) return
        return
      }
      const index = queue.nextIndex
      const step = queue.steps[index]!
      const total = queue.steps.length

      // 一键生成：先问全自动还是我来回答（问完再执行这一步）
      if (step.toolName === 'start_project_generation' && step.parameters.mode === undefined) {
        set({ actionQueue: null, executionState: 'idle' })
        appendGenerationModeQuestion(String(step.parameters.idea ?? ''), queue.userText)
        return
      }

      const placeholderId = appendAssistant(undefined, {
        toolName: step.toolName,
        intentSource: 'llm_inference',
        status: 'executing',
        parameters: step.parameters,
        stepLabel: total > 1 ? `第 ${index + 1}/${total} 步 · ${step.summary}` : step.summary,
        modelLabel: queue.modelLabel,
      })
      set({
        actionQueue: {
          ...queue,
          nextIndex: index + 1,
          stepMessageIds: [...(queue.stepMessageIds ?? []), placeholderId],
        },
      })
      await runExecution(placeholderId, step.toolName, step.parameters)
      if (scopeEpoch !== colleagueScopeEpoch) return
      const state = get().executionState
      if (state === 'awaiting_confirmation') return
      if (state === 'error') {
        const remaining = total - (index + 1)
        const current = get().actionQueue
        if (current?.continueAfter) {
          // 多步任务：失败交回模型（跳过本轮剩余步骤）
          set({
            actionQueue: { ...current, nextIndex: current.steps.length },
            executionState: 'idle',
          })
          continue
        }
        if (remaining > 0) {
          appendAssistant(
            `第 ${index + 1} 步没有成功，后面的 ${remaining} 步已停止，没有继续执行。`,
          )
        }
        set({ actionQueue: null })
        return
      }
      // 多步任务里结论由模型在下一轮给出，不再另起「看过数据再给建议」的问答
      if (!queue.continueAfter) await runStepFollowUp(step, placeholderId, queue.userText)
      if (scopeEpoch !== colleagueScopeEpoch) return
    }
  }

  /** 一步动作的执行结果 → 交回模型的观察（截断）。 */
  function observationOf(step: ColleaguePlannedAction, messageId: string): ColleagueObservation {
    const execution = get().messages.find((message) => message.id === messageId)?.toolExecution
    const clip = (value: unknown) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
      return text.length > OBSERVATION_RESULT_MAX
        ? `${text.slice(0, OBSERVATION_RESULT_MAX)}…`
        : text
    }
    if (!execution)
      return { step: step.summary, tool: step.toolName, status: 'unknown', result: '' }
    const status = execution.status
    let result: string
    if (status === 'error') result = `失败：${execution.error?.message ?? '未知原因'}`
    else if (status === 'cancelled') result = execution.cancelNote ?? '用户放弃了这一步，没有修改'
    else if (status === 'committed') result = `用户已确认，已生效：${clip(execution.data)}`
    else if (step.toolName === 'capture_page') {
      result = clip((execution.data as { description?: unknown } | undefined)?.description ?? '')
    } else result = clip(execution.data)
    return { step: step.summary, tool: step.toolName, status, result }
  }

  /** 多步任务：本轮做完后带着观察结果请模型想下一步。 */
  async function continueAgentRun(queue: ColleagueActionQueue): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    if (!queue.continueAfter) return
    const context = get().context
    if (!context) return
    const iteration = queue.iteration ?? 1
    const stepIds = queue.stepMessageIds ?? []
    // 几十轮的任务观察会很多：只留最近 MAX_OBSERVATIONS 条（服务端再按新旧截断长度）
    const observations = [
      ...(queue.observations ?? []),
      ...queue.steps
        .slice(0, stepIds.length)
        .map((step, index) => observationOf(step, stepIds[index]!)),
    ].slice(-MAX_OBSERVATIONS)
    if (iteration >= COLLEAGUE_AGENT_MAX_ITERATIONS) {
      appendAssistant(
        `已经连续做了 ${iteration} 轮，先停在这里。可以告诉我接下来怎么做，或者说「继续」。`,
      )
      set({ executionState: 'idle' })
      return
    }
    await runActionPlan(queue.userText, context, { iteration: iteration + 1, observations })
    if (scopeEpoch !== colleagueScopeEpoch) return
  }

  /** 多步任务的最终答复（Markdown 气泡，与模型问答同一种呈现）。 */
  function appendFinalAnswer(answer: string, modelLabel: string | null, projectId: number | null) {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: createMessageId(),
          sender: 'assistant',
          content: answer,
          timestamp: Date.now(),
          liveAnswer: { status: 'done', modelLabel, webSearchRequested: false, projectId },
        },
      ],
    }))
  }

  /** 一键生成前的选择：全自动（代答追问、生成、审查并确认转为正式项目）或我来回答追问。 */
  function appendGenerationModeQuestion(idea: string, originalText: string) {
    // 权限先说清（不要等到最后一步才发现做不完）
    const auth = useAuthStore.getState()
    if (!auth.hasPermission('ai:trigger')) {
      appendAssistant(
        '当前账号没有使用 AI 生成项目的权限（缺少 ai:trigger），没法一键生成。请联系组织管理员开通。',
      )
      return
    }
    const canConfirm = auth.hasPermission('ai:confirm')
    const messageId = createMessageId()
    const preference = get().modelPreference
    set((state) => ({
      pendingGenerationChoice: {
        idea,
        messageId,
        canConfirm,
        modelLabel: preference?.label ?? null,
      },
      messages: [
        ...state.messages,
        {
          id: messageId,
          sender: 'assistant',
          timestamp: Date.now(),
          question: {
            kind: 'generation_mode',
            meta: { idea },
            prompt: canConfirm
              ? `准备在生成剧场生成「${idea.length > 40 ? `${idea.slice(0, 40)}…` : idea}」。要全自动完成吗（包括转为正式项目）？`
              : `准备在生成剧场生成「${idea.length > 40 ? `${idea.slice(0, 40)}…` : idea}」。先说明：当前账号没有转正权限（缺少 ai:confirm），全自动只能做到生成并修正草案，转为正式项目要请有权限的人确认。要全自动吗？`,
            options: [
              canConfirm ? GENERATION_MODE_AUTO : GENERATION_MODE_AUTO_NO_CONFIRM,
              GENERATION_MODE_MANUAL,
            ],
            originalText,
            status: 'open',
          },
        },
      ],
    }))
  }

  /** 按选好的模式执行一键生成（全自动 / 手动都会把剧场的追问与进度联动到对话里）。 */
  async function startGenerationWithMode(idea: string, mode: 'auto' | 'manual') {
    const scopeEpoch = colleagueScopeEpoch
    set({ theaterLink: { mode } })
    const placeholderId = appendAssistant(undefined, {
      toolName: 'start_project_generation',
      intentSource: 'llm_inference',
      status: 'executing',
      parameters: { idea, mode },
      stepLabel: mode === 'auto' ? '全自动生成并转为正式项目' : '打开生成剧场（你来回答追问）',
    })
    await runExecution(placeholderId, 'start_project_generation', { idea, mode })
    if (scopeEpoch !== colleagueScopeEpoch) return
    if (get().executionState === 'error') set({ theaterLink: null })
  }

  /**
   * 步骤执行后的「看过数据再给建议」：
   * - 「我的工作」要排优先级：把清单交给模型，按顺序给出先做哪几项、理由与下一步（带可点链接）；
   * - 全域搜索命中多条且没有直达：让模型结合原话推荐最可能要找的几条，不确定就反问。
   * 都走问答通道（只读，不改数据）。
   */
  async function runStepFollowUp(
    step: ColleaguePlannedAction,
    messageId: string,
    userText: string,
  ): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    const execution = get().messages.find((message) => message.id === messageId)?.toolExecution
    if (!execution || execution.status !== 'success') return
    const data = execution.data as Record<string, unknown> | undefined
    const context = get().context
    if (!data || !context) return

    if (step.toolName === 'get_my_work' && step.followUp === 'prioritize') {
      const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : []
      if (items.length === 0) return
      const compact = items.slice(0, 20).map((item, index) => ({
        n: index + 1,
        code: item.code,
        name: item.name,
        project: (item.project as { name?: string } | undefined)?.name,
        status: item.statusLabel,
        due: item.endDate,
        dueState: item.dueState,
        overdueDays: item.overdueDays,
        priority: item.priority,
        path: item.path,
      }))
      await runLiveAnswer(userText, context, {
        allowHandoff: false,
        modelText: [
          `我的原话：「${userText}」。`,
          `下面是我负责、还没完成的工作（今天 ${String(data.today ?? '')}，已按逾期 → 今天到期 → 受阻 → 优先级排好）。`,
          '请给出今天的优先级建议：按顺序列出先做哪几项，每项一句理由和具体下一步怎么做；用 Markdown 链接 [编号 名称](path) 让我能直接打开。',
          '如果明显做不完，指出哪些可以延期或调整，并提醒我可以直接对你说「把第 N 个延到明天」「第 N 个标为完成」。',
          `清单：${JSON.stringify(compact)}`,
        ].join('\n'),
      })
      if (scopeEpoch !== colleagueScopeEpoch) return
      return
    }

    if (step.toolName === 'search_global_entities') {
      const results = Array.isArray(data.results) ? (data.results as SearchResultItem[]) : []
      if (results.length < 2 || typeof data.openPath === 'string') return
      const compact = results.slice(0, 15).map((item) => ({
        type: item.entityType,
        title: item.title,
        code: item.metadata?.code,
        project: item.metadata?.projectName,
        status: item.status,
        updatedAt: item.updatedAt,
        path: resolveEntityDirectUrl(item),
      }))
      await runLiveAnswer(userText, context, {
        allowHandoff: false,
        modelText: [
          `我的原话：「${userText}」。全域搜索「${String(data.keyword ?? '')}」找到 ${results.length} 条结果（见下）。`,
          '请结合我的原话判断我最可能要找的是哪几条：推荐最多 3 条，每条一句理由，用 Markdown 链接 [标题](path) 让我能直接打开；如果确实无法判断，用一个简短问题问我来缩小范围。',
          `结果：${JSON.stringify(compact)}`,
        ].join('\n'),
      })
      if (scopeEpoch !== colleagueScopeEpoch) return
    }
  }

  /** 让模型把一句话理解成操作序列；不是操作（提问 / 闲聊）时改走模型问答。 */
  /** 最近一张「我的工作」清单的显示顺序（让「第 2 个」有指代对象）。 */
  function lastListedTaskIds(): number[] {
    for (const message of [...get().messages].reverse()) {
      const execution = message.toolExecution
      if (execution?.toolName !== 'get_my_work' || execution.status !== 'success') continue
      const items = (execution.data as { items?: { id?: unknown }[] } | undefined)?.items
      return Array.isArray(items)
        ? items
            .map((item) => Number(item.id))
            .filter((id) => Number.isInteger(id) && id > 0)
            .slice(0, 50)
        : []
    }
    return []
  }

  /** 最近几轮对话的纯文字（不含当前这句；卡片类消息只取摘要）。 */
  function recentConversation(currentText: string): { role: 'user' | 'assistant'; text: string }[] {
    const turns: { role: 'user' | 'assistant'; text: string }[] = []
    for (const message of get().messages) {
      const text =
        message.content?.trim() ||
        message.toolExecution?.stepLabel ||
        message.question?.prompt ||
        ''
      if (!text || text === '正在理解你的指令…') continue
      turns.push({ role: message.sender, text: text.slice(0, 300) })
    }
    // 最后一条是刚发出的这句原话，不重复给
    if (turns.at(-1)?.role === 'user' && turns.at(-1)?.text === currentText.slice(0, 300)) {
      turns.pop()
    }
    return turns.slice(-PLANNER_CONVERSATION_TURNS)
  }

  /** 交给模型的页面语境：可见文字（每次都带）+ 截图描述（看过且仍在同一页面时带）。 */
  function pageSnapshotFor(context: ColleagueContext): ColleaguePageSnapshot {
    const route = currentRouteOf(context) ?? currentPageRoute()
    const vision = get().pageVision
    let visibleText = ''
    try {
      visibleText = capturePageText()
    } catch {
      visibleText = ''
    }
    return {
      ...(route ? { route } : {}),
      ...(typeof document !== 'undefined' && document.title ? { title: document.title } : {}),
      ...(visibleText ? { visibleText } : {}),
      ...(vision && vision.route === currentPageRoute()
        ? { visualDescription: vision.description }
        : {}),
    }
  }

  /**
   * 让模型把一句话理解成操作序列并执行；不是操作（纯提问 / 闲聊）时改走模型问答。
   * 多步任务：`agent` 带着前几轮的观察结果再请模型想下一步，直到它给出结论。
   */
  async function runActionPlan(
    text: string,
    context: ColleagueContext,
    agent: { iteration: number; observations: ColleagueObservation[] } = {
      iteration: 1,
      observations: [],
    },
  ): Promise<void> {
    const scopeEpoch = colleagueScopeEpoch
    const projectId = context.currentProjectId
    const { modelPreference } = get()
    const noteId = appendAssistant(
      agent.iteration > 1
        ? `正在根据结果想下一步（第 ${agent.iteration} 轮）…`
        : '正在理解你的指令…',
    )
    set({ executionState: 'thinking' })
    let plan
    try {
      plan = await aiToolsApi.plan({
        projectId: projectId ?? null,
        text,
        appDestinations: buildColleagueAppMap(contextCan(context)),
        uiPreferences: buildColleagueUiPreferences(),
        recentTaskIds: lastListedTaskIds(),
        conversation: recentConversation(text),
        page: pageSnapshotFor(context),
        ...(agent.observations.length > 0
          ? { observations: agent.observations, iteration: agent.iteration }
          : {}),
        ...(focusedTaskId() !== null ? { selectedTaskId: focusedTaskId()! } : {}),
        ...(modelPreference
          ? {
              modelPreference: {
                connectionId: modelPreference.connectionId,
                modelId: modelPreference.modelId,
              },
            }
          : {}),
      })
      if (scopeEpoch !== colleagueScopeEpoch) return
    } catch (error) {
      if (scopeEpoch !== colleagueScopeEpoch) return
      const mapped = toColleagueError(error)
      patchMessageContent(
        noteId,
        mapped.status === 403
          ? '当前账号没有在这个项目里使用 AI 操作任务的权限，本次没有做任何修改。'
          : `暂时没能理解这条指令（${mapped.message}），本次没有做任何修改。可以换个说法，或用下方快捷入口。`,
      )
      set({ executionState: 'idle' })
      return
    }

    // 用本轮用户选择决定显示，默认徽标不显示服务端内部路由名称。
    const modelLabel =
      [
        modelPreference ? modelPreference.label : '组织默认模型',
        plan.toolCallingMode ? TOOL_CALLING_MODE_SHORT[plan.toolCallingMode] : null,
      ]
        .filter(Boolean)
        .join(' · ') || null
    const answer = plan.answer?.trim() || null

    if (!plan.isAction) {
      set((state) => ({ messages: state.messages.filter((message) => message.id !== noteId) }))
      if (agent.iteration > 1) {
        // 多步任务的最后一轮：给出结论
        appendFinalAnswer(answer ?? plan.reply ?? '都处理完了。', modelLabel, projectId)
        set({ executionState: 'idle' })
        return
      }
      // 不是操作指令：按普通提问交给模型回答（问答通道带项目事实与网页搜索）
      await runLiveAnswer(text, context, { allowHandoff: false })
      if (scopeEpoch !== colleagueScopeEpoch) return
      return
    }

    const lines: string[] = []
    if (plan.fallbackReason && plan.requestedToolCallingMode && agent.iteration === 1) {
      // 默认模型的供应商错误可能含模型名，UI 仅保留通用说明和状态码。
      const status = plan.fallbackReason.match(/\bHTTP (\d{3})\b/)?.[1]
      const fallbackReason = modelPreference
        ? plan.fallbackReason
        : `原生工具调用失败${status ? `（HTTP ${status}）` : ''}`
      lines.push(
        `⚠️ 「${AI_TOOL_CALLING_MODE_LABELS[plan.requestedToolCallingMode]}」这次没能用上（${fallbackReason}），已改用「${AI_TOOL_CALLING_MODE_LABELS.prompt_json}」。`,
      )
    }
    if (plan.reply) lines.push(plan.reply)
    if (plan.actions.length > 1) {
      lines.push(
        '我会按顺序做：',
        ...plan.actions.map((action, index) => `${index + 1}. ${action.summary}`),
      )
    }
    if (plan.actions.some((action) => isWriteToolName(action.toolName))) {
      lines.push('涉及修改的每一步都会先给你看变更，点「确认应用」才会生效。')
    }
    for (const note of plan.rejected) lines.push(`⚠️ ${note}`)
    if (plan.clarification) {
      // 追问以卡片呈现：候选答案可点选，最后一项可自己输入
      appendQuestion(plan.clarification, plan.clarificationOptions ?? [], text)
    }
    if (plan.actions.length === 0 && lines.length === 0 && !plan.clarification && !answer) {
      lines.push(
        '没有识别出可以执行的操作，本次没有做任何修改。可以说得更具体一些，例如「把任务 12 标为已完成」。',
      )
    }
    if (lines.length > 0) {
      patchMessageContent(noteId, lines.join('\n'))
    } else {
      set((state) => ({ messages: state.messages.filter((message) => message.id !== noteId) }))
    }
    if (answer && plan.actions.length === 0) appendFinalAnswer(answer, modelLabel, projectId)

    if (plan.actions.length === 0) {
      set({ executionState: 'idle' })
      return
    }
    set({
      actionQueue: {
        userText: text,
        steps: plan.actions,
        nextIndex: 0,
        modelLabel,
        iteration: agent.iteration,
        continueAfter: plan.continue === true,
        observations: agent.observations,
        stepMessageIds: [],
      },
      executionState: 'idle',
    })
    await runNextQueuedAction()
    if (scopeEpoch !== colleagueScopeEpoch) return
  }

  const initialHistory = loadHistory()
  const initialTabs = restoreTabs(initialHistory)

  return {
    isOpen: false,
    executionState: 'idle',
    messages: initialTabs.messages,
    pendingAction: null,
    pendingTriz: null,
    actionQueue: null,
    context: null,
    conversationId: initialTabs.conversationId,
    sessionId: initialTabs.sessionId,
    conversations: initialTabs.conversations,
    openTabIds: initialTabs.openTabIds,
    modelPreference: initialHistory.modelPreference,
    webSearchEnabled: false,
    pageVision: null,
    suggestions: [],
    theaterLink: null,
    pendingGenerationChoice: null,
    backgroundRunId: null,
    queuedMessage: null,

    cancelQueuedMessage: () => rawSet({ queuedMessage: null }),

    attachPageVision: async () => {
      const scopeEpoch = colleagueScopeEpoch
      // 有一轮正在回答（任一分页）时不另起执行
      syncRun()
      if (runConversationId !== null || isWorking(rawGet().executionState)) return
      const placeholderId = appendAssistant(undefined, {
        toolName: 'capture_page',
        intentSource: 'rule_preset',
        status: 'executing',
        parameters: {},
        stepLabel: '看一眼当前页面',
      })
      await runExecution(placeholderId, 'capture_page', {})
      if (scopeEpoch !== colleagueScopeEpoch) return
      if (get().executionState === 'error') set({ executionState: 'idle' })
    },

    clearPageVision: () => set({ pageVision: null }),

    refreshSuggestions: async (draft) => {
      const scopeEpoch = colleagueScopeEpoch
      // 另一段对话正在后台回答：预填建议依赖当前分页的对话，等它结束再算
      if (routingToBackground()) return
      const { messages, modelPreference, conversationId } = get()
      const conversation = recentConversation('')
      if (conversation.length === 0) {
        set({ suggestions: [] })
        return
      }
      const key = `${conversationId}:${messages.length}:${draft ?? ''}`
      suggestionKey = key
      const open = findOpenQuestion()
      let suggestions: string[] = []
      try {
        suggestions = await aiToolsApi.suggestReplies({
          conversation,
          ...(open ? { question: open.question.prompt, options: open.question.options } : {}),
          ...(draft ? { draft } : {}),
          ...(modelPreference
            ? { connectionId: modelPreference.connectionId, modelId: modelPreference.modelId }
            : {}),
        })
        if (scopeEpoch !== colleagueScopeEpoch) return
      } catch {
        if (scopeEpoch !== colleagueScopeEpoch) return
        suggestions = []
      }
      // 期间对话又变了：这批建议已经过时
      if (suggestionKey !== key) return
      set({ suggestions })
    },

    clearSuggestions: () => {
      suggestionKey = null
      set({ suggestions: [] })
    },

    relayTheaterCard: (card) => {
      const exists = get().messages.some(
        (message) =>
          message.question?.kind === 'theater_card' &&
          message.question.meta?.cardId === card.cardId,
      )
      if (exists) return
      set((state) => ({
        isOpen: true,
        messages: [
          ...state.messages,
          {
            id: createMessageId(),
            sender: 'assistant',
            timestamp: Date.now(),
            question: {
              kind: 'theater_card',
              meta: { cardId: card.cardId },
              prompt: theaterCardPrompt(card),
              options: theaterCardOptions(card),
              originalText: '',
              status: 'open',
            },
          },
        ],
      }))
    },

    noteTheaterEvent: (text) => {
      appendAssistant(text)
    },

    endTheaterLink: () => set({ theaterLink: null }),

    chooseGenerationMode: async (choice) => {
      const scopeEpoch = colleagueScopeEpoch
      const pending = get().pendingGenerationChoice
      if (!pending) return
      set({ pendingGenerationChoice: null })
      const label =
        choice === 'auto'
          ? pending.canConfirm
            ? GENERATION_MODE_AUTO
            : GENERATION_MODE_AUTO_NO_CONFIRM
          : choice === 'manual'
            ? GENERATION_MODE_MANUAL
            : '先不生成'
      patchQuestion(pending.messageId, {
        status: choice === 'cancel' ? 'skipped' : 'answered',
        answer: label,
      })
      set((state) => ({
        messages: [
          ...state.messages,
          { id: createMessageId(), sender: 'user', content: label, timestamp: Date.now() },
        ],
      }))
      if (choice === 'cancel') {
        appendAssistant('好的，先不生成。需要时再告诉我。')
        return
      }
      await startGenerationWithMode(pending.idea, choice)
      if (scopeEpoch !== colleagueScopeEpoch) return
    },

    stopAutopilot: () => {
      if (get().theaterLink?.mode !== 'auto') return
      set({ theaterLink: null })
      useAiProjectDraftStore.getState().setAutoPilot(false)
      appendAssistant(
        '已停止全自动：后面的追问、审查与转正改由你在 [生成剧场](/next/create) 里处理。',
      )
    },

    settleTheaterQuestions: (liveCardIds) => {
      const live = new Set(liveCardIds)
      const stale = get().messages.some(
        (message) =>
          message.question?.kind === 'theater_card' &&
          message.question.status === 'open' &&
          !live.has(message.question.meta?.cardId ?? ''),
      )
      if (!stale) return
      set((state) => ({
        messages: state.messages.map((message) =>
          message.question?.kind === 'theater_card' &&
          message.question.status === 'open' &&
          !live.has(message.question.meta?.cardId ?? '')
            ? {
                ...message,
                question: { ...message.question, status: 'skipped', answer: '已在生成剧场里回答' },
              }
            : message,
        ),
      }))
    },

    newConversation: () => {
      const { messages, conversationId, openTabIds } = rawGet()
      if (messages.length === 0) return // 当前已是空白分页
      if (openTabIds.length >= MAX_OPEN_TABS) return
      const fresh = createConversationId()
      const at = openTabIds.indexOf(conversationId)
      const nextTabs = [...openTabIds]
      nextTabs.splice(at < 0 ? nextTabs.length : at + 1, 0, fresh)
      const conversations = stashCurrent(nextTabs)
      activate(
        { id: fresh, title: '新对话', messages: [], sessionId: null, updatedAt: Date.now() },
        conversations,
        nextTabs,
      )
      persist()
    },

    switchConversation: (targetId) => {
      const { conversationId, openTabIds, conversations } = rawGet()
      if (targetId === conversationId) return
      const target = conversations.find((c) => c.id === targetId)
      if (!target) return
      // 从历史重新打开：加到分页栏末尾（满了就挤掉最左边的非当前分页）
      let nextTabs = openTabIds.includes(targetId) ? [...openTabIds] : [...openTabIds, targetId]
      // 离开的是空白分页：像浏览器一样保留它（除非是从历史打开时顺手替换掉它）
      const leavingEmpty = rawGet().messages.length === 0 && runConversationId !== conversationId
      if (leavingEmpty && !openTabIds.includes(targetId)) {
        nextTabs = nextTabs.filter((id) => id !== conversationId)
      }
      while (nextTabs.length > MAX_OPEN_TABS) {
        // 挤掉分页时不挤正在回答的那段对话
        const drop =
          nextTabs.find((id) => id !== targetId && id !== runConversationId) ??
          nextTabs.find((id) => id !== targetId)
        nextTabs = nextTabs.filter((id) => id !== drop)
      }
      activate(target, stashCurrent(nextTabs), nextTabs)
      persist()
    },

    closeConversationTab: (targetId) => {
      const { conversationId, openTabIds, conversations } = rawGet()
      const index = openTabIds.indexOf(targetId)
      if (index < 0) return
      const nextTabs = openTabIds.filter((id) => id !== targetId)
      if (targetId !== conversationId) {
        // 关后台分页：空对话直接丢弃，否则留在历史
        rawSet({
          openTabIds: nextTabs,
          conversations: conversations.filter(
            (c) => c.id !== targetId || c.messages.length > 0 || c.id === runConversationId,
          ),
        })
        persist()
        return
      }
      // 关当前分页：切到右侧（没有则左侧）分页；一个都不剩就开一个空白分页
      const stashed = stashCurrent(nextTabs)
      const neighborId = openTabIds[index + 1] ?? openTabIds[index - 1]
      const neighbor = neighborId ? stashed.find((c) => c.id === neighborId) : undefined
      if (neighbor) {
        activate(neighbor, stashed, nextTabs)
      } else {
        const fresh = createConversationId()
        activate(
          { id: fresh, title: '新对话', messages: [], sessionId: null, updatedAt: Date.now() },
          stashed,
          [fresh],
        )
      }
      persist()
    },

    deleteConversation: (targetId) => {
      // 删的是当前分页：先按关闭分页切走，它随之变成后台对话，再一并删掉
      if (targetId === rawGet().conversationId) {
        rawGet().closeConversationTab(targetId)
      }
      backgroundRuntime.delete(targetId)
      rawSet({
        conversations: rawGet().conversations.filter((c) => c.id !== targetId),
        openTabIds: rawGet().openTabIds.filter((id) => id !== targetId),
        ...(rawGet().queuedMessage?.conversationId === targetId ? { queuedMessage: null } : {}),
      })
      syncRun()
      persist()
    },

    setModelPreference: (preference) => {
      set({ modelPreference: preference })
      persist()
    },

    setWebSearchEnabled: (enabled) => set({ webSearchEnabled: enabled }),

    openPanel: () => set({ isOpen: true }),
    closePanel: () => set({ isOpen: false }),
    toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

    submitUserMessage: async (text, context) => {
      const scopeEpoch = colleagueScopeEpoch
      const trimmed = text.trim()
      // 有一轮正在回答（当前分页或后台分页）：先排队，这一轮结束后自动发送
      syncRun() // 状态可能被外部直接重置过（身份切换、测试），先校准
      if (trimmed !== '' && (runConversationId !== null || isWorking(rawGet().executionState))) {
        rawSet({
          queuedMessage: { conversationId: rawGet().conversationId, text: trimmed, context },
        })
        return
      }
      const { executionState } = get()
      // 进入时若处于等待确认态，后续新写操作需先作废旧预览（RL-01 防串场）
      const wasAwaitingConfirmation = executionState === 'awaiting_confirmation'
      if (trimmed === '' || executionState === 'thinking' || executionState === 'executing') {
        return
      }

      // 正在等追问回答时，在输入框里打字 = 回答这张卡（「第二个」「明天」这类补充离开原话没法理解）
      const openQuestion = findOpenQuestion()
      if (openQuestion) {
        patchQuestion(openQuestion.id, { status: 'answered', answer: trimmed })
        set((state) => ({
          messages: [
            ...state.messages,
            { id: createMessageId(), sender: 'user', content: trimmed, timestamp: Date.now() },
          ],
          executionState: 'thinking',
          context,
          actionQueue: null,
          suggestions: [],
        }))
        const { kind = 'plan', meta } = openQuestion.question
        if (kind === 'generation_mode') {
          set({ executionState: 'idle', pendingGenerationChoice: null })
          if (/先不|取消|不要|不用了/.test(trimmed)) {
            appendAssistant('好的，先不生成。需要时再告诉我。')
            return
          }
          const manual = /我来|手动|自己|manual/i.test(trimmed)
          await startGenerationWithMode(meta?.idea ?? trimmed, manual ? 'manual' : 'auto')
          if (scopeEpoch !== colleagueScopeEpoch) return
          return
        }
        if (kind === 'theater_card') {
          answerTheaterCard(meta?.cardId ?? '', trimmed)
          set({ executionState: 'idle' })
          return
        }
        await runActionPlan(questionFollowUpText(openQuestion.question, trimmed), context)
        if (scopeEpoch !== colleagueScopeEpoch) return
        return
      }

      set((state) => ({
        messages: [
          ...state.messages,
          { id: createMessageId(), sender: 'user', content: trimmed, timestamp: Date.now() },
        ],
        executionState: 'thinking',
        context,
      }))

      // 路由（简单固定指令以外一律调用模型）：
      // ① 简单固定指令（「打开甘特图」「查看当前项目摘要」）→ 本地快捷规则，不调模型；
      // ② 矛盾求解正在等澄清 → 这句话是澄清补充；
      // ③ 纯提问 / 闲聊 → 模型问答；④ 像是要做事 → 模型理解成操作序列（不是操作时再转问答）。
      // 规则按简体中文书写：繁体 / 港台用词先转成简体再判断（交给模型的仍是原话）
      const routingText = needsRoutingConversion(trimmed)
        ? await toSimplifiedForRouting(trimmed)
        : trimmed
      if (scopeEpoch !== colleagueScopeEpoch) return
      // 信号编号（「矛盾求解 PROJ-8#S10」/ 只贴编号）：直接对该信号求解，不经模型理解
      const signalRequest = matchSignalSolveRequest(routingText)
      if (signalRequest) {
        await runSignalSolve(signalRequest)
        return
      }
      let intent: ParsedColleagueIntent
      try {
        intent = parseColleagueIntent(routingText, context)
      } catch (error) {
        if (scopeEpoch !== colleagueScopeEpoch) return
        const ruleMatched: ParsedColleagueIntent = {
          toolName: 'navigate_to_space',
          parameters: {},
          intentSource: 'rule_preset',
          confidence: 1,
        }
        // 简单固定指令缺项目（如不在项目里说「查看项目摘要」）：给出规则引导；
        // 命令式「矛盾求解：…」同样是固定指令（需要项目）；
        // 跳转类（「带我去风险管理」）交给模型——它看得到项目清单，可以追问去哪个项目
        if (
          error instanceof ContextMissingError &&
          ((isSimpleFixedCommand(routingText, ruleMatched) &&
            !NAVIGATION_VERB_RE.test(routingText)) ||
            isTrizSolveCommand(routingText))
        ) {
          appendAssistant(error.message)
          set({ executionState: 'idle' })
          return
        }
        if (!(error instanceof ContextMissingError || error instanceof IntentIncompleteError)) {
          appendAssistant(COLLEAGUE_FALLBACK_TEXT)
          set({ executionState: 'idle' })
          return
        }
        intent = { ...ruleMatched, toolName: null }
      }

      if (!isSimpleFixedCommand(routingText, intent)) {
        const activeTriz = findActiveClarifyingTrizRun()
        if (activeTriz) {
          await runTrizClarification(activeTriz.messageId, activeTriz.run, trimmed)
          if (scopeEpoch !== colleagueScopeEpoch) return
          return
        }
        // 纯知识提问（「什么是关键路径」）直接问答；其余一律先交给操作理解——它能调用工具就调用，
        // 判断不是操作再转问答（多一次模型调用，换来「说了就去做」的命中率）
        if (isKnowledgeQuestion(routingText)) {
          await runLiveAnswer(trimmed, context)
          if (scopeEpoch !== colleagueScopeEpoch) return
          return
        }
        const destinationTitles = buildColleagueAppMap(contextCan(context)).map(
          (destination) => destination.title,
        )
        // 明显是新的一串操作时，取代旧的待确认预览与未完成序列（RL-01 唯一可确认卡）；
        // 只是追问（「这个改动影响什么」）时保留待确认的预览
        if (wasAwaitingConfirmation && looksLikeColleagueRequest(routingText, destinationTitles)) {
          supersedePendingTriz()
          supersedePendingAction()
        }
        set({ actionQueue: null, suggestions: [] })
        await runActionPlan(trimmed, context)
        if (scopeEpoch !== colleagueScopeEpoch) return
        return
      }

      // 走到这里一定是快捷规则命中的简单固定指令
      const toolName = intent.toolName
      if (!toolName) {
        set({ executionState: 'idle' })
        return
      }

      // 澄清追问期间的自由文本优先按澄清回答处理（query 类意图多为「补充说明」的误判，
      // 例如「我想改善进度，但质量会跟着变差」会命中摘要规则的「进度」令牌）。
      // 例外两类保留原语义：① 显式导航 / 写操作（用户明确发起了别的动作）；
      // ② 命令式「矛盾求解：…」（用户明确要开一次新的求解）。
      const activeTriz = findActiveClarifyingTrizRun()
      const explicitTrizCommand =
        toolName === ANALYZE_CONTRADICTION_TOOL_NAME && isTrizSolveCommand(routingText)
      if (
        activeTriz &&
        !explicitTrizCommand &&
        toolName !== 'navigate_to_space' &&
        !isWriteToolName(toolName)
      ) {
        await runTrizClarification(activeTriz.messageId, activeTriz.run, trimmed)
        if (scopeEpoch !== colleagueScopeEpoch) return
        return
      }

      // 矛盾求解受理（W5）：走对话流端点（非通用工具执行面），权限不足零请求。
      if (toolName === ANALYZE_CONTRADICTION_TOOL_NAME) {
        if (!hasColleaguePermission(TRIZ_TRIGGER_PERMISSION)) {
          appendAssistant(TRIZ_SOLVE_PERMISSION_DENIED_TEXT)
          set({ executionState: 'idle' })
          return
        }
        const projectId = intent.parameters.projectId
        if (typeof projectId !== 'number' || !Number.isFinite(projectId)) {
          appendAssistant(COLLEAGUE_CONTEXT_MISSING_TEXT)
          set({ executionState: 'idle' })
          return
        }
        // 命令式输入已剥离「矛盾求解：」前缀，陈述取剥离后的正文
        const statement =
          typeof intent.parameters.statement === 'string' && intent.parameters.statement !== ''
            ? intent.parameters.statement
            : trimmed
        const signalIdFromText = extractSignalIdFromText(trimmed)
        const sourceSignalId =
          typeof intent.parameters.sourceSignalId === 'number'
            ? intent.parameters.sourceSignalId
            : signalIdFromText
        const placeholderId = appendAssistant(
          undefined,
          undefined,
          newTrizRun({ projectId, sourceSignalId }, statement),
        )
        await runTrizSolve({
          placeholderId,
          projectId,
          statement,
          parentAnalysisId: null,
          sourceSignalId,
        })
        if (scopeEpoch !== colleagueScopeEpoch) return
        return
      }

      // RL-01 确认语义（修补1 兜底防线，W5 泛化为写工具集合判定）：等待确认期间发起新的
      // 写操作 → 旧待确认预览立即作废（排程预览卡或矛盾落库卡置 cancelled + 提示），
      // 保证任何时刻只有一张可确认卡，旧卡确认按钮随之消失（零误提交路径）。
      if (wasAwaitingConfirmation && isWriteToolName(toolName)) {
        supersedePendingTriz()
        const oldPending = get().pendingAction
        if (oldPending) {
          const oldMessageId = findPendingMessageId(oldPending)
          if (oldMessageId) {
            patchToolExecution(oldMessageId, {
              status: 'cancelled',
              cancelNote: PREVIEW_SUPERSEDED_TEXT,
            })
          }
          set({ pendingAction: null })
        }
      }

      const placeholderId = appendAssistant(undefined, {
        toolName,
        intentSource: intent.intentSource,
        status: 'executing',
        parameters: intent.parameters,
      })
      await runExecution(placeholderId, toolName, intent.parameters)
      if (scopeEpoch !== colleagueScopeEpoch) return
    },

    confirmPendingAction: async (expectedPreviewToken) => {
      const scopeEpoch = colleagueScopeEpoch
      const { pendingAction } = get()
      if (!pendingAction) return false
      // RL-01 身份校验：调用方必须持有当前 pendingAction 的令牌。
      // 旧预览卡（令牌已被新操作取代）点击确认 → 直接拒绝，零请求。
      if (
        expectedPreviewToken !== undefined &&
        expectedPreviewToken !== pendingAction.previewToken
      ) {
        return false
      }
      // 无令牌快照（execute 阶段 409）没有可提交对象，不可确认
      if (!pendingAction.previewToken) return false
      const messageId = findPendingMessageId(pendingAction)
      set({ executionState: 'executing' })
      if (messageId) patchToolExecution(messageId, { status: 'executing' })

      try {
        const envelope = await aiToolsApi.confirm({
          toolName: pendingAction.toolName,
          previewToken: pendingAction.previewToken,
          parameters: pendingAction.parameters,
        })
        if (scopeEpoch !== colleagueScopeEpoch) return false
        if (messageId) {
          patchToolExecution(messageId, {
            status: 'committed',
            data: envelope.data,
            durationMs: envelope.meta.durationMs,
          })
        }
        set({ pendingAction: null, executionState: 'idle' })
        // 落库后让所有视图（看板 / 甘特 / 日历 / WBS / 时间线 / 列表）同步刷新
        notifyTaskDataChanged(Number(pendingAction.parameters.projectId))
        // 操作序列：这一步确认后继续下一步
        if (get().actionQueue) await runNextQueuedAction()
        if (scopeEpoch !== colleagueScopeEpoch) return false
        return true
      } catch (error) {
        if (scopeEpoch !== colleagueScopeEpoch) return false
        if (isScheduleStaleError(error)) {
          // 409：锁定提交，保留 pendingAction 供「重新演练」/「取消」（D-write §3）
          if (messageId) {
            patchToolExecution(messageId, {
              status: 'error',
              error: { code: 'SCHEDULE_STALE', message: SCHEDULE_STALE_DISPLAY_TEXT, status: 409 },
            })
          }
          set({ executionState: 'awaiting_confirmation' })
          return false
        }
        if (messageId)
          patchToolExecution(messageId, { status: 'error', error: toColleagueError(error) })
        // 保留 pendingAction：网络/其他错误可经确认按钮重试
        set({ executionState: 'error' })
        return false
      }
    },

    cancelPendingAction: () => {
      const { pendingAction } = get()
      if (!pendingAction) return
      const messageId = findPendingMessageId(pendingAction)
      if (messageId) patchToolExecution(messageId, { status: 'cancelled' })
      // 本地销毁令牌：零网络请求、零数据库副作用（RL-01）
      set({ pendingAction: null, executionState: 'idle' })
      // 操作序列：放弃这一步只跳过它，后面的步骤照常逐条执行 / 确认
      if (get().actionQueue) void runNextQueuedAction()
    },

    redrillPendingAction: async () => {
      const scopeEpoch = colleagueScopeEpoch
      const { pendingAction } = get()
      if (!pendingAction) return
      const { toolName, parameters } = pendingAction
      const existingId = findPendingMessageId(pendingAction)
      const placeholderId = existingId ?? createMessageId()
      if (existingId) {
        patchToolExecution(existingId, { status: 'executing', error: undefined })
      } else {
        appendAssistant(undefined, {
          toolName,
          intentSource: 'rule_preset',
          status: 'executing',
          parameters,
        })
      }
      await runExecution(placeholderId, toolName, parameters)
      if (scopeEpoch !== colleagueScopeEpoch) return
    },

    clearMessages: () =>
      rawSet({
        messages: [],
        pendingAction: null,
        pendingTriz: null,
        actionQueue: null,
        executionState: 'idle',
      }),

    // ── 矛盾求解卡组（W5） ────────────────────────────────────────────

    answerTrizClarification: async (messageId, answer) => {
      const scopeEpoch = colleagueScopeEpoch
      const trimmed = answer.trim()
      const run = findTrizRun(messageId)
      if (!run || trimmed === '') return
      if (run.phase !== 'clarifying') return
      if (get().executionState === 'executing' || get().executionState === 'thinking') return
      set((state) => ({
        messages: [
          ...state.messages,
          { id: createMessageId(), sender: 'user', content: trimmed, timestamp: Date.now() },
        ],
      }))
      await runTrizClarification(messageId, run, trimmed)
      if (scopeEpoch !== colleagueScopeEpoch) return
    },

    selectTrizSolution: (messageId, solutionIndex) => {
      const run = findTrizRun(messageId)
      if (!run) return
      if (run.phase === 'previewing' || run.phase === 'committing' || run.phase === 'committed')
        return
      // 选定方案是纯本地选择：零请求、零落库；换选后旧的预览现场作废（无令牌残留）
      if (get().pendingTriz?.messageId === messageId) {
        set({ pendingTriz: null })
      }
      patchTrizRun(messageId, {
        phase: run.phase === 'exhausted' ? 'exhausted' : 'solved',
        selectedSolutionIndex: solutionIndex,
        previewToken: null,
        diff: null,
        receipt: null,
        error: null,
      })
    },

    previewTrizIntervention: async (messageId, target) => {
      const scopeEpoch = colleagueScopeEpoch
      const run = findTrizRun(messageId)
      if (!run || run.analysisId === null || run.selectedSolutionIndex === null) return
      // 目标实体写权限门（RL-05 / spec 第 2 条）：权限不足物理阻断，零请求
      if (!hasColleaguePermission(TRIZ_TARGET_WRITE_PERMISSIONS[target])) {
        patchTrizRun(messageId, {
          phase: run.phase === 'exhausted' ? 'exhausted' : 'solved',
          targetKind: target,
          previewToken: null,
          diff: null,
          error: { code: 'PERMISSION_DENIED', message: TRIZ_WRITE_PERMISSION_DENIED_TEXT },
        })
        return
      }
      // RL-01 唯一可确认卡：矛盾落库预览取代排程待确认预览
      supersedePendingAction()
      const toolName = TRIZ_TARGET_TOOL_NAMES[target]
      const parameters: Record<string, unknown> = {
        projectId: run.projectId,
        analysisId: run.analysisId,
        solutionIndex: run.selectedSolutionIndex,
      }
      patchTrizRun(messageId, {
        phase: 'previewing',
        targetKind: target,
        previewToken: null,
        diff: null,
        receipt: null,
        error: null,
      })
      set({ executionState: 'executing' })
      try {
        const envelope = await aiToolsApi.execute(toolName, parameters)
        if (scopeEpoch !== colleagueScopeEpoch) return
        const previewToken = envelope.meta.previewToken
        if (
          envelope.meta.status === 'PREVIEW_REQUIRED' &&
          typeof previewToken === 'string' &&
          previewToken !== ''
        ) {
          const diff = parseTrizInterventionDiff(envelope.meta.diff ?? envelope.data)
          patchTrizRun(messageId, {
            phase: 'preview_ready',
            previewToken,
            diff,
          })
          set({
            pendingTriz: { messageId, toolName, previewToken, parameters },
            executionState: 'awaiting_confirmation',
          })
          return
        }
        // 契约防御：写工具必须返回 PREVIEW_REQUIRED + 令牌，缺省按错误失败关闭（RL-01）
        patchTrizRun(messageId, {
          phase: 'error',
          error: { code: 'PREVIEW_TOKEN_MISSING', message: '预览令牌缺失，请重新发起落库' },
        })
        set({ executionState: 'error' })
      } catch (error) {
        if (scopeEpoch !== colleagueScopeEpoch) return
        const mapped = toColleagueError(error)
        if (isScheduleStaleError(error)) {
          // 409：版本冲突 → 保留目标与方案，提供「重新预览」入口（零静默重试）
          patchTrizRun(messageId, {
            phase: 'conflict',
            previewToken: null,
            error: { code: 'SCHEDULE_STALE', message: SCHEDULE_STALE_DISPLAY_TEXT, status: 409 },
          })
          set({ executionState: 'error' })
          return
        }
        patchTrizRun(messageId, { phase: 'error', error: mapped })
        set({ executionState: 'error' })
      }
    },

    retryTrizPreview: async (messageId) => {
      const scopeEpoch = colleagueScopeEpoch
      const run = findTrizRun(messageId)
      if (!run || run.targetKind === null) return
      if (get().executionState === 'executing' || get().executionState === 'thinking') return
      await get().previewTrizIntervention(messageId, run.targetKind)
      if (scopeEpoch !== colleagueScopeEpoch) return
    },

    confirmTrizIntervention: async (messageId, expectedPreviewToken) => {
      const scopeEpoch = colleagueScopeEpoch
      const run = findTrizRun(messageId)
      if (!run) return false
      if (run.phase !== 'preview_ready') return false
      const previewToken = run.previewToken
      if (!previewToken) return false
      // RL-01 身份校验：调用方必须持有本卡自己的令牌；旧卡令牌一律拒绝，零请求
      if (expectedPreviewToken !== undefined && expectedPreviewToken !== previewToken) {
        return false
      }
      if (!hasColleaguePermission(TRIZ_CONFIRM_PERMISSION)) {
        patchTrizRun(messageId, {
          phase: 'preview_ready',
          error: { code: 'PERMISSION_DENIED', message: TRIZ_CONFIRM_PERMISSION_DENIED_TEXT },
        })
        return false
      }
      const toolName = run.targetKind === null ? '' : TRIZ_TARGET_TOOL_NAMES[run.targetKind]
      const parameters: Record<string, unknown> = {
        projectId: run.projectId,
        analysisId: run.analysisId,
        solutionIndex: run.selectedSolutionIndex,
      }
      patchTrizRun(messageId, { phase: 'committing', error: null })
      set({ executionState: 'executing' })
      try {
        const envelope = await aiToolsApi.confirm({ toolName, previewToken, parameters })
        if (scopeEpoch !== colleagueScopeEpoch) return false
        const receipt = parseTrizInterventionReceipt(envelope.data)
        patchTrizRun(messageId, {
          phase: 'committed',
          previewToken: null,
          receipt,
        })
        set({ pendingTriz: null, executionState: 'idle' })
        notifyTaskDataChanged(run.projectId)

        // 7.1 接线：B1 确认链成功回执接线
        const analysisId = receipt?.analysisId ?? run.analysisId
        if (run.sourceSignalId && analysisId) {
          try {
            await projectSignalsApi.adopt(run.projectId, run.sourceSignalId, {
              analysisId,
            })
            if (scopeEpoch !== colleagueScopeEpoch) return false
            // 信号已解决：信号建议 / 项目空间信号卡立刻刷新，这张卡随之消失
            notifySignalsChanged()
          } catch (adoptError) {
            if (scopeEpoch !== colleagueScopeEpoch) return false
            if (isConflictError(adoptError)) notifySignalsChanged()
            // 409 容错：后端返回 409 Conflict（已被采纳）时视为幂等达成，console.info 静默吞下，绝不向用户报错；
            // 其他异常 console.warn 中性记录，不影响落库回执展示。
            if (isConflictError(adoptError)) {
              console.info('[TrizSignal] Signal already adopted, ignoring conflict.')
            } else {
              console.warn('[TrizSignal] Adopt signal backflow failed:', adoptError)
            }
          }
        }

        return true
      } catch (error) {
        if (scopeEpoch !== colleagueScopeEpoch) return false
        if (isScheduleStaleError(error)) {
          // 409：预览过期 → 保留方案与目标，提供「重新预览」（禁止静默覆盖他人改动）
          patchTrizRun(messageId, {
            phase: 'conflict',
            previewToken: null,
            error: { code: 'SCHEDULE_STALE', message: SCHEDULE_STALE_DISPLAY_TEXT, status: 409 },
          })
          set({ pendingTriz: null, executionState: 'awaiting_confirmation' })
          return false
        }
        patchTrizRun(messageId, { phase: 'error', error: toColleagueError(error) })
        // 非冲突失败保留令牌与现场：卡片可重试确认或放弃
        set({ executionState: 'error' })
        return false
      }
    },

    cancelTrizIntervention: (messageId) => {
      const run = findTrizRun(messageId)
      if (!run) return
      // 本地销毁令牌：零网络请求、零数据库副作用（RL-01）
      patchTrizRun(messageId, { phase: 'cancelled', previewToken: null, error: null })
      if (get().pendingTriz?.messageId === messageId) set({ pendingTriz: null })
      set({ executionState: 'idle' })
    },

    overrideTrizParameters: async (messageId, input) => {
      const scopeEpoch = colleagueScopeEpoch
      const run = findTrizRun(messageId)
      if (!run || run.analysisId === null) return
      set({ executionState: 'executing' })
      try {
        const envelope = await trizCopilotApi.override(run.projectId, run.analysisId, input)
        if (scopeEpoch !== colleagueScopeEpoch) return
        const data = envelope.data
        patchTrizRun(messageId, {
          phase: 'solved',
          contradictionType: data.contradictionType,
          contradictionTypeLabel: data.contradictionTypeLabel,
          mapping: resolveTrizMappingView(data),
          solutions: Array.isArray(data.solutions) ? data.solutions : [],
          excludedPrincipleNumbers: trizExcludedPrincipleNumbers(data),
          path: data.path,
          confidence: data.confidence,
          humanOverride: Boolean(data.humanOverride),
          selectedSolutionIndex: null,
          targetKind: null,
          previewToken: null,
          diff: null,
          receipt: null,
          error: null,
        })
        set({ executionState: 'idle' })
      } catch (error) {
        if (scopeEpoch !== colleagueScopeEpoch) return
        patchTrizRun(messageId, { phase: 'error', error: toColleagueError(error) })
        set({ executionState: 'error' })
      }
    },

    rememberSignalForSolve: (signal) => {
      signalSolveCache.set(signal.id, signal)
    },

    retryTrizSolve: async (messageId) => {
      const scopeEpoch = colleagueScopeEpoch
      const run = findTrizRun(messageId)
      if (!run) return
      if (get().executionState === 'executing' || get().executionState === 'thinking') return
      await runTrizSolve({
        placeholderId: messageId,
        projectId: run.projectId,
        statement: run.statement,
        parentAnalysisId: run.parentAnalysisId,
        sourceSignalId: run.sourceSignalId,
      })
      if (scopeEpoch !== colleagueScopeEpoch) return
    },
  }
})
// 每次回答结束时把当前分页写入本机：刷新页面后分页与对话都还在
if (typeof window !== 'undefined') {
  useNextAiColleagueStore.subscribe((state, previous) => {
    // 回答进行中不写（流式每个字都会触发）；结束后无论成功、失败或待确认都保存
    if (state.executionState === 'thinking' || state.executionState === 'executing') return
    if (state.messages === previous.messages && previous.executionState === state.executionState)
      return
    if (state.messages.length === 0) return
    try {
      const current: ColleagueConversation = {
        id: state.conversationId,
        title: conversationTitleOf(state.messages),
        messages: state.messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
        sessionId: state.sessionId,
        updatedAt: Date.now(),
      }
      saveHistory({
        conversations: [current, ...state.conversations.filter((c) => c.id !== current.id)]
          .filter((c) => c.messages.length > 0 || state.openTabIds.includes(c.id))
          .slice(0, MAX_CONVERSATIONS),
        openTabIds: state.openTabIds,
        activeId: state.conversationId,
        modelPreference: state.modelPreference,
      })
    } catch {
      // 存储不可用时忽略
    }
  })
}

// 身份改变同步销毁旧现场；epoch 使旧请求的成功、失败和 SSE 帧都不能回填。
useAuthStore.subscribe((state, previous) => {
  if (
    state.user?.id === previous.user?.id &&
    state.isAuthenticated === previous.isAuthenticated &&
    selectEffectiveOrganizationId(state) === selectEffectiveOrganizationId(previous)
  )
    return
  const nextScope = historyScope()
  colleagueScopeEpoch += 1
  resetColleagueRuns()
  changingColleagueScope = true
  currentHistoryScope = nextScope
  suggestionKey = null
  const history = loadHistory()
  useNextAiColleagueStore.setState({
    ...useNextAiColleagueStore.getInitialState(),
    ...restoreTabs(history),
    modelPreference: history.modelPreference,
    isOpen: false,
    executionState: 'idle',
    pendingAction: null,
    pendingTriz: null,
    actionQueue: null,
    context: null,
    webSearchEnabled: false,
    pageVision: null,
    suggestions: [],
    theaterLink: null,
    pendingGenerationChoice: null,
    backgroundRunId: null,
    queuedMessage: null,
  })
  changingColleagueScope = false
})
