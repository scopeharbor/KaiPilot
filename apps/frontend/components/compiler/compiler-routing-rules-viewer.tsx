'use client'

/**
 * v2-5-compiler-dynamic-routing-management-ui —— 路由规则注册表查看器（切片 A）。
 */
import { useRoutingRules } from '@/hooks/use-compiler-routing'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Skeleton } from '@/components/ui/Skeleton'

export function CompilerRoutingRulesViewer() {
  const { data, isLoading, error, refetch } = useRoutingRules()

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        <BrandLoader size={40} label="正在载入路由规则…" />
        {[0, 1, 2].map((k) => (
          <Skeleton key={k} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        title="载入失败"
        description="无法获取路由规则注册表，请重试。"
        action={
          <button onClick={() => refetch()} className="text-sm text-primary underline">
            重试
          </button>
        }
      />
    )
  }

  const snapshot = data?.data
  if (!snapshot || snapshot.ruleCount === 0) {
    return (
      <EmptyState
        title="无路由规则"
        description="当前无注册的路由规则，Compiler 使用默认执行计划。"
      />
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        注册表版本 <Badge variant="outline">{snapshot.version}</Badge> · 共 {snapshot.ruleCount}{' '}
        条规则
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.rules.map((rule) => (
          <Card key={rule.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {rule.id}
                {rule.isDefault && <Badge variant="neutral">默认</Badge>}
                {rule.enabled ? (
                  <Badge variant="success">启用</Badge>
                ) : (
                  <Badge variant="danger">停用</Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  {rule.source === 'code_default' ? '代码' : '组织'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>
                版本：{rule.version.major}.{rule.version.minor}
              </p>
              <p>场景：{rule.scenarioKinds.join(', ')}</p>
              <p>选择 stage：{rule.allowedStageIds.join(', ') || '（无）'}</p>
              <p>跳过 stage：{rule.allowedSkippedStageIds.join(', ') || '（无）'}</p>
              <p>Reason：{rule.reasonCode}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
