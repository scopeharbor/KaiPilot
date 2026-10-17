/**
 * v3-ui-next-shell-space-map tasks 2.3/2.4 —— 空间地图坐标卡片（可用态 / 置灰占位态）。
 *
 * v3-ui-next-chart-gallery 1.4 后预置白名单已无 coming-soon 坐标（图表馆点亮为
 * available），置灰占位语义改用合成坐标夹具回归 SpaceMapCard 通用行为。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { SpaceMapCard } from '@/components/next/navigation/SpaceMapCard'
import { PRESET_SPACE_COORDINATES, type SpaceCoordinate } from '@/lib/next/space-coordinates'

const available = PRESET_SPACE_COORDINATES.find((c) => c.id === 'home')!
const charts = PRESET_SPACE_COORDINATES.find((c) => c.id === 'charts')!

/** 合成置灰坐标夹具（真实白名单已全部 available；保留占位渲染能力回归）。 */
const comingSoonFixture: SpaceCoordinate = {
  id: 'future-lens',
  title: '未来镜头',
  path: '/next/future-lens',
  description: '规划中的未来坐标占位（v3-ui-next-chart-gallery 点亮后由合成夹具覆盖）',
  status: 'coming-soon',
  badge: '即将上线',
  iconName: 'BarChart3',
  keywords: ['future'],
}

describe('components/next/navigation/SpaceMapCard（可用坐标）', () => {
  test('渲染暗黑仪器感卡片：标题/描述/路径/徽标/图标齐全，点击回调携带坐标对象', () => {
    const onSelect = vi.fn()
    render(<SpaceMapCard coordinate={available} onSelect={onSelect} />)

    const button = screen.getByRole('button', { name: /角色首页/ })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('data-status', 'available')
    expect(button).toHaveAttribute('data-space-coordinate', 'home')

    // 徽标、路径回显与图标（lucide svg）
    expect(screen.getByText('已就绪')).toBeInTheDocument()
    expect(screen.getByText('/next')).toBeInTheDocument()
    expect(button.querySelector('svg')).toBeTruthy()

    // 样式表现：发丝线边框 + 悬浮态 + 键盘 focus ring
    expect(button.className).toContain('border-[var(--nx-border-hairline)]')
    expect(button.className).toContain('hover:border-[var(--nx-border-focus)]')
    expect(button.className).toContain('focus-visible:ring-2')
    expect(screen.getByText('/next').className).toContain('font-mono')

    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(available)
  })

  test('图表馆坐标点亮为 available：可点击直达 /next/charts（v3-ui-next-chart-gallery 1.4）', () => {
    const onSelect = vi.fn()
    render(<SpaceMapCard coordinate={charts} onSelect={onSelect} />)

    const button = screen.getByRole('button', { name: /图表馆/ })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('data-status', 'available')
    expect(button).toHaveAttribute('data-space-coordinate', 'charts')
    expect(screen.getByText('已就绪')).toBeInTheDocument()

    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(charts)
  })
})

describe('components/next/navigation/SpaceMapCard（coming-soon 占位坐标）', () => {
  test('置灰禁用 + tabIndex=-1 + 「即将上线」徽标，点击与键盘均无法触发回调', () => {
    const onSelect = vi.fn()
    render(<SpaceMapCard coordinate={comingSoonFixture} onSelect={onSelect} />)

    const button = screen.getByRole('button', { name: /未来镜头/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('tabindex', '-1')
    expect(button).toHaveAttribute('data-status', 'coming-soon')
    expect(button).toHaveAttribute('data-space-coordinate', 'future-lens')

    expect(screen.getByText('即将上线')).toBeInTheDocument()
    expect(button.className).toContain('cursor-not-allowed')
    expect(button.className).toContain('opacity-50')

    fireEvent.click(button)
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('全部 coming-soon 坐标都保持禁用语义（数据契约与渲染行为一致）', () => {
    const onSelect = vi.fn()
    const { unmount } = render(<SpaceMapCard coordinate={comingSoonFixture} onSelect={onSelect} />)
    const button = screen.getByRole('button', { name: /未来镜头/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('tabindex', '-1')
    expect(screen.getByText('即将上线')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
    unmount()
  })
})
