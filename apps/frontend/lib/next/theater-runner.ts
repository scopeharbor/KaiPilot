/**
 * 生成剧场后台运行器：意图分析、项目理解、全自动开始生成、草案生成流都在这里驱动，
 * 不随生成剧场页面卸载而中止——离开 /next/create 去别的页面，生成照常进行；
 * 回到剧场页时页面只负责展示与交互（数据都在 useAiProjectDraftStore）。
 *
 * 由新版外壳常驻的 `TheaterBackgroundRunner` 调用 `startTheaterRunner()` 订阅草案 store：
 * - status 进入 analyzing → 发起分析（离开 analyzing 才中止）；
 * - 就绪且项目理解未开始 → 自动梳理项目理解（只读接口）；
 * - 全自动（autoPilot）且就绪、理解已完成 → 自动开始生成草案；
 * - draftStatus 离开 drafting → 中止旧的生成连接；
 * - 启动时若有持久化的 drafting 会话 → 续传（不发起新生成）。
 * 生成本身仍只产出草案；转正走审查页确认或 AI 同事全自动（用户明确选择）。
 */
import { create } from 'zustand'
import type {
  ClarificationCard,
  ConfirmedProjectContext,
  ProjectDraftStreamEvent,
} from '@aiproj/types'
import { aiIntentApi } from '@/lib/api/ai-intent'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { apiErrorMessage } from '@/lib/api-client'
import { maskMentions } from '@/lib/member-mask'
import { newLiveOutputId } from '@/lib/ai-draft/live-output-client'
import {
  runDraftGenerationStream,
  type TheaterConnectionHealth,
  type TheaterStreamOutcome,
} from '@/lib/next/theater-sse-client'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/** 固定规则意图分析不调用慢推理模型，保留短超时守卫。 */
export const ANALYZE_TIMEOUT_MS = 20_000
/**
 * 选了模型时走自适应澄清。部分推理模型在首个答案 token 前不会输出思考 token，
 * 因此不能用流式静默判断断网；这里只保留 25 分钟的整轮硬上限。
 */
export const ADAPTIVE_ANALYZE_TIMEOUT_MS = 25 * 60_000

/** 占位草案 ID：真实 ID 由服务端 draft.started（sequence=1）下发。 */
export const PENDING_DRAFT_ID = 'pending'

interface TheaterRunnerState {
  /** 意图分析的实时输出频道。 */
  analyzeLiveId: string | null
  /** 项目理解的实时输出频道与失败原因。 */
  understandingLiveId: string | null
  understandingError: string | null
  /** 生成流连接健康度（舞台恢复提示条）。 */
  streamHealth: TheaterConnectionHealth | null
  /** 最近一次非空的问题卡集（就绪页「重新调整回答」回跳第一题）。 */
  lastCardSet: ClarificationCard[]
}

export const useTheaterRunnerStore = create<TheaterRunnerState>(() => ({
  analyzeLiveId: null,
  understandingLiveId: null,
  understandingError: null,
  streamHealth: null,
  lastCardSet: [],
}))

// ---------------------------------------------------------------------------
// 意图分析
// ---------------------------------------------------------------------------

let analysis: { controller: AbortController; timer: number; disposed: boolean } | null = null

export function cancelTheaterAnalysis(): void {
  if (!analysis) return
  analysis.disposed = true
  window.clearTimeout(analysis.timer)
  analysis.controller.abort()
  analysis = null
}

