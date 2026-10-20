import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextAppShell } from '@/components/next/layout/NextAppShell'
import { useNextTrackStore } from '@/stores/next-track-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

/** 壳层内顶栏 W4 装配了 AI 同事面板（依赖 QueryClient 做确认后缓存失效）。 */
function renderShell(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextAppShell>{children}</NextAppShell>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useNextTrackStore.getState().reset()
  document.documentElement.removeAttribute('data-immersion')
})

describe('components/next/layout/NextAppShell（v3-ui-next-track-foundation tasks 3.1/3.2）', () => {
  test('新 Shell 渲染正常：极简顶栏 + 内容区 + 回到旧版入口', () => {
    renderShell(<p data-testid="shell-content">新轨内容</p>)

    // 壳容器挂 [data-next-track]（令牌作用域）与 data-immersion（沉浸档位）。
    const shell = document.querySelector('[data-next-track]')
    expect(shell).toBeTruthy()
    expect(shell?.getAttribute('data-immersion')).toBe('immersive')

    // 极简顶栏框架与内容区
    expect(screen.getByText('开项 Kaiplan')).toBeInTheDocument()
    expect(screen.getByTestId('shell-content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /回到旧版/ })).toBeInTheDocument()
  })

  test('DOM 中不包含任何旧版侧边栏 / 旧版顶栏 / 旧版 ProjectHeader 标记', () => {
    // 旧顶栏根节点带 data-topbar，旧侧边栏根节点带 data-collapsed——两者都不允许出现。
    renderShell(null)
    expect(document.querySelector('[data-topbar]')).toBeNull()
    expect(document.querySelector('[data-collapsed]')).toBeNull()

    // 旧轨专属文案/结构也不得出现
    expect(screen.queryByText(/项目列表/)).not.toBeInTheDocument()
    const legacySidebarNav = document.querySelector('nav')
    expect(legacySidebarNav?.textContent ?? '').not.toContain('项目列表')
    expect(screen.queryByRole('button', { name: /折叠侧栏/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /外观菜单/ })).not.toBeInTheDocument()
  })
})
