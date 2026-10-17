import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { QueryProvider } from '@/providers/query-provider'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

const login = (id: number) =>
  useAuthStore.getState().setSession({
    user: { id, email: `${id}@test.local`, fullName: null, organizations: [] },
    accessToken: accessTokenWith([]),
    refreshToken: `r-${id}`,
  })
afterEach(cleanup)

test('同组织或缺组织时换账号也清空缓存、取消旧请求，token 轮换保留当前缓存', async () => {
  login(101)
  let client!: QueryClient
  const mounted = vi.fn()
  function Probe() {
    client = useQueryClient()
    useEffect(() => {
      mounted()
    }, [])
    return null
  }
  render(
    <QueryProvider>
      <Probe />
    </QueryProvider>,
  )
  client.setQueryData(['private-history'], ['A 私有内容'])
  act(() =>
    useAuthStore
      .getState()
      .setTokens({ accessToken: accessTokenWith([]), refreshToken: 'rotated' }),
  )
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(client.getQueryData(['private-history'])).toEqual(['A 私有内容'])
  let finish!: (data: string[]) => void
  const pending = client
    .fetchQuery({
      queryKey: ['late-history'],
      queryFn: () =>
        new Promise<string[]>((resolve) => {
          finish = resolve
        }),
    })
    .catch(() => undefined)
  act(() => login(102))
  expect(mounted).toHaveBeenCalledTimes(2)
  expect(client.getQueryData(['private-history'])).toBeUndefined()
  finish(['A 迟到内容'])
  await pending
  expect(client.getQueryData(['late-history'])).toBeUndefined()
  client.setQueryData(['private-history'], ['B 私有内容'])
  act(() => useAuthStore.getState().clear())
  expect(mounted).toHaveBeenCalledTimes(3)
  expect(client.getQueryData(['private-history'])).toBeUndefined()
})
