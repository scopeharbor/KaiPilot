/**
 * 知识库浏览页（/knowledge）——列表渲染/筛选/审查抽屉回归测试。
 *
 * 修复背景（真实产品 bug）：
 * - `knowledgeApi.list` 曾用 `apiFetch`（lib/api-client.ts:198 会展开 `body.data`），
 *   运行时返回裸数组而页面按信封 `data?.data` 取值 → 恒显「暂无匹配」。
 * - 后端列表曾硬过滤 `status='active'` → 状态筛选死 UI、待审/草稿不可达。
 * - 详情端点曾返回低敏投影（契约要求完整 KnowledgeItem）→ 审查抽屉内容不可见。
 *
 * 覆盖：
 * - 列表能渲染 active 条目（不再恒「暂无匹配」，且显示 meta.total）；
 * - 状态筛选生效：选择「待审」后请求带 `status=pending` 并渲染待审条目；
 * - 审查抽屉流程打通：点击待审条目 → 展示完整记录（含 content）→「确认转正」可点击并调用确认 API。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'
import KnowledgePage from '../app/(dashboard)/knowledge/page'
import type { KnowledgeItem, KnowledgeItemLowSensitiveProjection } from '@aiproj/types'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchEnvelope: vi.fn(),
  can: vi.fn((_permission: string) => true),
}))

vi.mock('@/lib/api-client', () => ({
  apiFetch: mocks.apiFetch,
  apiFetchEnvelope: mocks.apiFetchEnvelope,
}))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: mocks.can }),
}))

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

/** 列表响应的低敏投影条目。 */
function projection(
  over: Partial<KnowledgeItemLowSensitiveProjection> = {},
): KnowledgeItemLowSensitiveProjection {
  return {
    id: 1,
    layer: 'L1',
    title: 'PMBOK 进度管理流程',
    status: 'active',
    domain: '进度管理',
    purpose: '规划',
    complexity: '中级',
    provenance: {
      sources: [{ layer: 'L1', sourceId: 'pmbok-7', title: 'PMBOK 第 7 版' }],
    },
    isSynthetic: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

/** 详情响应的完整记录（契约：GET /knowledge/:id → { data: KnowledgeItem }）。 */
function fullItem(over: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 7,
    organizationId: 1,
    layer: 'L1',
    layerMeta: {
      layer: 'L1',
      trust: '高（规范）',
      source: '权威标准',
      usage: '直接引用',
      frequency: '定期评审',
      annotation: [],
    },
    title: '待审查知识条目',
    content: '待审正文内容',
    status: 'pending',
    domain: '进度管理',
    purpose: '规划',
    complexity: '中级',
    provenance: {
      sources: [{ layer: 'L1', sourceId: 'src-1', title: '来源 1' }],
      reviewHistory: [
        {
          reviewer: 1,
          action: 'transition_draft_to_pending',
          timestamp: '2026-08-02T00:00:00.000Z',
        },
      ],
    },
    isSynthetic: false,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  }
}

const emptyMeta = { total: 0, page: 1, perPage: 20, totalPages: 0 }
const oneMeta = { total: 1, page: 1, perPage: 20, totalPages: 1 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/knowledge 知识库浏览页回归', () => {
  it('列表能渲染 active 条目并显示总数（不再恒显「暂无匹配」）', async () => {
    mocks.apiFetchEnvelope.mockResolvedValue({
      data: [projection({ id: 1, title: 'PMBOK 进度管理流程', status: 'active' })],
      meta: oneMeta,
    })
    const client = newClient()
    render(<KnowledgePage />, { wrapper: wrapper(client) })

    expect(await screen.findByText('PMBOK 进度管理流程')).toBeInTheDocument()
    expect(screen.queryByText('暂无匹配的知识记录。')).not.toBeInTheDocument()
    expect(screen.getByText(/共 1 条/)).toBeInTheDocument()
  })

  it('状态筛选生效：选「待审」后请求带 status=pending 并渲染待审条目', async () => {
    // 首次请求（无筛选）返回空；选择状态后带 status=pending 的请求返回待审条目
    mocks.apiFetchEnvelope.mockResolvedValueOnce({ data: [], meta: emptyMeta }).mockResolvedValue({
      data: [projection({ id: 2, title: '待审候选知识', status: 'pending' })],
      meta: oneMeta,
    })
    const client = newClient()
    render(<KnowledgePage />, { wrapper: wrapper(client) })
    await waitFor(() => expect(screen.getByText('暂无匹配的知识记录。')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('combobox', { name: '状态筛选' }))
    fireEvent.click(await screen.findByRole('option', { name: '待审' }))

    await waitFor(() =>
      expect(mocks.apiFetchEnvelope).toHaveBeenLastCalledWith('/knowledge?status=pending'),
    )
    expect(await screen.findByText('待审候选知识')).toBeInTheDocument()
    // 行内状态徽标为「待审」（注销后可能残留下拉项同名文本，故限定在行内断言）
    const row = screen.getByText('待审候选知识').closest('button')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('待审')).toBeInTheDocument()
  })

  it('审查抽屉流程：点击待审条目展示完整记录并可「确认转正」', async () => {
    mocks.apiFetchEnvelope
      .mockResolvedValueOnce({
        data: [projection({ id: 7, title: '待审查知识条目', status: 'pending' })],
        meta: oneMeta,
      })
      .mockResolvedValueOnce({ data: fullItem() })
      // 确认成功 invalidate 列表后的 refetch 兜底
      .mockResolvedValue({ data: [], meta: emptyMeta })
    mocks.apiFetch.mockResolvedValue({ data: fullItem({ status: 'active' }) })
    const client = newClient()
    render(<KnowledgePage />, { wrapper: wrapper(client) })

    const row = await screen.findByText('待审查知识条目')
    fireEvent.click(row)

    // 详情请求按契约拿到完整记录：正文、审核历史、确认按钮都在
    expect(await screen.findByText('确认转正')).toBeInTheDocument()
    expect(screen.getByText('待审正文内容')).toBeInTheDocument()
    expect(screen.getByText('transition_draft_to_pending')).toBeInTheDocument()
    expect(screen.getByText('高（规范）')).toBeInTheDocument()

    // 点击「确认转正」→ 调用 POST /knowledge/7/confirm
    fireEvent.click(screen.getByText('确认转正'))
    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        '/knowledge/7/confirm',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })
})
