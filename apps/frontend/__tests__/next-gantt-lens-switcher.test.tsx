/**
 * v3-ui-next-gantt-lens tasks 3.7 —— 镜头切换器点亮测试（演进基线）。
 *
 * 覆盖（spec「镜头切换器点亮与空间地图/AI 导航直达」场景一 + design「点亮 LensSwitcher」；
 * v3-ui-next-remaining-lenses 5.1 全量点亮后同步新契约）：
 * - 甘特图项由 coming-soon 点亮为 available：无 disabled/aria-disabled、无置灰 Tooltip、
 *   点击触发 `onSelect('gantt')`；
 * - 激活态：activeLensId 为甘特时按钮下方呈现 --nx-workspace-blue 激活指示条；
 * - 全量点亮：WBS/列表/日历与新增时间线同为 available，无 disabled/aria-disabled，
 *   点击分别派发对应 onSelect，悬停零 Tooltip。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { LensSwitcher, LENS_SWITCHER_OPTIONS } from '@/components/next/project-space/LensSwitcher'

function lensOption(id: string): HTMLElement {
  return document.querySelector(`[data-lens-option="${id}"]`) as HTMLElement
}

describe('components/next/project-space/LensSwitcher（甘特点亮）', () => {
  test('甘特图项状态为 available：不 disabled、无 aria-disabled', () => {
    render(<LensSwitcher />)
    const gantt = lensOption('gantt')
    expect(gantt).not.toBeNull()
    expect(gantt.getAttribute('data-lens-status')).toBe('available')
    expect(gantt).not.toBeDisabled()
    expect(gantt.hasAttribute('aria-disabled')).toBe(false)
    // 白名单登记保持一致
    expect(LENS_SWITCHER_OPTIONS.find((o) => o.id === 'gantt')?.status).toBe('available')
  })

  test('点击甘特图触发 onSelect("gantt")', () => {
    const onSelect = vi.fn()
    render(<LensSwitcher onSelect={onSelect} />)
    fireEvent.click(lensOption('gantt'))
    expect(onSelect).toHaveBeenCalledWith('gantt')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  test('activeLensId="gantt" 时甘特按钮呈现激活指示条', () => {
    render(<LensSwitcher activeLensId="gantt" />)
    const activeIndicator = lensOption('gantt').querySelector('[data-lens-active-indicator]')
    expect(activeIndicator).not.toBeNull()
    expect(lensOption('kanban').querySelector('[data-lens-active-indicator]')).toBeNull()
  })

  test('activeLensId="kanban" 时指示条在看板，甘特为普通可点击态', () => {
    render(<LensSwitcher activeLensId="kanban" />)
    expect(lensOption('kanban').querySelector('[data-lens-active-indicator]')).not.toBeNull()
    expect(lensOption('gantt').querySelector('[data-lens-active-indicator]')).toBeNull()
    expect(lensOption('gantt')).not.toBeDisabled()
  })

  test('全量点亮回归：WBS/列表/日历/时间线均 available，点击派发，悬停零 Tooltip', () => {
    const onSelect = vi.fn()
    render(<LensSwitcher onSelect={onSelect} />)

    for (const id of ['wbs', 'list', 'calendar', 'timeline']) {
      const option = lensOption(id)
      expect(option.getAttribute('data-lens-status')).toBe('available')
      expect(option).not.toBeDisabled()
      expect(option.hasAttribute('aria-disabled')).toBe(false)
    }

    // 悬停任意镜头均不再出现「即将上线」Tooltip
    fireEvent.mouseEnter(lensOption('wbs'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(lensOption('timeline'))
    expect(screen.queryByRole('tooltip')).toBeNull()

    // 点击新点亮镜头派发对应回调
    fireEvent.click(lensOption('wbs'))
    fireEvent.click(lensOption('list'))
    fireEvent.click(lensOption('calendar'))
    fireEvent.click(lensOption('timeline'))
    expect(onSelect.mock.calls).toEqual([['wbs'], ['list'], ['calendar'], ['timeline']])
  })
})
