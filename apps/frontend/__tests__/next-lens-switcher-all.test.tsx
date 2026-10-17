/**
 * v3-ui-next-remaining-lenses tasks 5.2 —— LensSwitcher 全量可用与交互单元测试
 * （spec「LensSwitcher 全量点亮与路由 URL 双向绑定」Requirement 1）。
 *
 * 覆盖：
 * - 白名单六镜头（含新增 timeline）全部 available：无 aria-disabled、无 disabled、
 *   无置灰残留（cursor-not-allowed / --nx-text-muted）；
 * - 分别点击 6 个选项均正确派发对应 onSelect(lensId) 回调；
 * - 激活镜头高亮背景 + --nx-workspace-blue 指示条正确对齐（六选一互斥）。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import {
  LensSwitcher,
  LENS_SWITCHER_OPTIONS,
  type ProjectSpaceLensId,
} from '@/components/next/project-space/LensSwitcher'

const ALL_LENS_IDS: readonly ProjectSpaceLensId[] = [
  'kanban',
  'gantt',
  'wbs',
  'list',
  'calendar',
  'timeline',
]

function option(id: ProjectSpaceLensId): HTMLElement {
  return document.querySelector(`[data-lens-option="${id}"]`) as HTMLElement
}

describe('LensSwitcher 全量点亮（tasks 5.2）', () => {
  test('全部 6 个镜头项处于可用状态：无 aria-disabled、无 disabled、无置灰样式', () => {
    render(<LensSwitcher />)

    expect(LENS_SWITCHER_OPTIONS).toHaveLength(6)
    for (const id of ALL_LENS_IDS) {
      const button = option(id)
      expect(button).not.toBeNull()
      expect(button).not.toBeDisabled()
      expect(button.hasAttribute('aria-disabled')).toBe(false)
      expect(button.getAttribute('data-lens-status')).toBe('available')
      // 置灰残留彻底清除：无禁用手型与弱对比文案色
      expect(button.className).not.toContain('cursor-not-allowed')
      expect(button.className).not.toContain('text-[var(--nx-text-muted)]')
    }
  })

  test('分别点击 6 个选项均派发对应 onSelect(lensId)（无任何禁用拦截）', () => {
    const onSelect = vi.fn()
    render(<LensSwitcher onSelect={onSelect} />)

    for (const id of ALL_LENS_IDS) {
      fireEvent.click(option(id))
      expect(onSelect).toHaveBeenLastCalledWith(id)
    }
    expect(onSelect).toHaveBeenCalledTimes(6)
  })

  test('点击触发回调后激活态由父级 activeLensId 驱动：指示条与 aria-pressed 正确对齐', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<LensSwitcher activeLensId="kanban" onSelect={onSelect} />)

    // 看板初始激活
    expect(option('kanban')).toHaveAttribute('aria-pressed', 'true')
    expect(option('kanban').querySelector('[data-lens-active-indicator]')).not.toBeNull()

    // 点击新镜头（父级同步 rerender 到该镜头）：激活指示条迁移
    for (const id of ALL_LENS_IDS) {
      fireEvent.click(option(id))
      rerender(<LensSwitcher activeLensId={id} onSelect={onSelect} />)

      for (const other of ALL_LENS_IDS) {
        if (other === id) {
          expect(option(other)).toHaveAttribute('aria-pressed', 'true')
          const indicator = option(other).querySelector('[data-lens-active-indicator]')
          expect(indicator).not.toBeNull()
          expect((indicator as HTMLElement).className).toContain('bg-[var(--nx-workspace-blue)]')
          // 激活项高亮表面与主文本色
          expect(option(other).className).toContain('bg-[var(--nx-workspace-surface)]')
          expect(option(other).className).toContain('text-[var(--nx-text-primary)]')
        } else {
          expect(option(other).getAttribute('aria-pressed')).toBeNull()
          expect(option(other).querySelector('[data-lens-active-indicator]')).toBeNull()
        }
      }
    }
  })

  test('任意镜头悬停 / 聚焦均不再弹出「即将上线」Tooltip', () => {
    render(<LensSwitcher />)
    for (const id of ALL_LENS_IDS) {
      const button = option(id)
      fireEvent.mouseEnter(button)
      fireEvent.focus(button)
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseLeave(button)
      fireEvent.blur(button)
    }
  })
})
