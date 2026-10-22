import { create } from 'zustand'
import { clearAnalysisJobHandles } from '@/lib/api/analysis-jobs'
import { createJSONStorage, persist } from 'zustand/middleware'
import { throttledSessionStorage } from '@/lib/throttled-session-storage'
import {
  AI_INTENT_SCHEMA_VERSION,
  type AnalyzeProjectIntentResponse,
  type AdaptiveClarificationSession,
  type ClarificationAnswer,
  type ClarificationAnswers,
  type ClarificationCard,
  type ClarificationField,
  type ClarificationPhase,
  type QuestionPlanCoverage,
  type ConfirmedProjectContext,
  type ParsedIntent,
  type ProjectDraft,
  type ProjectDraftFailureDetail,
  type ProjectDraftMeta,
  type ProjectDraftModule,
  type ProjectDraftModuleStatus,
  type ProjectDraftStreamEvent,
  type DraftValidationReport,
  type ConfirmProjectDraftResponse,
  type ProjectPlanUnderstanding,
  type FeasibilityAssessment,
  type FeasibilityDecision,
  type FeasibilityNegotiationTurn,
} from '@aiproj/types'
import type { MentionedMember } from '@/lib/member-mask'
import { appendOutputPiece, closeOutputLanes, type OutputLane } from '@/lib/ai-draft/output-lanes'
import {
  adaptiveAnswerText,
  adaptiveQuestionCards,
  isAdaptiveCard,
} from '@/lib/ai-draft/adaptive-card'
import {
  createDraftProgressProjection,
  reduceDraftProgress,
  streamingEnvelopeToDraftAction,
  type DraftProgressAction,
  type DraftProgressProjection,
} from '@/lib/ai-draft/progress-projection'
import { clearDraftProgressCursor, writeDraftProgressCursor } from '@/lib/ai-draft/progress-cursor'
import type { StreamingProgressEnvelope } from '@aiproj/types'

export const AI_PROJECT_DRAFT_STORAGE_KEY = 'aiproj-ai-project-draft-v2'

/** 草案字段级改动（与后端 confirm 的 modifications 同构）。 */
export type DraftFieldModification = { path: string; value: string | number | boolean | string[] }

function isMarked(value: unknown): value is { value: unknown; marker: unknown } {
  return typeof value === 'object' && value !== null && 'value' in value && 'marker' in value
}

function parseSegment(segment: string): { key: string; index: string | null } {
  const match = /^(.+?)\[(.+)]$/.exec(segment)
  if (match && match[1] !== undefined && match[2] !== undefined) {
    return { key: match[1], index: match[2] }
  }
  return { key: segment, index: null }
}

function resolveCollectionItem(container: unknown, key: string, index: string): unknown {
  const arr = (container as Record<string, unknown>)?.[key]
  if (!Array.isArray(arr)) return undefined
  const byId = arr.find((el) => (el as { id?: string })?.id === index)
  if (byId) return byId
  if (/^\d+$/.test(index)) return arr[Number(index)]
  return undefined
}

/**
 * 本地就地应用一条字段改动（镜像后端 `import_selection.applyOne` 的路径语义）：
 * Marked 字段改 `.value` 并置 explicit marker；普通字段直接赋值。
 * 用于草案审查阶段「行内编辑=本地暂存」，不触发导入（polish-v1-ui-and-assignment / D4）。
 */
function applyLocalModification(draft: unknown, mod: DraftFieldModification): unknown {
  const next = JSON.parse(JSON.stringify(draft))
  const segments = mod.path.split('.')
  let holder: unknown = next
  for (let i = 0; i < segments.length; i++) {
    const { key, index } = parseSegment(segments[i] ?? '')
    const isLast = i === segments.length - 1
    if (index !== null) {
      holder = resolveCollectionItem(holder, key, index)
      if (holder === undefined || holder === null) return next
      continue
    }
    if (isLast) {
      const container = holder as Record<string, unknown>
      if (!(key in container)) return next
      if (isMarked(container[key])) {
        container[key] = {
          value: mod.value,
          marker: {
            confidence: 1,
            source: 'explicit',
            reason: '用户在草案审查阶段手动修改。',
            needsConfirmation: false,
          },
        }
      } else {
        container[key] = mod.value
      }
      return next
    }
    holder = (holder as Record<string, unknown>)[key]
    if (holder === undefined || holder === null) return next
  }
  return next
}

export type AiProjectDraftStatus = 'idle' | 'analyzing' | 'clarifying' | 'ready' | 'error'

type ProjectDraftSessionStatus =
  'drafting' | 'reviewing' | 'editing' | 'applying' | 'confirmed' | 'saved' | 'rejected' | 'error'

