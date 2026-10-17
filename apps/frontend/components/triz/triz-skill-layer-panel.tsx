'use client'

/**
 * TRIZ Skill Layer 审查面组件 (v3-triz-skill-layer-integration §4.3-4.6)
 *
 * 展示 Skill availability、stage bindings、推荐 destinations、来源状态、
 * route preview 和 handoff preview 的审查导向 UI。
 */
import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  useTrizSkillLayerSummary,
  useTrizSkillLayerRoutePreview,
} from '@/hooks/use-triz-skill-layer'
import { usePermissions } from '@/hooks/use-permissions'
import type { TrizSkillProfile, TrizRouteDecision } from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

// ── 状态标签映射 ──────────────────────────────────────────────────────

const AVAILABILITY_LABELS: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'outline' }
> = {
  available: { label: '可用', variant: 'success' },
  advisory: { label: '建议', variant: 'warning' },
  unavailable: { label: '不可用', variant: 'neutral' },
  feature_off: { label: '功能关闭', variant: 'outline' },
  stale: { label: '过期', variant: 'warning' },
  permission_denied: { label: '无权限', variant: 'danger' },
  missing_module: { label: '模块缺失', variant: 'outline' },
}

const STAGE_LABELS: Record<string, string> = {
  requirements_parsing: '需求解析',
  contradiction_detection: '矛盾检测',
  solution_design: '方案设计',
  architecture_definition: '架构定义',
  task_execution: '任务执行',
  monitoring_review: '监控回顾',
  change_management: '变更管理',
}

// ── 组件 ─────────────────────────────────────────────────────────────

export default function TrizSkillLayerPanel() {
  const params = useParams()
  const projectId = params.id as string
  const { permissions } = usePermissions()

  const canView = permissions?.includes('triz_skill_layer:view')
  const canPreview = permissions?.includes('triz_skill_layer:preview')

  const {
    data: summaryData,
    isLoading: summaryLoading,
    error: summaryError,
  } = useTrizSkillLayerSummary(projectId, canView ?? false)

  const summary = summaryData?.data

  // Feature-off 状态
  if (!canView) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          无权查看 TRIZ Skill Layer。需要 triz_skill_layer:view 权限。
        </CardContent>
      </Card>
    )
  }

  if (summaryLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (summaryError || !summary) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          无法加载 TRIZ Skill Layer 数据。请确认功能已开启并稍后重试。
        </CardContent>
      </Card>
    )
  }

  if (!summary.featureFlagEnabled) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          TRIZ Skill Layer 功能已关闭。请联系管理员开启。
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6" data-testid="triz-skill-layer-panel">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">TRIZ Skill Layer</h2>
        <Badge variant="info">
          {summary.profiles.filter((p) => p.availability === 'available').length} 可用
        </Badge>
      </div>

      {/* Skill Profiles */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {summary.profiles.map((profile) => (
          <SkillProfileCard key={profile.destinationKey} profile={profile} />
        ))}
      </div>

      {/* Stage Bindings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">阶段绑定</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {summary.stageBindings.map((binding) => (
              <div key={binding.stage} className="flex items-center gap-2">
                <Badge variant="outline">{STAGE_LABELS[binding.stage] ?? binding.stage}</Badge>
                <span className="text-sm text-muted-foreground">
                  {binding.recommendedDestinations.length > 0
                    ? `${binding.recommendedDestinations.length} 个推荐工具`
                    : '暂无推荐'}
                </span>
                {binding.warnings.length > 0 && (
                  <Badge variant="warning">{binding.warnings.length} 个警告</Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Route Preview 控件（仅当 canPreview 时显示） */}
      {canPreview && <RoutePreviewControl projectId={projectId} />}
    </div>
  )
}

// ── Skill Profile Card ───────────────────────────────────────────────

function SkillProfileCard({ profile }: { profile: TrizSkillProfile }) {
  const status = AVAILABILITY_LABELS[profile.availability] ?? {
    label: profile.availability,
    variant: 'outline' as const,
  }

  return (
    <Card data-testid={`skill-profile-${profile.destinationKey}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{profile.name || profile.destinationKey}</CardTitle>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        {profile.description && <p>{profile.description}</p>}
        <p>版本: {profile.version}</p>
        <p>来源: {profile.fromRegistry ? 'Registry' : 'Unavailable'}</p>
        {profile.isEval && <Badge variant="warning">评估中</Badge>}
        {profile.warnings.map((w) => (
          <Badge key={w} variant="outline" className="mr-1">
            {w}
          </Badge>
        ))}
        <div className="flex gap-2 mt-2">
          <Button variant="outline" size="sm" disabled={profile.availability !== 'available'}>
            查看依据
          </Button>
          <Button variant="outline" size="sm" disabled={profile.availability !== 'available'}>
            打开审查
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Route Preview Control ────────────────────────────────────────────

function RoutePreviewControl({ projectId }: { projectId: string }) {
  const [stageHint, setStageHint] = useState('')
  const [userIntent, setUserIntent] = useState('')
  const [routes, setRoutes] = useState<TrizRouteDecision[]>([])
  const routeMutation = useTrizSkillLayerRoutePreview(projectId)

  const handlePreview = useCallback(async () => {
    const result = await routeMutation.mutateAsync({
      stageHint: stageHint || undefined,
      userIntent: userIntent || undefined,
      idempotencyKey: `ui-route-${Date.now()}`,
    })
    setRoutes(result.data.routes)
  }, [stageHint, userIntent, routeMutation])

  return (
    <Card data-testid="route-preview-control">
      <CardHeader>
        <CardTitle className="text-base">路由预览</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="阶段提示 (如 solution_design)"
            value={stageHint}
            onChange={(e) => setStageHint(e.target.value)}
            className="flex-1 rounded border px-3 py-1.5 text-sm"
          />
          <input
            type="text"
            placeholder="用户意图描述"
            value={userIntent}
            onChange={(e) => setUserIntent(e.target.value)}
            className="flex-1 rounded border px-3 py-1.5 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreview}
            disabled={routeMutation.isPending}
          >
            {routeMutation.isPending ? '生成中...' : '生成预览'}
          </Button>
        </div>

        {routes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">推荐 {routes.length} 个工具</p>
            {routes.map((route) => (
              <div
                key={route.actionId}
                className="flex items-center gap-2 rounded border p-2 text-sm"
              >
                <Badge variant="info">{route.destinationKey}</Badge>
                <span className="text-muted-foreground">
                  置信度: {(route.confidence * 100).toFixed(0)}%
                </span>
                <Badge variant={route.requiresUserConfirmation ? 'warning' : 'outline'}>
                  {route.actionType}
                </Badge>
                {route.stale && <Badge variant="danger">过期</Badge>}
              </div>
            ))}
          </div>
        )}

        {routeMutation.error && (
          <p className="text-xs text-destructive">
            路由预览生成失败。请确认功能已开启且您有相应权限。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
