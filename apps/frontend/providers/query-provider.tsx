'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { queryRetry, setTenantScopeInvalidator } from '@/lib/api-client'
import { setSignalsChangeListener, setTaskDataChangeListener } from '@/lib/task-data-change-bus'
import { organizationSignalKeys, projectSignalKeys } from '@/lib/api/project-signals'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

export function QueryProvider({ children }: { children: ReactNode }) {
  const identityKey = useAuthStore(
    (state) =>
      `${state.user?.id ?? 'guest'}:${selectEffectiveOrganizationId(state) ?? 'none'}:${state.isAuthenticated}`,
  )
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: queryRetry },
          mutations: { retry: false },
        },
      }),
  )

  /**
   * 注册租户派生缓存清理器（v3-multitenant-tenant-identification §8.2）。
   *
   * 组织切换后必须清掉**全部**服务端态缓存，而不是按 query key 逐个失效：
   * 现有 query key 并未统一携带 organizationId，逐个失效必然漏掉某些键，
   * 而漏掉的那一条就是上一个组织的数据继续显示在新组织下。
   * `clear()` 代价是切换后要重新拉取——这是正确的取舍（design Decision 3：
   * 切换不复用旧派生数据）。
   */
  useEffect(() => {
    const clear = () => {
      client.cancelQueries()
      client.clear()
    }
    setTenantScopeInvalidator(clear)
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (
        state.user?.id !== previous.user?.id ||
        state.isAuthenticated !== previous.isAuthenticated ||
        selectEffectiveOrganizationId(state) !== selectEffectiveOrganizationId(previous)
      )
        clear()
    })
    return () => {
      unsubscribe()
      setTenantScopeInvalidator(null)
    }
  }, [client])

  // 非 React 写入方（AI 同事确认等）落库后统一失效任务相关缓存，所有视图联动刷新
  useEffect(() => {
    setTaskDataChangeListener((projectId) => {
      void invalidateTaskQueries(client, projectId)
    })
    setSignalsChangeListener(() => {
      void client.invalidateQueries({ queryKey: projectSignalKeys.all })
      void client.invalidateQueries({ queryKey: organizationSignalKeys.all })
    })
    return () => {
      setTaskDataChangeListener(null)
      setSignalsChangeListener(null)
    }
  }, [client])

  return (
    <QueryClientProvider client={client}>
      <Fragment key={identityKey}>{children}</Fragment>
    </QueryClientProvider>
  )
}
