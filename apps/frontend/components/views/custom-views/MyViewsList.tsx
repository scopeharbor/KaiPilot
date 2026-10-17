'use client'

import * as React from 'react'
import {
  LayoutDashboard,
  List,
  Calendar,
  GanttChartSquare,
  GitBranch,
  Globe,
  Lock,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  Star,
  Check,
  PanelRightOpen,
  Users,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import {
  useCustomViewsList,
  useDeleteCustomView,
  useUpdateCustomView,
  useCloneCustomView,
  useSetDefaultCustomView,
} from '@/hooks/use-custom-views'
import type { CustomViewResponse, CustomViewBaseType } from '@aiproj/types'

const BASE_VIEW_ICONS: Record<CustomViewBaseType, typeof LayoutDashboard> = {
  kanban: LayoutDashboard,
  list: List,
  calendar: Calendar,
  gantt: GanttChartSquare,
  wbs: GitBranch,
  resource: Users,
}

const BASE_VIEW_LABELS: Record<CustomViewBaseType, string> = {
  kanban: '看板',
  list: '列表',
  calendar: '日历',
  gantt: '甘特图',
  wbs: 'WBS',
  resource: '资源',
}

interface MyViewsListProps {
  projectId: number
  activeViewId: number | null
  onSwitchView: (view: CustomViewResponse) => void
  ownerUserId: number
  collapsed?: boolean
}

/**
 * 我的视图列表（v2-custom-views-view-config）。
 *
 * 分「个人视图」与「共享视图」两组展示：
 * - 点击视图行切换
 * - 行末「更多」菜单可重命名/删除/克隆/设为默认
 * - 加载中显示骨架屏
 * - 无视图时显示空态
 * - collapsed 模式下缩为紧凑列表
 */
export function MyViewsList({
  projectId,
  activeViewId,
  onSwitchView,
  ownerUserId,
  collapsed = false,
}: MyViewsListProps) {
  const { data, isLoading, isError } = useCustomViewsList(projectId)
  const deleteView = useDeleteCustomView(projectId)
  const updateView = useUpdateCustomView(projectId)
  const cloneView = useCloneCustomView(projectId)
  const setDefaultView = useSetDefaultCustomView(projectId)

  const [renameTarget, setRenameTarget] = React.useState<CustomViewResponse | null>(null)
  const [renameName, setRenameName] = React.useState('')
  const [deleteTarget, setDeleteTarget] = React.useState<CustomViewResponse | null>(null)

  const personalViews = data?.personal ?? []
  const sharedViews = data?.shared ?? []

  // 加载态
  if (isLoading) {
    return <ViewsSkeleton collapsed={collapsed} />
  }

  // 错误态
  if (isError) {
    return (
      <div className="px-3 py-4 text-center text-sm text-gray-500">
        加载视图列表失败，请稍后重试。
      </div>
    )
  }

  // 空态
  if (personalViews.length === 0 && sharedViews.length === 0) {
    return (
      <EmptyState
        icon={PanelRightOpen}
        title="暂无保存的视图"
        description="调整筛选与显示设置后，点击工具栏的「保存」即可创建自定义视图。"
        className="py-8"
      />
    )
  }

  function handleRenameStart(view: CustomViewResponse) {
    setRenameTarget(view)
    setRenameName(view.name)
  }

  async function handleRenameConfirm() {
    if (!renameTarget) return
    const trimmed = renameName.trim()
    if (!trimmed) return
    try {
      await updateView.mutateAsync({ viewId: renameTarget.id, data: { name: trimmed } })
      setRenameTarget(null)
    } catch {
      // 错误已由 mutation 处理
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    try {
      await deleteView.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      // 错误已由 mutation 处理
    }
  }

  async function handleClone(view: CustomViewResponse) {
    try {
      await cloneView.mutateAsync({
        viewId: view.id,
        data: { name: `${view.name}（副本）` },
      })
    } catch {
      // 错误已由 mutation 处理
    }
  }

  async function handleSetDefault(view: CustomViewResponse) {
    try {
      await setDefaultView.mutateAsync(view.id)
    } catch {
      // 错误已由 mutation 处理
    }
  }

  return (
    <div className="space-y-1">
      {/* 个人视图 */}
      {personalViews.length > 0 && (
        <div>
          {!collapsed && (
            <div className="px-3 py-1.5 text-xs font-medium text-gray-500">个人视图</div>
          )}
          {personalViews.map((view) => (
            <ViewRow
              key={view.id}
              view={view}
              isActive={view.id === activeViewId}
              isOwner={view.ownerUserId === ownerUserId}
              collapsed={collapsed}
              onSelect={() => onSwitchView(view)}
              onRename={() => handleRenameStart(view)}
              onDelete={() => setDeleteTarget(view)}
              onClone={view.visibility === 'shared' ? () => handleClone(view) : undefined}
              onSetDefault={() => handleSetDefault(view)}
            />
          ))}
        </div>
      )}

      {sharedViews.length > 0 && (
        <div>
          {!collapsed && (
            <div className="px-3 py-1.5 text-xs font-medium text-gray-500">共享视图</div>
          )}
          {sharedViews.map((view) => (
            <ViewRow
              key={view.id}
              view={view}
              isActive={view.id === activeViewId}
              isOwner={view.ownerUserId === ownerUserId}
              collapsed={collapsed}
              onSelect={() => onSwitchView(view)}
              onRename={
                view.ownerUserId === ownerUserId ? () => handleRenameStart(view) : undefined
              }
              onDelete={view.ownerUserId === ownerUserId ? () => setDeleteTarget(view) : undefined}
              onClone={() => handleClone(view)}
              onSetDefault={
                view.ownerUserId === ownerUserId ? () => handleSetDefault(view) : undefined
              }
            />
          ))}
        </div>
      )}

      {/* 重命名对话框 */}
      <RenameDialog
        open={renameTarget !== null}
        name={renameName}
        onNameChange={setRenameName}
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameTarget(null)}
        loading={updateView.isPending}
      />

      {/* 删除确认对话框 */}
      <DeleteDialog
        open={deleteTarget !== null}
        viewName={deleteTarget?.name ?? ''}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteView.isPending}
      />
    </div>
  )
}

