'use client'

/**
 * ReportJobStatusIndicator —— 周期报表异步作业状态监视器（v3-ui-next-reports-domain W2）。
 *
 * - 消费 `useV2PeriodicJob`（queued/running 时 hook 内建 2000ms 非阻塞轮询，终态自动停止）；
 * - queued/running：暗黑发丝脉冲 + 阶段文案 + 耗时计时；
 * - failed：停止轮询，展示失败详情与「重试生成」（`useV2PeriodicRetryJob`，新作业重新入队后
 *   自动接管新 jobId，无需用户重配日期）；
 * - succeeded：停止轮询，Toast 提示成功后经 500ms 引导切入该版本审阅（onSucceeded）。
 * RL-01：本组件只监视与重试生成作业，绝不自动签署或转正任何草稿。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, RotateCw, X } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useV2PeriodicJob, useV2PeriodicRetryJob } from '@/hooks/use-reports-v2'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// 类型（v2PeriodicJob / v2PeriodicRetryJob 客户端返回 unknown，按响应结构本地定型）
// ---------------------------------------------------------------------------

export interface PeriodicJobRecord {
  id: number
  versionId?: number | null
  templateId?: string | null
  status?: string | null
  progress?: string | null
  errorCategory?: string | null
  errorDetail?: string | null
  startedAt?: string | null
  createdAt?: string | null
  finishedAt?: string | null
}

export interface PeriodicJobEnvelope {
  data?: PeriodicJobRecord | null
}

export interface ReportJobStatusIndicatorProps {
  projectId: number
  /** 激活的作业 id；null 时不渲染。 */
  jobId: number | null
  /** 作业成功（版本已落库）回调：切换到版本审阅并定位该版本。 */
  onSucceeded?: (versionId: number | null) => void
  /** 用户关闭监视器（如失败后放弃）。 */
  onClose?: () => void
}

/** 阶段文案：queued/running 静态两阶段展示（诚实披露，不做伪动态渲染）。 */
export function describeJobStatus(status: string | null | undefined): {
  title: string
  phases: string[]
} {
  switch (status) {
    case 'queued':
      return { title: '作业排队中', phases: ['任务已入队，等待生成调度…'] }
    case 'running':
      return {
        title: 'AI 草稿生成中',
        phases: ['正在抽取项目交付数据…', 'AI 正在结构化撰写 8 大核心章节…'],
      }
    case 'succeeded':
      return { title: '生成完成', phases: ['报表版本已生成，正在准备进入审阅…'] }
    case 'failed':
      return { title: '生成失败', phases: [] }
    case 'cancelled':
      return { title: '作业已取消', phases: [] }
    default:
      return { title: '作业状态未知', phases: [] }
  }
}

