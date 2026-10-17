'use client'

import { useMemo } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  RefreshCw,
  RotateCcw,
  Wifi,
  WifiOff,
} from 'lucide-react'
import type { ProjectDraftModule, ProjectDraftModuleStatus } from '@aiproj/types'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'
import type { DraftProgressProjection } from '@/lib/ai-draft/progress-projection'
import { selectDraftEta } from '@/lib/ai-draft/progress-projection'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

export const moduleLabels: Record<ProjectDraftModule, string> = {
  charter: '项目章程',
  wbs: '工作分解结构',
  tasks: '任务清单',
  dependencies: '任务依赖',
  acceptance: '验收标准',
  resource: '资源建议',
  risk: '风险建议',
  milestone: '里程碑',
  ganttPreview: '甘特图预览',
}

const phaseLabels: Record<NonNullable<DraftProgressProjection['phase']>, string> = {
  adapter_ready: '已连接生成服务',
  first_token: '已收到首批内容',
  receiving: '正在接收草案结构',
  parsing: '正在整理草案结构',
  validating: '正在检查日期、依赖与完整性',
  retrying: '正在修复输出格式',
  persisting: '草案已生成，正在准备审查',
}

const healthStateLabels: Record<string, string> = {
  long_running: '这次生成用时较长，但连接仍然正常；系统会继续保留当前进度。',
  stale: '进度连接暂未收到新数据，正在尝试恢复连接。',
  reconnecting: '正在重新建立进度连接。',
  fallback_status: '正在查询最新进度状态。',
  user_retry_required: '进度无法自动恢复，需要您操作重试。',
}

const healthStateTitle: Record<string, string> = {
  long_running: '生成用时较长',
  stale: '连接暂时停滞',
  reconnecting: '正在恢复连接',
  fallback_status: '正在同步进度',
  user_retry_required: '需要重试',
}

interface Props {
  moduleStatuses: Partial<Record<ProjectDraftModule, ProjectDraftModuleStatus>>
  draftId?: string | null
  projection?: DraftProgressProjection
  onResume?: () => void
  onRestart?: () => void
  /** 显式重试生成（会开始新的生成尝试）。 */
  onRetry?: () => void
  isConnecting?: boolean
}

