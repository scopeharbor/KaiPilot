'use client'

/**
 * v3-plugin-approval-change-flow —— 变更差异审查面板（tasks 4.3/4.4）。
 *
 * 职责：
 * 1. 差异审查：版本、安装状态、权限三段（新增/移除/不变）、兼容性摘要 before→after。
 * 2. 审批与最终确认分离：审批动作（approve 权限）只回答「组织是否允许此差异」；
 *    最终确认（manage 权限）在新鲜句柄上执行提交门。
 * 3. RBAC 门控：canApprove=false 隐藏审批按钮；canManage=false 隐藏确认/撤回。
 * 4. 反馈与可访问性：stale 警示、loading/result feedback、region/aria 标注、简体中文文案。
 */
import * as React from 'react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import type {
  PluginChangeRequestDto,
  PluginChangeDecisionDto,
} from '@/lib/api/plugin-change-requests'
import type { PluginChangeKind, PluginChangeRequestState } from '@aiproj/types'

const KIND_LABELS: Record<PluginChangeKind, string> = {
  install: '安装',
  'permission-upgrade': '权限升级',
  'version-upgrade': '版本升级',
  // v3-plugin-policy-bundles 兼容扩展的 kind
  'policy-bundle-change': '策略包变更',
  // v3-organization-private-plugin-directory 兼容扩展的 kind
  'registry-release-change': '目录版本变更',
}

const STATE_LABELS: Record<PluginChangeRequestState, string> = {
  draft: '草稿',
  'pending-approval': '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  'awaiting-confirmation': '待最终确认',
  applied: '已应用',
  withdrawn: '已撤回',
  expired: '已过期',
  failed: '失败',
}

const STATE_VARIANTS: Record<
  PluginChangeRequestState,
  'neutral' | 'success' | 'danger' | 'warning' | 'outline'
> = {
  draft: 'neutral',
  'pending-approval': 'warning',
  approved: 'success',
  rejected: 'danger',
  'awaiting-confirmation': 'warning',
  applied: 'success',
  withdrawn: 'neutral',
  expired: 'danger',
  failed: 'danger',
}

const EVENT_LABELS: Record<string, string> = {
  requested: '发起请求',
  previewed: '完成预览',
  approved: '审批通过',
  rejected: '已拒绝',
  withdrawn: '已撤回',
  confirmed: '发起确认',
  applied: '应用成功',
  failed: '应用失败',
  expired: '已过期',
}

export interface PluginChangeReviewActionState {
  /** 正在执行某个动作。 */
  acting: boolean
  /** 最近一次最终确认结果。 */
  lastResult: 'applied' | null
  /** 展示给用户的反馈消息（错误或提示）。 */
  message: string | null
  /** 服务端返回绑定失效（要求重新预览）。 */
  stale: boolean
}

export interface PluginChangeRequestReviewProps {
  request: PluginChangeRequestDto
  decisions?: PluginChangeDecisionDto[]
  loading?: boolean
  error?: string
  canManage?: boolean
  canApprove?: boolean
  actionState?: PluginChangeReviewActionState
  onPreview?: () => void
  onApprove?: () => void
  onReject?: () => void
  onWithdraw?: () => void
  onConfirm?: () => void
}

