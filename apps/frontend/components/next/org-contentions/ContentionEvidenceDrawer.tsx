'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, EyeOff, FileSearch, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { resourceContentionApi, resourceContentionKeys } from '@/lib/api/resource-contentions'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  asSinglePayload,
  classifyApiError,
  CONTENTION_NOT_FOUND_COPY,
  CONTENTION_REDACTION_LABELS,
  CONTENTION_RESTRICTED_COPY,
  CONTENTION_SERVER_ERROR_COPY,
  CONTENTION_SEVERITY_META,
  formatContentionDate,
  formatContentionWindow,
  isContentionRedacted,
  reasonLabelOf,
  resolveErrorMessageText,
} from '@/lib/next/org-contentions/org-contentions-adapter'
import type { ResourceContentionEvidence, ResourceContentionItem } from '@aiproj/types'

/**
 * 争用证据抽屉（v3-ui-next-org-portfolio-domains W5 · tasks 5.3，
 * spec「资源争用检测与需求预测：证据抽屉只读、403 中性限制态」）。
 *
 * - 数据源 100% 复用既有端点：detail（GET /resource-contentions/:contentionId）+
 *   低敏证据（GET …/:contentionId/evidence），纯 GET 零写（RL-01）；
 * - 错误三态（RL-05/沉浸阶梯三态）：
 *   · 403/PERMISSION_DENIED → 中性限制态「受限内容不可见」——不渲染任何内容，
 *     不泄露证据存在性；404 → 中性「未找到争用记录」；5xx/网络 → 可重试按钮；
 * - 争用事实区与证据区分别受各自请求状态控制，证据区权限独立判定
 *   （后端逐项授权，403 仅限制证据区呈现）。
 */

export interface ContentionEvidenceDrawerProps {
  /** 目标争用条目 ID；null 时抽屉不发起任何请求。 */
  contentionId: string | null
  open: boolean
  onClose: () => void
}

function ErrorBlock({
  kind,
  message,
  onRetry,
}: {
  kind: ReturnType<typeof classifyApiError>['kind']
  message: string | null
  onRetry?: () => void
}) {
  if (kind === 'forbidden') {
    return (
      <div
        data-contention-drawer-restricted
        className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
      >
        <EyeOff className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">
          {CONTENTION_RESTRICTED_COPY.title}
        </p>
        <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          {CONTENTION_RESTRICTED_COPY.description}
        </p>
      </div>
    )
  }
  if (kind === 'not_found') {
    return (
      <div
        data-contention-drawer-notfound
        className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
      >
        <ShieldAlert className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">{CONTENTION_NOT_FOUND_COPY.title}</p>
        <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          {CONTENTION_NOT_FOUND_COPY.description}
        </p>
      </div>
    )
  }
  return (
    <div
      data-contention-drawer-error
      className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
    >
      <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
      <p className="text-sm text-[var(--nx-text-secondary)]">
        {CONTENTION_SERVER_ERROR_COPY.title}
      </p>
      {message ? (
        <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          {message}
        </p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          data-contention-drawer-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          重试
        </button>
      ) : null}
    </div>
  )
}