/** 统一分析通道（与旧轨 AiProjectIntentWorkspace 的请求体契约对齐，RL-04）。 */
export function runTheaterAnalysis(): void {
  cancelTheaterAnalysis()
  const liveId = newLiveOutputId()
  useTheaterRunnerStore.setState({ analyzeLiveId: liveId })
  const controller = new AbortController()
  const snapshot = useAiProjectDraftStore.getState()
  const timeoutMs = snapshot.modelSelection ? ADAPTIVE_ANALYZE_TIMEOUT_MS : ANALYZE_TIMEOUT_MS
  const run = {
    controller,
    timer: window.setTimeout(() => controller.abort(), timeoutMs),
    disposed: false,
  }
  analysis = run

  void aiIntentApi
    .analyze(
      {
        // @ 的成员在发给模型前换成代号「成员#id」，姓名不出本系统。
        rawInput: maskMentions(snapshot.rawInput.trim(), snapshot.mentionedMembers),
        liveOutputId: liveId,
        // 长需求的整理稿（仍对应当前原文时才带；追问读它，判断开工日 / 工期 / 团队仍用原文）。
        ...(snapshot.requirementBrief && snapshot.requirementBriefFor === snapshot.rawInput.trim()
          ? { requirementBrief: snapshot.requirementBrief }
          : {}),
        answers: snapshot.answers,
        adaptiveSession: snapshot.adaptiveSession ?? undefined,
        adaptiveSessionToken: snapshot.adaptiveSessionToken ?? undefined,
        questionPlanRevision: snapshot.questionPlanRevision ?? undefined,
        agentQuestionPlanToken: snapshot.agentQuestionPlanToken ?? undefined,
        // 守卫态重试：让服务端用已回答的内容重跑理解，而不是原样返回同一个卡住的会话。
        ...(snapshot.adaptiveSession?.status === 'needs_human_review' &&
        snapshot.adaptiveSessionToken
          ? { retryGuardedSession: true }
          : {}),
        // 带上所选模型才会走自适应澄清（否则服务端退回固定问卷）。
        ...(snapshot.modelSelection ?? {}),
        ...(snapshot.pendingAdaptiveResponse && snapshot.adaptiveSessionToken
          ? {
              adaptiveResponse: {
                text: maskMentions(snapshot.pendingAdaptiveResponse, snapshot.mentionedMembers),
                intents: [],
              },
            }
          : {}),
      },
      controller.signal,
      {
        onProgress: (job) => {
          if (!run.disposed) useTheaterRunnerStore.setState({ analyzeLiveId: job.liveOutputId })
        },
      },
    )
    .then((response) => {
      if (run.disposed) return
      // 先摘掉在途标记：写回结果会离开 analyzing，不要再去中止这个已完成的请求
      window.clearTimeout(run.timer)
      if (analysis === run) analysis = null
      // 保留最近一次**非空**解析卡集（ready 直通的空卡集不得覆盖）。
      if (response.cards.length > 0) useTheaterRunnerStore.setState({ lastCardSet: response.cards })
      useAiProjectDraftStore.getState().applyAnalysis(response, snapshot.rawInput, snapshot.answers)
    })
    .catch((failure) => {
      if (run.disposed) return // 状态已切换：本次请求结果不再生效
      const message = controller.signal.aborted
        ? `意图解析达到整轮等待上限（${Math.round(timeoutMs / 60_000)} 分钟），未能完成解析；这不代表本机网络异常`
        : apiErrorMessage(failure, '意图分析未能完成，原输入与已答内容仍保留。')
      useAiProjectDraftStore.getState().fail(message)
    })
    .finally(() => {
      window.clearTimeout(run.timer)
      if (analysis === run) analysis = null
    })
}

// ---------------------------------------------------------------------------
// 项目理解（只读接口，不属于草案生成）
// ---------------------------------------------------------------------------

let understandingRequest = 0
let understandingController: AbortController | null = null

export function cancelTheaterUnderstanding(): void {
  understandingRequest += 1
  understandingController?.abort()
  understandingController = null
}

export async function runTheaterUnderstanding(): Promise<void> {
  const store = useAiProjectDraftStore.getState()
  if (!store.context) return
  const requestId = ++understandingRequest
  understandingController?.abort()
  const controller = new AbortController()
  understandingController = controller
  store.setUnderstandingStatus('loading')
  const liveId = newLiveOutputId()
  useTheaterRunnerStore.setState({ understandingLiveId: liveId, understandingError: null })
  try {
    const { planUnderstanding: _omit, ...context } = store.context
    void _omit
    const result = await aiDraftApi.understanding(
      { context, ...(store.modelSelection ?? {}), liveOutputId: liveId },
      controller.signal,
      {
        onProgress: (job) => {
          if (requestId === understandingRequest) {
            useTheaterRunnerStore.setState({ understandingLiveId: job.liveOutputId })
          }
        },
      },
    )
    if (requestId !== understandingRequest) return
    useAiProjectDraftStore.getState().setUnderstandingDraft(result.understanding, result.context)
  } catch (failure) {
    if (requestId !== understandingRequest) return
    useAiProjectDraftStore.getState().setUnderstandingStatus('error')
    useTheaterRunnerStore.setState({
      understandingError: apiErrorMessage(failure, '项目理解未能完成，请重试。'),
    })
  } finally {
    if (understandingController === controller) understandingController = null
  }
}

