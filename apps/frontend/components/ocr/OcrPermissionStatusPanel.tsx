'use client'

import React from 'react'
import type {
  OcrPermissionStatus,
  OcrPermissionAction,
  OcrPermissionReasonCode,
  OcrPermissionOutputMode,
  OcrAuditSummary,
  OcrPermissionDecisionResult,
} from '@aiproj/types'
import { Badge } from '@/components/ui/Badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'

/**
 * OCR 权限/审计状态面板（v3-ocr-permission-and-audit §7.4/§7.6）
 *
 * 在现有 OCR review/file 表面中展示：
 * - 服务端返回的 allowed/blocked 动作（徽章）
 * - 拒绝/降级原因标签（低敏中文）
 * - 输出模式（full/masked/metadata_only/blocked）
 * - 审计摘要列表入口（只读）
 *
 * 红线：所有动作判定来自服务端 decision snapshot，前端不做权限信任（§5.5）。
 * 不展示完整 OCR 文本、来源文件名、绝对路径或 provider 载荷。
 */

const ACTION_LABELS: Record<OcrPermissionAction, string> = {
  metadata_read: '查看元数据',
  candidate_text_read: '查看候选文本',
  accepted_text_read: '查看已接受文本',
  provider_run: '执行 OCR',
  review_preview: '审查预览',
  review_confirm: '确认审查',
  supersede: '取代审查',
  retention_hold: '保留管理',
  retention_cleanup_preview: '清理预览',
  search_indexing_preview: '索引预览',
  search_indexing_execution: '执行索引',
  structured_extraction_run: '结构化提取',
  entity_linking_run: '实体链接',
  copy_export_preview: '复制/导出预览',
  copy_export_execution: '执行复制/导出',
  optional_ai_handoff: 'AI 交接',
  explain_request: '解释请求',
  permission_status_read: '权限状态',
  ocr_audit_read: '审计读取',
}

const REASON_LABELS: Record<OcrPermissionReasonCode, string> = {
  role_denied: '无该权限',
  permission_missing: '缺少所需权限',
  org_mismatch: '组织不匹配',
  project_mismatch: '项目不匹配',
  source_hidden: '来源已隐藏',
  source_not_found: '来源不存在',
  lifecycle_expired: '已过期',
  lifecycle_purged: '已清除',
  lifecycle_tombstoned: '仅保留元数据',
  retention_held: '保留滞留中',
  retention_purge_pending: '待清除',
  stale_source: '来源已过期',
  privacy_blocked: '隐私策略阻止',
  confirmation_required: '需确认',
  capability_unavailable: '能力暂不可用',
  degraded: '降级',
  system_admin_bypass: '系统管理员放行',
}

const OUTPUT_MODE_LABELS: Record<OcrPermissionOutputMode, string> = {
  full: '完整',
  snippet: '摘要',
  masked: '脱敏',
  metadata_only: '仅元数据',
  blocked: '已阻止',
}

const OUTPUT_MODE_VARIANT: Record<
  OcrPermissionOutputMode,
  'success' | 'warning' | 'danger' | 'neutral' | 'outline'
> = {
  full: 'success',
  snippet: 'neutral',
  masked: 'warning',
  metadata_only: 'warning',
  blocked: 'danger',
}

const RESULT_LABELS: Record<OcrPermissionDecisionResult, string> = {
  allow: '允许',
  confirm_required: '需确认',
  metadata_only: '仅元数据',
  degraded: '降级',
  stale_blocked: '陈旧阻止',
  retention_blocked: '保留阻止',
  privacy_blocked: '隐私阻止',
  denied: '拒绝',
}

// ─── 权限状态面板 ───

