'use client'

import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Check,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  FolderClosed,
  GripVertical,
  Network,
  Pencil,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { CopilotInlineTrigger } from '@/components/copilot/CopilotInlineTrigger'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePermissions } from '@/hooks/use-permissions'
import { useMotionPreference } from '@/hooks/use-motion-preference'
import {
  useCreateWbsNode,
  useDeleteWbsNode,
  useMoveWbsNode,
  useUpdateWbsNode,
  useWbsTree,
} from '@/hooks/use-wbs-tree'
import type { WbsNode } from '@/lib/api/wbs'
import { resolveScrollBehavior } from '@/lib/next/motion/scroll-behavior'
import { flattenVisibleWbs } from '@/lib/wbs-tree'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

type DropPosition = 'before' | 'child' | 'after'

function parseDropId(value: string): { nodeId: number; position: DropPosition } | null {
  const match = /^drop-(\d+)-(before|child|after)$/.exec(value)
  if (!match) return null
  return { nodeId: Number(match[1]), position: match[2] as DropPosition }
}

/** 边缘落点优先于整行 child 落点，形成「同级前后 / 成为子节点」两种明确语义。 */
export const wbsCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args)
  return collisions.sort((a, b) => {
    const aEdge = /-(before|after)$/.test(String(a.id)) ? 0 : 1
    const bEdge = /-(before|after)$/.test(String(b.id)) ? 0 : 1
    return aEdge - bEdge
  })
}

