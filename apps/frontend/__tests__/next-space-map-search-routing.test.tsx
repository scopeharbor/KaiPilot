/**
 * 空间地图搜索（2026-09-28）：
 * - 风险、变更等不再被归成「文件」，直达链接落在新版 /next 下真实存在的页面（原先 404）；
 * - 输入还在防抖 / 请求未返回时显示「正在搜索」，不先闪「未找到」。
 */
import * as React from 'react'
import { render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SearchResultItem } from '@aiproj/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
const searchMock = vi.fn()
vi.mock('@/lib/api/search', () => ({
  searchApi: { search: (...args: unknown[]) => searchMock(...args) },
}))

import {
  SpaceMapGlobalSearchLens,
  resolveCategory,
  resolveEntityDirectUrl,
} from '@/components/next/navigation/SpaceMapGlobalSearchLens'

function item(entityType: string, target: string, projectId: number | null = 6): SearchResultItem {
  return {
    entityType,
    entityId: 12,
    projectId,
    title: 't',
    summary: '',
    target,
  } as unknown as SearchResultItem
}

describe('分组与直达链接', () => {
  test('风险、变更、里程碑、报告各归各组，不再当成文件', () => {
    expect(resolveCategory('risk')).toBe('risk')
    expect(resolveCategory('change_request')).toBe('change_request')
    expect(resolveCategory('milestone')).toBe('milestone')
    expect(resolveCategory('report')).toBe('report')
    expect(resolveCategory('document')).toBe('file')
    expect(resolveCategory('comment')).toBe('other')
  })

  test('后端给的旧版路径不直接用，改到新版页面', () => {
    expect(resolveEntityDirectUrl(item('risk', '/projects/6/risks/12'))).toBe(
      '/next/projects/6/risks?focusRisk=12',
    )
    expect(resolveEntityDirectUrl(item('change_request', '/projects/6/change-requests/12'))).toBe(
      '/next/projects/6/change-requests/12',
    )
    expect(resolveEntityDirectUrl(item('file', '/projects/6/files/12'))).toBe(
      '/next/projects/6/files?focusFile=12',
    )
    // 没带 projectId 时从旧路径里取
    expect(resolveEntityDirectUrl(item('task', '/projects/5/tasks/12', null))).toBe(
      '/next/projects/5?focusTask=12',
    )
    expect(resolveEntityDirectUrl(item('member', '/users/3'))).toBe('/next/resources')
  })
})

describe('搜索中的状态', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('防抖与请求期间显示「正在搜索」，不先显示「未找到」', async () => {
    let resolve: (value: unknown) => void = () => {}
    searchMock.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<SpaceMapGlobalSearchLens query="2" showInput={false} />)
    expect(screen.getByTestId('search-pending-state')).toBeInTheDocument()
    expect(screen.queryByTestId('search-empty-state')).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByTestId('search-pending-state')).toBeInTheDocument()
    await act(async () => {
      resolve({ data: [] })
    })
    expect(screen.getByTestId('search-empty-state')).toBeInTheDocument()
  })
})
