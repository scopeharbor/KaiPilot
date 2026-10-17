'use client'

import * as React from 'react'
import { CircleAlert, RefreshCw, RotateCcw, Undo2 } from 'lucide-react'
import { AI_CONNECTION_REQUIRED_MESSAGE, type ProjectDraftFailureDetail } from '@aiproj/types'
import { AiConnectionRequiredAction } from '@/components/ai/AiConnectionRequiredAction'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/**
 * 暗黑仪器风内联错误卡片（tasks 3.3 / design D10；生成态变体 tasks 3.4 / design D9）。
 *
 * - 双模式：意图解析错误（status='error' 且无 draftFailure）与生成错误
 *   （draftFailure 非空，如 GENERATION_BUDGET_EXHAUSTED / MODEL_PROVIDER_CALL_FAILED /
 *   MODEL_RESPONSE_JSON_INVALID / AI_SERVICE_BUSY / AI_SERVICE_ERROR）；
 * - 生成态清晰展示标准错误码 `[CODE]` 与配套中文释义，完整保留用户已确认上下文；
 * - 意图态「重新分析」调用 store.retry()；生成态「重试生成」经 onRetryGeneration
 *   回调由装配层带原上下文重新发起生成流；
 * - 「重新开始」需二次确认后调用 store.restart()，安全清空草案回到输入态；
 * - 零网络请求、零落库（RL-01 / RL-06）：仅操作既有 store action 与装配层回调。
 */

/** 按后端/网络错误文本做确定性中文指引分类（前向匹配，超时优先于 5xx）。 */
export function classifyAnalyzeError(message: string): string {
  if (/524|网关|后台任务|进度查询|进度连接/.test(message)) {
    return '分析结果连接暂时中断。原输入与已答内容仍保留，点击「重新分析」会先查询同一后台任务；已完成的结果会直接恢复。'
  }
  if (/超时|timeout|timed ?out/i.test(message)) {
    return '模型响应达到等待上限，未能完成意图解析；这不一定是本机网络问题。请点击「重新分析」重试。'
  }
  if (/failed to fetch|networkerror|network|网络|econn/i.test(message)) {
    return '模型、代理或后端连接在等待期间中断，未能完成意图解析；不应仅据此判定为本机网络问题。请重新分析。'
  }
  if (/5\d\d|internal|服务器内部|服务不可用|unavailable/i.test(message)) {
    return '服务暂时不可用，未能完成意图解析。请稍后重新分析。'
  }
  return '意图解析未能完成，请重新分析；若持续失败请联系管理员。'
}

/** 后端标准生成错误码 → 通俗中文释义（对齐后端 safeDraftFailureMessage 语义，文案审查纪律：草案语义）。 */
export const GENERATION_ERROR_COPY: Readonly<Record<string, string>> = {
  GENERATION_BUDGET_EXHAUSTED: '生成预算已耗尽，未能完成全部草案模块。请重试生成。',
  MODEL_PROVIDER_CALL_FAILED: '模型供应商调用失败，请检查连接状态后重试。',
  MODEL_RESPONSE_JSON_INVALID: '模型输出格式无效，未能整理为草案结构。',
  AI_SERVICE_BUSY: 'AI 生成服务当前繁忙，请稍后重试。',
  AI_SERVICE_ERROR: 'AI 生成服务异常，请稍后重试。',
  STREAM_RETENTION_MISS: '生成进度连接中断过久，未能恢复完整事件。请重试生成。',
  STREAM_REPLAY_RESET_REQUIRED: '生成进度需要重新同步，请重试生成。',
  AI_CONNECTION_REQUIRED: AI_CONNECTION_REQUIRED_MESSAGE,
}

/** 生成错误友好释义：已知错误码映射，未知码回退通用文案。 */
export function describeGenerationError(errorCode: string): string {
  return GENERATION_ERROR_COPY[errorCode] ?? '草案生成未能完成，请重试生成。'
}

/**
 * 从失败详情提取展示用错误码：优先 detail.errorCode，其次从 error 文本
 * `[CODE]` 前缀解析，最后回退通用码。
 */
export function resolveGenerationErrorCode(
  detail: ProjectDraftFailureDetail | null,
  error: string | null,
): string {
  if (detail?.errorCode) return detail.errorCode
  const bracketed = /\[([A-Z0-9_]+)\]/.exec(error ?? '')
  return bracketed?.[1] ?? 'AI_SERVICE_ERROR'
}

/** 判断当前错误卡片是否处于「生成失败」模式：draftFailure 已沉淀即生成态。 */
export function isGenerationFailure(detail: ProjectDraftFailureDetail | null): boolean {
  return detail !== null
}

export interface TheaterErrorCardProps {
  /** 生成态「重试生成」回调：由装配层带原上下文重新发起生成流（无需时省略）。 */
  onRetryGeneration?: () => void
}

