'use client'

import { useState, useMemo } from 'react'
import {
  useGroupingViewList,
  useGroupingViewPreview,
  useGroupingViewCreate,
  useGroupingViewUpdate,
  useGroupingViewDelete,
  useGroupingViewDuplicate,
  useGroupingViewSetDefault,
} from '@/hooks/use-portfolio-grouping-views'
import { usePermissions } from '@/hooks/use-permissions'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { toast } from '@/components/ui/Toast'
import {
  Layers,
  Save,
  Copy,
  Trash2,
  Star,
  MoreHorizontal,
  Play,
  Eye,
  RefreshCw,
  AlertCircle,
  LayoutDashboard,
  Lock,
  Globe,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  PmoGroupingViewDefinition,
  PmoGroupingViewCreateRequest,
  PmoGroupingViewPreviewResponse,
  PmoGroupingViewGroupSlice,
  PmoGroupingViewWarning,
  PmoGroupingViewPrimaryKey,
  PmoGroupingViewSortKey,
} from '@aiproj/types'
import {
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_SORT_KEYS,
} from '@aiproj/types'

// ─── Scope Badges ────────────────────────────────────────────────────────────────

const scopeLabels: Record<string, string> = {
  system: '系统',
  personal: '个人',
  organization: '组织',
}

const scopeIcons: Record<string, React.ReactNode> = {
  system: <LayoutDashboard className="h-3.5 w-3.5" />,
  personal: <Lock className="h-3.5 w-3.5" />,
  organization: <Globe className="h-3.5 w-3.5" />,
}

const scopeBadgeClass: Record<string, string> = {
  system: 'bg-blue-100 text-blue-700 border-blue-200',
  personal: 'bg-purple-100 text-purple-700 border-purple-200',
  organization: 'bg-green-100 text-green-700 border-green-200',
}

// ─── Warning Badge ────────────────────────────────────────────────────────────────

function WarningBadge({ warning }: { warning: PmoGroupingViewWarning }) {
  return (
    <div className="flex items-center gap-1 text-xs text-amber-600">
      <AlertCircle className="h-3 w-3" />
      <span title={warning.message}>{warning.code}</span>
    </div>
  )
}

// ─── Group Slice Card ──────────────────────────────────────────────────────────────

