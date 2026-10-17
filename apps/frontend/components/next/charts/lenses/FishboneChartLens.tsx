'use client'

import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import type { DiagramSpec, FishboneCategory, FishboneCauseNode, FishboneData } from '@aiproj/types'
import { listDiagrams, createDiagram, updateDiagram } from '@/lib/api/diagrams'
import { DIAGRAM_QUERY_KEYS } from '@/lib/api/diagram-query-keys'
import { usePermissions } from '@/hooks/use-permissions'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'

/**
 * 鱼骨图 / 因果分析镜头（v3-ui-next-chart-gallery design §3.6 / tasks 3.5-3.6）。
 *
 * - 呈现：水平主脊椎 + 右侧核心问题（Effect）+ 6M 大骨（人/机/料/法/测/环）上下
 *   斜向展开，原因中骨/小骨以确定性几何（纯函数 `layoutFishbone`）沿大骨排布；
 * - 受控编辑：修改核心问题、在大骨下新增/改名/删除原因（支持小骨层级）、
 *   撤销/重做、重置为初始模板；编辑权限按 `diagram:manage` 展示层门禁
 *   （服务端 DiagramPolicy 为权威）；
 * - 持久化：Diagram 实体 `type:'fishbone'` —— 无记录 POST 新建、有记录 PATCH 更新，
 *   保存成功 Toast「鱼骨图已保存」并即时刷新查询缓存，重载完整回显（tasks 3.6）；
 * - 只读三态：加载骨架 / 错误重试 / 就绪画布。
 */

export const FISHBONE_CANVAS_WIDTH = 1480
export const FISHBONE_CANVAS_HEIGHT = 760
export const FISHBONE_SPINE_Y = 380
/** 单条大骨最多可视槽位数（超出折叠为「+N 项」徽标） */
export const FISHBONE_ITEMS_CAP = 10
const BONE_DX = 176
const BONE_DY = 150
const UNDO_CAP = 60

// ---------------------------------------------------------------------------
// 默认 6M 模板 + 纯几何布局
// ---------------------------------------------------------------------------

/** 经典 6M 大骨模板（人/机/料/法/测/环）。 */
export function createDefaultFishboneCategories(): FishboneCategory[] {
  return [
    { key: 'manpower', label: '人员 Manpower', causes: [] },
    { key: 'machinery', label: '机器 Machinery', causes: [] },
    { key: 'material', label: '物料 Material', causes: [] },
    { key: 'method', label: '方法 Method', causes: [] },
    { key: 'measurement', label: '测量 Measurement', causes: [] },
    { key: 'environment', label: '环境 Environment', causes: [] },
  ]
}

export function createDefaultFishboneData(): FishboneData {
  return { effect: '', categories: createDefaultFishboneCategories() }
}

let causeSeq = 0
export function nextCauseId(): string {
  causeSeq += 1
  return `c-${causeSeq}`
}

export interface FishboneItemLayout {
  id: string
  label: string
  /** 0 = 原因中骨；1 = 小骨 */
  depth: number
  /** 槽位（引线锚点，在大骨线上） */
  ribX: number
  ribY: number
  /** 原因标签中心（沿大骨外法线外展） */
  x: number
  y: number
  width: number
}

export interface FishboneBoneLayout {
  key: string
  label: string
  categoryIndex: number
  side: 'above' | 'below'
  /** 大骨在脊椎上的锚点 */
  anchorX: number
  tipX: number
  tipY: number
  /** 大骨名标签中心 */
  labelX: number
  labelY: number
  items: FishboneItemLayout[]
  /** 被折叠（超出可视槽位）的项数 */
  overflow: number
}

export interface FishboneLayoutResult {
  bones: FishboneBoneLayout[]
  /** 脊椎两端 */
  spine: { x1: number; x2: number }
  /** 核心问题（Effect）面板矩形 */
  effect: { x: number; y: number; width: number; height: number }
}

/** 递归摊平原因树（中骨 → 小骨一层），保留层级供样式区分。 */
function flattenCauses(
  causes: FishboneCauseNode[],
): { id: string; label: string; depth: number }[] {
  const items: { id: string; label: string; depth: number }[] = []
  for (const cause of causes) {
    items.push({ id: cause.id, label: cause.label, depth: 0 })
    for (const child of cause.children ?? []) {
      items.push({ id: child.id, label: child.label, depth: 1 })
    }
  }
  return items
}

