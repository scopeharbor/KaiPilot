'use client'

/**
 * 全域时间主轴节点悬停明细卡与深链穿透组件
 * (v3-ui-next-batch3-global-convergence W3 任务 3.5 / spec「节点悬停明细与深链下钻」).
 *
 * 规范：
 * 1. 悬停/键盘聚焦任意节点时，在节点正上方浮现暗黑仪器感悬停明细卡；
 * 2. 展示所属项目名称（含项目色彩微标）、标题、事件类型、计划起止日期、当前状态、责任人与工期进度；
 * 3. 穿透点击：
 *    - 若为任务节点，直达 `/next/projects/:projectId?focusTask=:taskId` 并展开详情抽屉；
 *    - 若为里程碑，直达 `/next/projects/:projectId?lens=timeline` 并高亮聚焦该里程碑；
 * 4. 键盘无障碍支持：Enter / Space 触发穿透导航；
 * 5. 精确档（precise）纯平降级：去除投影光晕，采用 1px 实线边框。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Calendar, Clock, User } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import type { GlobalTimelineNode } from '@/lib/next/global-timeline-composer'
import { cn } from '@/lib/utils'

export interface GlobalTimelineHoverCardProps {
  node: GlobalTimelineNode
  children: React.ReactNode
  /** 自定义导航行为，默认调用 router.push */
  onNavigate?: (url: string) => void
  /** 是否受控强制展开（用于测试或高亮） */
  isOpen?: boolean
  className?: string
}

