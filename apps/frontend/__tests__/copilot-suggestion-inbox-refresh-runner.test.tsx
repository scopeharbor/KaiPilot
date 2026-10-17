import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api/suggestion-inbox', () => ({
  queryInbox: vi.fn(),
  getUnreadCount: vi.fn(),
  performAction: vi.fn(),
  refreshInbox: vi.fn(async () => ({
    aggregated: 0,
    created: 0,
    updated: 0,
    skippedTerminal: 0,
    missingSources: [],
    expired: 0,
  })),
}))

import { useInboxRefreshRunner } from '@/hooks/use-suggestion-inbox'

/**
 * 回归：收件箱展开后在挂载 effect 里自动刷新。原先用 useMutation 的 isPending，
 * StrictMode 模拟卸载后 observer 收不到完成通知，界面永远「加载中」。
 */
describe('useInboxRefreshRunner', () => {
  it('StrictMode 下由挂载 effect 触发的刷新完成后 refreshing 回到 false', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </React.StrictMode>
    )

    const { result } = renderHook(
      () => {
        const runner = useInboxRefreshRunner()
        const started = React.useRef(false)
        React.useEffect(() => {
          if (started.current) return
          started.current = true
          void runner.refresh(1)
        }, [runner])
        return runner
      },
      { wrapper },
    )

    await waitFor(() => expect(result.current.refreshing).toBe(false))
    const { refreshInbox } = await import('@/lib/api/suggestion-inbox')
    expect(refreshInbox).toHaveBeenCalledTimes(1)
  })
})
