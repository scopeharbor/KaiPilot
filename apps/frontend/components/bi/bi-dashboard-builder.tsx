'use client'

// v3-bi-dashboard-builder §8.2 — BI Dashboard Builder 页面/工作台。
// widget library、layout canvas、全局筛选、时间窗口、预览面板、版本/默认状态。

import { useState, useCallback } from 'react'
import {
  useWidgetRegistry,
  useCurrentDashboard,
  useDashboardList,
  usePreviewDashboard,
  useCreateDashboard,
  useUpdateDashboard,
  useSetDefaultDashboard,
  useArchiveDashboard,
} from '@/hooks/use-bi-dashboard'
import type {
  BiDashboardWidgetInstance,
  BiDashboardLayout,
  BiDashboardGlobalFilter,
  BiDashboardTimeWindow,
  BiDashboardPreviewResult,
  BiDashboardWarning,
} from '@aiproj/types'
import { BI_DASHBOARD_SCOPES, BI_DASHBOARD_MAX_WIDGETS } from '@aiproj/types'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Separator } from '@/components/ui/Separator'
import { useToast } from '@/components/ui/Toast'

// ─── Widget 库项目 ─────────────────────────────────────────────────────────

function WidgetLibrary({
  registry,
  onAddWidget,
  disabled,
}: {
  registry: { widgetKey: string; displayKey: string; availability: string }[]
  onAddWidget: (key: string) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
      <h3 className="text-sm font-semibold">Widget 库</h3>
      <div className="grid grid-cols-2 gap-2">
        {registry.map((entry) => (
          <Button
            key={entry.widgetKey}
            variant="outline"
            size="sm"
            disabled={disabled || entry.availability !== 'available'}
            onClick={() => onAddWidget(entry.widgetKey)}
            aria-label={`添加 ${entry.displayKey} widget`}
          >
            {entry.displayKey}
            {entry.availability !== 'available' && (
              <Badge variant="neutral" className="ml-1 text-xs">
                不可用
              </Badge>
            )}
          </Button>
        ))}
      </div>
    </div>
  )
}

// ─── Widget 编辑器 ─────────────────────────────────────────────────────────

