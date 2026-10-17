'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import type { ClarificationAnswer, ClarificationCard } from '@aiproj/types'
import { PermissionGuard } from '@/components/PermissionGuard'
import { NextDraftReviewPanel } from '@/components/next/review/NextDraftReviewPanel'
import { TheaterClarificationCard } from '@/components/next/theater/TheaterClarificationCard'
import { TheaterErrorCard } from '@/components/next/theater/TheaterErrorCard'
import { LiveOutputPanel, TheaterLiveOutput } from '@/components/next/theater/TheaterLiveOutput'
import { useLiveOutputLanes } from '@/lib/ai-draft/live-output-client'
import { TheaterGenerationStage } from '@/components/next/theater/TheaterGenerationStage'
import { TheaterIntentFeedback } from '@/components/next/theater/TheaterIntentFeedback'
import { TheaterIntentInput } from '@/components/next/theater/TheaterIntentInput'
import { ProjectManualPlacementModal } from '@/components/next/theater/ProjectManualPlacementModal'
import { TheaterPermissionFallback } from '@/components/next/theater/TheaterPermissionFallback'
import { TheaterReadyView } from '@/components/next/theater/TheaterReadyView'
import { TheaterSettledView } from '@/components/next/theater/TheaterSettledView'
import { TheaterShell } from '@/components/next/theater/TheaterShell'
import {
  PENDING_DRAFT_ID,
  startTheaterGeneration,
  startTheaterGenerationFromContext,
  startTheaterRunner,
  theaterGenerationContext,
  useTheaterRunnerStore,
} from '@/lib/next/theater-runner'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/** 生成剧场 3D 沉浸场景视口（路由级懒加载，ssr: false，保持主包 0.00KB 增量） */
const LazyTheater3DCanvas = dynamic(
  () => import('@/components/next/3d/theater/Theater3DCanvas').then((mod) => mod.Theater3DCanvas),
  { ssr: false },
)

/**
 * 生成剧场页完整装配（/next/create，v3-ui-next-theater-generation 任务 3.6 +
 * v3-ui-next-draft-review-panel 任务 3.7 审查态接管）。
 *
 * - `PermissionGuard require="ai:trigger"`：无权限角色渲染 TheaterPermissionFallback 只读拦截；
 * - 挂载与组织切换时 `initializeScope` 绑定租户隔离域（RL-05）；
 * - **后台运行**：意图分析、项目理解、全自动开始生成与草案生成流都由外壳常驻的后台运行器
 *   （`lib/next/theater-runner`）驱动，离开本页也继续；本页只按 store 状态展示与交互；
 * - 状态机渲染：idle/analyzing → 意图输入｜ clarifying → 逐题澄清卡｜
 *   ready（无生成在途）→ 就绪态（人工确认关卡）｜ generating → 9 模块建造舞台
 *   + 品牌 Loader（draftStatus==='drafting'）｜ reviewing → 就地展开 NextDraftReviewPanel
 *   审查工作面（B2c-1 接管，零二次网络请求）｜ settled → 草案落定视图｜ failed → 错误恢复卡；
 * - 「开始生成项目草案」接通真实生成调度：提取已确认 context → store.startDraftGeneration
 *   （初始 'pending' 占位）→ runDraftGenerationStream（W1 SSE 客户端）；离开 drafting 态时
 *   由运行器中止旧连接（页面卸载不再中止，生成在后台继续）；
 * - 失败就地恢复：重试生成带原上下文重新发起（resetToContext 清失败现场保上下文），
 *   重新开始经二次确认调用 store.restart()；落定态「重新生成」同样沿用已确认上下文；
 * - **URL 坐标协同（design D1）**：切入审查态时 `history.replaceState` 静默更新
 *   `/next/create?draftId=...&view=review`；刷新后可经独立深链接 `/next/draft/[draftId]`
 *   复原现场；离开审查态（重试/放弃/保存）自动摘除 review 查询；
 * - RL-01：生成完成仅沉淀草案会话，绝不调用 confirm、绝不落正式项目表。
 */