export interface AiProjectDraftScope {
  userId: number | null
  organizationId: number | null
}

export interface AiProjectDraftState extends AiProjectDraftScope {
  schemaVersion: typeof AI_INTENT_SCHEMA_VERSION
  status: AiProjectDraftStatus
  rawInput: string
  cards: ClarificationCard[]
  answers: ClarificationAnswers
  parsedIntent: ParsedIntent | null
  context: ConfirmedProjectContext | null
  clarificationPhase: ClarificationPhase
  activeCard: ClarificationCard | null
  remainingCount: number
  completedCount: number
  totalCount: number
  questionPlanRevision: string | null
  agentQuestionPlanToken: string | null
  adaptiveSession: AdaptiveClarificationSession | null
  adaptiveSessionToken: string | null
  questionPlanCoverage: QuestionPlanCoverage | null
  error: string | null
  restored: boolean

  draftStatus: ProjectDraftSessionStatus | null
  draftId: string | null
  draftVersion: number
  draft: ProjectDraft | null
  draftMeta: ProjectDraftMeta | null
  draftFailure: ProjectDraftFailureDetail | null
  validation: DraftValidationReport | null
  draftEvents: ProjectDraftStreamEvent[]
  moduleStatuses: Partial<Record<ProjectDraftModule, ProjectDraftModuleStatus>>
  confirmResponse: ConfirmProjectDraftResponse | null
  lastEventSequence: number
  progressProjection: DraftProgressProjection
  /** 生成期间累积的模型真实输出文本（瞬时观察数据，不持久化）。 */
  streamOutput: string
  /** 是否仍有活跃输出（generation.output 置 true，draft.completed/failed 置 false）。 */
  streamOutputActive: boolean
  /** 同一批输出按模型调用分道（并发调用不互相穿插），供生成剧场实时展示。 */
  streamLanes: OutputLane[]
  /** 长需求（超过 8,000 字）的整理稿，用户确认后随追问与生成带上；原文仍是 rawInput。 */
  requirementBrief: string | null
  /** 整理稿是根据哪一版原文做的：原文改过就要重新整理。 */
  requirementBriefFor: string | null
  setRequirementBrief: (brief: string | null, forInput: string | null) => void
  /** 审查阶段累积的字段级改动；导入时随 confirm 一并提交。 */
  pendingModifications: DraftFieldModification[]
  /** 输入框 @ 的组织成员（姓名只在前端展示；发给服务端的是 userId 与 handle）。 */
  mentionedMembers: MentionedMember[]
  /** 就绪页的项目理解：loading / 已生成待确认 / 已确认 / 失败。 */
  understandingStatus: 'idle' | 'loading' | 'ready' | 'confirmed' | 'error'
  understandingDraft: ProjectPlanUnderstanding | null
  /** 生成剧场所选模型（澄清、项目理解、草案生成共用）。 */
  modelSelection: { connectionId: number; modelId: number } | null
  /**
   * 全自动（由 AI 同事一键生成时选择）：追问由 AI 代答，就绪后自动开始生成草案。
   * 只在内存里（不持久化）；草案生成后的确认转正由 AI 同事联动在校验无阻断时代为完成
   * （仅限用户明确选择了全自动；阻断 / 自动修正 / 冲突时交还用户审查）。
   */
  autoPilot: boolean
  /** 自适应澄清里待发送的对话回复（下一次 analyze 作为 adaptiveResponse 发出）。 */
  pendingAdaptiveResponse: string | null
  /** 生成前「能否如期完成」的评估与对话（项目理解确认后）；决定本身写在 context.feasibilityDecision。 */
  feasibilityAssessment: FeasibilityAssessment | null
  feasibilityChat: FeasibilityNegotiationTurn[]

  initializeScope: (scope: AiProjectDraftScope) => void
  addMentionedMember: (member: MentionedMember) => void
  setModelSelection: (selection: { connectionId: number; modelId: number } | null) => void
  setAutoPilot: (autoPilot: boolean) => void
  setUnderstandingStatus: (status: AiProjectDraftState['understandingStatus']) => void
  /** 理解层生成完成：保存草稿，并用服务端解析后的上下文（开工日 / 工期 / 团队已结构化）刷新就绪页。 */
  setUnderstandingDraft: (
    understanding: ProjectPlanUnderstanding,
    serverContext?: ConfirmedProjectContext | null,
  ) => void
  /** 用户确认（可编辑后确认）项目理解：写入 context.planUnderstanding，随生成请求提交。 */
  confirmUnderstanding: (understanding: ProjectPlanUnderstanding) => void
  setFeasibilityAssessment: (assessment: FeasibilityAssessment | null) => void
  appendFeasibilityChat: (turn: FeasibilityNegotiationTurn) => void
  /** 用户选定 / 撤销「能否如期完成」的决定（null = 撤销，回到照原计划）。 */
  setFeasibilityDecision: (decision: FeasibilityDecision | null) => void
  setRawInput: (rawInput: string) => void
  startAnalyzing: () => void
  applyAnalysis: (
    response: AnalyzeProjectIntentResponse,
    rawInput?: string,
    submittedAnswers?: ClarificationAnswers,
  ) => void
  recordAnswer: (answer: ClarificationAnswer) => void
  fail: (message: string) => void
  retry: () => void
  restart: () => void
  clearDraft: () => void
  setRestored: (restored: boolean) => void