function DetailFacts({ item }: { item: ResourceContentionItem }) {
  const redacted = isContentionRedacted(item.redactionState)
  const facts: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: '原因类型',
      value: reasonLabelOf(item.reasonCode),
    },
    {
      label: '涉及资源',
      value: redacted ? (
        <span className="flex items-center gap-1 text-[var(--nx-text-muted)]">
          <EyeOff className="h-3 w-3" aria-hidden />
          {CONTENTION_REDACTION_LABELS[item.redactionState] ?? '不可见'}
        </span>
      ) : (
        (item.resourceName ?? '—')
      ),
    },
    {
      label: '时间窗口',
      value: formatContentionWindow(item.from, item.to),
    },
    {
      label: '峰值负载',
      value:
        redacted || item.loadPercent === null ? (
          <span className="flex items-center gap-1 text-[var(--nx-text-muted)]">
            <EyeOff className="h-3 w-3" aria-hidden />
            不可见
          </span>
        ) : (
          <span className="font-mono">{item.loadPercent}%</span>
        ),
    },
    {
      label: '关联项目',
      value:
        redacted || !item.projectNames?.length ? (
          '—'
        ) : (
          <span className="font-mono text-[10px]">
            {item.projectNames.join(' · ')}（{item.projectNames.length} 个）
          </span>
        ),
    },
    {
      label: '创建时间',
      value: <span className="font-mono text-[10px]">{formatContentionDate(item.createdAt)}</span>,
    },
  ]
  return (
    <dl data-contention-evidence-detail-facts className="space-y-1.5 text-[11px]">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex items-start justify-between gap-4 rounded-sm border border-[var(--nx-border-hairline)]/60 bg-[var(--nx-bg-0)] px-3 py-2"
        >
          <dt className="shrink-0 text-[var(--nx-text-muted)]">{fact.label}</dt>
          <dd className="min-w-0 text-right text-[var(--nx-text-secondary)]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ContentionEvidenceDrawer({
  contentionId,
  open,
  onClose,
}: ContentionEvidenceDrawerProps) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const panelRef = React.useRef<HTMLElement | null>(null)

  // 只读证据抽屉无写路径（无在途 mutation、无表单脏值）：Escape 默认可关，与点击关闭同语义。
  useDialogA11y({ ref: panelRef, open, onClose })

  // 数据层复用既有 lib/api 契约与 query key 工厂（同 ContentionWorkspace 说明：
  // 既有 hooks 的二次解包已在 W1（D-A）修复、单对象端点直出载荷；此处仍以标准
  // useQuery 直连已查证契约并经 asSinglePayload 兼容历史信封两态；零新增 fetch
  // 封装/零改写 query key）。
  const detailQuery = useQuery({
    queryKey: resourceContentionKeys.detail(organizationId ?? 0, contentionId ?? ''),
    queryFn: () =>
      resourceContentionApi
        .detail(organizationId as number, contentionId as string)
        .then((result) => asSinglePayload<ResourceContentionItem>(result)),
    enabled: organizationId !== null && open && contentionId !== null,
    staleTime: 60_000,
  })
  const evidenceQuery = useQuery({
    queryKey: resourceContentionKeys.evidence(organizationId ?? 0, contentionId ?? ''),
    queryFn: () =>
      resourceContentionApi
        .evidence(organizationId as number, contentionId as string)
        .then((result) => asSinglePayload<ResourceContentionEvidence>(result)),
    enabled: organizationId !== null && open && contentionId !== null,
    staleTime: 60_000,
  })

  const detailErrorKind = detailQuery.isError ? classifyApiError(detailQuery.error).kind : null
  const evidenceErrorKind = evidenceQuery.isError
    ? classifyApiError(evidenceQuery.error).kind
    : null

  const item = detailQuery.data ?? null

  const closeIfIdle = () => {
    onClose()
  }

  if (!open) return null

  return (
    <div data-contention-evidence-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭争用证据"
        tabIndex={-1}
        onClick={closeIfIdle}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="争用证据与事实"
        data-contention-evidence-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <FileSearch className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                争用证据与事实
              </h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                GET /organizations/:id/resource-contentions/:contentionId
                {contentionId ? `/evidence` : ''} · 只读
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭争用证据"
            data-contention-evidence-close
            onClick={closeIfIdle}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ── 争用事实（detail） ── */}
          <section>
            <h4 className="mb-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
              争用事实
            </h4>
            {detailQuery.isLoading ? (
              <div
                data-contention-detail-loading
                role="status"
                aria-busy="true"
                aria-label="正在加载争用事实"
                className="space-y-2"
              >
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
                ))}
              </div>
            ) : detailErrorKind ? (
              <ErrorBlock
                kind={detailErrorKind}
                message={resolveErrorMessageText(
                  detailQuery.error,
                  CONTENTION_SERVER_ERROR_COPY.description,
                )}
                onRetry={
                  detailErrorKind === 'server' || detailErrorKind === 'network'
                    ? () => {
                        void detailQuery.refetch()
                        void evidenceQuery.refetch()
                      }
                    : undefined
                }
              />
            ) : item ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5">
                  <span
                    data-contention-evidence-severity-chip
                    className={cn(
                      'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                      CONTENTION_SEVERITY_META[item.severity]?.chipClass,
                    )}
                  >
                    {CONTENTION_SEVERITY_META[item.severity]?.label ?? item.severity}
                  </span>
                  <span className="text-[11px] text-[var(--nx-text-secondary)]">
                    {reasonLabelOf(item.reasonCode)}
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-[var(--nx-text-secondary)]">
                  {item.description}
                </p>
                {item.remediationHint ? (
                  <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                    <span className="text-[var(--nx-text-secondary)]">处置提示：</span>
                    {item.remediationHint}
                  </p>
                ) : null}
                <DetailFacts item={item} />
              </div>
            ) : null}
          </section>

          {/* ── 低敏证据（evidence） ── */}
          <section>
            <h4 className="mb-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
              证据指纹（低敏）
            </h4>
            {evidenceQuery.isLoading ? (
              <div
                data-contention-evidence-loading
                role="status"
                aria-busy="true"
                aria-label="正在加载争用证据"
                className="space-y-2"
              >
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-8 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
                ))}
              </div>
            ) : evidenceErrorKind ? (
              <ErrorBlock
                kind={evidenceErrorKind}
                message={resolveErrorMessageText(
                  evidenceQuery.error,
                  CONTENTION_SERVER_ERROR_COPY.description,
                )}
                onRetry={
                  evidenceErrorKind === 'server' || evidenceErrorKind === 'network'
                    ? () => void evidenceQuery.refetch()
                    : undefined
                }
              />
            ) : evidenceQuery.data ? (
              <div
                data-contention-evidence-content
                className="space-y-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5 font-mono text-[10px] leading-relaxed text-[var(--nx-text-muted)]"
              >
                <p>
                  来源：
                  <span className="text-[var(--nx-text-secondary)]">
                    {evidenceQuery.data.source}
                  </span>
                </p>
                <p>
                  指纹：
                  <span className="text-[var(--nx-text-secondary)]">
                    {evidenceQuery.data.evidenceHash}
                  </span>
                </p>
                <p>
                  最近更新：
                  <span className="text-[var(--nx-text-secondary)]">
                    {formatContentionDate(evidenceQuery.data.lastUpdatedAt)}
                  </span>
                  {evidenceQuery.data.isLowSensitive ? ' · 低敏' : ''}
                </p>
                {evidenceQuery.data.metricKeys.length > 0 ? (
                  <p>
                    度量键：
                    <span className="text-[var(--nx-text-secondary)]">
                      {evidenceQuery.data.metricKeys.join(' · ')}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <p className="text-[10px] text-[var(--nx-text-muted)]">
            {contentionId ? (
              <span className="font-mono">{contentionId.slice(0, 8)}…</span>
            ) : (
              '未选择条目'
            )}{' '}
            · 证据仅含低敏指纹，不含证据原文（RL-05）
          </p>
          <button
            type="button"
            data-contention-evidence-close-footer
            onClick={closeIfIdle}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            关闭
          </button>
        </footer>
      </aside>
    </div>
  )
}

export default ContentionEvidenceDrawer
