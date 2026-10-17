'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Home, RotateCcw } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { TheaterPermissionFallback } from '@/components/next/theater/TheaterPermissionFallback'
import { NextDraftEmptyView } from '@/components/next/review/NextDraftEmptyView'
import { NextDraftErrorView } from '@/components/next/review/NextDraftErrorView'
import { NextDraftReviewPanel } from '@/components/next/review/NextDraftReviewPanel'
import { NextDraftSkeleton } from '@/components/next/review/NextDraftSkeleton'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAuthStore } from '@/stores/auth-store'

export type DraftRouteLoadState = 'loading' | 'loaded' | 'error' | 'notFound' | 'empty'

export interface DraftLoadErrorInfo {
  code: string
  message: string
}

/** 404 判定（后端 RESOURCE_NOT_FOUND / 跨租户掩蔽统一返回 HTTP 404）。 */
export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 404
  )
}

/** 错误归一：网络断开 → NETWORK_DISCONNECTED；其余优先消费 ApiError code。 */
export function describeDraftLoadError(error: unknown): DraftLoadErrorInfo {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const e = error as { code?: unknown; status?: unknown; message?: unknown }
    const isNetwork = e.status === undefined && !e.code && error instanceof TypeError
    if (isNetwork) {
      return { code: 'NETWORK_DISCONNECTED', message: '无法连接到草案服务，请检查网络设置。' }
    }
    return {
      code: typeof e.code === 'string' && e.code ? e.code : 'DRAFT_LOAD_FAILED',
      message:
        typeof e.message === 'string' && e.message ? e.message : '草案数据加载失败，请稍后重试。',
    }
  }
  if (error instanceof TypeError) {
    return { code: 'NETWORK_DISCONNECTED', message: '无法连接到草案服务，请检查网络设置。' }
  }
  return {
    code: 'DRAFT_LOAD_FAILED',
    message: error instanceof Error ? error.message : '草案数据加载失败，请稍后重试。',
  }
}

/**
 * 独立深链接审查路由（v3-ui-next-draft-review-panel tasks 3.6 / design D1 入口 B）。
 *
 * - 准入门禁：`PermissionGuard`（ai:view 或 ai:trigger，mode=any）；
 *   无权限角色渲染 TheaterPermissionFallback 只读拦截；
 * - 状态恢复：读取路由参数 `draftId`，经成熟端点 `GET /api/v1/ai/project-drafts/:id`
 *   异步拉取 `ProjectDraftDetail` 快照；在途展示 NextDraftSkeleton；
 * - 成功载入：`setDraftCompleted(draft, meta, validation)` + `enterReview()` 同步
 *   至 store，渲染与剧场内部完全一致的 NextDraftReviewPanel（零逻辑重复）；
 * - HTTP 404（含跨租户掩蔽）→ 中性 NextDraftEmptyView（RL-05 防泄露，绝不提示
 *   资源是否属于其他组织）；500/网络错误 → NextDraftErrorView（重新载入）；
 * - 返回重试生成：经 store.resetToContext 清现场后导航回 `/next/create` 剧场；
 *   放弃草案后渲染中性「草案已放弃」终态卡。
 */
export default function NextDraftReviewRoute() {
  const params = useParams<{ draftId: string }>()
  const draftId = params?.draftId ?? ''
  const router = useRouter()
  // 准入门禁镜像（与 PermissionGuard ai:view/ai:trigger 一致）：无权限时不发起任何
  // 草案请求（RL-05：不探测资源存在性）。
  const canView = useAuthStore((state) => state.hasPermission('ai:view'))
  const canTrigger = useAuthStore((state) => state.hasPermission('ai:trigger'))
  const permitted = canView || canTrigger

  const [phase, setPhase] = React.useState<DraftRouteLoadState>('loading')
  const [errorInfo, setErrorInfo] = React.useState<DraftLoadErrorInfo | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  const [sessionEnded, setSessionEnded] = React.useState(false)

  React.useEffect(() => {
    if (!permitted) return
    if (!draftId) {
      setPhase('notFound')
      return
    }
    let disposed = false
    setPhase('loading')
    setSessionEnded(false)
    setErrorInfo(null)

    aiDraftApi
      .get(draftId)
      .then((detail) => {
        if (disposed) return
        if (!detail.draft || !detail.meta || !detail.validation) {
          // 快照尚未沉淀完整实体（如 drafting 中会话）：中性数据缺失空态。
          setPhase('empty')
          return
        }
        const store = useAiProjectDraftStore.getState()
        store.setDraftCompleted(detail.draft, detail.meta, detail.validation)
        useAiProjectDraftStore.setState({
          draftId: detail.draftId,
          draftVersion: detail.version,
        })
        store.enterReview()
        // 重置转正确认交互态并按当前草案重建全选选择集（与 ActionBar.handleRefreshLatest、
        // AutoFixModal 载入路径一致），防止上一草案的 partial 选择集 / 弹窗态串台到新草案。
        const confirmStore = useAiDraftConfirmStore.getState()
        confirmStore.resetConfirmState()
        confirmStore.initSelection(detail.draft)
        setPhase('loaded')
      })
      .catch((error: unknown) => {
        if (disposed) return
        if (isNotFoundError(error)) {
          setPhase('notFound')
          return
        }
        setErrorInfo(describeDraftLoadError(error))
        setPhase('error')
      })

    return () => {
      disposed = true
    }
  }, [draftId, attempt, permitted])

  return (
    <PermissionGuard
      require={['ai:view', 'ai:trigger']}
      mode="any"
      fallback={<TheaterPermissionFallback />}
    >
      <div
        data-next-draft-route
        className="min-h-screen w-full bg-[var(--nx-space-bg)] px-4 py-8 md:px-6"
      >
        {phase === 'loading' ? <NextDraftSkeleton /> : null}

        {phase === 'notFound' || phase === 'empty' ? (
          <NextDraftEmptyView
            variant={phase === 'notFound' ? 'notFound' : 'empty'}
            onBackHome={() => router.replace('/next')}
            onCreate={phase === 'empty' ? () => router.replace('/next/create') : undefined}
          />
        ) : null}

        {phase === 'error' ? (
          <NextDraftErrorView
            code={errorInfo?.code ?? 'DRAFT_LOAD_FAILED'}
            message={errorInfo?.message}
            onReload={() => setAttempt((current) => current + 1)}
            onBackHome={() => router.replace('/next')}
          />
        ) : null}

        {phase === 'loaded' ? (
          sessionEnded ? (
            <section
              data-draft-session-ended
              role="status"
              aria-label="草案已放弃"
              className="mx-auto w-full max-w-md rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-8 text-center"
            >
              <h2 className="text-base font-semibold text-[var(--nx-text-primary)]">
                草案已放弃，会话已结束
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--nx-text-secondary)]">
                该草案已标记为放弃，未创建任何正式项目记录。
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  data-ended-back-home
                  onClick={() => router.replace('/next')}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  <Home className="h-4 w-4" aria-hidden />
                  返回首页
                </button>
                <button
                  type="button"
                  data-ended-back-create
                  onClick={() => router.replace('/next/create')}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  发起全新项目创建
                </button>
              </div>
            </section>
          ) : (
            <NextDraftReviewPanel
              onRetry={() => router.replace('/next/create')}
              onDiscarded={() => setSessionEnded(true)}
            />
          )
        ) : null}
      </div>
    </PermissionGuard>
  )
}
