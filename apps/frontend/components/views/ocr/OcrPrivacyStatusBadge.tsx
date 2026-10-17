'use client'

import React from 'react'
import type {
  OcrPrivacyOutputMode,
  OcrPrivacyPolicySource,
  OcrPrivacyWarningCode,
} from '@aiproj/types'
import { Badge } from '@/components/ui/Badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'

/**
 * OCR 隐私状态标识与紧凑警告组件（v3-ocr-privacy-policy-controls §7.3）
 *
 * 在现有 OCR review/file 面板中展示：
 * - 策略状态（system/organization/project）
 * - 敏感度类别
 * - 输出模式
 * - 过期/保留/hold 阻断
 * - 脱敏原因
 * - 中文文案
 */

// ─── 状态标识 ───

export function OcrPrivacyStatusBadge({
  policySource,
  globalOutputMode,
  warnings,
}: {
  policySource: OcrPrivacyPolicySource
  globalOutputMode: OcrPrivacyOutputMode
  warnings?: OcrPrivacyWarningCode[]
}) {
  const sourceLabel: Record<OcrPrivacyPolicySource, string> = {
    system: '系统默认',
    organization: '组织策略',
    project: '项目覆盖',
  }

  const modeLabel: Record<OcrPrivacyOutputMode, string> = {
    full: '完整',
    snippet: '摘要',
    masked: '脱敏',
    metadata_only: '仅元数据',
    blocked: '已阻止',
  }

  const modeVariant: Record<
    OcrPrivacyOutputMode,
    'success' | 'warning' | 'danger' | 'neutral' | 'outline'
  > = {
    full: 'neutral',
    snippet: 'warning',
    masked: 'warning',
    metadata_only: 'warning',
    blocked: 'danger',
  }

  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline">{sourceLabel[policySource] ?? policySource}</Badge>
          </TooltipTrigger>
          <TooltipContent>隐私策略来源</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={modeVariant[globalOutputMode] ?? 'outline'}>
              {modeLabel[globalOutputMode] ?? globalOutputMode}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>当前输出模式</TooltipContent>
        </Tooltip>
        {warnings && warnings.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="danger">{warnings.length} 个警告</Badge>
            </TooltipTrigger>
            <TooltipContent>{warnings.join('、')}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  )
}

// ─── 脱敏警告 ───

export function OcrPrivacyRedactionWarning({
  reason,
  children,
}: {
  reason: string
  children?: React.ReactNode
}) {
  const reasonLabel: Record<string, string> = {
    source_hidden: '来源不可见，已脱敏展示',
    lifecycle_expired: '数据已过期',
    lifecycle_purged: '数据已清理',
    lifecycle_tombstoned: '数据已归档',
    hold_blocked: '受保留阻止',
    permission_denied: '权限不足',
    category_blocked: '类别受限',
  }

  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <p className="font-medium">{reasonLabel[reason] ?? reason}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  )
}

// ─── 只读降级 ───

export function OcrPrivacyPermissionDegraded({
  missingPermissions,
}: {
  missingPermissions: string[]
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
      查看隐私信息需要 {missingPermissions.map((p) => p.replace('ocr_privacy:', '')).join('、')}{' '}
      权限
    </div>
  )
}