function NextCreatePageInner() {
  const router = useRouter()

  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)

  const status = useAiProjectDraftStore((state) => state.status)
  const cards = useAiProjectDraftStore((state) => state.cards)
  const activeCard = useAiProjectDraftStore((state) => state.activeCard)
  const answers = useAiProjectDraftStore((state) => state.answers)
  const clarityPhase = useAiProjectDraftStore((state) => state.clarificationPhase)
  const totalCount = useAiProjectDraftStore((state) => state.totalCount)
  const completedCount = useAiProjectDraftStore((state) => state.completedCount)
  const rawInput = useAiProjectDraftStore((state) => state.rawInput)
  const adaptiveSessionToken = useAiProjectDraftStore((state) => state.adaptiveSessionToken)

  // 生成阶段派生状态（design D1：纯由 store 字段派生，单一数据源）。
  const draftStatus = useAiProjectDraftStore((state) => state.draftStatus)
  const draft = useAiProjectDraftStore((state) => state.draft)
  const validation = useAiProjectDraftStore((state) => state.validation)
  const draftFailure = useAiProjectDraftStore((state) => state.draftFailure)
  const draftId = useAiProjectDraftStore((state) => state.draftId)
  // 分析 / 生成都由常驻的后台运行器驱动（外壳也挂着一份，离开本页也继续），本页只展示与交互
  React.useEffect(() => startTheaterRunner(), [])
  const analyzeLiveId = useTheaterRunnerStore((state) => state.analyzeLiveId)
  const analyzeLive = useLiveOutputLanes(analyzeLiveId)
  const draftVersion = useAiProjectDraftStore((state) => state.draftVersion)

  // 就绪态「重新调整回答」回跳澄清：重放的目标卡（W2 revealCard 机制，幂等）。
  const [replayCard, setReplayCard] = React.useState<ClarificationCard | null>(null)
  // W1 客户端实时连接健康度（stale/reconnecting 时驱动 Stage 恢复提示条）。
  const streamHealth = useTheaterRunnerStore((state) => state.streamHealth)

  // W2 任务 2.5/2.7：生成剧场手动立项模式与放置立项（?mode=manual 联动）
  const [manualPlacementOpen, setManualPlacementOpen] = React.useState(false)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('mode') === 'manual') {
      setManualPlacementOpen(true)
    }
  }, [])

  const isSettled = Boolean(draft && validation)
  // B2c-1 审查态接管（design D1）：draftStatus ∈ {reviewing, editing} 且权威实体齐备时，
  // 就地展开暗黑仪器感审查工作面；内存态零二次网络请求。
  // - editing 由 B2c-2 就地编辑触发（applyDraftFieldEdit），面板必须保持挂载；
  // - confirmed 为转正成功终态：成功视窗 NextDraftConfirmSuccessModal 挂载在审查面板内，
  //   若立即回落落定视图会卸载成功视窗，故确认态同样保持面板挂载直至用户导航离开。
  const isReviewing =
    (draftStatus === 'reviewing' || draftStatus === 'editing' || draftStatus === 'confirmed') &&
    Boolean(draft && validation)
  const isGenerating = draftStatus === 'drafting' && !draft && !draftFailure
  // 意图解析失败（store.fail → status='error'）与生成失败（draftStatus='error' /
  // draftFailure）统一收敛到错误恢复卡（TheaterErrorCard 按 draftFailure 自适应双模式）。
  const isFailed = status === 'error' || draftStatus === 'error' || draftFailure !== null
  const isReady = status === 'ready' && !isGenerating && !isSettled && !isFailed

  React.useEffect(() => {
    useAiProjectDraftStore.getState().initializeScope({
      userId: user?.id ?? null,
      organizationId: selectEffectiveOrganizationId({ currentOrganizationId, user }),
    })
  }, [user, currentOrganizationId])

  // URL 深链接引导（design D1 入口 A 协同）：URL 携带 view=review 且 store 无匹配
  // 审查会话时（F5 后 sessionStorage 丢失 / 新标签页打开分享链接），引导至独立
  // 深链接路由 `/next/draft/[draftId]` 经成熟端点恢复审查现场。
  // window.location 直接读 URL（replaceState 协同后 next/navigation 的
  // useSearchParams 快照可能与实际不符，以真实 URL 为准）。
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') !== 'review') return
    const urlDraftId = params.get('draftId')
    if (!urlDraftId) return
    const store = useAiProjectDraftStore.getState()
    if (
      (store.draftStatus === 'reviewing' ||
        store.draftStatus === 'editing' ||
        store.draftStatus === 'confirmed') &&
      store.draftId === urlDraftId
    ) {
      return
    }
    router.replace(`/next/draft/${encodeURIComponent(urlDraftId)}`)
  }, [router])

  // URL 坐标清理：离开审查态（返回重试/保存/放弃后）静默摘除 view=review 查询。
  React.useEffect(() => {
    if (isReviewing) return
    if (new URLSearchParams(window.location.search).get('view') !== 'review') return
    window.history.replaceState(null, '', window.location.pathname)
  }, [isReviewing])

  // URL 坐标协同：切入审查态时静默更新至 `/next/create?draftId=...&view=review`，
  // 刷新或分享该 URL 可直接复原审查现场（design D1）。
  React.useEffect(() => {
    if (!isReviewing || !draftId) return
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?draftId=${encodeURIComponent(draftId)}&view=review`,
    )
  }, [isReviewing, draftId])

  function handleAnswer(answer: ClarificationAnswer) {
    // 先落答案（handleAllAnswered 依赖 store.answers 完整）。
    useAiProjectDraftStore.getState().recordAnswer(answer)
    // 回跳卡作答完成：释放 replayCard。注意回跳流中该卡即最后一张卡
    // （store.cards 已空），释放后组件会因 clarifying 分支卸载、其 allAnswered
    // 通知不会再触发——必须在此直接走统一收尾（retry → 重算回就绪，RL-01）。
    if (replayCard && answer.cardId === replayCard.cardId) {
      const draft = useAiProjectDraftStore.getState()
      const revisitComplete = draft.status === 'ready' && draft.cards.length === 0
      setReplayCard(null)
      if (revisitComplete) handleAllAnswered()
    }
  }

  function handleAllAnswered() {
    // 全部卡片作答完毕：清回跳卡，调用 retry() 回 analyzing → 统一通道带最新
    // answers 重算（服务端裁决是否仍需澄清或直通就绪，RL-01：绝不自动生成）。
    const draftStore = useAiProjectDraftStore.getState()
    if (draftStore.status === 'analyzing') return
    setReplayCard(null)
    draftStore.retry()
  }

  function handleEditContext() {
    // 就绪态回跳澄清第一题：重放最近响应卡集的首卡（基于 answers 预填由卡片组件完成）。
    const target = useTheaterRunnerStore.getState().lastCardSet[0] ?? null
    if (target) {
      setReplayCard(target)
    } else {
      // 无卡可回跳（如 branch='ready' 直通会话）：退化为重新分析。
      useAiProjectDraftStore.getState().retry()
    }
  }

  function handleStartGeneration() {
    // 人工确认关卡（RL-01）：仅从已就绪上下文显式发起，零自动生成。
    startTheaterGenerationFromContext()
  }

  function handleRetryGeneration() {
    // 生成失败就地恢复（design D9）：有真实失败会话时复用会话 POST /retry
    // （服务端 checkpoint 断点续跑，已完成阶段不重新调模型）；否则退回全新生成。
    const store = useAiProjectDraftStore.getState()
    if (!store.context) return
    const failedDraftId = store.draftId
    if (failedDraftId && failedDraftId !== PENDING_DRAFT_ID) {
      const context = theaterGenerationContext()
      if (context) startTheaterGeneration(context, undefined, failedDraftId)
      return
    }
    store.resetToContext()
    startTheaterGenerationFromContext()
  }

  function handleRegenerate() {
    // 落定态「重新生成」：沿用已确认上下文重新发起生成（不转正、不落库）。
    startTheaterGenerationFromContext()
  }

  function handleEnterReview() {
    // 向 B2c 审查阶段移交锚点（design D8）：进入草案审查，仍零自动转正（RL-01）。
    useAiProjectDraftStore.getState().enterReview()
  }

  const clarifying = status === 'clarifying' || replayCard !== null

  return (
    <PermissionGuard require="ai:trigger" fallback={<TheaterPermissionFallback />}>
      <TheaterShell background3D={<LazyTheater3DCanvas />}>
        <TheaterIntentFeedback />

        <div data-theater-stage className="flex flex-1 flex-col items-center justify-center">
          {isReviewing ? (
            <NextDraftReviewPanel />
          ) : status === 'idle' || status === 'analyzing' ? (
            <div className="flex w-full flex-col items-center gap-4">
              <TheaterIntentInput onOpenManualPlacement={() => setManualPlacementOpen(true)} />
              {status === 'analyzing' ? (
                <div className="w-full max-w-3xl">
                  <LiveOutputPanel
                    compact
                    lanes={analyzeLive.lanes}
                    totalChars={analyzeLive.totalChars}
                    title="AI 正在理解项目并准备问题"
                    emptyText="正在连接模型，理解与出题的输出会在这里实时显示…"
                  />
                </div>
              ) : null}
            </div>
          ) : clarifying ? (
            <TheaterClarificationCard
              cards={cards}
              activeCard={activeCard}
              answers={answers}
              phase={clarityPhase}
              totalCount={totalCount}
              completedCount={completedCount}
              rawInput={rawInput}
              adaptiveSessionToken={adaptiveSessionToken}
              // 澄清分支渲染时 status 只可能是 clarifying（或 ready 调整模式），
              // analyzing 已被前置分支接管，故无需传 isBusy（默认 false）。
              revealCard={replayCard}
              onAnswer={handleAnswer}
              onAllAnswered={handleAllAnswered}
            />
          ) : isGenerating ? (
            <div data-theater-generating className="flex w-full flex-col items-center gap-8">
              <TheaterLiveOutput />
              <TheaterGenerationStage
                // W1 客户端实时健康度驱动恢复提示条（design D4 接线：stale →
                // 「连接暂时停滞」，reconnecting → 「正在重新建立进度连接」）
                healthState={streamHealth ?? undefined}
              />
            </div>
          ) : isSettled ? (
            <TheaterSettledView
              draftId={draftId ?? PENDING_DRAFT_ID}
              version={draftVersion}
              onEnterReview={handleEnterReview}
              onRegenerate={handleRegenerate}
            />
          ) : isFailed ? (
            <TheaterErrorCard onRetryGeneration={handleRetryGeneration} />
          ) : isReady ? (
            <div className="flex w-full flex-col items-center gap-4">
              <TheaterReadyView
                onStartGeneration={handleStartGeneration}
                onEditContext={handleEditContext}
              />
            </div>
          ) : null}
        </div>

        {/* 手动放置立项模态弹窗（W2 任务 2.5/2.7） */}
        <ProjectManualPlacementModal
          open={manualPlacementOpen}
          onOpenChange={(isOpen) => {
            setManualPlacementOpen(isOpen)
            if (!isOpen) {
              const params = new URLSearchParams(window.location.search)
              if (params.get('mode') === 'manual') {
                params.delete('mode')
                const query = params.toString()
                window.history.replaceState(
                  null,
                  '',
                  query ? `${window.location.pathname}?${query}` : window.location.pathname,
                )
              }
            }
          }}
        />
      </TheaterShell>
    </PermissionGuard>
  )
}

/**
 * 页面入口（tasks 3.7）。URL 协同全部读取 window.location，无需 useSearchParams，
 * 保持轻量默认导出。
 */
export default function NextCreatePage() {
  return <NextCreatePageInner />
}