export function GlobalTimelineHoverCard({
  node,
  children,
  onNavigate,
  isOpen: controlledIsOpen,
  className,
}: GlobalTimelineHoverCardProps) {
  let router: ReturnType<typeof useRouter> | null = null
  try {
    router = useRouter()
  } catch {
    // Fallback when rendered outside Next.js App Router
  }
  const tier = useImmersionTier()
  const isPrecise = tier === 'precise'

  const [isHovered, setIsHovered] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = React.useState<{
    left: number
    top: number
    above: boolean
  } | null>(null)

  const isOpen = controlledIsOpen ?? (isHovered || isFocused)

  // 浮层渲染到 body 并按触发点的屏幕位置定位：时间主轴容器 overflow-hidden，原先的
  // absolute 浮层被裁掉上半截、剩下的压在「今天」标签上看不清（实测）。
  // 上方放得下就放上方，否则放下方；左右夹在窗口内。
  const CARD_WIDTH = 256
  const CARD_HEIGHT = 190
  React.useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || typeof window === 'undefined') return
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect()
      const above = rect.top > CARD_HEIGHT + 12
      const left = Math.min(
        Math.max(8, rect.left + rect.width / 2 - CARD_WIDTH / 2),
        window.innerWidth - CARD_WIDTH - 8,
      )
      setPosition({ left, top: above ? rect.top - 8 : rect.bottom + 8, above })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [isOpen])

  // 从触发点移到卡片上时稍等再关，卡片里的按钮才点得到
  const openHover = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setIsHovered(true)
  }
  const closeHoverSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setIsHovered(false), 120)
  }
  React.useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  // 计算深链目标 URL
  const targetUrl = React.useMemo(() => {
    if (node.type === 'task') {
      const taskId = node.rawTask?.id ?? node.id.replace(/^t-/, '')
      return `/next/projects/${node.projectId}?focusTask=${taskId}`
    }
    return `/next/projects/${node.projectId}?lens=timeline`
  }, [node])

  const handleNavigate = React.useCallback(
    (e?: React.MouseEvent | React.KeyboardEvent) => {
      e?.stopPropagation()
      if (onNavigate) {
        onNavigate(targetUrl)
      } else {
        router?.push(targetUrl)
      }
    },
    [onNavigate, router, targetUrl],
  )

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleNavigate(e)
      }
    },
    [handleNavigate],
  )

  const dateRangeText = React.useMemo(() => {
    if (node.startDate && node.endDate) {
      return `${node.startDate} ~ ${node.endDate}`
    }
    return node.date
  }, [node])

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      ref={triggerRef}
      onMouseEnter={openHover}
      onMouseLeave={closeHoverSoon}
    >
      {/* 触发器插槽 */}
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${node.projectName} ${node.type === 'milestone' ? '里程碑' : '任务'}: ${node.name}`}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onClick={handleNavigate}
        onKeyDown={handleKeyDown}
        className="cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-space-cyan)]"
      >
        {children}
      </div>

      {/* 悬停浮层卡片 */}
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-global-timeline-hover-card
              onMouseEnter={openHover}
              onMouseLeave={closeHoverSoon}
              style={
                position
                  ? {
                      position: 'fixed',
                      left: position.left,
                      top: position.top,
                      width: CARD_WIDTH,
                      transform: position.above ? 'translateY(-100%)' : undefined,
                    }
                  : { position: 'fixed', visibility: 'hidden' }
              }
              data-node-type={node.type}
              data-immersion={tier}
              role="dialog"
              aria-label="排程事件明细"
              className={cn(
                'z-[1000] rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] p-3 text-left',
                !isPrecise && 'shadow-xl shadow-black/30',
              )}
            >
              {/* 所属项目与类型徽章 */}
              <div className="flex items-center justify-between gap-1.5 border-b border-[var(--nx-border-hairline)] pb-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    data-hover-project-dot
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: node.projectColorToken }}
                  />
                  <span
                    data-hover-project-name
                    className="truncate font-medium text-[var(--nx-text-secondary)]"
                  >
                    {node.projectName}
                  </span>
                </div>
                <span
                  data-hover-type
                  className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase text-[var(--nx-text-muted)] bg-[var(--nx-workspace-bg)] border border-[var(--nx-border-hairline)]"
                >
                  {node.type === 'milestone' ? '里程碑' : '任务'}
                </span>
              </div>

              {/* 标题 */}
              <h4
                data-hover-title
                className="mt-2 text-xs font-semibold leading-snug text-[var(--nx-text-primary)]"
              >
                {node.name}
              </h4>

              {/* 状态与排程日期 */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                <span
                  data-hover-status
                  className="rounded px-1.5 py-0.5 font-medium border"
                  style={{
                    color: `var(${node.statusTone})`,
                    borderColor: `var(${node.statusTone})`,
                    backgroundColor: 'rgba(0,0,0,0.2)',
                  }}
                >
                  {node.statusLabel}
                </span>

                <span
                  data-hover-date
                  className="flex items-center gap-1 font-mono text-[var(--nx-text-muted)]"
                >
                  <Calendar className="h-3 w-3" />
                  {dateRangeText}
                </span>
              </div>

              {/* 工期与责任人 */}
              {node.durationDays != null || node.assigneeName ? (
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] pt-1.5 text-[10px] text-[var(--nx-text-secondary)]">
                  {node.durationDays != null ? (
                    <span data-hover-duration className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-[var(--nx-text-muted)]" />
                      工期 {node.durationDays} 天
                    </span>
                  ) : (
                    <span />
                  )}

                  {node.assigneeName ? (
                    <span
                      data-hover-assignee
                      className="flex items-center gap-1 truncate max-w-[120px]"
                    >
                      <User className="h-3 w-3 text-[var(--nx-text-muted)]" />
                      {node.assigneeName}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* 任务进度百分比 */}
              {node.type === 'task' && node.progressPercent != null ? (
                <div className="mt-2 flex items-center gap-2 text-[10px]">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--nx-workspace-bg)]">
                    <div
                      className="h-full rounded-full bg-[var(--nx-space-cyan)] transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, node.progressPercent))}%` }}
                    />
                  </div>
                  <span data-hover-progress className="font-mono text-[var(--nx-text-muted)]">
                    {Math.round(node.progressPercent)}%
                  </span>
                </div>
              ) : null}

              {/* 直达下钻操作点 */}
              <div className="mt-2.5 pt-1.5 border-t border-[var(--nx-border-hairline)]">
                <button
                  type="button"
                  data-hover-drill-down
                  onClick={handleNavigate}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1 text-[11px] font-medium text-[var(--nx-space-cyan)]',
                    'bg-[var(--nx-workspace-bg)] border border-[var(--nx-border-hairline)] hover:border-[var(--nx-border-focus)] transition-colors',
                  )}
                >
                  <span>{node.type === 'milestone' ? '聚焦项目时间线' : '穿透任务详情抽屉'}</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>,
            // 挂在新版外壳里：主题变量定义在 [data-next-track] 上，挂到 body 会丢主题、背景变透明
            (triggerRef.current?.closest('[data-next-track]') as HTMLElement | null) ??
              document.body,
          )
        : null}
    </div>
  )
}

export default GlobalTimelineHoverCard
