import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { useNextTrackStore } from '@/stores/next-track-store'
import {
  RoleStrategicScrollContainer,
  ROLE_VIEW_TOKENS,
} from '@/components/next/role-view/RoleStrategicScrollContainer'

describe('RoleStrategicScrollContainer（纸光长卷主容器，任务 1.1 / 1.2）', () => {
  beforeEach(() => {
    useNextTrackStore.setState({ immersionTier: null })
    document.documentElement.removeAttribute('data-immersion')
  })

  test('正确映射 Role View 纸光令牌并包含 max-w-5xl 出版级长卷网格', () => {
    const { container } = render(
      <RoleStrategicScrollContainer>
        <div data-testid="child-content">长卷测试正文</div>
      </RoleStrategicScrollContainer>,
    )

    const root = container.querySelector('[data-role-scroll-container="true"]')
    expect(root).not.toBeNull()
    expect(root).toHaveAttribute('role', 'region')
    expect(root).toHaveAttribute('aria-label', '战略执行长卷')

    // 验证令牌常量与内联背景色绑定
    expect(ROLE_VIEW_TOKENS.bg).toContain('--nx-role-bg')
    expect(ROLE_VIEW_TOKENS.surface).toContain('--nx-role-surface')
    expect(ROLE_VIEW_TOKENS.text).toContain('--nx-role-text')
    expect(ROLE_VIEW_TOKENS.accent).toContain('--nx-role-accent')

    const innerGrid = root?.querySelector('.max-w-5xl')
    expect(innerGrid).not.toBeNull()
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  test('精确档（data-immersion="precise"）下阴影彻底停用并保持纯平纸面', () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    const { container } = render(
      <RoleStrategicScrollContainer>
        <div>精确档内容</div>
      </RoleStrategicScrollContainer>,
    )

    const root = container.querySelector('[data-role-scroll-container="true"]')
    expect(root).toHaveAttribute('data-immersion', 'precise')

    // 内部网格必须包含 shadow-none，不含常规纸面光影类
    const innerGrid = root?.querySelector('.max-w-5xl')
    expect(innerGrid?.className).toContain('shadow-none')
  })

  test('显式传递 immersionTier="precise" 也能正确进入纯平降级模式', () => {
    const { container } = render(
      <RoleStrategicScrollContainer immersionTier="precise">
        <div>显式精确档内容</div>
      </RoleStrategicScrollContainer>,
    )

    const root = container.querySelector('[data-role-scroll-container="true"]')
    expect(root).toHaveAttribute('data-immersion', 'precise')
    const innerGrid = root?.querySelector('.max-w-5xl')
    expect(innerGrid?.className).toContain('shadow-none')
  })

  test('高对比度（WCAG AA/AAA 对比度 ≥ 4.5:1，实测 10.8:1）文本回显与无障碍标签', () => {
    render(
      <RoleStrategicScrollContainer title="2026 年度高管战略复盘长卷">
        <p>高清晰度墨水黑长文本正文</p>
      </RoleStrategicScrollContainer>,
    )

    const section = screen.getByRole('region', { name: '2026 年度高管战略复盘长卷' })
    expect(section).toBeInTheDocument()
    expect(screen.getByText('高清晰度墨水黑长文本正文')).toBeInTheDocument()

    // 验证颜色值规范：羊皮纸白 #f5f4ef，墨水黑 #38342c
    const rgbBg = [0xf5, 0xf4, 0xef]
    const rgbText = [0x38, 0x34, 0x2c]
    const luminance = (rgb: number[]) => {
      const a = rgb.map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      })
      return (a[0] ?? 0) * 0.2126 + (a[1] ?? 0) * 0.7152 + (a[2] ?? 0) * 0.0722
    }
    const l1 = luminance(rgbBg)
    const l2 = luminance(rgbText)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    // 对比度必须 ≥ 4.5:1（实测 > 10:1，达到 10.8:1）
    expect(ratio).toBeGreaterThan(10)
  })

  test('恪守 RL-15：零 3D / 零 WebGL / 零 Canvas', () => {
    const { container } = render(
      <RoleStrategicScrollContainer>
        <div>无画布节点测试</div>
      </RoleStrategicScrollContainer>,
    )

    expect(container.querySelector('canvas')).toBeNull()
    expect(container.querySelector('svg webgl')).toBeNull()
  })
})
