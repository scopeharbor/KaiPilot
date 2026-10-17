/**
 * RendererFallbackState —— 渲染器 fallback UI 组件（§5.4 P0）。
 *
 * 中文 UI 展示：权限 redacted、空数据、数据源警告、迁移警告、fallback 原因。
 */
'use client'

import type { FallbackState, ValidationIssue } from '@aiproj/types'
import { AlertTriangle, Info, RefreshCw, ShieldOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert'

interface FallbackProps {
  fallback?: FallbackState | null
  warnings?: ValidationIssue[]
  title?: string
}

export function RendererFallbackState({ fallback, warnings, title }: FallbackProps) {
  return (
    <div className="space-y-3 p-4">
      {fallback && (
        <Alert variant="danger">
          <RefreshCw className="h-4 w-4" />
          <AlertTitle>{title || '视图不可用'}</AlertTitle>
          <AlertDescription>
            <p>{fallback.message}</p>
            {fallback.originalConfigRef && (
              <p className="mt-1 text-xs text-muted-foreground">
                配置来源：{fallback.originalConfigRef}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
      {warnings?.map((w, i) => (
        <WarningItem key={i} warning={w} />
      ))}
    </div>
  )
}

function WarningItem({ warning }: { warning: ValidationIssue }) {
  if (warning.code === 'PERMISSION_DENIED') {
    return (
      <Alert variant="neutral">
        <ShieldOff className="h-4 w-4" />
        <AlertTitle>权限不足</AlertTitle>
        <AlertDescription>{warning.message}</AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="neutral">
      <Info className="h-4 w-4" />
      <AlertTitle>{warning.code}</AlertTitle>
      <AlertDescription>
        {warning.message}
        {warning.path && <p className="mt-1 text-xs text-muted-foreground">路径：{warning.path}</p>}
      </AlertDescription>
    </Alert>
  )
}

export function RedactedWidgetPlaceholder({ title }: { title?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      <ShieldOff className="h-4 w-4" />
      <span>{title || 'Widget'} — 当前无权限查看</span>
    </div>
  )
}

export function EmptyDataPlaceholder({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
      <AlertTriangle className="mr-2 h-4 w-4" />
      {message || '暂无数据'}
    </div>
  )
}

export function MigrationWarning({ message }: { message?: string }) {
  return (
    <Alert variant="neutral">
      <RefreshCw className="h-4 w-4" />
      <AlertTitle>配置迁移</AlertTitle>
      <AlertDescription>
        {message || '视图配置已自动升级到新版本，部分设置可能已更新'}
      </AlertDescription>
    </Alert>
  )
}
