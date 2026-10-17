'use client'

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

/**
 * 日历格子的手势（月格 / 周列 / 日列共用）：
 * - 单击空白 → 选中这天（右侧当日面板）；稍等一下再选，免得双击的第一下先打开侧栏、挤动格子让第二下落到别天；
 * - 双击空白 → 在这天快速新建；
 * - 按住拖过几天再放开 → 以这段日期快速新建。
 *
 * 只认空白处：点在任务条、按钮、输入框上不算（交给它们自己的点击）。
 */
export interface DayRange {
  startDate: string
  endDate: string
}

/** 新建的锚点：格子元素的位置（小卡片贴着它弹出）。 */
export interface QuickCreateRequest {
  startDate: string
  endDate: string | null
  anchor: DOMRect | null
}

/** 单击后等这么久没有第二下才算单击（毫秒）。 */
export const SINGLE_CLICK_DELAY_MS = 250

const INTERACTIVE = '[data-calendar-item],button,input,textarea,select,a,[role="button"]'

function isBlankTarget(event: ReactMouseEvent): boolean {
  const target = event.target as HTMLElement | null
  return !target?.closest(INTERACTIVE)
}

export function useCalendarDayGestures({
  onSelectDay,
  onCreate,
}: {
  onSelectDay: (date: string) => void
  onCreate: (request: QuickCreateRequest) => void
}) {
  const [drag, setDrag] = useState<{ from: string; to: string } | null>(null)
  const dragRef = useRef<{ from: string; to: string; anchor: HTMLElement | null } | null>(null)
  const selectTimerRef = useRef<number | null>(null)
  const cancelSelect = () => {
    if (selectTimerRef.current !== null) window.clearTimeout(selectTimerRef.current)
    selectTimerRef.current = null
  }
  useEffect(() => cancelSelect, [])

  useEffect(() => {
    if (!drag) return
    const finish = () => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current) return
      if (current.from === current.to) {
        cancelSelect()
        const date = current.from
        selectTimerRef.current = window.setTimeout(() => {
          selectTimerRef.current = null
          onSelectDay(date)
        }, SINGLE_CLICK_DELAY_MS)
        return
      }
      const [startDate, endDate] =
        current.from <= current.to ? [current.from, current.to] : [current.to, current.from]
      onCreate({
        startDate,
        endDate,
        anchor: current.anchor?.getBoundingClientRect() ?? null,
      })
    }
    window.addEventListener('mouseup', finish)
    return () => window.removeEventListener('mouseup', finish)
  }, [drag, onCreate, onSelectDay])

  const dayProps = useCallback(
    (date: string) => ({
      'data-calendar-drop-date': date,
      onMouseDown: (event: ReactMouseEvent<HTMLElement>) => {
        if (event.button !== 0 || !isBlankTarget(event)) return
        // 防止拖曳时选中文字
        event.preventDefault()
        dragRef.current = { from: date, to: date, anchor: event.currentTarget }
        setDrag({ from: date, to: date })
      },
      onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => {
        if (!dragRef.current) return
        dragRef.current = { ...dragRef.current, to: date, anchor: event.currentTarget }
        setDrag({ from: dragRef.current.from, to: date })
      },
      onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
        if (!isBlankTarget(event)) return
        cancelSelect()
        onCreate({
          startDate: date,
          endDate: null,
          anchor: event.currentTarget.getBoundingClientRect(),
        })
      },
    }),
    [onCreate],
  )

  /** 拖曳中被框到的日期（格子高亮用）。 */
  const inDragRange = useCallback(
    (date: string) => {
      if (!drag || drag.from === drag.to) return false
      const [from, to] = drag.from <= drag.to ? [drag.from, drag.to] : [drag.to, drag.from]
      return date >= from && date <= to
    },
    [drag],
  )

  return { dayProps, inDragRange, dragging: drag !== null }
}
