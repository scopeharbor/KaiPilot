import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextAppShell } from '@/components/next/layout/NextAppShell'
import { NEXT_TRACK_STORAGE_KEY, useNextTrackStore } from '@/stores/next-track-store'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
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
  pushMock.mockReset()
  localStorage.clear()
  useNextTrackStore.getState().reset()
  document.documentElement.removeAttribute('data-immersion')
})

describe('「回到旧版」入口（v3-ui-next-track-foundation tasks 3.3/3.4）', () => {
  test('点击后更新持久化偏好为 legacy（source shell_switch）并导航至 /dashboard', () => {
    useNextTrackStore.getState().setTrack('next', 'topbar_button')
    renderShell(<p>占位</p>)

    fireEvent.click(screen.getByRole('button', { name: /回到旧版/ }))

    expect(useNextTrackStore.getState().track).toBe('legacy')
    expect(useNextTrackStore.getState().source).toBe('shell_switch')
    expect(pushMock).toHaveBeenCalledWith('/dashboard')

    // 持久化已落 localStorage（再次读取验证跨会话生效的契约）
    const persisted = JSON.parse(localStorage.getItem(NEXT_TRACK_STORAGE_KEY)!) as {
      state: { track: string }
    }
    expect(persisted.state.track).toBe('legacy')
  })

  test('未选择过新轨时点击仍可正常切回并导航', () => {
    renderShell(<p>占位</p>)
    fireEvent.click(screen.getByRole('button', { name: /回到旧版/ }))
    expect(useNextTrackStore.getState().track).toBe('legacy')
    expect(pushMock).toHaveBeenCalledWith('/dashboard')
  })
})
