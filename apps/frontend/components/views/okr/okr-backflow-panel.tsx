'use client'

// OKR 进度回流面板（v3-okr-progress-backflow §5.3-5.4）。
// 在 OKR 详情或工作台中展示回流建议、贡献明细、确认/拒绝交互。

import { useState } from 'react'
import {
  useOkrBackflowSuggestions,
  useRecalculateOkrBackflow,
  useConfirmOkrBackflow,
  useRejectOkrBackflow,
} from '@/hooks/use-okr'
import type {
  OkrBackflowSuggestion,
  OkrBackflowListQuery,
  OkrBackflowReasonCode,
  OkrBackflowSuggestionStatus,
} from '@aiproj/types'
import { OKR_BACKFLOW_SUGGESTION_STATUS_VALUES } from '@aiproj/types'

// select 的 value 是 string（空串表示「全部」），按枚举校验后再入 state
function narrowStatus(raw: string): OkrBackflowSuggestionStatus | undefined {
  return (OKR_BACKFLOW_SUGGESTION_STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as OkrBackflowSuggestionStatus)
    : undefined
}

interface Props {
  organizationId: number
  keyResultId?: number
  objectiveId?: number
  cycleId?: number
  canManage: boolean
}

export default function OkrBackflowPanel({
  organizationId,
  keyResultId,
  objectiveId,
  cycleId,
  canManage,
}: Props) {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<OkrBackflowSuggestionStatus | undefined>()
  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [rejectReasonCode, setRejectReasonCode] = useState<OkrBackflowReasonCode>('OTHER')
  const [rejectNote, setRejectNote] = useState('')

  const query: OkrBackflowListQuery = {
    keyResultId,
    objectiveId,
    cycleId,
    status: statusFilter,
    page,
    perPage: 10,
    sort: 'calculatedAt',
    order: 'desc',
  }

  const { data, isLoading, error } = useOkrBackflowSuggestions(organizationId, query)
  const recalcMut = useRecalculateOkrBackflow(organizationId)
  const confirmMut = useConfirmOkrBackflow(organizationId)
  const rejectMut = useRejectOkrBackflow(organizationId)

  const suggestions = data?.data ?? []
  const meta = data?.meta

  if (isLoading) {
    return (
      <div className="p-4 text-muted-foreground" data-testid="okr-backflow-loading">
        加载回流建议中...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-destructive" data-testid="okr-backflow-error">
        加载失败：{(error as Error).message}
      </div>
    )
  }

  if (suggestions.length === 0) {
    return (
      <div className="p-4 space-y-4" data-testid="okr-backflow-empty">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">进度回流</h3>
          {canManage && (
            <div className="flex gap-2">
              <select
                className="border rounded px-2 py-1 text-xs"
                value={statusFilter ?? ''}
                onChange={(e) => {
                  setStatusFilter(narrowStatus(e.target.value))
                  setPage(1)
                }}
              >
                <option value="">全部状态</option>
                <option value="pending">待处理</option>
                <option value="needs_review">需审查</option>
                <option value="confirmed">已确认</option>
                <option value="rejected">已拒绝</option>
                <option value="stale">已过期</option>
              </select>
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">暂无回流建议</p>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="okr-backflow-panel">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">
          进度回流
          <span className="text-xs text-muted-foreground ml-2">
            ({meta?.total ?? suggestions.length} 条)
          </span>
        </h3>
        {canManage && (
          <div className="flex gap-2">
            <select
              className="border rounded px-2 py-1 text-xs"
              value={statusFilter ?? ''}
              onChange={(e) => {
                setStatusFilter(narrowStatus(e.target.value))
                setPage(1)
              }}
            >
              <option value="">全部状态</option>
              <option value="pending">待处理</option>
              <option value="needs_review">需审查</option>
              <option value="confirmed">已确认</option>
              <option value="rejected">已拒绝</option>
              <option value="stale">已过期</option>
            </select>
          </div>
        )}
      </div>

      {/* 建议列表 */}
      <div className="space-y-3">
        {suggestions.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            canManage={canManage}
            isRejecting={rejectingId === s.id}
            rejectReasonCode={rejectReasonCode}
            rejectNote={rejectNote}
            onRejectReasonCodeChange={setRejectReasonCode}
            onRejectNoteChange={setRejectNote}
            onStartReject={(id) => {
              setRejectingId(id)
              setRejectReasonCode('OTHER')
              setRejectNote('')
            }}
            onCancelReject={() => setRejectingId(null)}
            onRecalculate={() => recalcMut.mutate(s.keyResultId)}
            onConfirm={() => confirmMut.mutate({ suggestionId: s.id })}
            onReject={() => {
              rejectMut.mutate({
                suggestionId: s.id,
                reasonCode: rejectReasonCode,
                reasonNote: rejectNote,
              })
              setRejectingId(null)
            }}
            isRecalculating={recalcMut.isPending}
            isConfirming={confirmMut.isPending}
            isRejectingMut={rejectMut.isPending}
          />
        ))}
      </div>

      {/* 分页 */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            className="px-3 py-1 border rounded text-sm disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="text-xs text-muted-foreground">
            {meta.page} / {meta.totalPages}
          </span>
          <button
            className="px-3 py-1 border rounded text-sm disabled:opacity-50"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

// ── Suggestion Card ──────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion: s,
  canManage,
  isRejecting,
  rejectReasonCode,
  rejectNote,
  onRejectReasonCodeChange,
  onRejectNoteChange,
  onStartReject,
  onCancelReject,
  onRecalculate,
  onConfirm,
  onReject,
  isRecalculating,
  isConfirming,
  isRejectingMut,
}: {
  suggestion: OkrBackflowSuggestion
  canManage: boolean
  isRejecting: boolean
  rejectReasonCode: string
  rejectNote: string
  onRejectReasonCodeChange: (v: OkrBackflowReasonCode) => void
  onRejectNoteChange: (v: string) => void
  onStartReject: (id: number) => void
  onCancelReject: () => void
  onRecalculate: () => void
  onConfirm: () => void
  onReject: () => void
  isRecalculating: boolean
  isConfirming: boolean
  isRejectingMut: boolean
}) {
  const isActionable = s.status === 'pending' || s.status === 'needs_review'
  const deltaSign = s.delta > 0 ? '+' : ''
  const deltaColor =
    s.delta > 0 ? 'text-green-600' : s.delta < 0 ? 'text-red-600' : 'text-muted-foreground'

  return (
    <div
      className={`border rounded-lg p-3 space-y-2 ${
        s.status === 'confirmed'
          ? 'border-green-200 bg-green-50'
          : s.status === 'rejected'
            ? 'border-red-200 bg-red-50'
            : s.status === 'stale'
              ? 'border-gray-200 bg-gray-50'
              : 'border-blue-200 bg-blue-50'
      }`}
      data-testid={`backflow-suggestion-${s.id}`}
    >
      {/* 进度对比行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">KR #{s.keyResultId}</span>
          <span className="text-xs bg-white border px-2 py-0.5 rounded">
            {s.currentValue} → {s.proposedValue}
          </span>
          <span className={`text-xs font-semibold ${deltaColor}`}>
            {deltaSign}
            {s.delta}
          </span>
          <StatusBadge status={s.status} />
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(s.calculatedAt).toLocaleDateString()}
        </span>
      </div>

      {/* 贡献明细 */}
      {s.contributions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.contributions.map((c, i) => (
            <span
              key={i}
              className="text-xs bg-white border px-1.5 py-0.5 rounded"
              data-testid={`source-chip-${c.source.kind}-${c.source.id}`}
            >
              {sourceKindLabel(c.source.kind)} #{c.source.id} ({c.source.progress}%)
            </span>
          ))}
        </div>
      )}

      {/* 警告 */}
      {s.warnings.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.warnings.map((w, i) => (
            <span
              key={i}
              className={`text-xs px-1.5 py-0.5 rounded ${
                w.code === 'RESTRICTED_SOURCE' || w.code === 'MANUAL_OVERRIDE_CONFLICT'
                  ? 'bg-orange-100 text-orange-800'
                  : w.code === 'STALE_SOURCE' || w.code === 'SOURCE_UNAVAILABLE'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-700'
              }`}
              data-testid={`warning-badge-${w.code}`}
            >
              {w.message}
            </span>
          ))}
        </div>
      )}

      {/* Freshness */}
      {s.freshness.stale && <span className="text-xs text-orange-600">数据可能已陈旧</span>}

      {/* 操作按钮 */}
      {canManage && isActionable && (
        <div className="flex gap-2 pt-1">
          {!isRejecting ? (
            <>
              <button
                className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                disabled={isRecalculating || isConfirming}
                onClick={onConfirm}
                data-testid="backflow-confirm-btn"
              >
                {isConfirming ? '确认中...' : '确认'}
              </button>
              <button
                className="px-3 py-1 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50 disabled:opacity-50"
                disabled={isRecalculating || isConfirming}
                onClick={() => onStartReject(s.id)}
                data-testid="backflow-reject-btn"
              >
                拒绝
              </button>
              <button
                className="px-3 py-1 border rounded text-sm hover:bg-gray-100 disabled:opacity-50"
                disabled={isRecalculating}
                onClick={onRecalculate}
                data-testid="backflow-recalc-btn"
              >
                {isRecalculating ? '重算中...' : '重新计算'}
              </button>
            </>
          ) : (
            <div className="w-full space-y-2">
              <div className="flex gap-2">
                <select
                  className="border rounded px-2 py-1 text-xs"
                  value={rejectReasonCode}
                  onChange={(e) =>
                    onRejectReasonCodeChange(e.target.value as OkrBackflowReasonCode)
                  }
                >
                  <option value="VALUE_INACCURATE">数值不准确</option>
                  <option value="SOURCE_STALE">来源陈旧</option>
                  <option value="CONTRIBUTION_MISMATCH">贡献不匹配</option>
                  <option value="MANUAL_OVERRIDE_PREFERRED">手动覆盖优先</option>
                  <option value="RESTRICTED_DATA_CONCERN">数据限制担忧</option>
                  <option value="OTHER">其他</option>
                </select>
                <input
                  className="border rounded px-2 py-1 text-xs flex-1"
                  placeholder="拒绝原因（必填，≤500字）"
                  value={rejectNote}
                  onChange={(e) => onRejectNoteChange(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1 bg-red-600 text-white rounded text-sm disabled:opacity-50"
                  disabled={!rejectNote.trim() || isRejectingMut}
                  onClick={onReject}
                  data-testid="backflow-reject-confirm-btn"
                >
                  {isRejectingMut ? '拒绝中...' : '确认拒绝'}
                </button>
                <button className="px-3 py-1 border rounded text-sm" onClick={onCancelReject}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 已确认/已拒绝状态 */}
      {s.status === 'confirmed' && s.actorId && (
        <p className="text-xs text-green-700">
          已由用户 #{s.actorId} 确认
          {s.actionedAt && `（${new Date(s.actionedAt).toLocaleDateString()}）`}
        </p>
      )}
      {s.status === 'rejected' && s.reasonCode && (
        <p className="text-xs text-red-700">
          已拒绝（{s.reasonCode}）: {s.reasonNote}
        </p>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: '待处理',
    needs_review: '需审查',
    confirmed: '已确认',
    rejected: '已拒绝',
    stale: '已过期',
  }
  const colors: Record<string, string> = {
    pending: 'bg-blue-100 text-blue-800',
    needs_review: 'bg-orange-100 text-orange-800',
    confirmed: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    stale: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[status] || 'bg-gray-100'}`}>
      {labels[status] || status}
    </span>
  )
}

function sourceKindLabel(kind: string): string {
  switch (kind) {
    case 'project':
      return '项目'
    case 'milestone':
      return '里程碑'
    case 'task':
      return '任务'
    default:
      return kind
  }
}
