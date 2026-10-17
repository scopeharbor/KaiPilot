'use client'

import { MONO_FONT_STACK } from '@/lib/next/chart-export'
import { extractKanbanMetrics, type KanbanBoardData } from '@/lib/next/share-card-metrics'

/** 看板四列微缩结构列定义（冷色调分类色板 --nx-chart-*）。 */
const KANBAN_COLUMN_DEFS = [
  { key: 'pending', label: '待处理', chartToken: 'var(--nx-chart-1)' },
  { key: 'inProgress', label: '进行中', chartToken: 'var(--nx-chart-2)' },
  { key: 'completed', label: '已完成', chartToken: 'var(--nx-chart-3)' },
  { key: 'other', label: '其他', chartToken: 'var(--nx-chart-4)' },
] as const

export interface KanbanShareCardTemplateProps {
  /** 看板四列权威任务数据（TanStack Query 缓存，RL-04）。 */
  boardData: KanbanBoardData
}

/** 单列内最多展示的任务条数，超出以「+N 项」折叠提示。 */
const MAX_COLUMN_ROWS = 3

const HUD_METRICS = [
  { key: 'totalTasks', label: '任务总数' },
  { key: 'inProgressTasks', label: '进行中' },
  { key: 'completedTasks', label: '已完成' },
  { key: 'overdueTasks', label: '逾期预警' },
  { key: 'progressRate', label: '完成率' },
] as const

/**
 * 看板分享卡数据区模板（design §5 分区架构 / spec §1200×630 分享卡模板）。
 *
 * - 四列任务微缩结构：列头（色点 + 中文列名 + 等宽计数）+ 至多 3 条任务名；
 * - 底部 HUD 度量带：任务总数 / 进行中 / 已完成 / 逾期预警 / 完成率，
 *   全部派生自 `extractKanbanMetrics` 纯函数。
 */
export function KanbanShareCardTemplate({ boardData }: KanbanShareCardTemplateProps) {
  const metrics = extractKanbanMetrics(boardData)

  return (
    <div
      data-kanban-template
      style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        {KANBAN_COLUMN_DEFS.map((column) => {
          const tasks = boardData[`${column.key}Tasks`] ?? []
          return (
            <div
              key={column.key}
              data-kanban-column
              data-kanban-column-key={column.key}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 8,
                border: '1px solid var(--nx-border-hairline)',
                backgroundColor: 'var(--nx-bg-0)',
                padding: '10px 12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  paddingBottom: 8,
                  borderBottom: '1px solid var(--nx-border-hairline)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    flexShrink: 0,
                    borderRadius: 999,
                    backgroundColor: column.chartToken,
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--nx-text-primary)' }}>
                  {column.label}
                </span>
                <span
                  data-kanban-column-count
                  style={{
                    marginLeft: 'auto',
                    fontSize: 16,
                    fontWeight: 600,
                    color: column.chartToken,
                    fontFamily: MONO_FONT_STACK,
                  }}
                >
                  {tasks.length}
                </span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tasks.slice(0, MAX_COLUMN_ROWS).map((task) => (
                  <div
                    key={task.id}
                    data-kanban-task
                    style={{
                      fontSize: 11,
                      lineHeight: '16px',
                      color: 'var(--nx-text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {task.name}
                  </div>
                ))}
                {tasks.length > MAX_COLUMN_ROWS ? (
                  <span
                    data-kanban-column-more
                    style={{
                      fontSize: 10,
                      color: 'var(--nx-text-muted)',
                      fontFamily: MONO_FONT_STACK,
                    }}
                  >
                    +{tasks.length - MAX_COLUMN_ROWS} 项
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div
        data-kanban-hud
        style={{
          display: 'flex',
          alignItems: 'stretch',
          borderRadius: 8,
          border: '1px solid var(--nx-border-hairline)',
          backgroundColor: 'var(--nx-bg-0)',
        }}
      >
        {HUD_METRICS.map((metric, index) => {
          const value =
            metric.key === 'progressRate' ? `${metrics[metric.key]}%` : String(metrics[metric.key])
          return (
            <div
              key={metric.key}
              data-kanban-metric={metric.key}
              data-metric={metric.key}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '10px 4px',
                ...(index > 0 ? { borderLeft: '1px solid var(--nx-border-hairline)' } : {}),
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--nx-text-muted)' }}>{metric.label}</span>
              <span
                data-kanban-metric-value
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: 'var(--nx-text-primary)',
                  fontFamily: MONO_FONT_STACK,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default KanbanShareCardTemplate
