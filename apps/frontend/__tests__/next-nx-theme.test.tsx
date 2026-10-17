/**
 * 新轨明暗主题 + 全域 Cinematic 共享层测试（v3-next-cinematic-techniques-completion D5/D6）。
 *
 * 覆盖：
 * - NxThemeToggle：点击浅色 → store.nxTheme 翻转 + `<html data-nx-theme="light">` 同步；
 *   再点深色还原；aria-pressed 回显正确；
 * - 持久化：partialize 包含 nxTheme（localStorage 落盘）；
 * - 浅色令牌契约：next-tokens.css 存在浅色覆盖块且覆盖关键令牌（bg/surface/text/accent/status）；
 * - 壳层共享前景剪纸层：NextAppShell 渲染含 [data-foreground-cutout]（aria-hidden 纯氛围）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NxThemeToggle } from '@/components/next/layout/NxThemeToggle'
import { NextAppShell } from '@/components/next/layout/NextAppShell'
import { useNextTrackStore } from '@/stores/next-track-store'

vi.mock('next/navigation', () => ({
  usePathname: () => '/next',
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}))

// 顶栏内部重组件以 stub 替代（本测试只验主题切换与剪纸层挂载）
vi.mock('@/components/next/layout/NextTopbar', () => ({
  NextTopbar: () => <div data-stub-topbar />,
}))
vi.mock('@/components/next/navigation/SpaceMapOverlay', () => ({
  SpaceMapOverlay: () => null,
}))

beforeEach(() => {
  useNextTrackStore.setState({ track: 'next', immersionTier: null, nxTheme: 'dark', source: null })
  document.documentElement.removeAttribute('data-nx-theme')
  localStorage.clear()
})

describe('明暗主题切换（NxThemeToggle + useNxTheme）', () => {
  test('默认深色；点击浅色后 html 属性与 store 同步', () => {
    const { getByLabelText } = render(
      <NextAppShell>
        <NxThemeToggle />
      </NextAppShell>,
    )
    expect(document.documentElement.getAttribute('data-nx-theme')).toBe('dark')

    fireEvent.click(getByLabelText('浅色主题'))
    expect(useNextTrackStore.getState().nxTheme).toBe('light')
    expect(document.documentElement.getAttribute('data-nx-theme')).toBe('light')

    fireEvent.click(getByLabelText('深色主题'))
    expect(useNextTrackStore.getState().nxTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-nx-theme')).toBe('dark')
  })

  test('aria-pressed 回显当前档位', () => {
    const { getByLabelText } = render(
      <NextAppShell>
        <NxThemeToggle />
      </NextAppShell>,
    )
    expect(getByLabelText('深色主题').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(getByLabelText('浅色主题'))
    expect(getByLabelText('浅色主题').getAttribute('aria-pressed')).toBe('true')
    expect(getByLabelText('深色主题').getAttribute('aria-pressed')).toBe('false')
  })

  test('持久化契约：partialize 落盘包含 nxTheme', () => {
    useNextTrackStore.getState().setNxTheme('light')
    const persisted = JSON.parse(localStorage.getItem('aiproj-next-track') ?? '{}')
    expect(persisted.state?.nxTheme).toBe('light')
    expect(persisted.state?.track).toBeDefined()
    expect(persisted.state?.immersionTier !== undefined).toBe(true)
  })
})

describe('手机更多菜单主题控件生命周期', () => {
  function Scene({ menuOpen }: { menuOpen: boolean }) {
    return (
      <NextAppShell>
        <NxThemeToggle />
        {menuOpen ? (
          <div data-mobile-menu>
            <NxThemeToggle />
          </div>
        ) : null}
      </NextAppShell>
    )
  }

  test('手动选择浅色后关闭与重开菜单，根主题与偏好持续一致', () => {
    const view = render(<Scene menuOpen />)
    fireEvent.click(view.getAllByLabelText('浅色主题')[1]!)
    expect(document.documentElement.dataset.nxTheme).toBe('light')
    view.rerender(<Scene menuOpen={false} />)
    expect(document.documentElement.dataset.nxTheme).toBe('light')
    view.rerender(<Scene menuOpen />)
    expect(view.getAllByLabelText('浅色主题')[1]).toHaveAttribute('aria-pressed', 'true')
    view.rerender(<Scene menuOpen={false} />)
    expect(document.documentElement.dataset.nxTheme).toBe('light')
    expect(useNextTrackStore.getState().nxTheme).toBe('light')
  })

  test('AI 更新同一主题偏好后卸载菜单，壳层仍持续同步后续选择', () => {
    const view = render(<Scene menuOpen />)
    act(() => useNextTrackStore.getState().setNxTheme('light'))
    view.rerender(<Scene menuOpen={false} />)
    expect(document.documentElement.dataset.nxTheme).toBe('light')
    act(() => useNextTrackStore.getState().setNxTheme('dark'))
    expect(document.documentElement.dataset.nxTheme).toBe('dark')
    act(() => useNextTrackStore.getState().setNxTheme('light'))
    expect(document.documentElement.dataset.nxTheme).toBe('light')
  })
})

describe('浅色令牌契约（next-tokens.css）', () => {
  test('存在浅色覆盖块且覆盖关键令牌族', () => {
    const css = readFileSync(resolve(__dirname, '../app/(next)/next-tokens.css'), 'utf8')
    expect(css).toContain(":root[data-nx-theme='light'] [data-next-track]")
    const lightBlock = css.slice(css.indexOf(":root[data-nx-theme='light'] [data-next-track]"))
    for (const token of [
      '--nx-workspace-bg',
      '--nx-workspace-surface',
      '--nx-text-primary',
      '--nx-text-secondary',
      '--nx-text-muted',
      '--nx-accent',
      '--nx-status-success',
      '--nx-status-warning',
      '--nx-status-danger',
      '--nx-border-hairline',
      '--nx-chart-1',
    ]) {
      expect(lightBlock).toContain(token)
    }
    // 浅色底关键值实证（工作面底为亮色、正文为深色）
    expect(lightBlock).toContain('--nx-workspace-surface: #ffffff')
    expect(lightBlock).toContain('--nx-text-primary: #0f172a')
  })

  test('精确档剥离剪纸层 + Reduced Motion 停动效（CSS 契约存在）', () => {
    const css = readFileSync(resolve(__dirname, '../app/(next)/next-tokens.css'), 'utf8')
    expect(css).toContain("[data-immersion='precise'] [data-foreground-cutout]")
  })
})

describe('壳层全域 Cinematic 共享层', () => {
  test('NextAppShell 挂载前景剪纸层（所有新轨页面共享）', () => {
    const { container } = render(
      <NextAppShell>
        <div>内容</div>
      </NextAppShell>,
    )
    const cutout = container.querySelector('[data-foreground-cutout]')
    expect(cutout).not.toBeNull()
    expect(cutout?.getAttribute('aria-hidden')).toBe('true')
  })
})