  startDraftGeneration: (draftId: string) => void
  /** 生成失败后的会话复用重试：清空失败现场、回到 drafting，保留 draftId 与已确认上下文。 */
  retryDraftGeneration: () => void
  /** 行内编辑=本地暂存（更新本地 draft + 累积改动），不触发导入。 */
  applyDraftFieldEdit: (path: string, value: string | number | boolean | string[]) => void
  /** 撤销单项字段修改：移除修改记录并还原为草案初始 AI 生成值（无快照时仅移除记录）。 */
  resetDraftFieldEdit: (path: string) => void
  /** 撤销指定任务的全部字段修改，还原为草案初始 AI 生成值。 */
  resetTaskEdits: (taskId: string) => void
  applyDraftEvent: (event: ProjectDraftStreamEvent) => void
  /** 清空实时输出面板的累积文本；不清活跃标记，后续输出继续追加。 */
  clearStreamOutput: () => void
  /** 基于 StreamingProgressEnvelope 的进度更新（权威路径）。 */
  applyDraftEnvelope: (envelope: StreamingProgressEnvelope) => void
  applyDraftProgressAction: (action: DraftProgressAction) => void
  setDraftCompleted: (
    draft: ProjectDraft,
    meta: ProjectDraftMeta,
    validation: DraftValidationReport,
  ) => void
  setDraftFailed: (
    errorCode: string,
    message: string,
    failure?: Partial<ProjectDraftFailureDetail> | null,
  ) => void
  enterReview: () => void
  enterEditing: () => void
  enterApplying: () => void
  enterConfirmed: (response: ConfirmProjectDraftResponse) => void
  enterSaved: () => void
  enterRejected: () => void
  setDraftError: (message: string) => void
  resetToContext: () => void
  clearDraftSession: () => void
}

const initialData = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  status: 'idle' as AiProjectDraftStatus,
  rawInput: '',
  cards: [] as ClarificationCard[],
  answers: {} as ClarificationAnswers,
  parsedIntent: null as ParsedIntent | null,
  context: null as ConfirmedProjectContext | null,
  clarificationPhase: 'core' as ClarificationPhase,
  activeCard: null as ClarificationCard | null,
  remainingCount: 0,
  completedCount: 0,
  totalCount: 0,
  questionPlanRevision: null as string | null,
  agentQuestionPlanToken: null as string | null,
  adaptiveSession: null as AdaptiveClarificationSession | null,
  adaptiveSessionToken: null as string | null,
  questionPlanCoverage: null as QuestionPlanCoverage | null,
  error: null as string | null,
  restored: false,

  draftStatus: null as ProjectDraftSessionStatus | null,
  draftId: null as string | null,
  draftVersion: 0,
  draft: null as ProjectDraft | null,
  draftMeta: null as ProjectDraftMeta | null,
  draftFailure: null as ProjectDraftFailureDetail | null,
  validation: null as DraftValidationReport | null,
  draftEvents: [] as ProjectDraftStreamEvent[],
  moduleStatuses: {} as Partial<Record<ProjectDraftModule, ProjectDraftModuleStatus>>,
  confirmResponse: null as ConfirmProjectDraftResponse | null,
  lastEventSequence: 0,
  progressProjection: createDraftProgressProjection(),
  streamOutput: '',
  streamOutputActive: false,
  streamLanes: [] as OutputLane[],
  requirementBrief: null as string | null,
  requirementBriefFor: null as string | null,
  pendingModifications: [] as DraftFieldModification[],
  mentionedMembers: [] as MentionedMember[],
  understandingStatus: 'idle' as AiProjectDraftState['understandingStatus'],
  understandingDraft: null as ProjectPlanUnderstanding | null,
  modelSelection: null as { connectionId: number; modelId: number } | null,
  autoPilot: false,
  pendingAdaptiveResponse: null as string | null,
  feasibilityAssessment: null as FeasibilityAssessment | null,
  feasibilityChat: [] as FeasibilityNegotiationTurn[],
}