export function TheaterErrorCard({ onRetryGeneration }: TheaterErrorCardProps) {
  const error = useAiProjectDraftStore((state) => state.error)
  const rawInput = useAiProjectDraftStore((state) => state.rawInput)
  const answeredCount = useAiProjectDraftStore((state) => Object.keys(state.answers).length)
  const draftFailure = useAiProjectDraftStore((state) => state.draftFailure)
  const [confirmingRestart, setConfirmingRestart] = React.useState(false)

  if (!error && !draftFailure) return null

  const generationError = isGenerationFailure(draftFailure)
  const errorCode = resolveGenerationErrorCode(draftFailure, error)
  // 没有可用 AI 连接（生成或意图分析阶段）：提示先去设置添加，并给出入口
  const needsAiConnection =
    errorCode === 'AI_CONNECTION_REQUIRED' || (error ?? '').includes(AI_CONNECTION_REQUIRED_MESSAGE)

  const retry = () => {
    setConfirmingRestart(false)
    if (generationError) {
      onRetryGeneration?.()
    } else {
      useAiProjectDraftStore.getState().retry()
    }
  }
  const restart = () => {
    setConfirmingRestart(false)
    useAiProjectDraftStore.getState().restart()
  }
  const restartHint = generationError
    ? '此操作将清空草案生成现场并回到最初的输入界面'
    : '此操作将清空输入与已答进度'

  return (
    <section
      data-theater-error-card
      role="alert"
      aria-label={generationError ? '草案生成错误' : '意图解析错误'}
      className="nx-space-atmosphere mx-auto w-full max-w-3xl rounded-lg border border-[var(--nx-status-danger)]/40 bg-[var(--nx-workspace-surface)]/90 px-6 py-6"
    >
      <header className="flex items-start gap-3">
        <CircleAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--nx-status-danger)]"
          aria-hidden
        />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">
            {generationError ? '草案生成未能完成' : '意图解析未能完成'}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
            {needsAiConnection
              ? AI_CONNECTION_REQUIRED_MESSAGE
              : generationError
                ? describeGenerationError(errorCode)
                : classifyAnalyzeError(error ?? '')}
          </p>
          {needsAiConnection ? <AiConnectionRequiredAction className="mt-3" /> : null}
          {generationError ? (
            <p
              data-theater-error-code
              className="mt-2 font-mono text-[11px] text-[var(--nx-status-danger)]"
            >
              [{errorCode}]
            </p>
          ) : null}
          <p
            data-theater-error-detail
            className="mt-2 truncate font-mono text-[11px] text-[var(--nx-text-muted)]"
            title={error ?? undefined}
          >
            {error}
          </p>
        </div>
      </header>

      <div className="mt-5 space-y-3 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3">
        <p
          data-theater-preserved-input
          className="text-[11px] tracking-wide text-[var(--nx-text-muted)]"
        >
          {rawInput.length > 0
            ? `原始输入已保留（${rawInput.length} 字符）`
            : '当前会话暂无原始输入'}
        </p>
        {rawInput.length > 0 ? (
          <pre
            aria-label="已保留的原始输入预览"
            className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--nx-text-secondary)]"
          >
            {rawInput}
          </pre>
        ) : null}
        <p
          data-theater-preserved-progress
          className="text-[11px] tracking-wide text-[var(--nx-text-muted)]"
        >
          {generationError
            ? '已确认的意图与澄清回答上下文完整保留，重试生成时将原样沿用'
            : answeredCount > 0
              ? `已保留 ${answeredCount} 条已答澄清记录，重新分析后将沿用`
              : '暂无已答澄清记录'}
        </p>
      </div>

      <footer className="mt-5 flex flex-wrap items-center gap-3">
        {generationError && onRetryGeneration ? (
          <button
            type="button"
            data-theater-retry-generation
            onClick={retry}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 py-2 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            重试生成（Retry）
          </button>
        ) : !generationError ? (
          <button
            type="button"
            data-theater-retry
            onClick={retry}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 py-2 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            重新分析
          </button>
        ) : null}

        {confirmingRestart ? (
          <span className="flex items-center gap-2 rounded border border-[var(--nx-status-danger)]/40 bg-[var(--nx-space-surface)] px-3 py-2">
            <span className="text-xs text-[var(--nx-text-secondary)]">
              确认清空当前草案并重新开始？
            </span>
            <button
              type="button"
              data-theater-restart-confirm
              onClick={restart}
              className="rounded border border-[var(--nx-status-danger)]/50 px-2 py-1 text-xs text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-status-danger)]/50"
            >
              确认重新开始
            </button>
            <button
              type="button"
              data-theater-restart-cancel
              onClick={() => setConfirmingRestart(false)}
              className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              暂不重置
            </button>
          </span>
        ) : (
          <button
            type="button"
            data-theater-restart
            onClick={() => setConfirmingRestart(true)}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 py-2 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)]/50 hover:text-[var(--nx-status-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            重新开始
          </button>
        )}
        {confirmingRestart ? (
          <span className="flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)]">
            <Undo2 className="h-3 w-3" aria-hidden />
            {restartHint}
          </span>
        ) : null}
      </footer>
    </section>
  )
}

export default TheaterErrorCard
