import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  CopilotAssumptionEntry,
  CopilotEntryFailureOutcome,
  CopilotEntryQuickStart,
  CopilotMessage,
  CopilotRecommendedAction,
  CopilotPageContextDescriptorV1,
  CopilotTurnMode,
  CopilotTurnResponse,
} from '@aiproj/types'
import { canEnterCopilotDemonstration, generateCopilotSessionId } from '@aiproj/types'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * Copilot 全局侧栏壳状态（v3-copilot-sidebar-shell / spec copilot-sidebar-shell）。
 *
 * 按域拆分：面板开合、形态、宽度、输入草稿与流式状态归本 store，
 * 不与 ui-store（主题/密度/侧栏）混用。
 *
 * 持久化边界（任务 2.2）：只持久化**宽度偏好**（用户偏好，localStorage）；
 * 开合/形态/草稿/流式属会话态，刷新回默认——与 ui-store 的 partialize 范式一致。
 * 本阶段无后端：草稿与消息仅存内存/本地，不发起业务写入（红线任务组 7）。
 */
export const COPILOT_STORE_KEY = 'aiproj-copilot'

/** 规格 stage2a §4.2：默认宽 400px，可拖拽 360–560px。 */
export const COPILOT_PANEL_DEFAULT_WIDTH = 400
export const COPILOT_PANEL_MIN_WIDTH = 360
export const COPILOT_PANEL_MAX_WIDTH = 560

/** 三态形态：抽屉 / 最小化悬浮 / 全屏专注。 */
export type CopilotPanelForm = 'drawer' | 'minimized' | 'fullscreen'

/**
 * 用户模式（v3-copilot-mode-adaptation D7）：
 * 新手 / 专业。来源优先级：显式选择 > pro 推断 > 默认新手。
 * 用户模式影响引导密度，不影响安全信息（D2）。
 */
export type CopilotUserMode = 'novice' | 'professional'

/** 自动展开偏好：最高严重度建议出现时是否自动打开面板。 */
export interface CopilotAutoExpandPreference {
  /** 是否启用自动展开（默认 true）。 */
  enabled: boolean
}

/**
 * 模式解析优先级（D7）：
 * 1. 显式用户选择（explicitSelection）
 * 2. pro 标记推断（proInferred）
 * 3. 默认新手（novice）
 *
 * 返回解析后的用户模式与来源。
 */
export function resolveUserMode(params: {
  explicitSelection?: CopilotUserMode | null
  proInferred?: boolean
}): { mode: CopilotUserMode; source: 'explicit' | 'inferred' | 'default' } {
  if (params.explicitSelection) {
    return { mode: params.explicitSelection, source: 'explicit' }
  }
  if (params.proInferred) {
    return { mode: 'professional', source: 'inferred' }
  }
  return { mode: 'novice', source: 'default' }
}

/**
 * 流式阶段（任务 4.6）：与 DraftGenerationProgress 的「理解需求 / 分析结构 / 生成方案」分步对应。
 * 本阶段数据来自 fixture 演示（意图路由通道未接入，见红线 §5）。
 */
export type CopilotStreamPhase =
  'idle' | 'understanding' | 'analyzing' | 'generating' | 'done' | 'cancelled' | 'error'

/**
 * retry envelope 文本上界（v3-copilot-productized-operating-entry）。
 *
 * 提交失败后要能恢复输入，但不把原始 prompt 长期留在内存/存储里 —— 只保留有界片段。
 */
export const COPILOT_RETRY_ENVELOPE_MAX_TEXT = 2000

/** 提交失败后可恢复的最小输入（会话态，不持久化）。 */
export interface CopilotRetryEnvelope {
  /** 有界原始输入（≤ `COPILOT_RETRY_ENVELOPE_MAX_TEXT`）。 */
  readonly text: string
  /** 触发提交时的路由（用于恢复 scope 推导）。 */
  readonly currentRoute: string
  /** 斜杠命令（如有）。 */
  readonly slashCommand?: string
  /**
   * 提交时的页面语境快照（v3-copilot-authoritative-page-context）。
   *
   * retry 默认沿用该快照（同一 routeRevision）；「使用当前页面重试」才用
   * 当前页面派生新 descriptor（design §F-4 / Decision 5）。
   */
  readonly pageContext?: CopilotPageContextDescriptorV1
}

/** scope 变更提示：草稿非空时保留输入并要求确认或重选（spec: Scope changes while a draft exists）。 */
export interface CopilotScopeNotice {
  /** 变更前的 scope 展示名（组织级用「全局」）。 */
  readonly previousLabel: string
  /** 变更后的 scope 展示名。 */
  readonly nextLabel: string
  readonly previousProjectId: number | null
  readonly nextProjectId: number | null
}

