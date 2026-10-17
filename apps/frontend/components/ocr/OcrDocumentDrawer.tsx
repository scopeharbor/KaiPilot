'use client'

import { useState, useCallback } from 'react'
import { useOcrDocumentJobDetail, useOcrDocumentExtractions } from '@/hooks/use-ocr-document'
import { OcrStatusBadge, ACTION_LABELS } from './OcrDocumentsWorkspace'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import type {
  OcrDocumentWorkspaceRowSummary,
  OcrDocumentWorkspaceAction,
  OcrDocumentJobDetail,
  OcrDocumentAcceptedExtraction,
} from '@aiproj/types'
import { redactDenialReason } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Tab 定义
// ---------------------------------------------------------------------------

type DrawerTab = 'overview' | 'jobs' | 'review' | 'downstream' | 'governance'

const TAB_LABELS: Record<DrawerTab, string> = {
  overview: '概览',
  jobs: '作业',
  review: '审查',
  downstream: '下游',
  governance: '治理',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OcrDocumentDrawerProps {
  /** 选中的源行 */
  row: OcrDocumentWorkspaceRowSummary | null
  /** 所属项目 ID */
  projectId: number
  /** 是否打开 */
  open: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 导航到审查面板 */
  onOpenReview: (jobId: number | string) => void
  /** 导航到下游面板 */
  onOpenDownstream: (action: OcrDocumentWorkspaceAction, jobId: number | string) => void
  /** 创建 OCR 作业 */
  onCreateOcr: (attachmentId: number) => void
  /** 重试 OCR */
  onRetryOcr: (jobId: number | string) => void
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function OcrDocumentDrawer({
  row,
  projectId,
  open,
  onClose,
  onOpenReview,
  onOpenDownstream,
  onCreateOcr,
  onRetryOcr,
}: OcrDocumentDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')

  // 获取作业详情数据
  const jobId = row?.latestJobId ?? null
  const { data: jobDetailData, isLoading: jobLoading } = useOcrDocumentJobDetail(
    projectId,
    Number(jobId ?? 0),
    open && jobId !== null,
  )
  const { data: extractionsData } = useOcrDocumentExtractions(
    projectId,
    Number(jobId ?? 0),
    open && jobId !== null,
  )

  const jobDetail = jobDetailData?.data ?? null
  const extractions = extractionsData?.data ?? []

  const handleTabChange = useCallback((tab: DrawerTab) => {
    setActiveTab(tab)
  }, [])

  if (!open || !row) return null

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
        data-testid="ocr-drawer-overlay"
      />

      {/* 抽屉 */}
      <div
        className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-lg flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900 sm:bottom-0 sm:top-0"
        role="dialog"
        aria-label="OCR 文档详情"
        data-testid="ocr-drawer"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">
              {row.sourceFileName ?? '未命名文件'}
            </h2>
            <div className="mt-0.5 flex items-center gap-2">
              <OcrStatusBadge status={row.status} />
              {row.blockReason && (
                <span className="text-xs text-red-600 dark:text-red-400">
                  {redactDenialReason({
                    blockReason: row.blockReason,
                    isHidden: row.blockReason === 'source_hidden',
                  })}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label="关闭"
            data-testid="ocr-drawer-close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 标签导航 */}
        <div className="flex border-b border-gray-200 dark:border-gray-700" role="tablist">
          {(Object.entries(TAB_LABELS) as [DrawerTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => handleTabChange(tab)}
              className={cn(
                'flex-1 px-3 py-2 text-sm font-medium transition-colors',
                activeTab === tab
                  ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
              )}
              data-testid={`ocr-drawer-tab-${tab}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'overview' && (
            <OverviewTab row={row} jobDetail={jobDetail} isLoading={jobLoading} />
          )}

          {activeTab === 'jobs' && (
            <JobsTab
              row={row}
              jobDetail={jobDetail}
              isLoading={jobLoading}
              onRetry={onRetryOcr}
              onReview={onOpenReview}
            />
          )}

          {activeTab === 'review' && <ReviewTab row={row} onOpenReview={onOpenReview} />}

          {activeTab === 'downstream' && (
            <DownstreamTab
              row={row}
              extractions={extractions}
              onOpenDownstream={onOpenDownstream}
            />
          )}

          {activeTab === 'governance' && <GovernanceTab row={row} />}
        </div>

        {/* 底部操作栏 */}
        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex flex-wrap gap-2">
            {row.allowedActions.includes('create_ocr') && (
              <ActionButton
                label="创建识别"
                variant="primary"
                onClick={() => onCreateOcr(row.sourceId)}
                testId="ocr-drawer-create-ocr"
              />
            )}
            {row.allowedActions.includes('retry_ocr') && jobId !== null && (
              <ActionButton
                label="重试"
                variant="warning"
                onClick={() => onRetryOcr(jobId)}
                testId="ocr-drawer-retry-ocr"
              />
            )}
            {row.allowedActions.includes('review') && jobId !== null && (
              <ActionButton
                label="打开审查"
                variant="purple"
                onClick={() => onOpenReview(jobId)}
                testId="ocr-drawer-open-review"
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 子 Tab 组件
// ---------------------------------------------------------------------------

interface TabPanelProps {
  row: OcrDocumentWorkspaceRowSummary
}

/** 概览 Tab */
function OverviewTab({
  row,
  jobDetail,
  isLoading,
}: TabPanelProps & {
  jobDetail: OcrDocumentJobDetail | null
  isLoading: boolean
}) {
  if (isLoading) {
    return <p className="text-sm text-gray-500">加载详情中...</p>
  }

  return (
    <div className="space-y-4" data-testid="ocr-tab-overview">
      {/* 源元数据 */}
      <Section title="文件信息">
        <DetailRow label="文件名" value={row.sourceFileName ?? '未知'} />
        <DetailRow label="MIME 类型" value={row.sourceMimeType ?? '未知'} />
        <DetailRow label="OCR 支持" value={row.isSupported ? '是' : '否'} />
      </Section>

      {/* 最新作业 */}
      <Section title="最新作业">
        {jobDetail ? (
          <>
            <DetailRow label="作业 ID" value={String(jobDetail.id)} />
            <DetailRow label="状态" value={<OcrStatusBadge status={row.status} />} />
            <DetailRow
              label="页面进度"
              value={`${jobDetail.succeededPages ?? 0} / ${jobDetail.pageCount ?? 0}`}
            />
            {jobDetail.provider && (
              <DetailRow
                label="服务商"
                value={`${jobDetail.provider} / ${jobDetail.model ?? '默认'}`}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-gray-500">暂无作业</p>
        )}
      </Section>

      {/* 成本摘要 */}
      {row.estimatedCost !== null && (
        <Section title="成本">
          <DetailRow
            label="预估费用"
            value={`${row.estimatedCost.toFixed(4)} ${row.costCurrency ?? ''}`}
          />
        </Section>
      )}

      {/* 警告 */}
      {row.warningCodes.length > 0 && (
        <Section title="警告">
          <div className="flex flex-wrap gap-1">
            {row.warningCodes.map((code) => (
              <Badge key={code} variant="warning" className="text-[10px]">
                {code}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {/* 允许操作摘要 */}
      {row.allowedActions.length > 0 && (
        <Section title="可用操作">
          <div className="flex flex-wrap gap-1">
            {row.allowedActions.map((action) => (
              <Badge key={action} variant="outline" className="text-[10px]">
                {ACTION_LABELS[action]}
              </Badge>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

/** 作业 Tab */
function JobsTab({
  row,
  jobDetail,
  isLoading,
  onRetry,
  onReview,
}: TabPanelProps & {
  jobDetail: OcrDocumentJobDetail | null
  isLoading: boolean
  onRetry: (jobId: number | string) => void
  onReview: (jobId: number | string) => void
}) {
  if (isLoading) {
    return <p className="text-sm text-gray-500">加载作业中...</p>
  }

  if (!jobDetail) {
    return (
      <div className="py-8 text-center" data-testid="ocr-tab-jobs">
        <p className="text-sm text-gray-500">暂无 OCR 作业</p>
        {row.allowedActions.includes('create_ocr') && (
          <p className="mt-2 text-xs text-gray-400">请先为此文件创建 OCR 作业</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="ocr-tab-jobs">
      <Section title="当前作业">
        <DetailRow label="作业 ID" value={String(jobDetail.id)} />
        <DetailRow label="状态" value={<OcrStatusBadge status={row.status} />} />
        <DetailRow
          label="进度"
          value={`${jobDetail.succeededPages ?? 0} / ${jobDetail.pageCount ?? 0} 页`}
        />
        <DetailRow label="创建时间" value={jobDetail.createdAt} />
        <DetailRow label="更新时间" value={jobDetail.updatedAt} />
      </Section>

      {/* 作业级操作 */}
      <div className="flex flex-wrap gap-2">
        {row.allowedActions.includes('retry_ocr') && (
          <ActionButton
            label="重试此作业"
            variant="warning"
            onClick={() => onRetry(jobDetail.id)}
            testId="ocr-jobs-retry"
          />
        )}
        {row.allowedActions.includes('review') && (
          <ActionButton
            label="进入审查"
            variant="purple"
            onClick={() => onReview(jobDetail.id)}
            testId="ocr-jobs-review"
          />
        )}
      </div>
    </div>
  )
}

/** 审查 Tab */
function ReviewTab({
  row,
  onOpenReview,
}: TabPanelProps & {
  onOpenReview: (jobId: number | string) => void
}) {
  if (!row.latestJobId) {
    return (
      <div className="py-8 text-center" data-testid="ocr-tab-review">
        <p className="text-sm text-gray-500">没有可审查的作业</p>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="ocr-tab-review">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        审查 OCR 作业的输出结果。确认操作将受到预览哈希和显式用户确认的保护。
      </p>

      {row.allowedActions.includes('review') ? (
        <ActionButton
          label="打开审查面板"
          variant="primary"
          onClick={() => onOpenReview(row.latestJobId!)}
          testId="ocr-review-open-panel"
        />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            当前状态不允许审查操作。
            {row.blockReason && (
              <span>
                {' '}
                原因：
                {redactDenialReason({
                  blockReason: row.blockReason,
                  isHidden: row.blockReason === 'source_hidden',
                })}
              </span>
            )}
          </p>
        </div>
      )}

      <div className="rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          OCR 文档工作区仅编排入口和状态，不提供「自动应用」或「一键执行」功能。
          任何产生写入、索引、导出、抽取快照或清理的操作仍跳转到各自的预览/确认面板。
        </p>
      </div>
    </div>
  )
}

/** 下游 Tab */
function DownstreamTab({
  row,
  extractions,
  onOpenDownstream,
}: TabPanelProps & {
  extractions: OcrDocumentAcceptedExtraction[]
  onOpenDownstream: (action: OcrDocumentWorkspaceAction, jobId: number | string) => void
}) {
  const hasAcceptedExtraction = row.hasAcceptedExtraction || extractions.length > 0

  if (!hasAcceptedExtraction) {
    return (
      <div className="py-8 text-center" data-testid="ocr-tab-downstream">
        <p className="text-sm text-gray-500">没有已确认的提取结果</p>
        <p className="mt-1 text-xs text-gray-400">请先完成 OCR 审查并确认提取</p>
      </div>
    )
  }

  const downstreamActions: OcrDocumentWorkspaceAction[] = [
    'search_index',
    'structured_extraction',
    'entity_linking',
  ]

  return (
    <div className="space-y-4" data-testid="ocr-tab-downstream">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        对已确认的 OCR 提取结果执行下游操作。所有操作将通过各自面板进行，不会自动写入。
      </p>

      {downstreamActions.map((action) => {
        const isAllowed = row.allowedActions.includes(action)
        return (
          <div
            key={action}
            className={cn(
              'flex items-center justify-between rounded border p-3',
              isAllowed
                ? 'border-gray-200 dark:border-gray-700'
                : 'border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50',
            )}
          >
            <div>
              <p className="text-sm font-medium">{ACTION_LABELS[action]}</p>
              <p className="text-xs text-gray-500">
                {action === 'search_index' && '为已确认文本创建搜索索引条目'}
                {action === 'structured_extraction' && '从已确认文本中提取结构化数据'}
                {action === 'entity_linking' && '链接到相关任务、WBS、风险或其他实体'}
              </p>
            </div>
            <button
              onClick={() => row.latestJobId && onOpenDownstream(action, row.latestJobId)}
              disabled={!isAllowed || !row.latestJobId}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium',
                isAllowed && row.latestJobId
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'cursor-not-allowed bg-gray-200 text-gray-400',
              )}
              data-testid={`ocr-downstream-${action}`}
            >
              前往
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** 治理 Tab */
function GovernanceTab({ row }: TabPanelProps) {
  return (
    <div className="space-y-4" data-testid="ocr-tab-governance">
      {/* 保留状态 */}
      <Section title="保留策略">
        {row.blockReason === 'retention_hold' || row.blockReason === 'lifecycle_expired' ? (
          <div className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950">
            <p className="text-sm text-red-700 dark:text-red-400">
              {redactDenialReason({
                blockReason: row.blockReason,
                isHidden: false,
              })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">无活跃保留限制</p>
        )}
      </Section>

      {/* 隐私状态 */}
      <Section title="隐私策略">
        {row.blockReason === 'privacy_block' || row.blockReason === 'source_hidden' ? (
          <div className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950">
            <p className="text-sm text-red-700 dark:text-red-400">
              {redactDenialReason({
                blockReason: row.blockReason,
                isHidden: row.blockReason === 'source_hidden',
              })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">无活跃隐私限制</p>
        )}
      </Section>

      {/* 权限 */}
      <Section title="权限状态">
        {row.blockReason === 'permission_denied' ? (
          <p className="text-sm text-red-600">权限不足</p>
        ) : (
          <p className="text-sm text-gray-500">
            允许操作：
            {row.allowedActions.length > 0
              ? row.allowedActions.map((a) => ACTION_LABELS[a]).join('、')
              : '无'}
          </p>
        )}
      </Section>

      {/* 审计 */}
      <Section title="审计日志">
        {row.allowedActions.includes('view_governance') ? (
          <p className="text-xs text-gray-500">
            可查看与 OCR 相关的审计事件（仅事件计数、操作类型、时间戳和结果状态）。 不显示原始 OCR
            文本或服务商返回体。
          </p>
        ) : (
          <p className="text-sm text-gray-500">审计日志不可用</p>
        )}
      </Section>

      {/* 服务商观测 */}
      <Section title="服务商与成本">
        {row.estimatedCost !== null ? (
          <>
            <DetailRow
              label="预估费用"
              value={`${row.estimatedCost.toFixed(4)} ${row.costCurrency ?? ''}`}
            />
          </>
        ) : (
          <p className="text-sm text-gray-500">无可用的成本信息</p>
        )}
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 辅助组件
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode | string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  )
}

function ActionButton({
  label,
  variant,
  onClick,
  testId,
}: {
  label: string
  variant: 'primary' | 'warning' | 'purple'
  onClick: () => void
  testId: string
}) {
  const variantClasses = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    warning: 'bg-amber-600 text-white hover:bg-amber-700',
    purple: 'bg-purple-600 text-white hover:bg-purple-700',
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1.5 text-sm font-medium transition-colors',
        variantClasses[variant],
      )}
      data-testid={testId}
    >
      {label}
    </button>
  )
}
