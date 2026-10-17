'use client'

/**
 * ReportVersionReviewPanel —— 新轨「版本历史与审阅」工作台（v3-ui-next-reports-domain W2）。
 *
 * - 左侧版本时间轴：消费 `useV2ListVersions`，展示版本号/模板类型/生成时间/审核状态徽章
 *   （pending_review 琥珀金 · confirmed 翡翠绿 · rejected 警戒红 · editing 冷蓝 · null 灰）；
 * - 右侧审阅区：8 大结构化章节（管理摘要/关键亮点/进度叙述/风险与问题/资源说明/变更说明/
 *   建议行动/数据限制说明）暗黑仪器卡片分章渲染，空章节优雅折叠「本周期无相关记录」；
 * - 人工签署闭环（RL-01）：pending_review 且具备 `ai:confirm` 或 `report:create` 时提供
 *   「确认签署 / 退回草稿」；退回原因必填（`{ action: 'return', returnReason }`），
 *   操作成功后失效版本缓存并回读最新状态。
 *
 * 契约事实：后端 `PATCH .../periodic/versions/:versionId/review` 仅接受
 * `confirm | return | edit`（`AiReviewPeriodicRequest`），退回动作码为 `return`、
 * 状态随之置 `rejected`；confirm 请求契约不含 notes 字段，故确认对话框展示签署人
 * 与时间戳元信息而不发送额外批注。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  RotateCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import type {
  AiPeriodicDraft,
  AiReviewPeriodicRequest,
  ReportAiReviewStatus,
  V2ReportTemplateId,
} from '@aiproj/types'
import { useQueryClient } from '@tanstack/react-query'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { reportV2Keys, useV2ListVersions, useV2PeriodicReview } from '@/hooks/use-reports-v2'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import type { ReportVersion } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 状态徽章元信息（供渲染与测试断言）
// ---------------------------------------------------------------------------

export type ReviewStatusTone = 'warning' | 'success' | 'danger' | 'info' | 'muted'

export interface ReviewStatusMeta {
  label: string
  tone: ReviewStatusTone
  /** 徽章文字颜色（var(--nx-*) 令牌）。 */
  color: string
  hint: string
}

export function reviewStatusMeta(
  status: ReportAiReviewStatus | string | null | undefined,
): ReviewStatusMeta {
  switch (status) {
    case 'pending_review':
      return {
        label: '待审核',
        tone: 'warning',
        color: 'var(--nx-status-warning)',
        hint: 'AI 草稿就绪，待项目主管人工复核签署',
      }
    case 'confirmed':
      return {
        label: '已确认',
        tone: 'success',
        color: 'var(--nx-status-success)',
        hint: '已签署生效，草稿已锁定并解除导出限制',
      }
    case 'rejected':
      return {
        label: '已退回',
        tone: 'danger',
        color: 'var(--nx-status-danger)',
        hint: '草稿被退回，请参考退回原因重新生成',
      }
    case 'editing':
      return {
        label: '编辑中',
        tone: 'info',
        color: 'var(--nx-workspace-blue)',
        hint: '正处于人工校正阶段',
      }
    default:
      return { label: '未审核', tone: 'muted', color: 'var(--nx-text-muted)', hint: '' }
  }
}

// ---------------------------------------------------------------------------
// 模板展示标签
// ---------------------------------------------------------------------------

const TEMPLATE_LABELS: Partial<Record<V2ReportTemplateId, string>> = {
  'weekly-ai-summary': 'AI 项目周报',
  'monthly-ai-summary': 'AI 项目月报',
  progress: '进度报表',
  delay: '延期任务分析',
  workload: '资源工作量',
  milestone: '里程碑达成',
  'project-weekly': '项目周报',
  'project-monthly': '项目月报',
  'milestone-tracking': '里程碑跟踪',
  'resource-summary': '资源总结',
  'risk-summary': '风险总结',
  'health-summary': '健康总结',
  'stakeholder-briefing': '干系人简报',
}

