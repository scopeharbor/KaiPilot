'use client'

import * as React from 'react'
import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react'
import type { Edge, EdgeProps } from '@xyflow/react'
import type { DependencyType } from '@/lib/api/dependencies'
import { cn } from '@/lib/utils'

/**
 * AON 自定义依赖边（v3-ui-next-chart-gallery design §3.1 / tasks 3.2）。
 *
 * - 平滑阶梯折线（SmoothStep）；普通边冷灰半透明（--nx-text-muted + 透明度），
 *   关键路径边（引擎判定）以 --nx-status-danger 2px 贯穿高亮，选中节点直接
 *   邻接边以 --nx-accent 高亮，非邻接边弱化（focus='dim'）；
 * - 连线上方渲染胶囊依赖标签：FS / FS+2d / SS / FF-1d / SF+2d（design：缩写+滞后量）；
 * - 无流光动效（animated=false），精确档（precise）零差异；纯展示零网络。
 */
export interface AonDependencyEdgeData {
  predecessorId: number
  successorId: number
  type: DependencyType
  lagDays: number
  /** CPM 引擎判定：关键依赖 */
  isCritical: boolean
  /** 选中聚焦态：idle=无选中 / active=选中节点直接邻接 / dim=其余弱化 */
  focus: 'idle' | 'active' | 'dim'
  /** React Flow 数据泛型要求（xyflow v12: Edge<TData> 需满足 Record<string, unknown>） */
  [key: string]: unknown
}

/** FS/SS/FF/SF + 滞后量 → 边胶囊标签（如 FS、SS+2d、FF-1d）。 */
export function formatAonDependencyLabel(type: DependencyType, lagDays: number): string {
  const upper = type.toUpperCase()
  if (!lagDays) return upper
  return `${upper}${lagDays > 0 ? '+' : ''}${lagDays}d`
}

function AonDependencyEdgeComponent(props: EdgeProps<AonDependencyFlowEdge>) {
  const d = props.data as AonDependencyEdgeData
  const id = props.id
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  })

  const dimmed = d.focus === 'dim'
  const active = d.focus === 'active'
  const strokeColor = active
    ? 'var(--nx-accent)'
    : d.isCritical
      ? 'var(--nx-status-danger)'
      : 'var(--nx-text-muted)'

  return (
    <g
      data-aon-edge
      data-edge-id={id}
      data-type={d.type}
      data-lag={d.lagDays}
      data-critical={d.isCritical ? 'true' : 'false'}
      data-focus={d.focus}
    >
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        style={{
          stroke: strokeColor,
          strokeWidth: active || d.isCritical ? 2 : 1.4,
          strokeOpacity: dimmed ? 0.08 : active || d.isCritical ? 1 : 0.45,
        }}
      />
      {!dimmed ? (
        <EdgeLabelRenderer>
          <div
            data-aon-edge-label
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              opacity: d.focus === 'idle' || active ? 1 : 0.45,
            }}
            className={cn(
              'pointer-events-none absolute z-10 whitespace-nowrap rounded-[3px] border px-1 py-px font-mono text-[9px] leading-tight',
              'nodrag nopan bg-[var(--nx-workspace-surface)]',
              d.isCritical
                ? 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
                : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
            )}
          >
            {formatAonDependencyLabel(d.type, d.lagDays)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  )
}

export const AonDependencyEdge = memo(AonDependencyEdgeComponent)

/** AON 依赖边在 React Flow 中的完整边类型（供 edgeTypes / EdgeProps 泛型使用）。 */
export type AonDependencyFlowEdge = Edge<AonDependencyEdgeData, 'aon'>

export default AonDependencyEdge