function WidgetEditorCard({
  widget,
  onUpdate,
  onRemove,
}: {
  widget: BiDashboardWidgetInstance
  onUpdate: (w: BiDashboardWidgetInstance) => void
  onRemove: () => void
}) {
  return (
    <Card className="border-dashed">
      <CardHeader className="py-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium">{widget.widgetKey}</CardTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label={`移除 ${widget.widgetKey}`}
            >
              ✕
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="py-2">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="block text-muted-foreground">尺寸</label>
            <Select
              value={widget.size}
              onValueChange={(v) =>
                onUpdate({ ...widget, size: v as BiDashboardWidgetInstance['size'] })
              }
            >
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
              <option value="full">全宽</option>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── 预览面板 ──────────────────────────────────────────────────────────────

function PreviewPanel({
  result,
  isLoading,
  error,
}: {
  result?: BiDashboardPreviewResult
  isLoading: boolean
  error?: Error | null
}) {
  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">预览加载中...</div>
  }

  if (error) {
    return <div className="p-4 text-sm text-destructive">预览失败: {error.message}</div>
  }

  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground">添加 widget 后点击「预览」查看效果</div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">预览结果</h3>
        {result.saveable ? (
          <Badge variant="primary">可保存</Badge>
        ) : (
          <Badge variant="danger">不可保存</Badge>
        )}
        <Badge variant="outline">
          {result.freshnessAggregate.status === 'fresh' ? '数据新鲜' : '数据陈旧'}
        </Badge>
      </div>

      {result.globalWarnings.length > 0 && (
        <div className="space-y-1">
          {result.globalWarnings.map((w: BiDashboardWarning, i: number) => (
            <div
              key={i}
              className={`text-xs p-2 rounded ${
                w.blocking ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'
              }`}
            >
              {w.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {result.widgets.map((wp) => (
          <div key={wp.widgetKey} className="border rounded p-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium">{wp.widgetKey}</span>
              <Badge
                variant={
                  wp.status === 'available'
                    ? 'primary'
                    : wp.status === 'blocking'
                      ? 'danger'
                      : 'neutral'
                }
              >
                {wp.status}
              </Badge>
            </div>
            {wp.warnings.length > 0 && (
              <div className="mt-1 text-muted-foreground">
                {wp.warnings.map((w, j) => (
                  <div key={j}>{w.message}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 主 Builder 组件 ───────────────────────────────────────────────────────

export default function BiDashboardBuilder() {
  // 路由 `/organization/bi/dashboards` 没有 :organizationId 参数（幽灵参数修复）：
  // 组织 id 一律从 auth store 的有效租户上下文取，取不到（未选择组织）时不渲染 Builder。
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  if (organizationId === null) {
    return <Alert className="my-8">请先选择组织</Alert>
  }
  return <BiDashboardBuilderInner organizationId={organizationId} />
}

function BiDashboardBuilderInner({ organizationId }: { organizationId: number }) {
  const { toast } = useToast()

  // State
  const [name, setName] = useState('')
  const [layout, setLayout] = useState<BiDashboardLayout>({ columns: 2, density: 'comfortable' })
  const [widgets, setWidgets] = useState<BiDashboardWidgetInstance[]>([])
  const [globalFilters, setGlobalFilters] = useState<BiDashboardGlobalFilter[]>([])
  const [timeWindow, setTimeWindow] = useState<BiDashboardTimeWindow>({
    mode: 'last_n_days',
    days: 30,
  })
  const [editingDashboardId, setEditingDashboardId] = useState<number | null>(null)
  const [editingVersion, setEditingVersion] = useState<number>(0)
  const [isSaving, setIsSaving] = useState(false)

  // Queries
  const registryQuery = useWidgetRegistry(organizationId)
  useCurrentDashboard(organizationId)
  const listQuery = useDashboardList(organizationId)

  // Mutations
  const previewMutation = usePreviewDashboard(organizationId)
  const createMutation = useCreateDashboard(organizationId)
  const updateMutation = useUpdateDashboard(organizationId)
  useSetDefaultDashboard(organizationId)
  useArchiveDashboard(organizationId)

  // Preview result
  const [previewResult, setPreviewResult] = useState<BiDashboardPreviewResult | undefined>()

  // Handlers
  const handleAddWidget = useCallback(
    (widgetKey: string) => {
      if (widgets.length >= BI_DASHBOARD_MAX_WIDGETS) {
        toast({ title: '已达最大 widget 数量', variant: 'error' })
        return
      }
      const newWidget: BiDashboardWidgetInstance = {
        widgetKey: widgetKey as BiDashboardWidgetInstance['widgetKey'],
        size: 'medium',
        position: {
          x: widgets.length % layout.columns,
          y: Math.floor(widgets.length / layout.columns),
          w: 1,
          h: 1,
        },
        settings: {},
      }
      setWidgets((prev) => [...prev, newWidget])
    },
    [widgets, layout.columns, toast],
  )

  const handleRemoveWidget = useCallback((index: number) => {
    setWidgets((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handlePreview = useCallback(async () => {
    await previewMutation.mutateAsync(
      { layout, widgets, globalFilters, timeWindow },
      {
        onSuccess: (data) => setPreviewResult(data.data),
        onError: (err) => toast({ title: '预览失败', description: String(err), variant: 'error' }),
      },
    )
  }, [layout, widgets, globalFilters, timeWindow, previewMutation, toast])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      if (editingDashboardId && editingVersion > 0) {
        await updateMutation.mutateAsync({
          dashboardId: editingDashboardId,
          payload: {
            name,
            scope: BI_DASHBOARD_SCOPES.PERSONAL,
            version: editingVersion,
            layout,
            widgets,
            globalFilters,
            timeWindow,
          },
        })
        toast({ title: '已保存' })
      } else {
        await createMutation.mutateAsync({
          name: name || '未命名看板',
          scope: BI_DASHBOARD_SCOPES.PERSONAL,
          layout,
          widgets,
          globalFilters,
          timeWindow,
        })
        toast({ title: '已创建' })
      }
    } catch (err) {
      toast({ title: '保存失败', description: String(err), variant: 'error' })
    } finally {
      setIsSaving(false)
    }
  }, [
    editingDashboardId,
    editingVersion,
    name,
    layout,
    widgets,
    globalFilters,
    timeWindow,
    createMutation,
    updateMutation,
    toast,
  ])

  const handleSelectDashboard = useCallback(
    (dashboardId: number) => {
      const dash = listQuery.data?.data.find((d) => d.dashboardId === dashboardId)
      if (dash) {
        setEditingDashboardId(dash.dashboardId)
        setEditingVersion(dash.version)
        setName(dash.name)
        setLayout(dash.layout)
        setWidgets(dash.widgets)
        setGlobalFilters(dash.globalFilters)
        setTimeWindow(dash.timeWindow)
      }
    },
    [listQuery.data],
  )

  if (registryQuery.isLoading) {
    return <div className="p-8 text-muted-foreground">加载 widget 注册表中...</div>
  }

  const registry = registryQuery.data?.data ?? []

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">BI Dashboard Builder</h1>
          <p className="text-sm text-muted-foreground">组合 BI 资产为自定义运营看板</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={previewMutation.isPending || widgets.length === 0}
          >
            {previewMutation.isPending ? '预览中...' : '预览'}
          </Button>
          <Button onClick={handleSave} disabled={isSaving || widgets.length === 0}>
            {isSaving ? '保存中...' : editingDashboardId ? '更新' : '保存'}
          </Button>
        </div>
      </div>

      {/* Dashboard Name */}
      <div>
        <Input
          placeholder="看板名称（可选）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-md"
          aria-label="看板名称"
        />
      </div>

      {/* Layout Controls */}
      <div className="flex gap-4 items-center">
        <div>
          <label className="text-xs text-muted-foreground block">列数</label>
          <Select
            value={String(layout.columns)}
            onValueChange={(v) => setLayout({ ...layout, columns: Number(v) })}
          >
            <option value="1">1 列</option>
            <option value="2">2 列</option>
            <option value="3">3 列</option>
            <option value="4">4 列</option>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block">密度</label>
          <Select
            value={layout.density}
            onValueChange={(v) => setLayout({ ...layout, density: v as 'comfortable' | 'compact' })}
          >
            <option value="comfortable">舒适</option>
            <option value="compact">紧凑</option>
          </Select>
        </div>
      </div>

      {/* Saved Dashboards */}
      {listQuery.data && listQuery.data.data.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">已保存的看板</h3>
          <div className="flex gap-2 flex-wrap">
            {listQuery.data.data
              .filter((d) => !d.isArchived)
              .map((d) => (
                <Button
                  key={d.dashboardId}
                  variant={editingDashboardId === d.dashboardId ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => handleSelectDashboard(d.dashboardId)}
                >
                  {d.name}
                  {d.isDefault && (
                    <Badge variant="neutral" className="ml-1">
                      默认
                    </Badge>
                  )}
                </Button>
              ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Main Grid: Widget Library + Canvas + Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Widget Library */}
        <div>
          <WidgetLibrary
            registry={registry.map((r) => ({
              widgetKey: r.widgetKey,
              displayKey: r.displayKey,
              availability: r.availability,
            }))}
            onAddWidget={handleAddWidget}
            disabled={false}
          />
        </div>

        {/* Canvas */}
        <div>
          <h3 className="text-sm font-semibold mb-2">
            布局画布 ({widgets.length}/{BI_DASHBOARD_MAX_WIDGETS})
          </h3>
          <div
            className={`grid gap-3 border rounded-lg p-4 min-h-[300px] bg-muted/10`}
            style={{ gridTemplateColumns: `repeat(${layout.columns}, 1fr)` }}
          >
            {widgets.length === 0 && (
              <div className="col-span-full flex items-center justify-center text-muted-foreground text-sm py-12">
                从左侧 Widget 库添加组件
              </div>
            )}
            {widgets.map((widget, index) => (
              <WidgetEditorCard
                key={index}
                widget={widget}
                onUpdate={(w) => setWidgets((prev) => prev.map((x, i) => (i === index ? w : x)))}
                onRemove={() => handleRemoveWidget(index)}
              />
            ))}
          </div>
        </div>

        {/* Preview Panel */}
        <div className="border rounded-lg">
          <PreviewPanel
            result={previewResult}
            isLoading={previewMutation.isPending}
            error={previewMutation.error}
          />
        </div>
      </div>
    </div>
  )
}