/**
 * 纯函数几何：给定 6M/自定义分类数据，输出每条大骨的锚点/名称位与原因槽位坐标。
 * 槽位沿大骨按等分分布，奇偶槽两行垂直于骨线外展（确定性、无 DOM 依赖）。
 */
export function layoutFishbone(data: FishboneData): FishboneLayoutResult {
  const n = data.categories.length
  const spineEndX = FISHBONE_CANVAS_WIDTH - 224
  const maxAnchorX = spineEndX - 24
  const minAnchorX = 260
  const step = n > 1 ? Math.min(196, (maxAnchorX - minAnchorX) / (n - 1)) : 0

  const bones: FishboneBoneLayout[] = data.categories.map((category, index) => {
    const anchorX = n > 1 ? minAnchorX + index * step : (minAnchorX + maxAnchorX) / 2
    const side: 'above' | 'below' = index % 2 === 0 ? 'above' : 'below'
    const tipX = anchorX - BONE_DX
    const tipY = side === 'above' ? FISHBONE_SPINE_Y - BONE_DY : FISHBONE_SPINE_Y + BONE_DY

    const flat = flattenCauses(category.causes).slice(0, FISHBONE_ITEMS_CAP)
    const overflow = Math.max(0, flattenCauses(category.causes).length - FISHBONE_ITEMS_CAP)
    const slotCount = flat.length + 1 // +1 = 预留「添加要因」的槽位余量

    const length = Math.sqrt(BONE_DX * BONE_DX + BONE_DY * BONE_DY)
    // 大骨方向（由脊椎锚点指向骨梢）
    const dirX = -BONE_DX / length
    const dirY = (side === 'above' ? -BONE_DY : BONE_DY) / length
    // 朝外法线（远离脊椎一侧）：above → 右上；below → 右下
    const normalX = BONE_DY / length
    const normalY = side === 'above' ? -BONE_DX / length : BONE_DX / length

    const items: FishboneItemLayout[] = flat.map((item, k) => {
      const along = ((k + 1) / (slotCount + 1)) * length
      const px = anchorX + dirX * along
      const py = FISHBONE_SPINE_Y + dirY * along
      // 奇偶槽两行外展（row0 24px / row1 62px…），行距避免同骨标签重叠
      const row = Math.floor(k / 2)
      const perpOffset = 24 + row * 38
      const alongSpacing = length / (slotCount + 1)
      const chipWidth = Math.min(132, Math.max(40, Math.round(alongSpacing * 2 * 0.92)))
      return {
        id: item.id,
        label: item.label,
        depth: item.depth,
        ribX: px,
        ribY: py,
        x: px + normalX * perpOffset,
        y: py + normalY * perpOffset,
        width: chipWidth,
      }
    })

    return {
      key: category.key,
      label: category.label,
      categoryIndex: index,
      side,
      anchorX,
      tipX,
      tipY,
      labelX: anchorX - BONE_DX - 62,
      labelY: side === 'above' ? tipY - 30 : tipY + 30,
      items,
      overflow,
    }
  })

  return {
    bones,
    spine: { x1: 64, x2: spineEndX },
    effect: {
      x: spineEndX + 12,
      y: FISHBONE_SPINE_Y - 84,
      width: FISHBONE_CANVAS_WIDTH - spineEndX - 24,
      height: 168,
    },
  }
}

// ---------------------------------------------------------------------------
// DiagramSpec 打包（与 packages/types diagram-spec 契约一致，tasks 3.6）
// ---------------------------------------------------------------------------

export function buildFishboneDiagramSpec(data: FishboneData, projectId: number): DiagramSpec {
  const effect = data.effect.trim().length > 0 ? data.effect.trim() : '待定义问题'
  return {
    version: '1.0',
    type: 'fishbone',
    title: `鱼骨图：${effect.slice(0, 48)}`,
    data: { ...data, effect },
    metadata: {
      generatedBy: 'user',
      generatedAt: new Date().toISOString(),
      sourceProjectId: projectId,
    },
    exports: {
      mermaid: { supported: false, limitations: ['鱼骨图 v1 暂不支持 Mermaid 单向导出'] },
    },
  }
}

