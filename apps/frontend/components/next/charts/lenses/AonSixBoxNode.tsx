'use client'

import * as React from 'react'
import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { AON_NODE_HEIGHT, AON_NODE_WIDTH } from '@/lib/next/charts/aon-layout'
import { cn } from '@/lib/utils'

/**
 * AON 六格节点（v3-ui-next-chart-gallery design §3.1 / tasks 3.2）。
 *
 * 标准工程项目管理六格规范，固定 200×96：
 * - 顶行：最早开始 ES（33%）| 工期 Dur（34%）| 最早完成 EF（33%）；
 * - 中行：任务名称（单行省略）+ 任务编号；
 * - 底行：最晚开始 LS（33%）| 总时差 TF（34%）| 最晚完成 LF（33%）。
 *
 * 暗黑仪器感：--nx-* 令牌 + 1px 发丝线 + 等宽数字；isCritical（总时差 0）时
 * 外框以 --nx-status-danger 2px 加粗高亮；selected 以 --nx-accent 描边。
 * 本组件为展示层：值全部来自入参 data（计算在镜头装配层），零网络、零写。
 */
export interface AonSixBoxNodeData {
  taskId: number
  name: string
  /** 里程碑（工期 0，名称前带 ◆） */
  isMilestone: boolean
  /** 工作日工期（引擎口径，里程碑 0） */
  durationDays: number
  /** 相对网络锚点的天序索引（0 = 锚点日） */
  es: number
  ef: number
  ls: number
  lf: number
  /** 总时差（工作日）；0 = 关键路径 */
  totalFloat: number
  isCritical: boolean
  /** 非选中聚焦模式下的弱化（透明度） */
  dimmed?: boolean
  /** React Flow 数据泛型要求（xyflow v12: Node<TData> 需满足 Record<string, unknown>） */
  [key: string]: unknown
}

function Cell({
  slot,
  label,
  value,
  valueClassName,
}: {
  slot: string
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div
      data-aon-slot={slot}
      className="flex min-w-0 items-center justify-center gap-1 px-1"
      title={`${label} ${value}`}
    >
      <span className="text-[9px] leading-none tracking-wide text-[var(--nx-text-muted)]">
        {label}
      </span>
      <span
        data-aon-slot-value
        className={cn(
          'truncate font-mono text-[11px] leading-none text-[var(--nx-text-primary)]',
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function AonSixBoxNodeView({
  taskId,
  name,
  isMilestone,
  durationDays,
  es,
  ef,
  ls,
  lf,
  totalFloat,
  isCritical,
  dimmed,
  selected,
}: AonSixBoxNodeData & { selected: boolean }) {
  const tfPositive = !isMilestone && totalFloat > 0
  return (
    <div
      data-aon-node
      data-task-id={taskId}
      data-critical={isCritical ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      style={{
        width: AON_NODE_WIDTH,
        height: AON_NODE_HEIGHT,
        borderColor: isCritical ? 'var(--nx-status-danger)' : 'var(--nx-border-hairline)',
        borderWidth: isCritical ? 2 : 1,
        opacity: dimmed ? 0.35 : 1,
        boxShadow: selected ? '0 0 0 1px var(--nx-accent)' : undefined,
      }}
      className={cn(
        'flex flex-col overflow-hidden rounded-[4px] border border-solid bg-[var(--nx-workspace-surface)]',
      )}
    >
      <div
        className="grid h-[26px] grid-cols-[1fr_1.15fr_1fr] divide-x divide-[var(--nx-border-hairline)]"
        data-aon-row="top"
      >
        <Cell slot="es" label="ES" value={String(es)} />
        <Cell
          slot="dur"
          label="工期"
          value={`${isMilestone ? '0' : durationDays}d`}
          valueClassName="text-[var(--nx-accent)]"
        />
        <Cell slot="ef" label="EF" value={String(ef)} />
      </div>
      <div
        data-aon-node-name
        className="flex h-full min-w-0 items-center justify-between gap-1 border-y border-[var(--nx-border-hairline)] px-2"
      >
        <span className="truncate text-[11px] font-medium leading-tight text-[var(--nx-text-primary)]">
          {isMilestone ? '◆ ' : ''}
          {name}
        </span>
        <span className="shrink-0 font-mono text-[9px] text-[var(--nx-text-muted)]">#{taskId}</span>
      </div>
      <div
        className="grid h-[26px] grid-cols-[1fr_1.15fr_1fr] divide-x divide-[var(--nx-border-hairline)]"
        data-aon-row="bottom"
      >
        <Cell slot="ls" label="LS" value={String(ls)} />
        <Cell
          slot="tf"
          label="总时差"
          value={isMilestone ? '—' : String(totalFloat)}
          valueClassName={
            tfPositive ? 'text-[var(--nx-status-warning)]' : 'text-[var(--nx-text-secondary)]'
          }
        />
        <Cell slot="lf" label="LF" value={String(lf)} />
      </div>
    </div>
  )
}

function AonSixBoxNodeComponent(props: NodeProps<AonSixBoxFlowNode>) {
  const { data, selected } = props
  return (
    <>
      {/* 不可见连接点：真实浏览器里 ResizeObserver 测量后，xyflow 按 DOM 重算连接点，
          只在 node.handles 里声明而不渲染 <Handle> 会被清空 → 全部依赖边丢失（jsdom 无测量所以测试不暴露）。 */}
      <Handle
        type="target"
        id="in"
        position={Position.Left}
        isConnectable={false}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        isConnectable={false}
        className="!pointer-events-none !opacity-0"
      />
      <AonSixBoxNodeView
        taskId={data.taskId}
        name={data.name}
        isMilestone={data.isMilestone}
        durationDays={data.durationDays}
        es={data.es}
        ef={data.ef}
        ls={data.ls}
        lf={data.lf}
        totalFloat={data.totalFloat}
        isCritical={data.isCritical}
        dimmed={data.dimmed}
        selected={selected}
      />
    </>
  )
}

export const AonSixBoxNode = memo(AonSixBoxNodeComponent)

/** AON 六格节点在 React Flow 中的完整节点类型（供 nodeTypes / NodeProps 泛型使用）。 */
export type AonSixBoxFlowNode = Node<AonSixBoxNodeData, 'aon'>

export default AonSixBoxNode
