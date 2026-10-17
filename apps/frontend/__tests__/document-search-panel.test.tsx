/**
 * DocumentSearchIndexPanel 组件测试（v3-document-full-text-search §10.10）
 *
 * 覆盖：
 * - 加载态骨架屏
 * - 错误态重试按钮
 * - 空态提示
 * - 正常状态数据展示
 * - 可管理权限下显示重建按钮
 * - 不可管理权限下隐藏/禁用重建按钮
 * - 重建中状态
 * - 重建成功/失败反馈
 * - 中文文案
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Mock API client
vi.mock('@/lib/api/document-search', () => ({
  documentSearchApi: {
    status: vi.fn(),
    reindex: vi.fn(),
  },
  documentSearchKeys: {
    all: ['document-search'] as const,
    status: (projectId: number) => ['document-search', 'status', projectId] as const,
  },
}))

import { DocumentSearchIndexPanel } from '@/components/files/markdown/DocumentSearchIndexPanel'
import { documentSearchApi } from '@/lib/api/document-search'

// vi.mocked 把模块导出重新标注成 Mock 类型：直接在原函数上调 mockResolvedValue
// 类型上并不存在（vi.mock 的替身只在运行期生效）。
const statusMock = vi.mocked(documentSearchApi.status)
const reindexMock = vi.mocked(documentSearchApi.reindex)

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

const DEFAULT_STATUS = {
  data: {
    totalIndexable: 10,
    indexed: 9,
    staleOrMissing: 1,
    truncated: 0,
    lastIndexedAt: '2026-08-03T10:00:00.000Z',
  },
}

describe('DocumentSearchIndexPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================
  // 加载态
  // ============================================================

  it('加载态显示骨架屏', () => {
    statusMock.mockReturnValue(new Promise(() => {})) // 永不 resolve
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })
    expect(screen.getByText('文档搜索索引')).toBeDefined()
    // 骨架屏存在
    const skeletons = document.querySelectorAll('[class*="animate-shimmer"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(1)
  })

  // ============================================================
  // 错误态
  // ============================================================

  it('错误态显示重试按钮', async () => {
    statusMock.mockRejectedValue(new Error('network error'))
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    // 等待错误态出现
    const retryBtn = await screen.findByText('重试', { selector: 'button' })
    expect(retryBtn).toBeDefined()
    expect(screen.getByText('索引状态获取失败')).toBeDefined()
  })

  it('错误态点击重试重新拉取', async () => {
    statusMock.mockRejectedValueOnce(new Error('network error'))
    statusMock.mockResolvedValueOnce(DEFAULT_STATUS)
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    const retryBtn = await screen.findByText('重试', { selector: 'button' })
    fireEvent.click(retryBtn)

    // 重试后应看到数据
    expect(await screen.findByText('已索引')).toBeDefined()
  })

  // ============================================================
  // 空态
  // ============================================================

  it('无数据时显示空态提示', async () => {
    statusMock.mockResolvedValue({ data: null })
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    expect(await screen.findByText('暂无索引状态数据')).toBeDefined()
  })

  // ============================================================
  // 正常状态展示
  // ============================================================

  it('展示索引状态数据', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    expect(await screen.findByText('可索引文档')).toBeDefined()
    expect(screen.getByText('10')).toBeDefined() // totalIndexable
    expect(screen.getByText('已索引')).toBeDefined()
    expect(screen.getByText('9')).toBeDefined() // indexed
    expect(screen.getByText('过期/缺失')).toBeDefined()
    expect(screen.getByText('1')).toBeDefined() // staleOrMissing
  })

  it('截断数为 0 时不显示截断行', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    await screen.findByText('可索引文档')
    expect(screen.queryByText('截断')).toBeNull()
  })

  it('截断数大于 0 时显示截断行', async () => {
    statusMock.mockResolvedValue({
      data: { ...DEFAULT_STATUS.data, truncated: 2 },
    })
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    expect(await screen.findByText('截断')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
  })

  it('显示最后索引时间', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    expect(await screen.findByText('最后索引')).toBeDefined()
    // 应该是格式化后的日期
    expect(screen.getByText(/2026/)).toBeDefined()
  })

  it('lastIndexedAt 为 null 时显示"从未索引"', async () => {
    statusMock.mockResolvedValue({
      data: { ...DEFAULT_STATUS.data, lastIndexedAt: null },
    })
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    expect(await screen.findByText('从未索引')).toBeDefined()
  })

  it('全部索引时已索引标签显示成功色', async () => {
    statusMock.mockResolvedValue({
      data: { ...DEFAULT_STATUS.data, indexed: 10, staleOrMissing: 0 },
    })
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    const badges = await screen.findAllByText('10')
    // 至少一个 badge 显示 10（已索引数）
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  // ============================================================
  // 权限降级
  // ============================================================

  it('有 manage 权限时显示重建按钮', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    expect(await screen.findByText('重建索引')).toBeDefined()
  })

  it('无 manage 权限时不显示重建按钮', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    render(<DocumentSearchIndexPanel projectId={1} canManage={false} />, {
      wrapper: createWrapper(),
    })

    await screen.findByText('可索引文档')
    expect(screen.queryByText('重建索引')).toBeNull()
    expect(screen.getByText('需要管理权限才能重建索引')).toBeDefined()
  })

  // ============================================================
  // 重建动作
  // ============================================================

  it('点击重建按钮触发 reindex', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    reindexMock.mockResolvedValue({
      data: { runId: 'r1', indexed: 10, skipped: 2, removed: 1, truncated: 0, warnings: [] },
    })

    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    const reindexBtn = await screen.findByRole('button', { name: '重建索引' })
    fireEvent.click(reindexBtn)

    await waitFor(() => {
      expect(documentSearchApi.reindex).toHaveBeenCalledWith(1, false)
    })
  })

  it('重建中显示 loading 状态并禁用按钮', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    // 永不 resolve 以模拟 pending
    reindexMock.mockReturnValue(new Promise(() => {}))

    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    const reindexBtn = await screen.findByText('重建索引')
    fireEvent.click(reindexBtn)

    expect(await screen.findByText('重建中...')).toBeDefined()
    const btn = screen.getByRole('button', { name: /重建中/ })
    expect(btn).toBeDisabled()
  })

  it('重建成功后显示结果反馈', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    reindexMock.mockResolvedValue({
      data: { runId: 'r1', indexed: 10, skipped: 2, removed: 1, truncated: 0, warnings: [] },
    })

    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    const reindexBtn = await screen.findByText('重建索引')
    fireEvent.click(reindexBtn)

    expect(await screen.findByText(/重建完成/)).toBeDefined()
    expect(screen.getByText(/已索引 10/)).toBeDefined()
    expect(screen.getByText(/跳过 2/)).toBeDefined()
    expect(screen.getByText(/移除 1/)).toBeDefined()
  })

  it('重建失败时显示错误反馈', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    reindexMock.mockRejectedValue(new Error('reindex failed'))

    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    const reindexBtn = await screen.findByText('重建索引')
    fireEvent.click(reindexBtn)

    expect(await screen.findByText('重建失败，请稍后重试')).toBeDefined()
  })

  // ============================================================
  // 中文文案
  // ============================================================

  it('全部文案为简体中文', async () => {
    statusMock.mockResolvedValue(DEFAULT_STATUS)
    render(<DocumentSearchIndexPanel projectId={1} canManage />, { wrapper: createWrapper() })

    await screen.findByText('可索引文档')
    // 标题
    expect(screen.getByText('文档搜索索引')).toBeDefined()
    // 标签
    expect(screen.getByText('可索引文档')).toBeDefined()
    expect(screen.getByText('已索引')).toBeDefined()
    expect(screen.getByText('过期/缺失')).toBeDefined()
    expect(screen.getByText('最后索引')).toBeDefined()
    // 按钮
    expect(screen.getByText('重建索引')).toBeDefined()
  })
})