/** 生成请求里只带成员 id / handle，不带姓名。 */
function withMentionedMembers(
  context: ConfirmedProjectContext | null,
  members: readonly MentionedMember[],
): ConfirmedProjectContext | null {
  if (!context || members.length === 0) return context
  return {
    ...context,
    mentionedMembers: members.map(({ userId, handle, role }) => ({ userId, handle, role })),
  }
}

function isCrossScopeSwitch(state: AiProjectDraftState, scope: AiProjectDraftScope): boolean {
  if (state.schemaVersion !== AI_INTENT_SCHEMA_VERSION) {
    return true
  }
  const isUserMismatch =
    state.userId !== null && scope.userId !== null && state.userId !== scope.userId
  const isOrgMismatch =
    state.organizationId !== null &&
    scope.organizationId !== null &&
    state.organizationId !== scope.organizationId
  return isUserMismatch || isOrgMismatch
}

function clearForScope(scope: AiProjectDraftScope) {
  return {
    ...initialData,
    userId: scope.userId,
    organizationId: scope.organizationId,
  }
}

/**
 * 草案初始 AI 生成值快照（撤销修改时的还原依据）。
 * 纯内存、不持久化：刷新恢复会话后无快照，撤销退化为仅移除修改记录、保留当前编辑值。
 */
let originalDraftSnapshot: ProjectDraft | null = null

/**
 * 模型实时输出片段合并（2026-09-28）：推理模型一次生成会推几千个片段，逐个 set 会让整页逐个重渲染；
 * 断线重连时服务端还会把之前的片段一次性重放。实测页面在生成后半段与重连后完全卡死。
 * 浏览器里先攒着，每 100ms 合并成一次 set；其它事件到达前先把攒着的落下，保证先后顺序。
 * 测试环境保持逐个同步归约（用例 apply 后立刻断言）。
 */
const OUTPUT_BATCHING = process.env.NODE_ENV !== 'test'
const OUTPUT_FLUSH_MS = 100
let pendingOutput: Extract<ProjectDraftStreamEvent, { type: 'generation.output' }>[] = []
let outputFlushTimer: ReturnType<typeof setTimeout> | null = null

function takePendingOutput() {
  if (outputFlushTimer) clearTimeout(outputFlushTimer)
  outputFlushTimer = null
  const pieces = pendingOutput
  pendingOutput = []
  return pieces
}

function mergeOutputPieces(
  state: Pick<AiProjectDraftState, 'streamOutput' | 'streamLanes'>,
  pieces: Extract<ProjectDraftStreamEvent, { type: 'generation.output' }>[],
): Pick<AiProjectDraftState, 'streamOutput' | 'streamOutputActive' | 'streamLanes'> {
  let streamOutput = state.streamOutput
  let streamLanes = state.streamLanes
  for (const piece of pieces) {
    // 思考过程只进分道展示，不算草案正文输出
    if (piece.kind !== 'reasoning') streamOutput += piece.text
    streamLanes = appendOutputPiece(streamLanes, piece)
  }
  return { streamOutput, streamOutputActive: true, streamLanes }
}