/** 把输入裁剪为有界 retry envelope。 */
export function buildCopilotRetryEnvelope(input: {
  text: string
  currentRoute: string
  slashCommand?: string
  pageContext?: CopilotPageContextDescriptorV1
}): CopilotRetryEnvelope {
  return {
    text: input.text.slice(0, COPILOT_RETRY_ENVELOPE_MAX_TEXT),
    currentRoute: input.currentRoute,
    ...(input.slashCommand !== undefined ? { slashCommand: input.slashCommand } : {}),
    ...(input.pageContext !== undefined ? { pageContext: input.pageContext } : {}),
  }
}

/**
 * 单回合的页面语境快照（v3-copilot-authoritative-page-context）。
 *
 * 提交时冻结：页面切换不改变已提交回合绑定的快照（spec REQ：回合保持绑定
 * 已提交的授权快照，UI 标注其页面/时间，不静默混入新页面状态）。
 */
export interface CopilotTurnContextSnapshot {
  /** 提交时的页面语境描述符。 */
  readonly pageContext: CopilotPageContextDescriptorV1
  /** 提交时间（ISO；数据时间 chip 用）。 */
  readonly submittedAt: string
}

/** 钳制面板宽度到 360–560 区间（任务 3.3 / 3.5：下界、上界与越界钳制）。 */
export function clampCopilotPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return COPILOT_PANEL_DEFAULT_WIDTH
  return Math.min(COPILOT_PANEL_MAX_WIDTH, Math.max(COPILOT_PANEL_MIN_WIDTH, Math.round(width)))
}

export interface CopilotState {
  /** 面板是否打开（顶栏按钮与全局快捷键共用）。 */
  open: boolean
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  /** 三态形态（抽屉 / 最小化悬浮 / 全屏专注）。 */
  form: CopilotPanelForm
  setForm: (form: CopilotPanelForm) => void
  /** 面板宽度（px），钳制在 360–560。 */
  width: number
  setWidth: (width: number) => void
  /** 面板输入草稿（形态切换 / 最小化时保留，任务 3.8）。 */
  draft: string
  setDraft: (draft: string) => void
  clearDraft: () => void
  /** 是否正在流式生成（最小化不取消进行中的生成，任务 3.9）。 */
  streaming: boolean
  streamPhase: CopilotStreamPhase
  setStreaming: (streaming: boolean, phase?: CopilotStreamPhase) => void
  /** 演示会话（本阶段 fixture 驱动，不持久化、不落库）。 */
  sessionId: string
  messages: CopilotMessage[]
  /**
   * 按 `messageId` **upsert**（已存在则原地替换，否则追加）。
   *
   * 不是简单 append：服务端的消息落库带 `idempotencyKey`（见后端
   * `copilot_turn_service` 的 `${idempotencyKey}:assistant`），同一回合被重放时
   * 会**如实返回同一条 assistant 消息**——这是幂等语义正确的表现。客户端若无条件
   * 追加，同一 `messageId` 就会在列表里出现两次，React 立刻报重复 key，且气泡重影。
   *
   * 幂等的服务端必须配幂等的客户端写入：唯一性是消息列表自身的不变量，
   * 应当由 store 保证，而不是指望每个调用点都先查一遍。
   */
  appendMessage: (message: CopilotMessage) => void
  /** 演示回复携带的动作（渲染为禁用预览态，红线 7.x）。 */
  demoActions: readonly CopilotRecommendedAction[]
  setDemoActions: (actions: readonly CopilotRecommendedAction[]) => void
  /** 演示回复携带的假设（插槽 5.2 演示数据）。 */
  demoAssumptions: readonly CopilotAssumptionEntry[]
  setDemoAssumptions: (assumptions: readonly CopilotAssumptionEntry[]) => void
  /** Entering the live channel removes stale fixture output so real answers are never labeled demo. */
  clearDemonstrationArtifacts: () => void
  /** 流式错误/降级状态（任务 4.10 的机器可读原因展示）。 */
  streamError: string | null
  setStreamError: (error: string | null) => void
  /**
   * 回合模式（v3-copilot-live-submission-channel）。
   * 'live' = 走真实回合端点；'demonstration' = 端点不可达/未认证时的本机演示。
   * 演示态**必须**在界面上显式标注且不提供动作确认入口（spec REQ）。
   */
  mode: CopilotTurnMode
  setMode: (mode: CopilotTurnMode) => void
  /** 服务端会话 ID（live 模式下由回合响应返回；演示态为 null）。 */
  liveSessionId: string | null
  /** 最近一次回合响应（destination/澄清/假设/告警的唯一来源）。 */
  turn: CopilotTurnResponse | null
  setTurn: (turn: CopilotTurnResponse | null) => void
  /**
   * 流式 assistant 占位（v3-copilot-live-streaming-output，会话态不持久化）。
   *
   * 流式回答期间为「live 占位气泡」，answer-delta 增量追加文本；
   * 终态（answer-done）转正为正式 CopilotMessage；turn-error/中断保留已累积文本。
   */
  streamingAssistant: { messageId: string; content: string } | null
  setStreamingAssistant: (entry: { messageId: string; content: string } | null) => void
  /** 追加一次 answer-delta 到流式占位（无占位时为 no-op）。 */
  appendStreamingDelta: (delta: string) => void
  /**
   * 当前会话已发生的澄清轮次（会话态，不持久化）。
   *
   * 后端 `evaluateSlotCompleteness` 在 `clarificationRounds >= MAX` 时强制放行
   *（`copilot-intent-router.ts`），避免用户在澄清回路里无限打转。前端每次提交
   * 把它带上，后端据此决定是否继续阻断。收到非 clarify 回合时清 0。
   */
  clarificationRounds: number
  /** 降级为演示态的原因（中文，供界面显式说明）。 */
  degradeReason: string | null
  setDegradeReason: (reason: string | null) => void

