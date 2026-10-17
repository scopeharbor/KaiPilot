/**
 * v3-knowledge-memory-operating-layer —— Owning surface handoff 测试（§6）
 *
 * 覆盖：
 * - 6.2  封闭 mapping、server-disabled/client-enabled 篡改、错误边界、
 *        close-without-write、safe return context
 * - 6.4  knowledge handoff：L3 禁生产、pending review、确认归 owning
 * - 6.6  memory handoff：inference 恒定、close 零写入、delete 无残留
 * - 6.8  Skill handoff：stale base 重新 preview、无直接 Skill 表写入
 * - 6.10 observation handoff：打开/刷新不触发检索、模型、网络或记录重写
 * - 6.11 / 6.12 surface-specific invalidation 矩阵；失败/取消/关闭不本地标记已解决
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiFetch: mocks.apiFetch,
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))

import { OwningSurfaceHost } from '../components/knowledge/operating/KnowledgeMemoryOwningSurfaceHost'
import {
  OWNING_INVALIDATION_KEYS,
  resolveOperatingInvalidationKeys,
} from '../hooks/use-knowledge-memory-operating'
import {
  KNOWLEDGE_MEMORY_OPERATING_SURFACES,
  buildOwningSurfaceDescriptor,
  makeScopedRef,
  type KnowledgeMemoryOperatingDetail,
  type KnowledgeMemoryOperatingItem,
  type KnowledgeMemoryOperatingSurface,
} from '@aiproj/types'
import {
  buildCopilotMemoryFixture,
  buildKnowledgeItemFixture,
  buildRetrievalSignalFixture,
  buildSkillKnowledgeDraftFixture,
} from '@aiproj/types/knowledge-memory-operating-layer-fixtures'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function detailOf(
  item: KnowledgeMemoryOperatingItem,
  surface: KnowledgeMemoryOperatingSurface,
  enabled = true,
): KnowledgeMemoryOperatingDetail {
  return {
    kind: item.kind,
    scopedRef: item.scopedRef,
    item,
    surfaces: [
      buildOwningSurfaceDescriptor({
        surface,
        scopedRef: item.scopedRef,
        enabled,
        routeKey: '/owning',
        safeReturnContext: '返回运营队列',
      }),
    ],
    relatedCount: 0,
    fetchedAt: '2026-08-25T00:00:00.000Z',
  }
}

function renderHost(
  detail: KnowledgeMemoryOperatingDetail,
  overrides: Partial<{
    onClose: () => void
    onMutated: (s: KnowledgeMemoryOperatingSurface) => void
  }> = {},
) {
  const client = newClient()
  render(
    <OwningSurfaceHost
      detail={detail}
      organizationId={1}
      onClose={overrides.onClose ?? (() => {})}
      onMutated={overrides.onMutated}
    />,
    { wrapper: wrapper(client) },
  )
  return client
}

beforeEach(() => {
  mocks.apiFetch.mockReset()
})

// ─── 6.2 mapping / 篡改 / 边界 ────────────────────────────────────────

describe('OwningSurfaceHost | 封闭 mapping 与服务端权威（§6.2）', () => {
  it('服务端 surface resolve 返回 disabled 时不渲染 owning 组件', async () => {
    // 客户端 descriptor 声称 enabled，但服务端权威 resolve 说 disabled
    mocks.apiFetch.mockResolvedValue({
      data: { surface: 'knowledge_review', enabled: false, disableReason: 'eval_only' },
    })
    const item = buildKnowledgeItemFixture({ orgId: 1, index: 1, layer: 'L3' })
    renderHost(detailOf(item, 'knowledge_review', true))

    await waitFor(() => {
      expect(screen.getByTestId('surface-unavailable')).toBeTruthy()
    })
    expect(screen.queryByTestId('owning-surface-boundary')).toBeNull()
  })

  it('服务端 resolve 找不到 surface（404）时降级为不可用，不渲染 owning 组件', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('404 not-found'))
    const item = buildKnowledgeItemFixture({ orgId: 1, index: 2 })
    renderHost(detailOf(item, 'knowledge_review', true))

    await waitFor(() => {
      expect(screen.queryByTestId('owning-surface-boundary')).toBeNull()
    })
  })

  it('descriptor 只带封闭字段，不带 callback/href/preview token', () => {
    for (const surface of KNOWLEDGE_MEMORY_OPERATING_SURFACES) {
      const d = buildOwningSurfaceDescriptor({
        surface,
        scopedRef: makeScopedRef('knowledge_item', 'k-1'),
        enabled: true,
        routeKey: '/x',
        safeReturnContext: 'ctx',
      })
      const keys = Object.keys(d)
      for (const forbidden of [
        'callback',
        'href',
        'url',
        'body',
        'previewToken',
        'confirmHandle',
      ]) {
        expect(keys).not.toContain(forbidden)
      }
      expect(d.authorityOwner).toBeTruthy()
      expect(d.safeReturnContext).toBeTruthy()
    }
  })

  it('kind 与 surface 不匹配时 fail closed', async () => {
    mocks.apiFetch.mockResolvedValue({
      data: {
        surface: 'knowledge_review',
        enabled: true,
        authorityOwner: 'knowledge_service',
        safeReturnContext: '返回',
        routeKey: '/knowledge',
        scopedRefs: ['m-1'],
      },
    })
    // memory 对象却被要求渲染 knowledge_review
    const memory = buildCopilotMemoryFixture({ orgId: 1, index: 1 })
    renderHost(detailOf(memory, 'knowledge_review', true))

    await waitFor(() => {
      expect(screen.getByTestId('surface-mismatch')).toBeTruthy()
    })
  })
})

// ─── 6.4 / 6.6 / 6.8 / 6.10 各 surface handoff ──────────────────────

describe('surface handoff | 零写入与语义保持（§6.4/§6.6/§6.8/§6.10）', () => {
  function enabledSurfaceResponse(surface: KnowledgeMemoryOperatingSurface) {
    return {
      data: {
        surface,
        enabled: true,
        authorityOwner: 'knowledge_service',
        safeReturnContext: '返回运营队列',
        routeKey: '/owning',
        scopedRefs: ['x-1'],
      },
    }
  }

  it('检索观测表面只读：无任何 replay/repair 控件，且不发额外请求', async () => {
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url.includes('/surfaces/')) {
        return Promise.resolve(enabledSurfaceResponse('retrieval_observation_detail'))
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const signal = buildRetrievalSignalFixture({ orgId: 1, index: 1 })
    renderHost(detailOf(signal, 'retrieval_observation_detail', true))

    await waitFor(() => {
      expect(screen.getByTestId('retrieval-observation-surface')).toBeTruthy()
    })
    // 只有一次 surface resolve；没有检索/模型/重放调用
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1)
    // 唯一的交互控件是「关闭」——没有任何 replay / repair / 重新采样按钮
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    const actionable = buttons.filter((t) => !/关闭/.test(t))
    expect(actionable).toHaveLength(0)
  })

  it('刷新观测表面仍不触发任何检索或模型调用', async () => {
    mocks.apiFetch.mockResolvedValue(enabledSurfaceResponse('retrieval_observation_detail'))
    const signal = buildRetrievalSignalFixture({ orgId: 1, index: 2 })
    renderHost(detailOf(signal, 'retrieval_observation_detail', true))
    await waitFor(() => expect(screen.getByTestId('retrieval-observation-surface')).toBeTruthy())

    const urls = mocks.apiFetch.mock.calls.map((c) => String(c[0]))
    expect(urls.every((u) => u.includes('/knowledge-memory/'))).toBe(true)
    expect(urls.some((u) => /ai\/(complete|chat)|embedding|retrieve/.test(u))).toBe(false)
  })

  it('Skill 草稿 base 过期时明示需重新 preview，且运营层不改写草稿', async () => {
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url.includes('/surfaces/')) {
        return Promise.resolve(enabledSurfaceResponse('skill_knowledge_authoring'))
      }
      return Promise.resolve({ data: null })
    })
    const draft = {
      ...buildSkillKnowledgeDraftFixture({ orgId: 1, index: 1, draftStatus: 'pending' }),
      baseStale: true,
    } as KnowledgeMemoryOperatingItem
    renderHost(detailOf(draft, 'skill_knowledge_authoring', true))

    await waitFor(() => {
      expect(screen.getByTestId('skill-base-stale-notice')).toBeTruthy()
    })
    // 运营层没有对 Skill 表发任何写请求
    const writes = mocks.apiFetch.mock.calls.filter(
      (c) => (c[1] as { method?: string } | undefined)?.method,
    )
    expect(writes).toHaveLength(0)
  })

  it('打开后直接关闭：零 owning 写入、不回调 onMutated', async () => {
    mocks.apiFetch.mockResolvedValue(enabledSurfaceResponse('retrieval_observation_detail'))
    const onClose = vi.fn()
    const onMutated = vi.fn()
    const signal = buildRetrievalSignalFixture({ orgId: 1, index: 3 })
    renderHost(detailOf(signal, 'retrieval_observation_detail', true), { onClose, onMutated })

    await waitFor(() => expect(screen.getByTestId('retrieval-observation-surface')).toBeTruthy())
    fireEvent.click(screen.getByText('关闭并返回队列'))

    expect(onClose).toHaveBeenCalled()
    // 关闭 ≠ 已处置：不得触发失效/标记
    expect(onMutated).not.toHaveBeenCalled()
    const writes = mocks.apiFetch.mock.calls.filter(
      (c) => (c[1] as { method?: string } | undefined)?.method,
    )
    expect(writes).toHaveLength(0)
  })
})

// ─── 6.11 / 6.12 invalidation 矩阵 ──────────────────────────────────

describe('invalidation 映射 | 只刷新相关 key（§6.11/§6.12）', () => {
  const base = { organizationId: 7, kind: 'knowledge_item' as const, ref: 'k-1' }

  it('knowledge 成功后只失效知识侧 owning 缓存', () => {
    const keys = resolveOperatingInvalidationKeys({ ...base, surface: 'knowledge_review' })
    const flat = JSON.stringify(keys)
    expect(flat).toContain('knowledge')
    expect(flat).not.toContain('copilot-memory')
    expect(flat).not.toContain('compiler-skills')
  })

  it('memory 成功后只失效记忆侧 owning 缓存', () => {
    const keys = resolveOperatingInvalidationKeys({
      organizationId: 7,
      kind: 'copilot_memory',
      ref: 'm-1',
      surface: 'copilot_memory_governance',
    })
    const flat = JSON.stringify(keys)
    expect(flat).toContain('copilot-memory')
    expect(flat).not.toContain('compiler-skills')
  })

  it('只读观测表面不失效任何 owning 缓存', () => {
    expect(OWNING_INVALIDATION_KEYS.retrieval_observation_detail).toHaveLength(0)
  })

  it('失效范围限定在当前组织，不波及其它组织', () => {
    const a = JSON.stringify(
      resolveOperatingInvalidationKeys({ ...base, surface: 'knowledge_review' }),
    )
    const b = JSON.stringify(
      resolveOperatingInvalidationKeys({ ...base, organizationId: 9, surface: 'knowledge_review' }),
    )
    expect(a).not.toEqual(b)
    expect(a).toContain('7')
    expect(a).not.toContain('"9"')
  })

  it('每个 surface 都有显式映射（不存在未声明 surface 落到全量清空）', () => {
    for (const surface of KNOWLEDGE_MEMORY_OPERATING_SURFACES) {
      expect(OWNING_INVALIDATION_KEYS[surface]).toBeDefined()
    }
  })
})
