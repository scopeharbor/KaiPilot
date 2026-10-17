'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useCopilotOperatingEntry } from '@/lib/copilot/operating-entry'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Globe,
  HelpCircle,
  ListChecks,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Zap,
  ExternalLink,
} from 'lucide-react'
import { AiChip } from '@/components/ui/AiChip'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import {
  DraftGenerationProgress,
  moduleLabels,
} from '@/components/ai-copilot/DraftGenerationProgress'
import { DraftOutputPanel } from '@/components/ai-copilot/DraftOutputPanel'
import { DraftReviewPanel } from '@/components/ai-copilot/DraftReviewPanel'
import { DraftErrorPanel } from '@/components/ai-copilot/DraftErrorPanel'
import { aiIntentApi, type ExplainClarificationTurn } from '@/lib/api/ai-intent'
import { apiErrorMessage } from '@/lib/api-client'
import { aiDraftApi, consumeDraftSse } from '@/lib/api/ai-draft'
import { aiConnectionsApi } from '@/lib/api/ai-connections'
import { readDraftProgressCursor } from '@/lib/ai-draft/progress-cursor'
import { newLiveOutputId, useLiveOutputLanes } from '@/lib/ai-draft/live-output-client'
import type { OutputLane } from '@/lib/ai-draft/output-lanes'
import { LiveOutputPanel } from '@/components/next/theater/TheaterLiveOutput'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import {
  buildClarificationAnswer,
  useAiProjectDraftStore,
  type AiProjectDraftStatus,
} from '@/stores/ai-project-draft-store'
import type {
  AnalyzeProjectIntentResponse,
  AnalyzeProjectIntentRequest,
  AdaptiveClarificationSession,
  ClarificationAnswer,
  ClarificationAnswers,
  ClarificationCard as ClarificationCardType,
  ClarificationCategory,
  ClarificationValue,
  ConfirmProjectDraftRequest,
  ProjectType,
  AiConnectionModelDto,
} from '@aiproj/types'

const MIN_INPUT = 10
const MAX_INPUT = 4000
const STREAM_SILENCE_TIMEOUT_MS = 20_000
const MAX_AUTO_RECONNECT_ATTEMPTS = 3
const RECONNECT_BACKOFF_DELAYS = [1000, 2000, 4000]

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

const projectTypeLabels: Record<ProjectType, string> = {
  software: '软件 / 系统',
  event: '活动 / 会务',
  research: '研究 / 调研',
  product: '产品 / 上市',
  general: '通用项目',
}

const categoryMeta: Record<
  ClarificationCategory,
  { label: string; icon: typeof AlertCircle; className: string; description: string }
> = {
  critical: {
    label: '关键必答',
    icon: AlertCircle,
    className: 'border-danger/40 bg-danger-bg/60 text-danger',
    description: '不补齐会阻断后续草案生成。',
  },
  recommended: {
    label: '建议补充',
    icon: ShieldCheck,
    className: 'border-warning/40 bg-warning-bg/70 text-warning',
    description: '可采用 AI 默认假设，但会影响计划质量。',
  },
  optional: {
    label: '可选优化',
    icon: HelpCircle,
    className: 'border-primary-200 bg-primary-50 text-primary-700',
    description: '不回答也可以继续，用于让草案更贴近偏好。',
  },
}

/** 覆盖矩阵槽位的中文名。与后端 COVERAGE_SLOT_LABELS 一一对应。 */
const COVERAGE_SLOT_LABELS: Record<string, string> = {
  scope: '范围',
  deliverable: '交付物',
  schedule: '时间',
  resource: '人力预算',
  role: '角色',
  platform: '平台',
  integration: '对接',
  permission: '权限',
  notification: '通知',
  acceptance: '验收',
  data: '数据口径',
  risk: '风险',
}

const COVERAGE_STATUS_LABELS: Record<string, string> = {
  covered: '已确认',
  deferred: '待决定',
  open: '未问',
}

/** 没有预设选项时给一句可照着写的示例，只示范格式，不含任何未确认事实。 */
const ANSWER_KIND_HINTS: Record<string, string> = {
  single_choice: '例如：选常见的那种做法就行',
  multi_choice: '例如：前两项都要，其余暂时不要',
  date: '例如：大概今年底；或 2026-12-31',
  number: '例如：大约 500；或 300 到 800 之间',
  money: '例如：大概 50 万；或先按 30 万上限估',
  short_text: '例如：先按公司现在的做法办，细节以后再补',
}

