import Link from 'next/link'
import { AlertTriangle, CircleHelp, EyeOff, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { PageReadiness, PageStatus } from '@/lib/help/readiness'

const STATUS_META: Record<
  PageStatus,
  { label: string; variant: 'neutral' | 'warning' | 'danger' | 'success' }
> = {
  ready: { label: '可用', variant: 'success' },
  partial: { label: '部分可用', variant: 'warning' },
  planned: { label: '规划中', variant: 'neutral' },
  degraded: { label: '降级', variant: 'danger' },
}

function StatusIcon({ status }: { status: PageStatus }) {
  if (status === 'planned') return <EyeOff className="h-4 w-4" />
  if (status === 'degraded' || status === 'partial') return <AlertTriangle className="h-4 w-4" />
  return <CircleHelp className="h-4 w-4" />
}

/**
 * 页面发布状态横幅（design G：planned/partial/degraded 均提供真实状态、
 * 替代路径与帮助文章；禁止无解释空白或永久 loading）。
 */
export interface PageReadinessBannerProps {
  readiness: PageReadiness
  helpArticleTitle?: string
  className?: string
}

export function PageReadinessBanner({
  readiness,
  helpArticleTitle,
  className,
}: PageReadinessBannerProps) {
  const meta = STATUS_META[readiness.status]
  const helpHref = `/help/articles/${encodeURIComponent(readiness.helpArticleId)}`
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between ${className ?? ''}`}
      data-readiness-status={readiness.status}
      data-testid="page-readiness-banner"
    >
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <StatusIcon status={readiness.status} />
        </span>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <span className="text-sm font-medium">页面状态</span>
          </div>
          <p className="text-sm text-muted-foreground">{readiness.note}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {readiness.alternativeRoute && (
          <Button asChild variant="secondary" size="sm">
            <Link href={readiness.alternativeRoute}>
              <Wrench className="mr-1.5 h-3.5 w-3.5" />
              使用替代路径
            </Link>
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={helpHref}>
            <CircleHelp className="mr-1.5 h-3.5 w-3.5" />
            查看帮助：{helpArticleTitle ?? '文章'}
          </Link>
        </Button>
      </div>
    </div>
  )
}