export function OcrPermissionStatusPanel({
  status,
  loading,
  onRefresh,
}: {
  status: OcrPermissionStatus | null
  loading?: boolean
  onRefresh?: () => void
}) {
  if (loading && !status) {
    return (
      <div className="rounded border border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        正在加载权限状态…
      </div>
    )
  }

  if (!status) {
    return (
      <div className="rounded border border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        权限状态不可用
      </div>
    )
  }

  return (
    <div
      className="rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
      role="region"
      aria-label="OCR 权限状态"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">OCR 权限</h4>
        <div className="flex items-center gap-1.5">
          <Badge variant={OUTPUT_MODE_VARIANT[status.outputMode] ?? 'outline'}>
            {OUTPUT_MODE_LABELS[status.outputMode] ?? status.outputMode}
          </Badge>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="刷新权限状态"
            >
              刷新
            </button>
          )}
        </div>
      </div>

      {status.allowedActions.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">可执行</p>
          <div className="flex flex-wrap gap-1">
            {status.allowedActions.map((action) => (
              <Badge key={action} variant="outline">
                {ACTION_LABELS[action] ?? action}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {status.blockedActions.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">已阻断</p>
          <div className="flex flex-wrap gap-1">
            {status.blockedActions.map((blocked, idx) => (
              <TooltipProvider key={`${blocked.action}-${idx}`}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="danger">
                      {ACTION_LABELS[blocked.action] ?? blocked.action}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {blocked.reasonCodes.map((c) => REASON_LABELS[c] ?? c).join('、')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>
      )}

      {status.warnings.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs text-amber-700 dark:text-amber-300">
          {status.warnings.map((w, idx) => (
            <li key={idx}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── 审计摘要列表 ───

export function OcrAuditSummaryList({
  summaries,
  loading,
  meta,
  page,
  onPageChange,
  collapsed: _collapsed,
}: {
  summaries: OcrAuditSummary[]
  loading?: boolean
  meta?: { total: number; totalPages: number }
  page: number
  perPage: number
  onPageChange?: (page: number) => void
  /** 本地折叠偏好（低敏：不持久敏感 OCR 内容，仅折叠状态） */
  collapsed?: boolean
}) {
  if (loading && summaries.length === 0) {
    return (
      <div className="rounded border border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        正在加载审计摘要…
      </div>
    )
  }

  if (summaries.length === 0) {
    return (
      <div className="rounded border border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        暂无审计摘要
      </div>
    )
  }

  return (
    <div
      className="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
      role="region"
      aria-label="OCR 审计摘要"
    >
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          <tr>
            <th className="px-2 py-1 text-left font-medium">时间</th>
            <th className="px-2 py-1 text-left font-medium">动作</th>
            <th className="px-2 py-1 text-left font-medium">结果</th>
            <th className="px-2 py-1 text-left font-medium">原因</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {summaries.map((s) => (
            <tr key={s.id} className="text-gray-700 dark:text-gray-300">
              <td className="whitespace-nowrap px-2 py-1">{formatTime(s.createdAt)}</td>
              <td className="px-2 py-1">{ACTION_LABELS[s.action] ?? s.action}</td>
              <td className="px-2 py-1">
                <Badge
                  variant={
                    s.result === 'allow' || s.result === 'confirm_required' ? 'success' : 'danger'
                  }
                >
                  {RESULT_LABELS[s.result] ?? s.result}
                </Badge>
              </td>
              <td className="px-2 py-1">
                {s.reasonCodes.map((c) => REASON_LABELS[c] ?? c).join('、') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {meta && meta.totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between border-t border-gray-100 px-2 py-1 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            共 {meta.total} 条 · 第 {page}/{meta.totalPages} 页
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded px-2 py-0.5 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="上一页"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(meta.totalPages, page + 1))}
              disabled={page >= meta.totalPages}
              className="rounded px-2 py-0.5 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="下一页"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 拒绝原因标签（供其他 OCR 表面复用） ───

export function OcrPermissionReasonLabel({
  reasonCodes,
}: {
  reasonCodes: readonly OcrPermissionReasonCode[]
}) {
  if (reasonCodes.length === 0) return null
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning">{reasonCodes.length} 个原因</Badge>
        </TooltipTrigger>
        <TooltipContent>{reasonCodes.map((c) => REASON_LABELS[c] ?? c).join('、')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