function GroupSliceCard({ slice }: { slice: PmoGroupingViewGroupSlice }) {
  return (
    <Card className="border border-gray-200">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm text-gray-800">
            {slice.groupValue || '(未分类)'}
          </span>
          <Badge variant="outline" className="text-xs">
            {slice.projectCount} 个项目
          </Badge>
        </div>
        {slice.kpis.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {slice.kpis.map((kpi) => (
              <div key={kpi.key} className="rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
                <span className="font-medium">{kpi.value ?? '-'}</span>{' '}
                <span className="text-gray-400">{kpi.key}</span>
              </div>
            ))}
          </div>
        )}
        {slice.secondaryGroups && slice.secondaryGroups.length > 0 && (
          <div className="space-y-1 border-t pt-2">
            {slice.secondaryGroups.map((sg) => (
              <div
                key={sg.secondaryValue}
                className="flex items-center gap-2 text-xs text-gray-500"
              >
                <span>{sg.secondaryValue}</span>
                <Badge variant="outline" className="text-[10px] h-4">
                  {sg.projectCount}
                </Badge>
              </div>
            ))}
          </div>
        )}
        {slice.warnings.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {slice.warnings.map((w, i) => (
              <WarningBadge key={i} warning={w} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Save View Dialog ─────────────────────────────────────────────────────────────

function SaveViewDialog({
  open,
  onOpenChange,
  onSave,
  initialScope = PMO_GROUPING_VIEW_SCOPES.PERSONAL,
  canManageShared,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: PmoGroupingViewCreateRequest) => void
  initialScope?: string
  canManageShared: boolean
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState(initialScope)

  const handleSave = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      scope: scope as PmoGroupingViewCreateRequest['scope'],
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })
    setName('')
    setDescription('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>保存分组视图</DialogTitle>
          <DialogDescription>保存当前分组配置以便复用。组织共享视图需管理权限。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="view-name">视图名称</Label>
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：按部门巡检"
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="view-desc">描述（可选）</Label>
            <Input
              id="view-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述此视图的用途"
              maxLength={400}
            />
          </div>
          <div className="space-y-2">
            <Label>可见范围</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PMO_GROUPING_VIEW_SCOPES.PERSONAL}>仅自己可见</SelectItem>
                <SelectItem
                  value={PMO_GROUPING_VIEW_SCOPES.ORGANIZATION}
                  disabled={!canManageShared}
                >
                  组织内共享
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            <Save className="mr-2 h-4 w-4" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────────
// 注意：页面组件不得接收 props（Next 14 PageProps 约束），className 已内建收口。

export default function PmoGroupingViewWorkbench() {
  const { canAny } = usePermissions()
  const hasViewAccess = canAny(['portfolio:view'])
  const canManageShared = canAny(['portfolio:manage'])

  const [activeViewId, setActiveViewId] = useState<string | null>('system-by-status')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [previewData, setPreviewData] = useState<PmoGroupingViewPreviewResponse | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  // 用字面量联合而非 string：预览/保存请求要求的就是这两个联合类型
  const [primaryGrouping, setPrimaryGrouping] = useState<PmoGroupingViewPrimaryKey>('status')
  const [sortKey, setSortKey] = useState<PmoGroupingViewSortKey>(
    PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT,
  )

  const { data: viewList, isLoading: isListLoading } = useGroupingViewList()
  const previewMut = useGroupingViewPreview()
  const createMut = useGroupingViewCreate()
  useGroupingViewUpdate()
  const deleteMut = useGroupingViewDelete()
  const duplicateMut = useGroupingViewDuplicate()
  const setDefaultMut = useGroupingViewSetDefault()

  const views = viewList?.data ?? []
  const activeView = views.find((v) => v.id === activeViewId)

  const userViews = useMemo(() => {
    const personal = views.filter((v) => v.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL)
    const org = views.filter((v) => v.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION)
    const system = views.filter((v) => v.scope === PMO_GROUPING_VIEW_SCOPES.SYSTEM)
    return { system, personal, organization: org }
  }, [views])

  // ─── Permission guard ────────────────────────────────────
  if (!hasViewAccess) {
    return (
      <Alert variant="danger">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>您没有 PMO 组合分组视图访问权限。</AlertDescription>
      </Alert>
    )
  }

  // ─── Handlers ────────────────────────────────────────────
  const handlePreview = async () => {
    setIsPreviewLoading(true)
    try {
      const result = await previewMut.mutateAsync({
        viewId: activeViewId ?? undefined,
        query: {
          primaryGrouping,
          sort: sortKey,
          order: 'desc',
        },
      })
      setPreviewData(result.data)
    } catch {
      toast({ variant: 'error', title: '预览分组视图失败' })
    } finally {
      setIsPreviewLoading(false)
    }
  }

  const handleSave = async (data: PmoGroupingViewCreateRequest) => {
    try {
      // Use the current preview grouping config
      await createMut.mutateAsync({
        ...data,
        query: {
          primaryGrouping,
          sort: sortKey,
          order: 'desc',
        },
      })
      setShowSaveDialog(false)
      toast({ variant: 'success', title: '视图已保存' })
    } catch {
      toast({ variant: 'error', title: '保存视图失败' })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteMut.mutateAsync(id)
      if (activeViewId === id) {
        setActiveViewId(userViews.system[0]?.id ?? null)
        setPreviewData(null)
      }
      toast({ variant: 'success', title: '视图已删除' })
    } catch {
      toast({ variant: 'error', title: '删除视图失败' })
    }
  }

  const handleDuplicate = async (id: string) => {
    try {
      const result = await duplicateMut.mutateAsync({ id })
      toast({ variant: 'success', title: `已复制为「${result.data.name}」` })
    } catch {
      toast({ variant: 'error', title: '复制视图失败' })
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultMut.mutateAsync({ id, body: { scope: 'personal' } })
      toast({ variant: 'success', title: '已设为默认视图' })
    } catch {
      toast({ variant: 'error', title: '设置默认视图失败' })
    }
  }

  // ─── Loading state ───────────────────────────────────────
  if (isListLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ─── View Selector Toolbar ──────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap rounded-lg border bg-white p-3">
        <Layers className="h-5 w-5 text-gray-500" />

        {/* Active View Selector */}
        <Select value={activeViewId ?? ''} onValueChange={setActiveViewId}>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="选择分组视图" />
          </SelectTrigger>
          <SelectContent>
            {/* System presets */}
            {userViews.system.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-400 uppercase">
                  系统预设
                </div>
                {userViews.system.map((v) => (
                  <ViewSelectItem key={v.id} view={v} />
                ))}
              </>
            )}
            {/* Personal views */}
            {userViews.personal.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-400 uppercase">
                  个人视图
                </div>
                {userViews.personal.map((v) => (
                  <ViewSelectItem key={v.id} view={v} />
                ))}
              </>
            )}
            {/* Organization views */}
            {userViews.organization.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-400 uppercase">
                  组织共享
                </div>
                {userViews.organization.map((v) => (
                  <ViewSelectItem key={v.id} view={v} />
                ))}
              </>
            )}
          </SelectContent>
        </Select>

        {/* Quick grouping controls */}
        <Select
          value={primaryGrouping}
          onValueChange={(v) => setPrimaryGrouping(v as PmoGroupingViewPrimaryKey)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="主分组" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PMO_GROUPING_VIEW_PRIMARY_KEYS).map(([label, key]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortKey} onValueChange={(v) => setSortKey(v as PmoGroupingViewSortKey)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="排序" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PMO_GROUPING_VIEW_SORT_KEYS).map(([label, key]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" variant="outline" onClick={handlePreview} disabled={isPreviewLoading}>
          {isPreviewLoading ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          预览
        </Button>

        <div className="flex-1" />

        {/* View actions */}
        {activeView && activeView.scope !== PMO_GROUPING_VIEW_SCOPES.SYSTEM && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDuplicate(activeView.id)}>
                <Copy className="mr-2 h-4 w-4" /> 复制
              </DropdownMenuItem>
              {activeView.capabilities.canSetDefault && (
                <DropdownMenuItem onClick={() => handleSetDefault(activeView.id)}>
                  <Star className="mr-2 h-4 w-4" /> 设为默认
                </DropdownMenuItem>
              )}
              {activeView.capabilities.canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => handleDelete(activeView.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> 删除
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button size="sm" variant="primary" onClick={() => setShowSaveDialog(true)}>
          <Save className="mr-2 h-4 w-4" />
          保存视图
        </Button>
      </div>

      {/* ─── Active view info ─────────────────────────────── */}
      {activeView && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-gray-800">{activeView.name}</span>
          <Badge
            variant="outline"
            className={cn('text-xs border', scopeBadgeClass[activeView.scope] ?? '')}
          >
            {scopeIcons[activeView.scope]}
            <span className="ml-1">{scopeLabels[activeView.scope]}</span>
          </Badge>
          {activeView.isDefault && (
            <Badge
              variant="outline"
              className="text-xs border-amber-300 bg-amber-50 text-amber-700"
            >
              <Star className="mr-1 h-3 w-3" /> 默认
            </Badge>
          )}
          {activeView.description && (
            <span className="text-gray-400 truncate max-w-xs">{activeView.description}</span>
          )}
        </div>
      )}

      {/* ─── Preview Result ────────────────────────────────── */}
      {previewData ? (
        <div className="space-y-3">
          {/* Meta bar */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>
              <Eye className="mr-1 inline h-3 w-3" />
              {previewData.meta.visibleProjectCount} 个项目 · {previewData.meta.primaryGroupCount}{' '}
              个分组
            </span>
            {previewData.meta.truncated && (
              <Badge
                variant="outline"
                className="text-xs border-amber-200 bg-amber-50 text-amber-700"
              >
                <AlertCircle className="mr-1 h-3 w-3" /> 已截断
              </Badge>
            )}
            {previewData.freshness.length > 0 && (
              <span>
                <Clock className="mr-1 inline h-3 w-3" />
                {previewData.freshness.some((f) => f.isStale)
                  ? '数据可能过期'
                  : `更新于 ${new Date(previewData.freshness[0]!.lastUpdatedAt!).toLocaleString()}`}
              </span>
            )}
          </div>

          {/* Group slices grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {previewData.groups.map((group) => (
              <GroupSliceCard key={`${group.groupKey}-${group.groupValue}`} slice={group} />
            ))}
          </div>

          {/* Warnings */}
          {previewData.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex flex-wrap gap-2">
              {previewData.warnings.map((w, i) => (
                <WarningBadge key={i} warning={w} />
              ))}
            </div>
          )}

          {/* Compare block */}
          {previewData.compare && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>比较模式 {previewData.compare.mode} 暂不可用</AlertDescription>
            </Alert>
          )}
        </div>
      ) : (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50">
          <div className="text-center text-gray-400">
            <Eye className="mx-auto h-8 w-8 mb-2" />
            <p className="text-sm">选择一个分组视图并点击「预览」查看结果</p>
          </div>
        </div>
      )}

      {/* ─── Save View Dialog ──────────────────────────────── */}
      <SaveViewDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        onSave={handleSave}
        canManageShared={canManageShared}
      />
    </div>
  )
}

// ─── View Select Item ──────────────────────────────────────────────────────────────

function ViewSelectItem({ view }: { view: PmoGroupingViewDefinition }) {
  return (
    <SelectItem value={view.id} className="flex items-center gap-2">
      <div className="flex items-center gap-2 truncate">
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] border px-1 py-0 h-4 shrink-0',
            scopeBadgeClass[view.scope] ?? '',
          )}
        >
          {scopeLabels[view.scope]}
        </Badge>
        <span className="truncate">{view.name}</span>
        {view.isDefault && <Star className="h-3 w-3 shrink-0 text-amber-500" />}
      </div>
    </SelectItem>
  )
}