function PermissionList({
  title,
  keys,
  tone,
}: {
  title: string
  keys: readonly string[]
  tone: 'success' | 'danger' | 'neutral'
}) {
  return (
    <div data-perm-group={title}>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">无</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {keys.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <Badge variant={tone}>{key}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function PluginChangeRequestReview({
  request,
  decisions,
  loading = false,
  error,
  canManage = false,
  canApprove = false,
  actionState = { acting: false, lastResult: null, message: null, stale: false },
  onPreview,
  onApprove,
  onReject,
  onWithdraw,
  onConfirm,
}: PluginChangeRequestReviewProps) {
  if (loading) {
    return (
      <Card data-testid="review-skeleton" className="p-6">
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card data-testid="review-error" role="alert" className="p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </Card>
    )
  }

  const { diff } = request
  const terminal = ['rejected', 'applied', 'withdrawn', 'expired'].includes(request.state)
  const isElevation = (diff.permissionDelta?.added.length ?? 0) > 0

  return (
    <Card
      data-change-review={request.id}
      className="p-6 space-y-5"
      aria-label={`变更审查：${request.pluginId}`}
    >
      {/* 头部：标识 + 类型/状态 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" data-testid="review-title">
            {KIND_LABELS[request.kind] ?? request.kind} · {request.pluginId}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            发起人 {request.requestedBy} · 目标 {request.targetRevision}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{KIND_LABELS[request.kind] ?? request.kind}</Badge>
          <Badge variant={STATE_VARIANTS[request.state]} data-testid="review-state">
            {STATE_LABELS[request.state] ?? request.state}
          </Badge>
        </div>
      </div>

      {/* 审批语义提示：审批 ≠ 最终确认 */}
      {isElevation && (
        <p className="text-xs text-warning" data-testid="elevation-note">
          该变更包含新增权限提升，必须经独立审批后由执行者显式确认。
        </p>
      )}

      {/* 差异审查区 */}
      <section role="region" aria-label="变更差异审查" className="space-y-3 rounded-md border p-4">
        <h4 className="text-sm font-medium">变更差异</h4>

        {diff.versionDelta && (
          <div data-testid="version-delta" className="text-sm">
            <span className="text-muted-foreground">版本：</span>
            <span>{diff.versionDelta.currentVersion ?? '（未安装）'}</span>
            <span className="mx-2">→</span>
            <span className="font-medium">{diff.versionDelta.targetVersion}</span>
          </div>
        )}

        {diff.installStatusBefore !== undefined && diff.installStatusAfter !== undefined && (
          <div data-testid="install-status-delta" className="text-sm">
            <span className="text-muted-foreground">安装状态：</span>
            <span>{diff.installStatusBefore}</span>
            <span className="mx-2">→</span>
            <span>{diff.installStatusAfter}</span>
          </div>
        )}

        {diff.permissionDelta && (
          <div data-testid="permission-delta" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PermissionList title="新增权限" keys={diff.permissionDelta.added} tone="success" />
            <PermissionList title="移除权限" keys={diff.permissionDelta.removed} tone="danger" />
            <PermissionList title="不变权限" keys={diff.permissionDelta.unchanged} tone="neutral" />
          </div>
        )}

        {(diff.compatibilityDigestBefore !== undefined ||
          diff.compatibilityDigestAfter !== undefined) && (
          <div data-testid="compat-delta" className="text-xs text-muted-foreground">
            兼容性摘要：
            {diff.compatibilityDigestBefore ?? '（无）'} →{' '}
            {diff.compatibilityDigestAfter ?? '（无）'}
          </div>
        )}
      </section>

      {/* 决策流水 */}
      {decisions && decisions.length > 0 && (
        <section
          role="region"
          aria-label="决策流水"
          data-testid="decision-log"
          className="space-y-1"
        >
          <h4 className="text-sm font-medium">决策流水</h4>
          <ol className="space-y-1">
            {decisions.map((d) => (
              <li key={d.id} className="text-xs text-muted-foreground">
                {EVENT_LABELS[d.event] ?? d.event} · {d.actorRef} · {d.createdAt}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 反馈区 */}
      {actionState.stale && (
        <div
          role="alert"
          data-testid="stale-banner"
          className="rounded-md border border-warning bg-warning/10 p-3 text-sm"
        >
          绑定状态已变化（目标 release 或安装态发生改变），请重新预览后再确认。
        </div>
      )}
      {actionState.lastResult === 'applied' && (
        <div
          role="status"
          data-testid="applied-banner"
          className="rounded-md border border-success bg-success/10 p-3 text-sm"
        >
          变更已应用成功。
        </div>
      )}
      {actionState.message && (
        <div role="alert" data-testid="action-message" className="text-sm text-destructive">
          {actionState.message}
        </div>
      )}

      {/* 操作区：审批与最终确认分离 */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4" data-testid="action-bar">
        {!terminal && canApprove && request.state === 'pending-approval' && (
          <>
            <button
              type="button"
              data-testid="action-approve"
              aria-label="批准该变更"
              disabled={actionState.acting}
              onClick={onApprove}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              批准
            </button>
            <button
              type="button"
              data-testid="action-reject"
              aria-label="拒绝该变更"
              disabled={actionState.acting}
              onClick={onReject}
              className="inline-flex h-8 items-center rounded-md border px-3 text-sm disabled:opacity-50"
            >
              拒绝
            </button>
          </>
        )}

        {!terminal && canManage && request.state === 'draft' && (
          <button
            type="button"
            data-testid="action-preview"
            aria-label="重新生成预览"
            disabled={actionState.acting}
            onClick={onPreview}
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm disabled:opacity-50"
          >
            生成预览
          </button>
        )}

        {!terminal &&
          canManage &&
          (request.state === 'approved' || request.state === 'awaiting-confirmation') && (
            <button
              type="button"
              data-testid="action-confirm"
              aria-label="执行变更（最终确认）"
              disabled={actionState.acting}
              onClick={onConfirm}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {actionState.acting ? '正在执行…' : '执行变更（最终确认）'}
            </button>
          )}

        {!terminal && canManage && request.state !== 'applied' && (
          <button
            type="button"
            data-testid="action-withdraw"
            aria-label="撤回该变更"
            disabled={actionState.acting}
            onClick={onWithdraw}
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm disabled:opacity-50"
          >
            撤回
          </button>
        )}

        {!canApprove && request.state === 'pending-approval' && (
          <span className="text-xs text-muted-foreground" data-testid="no-approve-note">
            您没有审批权限，需由具备审批权的管理员处理。
          </span>
        )}
      </div>
    </Card>
  )
}

export default PluginChangeRequestReview