// ---------------------------------------------------------------------------
// 数据操作辅助（不可变更新）
// ---------------------------------------------------------------------------

function updateCategories(
  data: FishboneData,
  categoryKey: string,
  updater: (causes: FishboneCauseNode[]) => FishboneCauseNode[],
): FishboneData {
  return {
    ...data,
    categories: data.categories.map((category) =>
      category.key === categoryKey ? { ...category, causes: updater(category.causes) } : category,
    ),
  }
}

function updateCauseIn(
  causes: FishboneCauseNode[],
  causeId: string,
  updater: (cause: FishboneCauseNode) => FishboneCauseNode,
): FishboneCauseNode[] {
  return causes.map((cause) => {
    if (cause.id === causeId) return updater(cause)
    if ((cause.children?.length ?? 0) > 0) {
      return { ...cause, children: updateCauseIn(cause.children ?? [], causeId, updater) }
    }
    return cause
  })
}

function removeCauseIn(causes: FishboneCauseNode[], causeId: string): FishboneCauseNode[] {
  const without = causes.filter((cause) => cause.id !== causeId)
  return without.map((cause) =>
    (cause.children?.length ?? 0) > 0
      ? { ...cause, children: removeCauseIn(cause.children ?? [], causeId) }
      : cause,
  )
}

// ---------------------------------------------------------------------------
// 镜头
// ---------------------------------------------------------------------------

export interface FishboneChartLensProps {
  projectId: number
}

