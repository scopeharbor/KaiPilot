'use client'

import { useState, useCallback } from 'react'
import {
  useCurrentLayout,
  useSavePersonalLayout,
  useSaveSharedLayout,
  useResetLayout,
} from '@/hooks/use-organization-dashboard-layout'
import { usePermissions } from '@/hooks/use-permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES,
  ORGANIZATION_DASHBOARD_MODULE_REGISTRY,
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
  type OrganizationDashboardLayout,
  type OrganizationDashboardLayoutModuleInstance,
  type OrganizationDashboardLayoutDensity,
  type OrganizationDashboardLayoutSize,
  type OrganizationDashboardLayoutModuleKey,
} from '@aiproj/types'
import {
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Maximize,
  Minimize,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** 最大允许模块数（与后端 Validator 一致）。 */
const MAX_MODULES = 20

interface LayoutEditorProps {
  currentLayout: OrganizationDashboardLayout | null
  onClose: () => void
}

/**
 * 组织 Dashboard 布局编辑模式（v3-organization-dashboard-layout-builder §5.3）。
 *
 * 支持：模块库、模块卡片、拖拽排序（简化：上下按钮）、尺寸控制、密度控制、
 *       响应式预览、保存/取消/重置、未保存变更状态。
 */
export function OrganizationDashboardLayoutEditor({ currentLayout, onClose }: LayoutEditorProps) {
  const { canAny } = usePermissions()
  const canSaveShared = canAny(['org:member:manage'])
  const { data: layoutData } = useCurrentLayout()
  const savePersonal = useSavePersonalLayout()
  const saveShared = useSaveSharedLayout()
  const reset = useResetLayout()

  const layout = currentLayout ?? layoutData?.layout
  const initialModules = layout?.modules ?? []

  const [modules, setModules] = useState<OrganizationDashboardLayoutModuleInstance[]>(() =>
    initialModules.map((m) => ({ ...m })),
  )
  const [density, setDensity] = useState<OrganizationDashboardLayoutDensity>(
    (layout?.density as OrganizationDashboardLayoutDensity) ??
      ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE,
  )
  useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const isDirty =
    dirty ||
    density !== (layout?.density ?? ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE) ||
    JSON.stringify(modules) !== JSON.stringify(initialModules)

  /** 从模块注册表中添加模块到编辑列表。 */
  const addModule = useCallback(
    (moduleKey: OrganizationDashboardLayoutModuleKey) => {
      if (modules.length >= MAX_MODULES) return
      const registry = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[moduleKey]
      if (!registry) return
      // 计算下一个可用行
      const maxRow = modules.reduce((max, m) => Math.max(max, m.row), 0)
      setModules((prev) => [
        ...prev,
        {
          moduleKey,
          size: registry.defaultSize as OrganizationDashboardLayoutSize,
          row: maxRow + 1,
          col: 1,
        },
      ])
      setDirty(true)
    },
    [modules],
  )

  /** 从编辑列表中移除模块（不可隐藏的模块除外）。 */
  const removeModule = useCallback((index: number) => {
    setModules((prev) => {
      const mod = prev[index]
      const registry =
        ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
          mod?.moduleKey as OrganizationDashboardLayoutModuleKey
        ]
      if (registry && !registry.hideable) return prev
      return prev.filter((_, i) => i !== index)
    })
    setDirty(true)
  }, [])

  /** 上下移动模块。 */
  const moveModule = useCallback((index: number, direction: -1 | 1) => {
    setModules((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      const current = next[index]
      const other = next[target]
      if (!current || !other) return prev
      // 交换 row 值（保持 col 不变）
      next[index] = { ...current, row: other.row }
      next[target] = { ...other, row: current.row }
      return [...next].sort((a, b) => a.row - b.row || a.col - b.col)
    })
    setDirty(true)
  }, [])

  /** 修改模块尺寸。 */
  const resizeModule = useCallback((index: number, size: OrganizationDashboardLayoutSize) => {
    setModules((prev) => {
      const next = [...prev]
      const current = next[index]
      if (!current) return prev
      const registry =
        ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
          current.moduleKey as OrganizationDashboardLayoutModuleKey
        ]
      if (registry && !registry.allowedSizes.includes(size)) return prev
      next[index] = { ...current, size }
      return next
    })
    setDirty(true)
  }, [])

  /** 切换密度。 */
  const toggleDensity = useCallback(() => {
    setDensity((prev) =>
      prev === ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE
        ? ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT
        : ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE,
    )
    setDirty(true)
  }, [])

  /** 保存布局。 */
  const handleSave = useCallback(
    async (shared: boolean) => {
      setSaveError(null)
      const payload = {
        density,
        modules: modules.map((m) => ({
          moduleKey: m.moduleKey,
          size: m.size,
          row: m.row,
          col: m.col,
        })),
        expectedVersion: layout?.version,
      }
      try {
        if (shared) {
          await saveShared.mutateAsync(payload)
        } else {
          await savePersonal.mutateAsync(payload)
        }
        setDirty(false)
        setShowPreview(false)
      } catch (err: unknown) {
        setSaveError(err instanceof Error ? err.message : '保存失败，请重试')
      }
    },
    [density, modules, layout?.version, savePersonal, saveShared],
  )

  /** 重置为系统默认。 */
  const handleReset = useCallback(async () => {
    setSaveError(null)
    try {
      await reset.mutateAsync()
      setDirty(false)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : '重置失败')
    }
  }, [reset])

  /** 可用的模块——排除已在列表中且不可重复的模块。 */
  const availableModules = ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES.filter(
    (key) => !modules.some((m) => m.moduleKey === key),
  )

  return (
    <div className="space-y-4" role="region" aria-label="布局编辑器">
      {/* 工具栏 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">编辑布局</h3>
          {isDirty && (
            <Badge variant="warning" className="text-xs">
              未保存
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleDensity}
            aria-label={`切换密度：${density === 'comfortable' ? '紧凑' : '舒适'}`}
          >
            {density === 'comfortable' ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
            <span className="ml-1 text-xs">{density === 'comfortable' ? '舒适' : '紧凑'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            aria-label={showPreview ? '隐藏预览' : '预览布局'}
          >
            {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="ml-1 text-xs">预览</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={reset.isPending}
            aria-label="重置为系统默认"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="ml-1 text-xs">重置</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onClose} aria-label="取消编辑">
            <X className="h-4 w-4" />
            <span className="ml-1 text-xs">取消</span>
          </Button>
          <Button
            size="sm"
            onClick={() => handleSave(false)}
            disabled={!isDirty || savePersonal.isPending}
            aria-label="保存个人布局"
          >
            <Save className="h-4 w-4" />
            <span className="ml-1 text-xs">保存</span>
          </Button>
          {canSaveShared && (
            <Button
              size="sm"
              onClick={() => handleSave(true)}
              disabled={!isDirty || saveShared.isPending}
              aria-label="保存为组织共享布局"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="ml-1 text-xs">共享</span>
            </Button>
          )}
        </div>
      </div>

      {saveError && (
        <Alert variant="danger">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {/* 模块库（可添加的模块） */}
      <details className="rounded-lg border bg-muted/20 p-3" open>
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          可用模块（{availableModules.length}）
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {availableModules.map((key) => {
            const def = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[key]
            return (
              <Button
                key={key}
                variant="outline"
                size="sm"
                onClick={() => addModule(key)}
                disabled={modules.length >= MAX_MODULES}
                aria-label={`添加模块：${def?.displayName ?? key}`}
              >
                <Plus className="mr-1 h-3 w-3" />
                {def?.displayName ?? key}
              </Button>
            )
          })}
          {availableModules.length === 0 && (
            <p className="text-xs text-muted-foreground">所有模块已添加到布局中</p>
          )}
        </div>
      </details>

      {/* 模块编辑列表 */}
      <div className="space-y-2" role="list" aria-label="布局模块列表">
        {modules.map((mod, index) => {
          const def =
            ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
              mod.moduleKey as OrganizationDashboardLayoutModuleKey
            ]
          return (
            <div
              key={`${mod.moduleKey}-${index}`}
              role="listitem"
              className={cn(
                'flex items-center gap-3 rounded-lg border bg-card p-3 transition-shadow',
                'focus-within:ring-2 focus-within:ring-primary/20',
              )}
            >
              {/* 拖拽手柄（视觉占位） */}
              <GripVertical
                className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                aria-hidden="true"
              />

              {/* 模块信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {def?.displayName ?? mod.moduleKey}
                  </span>
                  {def && !def.hideable && (
                    <Badge variant="outline" className="text-xs">
                      必需
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    第 {mod.row} 行&nbsp;·&nbsp;第 {mod.col} 列
                  </span>
                </div>
              </div>

              {/* 尺寸选择 */}
              <select
                value={mod.size}
                onChange={(e) =>
                  resizeModule(index, e.target.value as OrganizationDashboardLayoutSize)
                }
                className="h-8 rounded border bg-background px-2 text-xs"
                aria-label={`${def?.displayName ?? mod.moduleKey} 尺寸`}
              >
                {(def?.allowedSizes ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s === 'small' ? '小' : s === 'medium' ? '中' : s === 'large' ? '大' : '全宽'}
                  </option>
                ))}
              </select>

              {/* 排序按钮 */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveModule(index, -1)}
                  disabled={index === 0}
                  className={cn('rounded p-0.5 hover:bg-muted', index === 0 && 'opacity-30')}
                  aria-label={`上移 ${def?.displayName ?? mod.moduleKey}`}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => moveModule(index, 1)}
                  disabled={index === modules.length - 1}
                  className={cn(
                    'rounded p-0.5 hover:bg-muted',
                    index === modules.length - 1 && 'opacity-30',
                  )}
                  aria-label={`下移 ${def?.displayName ?? mod.moduleKey}`}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>

              {/* 删除按钮 */}
              <button
                onClick={() => removeModule(index)}
                disabled={def && !def.hideable}
                className={cn(
                  'rounded p-1 hover:bg-destructive/10 hover:text-destructive',
                  def && !def.hideable && 'opacity-30 cursor-not-allowed',
                )}
                aria-label={
                  def && !def.hideable
                    ? `${def.displayName}不可移除`
                    : `移除 ${def?.displayName ?? mod.moduleKey}`
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}

        {modules.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            暂无模块。请从模块库中添加。
          </p>
        )}
      </div>

      {/* 预览面板 */}
      {showPreview && (
        <Card className="bg-muted/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              布局预览（{density === 'comfortable' ? '舒适' : '紧凑'}模式）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                'grid gap-3',
                density === 'compact' ? 'grid-cols-12 gap-y-1' : 'grid-cols-12',
              )}
            >
              {modules.map((mod) => {
                const colSpan =
                  mod.size === 'full'
                    ? 12
                    : mod.size === 'large'
                      ? 6
                      : mod.size === 'medium'
                        ? 4
                        : 2
                const def =
                  ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
                    mod.moduleKey as OrganizationDashboardLayoutModuleKey
                  ]
                return (
                  <div
                    key={mod.moduleKey}
                    className={cn(
                      'rounded border bg-background p-3',
                      density === 'compact' ? 'py-1.5' : '',
                      `col-span-${colSpan}`,
                    )}
                    style={{ gridColumn: `span ${colSpan}` }}
                  >
                    <p className="text-xs font-medium">{def?.displayName ?? mod.moduleKey}</p>
                    <p className="text-[10px] text-muted-foreground">
                      行 {mod.row} · 列 {mod.col} · {mod.size}
                    </p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
