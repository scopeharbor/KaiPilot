/**
 * v3-ui-next-project-space tasks 1.5/1.6 原始契约 + v3-ui-next-gantt-lens 3.6/3.7 点亮甘特图
 * 后的演进契约；v3-ui-next-remaining-lenses 5.1 已将 WBS/列表/日历/时间线全量点亮，
 * 本文件同步最终契约（六镜头全量 available，置灰态与 Tooltip 彻底移除）。
 *
 * 覆盖：白名单结构（6 镜头全部 available）、看板默认高亮激活
 * （--nx-workspace-surface + --nx-workspace-blue 指示条）、任意镜头可承载激活指示条、
 * 六选项点击均派发对应 onSelect(lensId)、悬停/聚焦零 Tooltip（置灰残留行为已清除）。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { LensSwitcher, LENS_SWITCHER_OPTIONS } from '@/components/next/project-space/LensSwitcher'

const ALL_LENS_IDS = ['kanban', 'gantt', 'wbs', 'list', 'calendar', 'timeline'] as const

describe('LensSwitcher（spec「LensSwitcher 全量点亮与路由 URL 双向绑定」）', () => {
  test('白名单结构与 spec 对齐：6 镜头且全部 available（含新增 timeline）', () => {
    expect(LENS_SWITCHER_OPTIONS.map((option) => option.id)).toEqual([...ALL_LENS_IDS])
    expect(LENS_SWITCHER_OPTIONS).toHaveLength(6)
    for (const id of ALL_LENS_IDS) {
      expect(LENS_SWITCHER_OPTIONS.find((o) => o.id === id)?.status).toBe('available')
    }
    expect(LENS_SWITCHER_OPTIONS.find((o) => o.id === 'timeline')?.label).toBe('时间线')
  })

  test('看板高亮激活：aria-pressed、暗黑表面与蓝色指示条', () => {
    const { container } = render(<LensSwitcher />)
    const kanban = container.querySelector('[data-lens-option="kanban"]') as HTMLElement
    expect(kanban.getAttribute('aria-pressed')).toBe('true')
    expect(kanban.getAttribute('aria-disabled')).toBeNull()
    expect(kanban.getAttribute('data-lens-status')).toBe('available')
    expect(kanban.className).toContain('bg-[var(--nx-workspace-surface)]')
    expect(kanban.className).toContain('text-[var(--nx-text-primary)]')
    expect(kanban.querySelector('[data-lens-active-indicator]')).not.toBeNull()
    expect(
      (kanban.querySelector('[data-lens-active-indicator]') as HTMLElement).className,
    ).toContain('bg-[var(--nx-workspace-blue)]')
  })

  test('全部 6 个镜头可用：无 disabled、无 aria-disabled、无置灰样式', () => {
    const { container } = render(<LensSwitcher />)
    for (const id of ALL_LENS_IDS) {
      const button = container.querySelector(`[data-lens-option="${id}"]`) as HTMLElement
      expect(button.getAttribute('data-lens-status')).toBe('available')
      expect(button.hasAttribute('disabled')).toBe(false)
      expect(button.getAttribute('aria-disabled')).toBeNull()
      expect(button.className).not.toContain('cursor-not-allowed')
      expect(button.className).not.toContain('text-[var(--nx-text-muted)]')
      // 可聚焦（tabIndex 未锁 -1）
      expect(button.tabIndex).not.toBe(-1)
    }
  })

  test('悬停与键盘聚焦任意镜头：零 Tooltip（置灰残留已随全量点亮移除）', () => {
    render(<LensSwitcher />)
    expect(screen.queryByRole('tooltip')).toBeNull()

    for (const id of ALL_LENS_IDS) {
      const trigger = document.querySelector(`[data-lens-trigger="${id}"]`) as HTMLElement
      fireEvent.mouseEnter(trigger)
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseLeave(trigger)
      fireEvent.focus(trigger)
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.blur(trigger)
    }
  })

  test('点击 6 个选项均正确派发对应 onSelect(lensId)（含新增时间线）', () => {
    const onSelect = vi.fn()
    render(<LensSwitcher onSelect={onSelect} />)
    for (const id of ALL_LENS_IDS) {
      const label = LENS_SWITCHER_OPTIONS.find((o) => o.id === id)!.label
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(onSelect).toHaveBeenLastCalledWith(id)
    }
    expect(onSelect).toHaveBeenCalledTimes(6)
  })

  test('激活指示条随 activeLensId 对齐任意镜头（六选一互斥）', () => {
    for (const id of ALL_LENS_IDS) {
      const { container, unmount } = render(<LensSwitcher activeLensId={id} />)
      for (const other of ALL_LENS_IDS) {
        const button = container.querySelector(`[data-lens-option="${other}"]`) as HTMLElement
        if (other === id) {
          expect(button.getAttribute('aria-pressed')).toBe('true')
          expect(button.querySelector('[data-lens-active-indicator]')).not.toBeNull()
        } else {
          expect(button.getAttribute('aria-pressed')).toBeNull()
          expect(button.querySelector('[data-lens-active-indicator]')).toBeNull()
        }
      }
      unmount()
    }
  })
})