export function templateDisplayLabel(
  templateId: string | V2ReportTemplateId | null | undefined,
): string {
  if (!templateId) return '未知模板'
  return TEMPLATE_LABELS[templateId as V2ReportTemplateId] ?? templateId
}

// ---------------------------------------------------------------------------
// AI 草稿解析与章节收集
// ---------------------------------------------------------------------------

/** 解析 aiDraft（JSON 字符串或已解析对象），失败返回 null（前端只读渲染，绝不落库）。 */
export function parseAiDraftPayload(raw: string | null | undefined): AiPeriodicDraft | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isValidDraft(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isValidDraft(value: unknown): value is AiPeriodicDraft {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Partial<AiPeriodicDraft>
  return (
    typeof draft.executiveSummary === 'string' &&
    Array.isArray(draft.highlights) &&
    typeof draft.progressNarrative === 'string' &&
    typeof draft.riskAndIssues === 'string' &&
    typeof draft.resourceNotes === 'string' &&
    typeof draft.changeNotes === 'string' &&
    Array.isArray(draft.suggestedActions) &&
    typeof draft.dataWarningsNarrative === 'string'
  )
}

export interface DraftChapter {
  key: string
  index: string
  title: string
  caption: string
  kind: 'text' | 'list'
  content: string
  items: string[]
  isEmpty: boolean
}

export function collectDraftChapters(draft: AiPeriodicDraft | null): DraftChapter[] {
  if (!draft) return []
  const raw: Array<{
    key: string
    title: string
    caption: string
    kind: 'text' | 'list'
    content: string
    items: string[]
  }> = [
    {
      key: 'executive-summary',
      title: '管理摘要',
      caption: 'Executive Summary',
      kind: 'text',
      content: draft.executiveSummary,
      items: [],
    },
    {
      key: 'highlights',
      title: '关键亮点',
      caption: 'Highlights',
      kind: 'list',
      content: '',
      items: draft.highlights,
    },
    {
      key: 'progress-narrative',
      title: '进度叙述',
      caption: 'Progress Narrative',
      kind: 'text',
      content: draft.progressNarrative,
      items: [],
    },
    {
      key: 'risk-issues',
      title: '风险与问题',
      caption: 'Risks & Issues',
      kind: 'text',
      content: draft.riskAndIssues,
      items: [],
    },
    {
      key: 'resource-notes',
      title: '资源说明',
      caption: 'Resource Notes',
      kind: 'text',
      content: draft.resourceNotes,
      items: [],
    },
    {
      key: 'change-notes',
      title: '变更说明',
      caption: 'Change Notes',
      kind: 'text',
      content: draft.changeNotes,
      items: [],
    },
    {
      key: 'suggested-actions',
      title: '建议行动',
      caption: 'Suggested Actions',
      kind: 'list',
      content: '',
      items: draft.suggestedActions,
    },
    {
      key: 'data-warnings',
      title: '数据限制说明',
      caption: 'Data Warnings Narrative',
      kind: 'text',
      content: draft.dataWarningsNarrative,
      items: [],
    },
  ]
  return raw.map((chapter, position) => ({
    key: chapter.key,
    index: `${position + 1}`.padStart(2, '0'),
    title: chapter.title,
    caption: chapter.caption,
    kind: chapter.kind,
    content: chapter.content,
    items: chapter.items,
    isEmpty: chapter.kind === 'list' ? chapter.items.length === 0 : chapter.content.trim() === '',
  }))
}

/** 审阅操作返回状态（本地定型 v2PeriodicReview 响应）。 */
export interface PeriodicReviewEnvelope {
  data?: {
    versionId?: number
    reviewStatus?: string | null
    confirmedAt?: string | null
    confirmedBy?: number | null
  } | null
}

export function formatReportTimestamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export interface ReportVersionReviewPanelProps {
  projectId: number
  /** 深链 / 生成完成定位：外部指定待审阅版本（变化时切换选中）。 */
  selectedVersionId?: number | null
  /** 选中版本变化回调（供容器同步 URL ?versionId=）。 */
  onSelectedVersionChange?: (versionId: number | null) => void
}

export function ReportVersionReviewPanel({
  projectId,
  selectedVersionId,
  onSelectedVersionChange,
}: ReportVersionReviewPanelProps) {
  const tier = useImmersionTier()
  const queryClient = useQueryClient()
  const canReview = usePermissions().canAny(['ai:confirm', 'report:create'])
  const signer = useAuthStore((state) => state.user)

  const versionsQuery = useV2ListVersions(projectId, { perPage: 50 })
  const reviewMutation = useV2PeriodicReview(projectId)

  const [internalVersionId, setInternalVersionId] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  /** 签署对话框打开时刻（本地时间戳展示）。 */
  const [dialogOpenedLabel, setDialogOpenedLabel] = useState<string>('')

  const versions = versionsQuery.data?.data ?? []
  const isExternallyDriven = selectedVersionId != null
  const externalId = selectedVersionId ?? null

  // 期望选中的版本 id：外部深链优先；其次维持内部选中；列表刷新后按默认策略兜底。
  const desiredVersionId = useMemo<number | null>(() => {
    if (versions.length === 0) return null
    if (isExternallyDriven) {
      const target = versions.find((version) => version.id === externalId)
      if (target) return target.id
    } else if (
      internalVersionId !== null &&
      versions.some((version) => version.id === internalVersionId)
    ) {
      return internalVersionId
    }
    const fallback =
      versions.find((version) => version.aiReviewStatus === 'pending_review' && version.aiDraft) ??
      versions.find((version) => version.aiDraft) ??
      versions[0]
    return fallback?.id ?? null
  }, [versions, isExternallyDriven, externalId, internalVersionId])

  useEffect(() => {
    if (desiredVersionId !== null && desiredVersionId !== internalVersionId) {
      setInternalVersionId(desiredVersionId)
    }
  }, [desiredVersionId, internalVersionId])

  const selectedVersion: ReportVersion | null =
    versions.find((version) => version.id === desiredVersionId) ?? versions[0] ?? null

  const draft = useMemo(
    () => (selectedVersion ? parseAiDraftPayload(selectedVersion.aiDraft) : null),
    [selectedVersion],
  )
  const chapters = useMemo(() => collectDraftChapters(draft), [draft])
  const statusMeta = reviewStatusMeta(selectedVersion?.aiReviewStatus ?? null)
  const canSign =
    selectedVersion?.aiReviewStatus === 'pending_review' && draft !== null && canReview

  const [openChapters, setOpenChapters] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setOpenChapters(
      new Set(chapters.filter((chapter) => !chapter.isEmpty).map((chapter) => chapter.key)),
    )
  }, [selectedVersion?.id])

  function toggleChapter(key: string) {
    setOpenChapters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectVersion(versionId: number) {
    setInternalVersionId(versionId)
    setActionError(null)
    onSelectedVersionChange?.(versionId)
  }

  async function runReview(body: AiReviewPeriodicRequest): Promise<string | null> {
    if (!selectedVersion) return null
    setActionError(null)
    try {
      const result = (await reviewMutation.mutateAsync({
        versionId: selectedVersion.id,
        body,
      })) as PeriodicReviewEnvelope | undefined
      const nextStatus = result?.data?.reviewStatus ?? null
      await queryClient.invalidateQueries({ queryKey: reportV2Keys.versions(projectId) })
      return nextStatus
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '操作失败，请稍后重试'
      setActionError(message)
      return null
    }
  }

  async function handleConfirm() {
    const nextStatus = await runReview({ action: 'confirm' })
    if (nextStatus === 'confirmed') {
      setConfirmOpen(false)
      toast({ variant: 'success', title: '已确认签署', description: '版本已转正并锁定草稿' })
    } else if (nextStatus !== null && nextStatus !== 'confirmed') {
      setActionError('服务未返回确认结果，请刷新版本列表后重试')
    }
  }

  async function handleReject() {
    const reason = returnReason.trim()
    if (!reason) {
      setActionError('退回原因不能为空')
      return
    }
    const nextStatus = await runReview({ action: 'return', returnReason: reason })
    if (nextStatus === 'rejected') {
      setRejectOpen(false)
      setReturnReason('')
      toast({ variant: 'info', title: '草稿已退回', description: '版本状态更新为已退回' })
    } else if (nextStatus !== null && nextStatus !== 'rejected') {
      setActionError('服务未返回退回结果，请刷新版本列表后重试')
    }
  }

  function openConfirmDialog() {
    setActionError(null)
    setDialogOpenedLabel(formatReportTimestamp(new Date().toISOString()))
    setConfirmOpen(true)
  }

  function openRejectDialog() {
    setActionError(null)
    setReturnReason('')
    setDialogOpenedLabel(formatReportTimestamp(new Date().toISOString()))
    setRejectOpen(true)
  }

  return (
    <div
      data-version-review-panel
      data-immersion={tier}
      className="grid gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-4 text-[var(--nx-text-primary)] lg:grid-cols-[280px_1fr]"
    >
      {/* 左侧：版本时间轴 */}
      <aside className="flex min-w-0 flex-col gap-3" aria-label="报表版本时间轴">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-[var(--nx-text-primary)]">版本时间轴</h4>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--nx-text-muted)]">
              {versions.length}
            </span>
            <button
              type="button"
              data-version-refresh
              aria-label="重新加载版本列表"
              onClick={() => void versionsQuery.refetch()}
              className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
            >
              <RotateCw
                className={cn('h-3.5 w-3.5', versionsQuery.isFetching && 'animate-spin')}
                aria-hidden
              />
            </button>
          </div>
        </div>

        {versionsQuery.isLoading ? (
          <div role="status" aria-label="正在加载版本列表" className="space-y-2">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
              />
            ))}
          </div>
        ) : versionsQuery.isError ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--nx-status-danger)] p-3 text-xs"
            style={{
              borderColor: 'color-mix(in srgb, var(--nx-status-danger) 45%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--nx-status-danger) 8%, transparent)',
            }}
          >
            <p className="text-[var(--nx-status-danger)]">版本列表加载失败</p>
            <button
              type="button"
              onClick={() => void versionsQuery.refetch()}
              className="mt-2 inline-flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-border-focus)]"
            >
              <RotateCw className="h-3 w-3" aria-hidden />
              重新加载
            </button>
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] p-6 text-center">
            <FileText className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
            <p className="text-xs text-[var(--nx-text-muted)]">暂未生成任何报表版本</p>
            <p className="text-[10px] text-[var(--nx-text-muted)]">
              可在「AI 周期报表」模式发起首份周报/月报
            </p>
          </div>
        ) : (
          <ol
            data-version-timeline
            className="relative flex flex-col gap-2 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-[var(--nx-border-hairline)]"
          >
            {versions.map((version) => {
              const meta = reviewStatusMeta(version.aiReviewStatus)
              const active = version.id === selectedVersion?.id
              return (
                <li key={version.id} className="relative pl-5">
                  <span
                    className="absolute left-0 top-4 h-[15px] w-[15px] rounded-full border-2 bg-[var(--nx-bg-0)]"
                    style={{
                      borderColor: active ? meta.color : 'var(--nx-border-hairline)',
                      backgroundColor: active
                        ? `color-mix(in srgb, ${meta.color} 25%, transparent)`
                        : 'var(--nx-bg-0)',
                    }}
                    aria-hidden
                  />
                  <button
                    type="button"
                    data-version-row={version.id}
                    aria-pressed={active}
                    onClick={() => selectVersion(version.id)}
                    className={cn(
                      'w-full rounded-md border px-2.5 py-2 text-left transition-colors',
                      active
                        ? 'border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)]'
                        : 'border-transparent bg-transparent hover:border-[var(--nx-border-hairline)]',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-[var(--nx-text-primary)]">
                        {version.title || '报表版本'}{' '}
                        <span className="font-mono text-[var(--nx-text-muted)]">#{version.id}</span>
                      </span>
                      <StatusPill meta={meta} />
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-[var(--nx-text-muted)]">
                      {templateDisplayLabel(version.templateId)} ·{' '}
                      {formatReportTimestamp(version.createdAt ?? version.generatedAt)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </aside>

      {/* 右侧：章节审阅 */}
      <section className="flex min-w-0 flex-col gap-4" aria-label="报表版本审阅区">
        {!selectedVersion ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-md border border-[var(--nx-border-hairline)] p-6 text-center">
            <FileText className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
            <p className="text-sm text-[var(--nx-text-muted)]">选择左侧版本以展开审阅内容</p>
          </div>
        ) : (
          <>
            {/* 头部：状态机徽章 + 元信息 */}
            <header
              data-version-review-header
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
            >
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-base font-medium text-[var(--nx-text-primary)]">
                  <span className="truncate">{selectedVersion.title || '报表版本'}</span>
                  <span className="font-mono text-xs text-[var(--nx-text-muted)]">
                    #{selectedVersion.id}
                  </span>
                </h3>
                <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
                  {templateDisplayLabel(selectedVersion.templateId)}
                  {selectedVersion.dateRange?.fromDate
                    ? ` · ${selectedVersion.dateRange.fromDate} ~ ${selectedVersion.dateRange.toDate ?? ''}`
                    : ''}
                  {' · '}生成于{' '}
                  {formatReportTimestamp(selectedVersion.generatedAt ?? selectedVersion.createdAt)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <StatusPill
                  meta={statusMeta}
                  dataStatus={selectedVersion.aiReviewStatus ?? 'none'}
                />
                {statusMeta.hint ? (
                  <p className="max-w-56 text-right text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
                    {statusMeta.hint}
                  </p>
                ) : null}
              </div>
            </header>

            {/* 签署元信息 */}
            {selectedVersion.aiReviewStatus === 'confirmed' ? (
              <p
                data-version-signature
                className="flex items-center gap-1.5 rounded-md border border-[var(--nx-status-success)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
                style={{
                  borderColor: 'color-mix(in srgb, var(--nx-status-success) 40%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--nx-status-success) 6%, transparent)',
                }}
              >
                <CheckCircle2
                  className="h-3.5 w-3.5 shrink-0 text-[var(--nx-status-success)]"
                  aria-hidden
                />
                已由成员 #{selectedVersion.confirmedBy ?? '—'} 于{' '}
                {formatReportTimestamp(selectedVersion.confirmedAt)} 签署，草稿已锁定
              </p>
            ) : null}

            {selectedVersion.aiReviewStatus === 'rejected' ? (
              <div
                data-version-rejected-banner
                role="alert"
                className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                style={{
                  borderColor: 'color-mix(in srgb, var(--nx-status-danger) 45%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--nx-status-danger) 8%, transparent)',
                }}
              >
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-danger)]"
                  aria-hidden
                />
                <p className="text-[var(--nx-text-secondary)]">
                  <span className="font-medium text-[var(--nx-status-danger)]">退回意见：</span>
                  {selectedVersion.reviewNotes || '审阅人未附具体原因，请按 8 大章节核对后重新生成'}
                </p>
              </div>
            ) : null}

            {/* 8 大章节 */}
            {draft === null ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] p-10 text-center">
                <FileText className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
                <p className="text-sm text-[var(--nx-text-secondary)]">该版本暂无 AI 草稿内容</p>
                <p className="text-xs text-[var(--nx-text-muted)]">
                  AI 周期报表版本在生成并持久化草稿后才会进入可审阅状态
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2" data-review-chapters data-report-export-target>
                {chapters.map((chapter) => {
                  const open = openChapters.has(chapter.key)
                  return (
                    <section
                      key={chapter.key}
                      data-chapter-key={chapter.key}
                      data-chapter-empty={chapter.isEmpty || undefined}
                      className={cn(
                        'overflow-hidden rounded-md border bg-[var(--nx-workspace-surface)]',
                        open
                          ? 'border-[var(--nx-border-hairline)]'
                          : 'border-[var(--nx-border-focus)]',
                      )}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleChapter(chapter.key)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--nx-bg-1)]"
                      >
                        <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                          {chapter.index}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-[var(--nx-text-primary)]">
                            {chapter.title}
                          </span>
                          <span className="block text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                            {chapter.caption}
                          </span>
                        </span>
                        {chapter.isEmpty ? (
                          <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                            本周期无相关记录
                          </span>
                        ) : null}
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 shrink-0 text-[var(--nx-text-muted)] transition-transform',
                            open && 'rotate-180',
                          )}
                          aria-hidden
                        />
                      </button>
                      {open ? (
                        <div className="border-t border-[var(--nx-border-hairline)] px-4 py-3">
                          {chapter.isEmpty ? (
                            <p className="text-xs text-[var(--nx-text-muted)]">
                              数据源未提供该章节内容，如需人工补录请联系项目管理员。
                            </p>
                          ) : chapter.kind === 'list' ? (
                            <ol className="list-none space-y-2">
                              {chapter.items.map((item, index) => (
                                <li
                                  key={`${chapter.key}-${index}`}
                                  className="flex items-start gap-2 text-sm leading-relaxed text-[var(--nx-text-secondary)]"
                                >
                                  {chapter.key === 'highlights' ? (
                                    <CheckCircle2
                                      className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--nx-chart-1)]"
                                      aria-hidden
                                    />
                                  ) : (
                                    <span className="mt-0.5 shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                                      {index + 1}.
                                    </span>
                                  )}
                                  <span className="whitespace-pre-wrap break-words">{item}</span>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--nx-text-secondary)]">
                              {chapter.content}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </section>
                  )
                })}
              </div>
            )}

            {/* 人工签署工具条（RL-01） */}
            {canSign ? (
              <div
                data-review-action-bar
                className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] pt-3"
              >
                <button
                  type="button"
                  data-review-confirm-btn
                  onClick={openConfirmDialog}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)]"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  确认签署
                </button>
                <button
                  type="button"
                  data-review-reject-btn
                  onClick={openRejectDialog}
                  className="inline-flex h-9 items-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)]"
                >
                  退回草稿
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* 确认签署对话框（RL-01：显式人工点击；展示签署人身份与时间戳） */}
      {confirmOpen && selectedVersion ? (
        <ReviewSignDialog
          dataDialog="confirm"
          title="确认签署该报表版本"
          description="签署后版本即转为已确认：草稿锁定、解除正式归档导出限制。此操作记录签署人身份与时间戳（RL-01 人工确认，未经点击绝不自动签署）。"
          actionLabel="确认签署"
          pending={reviewMutation.isPending}
          errorText={actionError}
          onCancel={() => {
            if (!reviewMutation.isPending) {
              setConfirmOpen(false)
              setActionError(null)
            }
          }}
          onSubmit={() => void handleConfirm()}
          metaRows={[
            { label: '目标版本', value: `#${selectedVersion.id}` },
            { label: '当前状态', value: statusMeta.label, color: statusMeta.color },
            {
              label: '签署人',
              value: signer?.fullName ?? `成员 #${signer?.id ?? '—'}`,
            },
            { label: '签署时间', value: dialogOpenedLabel },
          ]}
        />
      ) : null}

      {/* 退回对话框（原因必填） */}
      {rejectOpen && selectedVersion ? (
        <ReviewSignDialog
          dataDialog="reject"
          title="退回草稿并填写原因"
          description="退回后版本状态更新为「已退回」。退回原因将常驻展示给生成方，请尽量具体（≤ 500 字）。"
          actionLabel="退回草稿"
          pending={reviewMutation.isPending}
          canSubmit={returnReason.trim() !== ''}
          errorText={actionError}
          onCancel={() => {
            if (!reviewMutation.isPending) {
              setRejectOpen(false)
              setActionError(null)
            }
          }}
          onSubmit={() => void handleReject()}
        >
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--nx-text-muted)]">
              退回原因（必填）
            </span>
            <textarea
              data-review-reject-reason
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
              rows={4}
              maxLength={500}
              placeholder="例如：风险分析缺少供应链延期风险说明，请补充后重新生成"
              className="w-full resize-y rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-sm text-[var(--nx-text-primary)] outline-none transition-colors focus:border-[var(--nx-border-focus)]"
            />
            <span className="mt-1 block text-right font-mono text-[10px] text-[var(--nx-text-muted)]">
              {returnReason.length}/500
            </span>
            {returnReason.trim() === '' ? (
              <span role="alert" className="mt-1 block text-xs text-[var(--nx-status-danger)]">
                退回原因不能为空
              </span>
            ) : null}
          </label>
        </ReviewSignDialog>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 徽章 / 对话框小件（本文件私有，暗黑仪器风 var(--nx-*)）
// ---------------------------------------------------------------------------

function StatusPill({ meta, dataStatus }: { meta: ReviewStatusMeta; dataStatus?: string }) {
  return (
    <span
      data-review-status={dataStatus ?? meta.label}
      className="inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px]"
      style={{
        color: meta.tone === 'muted' ? 'var(--nx-text-muted)' : meta.color,
        borderColor:
          meta.tone === 'muted'
            ? 'var(--nx-border-hairline)'
            : `color-mix(in srgb, ${meta.color} 45%, transparent)`,
        backgroundColor:
          meta.tone === 'muted'
            ? 'var(--nx-bg-0)'
            : `color-mix(in srgb, ${meta.color} 10%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  )
}

function ReviewSignDialog({
  dataDialog,
  title,
  description,
  actionLabel,
  pending,
  canSubmit = true,
  errorText,
  metaRows,
  children,
  onCancel,
  onSubmit,
}: {
  dataDialog: 'confirm' | 'reject'
  title: string
  description: string
  actionLabel: string
  pending: boolean
  canSubmit?: boolean
  errorText: string | null
  metaRows?: Array<{ label: string; value: string; color?: string }>
  children?: React.ReactNode
  onCancel: () => void
  onSubmit: () => void
}) {
  // 签署 / 退回共用同一弹层容器（父层按 confirmOpen / rejectOpen 条件挂载，挂载即打开）；
  // 审阅写请求在途时 Escape 与「取消 / 关闭」按钮同判据保持禁用。
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: dialogRef,
    open: true,
    onClose: onCancel,
    canClose: () => !pending,
  })

  return (
    <div
      data-review-dialog={dataDialog}
      className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      ref={dialogRef}
      tabIndex={-1}
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] shadow-[0_0_48px_rgba(0,0,0,0.55)]">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-4 py-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-muted)]">
              {description}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭对话框"
            disabled={pending}
            onClick={onCancel}
            className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div className="space-y-3 px-4 py-4">
          {metaRows && metaRows.length > 0 ? (
            <dl className="space-y-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs">
              {metaRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--nx-text-muted)]">{row.label}</dt>
                  <dd
                    className="text-[var(--nx-text-primary)]"
                    style={row.color ? { color: row.color } : undefined}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {children}
        </div>
        {errorText ? (
          <div
            role="alert"
            className="mx-4 mb-2 rounded-sm border border-[var(--nx-status-danger)] px-2.5 py-1.5 text-xs text-[var(--nx-status-danger)]"
            style={{
              borderColor: 'color-mix(in srgb, var(--nx-status-danger) 45%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--nx-status-danger) 8%, transparent)',
            }}
          >
            {errorText}
          </div>
        ) : null}
        <footer className="flex items-center justify-end gap-2.5 border-t border-[var(--nx-border-hairline)] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex h-9 items-center rounded-md border border-[var(--nx-border-hairline)] px-3.5 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            data-review-submit={dataDialog}
            onClick={onSubmit}
            disabled={pending || !canSubmit}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? (
              <RotateCw className="h-4 w-4 animate-spin" aria-hidden />
            ) : dataDialog === 'confirm' ? (
              <ShieldCheck className="h-4 w-4" aria-hidden />
            ) : null}
            {pending ? '处理中…' : actionLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