export const useAiProjectDraftStore = create<AiProjectDraftState>()(
  persist(
    (set, get) => ({
      ...initialData,
      userId: null,
      organizationId: null,

      initializeScope: (scope) => {
        const state = get()
        if (isCrossScopeSwitch(state, scope)) {
          clearDraftProgressCursor()
          set(clearForScope(scope))
          return
        }
        const updates: Partial<AiProjectDraftState> = {
          restored: Boolean(state.rawInput || state.cards.length || state.context),
        }
        if (scope.userId !== null && state.userId !== scope.userId) {
          updates.userId = scope.userId
        }
        if (scope.organizationId !== null && state.organizationId !== scope.organizationId) {
          updates.organizationId = scope.organizationId
        }
        set(updates)
      },

      setRawInput: (rawInput) => set({ rawInput, error: null }),

      addMentionedMember: (member) =>
        set((state) => ({
          mentionedMembers: [
            ...state.mentionedMembers.filter((item) => item.userId !== member.userId),
            member,
          ],
          context: withMentionedMembers(state.context, [
            ...state.mentionedMembers.filter((item) => item.userId !== member.userId),
            member,
          ]),
        })),

      setUnderstandingStatus: (understandingStatus) => set({ understandingStatus }),

      setModelSelection: (modelSelection) => set({ modelSelection }),
      setAutoPilot: (autoPilot) => set({ autoPilot }),

      setUnderstandingDraft: (understanding, serverContext) =>
        set((state) => ({
          understandingStatus: 'ready',
          understandingDraft: understanding,
          feasibilityAssessment: null,
          feasibilityChat: [],
          context: serverContext
            ? withMentionedMembers(
                { ...serverContext, planUnderstanding: undefined },
                state.mentionedMembers,
              )
            : state.context,
        })),

      confirmUnderstanding: (understanding) =>
        set((state) => ({
          understandingStatus: 'confirmed',
          understandingDraft: understanding,
          feasibilityAssessment: null,
          feasibilityChat: [],
          context: state.context
            ? {
                ...state.context,
                planUnderstanding: { ...understanding, confirmedByUser: true },
                feasibilityDecision: undefined,
              }
            : state.context,
        })),

      setFeasibilityAssessment: (feasibilityAssessment) => set({ feasibilityAssessment }),

      appendFeasibilityChat: (turn) =>
        set((state) => ({ feasibilityChat: [...state.feasibilityChat, turn].slice(-20) })),

      setFeasibilityDecision: (decision) =>
        set((state) => ({
          context: state.context
            ? { ...state.context, feasibilityDecision: decision ?? undefined }
            : state.context,
        })),

      startAnalyzing: () => set({ status: 'analyzing', error: null }),

      setRequirementBrief: (requirementBrief, requirementBriefFor) =>
        set({ requirementBrief, requirementBriefFor }),

      applyAnalysis: (response, rawInput, submittedAnswers) =>
        set((state) => {
          // 自适应会话：把当前问题渲染成卡片（服务端返回 cards: []）。
          const adaptiveCards = adaptiveQuestionCards(response)
          const cards = adaptiveCards ?? response.cards
          // 服务端追问停在守卫态（出不了下一题、也不能直接生成）：停下来说明原因，
          // 等用户点「重新分析」。原先按「继续澄清」处理却没有题，界面显示「全部作答完成」后
          // 自动再请求一次，拿回同一个守卫态，无限循环。
          const guarded =
            response.branch !== 'ready' &&
            response.adaptiveSession?.status === 'needs_human_review' &&
            (!adaptiveCards || adaptiveCards.length === 0)
          return {
            pendingAdaptiveResponse: null,
            status: guarded ? 'error' : response.branch === 'ready' ? 'ready' : 'clarifying',
            error: guarded
              ? `追问暂时无法继续：${response.adaptiveSession?.guardReason ?? '问题没有通过措辞检查'}。可以点「重新分析」用已回答的内容重试。`
              : null,
            rawInput: rawInput ?? state.rawInput,
            answers: submittedAnswers ?? state.answers,
            cards,
            clarificationPhase: response.phase ?? (response.branch === 'ready' ? 'ready' : 'core'),
            activeCard: adaptiveCards
              ? (adaptiveCards[0] ?? null)
              : (response.activeCard ?? response.cards[0] ?? null),
            remainingCount: response.remainingCount ?? cards.length,
            completedCount: response.completedCount ?? Object.keys(state.answers).length,
            totalCount:
              response.totalCount ?? Object.keys(state.answers).length + response.cards.length,
            questionPlanRevision: response.questionPlanRevision ?? null,
            agentQuestionPlanToken: response.agentQuestionPlanToken ?? null,
            adaptiveSession: response.adaptiveSession ?? null,
            adaptiveSessionToken: response.adaptiveSessionToken ?? null,
            questionPlanCoverage: response.coverage ?? null,
            parsedIntent: response.parsedIntent,
            context: withMentionedMembers(response.confirmedContext, state.mentionedMembers),
            // 上下文变了，之前的项目理解作废，就绪页重新梳理。
            understandingStatus: 'idle',
            understandingDraft: null,
            restored: false,
          }
        }),

      recordAnswer: (answer) =>
        set((state) =>
          isAdaptiveCard(answer.cardId)
            ? {
                // 自适应回答不进固定字段 answers，作为对话回复在下一次 analyze 发出。
                pendingAdaptiveResponse: adaptiveAnswerText(
                  answer,
                  state.cards.find((card) => card.cardId === answer.cardId) ?? null,
                ),
                cards: state.cards.filter((card) => card.cardId !== answer.cardId),
                activeCard: null,
                error: null,
              }
            : {
                answers: { ...state.answers, [answer.field]: answer },
                cards: state.cards.filter((card) => card.field !== answer.field),
                activeCard: null,
                error: null,
              },
        ),

      fail: (message) => set({ status: 'error', error: message }),

      retry: () => set({ status: 'analyzing', error: null }),

      restart: () =>
        set((state) => {
          clearAnalysisJobHandles()
          clearDraftProgressCursor()
          return {
            ...clearForScope({ userId: state.userId, organizationId: state.organizationId }),
          }
        }),

      clearDraft: () =>
        set((state) => {
          clearDraftProgressCursor()
          return {
            ...clearForScope({ userId: state.userId, organizationId: state.organizationId }),
          }
        }),

      setRestored: (restored) => set({ restored }),

      startDraftGeneration: (draftId) => {
        takePendingOutput()
        set({
          draftStatus: 'drafting',
          draftId,
          draftVersion: 1,
          draft: null,
          draftMeta: null,
          draftFailure: null,
          validation: null,
          draftEvents: [],
          moduleStatuses: {},
          confirmResponse: null,
          lastEventSequence: 0,
          progressProjection: createDraftProgressProjection({
            draftId,
            version: 1,
            connection: 'connecting',
          }),
          streamOutput: '',
          streamOutputActive: false,
          streamLanes: [],
          pendingModifications: [],
          error: null,
        })
      },

      retryDraftGeneration: () => {
        takePendingOutput()
        set((state) => ({
          draftStatus: 'drafting',
          // draftId 保留（服务端复用同一会话续跑 checkpoint）；
          // draftVersion 先乐观 +1，draft.started 事件到达后以事件版本为准。
          draftVersion: state.draftVersion + 1,
          draft: null,
          draftMeta: null,
          draftFailure: null,
          validation: null,
          draftEvents: [],
          moduleStatuses: {},
          confirmResponse: null,
          lastEventSequence: 0,
          progressProjection: createDraftProgressProjection({
            draftId: state.draftId ?? 'pending',
            version: state.draftVersion + 1,
            connection: 'connecting',
          }),
          streamOutput: '',
          streamOutputActive: false,
          streamLanes: [],
          pendingModifications: [],
          error: null,
        }))
      },

      applyDraftFieldEdit: (path, value) =>
        set((state) => {
          if (!state.draft) return {}
          const nextDraft = applyLocalModification(state.draft, { path, value }) as ProjectDraft
          const rest = state.pendingModifications.filter((m) => m.path !== path)
          return {
            draft: nextDraft,
            pendingModifications: [...rest, { path, value }],
            draftStatus: 'editing',
          }
        }),

      resetDraftFieldEdit: (path) =>
        set((state) => {
          if (!state.draft) return {}
          const rest = state.pendingModifications.filter((m) => m.path !== path)
          const original = originalDraftSnapshot
          if (!original) return { pendingModifications: rest }
          let base = JSON.parse(JSON.stringify(original)) as ProjectDraft
          for (const mod of rest) {
            base = applyLocalModification(base, mod) as ProjectDraft
          }
          return { draft: base, pendingModifications: rest }
        }),

      resetTaskEdits: (taskId) =>
        set((state) => {
          if (!state.draft) return {}
          const prefix = `tasks[${taskId}]`
          const rest = state.pendingModifications.filter((m) => !m.path.startsWith(prefix))
          const original = originalDraftSnapshot
          if (!original) return { pendingModifications: rest }
          let base = JSON.parse(JSON.stringify(original)) as ProjectDraft
          for (const mod of rest) {
            base = applyLocalModification(base, mod) as ProjectDraft
          }
          return { draft: base, pendingModifications: rest }
        }),

      applyDraftEvent: (event) => {
        if (event.type === 'generation.output' && OUTPUT_BATCHING) {
          pendingOutput.push(event)
          if (!outputFlushTimer) {
            outputFlushTimer = setTimeout(() => {
              const pieces = takePendingOutput()
              if (pieces.length > 0) set((state) => mergeOutputPieces(state, pieces))
            }, OUTPUT_FLUSH_MS)
          }
          return
        }
        const buffered = takePendingOutput()
        if (buffered.length > 0) set((state) => mergeOutputPieces(state, buffered))
        set((state) => {
          // v3-ai-draft-live-output-panel：generation.output 是瞬时观察事件，
          // 独立归约（追加文本 + 活跃标记），不推进语义 sequence、不触发 gap、
          // 不写恢复 cursor —— 与 draft.heartbeat 同属序列外通道。
          if (event.type === 'generation.output') {
            return {
              // 思考过程只进分道展示，不算草案正文输出
              streamOutput:
                event.kind === 'reasoning' ? state.streamOutput : state.streamOutput + event.text,
              streamOutputActive: true,
              streamLanes: appendOutputPiece(state.streamLanes, event),
            }
          }
          const projection = reduceDraftProgress(state.progressProjection, {
            kind: 'event',
            event,
          })
          const accepted =
            event.type === 'draft.heartbeat' ||
            projection.lastSequence > state.progressProjection.lastSequence
          const events = accepted ? [...state.draftEvents, event].slice(-200) : state.draftEvents
          if (accepted && event.type !== 'draft.heartbeat') {
            if (event.type === 'draft.completed' || event.type === 'draft.failed') {
              clearDraftProgressCursor()
            } else if (
              state.userId !== null &&
              state.organizationId !== null &&
              event.draftId !== 'pending'
            ) {
              writeDraftProgressCursor({
                userId: state.userId,
                organizationId: state.organizationId,
                draftId: event.draftId,
                version: event.version,
                lastSequence: projection.lastSequence,
              })
            }
          }
          const session = {
            draftId: event.draftId,
            draftVersion: event.version,
          }
          const terminal = event.type === 'draft.completed' || event.type === 'draft.failed'
          const failureDetail: ProjectDraftFailureDetail | null =
            event.type === 'draft.failed'
              ? {
                  errorCode: event.errorCode,
                  message: event.message,
                  consistency: event.consistency,
                  sequence: event.sequence,
                  stage: event.stage,
                  reasonCode: event.reasonCode,
                  errors: event.errors,
                }
              : state.draftFailure
          return {
            ...session,
            draftEvents: events,
            lastEventSequence: projection.lastSequence,
            moduleStatuses: projection.modules,
            progressProjection: projection,
            // 终态停止「生成中」标记，保留已累积文本供查看
            streamOutputActive: terminal ? false : state.streamOutputActive,
            streamLanes: terminal ? closeOutputLanes(state.streamLanes) : state.streamLanes,
            draftFailure: failureDetail,
          }
        })
      },

      applyDraftEnvelope: (envelope) =>
        set((state) => {
          const action = streamingEnvelopeToDraftAction(envelope)
          if (!action) return {}
          const projection = reduceDraftProgress(state.progressProjection, action)
          // 写入 cursor（非终态、非 heartbeat）
          if (
            envelope.type !== 'heartbeat' &&
            envelope.type !== 'completed' &&
            envelope.type !== 'failed' &&
            envelope.type !== 'cancelled' &&
            state.userId !== null &&
            state.organizationId !== null
          ) {
            const dp = envelope._domainPayload as { draftId?: string } | undefined
            if (dp?.draftId && dp.draftId !== 'pending') {
              writeDraftProgressCursor({
                userId: state.userId,
                organizationId: state.organizationId,
                draftId: dp.draftId,
                version: 1,
                lastSequence: projection.lastSequence,
              })
            }
          }
          // 终态时清理 cursor
          if (
            envelope.type === 'completed' ||
            envelope.type === 'failed' ||
            envelope.type === 'cancelled'
          ) {
            clearDraftProgressCursor()
          }
          return {
            progressProjection: projection,
            moduleStatuses: projection.modules,
            lastEventSequence: projection.lastSequence,
          }
        }),

      applyDraftProgressAction: (action) =>
        set((state) => {
          const progressProjection = reduceDraftProgress(state.progressProjection, action)
          return {
            progressProjection,
            moduleStatuses: progressProjection.modules,
            lastEventSequence: progressProjection.lastSequence,
          }
        }),

      setDraftCompleted: (draft, meta, validation) =>
        set((state) => {
          originalDraftSnapshot = draft
          return {
            draft,
            draftMeta: meta,
            draftFailure: null,
            validation,
            draftStatus: null,
            error: null,
            progressProjection: reduceDraftProgress(state.progressProjection, {
              kind: 'review.ready',
            }),
          }
        }),

      setDraftFailed: (errorCode, message, failure) =>
        set({
          draftStatus: 'error',
          error: `[${errorCode}] ${message}`,
          draftFailure: failure
            ? {
                errorCode,
                message,
                consistency: failure.consistency ?? 'failed',
                sequence: failure.sequence ?? 0,
                stage: failure.stage,
                reasonCode: failure.reasonCode,
                errors: failure.errors,
              }
            : null,
        }),

      enterReview: () =>
        set({
          draftStatus: 'reviewing',
          error: null,
        }),

      enterEditing: () =>
        set({
          draftStatus: 'editing',
          error: null,
        }),

      enterApplying: () =>
        set({
          draftStatus: 'applying',
          error: null,
        }),

      enterConfirmed: (response) =>
        set({
          draftStatus: 'confirmed',
          confirmResponse: response,
          error: null,
        }),

      enterSaved: () =>
        set({
          draftStatus: 'saved',
          error: null,
        }),

      enterRejected: () =>
        set({
          draftStatus: 'rejected',
          error: null,
        }),

      setDraftError: (message) =>
        set({
          draftStatus: 'error',
          error: message,
          draftFailure: null,
        }),

      resetToContext: () =>
        set((_state) => {
          clearDraftProgressCursor()
          return {
            draftStatus: null,
            draftId: null,
            draftVersion: 0,
            draft: null,
            draftMeta: null,
            draftFailure: null,
            validation: null,
            draftEvents: [],
            moduleStatuses: {},
            confirmResponse: null,
            lastEventSequence: 0,
            progressProjection: createDraftProgressProjection(),
            streamOutput: '',
            streamOutputActive: false,
            streamLanes: [],
            pendingModifications: [],
            error: null,
          }
        }),

      clearDraftSession: () =>
        set(() => {
          clearDraftProgressCursor()
          return {
            draftStatus: null,
            draftId: null,
            draftVersion: 0,
            draft: null,
            draftMeta: null,
            draftFailure: null,
            validation: null,
            draftEvents: [],
            moduleStatuses: {},
            confirmResponse: null,
            lastEventSequence: 0,
            progressProjection: createDraftProgressProjection(),
            streamOutput: '',
            streamOutputActive: false,
            streamLanes: [],
            pendingModifications: [],
            error: null,
          }
        }),

      clearStreamOutput: () => {
        takePendingOutput()
        set({
          streamOutput: '',
          streamLanes: [],
        })
      },
    }),
    {
      name: AI_PROJECT_DRAFT_STORAGE_KEY,
      // 生成时每个输出片段都会 set 一次：浏览器里合并写入，否则整份序列化几千次会卡死页面；
      // 测试环境保持同步写入（大量用例 set 后立刻读 sessionStorage）。
      storage:
        process.env.NODE_ENV === 'test'
          ? createJSONStorage(() => sessionStorage)
          : throttledSessionStorage(),
      partialize: (state) => ({
        schemaVersion: state.schemaVersion,
        userId: state.userId,
        organizationId: state.organizationId,
        status: persistableDraftStatus(state),
        rawInput: state.rawInput,
        requirementBrief: state.requirementBrief,
        requirementBriefFor: state.requirementBriefFor,
        cards: state.cards,
        answers: state.answers,
        parsedIntent: state.parsedIntent,
        context: state.context,
        clarificationPhase: state.clarificationPhase,
        activeCard: state.activeCard,
        remainingCount: state.remainingCount,
        completedCount: state.completedCount,
        totalCount: state.totalCount,
        questionPlanRevision: state.questionPlanRevision,
        agentQuestionPlanToken: state.agentQuestionPlanToken,
        adaptiveSession: state.adaptiveSession,
        adaptiveSessionToken: state.adaptiveSessionToken,
        questionPlanCoverage: state.questionPlanCoverage,
        error: state.error,
        draftStatus: state.draftStatus,
        draftId: state.draftId,
        draftVersion: state.draftVersion,
        draft: state.draft,
        draftMeta: state.draftMeta,
        draftFailure: state.draftFailure,
        validation: state.validation,
        moduleStatuses: state.moduleStatuses,
        confirmResponse: state.confirmResponse,
        lastEventSequence: state.lastEventSequence,
        progressProjection: state.progressProjection,
        pendingModifications: state.pendingModifications,
        mentionedMembers: state.mentionedMembers,
        understandingStatus:
          state.understandingStatus === 'loading' ? 'idle' : state.understandingStatus,
        understandingDraft: state.understandingDraft,
        modelSelection: state.modelSelection,
        pendingAdaptiveResponse: state.pendingAdaptiveResponse,
        feasibilityAssessment: state.feasibilityAssessment,
        feasibilityChat: state.feasibilityChat,
      }),
      merge: (persisted, current) => {
        const value = persisted as Partial<AiProjectDraftState> | undefined
        if (!value || value.schemaVersion !== AI_INTENT_SCHEMA_VERSION) return current
        return { ...current, ...value, restored: Boolean(value.rawInput || value.context) }
      },
    },
  ),
)

/**
 * 「分析中」只在本页的请求进行时成立；刷新后没有请求在等结果，原样恢复会卡在「正在分析」、
 * 重新分析按钮也是禁用的。正在提交的那条回答只在请求里、还没写进 answers，无法原样续上，
 * 所以落盘时退回到发起分析前的状态：有问题卡就回到澄清（重新作答当前卡），否则回到输入。
 */
export function persistableDraftStatus(
  state: Pick<AiProjectDraftState, 'status' | 'cards' | 'activeCard'>,
): AiProjectDraftStatus {
  if (state.status !== 'analyzing') return state.status
  return state.cards.length > 0 || state.activeCard ? 'clarifying' : 'idle'
}

export function buildClarificationAnswer(
  card: ClarificationCard,
  action: ClarificationAnswer['action'],
  value: ClarificationAnswer['value'],
): ClarificationAnswer {
  return {
    field: card.field as ClarificationField,
    action,
    value,
    marker: action === 'default' ? (card.defaultValue?.marker ?? null) : null,
    cardId: card.cardId,
    source: card.source,
  }
}