/** 秒表展示（mm:ss）。 */
export function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${`${minutes}`.padStart(2, '0')}:${`${seconds}`.padStart(2, '0')}`
}

export function ReportJobStatusIndicator({
  projectId,
  jobId,
  onSucceeded,
  onClose,
}: ReportJobStatusIndicatorProps) {
  const tier = useImmersionTier()
  // 重试后后端返回全新作业：本地接管新 jobId（父面板无需感知）
  const [activeJobId, setActiveJobId] = useState<number | null>(jobId)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const jobQuery = useV2PeriodicJob(projectId, activeJobId)
  const retryMutation = useV2PeriodicRetryJob(projectId)

  // 父级换发新 jobId（重新生成）时同步
  useEffect(() => {
    setActiveJobId(jobId)
    setElapsedSeconds(0)
  }, [jobId])

  const envelope = (jobQuery.data as PeriodicJobEnvelope | undefined) ?? null
  const job = envelope?.data ?? null
  const status = job?.status ?? null
  const isActive = status === 'queued' || status === 'running'

  // 耗时计时（仅 queued/running 且已有开始时间时运行）
  useEffect(() => {
    if (!isActive) return
    const anchor = job?.startedAt ?? job?.createdAt
    if (!anchor) {
      setElapsedSeconds(0)
      return
    }
    const startedAt = new Date(anchor).getTime()
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [isActive, job?.startedAt, job?.createdAt])

  // 成功分支：Toast + 500ms 后引导切入版本审阅（一次性）
  useEffect(() => {
    if (status !== 'succeeded') return
    const targetVersionId = job?.versionId ?? null
    toast({
      variant: 'success',
      title: '报表生成成功',
      description: targetVersionId == null ? undefined : '正在进入版本审阅…',
    })
    const timer = window.setTimeout(() => {
      onSucceeded?.(targetVersionId)
    }, 500)
    return () => window.clearTimeout(timer)
    // 仅作业状态推进到 succeeded 时触发一次
  }, [status])

  const stage = describeJobStatus(status)

  async function handleRetry() {
    if (!activeJobId) return
    try {
      const result = (await retryMutation.mutateAsync(activeJobId)) as
        PeriodicJobEnvelope | undefined
      const newJobId = result?.data?.id
      if (typeof newJobId === 'number') {
        setActiveJobId(newJobId)
        setElapsedSeconds(0)
      }
    } catch {
      // 错误呈现于重试按钮下方
    }
  }

  const retryErrorText =
    typeof retryMutation.error === 'object' &&
    retryMutation.error !== null &&
    'message' in retryMutation.error
      ? String((retryMutation.error as { message: unknown }).message)
      : '重试请求失败，请稍后再试'

  if (!activeJobId) return null

  return (
    <section
      data-job-indicator
      data-job-status={status ?? 'loading'}
      data-immersion={tier}
      aria-live="polite"
      className={cn(
        'rounded-md border p-4',
        status === 'failed'
          ? 'border-[var(--nx-status-danger)]'
          : status === 'cancelled'
            ? 'border-[var(--nx-border-hairline)]'
            : status === 'succeeded'
              ? 'border-[var(--nx-status-success)]'
              : 'border-[var(--nx-border-focus)]',
      )}
      style={
        status === 'failed'
          ? { backgroundColor: 'color-mix(in srgb, var(--nx-status-danger) 6%, transparent)' }
          : status === 'succeeded'
            ? { backgroundColor: 'color-mix(in srgb, var(--nx-status-success) 6%, transparent)' }
            : undefined
      }
    >
      {jobQuery.isError || (status === null && !jobQuery.isLoading) ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-status-danger)]"
              aria-hidden
            />
            <div>
              <p className="font-medium text-[var(--nx-text-primary)]">无法获取作业状态</p>
              <p className="mt-0.5 text-xs text-[var(--nx-text-muted)]">
                {jobQuery.error?.message ?? '作业可能已被清理或不存在'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-job-retry
              onClick={() => void jobQuery.refetch()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-border-focus)]"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              重新获取
            </button>
            {onClose ? (
              <button
                type="button"
                data-job-close
                aria-label="关闭作业监视器"
                onClick={onClose}
                className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      ) : status === 'failed' ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-status-danger)]"
                aria-hidden
              />
              <div>
                <p className="text-sm font-medium text-[var(--nx-text-primary)]">
                  生成失败（作业 #{job?.id ?? activeJobId}）
                </p>
                <p className="mt-1 text-xs text-[var(--nx-text-secondary)]">
                  {job?.errorDetail ?? job?.errorCategory ?? '上游生成服务执行失败，请重试'}
                </p>
              </div>
            </div>
            {onClose ? (
              <button
                type="button"
                data-job-close
                aria-label="关闭作业监视器"
                onClick={onClose}
                className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
            {retryMutation.isError ? (
              <span role="alert" className="text-xs text-[var(--nx-status-danger)]">
                {retryErrorText}
              </span>
            ) : null}
            <button
              type="button"
              data-job-retry
              onClick={() => void handleRetry()}
              disabled={retryMutation.isPending}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {retryMutation.isPending ? (
                <RotateCw className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RotateCw className="h-4 w-4" aria-hidden />
              )}
              重试生成
            </button>
          </div>
        </div>
      ) : status === 'cancelled' ? (
        <p className="text-sm text-[var(--nx-text-secondary)]">
          该生成作业已被取消，可重新发起生成。
        </p>
      ) : status === 'succeeded' ? (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--nx-status-success)]" aria-hidden />
          <p className="text-[var(--nx-text-primary)]">生成成功，正在进入版本审阅…</p>
        </div>
      ) : jobQuery.isLoading ? (
        <div className="flex items-center gap-3 text-sm text-[var(--nx-text-secondary)]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--nx-accent)]" />
          正在获取作业状态…
        </div>
      ) : (
        // queued / running
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="relative mt-1 flex h-2.5 w-2.5">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--nx-accent) 60%, transparent)',
                  }}
                />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--nx-accent)]" />
              </span>
              <div>
                <p className="text-sm font-medium text-[var(--nx-text-primary)]">
                  {stage.title}
                  <span className="ml-2 font-mono text-[11px] text-[var(--nx-text-muted)]">
                    #{job?.id ?? activeJobId}
                  </span>
                </p>
                <ul className="mt-1.5 space-y-1">
                  {stage.phases.map((phase) => (
                    <li
                      key={phase}
                      className="flex items-center gap-1.5 text-xs text-[var(--nx-text-secondary)]"
                    >
                      <span className="h-1 w-1 rounded-full bg-[var(--nx-accent)]" aria-hidden />
                      {phase}
                    </li>
                  ))}
                </ul>
                {job?.progress ? (
                  <p className="mt-1 text-xs text-[var(--nx-text-muted)]" data-job-progress>
                    进度：{job.progress}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(job?.startedAt ?? job?.createdAt) ? (
                <span
                  data-job-elapsed
                  className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-[var(--nx-text-muted)]"
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {formatElapsed(elapsedSeconds)}
                </span>
              ) : null}
              {onClose ? (
                <button
                  type="button"
                  data-job-close
                  aria-label="关闭作业监视器"
                  onClick={onClose}
                  className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
