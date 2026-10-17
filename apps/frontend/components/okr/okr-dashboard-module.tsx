'use client'

// 组织 Dashboard OKR 摘要模块（v3-okr-dashboard §5.7）。
//
// 消费 `buildOkrDashboardModuleRenderProps` 输出，直接投影：
//   - Cycle title + status
//   - 4 个白名单 KPI
//   - attention top-N（authorized target 才渲染跳转）
//   - warnings（中文文案）
//
// 红线：
//   - 不发请求、不改 store；由父层把 render props 传进来
//   - forbidden / unavailable / stale 都走 emptyState / warning，不裸露原因给未授权用户
//   - 隐藏字段不渲染 tooltip、不写入 aria-label

import Link from 'next/link'
import { AlertCircle, ArrowRight, EyeOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import type { OkrDashboardModuleRenderProps } from '@aiproj/types'
import {
  OKR_ATTENTION_REASON_LABELS,
  OKR_METRIC_LABELS,
  OKR_STATUS_LABELS,
  OKR_WARNING_LABELS,
  formatOkrMetricValue,
} from '@/lib/okr-dashboard-ui'

export interface OkrDashboardModuleProps {
  render: OkrDashboardModuleRenderProps
  /** 模块尺寸：sm 显示 2 KPI，md/lg 显示 4 KPI。 */
  size?: 'sm' | 'md' | 'lg'
  /** 密度：compact 隐藏 attention list。 */
  density?: 'compact' | 'comfortable'
}

export function OkrDashboardModule({
  render,
  size = 'md',
  density = 'comfortable',
}: OkrDashboardModuleProps) {
  const { status, reasonCode } = render

  if (reasonCode === 'forbidden') {
    return (
      <Card data-testid="okr-module-forbidden">
        <CardHeader>
          <CardTitle className="text-sm">OKR 摘要</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title="无权查看" description="请联系管理员申请 OKR 查看权限。" />
        </CardContent>
      </Card>
    )
  }

  if (reasonCode === 'unavailable') {
    return (
      <Card data-testid="okr-module-unavailable">
        <CardHeader>
          <CardTitle className="text-sm">OKR 摘要</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title="暂不可用" description="OKR 数据源暂时无法读取。" />
        </CardContent>
      </Card>
    )
  }

  if (reasonCode === 'empty') {
    return (
      <Card data-testid="okr-module-empty">
        <CardHeader>
          <CardTitle className="text-sm">OKR 摘要</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title="当前周期暂无 OKR" description="尚未在此周期建立目标或关键结果。" />
        </CardContent>
      </Card>
    )
  }

  const kpiCount = size === 'sm' ? 2 : 4
  const kpis = render.kpis.slice(0, kpiCount)
  const showAttention = density === 'comfortable'
  const orgId = render.navigationTarget.organizationId
  const canNavigate = orgId > 0

  return (
    <Card data-testid="okr-module">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="text-sm">OKR 摘要</CardTitle>
          {render.cycleTitle && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{render.cycleTitle}</span>
              {render.cycleStatus && (
                <Badge variant="outline" className="text-[10px]">
                  {OKR_STATUS_LABELS[render.cycleStatus] ?? render.cycleStatus}
                </Badge>
              )}
            </div>
          )}
        </div>
        {canNavigate && (
          <Link
            href={`/organization/okrs/dashboard`}
            className="text-xs text-primary hover:underline"
            data-testid="okr-module-drill"
          >
            查看 <ArrowRight className="inline h-3 w-3" />
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {status === 'stale' && (
          <Alert variant="warning" data-testid="okr-module-stale">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>OKR 数据来源新鲜度过期，仅供参考。</AlertDescription>
          </Alert>
        )}

        <dl
          className={cn(
            'grid gap-2 text-sm',
            size === 'sm' ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4',
          )}
          data-testid="okr-module-kpis"
        >
          {kpis.map((k) => (
            <div key={k.key} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">
                {OKR_METRIC_LABELS[k.key] ?? k.key}
              </dt>
              <dd className="tabular-nums font-medium">
                {formatOkrMetricValue({
                  key: k.key,
                  value: k.value,
                  unit: k.unit,
                  source: 'computed',
                  status: k.status,
                })}
              </dd>
            </div>
          ))}
        </dl>

        {showAttention && render.attentionTop.length > 0 && (
          <ul
            className="space-y-1.5 border-t border-border pt-2 text-sm"
            data-testid="okr-module-attention"
          >
            {render.attentionTop.map((item) => (
              <li
                key={`${item.kind}-${item.entityId}`}
                className="flex items-start justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {item.reasons.slice(0, 2).map((r) => (
                      <Badge key={r} variant="neutral" className="text-[10px]">
                        {OKR_ATTENTION_REASON_LABELS[r] ?? r}
                      </Badge>
                    ))}
                  </div>
                </div>
                {item.target?.authorized ? (
                  <Link
                    href={item.target.href}
                    className="text-[10px] text-primary hover:underline"
                    data-testid="okr-module-attention-link"
                  >
                    查看
                  </Link>
                ) : (
                  <EyeOff
                    className="h-3 w-3 text-muted-foreground"
                    data-testid="okr-module-attention-forbidden"
                    aria-label="无权访问"
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {render.warningCodes.length > 0 && (
          <ul
            className="space-y-0.5 text-[11px] text-muted-foreground"
            data-testid="okr-module-warnings"
          >
            {render.warningCodes.slice(0, 3).map((code, idx) => (
              <li key={`${code}-${idx}`}>{OKR_WARNING_LABELS[code] ?? code}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