export function DraftGenerationProgress({
  moduleStatuses,
  draftId,
  projection,
  onResume,
  onRestart,
  onRetry,
}: Props) {
  const ordered = useMemo(
    () =>
      PROJECT_DRAFT_MODULES.map((module) => ({
        module,
        label: moduleLabels[module],
        status: moduleStatuses[module] ?? 'pending',
      })),
    [moduleStatuses],
  )

  const completed = ordered.filter((item) => item.status === 'completed').length
  const total = PROJECT_DRAFT_MODULES.length
  const percent = Math.round((completed / total) * 100)
  const healthState = projection?.healthState ?? 'healthy'

  // v2-5-streaming-eta-estimation：ETA 纯派生 selector（零 state 写入、零网络写入）。
  // 暖机期（confidence=initial）或异常态 → etaMs=null，formatted 为空串，UI 不渲染文案。
  const eta = projection ? selectDraftEta(projection) : null
  // 暖机期（confidence=initial）、异常态、或全完成（etaMs=0→formatted 空串）都不渲染。
  const showEta = Boolean(
    eta && eta.etaMs !== null && eta.confidence !== 'initial' && eta.formatted !== '',
  )
  const etaPrefix = eta?.confidence === 'converging' ? '估算中…' : '预计剩余'
  const phaseLabel = projection?.preparingReview
    ? '草案已生成，正在准备审查'
    : projection?.phase
      ? phaseLabels[projection.phase]
      : healthState === 'reconnecting'
        ? '正在建立进度连接'
        : healthState === 'fallback_status'
          ? '正在查询最新进度状态'
          : '正在等待生成阶段'

  const showHealthBanner = healthState !== 'healthy' && projection?.terminal === 'none'
  const isActiveProblem = healthState === 'stale' || healthState === 'user_retry_required'

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-primary-200 bg-surface p-4 sm:p-5"
      aria-busy={projection?.terminal === 'none' && !isActiveProblem}
      aria-labelledby="draft-progress-title"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ai-bg text-ai">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
            </span>
            <div>
              <h2 id="draft-progress-title" className="text-lg font-semibold text-heading">
                AI 正在生成项目草案
              </h2>
              <p className="text-sm text-gray-600">{phaseLabel}</p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs">
          <span
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 font-medium',
              healthState === 'healthy'
                ? 'bg-success-bg text-success'
                : healthState === 'long_running'
                  ? 'bg-info-bg text-info'
                  : healthState === 'user_retry_required' || healthState === 'failed'
                    ? 'bg-danger-bg text-danger'
                    : healthState === 'stale'
                      ? 'bg-warning-bg text-warning'
                      : 'bg-info-bg text-info',
            )}
          >
            {healthState === 'healthy' ? (
              <Wifi className="h-3.5 w-3.5" aria-hidden />
            ) : healthState === 'user_retry_required' || healthState === 'failed' ? (
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
            ) : healthState === 'long_running' ? (
              <Clock className="h-3.5 w-3.5" aria-hidden />
            ) : healthState === 'stale' ? (
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            )}
            {healthState === 'healthy' ? '实时连接' : (healthStateTitle[healthState] ?? '正在恢复')}
          </span>
          {draftId && draftId !== 'pending' ? (
            <span className="font-mono text-gray-500">会话 {draftId.slice(0, 8)}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">已完成模块</span>
          <span className="font-semibold text-heading">
            {completed}/{total}
          </span>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-label="草案模块生成进度"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          aria-valuetext={`已完成 ${completed} 个，共 ${total} 个模块`}
        >
          <div
            className="h-full rounded-full bg-ai transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        {showEta && eta ? (
          <p
            className="mt-2 text-xs text-gray-500 motion-reduce:transition-none"
            // ETA 不单独触发 aria-live 播报（已在下方 progress 的 aria-live 区域内）；
            // 数字变化不做滚动动画（spec: 尊重 prefers-reduced-motion，无 transition/animation）。
          >
            <span aria-hidden>{etaPrefix}</span> {eta.formatted}
          </p>
        ) : null}
      </div>

      {showHealthBanner ? (
        <div
          className={cn(
            'mt-4 flex items-start gap-2 rounded-[var(--radius-md)] p-3 text-sm',
            healthState === 'user_retry_required' || healthState === 'failed'
              ? 'border border-danger/30 bg-danger-bg text-danger'
              : healthState === 'stale'
                ? 'border border-warning/30 bg-warning-bg text-warning'
                : 'border border-info/30 bg-info-bg text-info',
          )}
          role={healthState === 'user_retry_required' ? 'alert' : 'status'}
        >
          {healthState === 'user_retry_required' || healthState === 'failed' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : healthState === 'stale' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <RefreshCw
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                healthState === 'reconnecting' || healthState === 'fallback_status'
                  ? 'animate-spin motion-reduce:animate-none'
                  : '',
              )}
              aria-hidden
            />
          )}
          <div className="flex-1">
            <p>
              {healthState === 'user_retry_required' || healthState === 'failed'
                ? (projection?.errorMessage ?? healthStateLabels[healthState] ?? '需要您操作重试')
                : (healthStateLabels[healthState] ?? '正在恢复连接')}
            </p>
            {/* 显式重试生成按钮 —— 说明会开始新的生成尝试 */}
            {(healthState === 'user_retry_required' || healthState === 'failed') &&
            projection?.terminal === 'none' ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {onResume ? (
                  <Button type="button" size="sm" variant="secondary" onClick={onResume}>
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    继续接收进度
                  </Button>
                ) : null}
                {onRetry ? (
                  <Button type="button" size="sm" variant="primary" onClick={onRetry}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    重试生成
                  </Button>
                ) : null}
                {onRestart ? (
                  <Button type="button" size="sm" variant="ghost" onClick={onRestart}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    重新生成
                  </Button>
                ) : null}
                {onRetry ? (
                  <p className="mt-2 w-full text-xs text-gray-500">
                    重试会开始新的生成尝试。您之前提供的信息将保留，草案仍需要人工审查确认后才能导入正式项目。
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <ol className="mt-5 grid gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map(({ module, label, status }) => (
          <li
            key={module}
            className="flex min-h-10 items-center gap-2 border-b border-border/70 py-2 text-sm"
          >
            {status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : status === 'generating' ? (
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-ai motion-reduce:animate-none"
                aria-hidden
              />
            ) : status === 'failed' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            )}
            <span
              className={cn(
                'min-w-0 truncate',
                status === 'completed'
                  ? 'text-gray-700'
                  : status === 'generating'
                    ? 'font-medium text-heading'
                    : status === 'failed'
                      ? 'text-danger'
                      : 'text-gray-500',
              )}
            >
              {label}
            </span>
            <span className="sr-only">
              {status === 'completed'
                ? '已完成'
                : status === 'generating'
                  ? '生成中'
                  : status === 'failed'
                    ? '失败'
                    : '等待中'}
            </span>
          </li>
        ))}
      </ol>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {showHealthBanner
          ? `${healthStateTitle[healthState] ?? phaseLabel}，已完成 ${completed} 个，共 ${total} 个模块。`
          : phaseLabel
            ? `${phaseLabel}，已完成 ${completed} 个，共 ${total} 个模块。`
            : `已完成 ${completed} 个，共 ${total} 个模块。`}
      </p>
    </section>
  )
}
