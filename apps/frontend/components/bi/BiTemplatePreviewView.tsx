'use client'

/**
 * BI 报表模板预览视图（v3-bi-report-template-library §6.3）。
 *
 * 分块渲染模板预览结果：
 *   - Freshness 汇总
 *   - 各数据源状态与 warning
 *   - 脱敏占位
 *   - Partial/warning 安全降级
 */
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { AlertCircle, CheckCircle2, Clock, ShieldOff } from 'lucide-react'
import type { BiTemplatePreview } from '@aiproj/types'

interface BiTemplatePreviewViewProps {
  preview: BiTemplatePreview | undefined
  isLoading: boolean
}

const freshnessIcons: Record<string, React.ReactNode> = {
  fresh: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  stale: <Clock className="h-4 w-4 text-amber-500" />,
  unavailable: <AlertCircle className="h-4 w-4 text-red-500" />,
}

const freshnessLabels: Record<string, string> = {
  fresh: '数据最新',
  stale: '数据可能陈旧',
  unavailable: '数据不可用',
}

export function BiTemplatePreviewView({ preview, isLoading }: BiTemplatePreviewViewProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  if (!preview) {
    return (
      <Alert variant="danger">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>无法加载预览</AlertTitle>
        <AlertDescription>请稍后重试</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {/* 整体状态 */}
      <div className="flex items-center gap-2">
        {freshnessIcons[preview.aggregatedFreshness]}
        <span className="font-medium">{freshnessLabels[preview.aggregatedFreshness]}</span>
        {preview.blocking && (
          <Badge variant="danger" className="ml-auto">
            存在阻塞性警告
          </Badge>
        )}
      </div>

      {/* 阻塞性警告 */}
      {preview.blocking && preview.warnings.length > 0 && (
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>阻塞性警告</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 text-sm">
              {preview.warnings
                .filter((w) => w.level === 'critical')
                .map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* 各数据源结果 */}
      {preview.sources.map((source) => (
        <Card key={source.dataSourceKey}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">数据源: {source.dataSourceKey}</CardTitle>
              <div className="flex items-center gap-1">
                {freshnessIcons[source.freshness.state]}
                <span className="text-xs text-muted-foreground">
                  {freshnessLabels[source.freshness.state]}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm">
            {/* 数据源警告 */}
            {source.warnings.length > 0 && (
              <div className="mb-2">
                {source.warnings.map((w, i) => (
                  <p key={i} className="text-amber-600 dark:text-amber-400 text-xs">
                    ⚠ {w.message}
                  </p>
                ))}
              </div>
            )}

            {/* 脱敏信息 */}
            {source.redactions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {source.redactions.map((r, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    <ShieldOff className="h-3 w-3 mr-1" />
                    {r.dimensionKey}: {r.state === 'redacted' ? '已脱敏' : '无权限'}
                    {r.reason && <span className="ml-1">({r.reason})</span>}
                  </Badge>
                ))}
              </div>
            )}

            {/* 数据占位 */}
            {!source.data && source.status === 'available' && (
              <p className="text-muted-foreground text-xs mt-1">暂无数据</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