// ---------------------------------------------------------------------------
// 草案生成流
// ---------------------------------------------------------------------------

/**
 * 生成请求的上下文：已确认的项目理解随 context 提交；已梳理但用户没点确认时，
 * 也带上（标记未确认），避免生成时再梳理一遍、结果还可能不一样。
 */
export function theaterGenerationContext(): ConfirmedProjectContext | null {
  const store = useAiProjectDraftStore.getState()
  if (!store.context) return null
  if (store.context.planUnderstanding || !store.understandingDraft) return store.context
  return {
    ...store.context,
    planUnderstanding: { ...store.understandingDraft, confirmedByUser: false },
  }
}

/** 流式事件统一归约：常规事件推进进度投影，终态事件沉淀权威实体（幂等）。 */
function handleDraftStreamEvent(event: ProjectDraftStreamEvent) {
  const store = useAiProjectDraftStore.getState()
  store.applyDraftEvent(event)
  if (event.type === 'draft.completed') {
    store.setDraftCompleted(event.draft, event.meta, event.validation)
  } else if (event.type === 'draft.failed') {
    store.setDraftFailed(event.errorCode, event.message, {
      consistency: event.consistency,
      sequence: event.sequence,
      stage: event.stage,
      reasonCode: event.reasonCode,
      errors: event.errors,
    })
  }
}

/** 网络级不可恢复失败只通过 outcome 表达：补记带失败详情的错误终态。 */
function handleStreamOutcome(outcome: TheaterStreamOutcome) {
  if (outcome.status !== 'failed') return
  const store = useAiProjectDraftStore.getState()
  if (store.draftStatus === 'error') return
  const errorCode = outcome.errorCode ?? 'SSE_CONNECTION_FAILED'
  const message = outcome.message ?? '生成连接失败，请重试生成。'
  store.setDraftFailed(errorCode, message, {
    errorCode,
    message,
    consistency: 'failed',
    sequence: outcome.lastSequence,
  })
}

/** 连接健康度 → 进度投影（reconnecting / live）与舞台提示条。 */
function mapStreamHealth(health: TheaterConnectionHealth): void {
  useTheaterRunnerStore.setState({ streamHealth: health })
  const store = useAiProjectDraftStore.getState()
  if (health === 'reconnecting') {
    store.applyDraftProgressAction({ kind: 'transport.connecting' })
  } else if (health === 'healthy' || health === 'long_running') {
    store.applyDraftProgressAction({ kind: 'transport.live' })
  }
}

let generationController: AbortController | null = null

export function abortTheaterGeneration(): void {
  generationController?.abort()
  generationController = null
}

/**
 * 发起一轮生成流：全新生成（重置草案现场）、刷新恢复（resume 续传）
 * 或失败重试（retryOfDraftId：复用会话 POST /retry，checkpoint 断点续跑）。
 */
export function startTheaterGeneration(
  context: ConfirmedProjectContext,
  resume?: { draftId: string; lastSequence: number },
  retryOfDraftId?: string,
): void {
  abortTheaterGeneration()
  const controller = new AbortController()
  generationController = controller
  useTheaterRunnerStore.setState({ streamHealth: null })
  if (resume) {
    // 续传：store 现场保留
  } else if (retryOfDraftId) {
    useAiProjectDraftStore.getState().retryDraftGeneration()
  } else {
    useAiProjectDraftStore.getState().startDraftGeneration(PENDING_DRAFT_ID)
  }
  void runDraftGenerationStream({
    context,
    ...(useAiProjectDraftStore.getState().modelSelection ?? {}),
    resume: resume ?? null,
    retryOf: retryOfDraftId ?? null,
    signal: controller.signal,
    onEvent: handleDraftStreamEvent,
    onHealthChange: mapStreamHealth,
    onSnapshotResolved: (detail) => {
      // 游标失效降级：快照显示草案已落定而无完成事件回放时，直接沉淀权威实体（仅草案会话）。
      const store = useAiProjectDraftStore.getState()
      if (detail.draft && detail.validation && detail.meta) {
        store.setDraftCompleted(detail.draft, detail.meta, detail.validation)
      }
    },
  }).then((outcome) => {
    if (generationController === controller) generationController = null
    handleStreamOutcome(outcome)
  })
}