// ─── 子组件 ─────────────────────────────────────────────

interface ViewRowProps {
  view: CustomViewResponse
  isActive: boolean
  isOwner: boolean
  collapsed: boolean
  onSelect: () => void
  onRename?: () => void
  onDelete?: () => void
  onClone?: () => void
  onSetDefault?: () => void
}

function ViewRow({
  view,
  isActive,
  isOwner: _isOwner,
  collapsed,
  onSelect,
  onRename,
  onDelete,
  onClone,
  onSetDefault,
}: ViewRowProps) {
  const Icon = BASE_VIEW_ICONS[view.baseViewType] ?? LayoutDashboard

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors',
          isActive
            ? 'bg-primary-50 text-primary-700 font-medium'
            : 'text-gray-700 hover:bg-gray-100',
        )}
        title={view.name}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate text-xs">{view.name}</span>
        {view.isDefault && (
          <Star className="ml-auto h-3 w-3 shrink-0 text-warning" aria-label="默认视图" />
        )}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors',
        isActive ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-100',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 items-center gap-2 truncate text-left"
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{view.name}</span>
        {view.isDefault && (
          <Star className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="默认视图" />
        )}
      </button>

      <div className="flex items-center gap-1">
        {/* 共享徽标 */}
        {view.visibility === 'shared' && (
          <Globe className="h-3.5 w-3.5 text-gray-400" aria-label="共享" />
        )}
        {view.visibility === 'personal' && (
          <Lock className="h-3.5 w-3.5 text-gray-400" aria-label="个人" />
        )}

        <Badge variant="neutral" className="ml-1 text-[10px]">
          {BASE_VIEW_LABELS[view.baseViewType]}
        </Badge>

        {/* 更多菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="视图操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            {onRename && (
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="h-4 w-4" aria-hidden />
                重命名
              </DropdownMenuItem>
            )}
            {onClone && (
              <DropdownMenuItem onClick={onClone}>
                <Copy className="h-4 w-4" aria-hidden />
                克隆
              </DropdownMenuItem>
            )}
            {onSetDefault && (
              <DropdownMenuItem onClick={onSetDefault}>
                <Check className="h-4 w-4" aria-hidden />
                设为默认
              </DropdownMenuItem>
            )}
            {(onRename || onClone || onSetDefault) && <DropdownMenuSeparator />}
            {onDelete && (
              <DropdownMenuItem destructive onClick={onDelete}>
                <Trash2 className="h-4 w-4" aria-hidden />
                删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** 加载骨架屏 */
function ViewsSkeleton({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="space-y-1 px-3 py-2">
      {!collapsed && <Skeleton className="mb-2 h-3 w-16" />}
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-10 rounded-[var(--radius-sm)]" />
        </div>
      ))}
    </div>
  )
}

/** 重命名对话框 */
function RenameDialog({
  open,
  name,
  onNameChange,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean
  name: string
  onNameChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !loading) {
      onConfirm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm" aria-describedby="rename-view-description">
        <DialogHeader>
          <DialogTitle>重命名视图</DialogTitle>
          <DialogDescription id="rename-view-description">输入新的视图名称。</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rename-input">视图名称</Label>
          <Input
            id="rename-input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            maxLength={64}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={onConfirm} loading={loading}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 删除确认对话框 */
function DeleteDialog({
  open,
  viewName,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean
  viewName: string
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm" aria-describedby="delete-view-description">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription id="delete-view-description">
            确认删除视图「{viewName}」？此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