  // ── v3-copilot-optional-web-search-configuration 新增 ──

  /**
   * 最近一次答案回合的网页搜索门状态（会话态，不持久化）。
   * 仅在服务端实际调用或降级时非 null；消息列表据此渲染引用分区。
   */
  webSearchStatus: {
    code: import('@aiproj/types').CopilotWebSearchGateCode
    message: string
  } | null
  setWebSearchStatus: (
    status: {
      code: import('@aiproj/types').CopilotWebSearchGateCode
      message: string
    } | null,
  ) => void

  // ── v3-copilot-mode-adaptation 新增 ──

  /**
   * 用户模式显式选择（持久化）。
   * null = 未显式选择（回退到 pro 推断或默认新手）。
   */
  copilotUserMode: CopilotUserMode | null
  setCopilotUserMode: (mode: CopilotUserMode | null) => void

  /**
   * 自动展开偏好（持久化）。
   * 当最高严重度建议出现时，面板是否自动打开。
   */
  autoExpandEnabled: boolean
  setAutoExpandEnabled: (enabled: boolean) => void

  /**
   * 本次会话是否已触发过自动展开（会话态，不持久化）。
   * 同一会话内只触发一次（D3）。
   */
  autoExpandTriggered: boolean
  setAutoExpandTriggered: (triggered: boolean) => void

  // ── v3-copilot-productized-operating-entry 新增（全部会话态，禁止持久化）──

  /**
   * 宿主是否**显式声明**了演示能力（本机/测试构建）。
   *
   * 由应用壳在启动时按构建/运行环境注入；默认 false。
   * 声明本身不进入演示——还需用户显式选择（design D7）。
   */
  demoCapabilityDeclared: boolean
  setDemoCapabilityDeclared: (declared: boolean) => void

  /** 用户是否**显式选择**进入演示。 */
  demoSelected: boolean

  /**
   * 显式进入演示。
   *
   * 只有「宿主声明 + 用户选择」同时成立才切换 mode；否则整体无操作。
   * 返回是否真的进入，便于界面给出诚实反馈。
   */
  enterExplicitDemonstration: () => boolean

  /** 退出演示回到生产通道，并清掉演示产物（返回 readiness 评估）。 */
  exitDemonstration: () => void

  /**
   * 有界 retry envelope：提交失败后可恢复的最小输入。
   *
   * 只保留有界文本与路由，不保留完整消息历史，也**不写入 localStorage**。
   */
  retryEnvelope: CopilotRetryEnvelope | null
  setRetryEnvelope: (envelope: CopilotRetryEnvelope | null) => void

  /** 最近一次生产失败的稳定分类（不含后端 message / 状态码）。 */
  failure: CopilotEntryFailureOutcome | null
  setFailure: (failure: CopilotEntryFailureOutcome | null) => void

  /** 由 quick start 填入的结构化选择（提交前复核 plugin revision）。 */
  quickStartSelection: CopilotEntryQuickStart | null
  setQuickStartSelection: (selection: CopilotEntryQuickStart | null) => void

