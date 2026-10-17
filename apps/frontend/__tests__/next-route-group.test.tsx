import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import NextHomePage from '@/app/(next)/next/page'
import { NextAppShell } from '@/components/next/layout/NextAppShell'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => {
  localStorage.clear()
  useNextTrackStore.getState().reset()
  document.documentElement.removeAttribute('data-immersion')
  // 认证水合完成 + 未登录：首页走 unknown 桶通用欢迎语（v3-ui-next-shell-space-map 阵容）。
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
})

/**
 * /next 页面通过 (next) 路由组挂在根布局的共享 Provider 栈（Theme/Auth/Query/Realtime）
 * 之下；这里以 QueryClientProvider 包裹渲染，验证角色化首页与壳体的连通性。
 */
describe('新轨路由组挂载（v3-ui-next-track-foundation tasks 3.5/3.6）', () => {
  test('/next 角色化首页正确渲染在 NextAppShell 内（通用欢迎语 + 顶栏入口）', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <NextAppShell>
          <NextHomePage />
        </NextAppShell>
      </QueryClientProvider>,
    )

    // 旧占位标题「项目即空间」已由角色化首页取代：未登录兜底通用欢迎语（W3 阵容）。
    expect(screen.getByRole('heading', { name: '开项项目空间' })).toBeInTheDocument()
    expect(screen.getByText(/访客视角/)).toBeInTheDocument()
    expect(document.querySelector('[data-role-home]')).toBeTruthy()
    expect(document.querySelector('[data-next-track]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /回到旧版/ })).toBeInTheDocument()
  })

  test('(next) 路由组与新轨组件源码零旧 UI 布局 import', () => {
    const files = [
      join(process.cwd(), 'app/(next)/layout.tsx'),
      join(process.cwd(), 'app/(next)/next/page.tsx'),
      join(process.cwd(), 'components/next/layout/NextAppShell.tsx'),
    ]
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      // 只检查 import 语句（from '.../components/layout/...'），注释里的提及不算。
      expect(source, `${file} 引入了旧轨布局组件`).not.toMatch(
        /from\s+['"][^'"]*components\/layout\//,
      )
    }
  })
})
