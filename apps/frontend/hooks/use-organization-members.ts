'use client'

import * as React from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import { membersApi, type OrganizationMember } from '@/lib/api-client'

const EMPTY: OrganizationMember[] = []

/** 没有 QueryClientProvider 的独立渲染（如组件单测）用的兜底客户端，不影响应用内缓存。 */
let fallbackClient: QueryClient | null = null

/**
 * 组织成员列表（@成员与审查页人员分配共用，缓存 1 分钟）。
 * 挂在没有 QueryClientProvider 的独立渲染里时改用兜底客户端，不让整个面板崩溃。
 */
export function useOrganizationMembers(
  organizationId: number | null,
  enabled = true,
): OrganizationMember[] {
  const provided = React.useContext(QueryClientContext)
  const client = provided ?? (fallbackClient ??= new QueryClient())
  const { data } = useQuery(
    {
      queryKey: ['organization-members', organizationId],
      queryFn: () => membersApi.list(organizationId as number),
      enabled: organizationId !== null && enabled,
      staleTime: 60_000,
      retry: false,
    },
    client,
  )
  return data ?? EMPTY
}