  /**
   * 最近一次 readiness 返回的资格快照 revision（会话态，不持久化）。
   *
   * 提交前用它复核 quick start 的 `pluginBinding.snapshotRevision`：
   * 快照整体被替换（安装/权限/兼容性变化）即 stale，一律 fail closed。
   */
  toolSnapshotRevision: string | null
  setToolSnapshotRevision: (revision: string | null) => void

  /** scope 变更提示：存在时禁止提交，直到用户确认或重选。 */
  scopeNotice: CopilotScopeNotice | null
  setScopeNotice: (notice: CopilotScopeNotice | null) => void
  acknowledgeScopeNotice: () => void

  /**
   * 最近一次提交绑定的页面语境快照（v3-copilot-authoritative-page-context，会话态。
   * 不持久化）。页面切换不清除——回合保持绑定已提交的授权快照（spec REQ）。
   */
  turnContextSnapshot: CopilotTurnContextSnapshot | null
  setTurnContextSnapshot: (snapshot: CopilotTurnContextSnapshot | null) => void

  /** 清空会话（新会话/重置演示）。 */
  resetSession: () => void
}

export const useCopilotStore = create<CopilotState>()(
  persist(
    (set, get) => ({
      open: false,
      setOpen: (open) => set({ open }),
      toggleOpen: () => set({ open: !get().open }),
      form: 'drawer',
      setForm: (form) => set({ form }),
      width: COPILOT_PANEL_DEFAULT_WIDTH,
      setWidth: (width) => set({ width: clampCopilotPanelWidth(width) }),
      draft: '',
      setDraft: (draft) => set({ draft }),
      clearDraft: () => set({ draft: '' }),
      streaming: false,
      streamPhase: 'idle',
      setStreaming: (streaming, phase) =>
        set({ streaming, streamPhase: phase ?? get().streamPhase }),
      sessionId: generateCopilotSessionId(),
      messages: [],
      appendMessage: (message) =>
        set((state) => {
          const index = state.messages.findIndex(
            (existing) => existing.messageId === message.messageId,
          )
          if (index === -1) return { messages: [...state.messages, message] }
          // 原地替换而非「删旧+追加」：保持时间顺序，避免重放把气泡挪到列表末尾。
          const messages = state.messages.slice()
          messages[index] = message
          return { messages }
        }),
      demoActions: [],
      setDemoActions: (demoActions) => set({ demoActions }),
      demoAssumptions: [],
      setDemoAssumptions: (demoAssumptions) => set({ demoAssumptions }),
      clearDemonstrationArtifacts: () =>
        set((state) => ({
          messages: state.messages.filter(
            (message) =>
              !message.messageId.startsWith('cpm-demo-') &&
              !message.sessionId.startsWith('cps-demo'),
          ),
          demoActions: [],
          demoAssumptions: [],
        })),
      streamError: null,
      setStreamError: (streamError) => set({ streamError }),
      // 默认走生产通道：演示只能由「宿主显式声明 + 用户显式选择」进入
      // （v3-copilot-productized-operating-entry / spec: Production errors MUST NOT
      // silently become demonstration success）。
      mode: 'live',
      setMode: (mode) => set({ mode }),
      liveSessionId: null,
      turn: null,
      streamingAssistant: null,
      setStreamingAssistant: (streamingAssistant) => set({ streamingAssistant }),
      appendStreamingDelta: (delta) =>
        set((state) =>
          state.streamingAssistant
            ? {
                streamingAssistant: {
                  ...state.streamingAssistant,
                  content: state.streamingAssistant.content + delta,
                },
              }
            : state,
        ),
      clarificationRounds: 0,
      // v3-copilot-productized-operating-entry：`setTurn(null)`（提交失败时清空回合）
      // 原实现把 mode 落回 'demonstration'，等于让**任意**生产错误静默切进演示。
      // 现在清空回合不改变模式，也不丢弃已建立的服务端会话——失败后仍是 live 降级态。
      //
      // 澄清轮次维护：收到 clarify 回合 +1（下次提交带上，后端到上界即放行调 AI）；
      // 收到非 clarify 回合（answer/route/structured）清 0；turn=null（失败）保持现有值，
      // 让用户重试时仍能累积到放行阈值。
      setTurn: (turn) =>
        set((state) => ({
          turn,
          liveSessionId: turn?.sessionId ?? state.liveSessionId,
          mode: turn?.mode ?? state.mode,
          clarificationRounds:
            turn === null
              ? state.clarificationRounds
              : turn.clarificationRequired
                ? state.clarificationRounds + 1
                : 0,
        })),
      degradeReason: null,
      setDegradeReason: (degradeReason) => set({ degradeReason }),
      webSearchStatus: null,
      setWebSearchStatus: (webSearchStatus) => set({ webSearchStatus }),

      // ── v3-copilot-mode-adaptation 新增 ──
      copilotUserMode: null,
      setCopilotUserMode: (copilotUserMode) => set({ copilotUserMode }),
      autoExpandEnabled: true,
      setAutoExpandEnabled: (autoExpandEnabled) => set({ autoExpandEnabled }),
      autoExpandTriggered: false,
      setAutoExpandTriggered: (autoExpandTriggered) => set({ autoExpandTriggered }),

      // ── v3-copilot-productized-operating-entry 新增 ──
      demoCapabilityDeclared: false,
      setDemoCapabilityDeclared: (demoCapabilityDeclared) => set({ demoCapabilityDeclared }),
      demoSelected: false,
      enterExplicitDemonstration: () => {
        const allowed = canEnterCopilotDemonstration({
          capabilityDeclared: get().demoCapabilityDeclared,
          userSelected: true,
        })
        if (!allowed) return false
        set({ demoSelected: true, mode: 'demonstration', failure: null })
        return true
      },
      exitDemonstration: () =>
        set({
          demoSelected: false,
          mode: 'live',
          demoActions: [],
          demoAssumptions: [],
          degradeReason: null,
          messages: [],
          streamPhase: 'idle',
          streaming: false,
          streamingAssistant: null,
        }),
      retryEnvelope: null,
      setRetryEnvelope: (retryEnvelope) => set({ retryEnvelope }),
      failure: null,
      setFailure: (failure) => set({ failure }),
      quickStartSelection: null,
      setQuickStartSelection: (quickStartSelection) => set({ quickStartSelection }),
      toolSnapshotRevision: null,
      setToolSnapshotRevision: (toolSnapshotRevision) => set({ toolSnapshotRevision }),
      scopeNotice: null,
      setScopeNotice: (scopeNotice) => set({ scopeNotice }),
      acknowledgeScopeNotice: () => set({ scopeNotice: null }),
      turnContextSnapshot: null,
      setTurnContextSnapshot: (turnContextSnapshot) => set({ turnContextSnapshot }),

      resetSession: () =>
        set({
          messages: [],
          demoActions: [],
          demoAssumptions: [],
          streamPhase: 'idle',
          streaming: false,
          streamError: null,
          turn: null,
          streamingAssistant: null,
          liveSessionId: null,
          clarificationRounds: 0,
          degradeReason: null,
          // 注意：autoExpandTriggered 也在 resetSession 中重置
          autoExpandTriggered: false,
          // 入口态一并清空：失败分类、retry envelope、quick start 选择与 scope 提示
          // 都绑定上一轮会话，跨会话保留会让 stale 选择被当作有效输入。
          failure: null,
          retryEnvelope: null,
          quickStartSelection: null,
          scopeNotice: null,
          demoSelected: false,
          toolSnapshotRevision: null,
          turnContextSnapshot: null,
        }),
    }),
    {
      name: COPILOT_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      // 持久化用户偏好：面板宽度 + 用户模式 + 自动展开开关（任务 2.3/2.5）。
      // 开合/形态/草稿/流式/会话/autoExpandTriggered 属会话态，刷新回默认。
      // partialize 对用户模式做白名单过滤，防止运行时异常值污染 localStorage。
      //
      // v3-copilot-productized-operating-entry 红线：readiness 快照、原始 prompt、
      // retry envelope、失败分类、quick start 选择、演示声明/选择与服务端权限状态
      // **一律不得**进入这个白名单——授权/安装/兼容性状态会过期，持久化会把 stale 当 ready。
      partialize: (state) => ({
        width: state.width,
        copilotUserMode:
          state.copilotUserMode === 'novice' || state.copilotUserMode === 'professional'
            ? state.copilotUserMode
            : null,
        autoExpandEnabled: state.autoExpandEnabled,
      }),
    },
  ),
)

// 登录身份切换不能保留上一人的对话、草稿或流式句柄。
useAuthStore.subscribe((state, previous) => {
  if (
    state.user?.id === previous.user?.id &&
    state.isAuthenticated === previous.isAuthenticated &&
    selectEffectiveOrganizationId(state) === selectEffectiveOrganizationId(previous)
  )
    return
  useCopilotStore.getState().resetSession()
  useCopilotStore.setState({ draft: '', open: false, sessionId: generateCopilotSessionId() })
  try {
    sessionStorage.removeItem('aiproj-copilot-demo-cursor-v1')
  } catch {
    // 存储不可用仍清除内存现场。
  }
})