function formatValue(value: ClarificationValue | undefined): string {
  if (value === undefined || value === null) return '未填写'
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

/**
 * 已确认答案的展示。多选答案是用「、」拼起来的，直接铺一行会被容器切掉；
 * 这里拆成条目逐条列出，短答案仍按原样单行显示。
 */
function formatAnswerList(value: ClarificationValue | undefined): ReactNode {
  const text = formatValue(value)
  const parts = text
    .split('、')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return text
  return (
    <span className="flex flex-wrap gap-1">
      {parts.map((part, index) => (
        <span
          key={`${part}:${index}`}
          className="rounded-[var(--radius-sm)] bg-gray-100 px-1.5 py-0.5 font-normal text-heading"
        >
          {part}
        </span>
      ))}
    </span>
  )
}

function toErrorMessage(error: unknown): string {
  return apiErrorMessage(error, '分析失败，请稍后重试')
}

/**
 * 一轮澄清的前端硬上限。部分推理模型在首个答案 token 前完全不输出思考 token，
 * 因此不能把流式静默当成断网；取 50 分钟（原 10 分钟 × 5），想更早退出请用
 * 卡片上的「停止等待」。
 */
const ANALYZE_TIMEOUT_MS = 50 * 60_000
const ANALYZE_TIMEOUT_MARKER = 'AIPROJ_ANALYZE_TIMEOUT'
const ANALYZE_CANCELLED_MARKER = 'AIPROJ_ANALYZE_CANCELLED'

/** 把等待上限说成人话：满分钟说「N 分钟」，否则说秒。 */
function formatWaitLimit(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`
}

/** 等待计时。超过一分钟后改成「N 分 M 秒」，避免出现「已等待 437 秒」这种读数。 */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}

function toAnalyzeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (raw.includes(ANALYZE_CANCELLED_MARKER)) {
    return '已停止这次等待。你刚才写的内容还在输入框里，可以直接重试，或者换一句更短的说法。'
  }
  if (raw.includes(ANALYZE_TIMEOUT_MARKER) || name === 'AbortError' || name === 'TimeoutError') {
    return `模型达到 ${formatWaitLimit(ANALYZE_TIMEOUT_MS)}整轮等待上限，已经停止等待；这不代表本机网络异常。可以直接重试。`
  }
  // fetch 的网络层失败只会抛出 "Failed to fetch" 这种原文，直接显示等于没说。
  if (/failed to fetch|networkerror|load failed/iu.test(raw) || name === 'TypeError') {
    return '模型、代理或后端连接在等待期间中断；不应仅据此判定为本机网络问题。等几秒再点一次，你写的内容还在。'
  }
  return toErrorMessage(error)
}

function mergeAnswer(answers: ClarificationAnswers, answer: ClarificationAnswer) {
  return { ...answers, [answer.field]: answer }
}

function canGenerateDraft(model: AiConnectionModelDto) {
  return (
    model.isActive &&
    (model.capabilities.includes('project_draft') || model.capabilities.includes('chat'))
  )
}

function modelSelectionStorageKey(
  userId: string | number | null | undefined,
  organizationId: string | number | null,
) {
  return `ai-draft:model-selection:v1:${organizationId ?? 'none'}:${userId ?? 'anonymous'}`
}

export function AiProjectIntentWorkspace() {
  const user = useAuthStore((state) => state.user)
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  const copilotEntry = useCopilotOperatingEntry()
  const queryClient = useQueryClient()
  const {
    status,
    rawInput,
    cards,
    answers,
    parsedIntent,
    context,
    clarificationPhase,
    activeCard,
    remainingCount,
    completedCount,
    totalCount,
    questionPlanRevision,
    agentQuestionPlanToken,
    adaptiveSession,
    adaptiveSessionToken,
    questionPlanCoverage,
    error,
    restored,
    initializeScope,
    setRawInput,
    startAnalyzing,
    applyAnalysis,
    fail,
    retry,
    restart,
    setRestored,
  } = useAiProjectDraftStore()

  useEffect(() => {
    initializeScope({ userId: user?.id ?? null, organizationId })
  }, [initializeScope, organizationId, user?.id])

  const pendingCopilotInput =
    copilotEntry.userId === String(user?.id) && copilotEntry.organizationId === organizationId
      ? copilotEntry.projectCreation
      : null
  useEffect(() => {
    const current = useAiProjectDraftStore.getState()
    if (!pendingCopilotInput || current.rawInput || current.status !== 'idle') return
    current.setRawInput(pendingCopilotInput)
    useCopilotOperatingEntry.setState({ projectCreation: null })
  }, [pendingCopilotInput, rawInput, status])

  // 按次网页搜索同意（v3-copilot-optional-web-search-configuration）
  // 默认关闭；本次意图分析与后续草案生成都只在该同意下才可能查询外部资料。
  const [webSearchConsent, setWebSearchConsent] = useState(false)

  // 澄清一轮要真的走一次模型；第三方 OpenAI 兼容端点慢或不回时，整张卡片会停在
  // 禁用态且没有任何提示——用户看到的就是「不能作答」。这里加超时兜底与主动取消。
  const analyzeAbortRef = useRef<AbortController | null>(null)
  // 分析等待期间的模型实时输出旁路：发起请求前开频道，请求体带同一编号，
  // 右侧面板从骨架屏改为逐字显示模型正在输出的内容（频道号 null 即停止订阅）。
  const [analyzeLiveId, setAnalyzeLiveId] = useState<string | null>(null)
  const analyzeLive = useLiveOutputLanes(analyzeLiveId)
  const analyze = useMutation({
    mutationFn: (input: AnalyzeProjectIntentRequest) => {
      analyzeAbortRef.current?.abort()
      const controller = new AbortController()
      analyzeAbortRef.current = controller
      const timer = setTimeout(
        () => controller.abort(new Error(ANALYZE_TIMEOUT_MARKER)),
        ANALYZE_TIMEOUT_MS,
      )
      return aiIntentApi
        .analyze(input, controller.signal, {
          queryClient,
          onProgress: (job) => setAnalyzeLiveId(job.liveOutputId),
        })
        .finally(() => clearTimeout(timer))
    },
    onSuccess: (data: AnalyzeProjectIntentResponse, variables) => {
      analyzeAbortRef.current = null
      setAnalyzeLiveId(null)
      applyAnalysis(data, variables.rawInput, variables.answers)
    },
    onError: (mutationError) => {
      analyzeAbortRef.current = null
      setAnalyzeLiveId(null)
      fail(toAnalyzeErrorMessage(mutationError))
    },
  })

  /** 开一个新的实时输出频道，返回要放进分析请求体的频道编号。 */
  function beginLiveAnalysis(): string {
    const liveId = newLiveOutputId()
    setAnalyzeLiveId(liveId)
    return liveId
  }

  function cancelAnalysis() {
    if (!analyzeAbortRef.current) return
    analyzeAbortRef.current.abort(new Error(ANALYZE_CANCELLED_MARKER))
  }

  const trimmedLength = rawInput.trim().length
  const inputInvalid = trimmedLength < MIN_INPUT || trimmedLength > MAX_INPUT
  const isBusy = status === 'analyzing' || analyze.isPending

  const summary = useMemo(() => {
    if (!parsedIntent) return null
    return {
      type: projectTypeLabels[parsedIntent.projectType],
      entities: parsedIntent.entities.length,
      deliverables: parsedIntent.deliverables.length,
      confidence: Math.round(parsedIntent.overallConfidence * 100),
    }
  }, [parsedIntent])

  function submitAnalysis(nextAnswers = answers, revision?: string | null) {
    if (inputInvalid || isBusy) return
    startAnalyzing()
    analyze.mutate({
      rawInput: rawInput.trim(),
      answers: nextAnswers,
      liveOutputId: beginLiveAnalysis(),
      questionPlanRevision: revision ?? undefined,
      agentQuestionPlanToken: agentQuestionPlanToken ?? undefined,
      adaptiveSessionToken: adaptiveSessionToken ?? undefined,
      ...(selectedConnectionId ? { connectionId: Number(selectedConnectionId) } : {}),
      ...(selectedModelId ? { modelId: Number(selectedModelId) } : {}),
      // 按次同意（v3-copilot-optional-web-search-configuration）：默认不联网
      webSearchConsent,
    })
  }

  function handleAnswer(answer: ClarificationAnswer) {
    const nextAnswers = mergeAnswer(answers, answer)
    submitAnalysis(nextAnswers, questionPlanRevision)
  }

  function handleAdaptiveResponse(text: string) {
    if (!text.trim() || inputInvalid || isBusy) return
    startAnalyzing()
    analyze.mutate({
      rawInput: rawInput.trim(),
      adaptiveSessionToken: adaptiveSessionToken ?? undefined,
      adaptiveResponse: { text: text.trim(), intents: [] },
      liveOutputId: beginLiveAnalysis(),
      ...(selectedConnectionId ? { connectionId: Number(selectedConnectionId) } : {}),
      ...(selectedModelId ? { modelId: Number(selectedModelId) } : {}),
      webSearchConsent,
    })
  }

  function handlePreliminaryDraft() {
    if (!adaptiveSessionToken || inputInvalid || isBusy) return
    startAnalyzing()
    analyze.mutate({
      rawInput: rawInput.trim(),
      adaptiveSessionToken,
      requestPreliminaryDraft: true,
      liveOutputId: beginLiveAnalysis(),
      ...(selectedConnectionId ? { connectionId: Number(selectedConnectionId) } : {}),
      ...(selectedModelId ? { modelId: Number(selectedModelId) } : {}),
      webSearchConsent,
    })
  }

  /** 守卫态重跑这一步：带 retryGuardedSession，让后端用现有 ledger 重新生成理解。 */
  function handleRetryGuarded() {
    if (!adaptiveSessionToken || isBusy) return
    retry()
    startAnalyzing()
    analyze.mutate({
      rawInput: rawInput.trim(),
      adaptiveSessionToken,
      retryGuardedSession: true,
      liveOutputId: beginLiveAnalysis(),
      ...(selectedConnectionId ? { connectionId: Number(selectedConnectionId) } : {}),
      ...(selectedModelId ? { modelId: Number(selectedModelId) } : {}),
      webSearchConsent,
    })
  }

  function handleRetry() {
    retry()
    analyze.mutate({
      rawInput: rawInput.trim(),
      answers,
      liveOutputId: beginLiveAnalysis(),
      questionPlanRevision: questionPlanRevision ?? undefined,
      agentQuestionPlanToken: agentQuestionPlanToken ?? undefined,
      adaptiveSessionToken: adaptiveSessionToken ?? undefined,
      ...(selectedConnectionId ? { connectionId: Number(selectedConnectionId) } : {}),
      ...(selectedModelId ? { modelId: Number(selectedModelId) } : {}),
      webSearchConsent,
    })
  }

  const draftGenerationAbortRef = useRef<AbortController | null>(null)
  const resumeAttemptedRef = useRef<string | null>(null)
  const [sseConnecting, setSseConnecting] = useState(false)
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [selectionNotice, setSelectionNotice] = useState('')
  const connectionsQuery = useQuery({
    queryKey: ['ai-connections', 'draft-selector'],
    queryFn: aiConnectionsApi.list,
  })

  const draftConnections = useMemo(
    () =>
      (connectionsQuery.data ?? [])
        .filter((connection) => connection.isActive)
        .map((connection) => ({
          connection,
          models: connection.models.filter(canGenerateDraft),
        }))
        .filter((entry) => entry.models.length > 0),
    [connectionsQuery.data],
  )

  const selectedConnectionEntry = draftConnections.find(
    (entry) => entry.connection.id === selectedConnectionId,
  )
  const selectedModel = selectedConnectionEntry?.models.find(
    (model) => model.id === selectedModelId,
  )

  useEffect(() => {
    if (connectionsQuery.isLoading) return
    if (selectedModel && selectedConnectionEntry) return

    const first = draftConnections[0]
    if (!first) {
      setSelectedConnectionId('')
      setSelectedModelId('')
      setSelectionNotice('')
      return
    }

    const key = modelSelectionStorageKey(user?.id, organizationId)
    const saved = window.localStorage.getItem(key)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { connectionId?: string; modelId?: string }
        const savedConnection = draftConnections.find(
          (entry) => entry.connection.id === parsed.connectionId,
        )
        const savedModel = savedConnection?.models.find((model) => model.id === parsed.modelId)
        if (savedConnection && savedModel) {
          setSelectedConnectionId(savedConnection.connection.id)
          setSelectedModelId(savedModel.id)
          setSelectionNotice('')
          return
        }
        setSelectionNotice('上次使用的模型已不可用，请重新确认本次要使用的模型。')
      } catch {
        setSelectionNotice('上次使用的模型记录无法读取，请重新确认本次要使用的模型。')
      }
    }

    const firstModel = first.models[0]
    if (firstModel) {
      setSelectedConnectionId(first.connection.id)
      setSelectedModelId(firstModel.id)
    }
  }, [
    connectionsQuery.isLoading,
    draftConnections,
    organizationId,
    selectedConnectionEntry,
    selectedModel,
    user?.id,
  ])

  const loadAuthoritativeDraft = useCallback(
    async (draftId: string) => {
      const detail = await queryClient.fetchQuery({
        queryKey: ['ai-draft', 'detail', draftId],
        queryFn: () => aiDraftApi.get(draftId),
        staleTime: 0,
      })
      if (detail.status === 'error') {
        const current = useAiProjectDraftStore.getState()
        const semanticEvents = detail.events
          .filter((event) => event.type !== 'draft.heartbeat')
          .sort((left, right) => left.sequence - right.sequence)
        const nextExpected = current.lastEventSequence + 1
        if (semanticEvents.length > 0 && semanticEvents[0]!.sequence > nextExpected) {
          current.applyDraftProgressAction({
            kind: 'transport.reset',
            draftId: detail.draftId,
            version: Math.max(1, detail.version),
            lastSequence: 0,
          })
        }
        const replayCursor = useAiProjectDraftStore.getState().lastEventSequence
        for (const event of semanticEvents) {
          if (event.sequence > replayCursor) {
            useAiProjectDraftStore.getState().applyDraftEvent(event)
          }
        }
        const failure = detail.failure
        current.setDraftFailed(
          failure?.errorCode ?? 'AI_SERVICE_ERROR',
          failure?.message ?? '草案生成失败，请根据错误原因重试。',
          failure ?? null,
        )
        return
      }
      if (!detail.draft || !detail.meta || !detail.validation) {
        throw new Error(
          detail.generationState === 'orphaned'
            ? '生成任务已中断，请重新生成草案。'
            : '草案已生成，正在准备审查数据，请稍后继续。',
        )
      }
      const current = useAiProjectDraftStore.getState()
      current.setDraftCompleted(detail.draft, detail.meta, detail.validation)
      current.enterReview()
    },
    [queryClient],
  )

  const consumeGenerationResponse = useCallback(
    async (
      response: Response,
      abort: AbortController,
    ): Promise<'terminal' | 'gap' | 'disconnected'> => {
      const connectedAt = Date.now()
      const watchdog = window.setInterval(() => {
        const projection = useAiProjectDraftStore.getState().progressProjection
        const lastActivity = projection.lastEventAt ?? connectedAt
        if (Date.now() - lastActivity >= STREAM_SILENCE_TIMEOUT_MS) {
          abort.abort('heartbeat-timeout')
        }
      }, 2_000)

      try {
        for await (const event of consumeDraftSse(response, abort.signal)) {
          const current = useAiProjectDraftStore.getState()
          current.applyDraftEvent(event)
          const projection = useAiProjectDraftStore.getState().progressProjection

          if (projection.recovery.state === 'gap') return 'gap'
          if (event.type === 'draft.completed') {
            await loadAuthoritativeDraft(event.draftId)
            return 'terminal'
          }
          if (event.type === 'draft.failed') {
            current.setDraftFailed(event.errorCode, event.message, {
              errorCode: event.errorCode,
              message: event.message,
              consistency: event.consistency,
              sequence: event.sequence,
              stage: event.stage,
              reasonCode: event.reasonCode,
              errors: event.errors,
            })
            return 'terminal'
          }
        }
      } finally {
        window.clearInterval(watchdog)
      }
      return abort.signal.aborted && abort.signal.reason !== 'heartbeat-timeout'
        ? 'terminal'
        : 'disconnected'
    },
    [loadAuthoritativeDraft],
  )

  const resumeDraftProgress = useCallback(
    async (draftId: string, startSequence?: number) => {
      const abort = new AbortController()
      draftGenerationAbortRef.current = abort
      setSseConnecting(true)
      const store = useAiProjectDraftStore.getState()
      store.applyDraftProgressAction({ kind: 'transport.replaying' })

      try {
        // 1. 权威终态先行检查：在重连前优先查询草案详情
        const authoritative = await aiDraftApi.get(draftId)
        if (
          authoritative.status === 'error' ||
          (authoritative.status === 'reviewing' &&
            authoritative.draft &&
            authoritative.meta &&
            authoritative.validation)
        ) {
          await loadAuthoritativeDraft(draftId)
          return
        }
        if (authoritative.generationState === 'orphaned') {
          store.applyDraftProgressAction({
            kind: 'transport.disconnected',
            message: '后台生成任务已中断，请重新生成草案。',
          })
          return
        }

        let cursor = startSequence ?? store.lastEventSequence
        // 2. 有界自动重试与退避
        for (let attempt = 0; attempt < MAX_AUTO_RECONNECT_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            const backoffMs = RECONNECT_BACKOFF_DELAYS[attempt - 1] ?? 1000
            await delay(backoffMs, abort.signal)
            if (abort.signal.aborted) return

            const check = await aiDraftApi.get(draftId)
            if (
              check.status === 'error' ||
              (check.status === 'reviewing' && check.draft && check.meta && check.validation)
            ) {
              await loadAuthoritativeDraft(draftId)
              return
            }
            if (check.generationState === 'orphaned') {
              useAiProjectDraftStore.getState().applyDraftProgressAction({
                kind: 'transport.disconnected',
                message: '后台生成任务已中断，请重新生成草案。',
              })
              return
            }
          }

          useAiProjectDraftStore
            .getState()
            .applyDraftProgressAction({ kind: 'transport.replaying' })

          let response: Response
          try {
            response = await aiDraftApi.events(draftId, cursor)
          } catch {
            if (abort.signal.aborted) return
            continue
          }

          const outcome = await consumeGenerationResponse(response, abort)
          if (outcome === 'terminal') return
          if (outcome === 'gap') {
            cursor = useAiProjectDraftStore.getState().lastEventSequence
            continue
          }

          // outcome === 'disconnected'
          const detail = await aiDraftApi.get(draftId)
          if (
            detail.status === 'error' ||
            (detail.status === 'reviewing' && detail.draft && detail.meta && detail.validation)
          ) {
            await loadAuthoritativeDraft(draftId)
            return
          }
          if (detail.generationState === 'orphaned') {
            useAiProjectDraftStore.getState().applyDraftProgressAction({
              kind: 'transport.disconnected',
              message: '后台生成任务已中断，请重新生成草案。',
            })
            return
          }
          cursor = useAiProjectDraftStore.getState().lastEventSequence
        }

        useAiProjectDraftStore.getState().applyDraftProgressAction({
          kind: 'transport.disconnected',
          message: '进度连接已中断，可从上次位置继续。',
        })
      } catch (err: unknown) {
        if (abort.signal.aborted) return
        useAiProjectDraftStore.getState().applyDraftProgressAction({
          kind: 'transport.disconnected',
          message: toErrorMessage(err),
        })
      } finally {
        setSseConnecting(false)
      }
    },
    [consumeGenerationResponse, loadAuthoritativeDraft],
  )

  const handleStartDraftGeneration = useCallback(
    async (retryOfDraftId?: string) => {
      if (!context) return
      if (draftConnections.length > 0 && (!selectedConnectionId || !selectedModelId)) {
        setSelectionNotice('请先选择供应商和模型。')
        return
      }
      // onClick 直接引用时会传入事件对象：仅接受显式字符串 draftId。
      const retryId = typeof retryOfDraftId === 'string' ? retryOfDraftId : undefined

      const abort = new AbortController()
      draftGenerationAbortRef.current = abort
      setSseConnecting(true)

      try {
        const store = useAiProjectDraftStore.getState()
        // 失败重试：复用会话 POST /retry（服务端 checkpoint 断点续跑，
        // 已完成阶段不重新调模型）；首次/重新生成：新会话 POST /stream。
        if (retryId) {
          store.retryDraftGeneration()
        } else {
          store.startDraftGeneration('pending')
        }
        if (selectedConnectionId && selectedModelId) {
          window.localStorage.setItem(
            modelSelectionStorageKey(user?.id, organizationId),
            JSON.stringify({ connectionId: selectedConnectionId, modelId: selectedModelId }),
          )
        }
        const generationInput = {
          context,
          ...(selectedConnectionId ? { connectionId: Number(selectedConnectionId) } : {}),
          ...(selectedModelId ? { modelId: Number(selectedModelId) } : {}),
        }
        const response = retryId
          ? await aiDraftApi.retry(retryId, generationInput)
          : await aiDraftApi.stream(generationInput)
        store.applyDraftProgressAction({ kind: 'transport.live' })
        const outcome = await consumeGenerationResponse(response, abort)
        if (outcome === 'gap' || outcome === 'disconnected') {
          const current = useAiProjectDraftStore.getState()
          if (current.draftId && current.draftId !== 'pending') {
            await resumeDraftProgress(current.draftId, current.lastEventSequence)
          } else {
            useAiProjectDraftStore.getState().applyDraftProgressAction({
              kind: 'transport.disconnected',
            })
          }
        }
      } catch (err: unknown) {
        if (!abort.signal.aborted) {
          const current = useAiProjectDraftStore.getState()
          if (current.draftId && current.draftId !== 'pending') {
            await resumeDraftProgress(current.draftId, current.lastEventSequence)
          } else {
            useAiProjectDraftStore.getState().applyDraftProgressAction({
              kind: 'transport.disconnected',
              message: toErrorMessage(err),
            })
          }
        }
      } finally {
        setSseConnecting(false)
      }
    },
    [
      consumeGenerationResponse,
      context,
      draftConnections.length,
      organizationId,
      resumeDraftProgress,
      selectedConnectionId,
      selectedModelId,
      user?.id,
    ],
  )

  useEffect(() => {
    const cursor = readDraftProgressCursor({
      userId: user?.id ?? null,
      organizationId,
    })
    if (!cursor || resumeAttemptedRef.current === cursor.draftId) return
    resumeAttemptedRef.current = cursor.draftId
    useAiProjectDraftStore.setState({
      draftStatus: 'drafting',
      draftId: cursor.draftId,
      draftVersion: cursor.version,
      lastEventSequence: cursor.lastSequence,
    })
    void resumeDraftProgress(cursor.draftId, cursor.lastSequence)
  }, [organizationId, resumeDraftProgress, user?.id])

  useEffect(
    () => () => {
      draftGenerationAbortRef.current?.abort('component-unmount')
    },
    [],
  )

  const handleAcceptAll = useCallback(async () => {
    const state = useAiProjectDraftStore.getState()
    if (!state.draftId) return

    state.enterApplying()

    try {
      const request: ConfirmProjectDraftRequest = {
        version: state.draftVersion,
        mode: 'all',
        // 携带审查阶段累积的行内字段改动（负责人/日期/名称等）。
        modifications: state.pendingModifications.length ? state.pendingModifications : undefined,
        acknowledgedWarnings: true,
      }
      const result = await aiDraftApi.confirm(state.draftId, request)
      state.enterConfirmed(result)
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : '确认导入失败'
      state.setDraftError(message)
    }
  }, [])

  // 行内字段编辑=本地暂存（不导入）；正式导入仍由「确认导入」触发并携带全部暂存改动。
  const handleApplyEdit = useCallback(
    (path: string, value: string | number | boolean | string[]) => {
      useAiProjectDraftStore.getState().applyDraftFieldEdit(path, value)
    },
    [],
  )

  const handleAcceptPartial = useCallback(
    async (selection: {
      wbsNodeIds: string[]
      taskIds: string[]
      acceptanceIds: string[]
      riskHintIds: string[]
    }) => {
      const state = useAiProjectDraftStore.getState()
      if (!state.draftId) return

      state.enterApplying()

      try {
        const request: ConfirmProjectDraftRequest = {
          version: state.draftVersion,
          mode: 'partial',
          selection: {
            taskIds: selection.taskIds,
            wbsNodeIds: selection.wbsNodeIds,
            acceptanceIds: selection.acceptanceIds,
            milestoneIds: [],
            riskHintIds: selection.riskHintIds,
            unselectedStrategy: 'discard',
          },
          modifications: state.pendingModifications.length ? state.pendingModifications : undefined,
          acknowledgedWarnings: true,
        }
        const result = await aiDraftApi.confirm(state.draftId, request)
        state.enterConfirmed(result)
      } catch (err: unknown) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : '部分导入失败'
        state.setDraftError(message)
      }
    },
    [],
  )

  const handleRejectRetry = useCallback(async () => {
    const state = useAiProjectDraftStore.getState()
    if (!state.draftId) return

    state.enterRejected()

    try {
      await aiDraftApi.reject(state.draftId)
      state.resetToContext()
    } catch {
      state.resetToContext()
    }
  }, [])

  const handleSaveDraft = useCallback(async () => {
    const state = useAiProjectDraftStore.getState()
    if (!state.draftId) return

    try {
      await aiDraftApi.save(state.draftId)
      state.enterSaved()
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : '保存草稿失败'
      state.setDraftError(message)
    }
  }, [])

  const handleBackToContext = useCallback(() => {
    useAiProjectDraftStore.getState().resetToContext()
  }, [])

  const draftId = useAiProjectDraftStore((s) => s.draftId)
  const draftStatus = useAiProjectDraftStore((s) => s.draftStatus)
  const draft = useAiProjectDraftStore((s) => s.draft)
  const draftMeta = useAiProjectDraftStore((s) => s.draftMeta)
  const draftFailure = useAiProjectDraftStore((s) => s.draftFailure)
  const validation = useAiProjectDraftStore((s) => s.validation)
  const moduleStatuses = useAiProjectDraftStore((s) => s.moduleStatuses)
  const progressProjection = useAiProjectDraftStore((s) => s.progressProjection)
  const confirmResponse = useAiProjectDraftStore((s) => s.confirmResponse)
  const streamOutput = useAiProjectDraftStore((s) => s.streamOutput)
  const streamOutputActive = useAiProjectDraftStore((s) => s.streamOutputActive)

  // 当前 generating 模块的中文名（实时输出面板头部展示）
  const currentGeneratingModuleLabel = useMemo(() => {
    const entry = Object.entries(moduleStatuses).find(([, status]) => status === 'generating')
    return entry ? moduleLabels[entry[0] as keyof typeof moduleLabels] : null
  }, [moduleStatuses])

  if (pendingCopilotInput && (rawInput || status !== 'idle')) {
    return (
      <section className="mx-auto max-w-2xl space-y-4 py-8" aria-label="Copilot 创建需求">
        <h1 className="text-xl font-semibold text-heading">已带入 Copilot 中的创建需求</h1>
        <p className="whitespace-pre-wrap text-sm text-gray-700">{pendingCopilotInput}</p>
        <p className="text-sm text-gray-600">
          当前还有未完成的草案。你可以继续原草案，或清空本地草案并使用新需求开始。
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm"
            onClick={() => useCopilotOperatingEntry.setState({ projectCreation: null })}
          >
            继续原草案
          </button>
          <button
            type="button"
            className="rounded-md bg-primary-500 px-4 py-2 text-sm text-white"
            onClick={() => {
              restart()
              setRawInput(pendingCopilotInput)
              useCopilotOperatingEntry.setState({ projectCreation: null })
            }}
          >
            使用新需求开始
          </button>
        </div>
      </section>
    )
  }

  if (status === 'ready' && context && !draftStatus && !draft) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8">
        <header className="flex flex-col gap-3">
          <AiChip label="AI 一句话启动" className="w-fit" />
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-heading md:text-3xl">
            上下文已就绪，准备生成草案
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-gray-600">
            系统已理解项目意图，点击下方按钮开始生成完整项目草案。生成结果仍须经过人工审查，
            不会直接建立正式项目。
          </p>
        </header>

        <div className="rounded-[var(--radius-xl)] border border-success/30 bg-success-bg/70 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-1 h-5 w-5 text-success" aria-hidden />
            <div className="flex-1">
              <p className="font-medium text-success">意图上下文已确认</p>
              <ul className="mt-2 space-y-1 text-sm text-success/90">
                <li>
                  项目类型：{parsedIntent ? projectTypeLabels[parsedIntent.projectType] : '—'}
                </li>
                <li>交付物：{parsedIntent?.deliverables.length ?? 0} 项</li>
              </ul>
            </div>
          </div>
        </div>

        {context.knownUnknowns && context.knownUnknowns.length > 0 ? (
          <section
            className="rounded-[var(--radius-lg)] border border-warning/30 bg-warning-bg/70 p-5"
            aria-labelledby="preliminary-draft-open-items"
          >
            <h2 id="preliminary-draft-open-items" className="font-medium text-warning">
              初步草案仍有 {context.knownUnknowns.length} 项待确认
            </h2>
            <p className="mt-1 text-sm leading-6 text-warning/90">
              AI 会把这些内容标为假设、待决定事项或风险，不会自行编造具体答案。
            </p>
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              {context.knownUnknowns.slice(0, 8).map((item) => (
                <li key={item.needId} className="rounded-[var(--radius-md)] bg-gray-0 px-3 py-2">
                  <span className="font-medium text-heading">{item.topic}</span>
                  <span className="ml-2 text-gray-600">{item.impact}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid gap-3 rounded-[var(--radius-lg)] border border-border bg-gray-0 p-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">供应商</span>
            <select
              className="h-10 w-full rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 text-sm"
              value={selectedConnectionId}
              disabled={draftConnections.length === 0}
              onChange={(event) => {
                const nextConnectionId = event.target.value
                const nextEntry = draftConnections.find(
                  (entry) => entry.connection.id === nextConnectionId,
                )
                setSelectedConnectionId(nextConnectionId)
                setSelectedModelId(nextEntry?.models[0]?.id ?? '')
                setSelectionNotice('')
              }}
            >
              {draftConnections.length === 0 ? (
                <option value="">未配置草案模型，使用系统兜底</option>
              ) : (
                draftConnections.map((entry) => (
                  <option key={entry.connection.id} value={entry.connection.id}>
                    {entry.connection.displayName}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">模型</span>
            <select
              className="h-10 w-full rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 text-sm"
              value={selectedModelId}
              disabled={!selectedConnectionEntry}
              onChange={(event) => {
                setSelectedModelId(event.target.value)
                setSelectionNotice('')
              }}
            >
              {selectedConnectionEntry ? (
                selectedConnectionEntry.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelName}
                  </option>
                ))
              ) : (
                <option value="">未选择模型</option>
              )}
            </select>
          </label>
          {selectionNotice && (
            <p className="md:col-span-2 text-sm text-warning">{selectionNotice}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            loading={sseConnecting}
            disabled={sseConnecting}
            onClick={() => void handleStartDraftGeneration()}
          >
            <Zap className="h-4 w-4" aria-hidden />
            开始生成草案
          </Button>
          <Button type="button" variant="ghost" onClick={restart}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            重新开始
          </Button>
        </div>
      </section>
    )
  }

  if (draftStatus === 'drafting' || sseConnecting) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8">
        <header className="flex flex-col gap-3">
          <AiChip label="AI 草案生成" className="w-fit" />
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-heading md:text-3xl">
            正在生成项目草案
          </h1>
        </header>
        <DraftGenerationProgress
          moduleStatuses={moduleStatuses}
          draftId={draftId}
          projection={progressProjection}
          isConnecting={sseConnecting}
          onResume={
            draftId && draftId !== 'pending' ? () => void resumeDraftProgress(draftId) : undefined
          }
          onRestart={() => void handleStartDraftGeneration()}
        />
        <DraftOutputPanel
          text={streamOutput}
          active={streamOutputActive}
          currentModuleLabel={currentGeneratingModuleLabel}
          onClear={() => useAiProjectDraftStore.getState().clearStreamOutput()}
        />
      </section>
    )
  }

  if ((draftStatus === 'reviewing' || draftStatus === 'editing') && draft && draftMeta) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8">
        <DraftReviewPanel
          draft={draft}
          meta={draftMeta}
          validation={validation}
          onAcceptAll={handleAcceptAll}
          onAcceptPartial={handleAcceptPartial}
          onApplyEdit={handleApplyEdit}
          onRejectRetry={handleRejectRetry}
          onSaveDraft={handleSaveDraft}
          onBack={handleBackToContext}
        />
      </section>
    )
  }

  if (draftStatus === 'applying') {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8">
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          <p className="text-lg font-medium text-heading">正在导入草案到正式项目...</p>
          <p className="text-sm text-gray-600">请勿刷新页面</p>
        </div>
      </section>
    )
  }

  if (draftStatus === 'confirmed' && confirmResponse) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8">
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
          <h2 className="text-2xl font-semibold text-heading">项目已创建</h2>
          <p className="text-sm text-gray-600">
            项目 ID：{confirmResponse.projectId} · 已导入 {confirmResponse.createdCounts.tasks}{' '}
            个任务
          </p>
          <div className="mt-2 flex gap-3">
            <Button
              type="button"
              onClick={() => {
                window.location.href = `/projects/${confirmResponse.projectId}`
              }}
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              查看项目
            </Button>
            <Button type="button" variant="ghost" onClick={restart}>
              创建下一个项目
            </Button>
          </div>
        </div>
      </section>
    )
  }

  if (draftStatus === 'saved') {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8">
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-primary-600" aria-hidden />
          <h2 className="text-2xl font-semibold text-heading">草稿已保存</h2>
          <p className="text-sm text-gray-600">草案已保存到会话，可稍后继续</p>
          <div className="mt-2 flex gap-3">
            <Button type="button" onClick={handleBackToContext}>
              返回上下文
            </Button>
            <Button type="button" variant="ghost" onClick={restart}>
              重新开始
            </Button>
          </div>
        </div>
      </section>
    )
  }

  if (draftStatus === 'rejected') {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8">
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-lg font-medium text-heading">已拒绝草案</p>
          <p className="text-sm text-gray-600">可修改上下文后重新生成</p>
          <div className="mt-2 flex gap-3">
            <Button type="button" onClick={handleBackToContext}>
              返回上下文修改
            </Button>
            <Button type="button" variant="ghost" onClick={restart}>
              重新开始
            </Button>
          </div>
        </div>
      </section>
    )
  }

  if (draftStatus === 'error') {
    return (
      <DraftErrorPanel
        error={error}
        failure={
          draftFailure ??
          (draftMeta?.failure
            ? {
                errorCode: 'AI_SERVICE_ERROR',
                message: error ?? '草案生成失败',
                consistency: 'failed',
                sequence: 0,
                ...draftMeta.failure,
              }
            : null)
        }
        onRetry={() => {
          // 有真实失败会话时复用会话重试（checkpoint 断点续跑），否则全新生成。
          const failedDraftId = useAiProjectDraftStore.getState().draftId
          void handleStartDraftGeneration(
            failedDraftId && failedDraftId !== 'pending' ? failedDraftId : undefined,
          )
        }}
        onBack={handleBackToContext}
      />
    )
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-6 md:py-8">
      <header className="flex flex-col gap-3">
        <AiChip label="AI 一句话启动" className="w-fit" />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-heading md:text-3xl">
            先把项目意图说清楚，再生成可审查草案
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-gray-600">
            输入一句中文描述，系统会先识别项目类型、目标、交付物与缺失信息。所有内容只进入草案上下文，不会创建正式项目、任务、WBS
            或依赖。
          </p>
        </div>
      </header>

      {restored ? (
        <div
          className="flex items-start justify-between gap-4 rounded-[var(--radius-lg)] border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800"
          role="status"
        >
          <div className="flex gap-2">
            <Clock className="mt-0.5 h-4 w-4" aria-hidden />
            <span>已从本次会话恢复上一次未完成的 AI 草案上下文。</span>
          </div>
          <button
            type="button"
            className="text-primary-700 underline-offset-4 hover:underline"
            onClick={() => setRestored(false)}
          >
            我知道了
          </button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="flex flex-col gap-4 rounded-[var(--radius-xl)] bg-gray-0 p-5 shadow-md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-heading">项目描述</h2>
              <p className="text-sm text-gray-600">10–4000 字，越具体越少追问。</p>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-1 text-xs',
                inputInvalid ? 'bg-danger-bg text-danger' : 'bg-gray-100 text-gray-600',
              )}
            >
              {trimmedLength}/{MAX_INPUT}
            </span>
          </div>

          <label className="sr-only" htmlFor="ai-project-raw-input">
            项目一句话描述
          </label>
          <Textarea
            id="ai-project-raw-input"
            value={rawInput}
            minLength={MIN_INPUT}
            maxLength={MAX_INPUT}
            disabled={isBusy}
            aria-invalid={inputInvalid && rawInput.length > 0}
            aria-describedby="ai-project-input-help"
            className="min-h-40 resize-y text-base leading-7"
            placeholder="例如：8 月启动一个面向运营团队的内部工单系统，需要 Web 端、权限管理、数据看板和上线验收，团队约 5 人。"
            onChange={(event) => setRawInput(event.target.value)}
          />
          <p id="ai-project-input-help" className="text-xs leading-5 text-gray-500">
            不要输入身份证、手机号、客户隐私等敏感信息；当前步骤只做意图分析与澄清。
          </p>

          {/* 按次网页搜索同意（v3-copilot-optional-web-search-configuration） */}
          <div
            className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-gray-50 px-3 py-2"
            data-ai-create-web-search-toggle
          >
            <label
              htmlFor="ai-create-web-search-consent"
              className="flex min-w-0 items-center gap-1.5 text-xs text-gray-600"
            >
              <Globe className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden />
              <span className="truncate">
                {webSearchConsent
                  ? '本次允许联网搜索：可能发送你问题涉及的主题；组织域名策略与额度适用；外部资料仅作参考，不会直接写入正式项目'
                  : '允许本次使用网页搜索'}
              </span>
            </label>
            <button
              id="ai-create-web-search-consent"
              type="button"
              role="switch"
              aria-checked={webSearchConsent}
              disabled={isBusy}
              onClick={() => setWebSearchConsent((prev) => !prev)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 focus-visible:shadow-focus focus-visible:outline-none',
                webSearchConsent ? 'bg-primary-600' : 'bg-gray-200',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                  webSearchConsent ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              loading={isBusy}
              disabled={inputInvalid || isBusy}
              onClick={() => submitAnalysis(answers, questionPlanRevision)}
            >
              {parsedIntent ? '重新分析' : '开始分析'}
              {!isBusy ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
            </Button>
            <Button type="button" variant="ghost" disabled={isBusy && !rawInput} onClick={restart}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              重新开始
            </Button>
          </div>

          {status === 'error' ? (
            <div
              className="rounded-[var(--radius-lg)] border border-danger/30 bg-danger-bg/70 p-4 text-sm text-danger"
              role="alert"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4" aria-hidden />
                <div className="flex-1">
                  <p className="font-medium">分析失败</p>
                  <p className="mt-1 text-danger/90">{error}</p>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={handleRetry}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  重试
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <IntentSummaryPanel
          status={status}
          summary={summary}
          cards={cards}
          context={context}
          adaptiveSession={adaptiveSession}
          liveLanes={analyzeLive.lanes}
          liveTotalChars={analyzeLive.totalChars}
          liveModelName={selectedModel?.modelName ?? null}
        />
      </div>

      {adaptiveSession ? (
        <AdaptiveClarificationWorkspace
          session={adaptiveSession}
          isBusy={isBusy}
          onSubmit={handleAdaptiveResponse}
          onPreliminaryDraft={handlePreliminaryDraft}
          errorMessage={status === 'error' ? error : null}
          onCancel={cancelAnalysis}
          onRetry={adaptiveSessionToken ? handleRetryGuarded : undefined}
          onExplain={
            adaptiveSessionToken
              ? (payload, onDelta, signal) =>
                  aiIntentApi.explainStream(
                    {
                      rawInput: rawInput.trim(),
                      adaptiveSessionToken,
                      question: payload.question,
                      history: payload.history,
                      ...(selectedConnectionId
                        ? { connectionId: Number(selectedConnectionId) }
                        : {}),
                      ...(selectedModelId ? { modelId: Number(selectedModelId) } : {}),
                    },
                    onDelta,
                    signal,
                  )
              : undefined
          }
        />
      ) : (
        <ClarificationQueue
          status={status}
          phase={clarificationPhase}
          activeCard={activeCard}
          remainingCount={remainingCount}
          completedCount={completedCount}
          totalCount={totalCount}
          coverageValid={questionPlanCoverage?.valid ?? true}
          isBusy={isBusy}
          onAnswer={handleAnswer}
        />
      )}
    </section>
  )
}

function IntentSummaryPanel({
  status,
  summary,
  cards,
  context,
  adaptiveSession,
  liveLanes,
  liveTotalChars,
  liveModelName,
}: {
  status: AiProjectDraftStatus
  summary: { type: string; entities: number; deliverables: number; confidence: number } | null
  cards: ClarificationCardType[]
  context: import('@aiproj/types').ConfirmedProjectContext | null
  adaptiveSession: AdaptiveClarificationSession | null
  liveLanes: OutputLane[]
  liveTotalChars: number
  liveModelName: string | null
}) {
  const adaptiveConversation = adaptiveSession?.conversation ?? null
  // 左侧「澄清进度」原先数的是固定字段 cards——自适应链路里它恒为空数组，所以永远显示
  // 0/0/0，而右侧读的是 conversation.remainingEstimate。两块面板根本不是同一个来源。
  // 现在优先用服务端下发的分档拆解（三项之和恒等于 remainingEstimate），两侧不可能再打架。
  const clarificationCounts = adaptiveConversation
    ? (adaptiveConversation.remainingBreakdown ?? {
        // 旧 token（分档字段上线前签发）没有该字段：退回把剩余数全记为关键必答，
        // 宁可保守，也不要再出现「左边 0、右边 6」这种自相矛盾的显示。
        critical: adaptiveConversation.remainingEstimate,
        recommended: 0,
        optional: 0,
      })
    : {
        critical: cards.filter((card) => card.category === 'critical').length,
        recommended: cards.filter((card) => card.category === 'recommended').length,
        optional: cards.filter((card) => card.category === 'optional').length,
      }
  const coverageEntries = adaptiveConversation?.coverage ?? []

  if (status === 'idle' && !summary) {
    return (
      <aside className="rounded-[var(--radius-xl)] bg-surface p-5">
        <div className="flex h-full min-h-72 flex-col justify-center gap-3 text-center">
          <Sparkles className="mx-auto h-9 w-9 text-ai" aria-hidden />
          <h2 className="text-lg font-semibold text-heading">等待一句项目描述</h2>
          <p className="mx-auto max-w-sm text-sm leading-6 text-gray-600">
            我会把模糊信息拆成关键必答、建议补充和可选优化三类问题。
          </p>
        </div>
      </aside>
    )
  }

  if (status === 'analyzing') {
    return (
      <aside className="rounded-[var(--radius-xl)] bg-surface p-5" aria-busy>
        <div className="mb-5">
          <BrandLoader size={56} label="AI 正在分析项目意图…" />
        </div>
        <LiveOutputPanel
          compact
          lanes={liveLanes}
          totalChars={liveTotalChars}
          title="模型实时输出"
          status={liveModelName ? `当前模型：${liveModelName}` : undefined}
          emptyText="正在连接模型，分析输出会在这里逐字显示…"
        />
      </aside>
    )
  }

  return (
    <aside className="flex flex-col gap-4 rounded-[var(--radius-xl)] bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-heading">识别摘要</h2>
        <AiChip label="可解释上下文" />
      </div>

      {summary ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <SummaryItem label="项目类型" value={summary.type} />
          <SummaryItem label="实体数量" value={`${summary.entities} 个`} />
          <SummaryItem label="交付物" value={`${summary.deliverables} 项`} />
          <SummaryItem label="置信度" value={`${summary.confidence}%`} />
        </dl>
      ) : null}

      <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-ai" aria-hidden />
          <h3 className="font-medium text-heading">澄清进度</h3>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          {(['critical', 'recommended', 'optional'] as const).map((category) => (
            <div key={category} className="rounded-[var(--radius-md)] bg-gray-50 px-2 py-3">
              <p className="font-semibold text-heading">{clarificationCounts[category]}</p>
              <p className="mt-1 text-gray-500">{categoryMeta[category].label}</p>
            </div>
          ))}
        </div>
        {adaptiveConversation ? (
          <p className="mt-3 text-xs leading-5 text-gray-500">
            已确认 {adaptiveConversation.completedCount} 项 · 还有约{' '}
            {adaptiveConversation.remainingEstimate} 项待确认（与右侧同一来源）。
          </p>
        ) : null}
        {coverageEntries.length > 0 ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-gray-500">需求覆盖矩阵</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {coverageEntries.map((entry) => (
                <li
                  key={entry.slot}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] leading-5',
                    entry.status === 'covered'
                      ? 'border-success/40 bg-success-bg/60 text-success'
                      : entry.status === 'deferred'
                        ? 'border-warning/40 bg-warning-bg/60 text-warning'
                        : 'border-border bg-gray-50 text-gray-500',
                  )}
                  title={COVERAGE_STATUS_LABELS[entry.status]}
                >
                  {COVERAGE_SLOT_LABELS[entry.slot] ?? entry.slot}
                  <span className="ml-1 opacity-70">{COVERAGE_STATUS_LABELS[entry.status]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {context ? (
        <div className="rounded-[var(--radius-lg)] border border-border bg-gray-0 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            <h3 className="font-medium text-heading">AI 假设与已确认信息</h3>
          </div>
          <ul className="space-y-2 text-sm text-gray-700">
            {Object.entries(context.assumptions)
              .slice(0, 4)
              .map(([field, marked]) => (
                <li key={field} className="flex items-start justify-between gap-3">
                  <span className="text-gray-500">{field}</span>
                  <span className="text-right">
                    {formatValue(marked?.value)}
                    <span className="ml-1 text-xs text-ai">AI 假设</span>
                  </span>
                </li>
              ))}
            {Object.entries(context.resolvedFields)
              .slice(0, 4)
              .map(([field, marked]) => (
                <li key={field} className="flex items-start justify-between gap-3">
                  <span className="text-gray-500">{field}</span>
                  <span className="text-right">{formatValue(marked?.value)}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {status === 'ready' ? (
        <div className="rounded-[var(--radius-lg)] border border-success/30 bg-success-bg/70 p-4 text-sm text-success">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden />
            <div>
              <p className="font-medium">已准备生成草案</p>
              <p className="mt-1 text-success/90">
                当前只完成草案上下文准备；正式项目创建必须进入后续审查确认流程。
              </p>
            </div>
          </div>
        </div>
      ) : clarificationCounts.critical > 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-warning/30 bg-warning-bg/70 p-4 text-sm text-warning">
          还有 {clarificationCounts.critical} 个关键问题未解决，暂不能进入 ready。
        </div>
      ) : null}
    </aside>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-gray-0 px-3 py-3">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 font-medium text-heading">{value}</dd>
    </div>
  )
}

export function AdaptiveClarificationWorkspace({
  session,
  isBusy,
  onSubmit,
  onPreliminaryDraft,
  errorMessage,
  onCancel,
  onRetry,
  onExplain,
}: {
  session: AdaptiveClarificationSession
  isBusy: boolean
  onSubmit: (text: string) => void
  onPreliminaryDraft?: () => void
  /** 上一轮失败/超时/取消的原因；卡片内直接显示，用户不必滚回顶部才知道发生了什么。 */
  errorMessage?: string | null
  /** 主动中止本轮等待。模型端不回时这是用户唯一的出路。 */
  onCancel?: () => void
  /** 守卫态（needs_human_review）下重跑这一步；已确认的答案不受影响。 */
  onRetry?: () => void
  /**
   * 流式解释当前这道题，并支持就这道题继续追问。只读链路：不推进澄清、不写 ledger。
   * 未提供时「我不明白」退回到走澄清轮次的旧行为。
   */
  onExplain?: (
    payload: { question: string; history: ExplainClarificationTurn[] },
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ) => Promise<void>
}) {
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busySeconds, setBusySeconds] = useState(0)
  const [explainOpen, setExplainOpen] = useState(false)
  const [explainTurns, setExplainTurns] = useState<ExplainClarificationTurn[]>([])
  const [explainDraft, setExplainDraft] = useState('')
  const [explainStreaming, setExplainStreaming] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)
  const [explainInput, setExplainInput] = useState('')
  // 「其他」是选项之一：点开就地变成输入框，而不是把人赶到卡片最下面那个多用途输入框。
  const [otherActive, setOtherActive] = useState(false)
  const [otherText, setOtherText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const otherInputRef = useRef<HTMLInputElement | null>(null)
  const explainAbortRef = useRef<AbortController | null>(null)
  const conversation = session.conversation
  const liveLedgerEntries = session.ledger.entries.filter((entry) => entry.status !== 'superseded')

  useEffect(() => {
    setMessage('')
    setSelected([])
    setOtherActive(false)
    setOtherText('')
    // 换题就丢弃上一题的解释对话——它只对那一道题成立。
    explainAbortRef.current?.abort()
    setExplainOpen(false)
    setExplainTurns([])
    setExplainDraft('')
    setExplainStreaming(false)
    setExplainError(null)
    setExplainInput('')
    inputRef.current?.focus({ preventScroll: true })
  }, [conversation?.activeNeedId])

  // 等待期间必须看得见在动。原先只有 aria-busy，视觉上和「卡死」完全一样。
  useEffect(() => {
    if (!isBusy) {
      setBusySeconds(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(
      () => setBusySeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1_000,
    )
    return () => window.clearInterval(timer)
  }, [isBusy])

  if (session.status === 'needs_human_review') {
    return (
      <section
        className="rounded-[var(--radius-xl)] border border-warning/40 bg-warning-bg/70 p-5"
        role="alert"
      >
        <h2 className="font-semibold text-heading">这一步没能完成，已保留你的答案</h2>
        <p className="mt-2 text-sm leading-6 text-gray-700">
          {session.guardReason ?? '系统无法安全地产生下一题，现有答案都已保留。'}
        </p>
        {session.ledger.entries.length > 0 ? (
          <p className="mt-2 text-xs leading-5 text-gray-600">
            已确认的 {session.ledger.entries.length} 项都还在，重试不会让你从头再答一遍。
          </p>
        ) : null}
        {/* 原来这里是个死胡同：只有一句报错，没有任何可点的东西，用户只能刷新页面。 */}
        {onRetry ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={isBusy} onClick={onRetry}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              重试这一步
            </Button>
            {isBusy && onCancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                停止等待
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    )
  }
  // 澄清收尾（status=ready）后 conversation 为 null。原来这里直接 return null，
  // 整块面板凭空消失——恰恰在「该复核答案挂对了没有」的那一刻，用户什么也看不到。
  // 现在改成列出全部已确认信息，答案错配一眼可见，也能直接回去改。
  if (!conversation) {
    if (liveLedgerEntries.length === 0) return null
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-[var(--radius-xl)] border border-border bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-heading">
            澄清已完成，这些是要写进草案的信息
          </h2>
          <span className="rounded-full bg-success-bg/70 px-3 py-1 text-xs font-medium text-success">
            已确认 {liveLedgerEntries.length} 项
          </span>
        </div>
        <p className="text-xs leading-5 text-gray-500">
          生成前请扫一眼答案有没有挂错题。发现不对就点下面的「重新回答」回到澄清，草案在人工审查确认前不会落库。
        </p>
        <ul className="space-y-2">
          {liveLedgerEntries.map((entry) => (
            <li
              key={`${entry.needId}:${entry.revision}`}
              className="rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 py-2 text-sm leading-6"
            >
              <p className="text-xs text-gray-500">
                {entry.questionSummary}
                {entry.source === 'absorbed' ? (
                  <span className="ml-1 rounded-full bg-ai/10 px-1.5 py-0.5 text-[10px] text-ai">
                    从你的描述中读到
                  </span>
                ) : null}
              </p>
              <p
                className={cn(
                  'mt-0.5 break-words font-medium',
                  entry.status === 'known_unknown' ? 'text-warning' : 'text-heading',
                )}
              >
                {entry.status === 'known_unknown'
                  ? '待决定（会作为假设与风险列入计划）'
                  : formatAnswerList(entry.answer)}
              </p>
            </li>
          ))}
        </ul>
        {onRetry ? (
          <div>
            <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={onRetry}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              重新回答
            </Button>
          </div>
        ) : null}
      </section>
    )
  }

  const question = conversation.activeQuestion
  const options = question.options ?? []
  const isMulti = question.answerKind === 'multi_choice'

  // 「为什么要问 / 我不明白 / 请给我建议」的回应原先只写进 conversation.turns，
  // 而 turns 只在折叠的〈查看本题对话〉里渲染——用户点了按钮看不到任何变化，
  // 会以为按钮坏了。这里把「上一次用户发言之后的 AI 回应」提到卡片里常驻显示。
  const lastUserTurnIndex = conversation.turns.map((item) => item.role).lastIndexOf('user')
  const latestReplies =
    lastUserTurnIndex >= 0
      ? conversation.turns.slice(lastUserTurnIndex + 1).filter((item) => item.role === 'assistant')
      : []
  const proposedAnswerText =
    conversation.proposedAnswer === undefined ? '' : formatValue(conversation.proposedAnswer)

  function submit(text: string) {
    const value = text.trim()
    if (!value || isBusy) return
    onSubmit(value)
  }

  /** 「其他」里写的答案：单选直接作为答案提交；多选先并入已选，再由「确认已选」一起提交。 */
  function acceptOther() {
    const value = otherText.trim()
    if (!value || isBusy) return
    if (isMulti) {
      setSelected((current) => (current.includes(value) ? current : [...current, value]))
      setOtherActive(false)
      setOtherText('')
      return
    }
    submit(value)
  }

  async function runExplain(userQuestion: string) {
    if (!onExplain || explainStreaming) return
    explainAbortRef.current?.abort()
    const controller = new AbortController()
    explainAbortRef.current = controller
    const history = explainTurns
    const asked = userQuestion.trim()
    if (asked) setExplainTurns((current) => [...current, { role: 'user', text: asked }])
    setExplainInput('')
    setExplainDraft('')
    setExplainError(null)
    setExplainStreaming(true)
    let accumulated = ''
    try {
      await onExplain(
        { question: asked, history },
        (delta) => {
          accumulated += delta
          setExplainDraft(accumulated)
        },
        controller.signal,
      )
      if (accumulated) {
        setExplainTurns((current) => [...current, { role: 'assistant', text: accumulated }])
      }
    } catch (explainFailure) {
      // 主动中止不算失败；已经流出来的部分照样留下。
      if (controller.signal.aborted) {
        if (accumulated) {
          setExplainTurns((current) => [...current, { role: 'assistant', text: accumulated }])
        }
      } else {
        setExplainError(toErrorMessage(explainFailure))
      }
    } finally {
      setExplainDraft('')
      setExplainStreaming(false)
      explainAbortRef.current = null
    }
  }

  function openExplain() {
    if (!onExplain) {
      submit('我不明白这个问题是什么意思')
      return
    }
    setExplainOpen(true)
    if (explainTurns.length === 0 && !explainStreaming) void runExplain('')
  }

  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-4 rounded-[var(--radius-xl)] border border-border bg-surface p-4 sm:p-6"
      aria-live="polite"
      aria-busy={isBusy}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ai">
            已确认 {conversation.completedCount} 项 · 还有约 {conversation.remainingEstimate}{' '}
            项待确认
            {conversation.remainingBreakdown
              ? `（其中关键必答 ${conversation.remainingBreakdown.critical} 项）`
              : ''}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            {conversation.remainingEstimateReason || '问题会根据你的回答调整。'}
          </p>
        </div>
        <span className="rounded-full bg-ai/10 px-3 py-1 text-xs font-medium text-ai">
          第 {session.round} 轮
        </span>
      </header>

      <article className="sticky top-3 z-10 rounded-[var(--radius-lg)] border border-ai/30 bg-gray-0 p-4 shadow-sm sm:p-5">
        <p className="text-xs font-medium text-gray-500">现在只确认这一件事</p>
        <h2 className="mt-2 text-lg font-semibold leading-7 text-heading">{question.question}</h2>
        {question.reason ? (
          <p className="mt-2 text-sm leading-6 text-gray-600">这会影响：{question.reason}</p>
        ) : null}

        {options.length === 0 ? (
          <p className="mt-2 text-xs leading-5 text-gray-500">
            这题没有预设选项——点下面的「其他（我自己填）」就能直接写（
            {ANSWER_KIND_HINTS[question.answerKind] ?? '例如：先按现在的做法办'}
            ）；想先看几个方向就点「给我选项」。
            {question.allowUnknown
              ? '还没定的话，选「还不确定」也可以。'
              : '这一项会影响后面的计划，暂时不能跳过；如果实在没头绪，点「请给我建议」我给一个可以直接采用的起点。'}
          </p>
        ) : null}

        {options.length > 0 || question.allowOther ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="可选答案">
            {options.map((option) => {
              const pressed = selected.includes(option.value)
              return (
                <Button
                  key={option.id}
                  type="button"
                  variant={pressed ? 'secondary' : 'ghost'}
                  size="sm"
                  disabled={isBusy}
                  aria-pressed={isMulti ? pressed : undefined}
                  className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                  onClick={() => {
                    if (!isMulti) return submit(option.value)
                    setSelected((current) =>
                      current.includes(option.value)
                        ? current.filter((value) => value !== option.value)
                        : [...current, option.value],
                    )
                  }}
                >
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="mt-1 block text-xs font-normal leading-5 text-gray-500">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </Button>
              )
            })}
            {question.allowOther ? (
              otherActive ? (
                <form
                  className="flex gap-2 sm:col-span-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    acceptOther()
                  }}
                >
                  <input
                    ref={otherInputRef}
                    value={otherText}
                    disabled={isBusy}
                    aria-label="其他答案"
                    placeholder="用自己的话写这题的答案"
                    className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-ai/40 bg-gray-0 px-3 text-sm outline-none focus-visible:shadow-focus"
                    onChange={(event) => setOtherText(event.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={isBusy || !otherText.trim()}
                  >
                    {isMulti ? '加入所选' : '用这个答案'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setOtherActive(false)
                      setOtherText('')
                    }}
                  >
                    取消
                  </Button>
                </form>
              ) : (
                // 「其他」是这道题的最后一个选项，不是页脚里的辅助按钮——
                // 用户的心智是「上面都不合适，那我自己填」，位置必须在选项里。
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  className="h-auto justify-start whitespace-normal border border-dashed border-border px-3 py-2 text-left"
                  onClick={() => {
                    setOtherActive(true)
                    requestAnimationFrame(() => otherInputRef.current?.focus())
                  }}
                >
                  <span>
                    <span className="block font-medium">其他（我自己填）</span>
                    <span className="mt-1 block text-xs font-normal leading-5 text-gray-500">
                      {options.length > 0
                        ? '上面都不合适，就用自己的话写'
                        : '这题没有预设选项，直接用自己的话写'}
                    </span>
                  </span>
                </Button>
              )
            ) : null}
            {isMulti ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isBusy || selected.length === 0}
                onClick={() => submit(selected.join('、'))}
              >
                确认已选 {selected.length} 项
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => submit('为什么要问这个？')}
          >
            为什么要问？
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={openExplain}>
            我不明白
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => submit('请根据目前资料给我建议，但先不要替我确认')}
          >
            请给我建议
          </Button>
          {question.allowUnknown ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => submit('这件事现在还不确定，请先记为待决定事项')}
            >
              还不确定
            </Button>
          ) : null}
          {options.length === 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => submit('请给我几个选项')}
            >
              给我选项
            </Button>
          ) : null}
        </div>

        {explainOpen ? (
          <section
            className="mt-4 rounded-[var(--radius-lg)] border border-ai/30 bg-ai/5 p-3 sm:p-4"
            aria-label="这道题的解释"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-ai">这道题在问什么</p>
              <div className="flex gap-1">
                {explainStreaming ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => explainAbortRef.current?.abort()}
                  >
                    停止
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    explainAbortRef.current?.abort()
                    setExplainOpen(false)
                  }}
                >
                  收起
                </Button>
              </div>
            </div>

            <div className="mt-2 space-y-2" aria-live="polite">
              {explainTurns.map((item, index) => (
                <p
                  key={`${item.role}:${index}`}
                  className={cn(
                    'whitespace-pre-wrap text-sm leading-6',
                    item.role === 'user'
                      ? 'ml-6 rounded-[var(--radius-md)] bg-gray-100 px-3 py-2 text-heading'
                      : 'text-gray-700',
                  )}
                >
                  {item.text}
                </p>
              ))}
              {explainDraft ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
                  {explainDraft}
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-ai align-text-bottom" />
                </p>
              ) : null}
              {explainStreaming && !explainDraft ? (
                <p className="flex items-center gap-2 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin text-ai" aria-hidden />
                  正在读这道题…
                </p>
              ) : null}
            </div>

            {explainError ? (
              <p className="mt-2 text-sm leading-6 text-danger" role="alert">
                {explainError}
              </p>
            ) : null}

            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (explainInput.trim()) void runExplain(explainInput)
              }}
            >
              <input
                value={explainInput}
                disabled={explainStreaming}
                placeholder="还想问什么？例如：这跟我要填的表单有什么关系"
                aria-label="继续问这道题"
                className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-gray-0 px-3 text-sm outline-none focus-visible:shadow-focus"
                onChange={(event) => setExplainInput(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={explainStreaming || !explainInput.trim()}
              >
                追问
              </Button>
            </form>
            <p className="mt-2 text-xs leading-5 text-gray-500">
              这里只解释、不作答；你在这里说的任何话都不会被当成这题的答案。
            </p>
          </section>
        ) : null}

        {latestReplies.length > 0 ? (
          <div
            className="mt-4 rounded-[var(--radius-md)] border border-ai/25 bg-ai/5 p-3"
            role="status"
            aria-live="polite"
          >
            <p className="text-xs font-medium text-ai">AI 刚刚的回应</p>
            {latestReplies.map((item) => (
              <p key={item.id} className="mt-1.5 text-sm leading-6 text-gray-700">
                {item.text}
              </p>
            ))}
            {proposedAnswerText ? (
              <div className="mt-3 border-t border-ai/20 pt-3">
                <p className="text-xs text-gray-600">
                  建议答案：<span className="font-medium text-heading">{proposedAnswerText}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => submit(proposedAnswerText)}
                  >
                    采用这个答案
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      setMessage(proposedAnswerText)
                      inputRef.current?.focus()
                    }}
                  >
                    改一下再用
                  </Button>
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-500">
                  采用前不会写入你的计划；你确认之后才会记录。
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {isBusy ? (
          <div
            className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-border bg-gray-50 p-3"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin text-ai" aria-hidden />
            <p className="flex-1 text-sm leading-6 text-gray-700">
              正在把你的回答交给模型…已等待 {formatElapsed(busySeconds)}
              {busySeconds >= 20
                ? `（输出慢的模型单轮可能要几分钟，最长等到 ${formatWaitLimit(ANALYZE_TIMEOUT_MS)}；也可以随时停止后重试）`
                : ''}
            </p>
            {onCancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                停止等待
              </Button>
            ) : null}
          </div>
        ) : null}

        {!isBusy && errorMessage ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-danger/30 bg-danger-bg/70 p-3"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            <p className="text-sm leading-6 text-danger">{errorMessage}</p>
          </div>
        ) : null}
      </article>

      <details className="rounded-[var(--radius-lg)] border border-border bg-gray-0 p-3">
        <summary className="cursor-pointer text-sm font-medium text-heading">
          查看本题对话（{conversation.turns.length} 条）
        </summary>
        <ol className="mt-3 space-y-2" aria-label="本题对话记录">
          {conversation.turns.map((item) => (
            <li
              key={item.id}
              className={cn(
                'rounded-[var(--radius-md)] px-3 py-2 text-sm leading-6',
                item.role === 'assistant'
                  ? 'bg-primary-50 text-gray-700'
                  : 'ml-6 bg-gray-100 text-heading',
              )}
            >
              <span className="mr-2 text-xs font-medium text-gray-500">
                {item.role === 'assistant' ? 'AI' : '你'}
              </span>
              {item.text}
            </li>
          ))}
        </ol>
      </details>

      <form
        className="rounded-[var(--radius-lg)] border border-border bg-gray-0 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit(message)
        }}
      >
        <label htmlFor="adaptive-clarification-input" className="text-xs font-medium text-gray-600">
          回答、补充，或继续问 AI…
        </label>
        <div className="mt-2 flex gap-2">
          <input
            ref={inputRef}
            id="adaptive-clarification-input"
            value={message}
            disabled={isBusy}
            placeholder="可以直接用自己的话说，例如：大约 500 人；或问为什么需要这个资料"
            className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-gray-0 px-3 text-sm outline-none focus-visible:shadow-focus"
            onChange={(event) => setMessage(event.target.value)}
          />
          <Button type="submit" variant="secondary" size="sm" disabled={isBusy || !message.trim()}>
            发送
          </Button>
        </div>
      </form>

      <aside className="rounded-[var(--radius-lg)] bg-gray-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-gray-500">AI 目前的理解</p>
            <p className="mt-1 text-sm leading-6 text-gray-700">
              {conversation.currentUnderstanding}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              setMessage('我想修改之前的回答：')
              inputRef.current?.focus()
            }}
          >
            修改之前的回答
          </Button>
        </div>
        {session.ledger.entries.length > 0 ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-gray-500">你已经确认的内容</p>
            {/* 原来是 flex justify-between + shrink-0：多选答案一长就顶出容器右边被切掉。
                改成上下两行，答案自行换行，长短都读得完整。 */}
            <ul className="mt-2 space-y-2">
              {session.ledger.entries.slice(-5).map((entry) => (
                <li key={`${entry.needId}:${entry.revision}`} className="text-xs leading-5">
                  <p className="text-gray-500">
                    {entry.questionSummary}
                    {entry.source === 'absorbed' ? (
                      // 从同一段话里额外读出来的答案必须标出来源，
                      // 万一读错了，用户一眼就能看见并改掉。
                      <span className="ml-1 rounded-full bg-ai/10 px-1.5 py-0.5 text-[10px] text-ai">
                        从你的描述中读到
                      </span>
                    ) : null}
                  </p>
                  <p
                    className={cn(
                      'mt-0.5 break-words font-medium',
                      entry.status === 'known_unknown' ? 'text-warning' : 'text-heading',
                    )}
                  >
                    {entry.status === 'known_unknown'
                      ? '待决定（会作为假设与风险列入计划）'
                      : formatAnswerList(entry.answer)}
                  </p>
                </li>
              ))}
            </ul>
            {session.ledger.entries.length > 5 ? (
              <p className="mt-2 text-xs text-gray-500">
                以上是最近 5 条，共已确认 {session.ledger.entries.length} 项。
              </p>
            ) : null}
          </div>
        ) : null}
      </aside>
      {conversation.canGeneratePreliminaryDraft && onPreliminaryDraft ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-primary-200 bg-primary-50 p-4">
          <p className="text-sm leading-6 text-primary-800">
            {conversation.preliminaryDraftReason ||
              '关键资料已确认；尚未决定的内容会明确列为假设、待决定事项或风险，并继续经过人工审查。'}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onClick={onPreliminaryDraft}
          >
            先生成初步草案
          </Button>
        </div>
      ) : conversation.preliminaryDraftReason ? (
        // 入口关着的时候也要说清「还差什么」。原先这里什么都不显示，
        // 用户只能反复作答，猜什么时候才算够。
        <p className="rounded-[var(--radius-lg)] border border-border bg-gray-50 p-3 text-xs leading-5 text-gray-600">
          {conversation.preliminaryDraftReason}
        </p>
      ) : null}
    </section>
  )
}

function ClarificationQueue({
  status,
  phase,
  activeCard,
  remainingCount,
  completedCount,
  totalCount,
  coverageValid,
  isBusy,
  onAnswer,
}: {
  status: AiProjectDraftStatus
  phase: import('@aiproj/types').ClarificationPhase
  activeCard: ClarificationCardType | null
  remainingCount: number
  completedCount: number
  totalCount: number
  coverageValid: boolean
  isBusy: boolean
  onAnswer: (answer: ClarificationAnswer) => void
}) {
  if (status === 'idle' || status === 'ready') return null

  if (!activeCard && status === 'clarifying') {
    return (
      <div
        className="rounded-[var(--radius-lg)] bg-surface p-5 text-sm text-gray-600"
        role="status"
        aria-live="polite"
      >
        {isBusy ? '正在校验答案并准备下一道问题…' : '当前阶段没有可发布的问题，请重试分析。'}
      </div>
    )
  }

  if (!activeCard) return null

  const phaseMeta = {
    core: { step: 1, label: '核心必答', description: '先确认所有项目都需要的 7 个事实。' },
    conditional: {
      step: 2,
      label: '专业补充',
      description: '依据已确认答案，只询问本项目实际触发的专业问题。',
    },
    agent: {
      step: 3,
      label: 'Agent 追问',
      description: 'Agent 只针对仍会影响计划质量的缺口继续追问。',
    },
    ready: { step: 3, label: '已完成', description: '澄清上下文已经就绪。' },
  }[phase]
  const progress =
    totalCount > 0 ? Math.min(100, Math.round((completedCount / totalCount) * 100)) : 0

  return (
    <div className="flex flex-col gap-4" aria-live="polite" aria-busy={isBusy}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ai">
            阶段 {phaseMeta.step}/3 · {phaseMeta.label}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-heading">一次只确认一个关键决定</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">{phaseMeta.description}</p>
        </div>
        <div className="text-right text-sm" aria-label={`还剩 ${remainingCount} 个问题`}>
          <p className="font-semibold text-heading">还剩 {remainingCount} 题</p>
          <p className="mt-1 text-xs text-gray-500">已完成 {completedCount} 题</p>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
        <div
          className="h-full rounded-full bg-ai transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>

      {!coverageValid ? (
        <div
          className="rounded-[var(--radius-md)] border border-danger/30 bg-danger-bg/70 p-3 text-sm text-danger"
          role="alert"
        >
          问题计划未通过遗漏检查，已停止发布后续问题。请重试分析。
        </div>
      ) : null}

      <ClarificationCard
        key={activeCard.cardId}
        card={activeCard}
        disabled={isBusy || !coverageValid}
        onAnswer={onAnswer}
      />
    </div>
  )
}

function ClarificationCard({
  card,
  disabled,
  onAnswer,
}: {
  card: ClarificationCardType
  disabled: boolean
  onAnswer: (answer: ClarificationAnswer) => void
}) {
  const articleRef = useRef<HTMLElement | null>(null)
  const initialSuggestedValue = Array.isArray(card.suggestedValue)
    ? card.suggestedValue.join('、')
    : card.suggestedValue === null || card.suggestedValue === undefined
      ? ''
      : String(card.suggestedValue)
  const [customValue, setCustomValue] = useState(initialSuggestedValue)
  const [selectedOptions, setSelectedOptions] = useState<Array<string | number>>([])
  const meta = categoryMeta[card.category]
  const Icon = meta.icon

  useEffect(() => {
    articleRef.current?.focus({ preventScroll: true })
  }, [card.cardId])

  function submit(action: ClarificationAnswer['action'], value: ClarificationValue) {
    onAnswer(buildClarificationAnswer(card, action, value))
  }

  function submitCustom() {
    const value = customValue.trim()
    if (!value) return
    submit('answer', card.questionType === 'number' ? Number(value) : value)
  }

  function toggleOption(value: string | number) {
    setSelectedOptions((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
  }

  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      className="flex max-w-3xl flex-col gap-5 rounded-[var(--radius-lg)] border border-border bg-gray-0 p-5 outline-none transition-colors duration-200 focus-visible:border-ai focus-visible:shadow-focus motion-reduce:transition-none"
      aria-labelledby={`${card.cardId}-title`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium',
            meta.className,
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {meta.label}
        </span>
        <span className="text-xs text-gray-500">{Math.round(card.confidence * 100)}%</span>
      </div>

      <div>
        <h3 id={`${card.cardId}-title`} className="text-md font-semibold text-heading">
          {card.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-gray-600">{card.description}</p>
        <p className="mt-2 text-xs leading-5 text-gray-500">{meta.description}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500">影响范围</p>
        <div className="flex flex-wrap gap-2">
          {card.impactScope.map((impact) => (
            <span
              key={`${card.cardId}-${impact.domain}`}
              className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600"
            >
              {impact.domain} · {impact.severity}
            </span>
          ))}
        </div>
      </div>

      {card.quickOptions.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {card.quickOptions.map((option) => (
            <Button
              key={`${card.cardId}-${option.label}`}
              type="button"
              variant={option.recommended ? 'secondary' : 'ghost'}
              size="sm"
              disabled={disabled}
              className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
              aria-label={option.label}
              aria-pressed={
                card.questionType === 'multi_choice'
                  ? selectedOptions.includes(option.value)
                  : undefined
              }
              onClick={() =>
                card.questionType === 'multi_choice'
                  ? toggleOption(option.value)
                  : submit('answer', option.value)
              }
            >
              <span className="flex flex-col gap-1">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs font-normal leading-5 text-gray-500">
                  {option.description}
                </span>
              </span>
            </Button>
          ))}
          {card.questionType === 'multi_choice' ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || selectedOptions.length === 0}
              className="sm:col-span-2"
              onClick={() => submit('answer', selectedOptions.map(String))}
            >
              确认已选 {selectedOptions.length} 项
            </Button>
          ) : null}
        </div>
      ) : null}

      {initialSuggestedValue ? (
        <p className="rounded-[var(--radius-md)] bg-primary-50 px-3 py-2 text-sm leading-6 text-primary-800">
          已从原始描述预填，请确认或修改：{initialSuggestedValue}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-gray-600" htmlFor={`${card.cardId}-custom`}>
          {card.customInput.label}
        </label>
        <p className="text-xs leading-5 text-gray-500">{card.customInput.description}</p>
        <div className="flex gap-2">
          <input
            id={`${card.cardId}-custom`}
            value={customValue}
            placeholder={card.customInput.placeholder}
            type={
              card.questionType === 'number'
                ? 'number'
                : card.questionType === 'date'
                  ? 'date'
                  : 'text'
            }
            disabled={disabled}
            className="min-h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-gray-0 px-3 text-sm text-gray-800 outline-none transition-[border-color,box-shadow] focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(event) => setCustomValue(event.target.value)}
            onInput={(event) => setCustomValue(event.currentTarget.value)}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || !customValue.trim()}
            onClick={submitCustom}
          >
            回答
          </Button>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
        {card.defaultValue ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || card.category === 'critical'}
            onClick={() => submit('default', card.defaultValue?.value ?? null)}
          >
            采用 AI 建议：{formatValue(card.defaultValue.value)}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !card.allowSkip}
          onClick={() => submit('skip', null)}
        >
          跳过
        </Button>
      </div>
    </article>
  )
}

export function AiProjectIntentReadOnlyFallback() {
  return (
    <section className="mx-auto max-w-3xl py-12">
      <div className="rounded-[var(--radius-xl)] border border-border bg-surface p-6 text-center">
        <Lock className="mx-auto h-10 w-10 text-gray-500" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-heading">当前账号不能使用 AI 创建入口</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          该能力需要组织内的 ai:trigger 权限。你仍然可以查看已有项目，但不能触发 AI 意图分析。
        </p>
      </div>
    </section>
  )
}