export function FishboneChartLens({ projectId }: FishboneChartLensProps) {
  const mobile = useMobileWorkspace()
  const { can } = usePermissions()
  const canEdit = can('diagram:manage')

  const [data, setData] = useState<FishboneData>(() => createDefaultFishboneData())
  const [past, setPast] = useState<FishboneData[]>([])
  const [future, setFuture] = useState<FishboneData[]>([])
  const [dirty, setDirty] = useState(false)
  const [diagramId, setDiagramId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [effectDraft, setEffectDraft] = useState('')
  const [resetArmed, setResetArmed] = useState(false)
  const [resetLabel, setResetLabel] = useState('重置为初始模板')
  const hydratedOnce = useRef(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const queryClient = useQueryClient()
  const listKey = useMemo(
    () => DIAGRAM_QUERY_KEYS.list(projectId, { type: 'fishbone' }),
    [projectId],
  )

  const fishboneQuery = useQuery({
    queryKey: listKey,
    queryFn: () => listDiagrams(projectId, { type: 'fishbone' }),
    enabled: projectId > 0,
    staleTime: 30_000,
  })

  // 已存版本回显（仅首次成功载入应用一次；其后查询刷新不覆盖本地编辑）。
  useEffect(() => {
    const records = fishboneQuery.data?.data ?? []
    const existing = records.find((record) => record.type === 'fishbone')
    if (!existing || hydratedOnce.current) return
    const spec = existing.spec as DiagramSpec
    const saved = spec?.data as FishboneData | undefined
    if (!saved || typeof saved !== 'object' || !Array.isArray(saved.categories)) return
    hydratedOnce.current = true
    setDiagramId(existing.id)
    setData({ effect: saved.effect ?? '', categories: saved.categories })
    setEffectDraft(saved.effect ?? '')
    setPast([])
    setFuture([])
    setDirty(false)
  }, [fishboneQuery.data])

  // 首次载入（无已存记录）时的 effect 草稿初始值
  useEffect(() => {
    if (hydratedOnce.current) return
    if (fishboneQuery.data && !fishboneQuery.isPending) {
      setEffectDraft((draft) => (draft.length > 0 ? draft : data.effect))
      if (!hydratedOnce.current && (fishboneQuery.data?.data ?? []).length === 0) {
        hydratedOnce.current = true
      }
    }
  }, [fishboneQuery.data, fishboneQuery.isPending, data.effect])

  const commitChange = useCallback(
    (next: FishboneData) => {
      setPast((history) => [...history.slice(-(UNDO_CAP - 1)), data])
      setFuture([])
      setData(next)
      setDirty(true)
    },
    [data],
  )

  const handleUndo = useCallback(() => {
    if (past.length === 0) return
    const previous = past[past.length - 1]!
    setFuture((redo) => [...redo.slice(-(UNDO_CAP - 1)), data])
    setPast((history) => history.slice(0, -1))
    setData(previous)
    setDirty(true)
  }, [past, data])

  const handleRedo = useCallback(() => {
    if (future.length === 0) return
    const next = future[future.length - 1]!
    setPast((history) => [...history.slice(-(UNDO_CAP - 1)), data])
    setFuture((redo) => redo.slice(0, -1))
    setData(next)
    setDirty(true)
  }, [future, data])

  const handleReset = useCallback(() => {
    if (!resetArmed) {
      setResetArmed(true)
      setResetLabel('再次点击确认重置')
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => {
        setResetArmed(false)
        setResetLabel('重置为初始模板')
      }, 4000)
      return
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setResetArmed(false)
    setResetLabel('重置为初始模板')
    const next: FishboneData = { ...createDefaultFishboneData(), effect: data.effect }
    commitChange(next)
    setEffectDraft(data.effect)
    toast({ variant: 'info', title: '已重置为初始 6M 模板' })
  }, [resetArmed, data, commitChange])

  const handleAddCause = useCallback(
    (categoryKey: string) => {
      const newId = nextCauseId()
      commitChange(
        updateCategories(data, categoryKey, (causes) => [
          ...causes,
          { id: newId, label: '新要因', children: [] },
        ]),
      )
      setEditingId(newId)
    },
    [data, commitChange],
  )

  const handleRenameCause = useCallback(
    (causeId: string, label: string) => {
      const trimmed = label.trim()
      if (!trimmed) return
      commitChange({
        ...data,
        categories: data.categories.map((category) => ({
          ...category,
          causes: updateCauseIn(category.causes, causeId, (cause) => ({
            ...cause,
            label: trimmed,
          })),
        })),
      })
      setEditingId(null)
    },
    [data, commitChange],
  )

  const handleDeleteCause = useCallback(
    (causeId: string) => {
      commitChange({
        ...data,
        categories: data.categories.map((category) => ({
          ...category,
          causes: removeCauseIn(category.causes, causeId),
        })),
      })
      setEditingId((current) => (current === causeId ? null : current))
    },
    [data, commitChange],
  )

  const handleAddSubCause = useCallback(
    (causeId: string) => {
      const newId = nextCauseId()
      const withSub: FishboneData = {
        ...data,
        categories: data.categories.map((category) => ({
          ...category,
          causes: updateCauseIn(category.causes, causeId, (cause) => ({
            ...cause,
            children: [...(cause.children ?? []), { id: newId, label: '新小骨', children: [] }],
          })),
        })),
      }
      commitChange(withSub)
      setEditingId(newId)
    },
    [data, commitChange],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const spec = buildFishboneDiagramSpec(data, projectId)
      if (diagramId === null) {
        const response = await createDiagram(projectId, {
          type: 'fishbone',
          title: spec.title,
          spec,
        })
        return response.data.id
      }
      await updateDiagram(diagramId, { title: spec.title, spec })
      return diagramId
    },
    onSuccess: (id) => {
      setDiagramId(id)
      setDirty(false)
      toast({ variant: 'success', title: '鱼骨图已保存' })
      void queryClient.invalidateQueries({ queryKey: DIAGRAM_QUERY_KEYS.all })
    },
    onError: () => {
      toast({ variant: 'error', title: '鱼骨图保存失败，请稍后重试' })
    },
  })

  const handleSave = useCallback(() => {
    saveMutation.mutate()
  }, [saveMutation])

  const layout = useMemo(() => layoutFishbone(data), [data])
  const saving = saveMutation.isPending

  // ------------------------------------------------------------------ 三态

  if (fishboneQuery.isPending) {
    return (
      <div
        data-fishbone-loading
        role="status"
        aria-busy="true"
        aria-label="正在加载鱼骨图"
        className="flex h-full min-h-96 flex-1 animate-pulse flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3].map((button) => (
            <div
              key={button}
              className="h-8 w-24 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
            />
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
          <div className="flex w-3/4 flex-col gap-5">
            <div className="h-0.5 w-full bg-[var(--nx-border-hairline)]" />
            <div className="flex justify-between">
              {[0, 1, 2, 3, 4, 5].map((bone) => (
                <div key={bone} className="flex flex-col gap-3">
                  {[0, 1, 2].map((chip) => (
                    <div
                      key={chip}
                      className="h-5 w-24 rounded-sm bg-[var(--nx-workspace-surface)]"
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (fishboneQuery.isError) {
    return (
      <div
        data-fishbone-error
        role="alert"
        aria-label="鱼骨图加载失败"
        className="mx-auto flex h-full min-h-72 max-w-md flex-col items-center justify-center gap-3 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-sm font-medium text-[var(--nx-text-primary)]">鱼骨图数据加载失败</p>
        <p className="text-xs text-[var(--nx-text-muted)]">
          已保存的鱼骨图暂时无法读取，请稍后重试。
        </p>
        <button
          type="button"
          data-fishbone-retry
          onClick={() => void fishboneQuery.refetch()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          重新加载
        </button>
      </div>
    )
  }

  // ------------------------------------------------------------------ 编辑工具条

  return (
    <div
      data-fishbone-lens
      data-can-edit={canEdit ? 'true' : 'false'}
      className="flex h-full min-h-[60vh] flex-1 flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--nx-border-hairline)] pb-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-fishbone-undo
            disabled={!canEdit || past.length === 0 || saving}
            onClick={handleUndo}
            aria-label="撤销"
            title="撤销（Ctrl+Z）"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            data-fishbone-redo
            disabled={!canEdit || future.length === 0 || saving}
            onClick={handleRedo}
            aria-label="重做"
            title="重做"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          data-fishbone-reset
          disabled={!canEdit || saving}
          onClick={handleReset}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            resetArmed
              ? 'border-[var(--nx-status-danger)] bg-[var(--nx-status-danger)]/10 text-[var(--nx-status-danger)]'
              : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
          )}
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          {resetLabel}
        </button>

        {!canEdit ? (
          <span
            data-fishbone-readonly-note
            className="inline-flex items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-[10px] text-[var(--nx-text-muted)]"
          >
            <Lock className="h-3 w-3" aria-hidden />无 diagram:manage 权限，当前为只读浏览
          </span>
        ) : (
          <span
            data-fishbone-dirty
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px]',
              dirty
                ? 'bg-[var(--nx-status-warning)]/10 text-[var(--nx-status-warning)]'
                : 'text-[var(--nx-text-muted)]',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                dirty ? 'bg-[var(--nx-status-warning)]' : 'bg-[var(--nx-text-muted)]',
              )}
              aria-hidden
            />
            {dirty ? '存在未保存更改' : '已与服务器同步'}
          </span>
        )}

        <button
          type="button"
          data-fishbone-save
          disabled={!canEdit || saving}
          onClick={handleSave}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--nx-accent)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] hover:bg-[var(--nx-accent)]/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          {saving ? '保存中…' : '保存鱼骨图'}
        </button>
      </div>

      {mobile ? (
        <div data-mobile-fishbone className="space-y-4">
          <label className="block text-sm">
            分析问题
            <input
              value={effectDraft}
              disabled={!canEdit}
              onChange={(event) => setEffectDraft(event.target.value)}
              onBlur={() => {
                if (effectDraft !== data.effect) {
                  setData((current) => ({ ...current, effect: effectDraft }))
                  setDirty(true)
                }
              }}
              className="mt-2 min-h-11 w-full rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3"
            />
          </label>
          {layout.bones.map((bone) => (
            <section
              key={bone.key}
              className="rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
            >
              <h3 className="mb-2 text-base font-medium">{bone.label}</h3>
              {bone.items.map((item) => (
                <div key={item.id} className="mb-2" style={{ paddingLeft: item.depth * 12 }}>
                  {editingId === item.id && canEdit ? (
                    <CauseEditor
                      inline
                      defaultValue={item.label}
                      onSave={(label) => handleRenameCause(item.id, label)}
                      onDelete={() => handleDeleteCause(item.id)}
                      onCancel={() => setEditingId(null)}
                      onAddSub={() => handleAddSubCause(item.id)}
                      allowSub={item.depth === 0}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setEditingId(item.id)}
                      className="min-h-11 w-full break-words rounded-lg border border-[var(--nx-border-hairline)] px-3 text-left text-sm"
                    >
                      {item.label}
                    </button>
                  )}
                </div>
              ))}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => handleAddCause(bone.key)}
                  className="min-h-11 w-full rounded-lg border border-dashed border-[var(--nx-border-focus)] px-3 text-sm text-[var(--nx-accent)]"
                >
                  ＋ 添加要因
                </button>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
          <div
            data-fishbone-canvas
            className="relative"
            style={{ width: FISHBONE_CANVAS_WIDTH, height: FISHBONE_CANVAS_HEIGHT }}
          >
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${FISHBONE_CANVAS_WIDTH} ${FISHBONE_CANVAS_HEIGHT}`}
              aria-hidden="true"
            >
              {/* 主脊椎 */}
              <line
                data-fishbone-spine
                x1={layout.spine.x1}
                y1={FISHBONE_SPINE_Y}
                x2={layout.spine.x2}
                y2={FISHBONE_SPINE_Y}
                stroke="var(--nx-border-focus)"
                strokeWidth={3}
              />
              {/* 大骨与原因引线 */}
              {layout.bones.map((bone) => (
                <g key={bone.key}>
                  <line
                    data-fishbone-bone={bone.key}
                    x1={bone.anchorX}
                    y1={FISHBONE_SPINE_Y}
                    x2={bone.tipX}
                    y2={bone.tipY}
                    stroke="var(--nx-text-muted)"
                    strokeWidth={1.5}
                    opacity={0.75}
                  />
                  {bone.items.map((item) => (
                    <line
                      key={`rib-${item.id}`}
                      x1={item.ribX}
                      y1={item.ribY}
                      x2={item.x}
                      y2={item.y}
                      stroke="var(--nx-border-focus)"
                      strokeWidth={1}
                    />
                  ))}
                </g>
              ))}
            </svg>

            {/* 核心问题（Effect）编辑面板 */}
            <div
              data-fishbone-effect-panel
              className="absolute rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] p-3"
              style={{
                left: layout.effect.x,
                top: layout.effect.y,
                width: layout.effect.width,
                height: layout.effect.height,
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-accent)]">
                核心问题 · Effect
              </p>
              {canEdit ? (
                <input
                  data-fishbone-effect
                  value={effectDraft}
                  onChange={(event) => setEffectDraft(event.target.value)}
                  onBlur={() => {
                    if (effectDraft !== data.effect) {
                      setData((current) => ({ ...current, effect: effectDraft }))
                      setDirty(true)
                    }
                  }}
                  placeholder="输入本次要分析的核心问题 / 目标效果…"
                  className="mt-2 h-16 w-full rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-sm leading-snug text-[var(--nx-text-primary)] outline-none transition-colors placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)]"
                />
              ) : (
                <p
                  data-fishbone-effect
                  className="mt-2 min-h-16 whitespace-pre-wrap break-words text-sm leading-snug text-[var(--nx-text-primary)]"
                >
                  {data.effect || '（未定义核心问题）'}
                </p>
              )}
            </div>

            {/* 大骨名称标签 + 原因槽位 */}
            {layout.bones.map((bone) => (
              <div key={bone.key}>
                <div
                  data-fishbone-category={bone.key}
                  data-category-label={bone.label}
                  className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--nx-text-secondary)]"
                  style={{ left: bone.labelX, top: bone.labelY }}
                >
                  {bone.label}
                </div>
                {bone.items.map((item) => {
                  const editing = editingId === item.id
                  return (
                    <div
                      key={item.id}
                      data-fishbone-cause
                      data-cause-id={item.id}
                      data-cause-depth={item.depth}
                      data-category-key={bone.key}
                      data-editing={editing ? 'true' : 'false'}
                      className="absolute"
                      style={{ left: item.x, top: item.y }}
                    >
                      {editing && canEdit ? (
                        <CauseEditor
                          defaultValue={item.label}
                          onSave={(label) => handleRenameCause(item.id, label)}
                          onDelete={() => handleDeleteCause(item.id)}
                          onCancel={() => setEditingId(null)}
                          onAddSub={() => handleAddSubCause(item.id)}
                          allowSub={item.depth === 0}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => canEdit && setEditingId(item.id)}
                          title={item.label}
                          className={cn(
                            'flex h-[26px] -translate-x-1/2 -translate-y-1/2 items-center gap-1 overflow-hidden rounded-[3px] border px-1.5 text-left text-[10px] leading-none transition-colors',
                            item.depth === 0
                              ? 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]'
                              : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
                            canEdit && 'hover:border-[var(--nx-accent)]',
                          )}
                          style={{ width: item.width }}
                        >
                          <span className="truncate">{item.label}</span>
                          {item.depth === 1 ? (
                            <span className="shrink-0 text-[8px] text-[var(--nx-text-muted)]">
                              小骨
                            </span>
                          ) : null}
                        </button>
                      )}
                    </div>
                  )
                })}

                {bone.overflow > 0 ? (
                  <div
                    data-fishbone-cause-overflow
                    data-category-key={bone.key}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-dashed border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-muted)]"
                    style={{
                      left: bone.tipX - 40,
                      top: bone.side === 'above' ? bone.tipY - 58 : bone.tipY + 58,
                    }}
                  >
                    …+{bone.overflow} 项
                  </div>
                ) : null}

                {canEdit ? (
                  <button
                    type="button"
                    data-fishbone-add-cause
                    data-category-key={bone.key}
                    aria-label={`在 ${bone.label} 下添加要因`}
                    onClick={() => handleAddCause(bone.key)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-dashed border-[var(--nx-border-focus)] px-1.5 py-0.5 text-[10px] text-[var(--nx-accent)] transition-colors hover:bg-[var(--nx-accent)]/10"
                    style={{
                      left: bone.side === 'above' ? bone.tipX - 20 : bone.tipX + 20,
                      top: bone.side === 'above' ? bone.tipY - 34 : bone.tipY + 34,
                    }}
                  >
                    <Plus className="inline h-3 w-3" aria-hidden /> 要因
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
      <p data-fishbone-hint className="text-[10px] text-[var(--nx-text-muted)]">
        六类大骨：人员 / 机器 / 物料 / 方法 / 测量 / 环境。点击原因槽可重命名、删除或追加小骨；
        保存后以 Diagram 实体（type: fishbone）持久化，重新进入自动回显。
      </p>
    </div>
  )
}

function CauseEditor({
  inline = false,
  defaultValue,
  onSave,
  onDelete,
  onCancel,
  onAddSub,
  allowSub,
}: {
  inline?: boolean
  defaultValue: string
  onSave: (label: string) => void
  onDelete: () => void
  onCancel: () => void
  onAddSub: () => void
  allowSub: boolean
}) {
  const [draft, setDraft] = useState(defaultValue)
  return (
    <div
      data-fishbone-cause-editor
      className={cn(
        'rounded-md border border-[var(--nx-accent)] bg-[var(--nx-workspace-surface)] p-2 shadow-lg',
        !inline && '-translate-x-1/2 -translate-y-1/2',
      )}
    >
      <input
        data-fishbone-cause-input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSave(draft)
          if (event.key === 'Escape') onCancel()
        }}
        className="h-7 w-full rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)]"
      />
      <div className="mt-1.5 flex items-center gap-1">
        <button
          type="button"
          data-fishbone-cause-save
          onClick={() => onSave(draft)}
          aria-label="保存原因"
          className="flex h-6 w-6 items-center justify-center rounded border border-[var(--nx-border-focus)] text-[var(--nx-accent)] transition-colors hover:bg-[var(--nx-accent)]/10"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
        {allowSub ? (
          <button
            type="button"
            data-fishbone-add-subcause
            onClick={onAddSub}
            aria-label="添加小骨"
            title="添加小骨"
            className="flex h-6 w-6 items-center justify-center rounded border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-accent)] hover:text-[var(--nx-accent)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          data-fishbone-cause-delete
          onClick={onDelete}
          aria-label="删除原因"
          className="flex h-6 w-6 items-center justify-center rounded border border-[var(--nx-status-danger)]/40 text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)]/10"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          data-fishbone-cause-cancel
          onClick={onCancel}
          aria-label="取消"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export default FishboneChartLens