function DropEdge({ nodeId, position }: { nodeId: number; position: 'before' | 'after' }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-${nodeId}-${position}` })
  return (
    <span
      ref={setNodeRef}
      aria-hidden
      className={cn('absolute inset-x-0 z-10 h-2', position === 'before' ? 'top-0' : 'bottom-0')}
    >
      <span
        className={cn(
          'absolute inset-x-3 h-0.5 rounded-full bg-primary-500 opacity-0 transition-opacity',
          position === 'before' ? 'top-0' : 'bottom-0',
          isOver && 'opacity-100',
        )}
      />
    </span>
  )
}

interface WbsRowProps {
  node: WbsNode
  depth: number
  rootId: number
  projectId: number
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canMove: boolean
  onAddChild: (node: WbsNode) => void
  onToggle: (node: WbsNode) => void
  onRename: (node: WbsNode, name: string) => Promise<void>
  onDelete: (node: WbsNode) => void
}

function WbsRow({
  node,
  depth,
  rootId,
  projectId,
  canCreate,
  canUpdate,
  canDelete,
  canMove,
  onAddChild,
  onToggle,
  onRename,
  onDelete,
}: WbsRowProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(node.name)
  const childDrop = useDroppable({ id: `drop-${node.id}-child` })
  const draggable = useDraggable({
    id: `node-${node.id}`,
    disabled: !canMove || node.id === rootId,
  })
  const locked = node.id === rootId
  const taskStatus = node.task
    ? ({
        not_started: '待开始',
        in_progress: '进行中',
        completed: '已完成',
        blocked: '受阻',
        on_hold: '已暂停',
        cancelled: '已取消',
      }[node.task.status] ?? node.task.status)
    : '未关联任务'
  const schedule = node.task
    ? [node.task.startDate, node.task.endDate].filter(Boolean).join(' → ') || '未排期'
    : '—'

  const saveName = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === node.name) {
      setName(node.name)
      setEditing(false)
      return
    }
    await onRename(node, trimmed)
    setEditing(false)
  }

  return (
    <div
      ref={childDrop.setNodeRef}
      className={cn(
        'group relative flex h-[var(--row-h)] min-w-[900px] items-center border-b border-border bg-gray-0 px-3',
        'transition-colors hover:bg-gray-50',
        childDrop.isOver && 'bg-primary-50 outline outline-1 outline-primary-300',
        draggable.isDragging && 'opacity-40',
      )}
      style={{ paddingLeft: `${12 + depth * 24}px` }}
    >
      <DropEdge nodeId={node.id} position="before" />
      <DropEdge nodeId={node.id} position="after" />

      <button
        ref={draggable.setNodeRef}
        type="button"
        aria-label={locked ? '项目根节点不可移动' : `拖动 ${node.name}`}
        disabled={!canMove || locked}
        className={cn(
          'mr-1 flex h-9 w-7 items-center justify-center rounded-[var(--radius-sm)] text-gray-400',
          'hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30',
          focusRing,
        )}
        {...draggable.listeners}
        {...draggable.attributes}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <button
        type="button"
        aria-label={node.isLeaf ? `${node.name} 没有子节点` : node.collapsed ? '展开' : '折叠'}
        disabled={node.isLeaf}
        onClick={() => onToggle(node)}
        className={cn(
          'mr-1 flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-gray-500',
          'hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30',
          focusRing,
        )}
      >
        {node.collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      <span className="w-24 shrink-0 font-mono text-xs font-medium text-primary-600">
        {node.code}
      </span>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex max-w-lg items-center gap-1">
            <Input
              value={name}
              autoFocus
              aria-label="节点名称"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveName()
                if (event.key === 'Escape') {
                  setName(node.name)
                  setEditing(false)
                }
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="保存名称"
              onClick={() => void saveName()}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="取消编辑"
              onClick={() => {
                setName(node.name)
                setEditing(false)
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            {node.isLeaf ? (
              <Square className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            ) : (
              <FolderClosed className="h-4 w-4 shrink-0 text-primary-500" aria-hidden />
            )}
            <span className="truncate text-sm font-medium text-gray-800">{node.name}</span>
            {locked ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                项目根
              </span>
            ) : null}
            {node.task ? (
              <span className="truncate text-xs text-gray-500">关联任务：{node.task.name}</span>
            ) : null}
          </div>
        )}
      </div>

      <span className="flex w-56 shrink-0 items-center gap-2 truncate text-xs text-gray-600">
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
        {schedule}
      </span>
      <span className="w-24 shrink-0 text-xs text-gray-600">{taskStatus}</span>

      <div className="ml-3 flex shrink-0 items-center gap-1">
        {/* v3-copilot-inline-triggers：WBS 节点内联触发入口 */}
        <CopilotInlineTrigger
          entity={{
            entityType: 'wbs_node',
            entityId: node.id,
            label: node.name,
            projectId,
          }}
          size="icon"
          variant="ghost"
        />
        {canCreate ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`在 ${node.name} 下添加子节点`}
            onClick={() => onAddChild(node)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
        {canUpdate ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`重命名 ${node.name}`}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null}
        {canDelete && !locked ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`删除 ${node.name}`}
            onClick={() => onDelete(node)}
          >
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function WbsTree({ projectId }: { projectId: number }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const reducedMotion = useMotionPreference()
  const [draftName, setDraftName] = useState('')
  const [draftParent, setDraftParent] = useState<WbsNode | null>(null)
  const [isCreatingRoot, setIsCreatingRoot] = useState(false)
  const { can } = usePermissions()
  const tree = useWbsTree(projectId)
  const createNode = useCreateWbsNode(projectId)
  const updateNode = useUpdateWbsNode(projectId)
  const moveNode = useMoveWbsNode(projectId)
  const deleteNode = useDeleteWbsNode(projectId)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const nodes = tree.data ?? []
  const rows = useMemo(() => flattenVisibleWbs(nodes), [nodes])
  const rootId = nodes.find((node) => node.parentId === null && node.displayOrder === 0)?.id ?? -1
  const canCreate = can('wbs:create') || can('wbs:manage')
  const canUpdate = can('wbs:update') || can('wbs:manage')
  const canDelete = can('wbs:delete') || can('wbs:manage')
  const canMove = can('wbs:move') || can('wbs:manage')

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 8,
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const name = draftName.trim()
    if (!name) return
    await createNode.mutateAsync({
      name,
      ...(draftParent ? { parentId: draftParent.id } : {}),
    })
    setDraftName('')
    setDraftParent(null)
  }

  const setExpansion = async (mode: 'all' | 'level2') => {
    const changes = nodes.filter((node) => {
      if (node.isLeaf) return false
      const nextCollapsed = mode === 'level2' ? node.depth >= 2 : false
      return node.collapsed !== nextCollapsed
    })
    await Promise.all(
      changes.map((node) =>
        updateNode.mutateAsync({
          nodeId: node.id,
          input: { collapsed: mode === 'level2' ? node.depth >= 2 : false },
        }),
      ),
    )
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const sourceId = Number(String(active.id).replace('node-', ''))
    const drop = parseDropId(String(over.id))
    if (!drop || sourceId === drop.nodeId) return
    const source = nodes.find((node) => node.id === sourceId)
    const target = nodes.find((node) => node.id === drop.nodeId)
    if (!source || !target || target.path.startsWith(source.path)) return

    if (drop.position === 'child') {
      const childCount = nodes.filter((node) => node.parentId === target.id).length
      moveNode.mutate({
        nodeId: sourceId,
        input: { parentId: target.id, displayOrder: childCount },
      })
      return
    }
    moveNode.mutate({
      nodeId: sourceId,
      input: {
        parentId: target.parentId,
        displayOrder: target.displayOrder + (drop.position === 'after' ? 1 : 0),
      },
    })
  }

  if (tree.isLoading) {
    return (
      <div className="space-y-2 py-4" aria-label="正在加载 WBS">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (tree.isError) {
    return (
      <div className="my-6 flex items-center justify-between rounded-[var(--radius-md)] border border-danger bg-danger-bg p-4 text-sm text-gray-800">
        <span>WBS 加载失败，请检查网络连接后重试。</span>
        <Button variant="secondary" onClick={() => void tree.refetch()}>
          重试
        </Button>
      </div>
    )
  }

  if (!nodes.length) {
    return (
      <div ref={scrollRef} className="space-y-4 py-5">
        <EmptyState
          icon={Network}
          title="从项目目标开始拆解"
          description="建立第一层工作包后，再逐层补充交付物与任务。系统会自动维护编号和层级。"
          action={
            canCreate && !isCreatingRoot ? (
              <Button
                onClick={() => {
                  setDraftParent(null)
                  setIsCreatingRoot(true)
                  scrollRef.current?.scrollIntoView({
                    behavior: resolveScrollBehavior(reducedMotion),
                  })
                  setTimeout(() => createInputRef.current?.focus(), 0)
                }}
              >
                创建根节点
              </Button>
            ) : undefined
          }
        />
        {canCreate && isCreatingRoot ? (
          <form
            onSubmit={async (e) => {
              await submit(e)
              setIsCreatingRoot(false)
            }}
            className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-gray-50 p-3"
          >
            <CirclePlus className="h-5 w-5 text-primary-500" aria-hidden />
            <Input
              ref={createInputRef}
              className="min-w-64 flex-1"
              value={draftName}
              placeholder="添加一级工作包"
              aria-label="新 WBS 节点名称"
              onChange={(event) => setDraftName(event.target.value)}
              autoFocus
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsCreatingRoot(false)
                setDraftName('')
              }}
            >
              取消
            </Button>
            <Button type="submit" loading={createNode.isPending} disabled={!draftName.trim()}>
              添加
            </Button>
          </form>
        ) : null}
      </div>
    )
  }

  return (
    <section className="space-y-4 py-5" aria-labelledby="wbs-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="wbs-heading" className="text-lg font-semibold text-gray-800">
            工作分解结构
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            拖到节点中部成为子项，拖到上下边缘调整同级顺序。编号由系统自动维护。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void setExpansion('all')}>
            展开全部
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void setExpansion('level2')}>
            折叠到 L2
          </Button>
          <span className="text-sm text-gray-500">{nodes.length} 个节点</span>
        </div>
      </div>

      {canCreate ? (
        <form
          onSubmit={submit}
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-gray-50 p-3"
        >
          <CirclePlus className="h-5 w-5 text-primary-500" aria-hidden />
          <Input
            ref={createInputRef}
            className="min-w-64 flex-1"
            value={draftName}
            placeholder={draftParent ? `在「${draftParent.name}」下添加子节点` : '添加一级工作包'}
            aria-label="新 WBS 节点名称"
            onChange={(event) => setDraftName(event.target.value)}
          />
          {draftParent ? (
            <Button type="button" variant="ghost" onClick={() => setDraftParent(null)}>
              取消子级
            </Button>
          ) : null}
          <Button type="submit" loading={createNode.isPending} disabled={!draftName.trim()}>
            添加
          </Button>
        </form>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={wbsCollisionDetection}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
          <div className="flex h-9 min-w-[900px] items-center border-b border-border bg-gray-50 px-3 text-xs font-medium text-gray-600">
            <span className="w-20">层级</span>
            <span className="w-24">WBS 编码</span>
            <span className="flex-1">工作包 / 交付物</span>
            <span className="w-56">计划</span>
            <span className="w-24">状态</span>
            <span>操作</span>
          </div>
          <div ref={scrollRef} className="max-h-[620px] overflow-auto">
            <div
              className="relative min-w-[900px]"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]
                if (!row) return null
                return (
                  <div
                    key={row.node.id}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <WbsRow
                      node={row.node}
                      depth={row.depth}
                      rootId={rootId}
                      projectId={projectId}
                      canCreate={canCreate}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      canMove={canMove}
                      onAddChild={(node) => {
                        setDraftParent(node)
                        setDraftName('')
                      }}
                      onToggle={(node) =>
                        updateNode.mutate({
                          nodeId: node.id,
                          input: { collapsed: !node.collapsed },
                        })
                      }
                      onRename={(node, name) =>
                        updateNode.mutateAsync({ nodeId: node.id, input: { name } }).then(() => {})
                      }
                      onDelete={(node) => {
                        if (
                          window.confirm(
                            `删除「${node.name}」？其直接子节点会提升为一级节点，此操作会写入审计日志。`,
                          )
                        ) {
                          deleteNode.mutate(node.id)
                        }
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </DndContext>
    </section>
  )
}