/** 用已就绪上下文开始生成（剧场「开始生成」与全自动共用）。 */
export function startTheaterGenerationFromContext(): boolean {
  const context = theaterGenerationContext()
  if (!context) return false
  startTheaterGeneration(context)
  return true
}

// ---------------------------------------------------------------------------
// 订阅：常驻驱动
// ---------------------------------------------------------------------------

type DraftState = ReturnType<typeof useAiProjectDraftStore.getState>

/** 就绪且还没开始生成（与剧场页 isReady 同口径）。 */
export function isTheaterReady(state: DraftState): boolean {
  const generating = state.draftStatus === 'drafting' && !state.draft && !state.draftFailure
  const settled = Boolean(state.draft && state.validation)
  const failed =
    state.status === 'error' || state.draftStatus === 'error' || state.draftFailure !== null
  return state.status === 'ready' && !generating && !settled && !failed
}

function evaluate(state: DraftState, previous: DraftState | null): void {
  // 分析：进入 analyzing 发起；离开 analyzing 中止
  if (state.status === 'analyzing' && previous?.status !== 'analyzing') runTheaterAnalysis()
  if (state.status !== 'analyzing' && previous?.status === 'analyzing') cancelTheaterAnalysis()
  // 生成流：离开 drafting（落定 / 失败 / 重开 / 重试）立即中止旧连接
  if (state.draftStatus !== 'drafting' && previous?.draftStatus === 'drafting') {
    abortTheaterGeneration()
  }
  const ready = isTheaterReady(state)
  // 项目理解：就绪后自动梳理一次
  if (ready && state.context && state.understandingStatus === 'idle') {
    void runTheaterUnderstanding()
    return
  }
  // 全自动：就绪且项目理解完成（或失败）后自动开始生成
  if (
    ready &&
    state.autoPilot &&
    state.understandingStatus !== 'idle' &&
    state.understandingStatus !== 'loading'
  ) {
    useAiProjectDraftStore.getState().setAutoPilot(false)
    startTheaterGenerationFromContext()
  }
}

/** 使用者计数：外壳常驻一份、剧场页一份；最后一个使用者卸载才真正停止（外壳在 → 离开剧场页不停）。 */
let runnerUsers = 0
let stopRunner: (() => void) | null = null

function launchRunner(): () => void {
  // 刷新恢复：持久化的 drafting 会话续传（Last-Event-ID 语义），不发起新生成。
  const initial = useAiProjectDraftStore.getState()
  if (
    initial.draftStatus === 'drafting' &&
    initial.context &&
    initial.draftId &&
    initial.draftId !== PENDING_DRAFT_ID &&
    initial.lastEventSequence > 0
  ) {
    startTheaterGeneration(initial.context, {
      draftId: initial.draftId,
      lastSequence: initial.lastEventSequence,
    })
  }
  evaluate(initial, null)
  const unsubscribe = useAiProjectDraftStore.subscribe((state, previous) =>
    evaluate(state, previous),
  )
  return () => {
    unsubscribe()
    cancelTheaterAnalysis()
    cancelTheaterUnderstanding()
    abortTheaterGeneration()
  }
}

/** 启动常驻驱动（外壳与剧场页挂载时各调用一次）；返回释放函数。 */
export function startTheaterRunner(): () => void {
  runnerUsers += 1
  if (runnerUsers === 1) stopRunner = launchRunner()
  let released = false
  return () => {
    if (released) return
    released = true
    runnerUsers -= 1
    if (runnerUsers === 0) {
      stopRunner?.()
      stopRunner = null
    }
  }
}
