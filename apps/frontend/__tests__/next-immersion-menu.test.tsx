import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { ImmersionTierMenu } from '@/components/next/layout/ImmersionTierMenu'
import { NEXT_TRACK_STORAGE_KEY, useNextTrackStore } from '@/stores/next-track-store'

beforeEach(() => {
  localStorage.clear()
  useNextTrackStore.getState().reset()
  document.documentElement.removeAttribute('data-immersion')
})

describe('components/next/layout/ImmersionTierMenu（v3-ui-next-shell-space-map tasks 1.3/1.4）', () => {
  test('渲染三档（沉浸/轻量/精确），默认生效档位为沉浸并高亮', () => {
    render(<ImmersionTierMenu />)

    const group = screen.getByRole('group', { name: '沉浸档位切换' })
    expect(group).toBeInTheDocument()

    const immersive = screen.getByRole('button', { name: '沉浸' })
    const light = screen.getByRole('button', { name: '轻量' })
    const precise = screen.getByRole('button', { name: '精确' })
    expect(immersive).toBeInTheDocument()
    expect(light).toBeInTheDocument()
    expect(precise).toBeInTheDocument()

    // 未手动选择 + 无减弱动效（jsdom matchMedia matches=false）→ 沉浸档生效
    expect(immersive).toHaveAttribute('aria-pressed', 'true')
    expect(light).toHaveAttribute('aria-pressed', 'false')
    expect(precise).toHaveAttribute('aria-pressed', 'false')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')
  })

  test('点击轻量档：store 更新、localStorage 持久化、根节点 data-immersion 同步、高亮迁移', () => {
    render(<ImmersionTierMenu />)

    fireEvent.click(screen.getByRole('button', { name: '轻量' }))

    expect(useNextTrackStore.getState().immersionTier).toBe('light')
    // zustand persist 同步落 localStorage（key 见 next-track-store）
    const persisted = JSON.parse(localStorage.getItem(NEXT_TRACK_STORAGE_KEY) ?? '{}')
    expect(persisted.state.immersionTier).toBe('light')
    // useImmersionTier 将生效档位同步到根 DOM 节点
    expect(document.documentElement.getAttribute('data-immersion')).toBe('light')
    expect(screen.getByRole('button', { name: '轻量' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '沉浸' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('点击精确档：root data-immersion=precise 且精确档高亮', () => {
    render(<ImmersionTierMenu />)

    fireEvent.click(screen.getByRole('button', { name: '精确' }))

    expect(useNextTrackStore.getState().immersionTier).toBe('precise')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    expect(screen.getByRole('button', { name: '精确' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '沉浸' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '轻量' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('store 已持有手动档位时，渲染即高亮该档位（持久化回显）', () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    render(<ImmersionTierMenu />)

    expect(screen.getByRole('button', { name: '精确' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '沉浸' })).toHaveAttribute('aria-pressed', 'false')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
  })
})
