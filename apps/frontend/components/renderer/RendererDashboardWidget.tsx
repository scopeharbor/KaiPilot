/**
 * RendererDashboardWidget —— 渲染器 Dashboard widget 包装（§5.2 P0）。
 *
 * 将 DashboardWidgetConfig 映射到现有 Dashboard 指标组件。
 * 处理权限过滤、空数据、警告和 fallback 状态。
 */
'use client'

import type { DashboardWidgetConfig } from '@aiproj/types'
import { AlertTriangle, EyeOff, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'

interface WidgetProps {
  config: DashboardWidgetConfig
  permissionWarnings?: string[]
  data?: unknown
  isLoading?: boolean
}

export function RendererDashboardWidget({
  config,
  permissionWarnings,
  data,
  isLoading,
}: WidgetProps) {
  // 权限不足 → 红acted
  if (config.redactOnPermission?.length && permissionWarnings?.length) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground">
        <EyeOff className="h-4 w-4" />
        <span className="text-sm">{config.title} — 无权限查看</span>
      </div>
    )
  }

  // 加载态
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // 空数据
  if (!data) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        暂无数据
      </div>
    )
  }

  // 警告展示
  if (permissionWarnings?.length) {
    return (
      <div>
        <Alert variant="neutral">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{config.title}</AlertTitle>
          <AlertDescription>
            {permissionWarnings.map((w, i) => (
              <div key={i} className="text-sm">
                {w}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{config.title}</h4>
        <Badge variant="outline" className="text-xs">
          {config.type}
        </Badge>
      </div>
      <div className="text-sm text-muted-foreground">{/* 由具体 Widget 组件替换 */}</div>
    </div>
  )
}
