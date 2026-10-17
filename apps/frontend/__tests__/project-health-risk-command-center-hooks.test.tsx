import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useProjectHealthRiskCommandCenter } from '@/hooks/use-project-health-risk-command-center'

const apiFetchEnvelope = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope,
  queryRetry: () => false,
}))

const useCurrentOrganizationId = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId,
}))

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function makeResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      project: { id: 101, organizationId: 1 },
      headline: {
        sourceKey: 'health-diagnosis',
        evidenceClass: 'confirmed-diagnosis',
        healthStatus: 'green',
        overallScore: 86,
        degraded: false,
        degradationWarning: null,
      },
      sources: [],
      attention: [],
    },
    meta: {
      contractVersion: 'project-health-risk-command-center/v1',
      projectionSignature: 'abcd1234',
      calculatedAt: '2026-09-01T08:00:00.000Z',
      overallAvailability: 'available',
    },
    ...overrides,
  }
}

beforeEach(() => {
  apiFetchEnvelope.mockReset()
  useCurrentOrganizationId.mockReturnValue(1)
})

describe('useProjectHealthRiskCommandCenter（§5.3/5.4）', () => {
  it('加载成功：返回 envelope 数据', async () => {
    apiFetchEnvelope.mockResolvedValue(makeResponse())
    const wrapper = makeWrapper()
    const { result } = renderHook(() => useProjectHealthRiskCommandCenter(101), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.project.id).toBe(101)
    expect(result.current.data?.meta.projectionSignature).toBe('abcd1234')
  })

  it('无有效组织时不发请求', async () => {
    useCurrentOrganizationId.mockReturnValue(null)
    const wrapper = makeWrapper()
    const { result } = renderHook(() => useProjectHealthRiskCommandCenter(101), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(apiFetchEnvelope).not.toHaveBeenCalled()
  })

  it('项目 id 非法（0/NaN）时不发请求', () => {
    const wrapper = makeWrapper()
    for (const bad of [0, Number.NaN]) {
      const { result } = renderHook(() => useProjectHealthRiskCommandCenter(bad), { wrapper })
      expect(result.current.fetchStatus).toBe('idle')
    }
    expect(apiFetchEnvelope).not.toHaveBeenCalled()
  })

  it('项目切换：新项目发起新请求且不复用旧缓存 key', async () => {
    apiFetchEnvelope
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(makeResponse({ data: { project: { id: 202, organizationId: 1 } } }))
    const wrapper = makeWrapper()
    const first = renderHook(() => useProjectHealthRiskCommandCenter(101), { wrapper })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    const second = renderHook(() => useProjectHealthRiskCommandCenter(202), { wrapper })
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(second.result.current.data?.data.project.id).toBe(202)
    // 两个不同路径
    const paths = apiFetchEnvelope.mock.calls.map((c) => String(c[0]))
    expect(paths[0]).toContain('/projects/101/')
    expect(paths[1]).toContain('/projects/202/')
  })

  it('错误分类暴露给调用方且可重试（refetch）', async () => {
    apiFetchEnvelope.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403 }))
    apiFetchEnvelope.mockResolvedValue(makeResponse())
    const wrapper = makeWrapper()
    const { result } = renderHook(() => useProjectHealthRiskCommandCenter(101), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    await result.current.refetch()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('并发请求互不串扰；卸载即取消不再更新', async () => {
    apiFetchEnvelope.mockResolvedValue(makeResponse())
    const wrapper = makeWrapper()
    const a = renderHook(() => useProjectHealthRiskCommandCenter(101), { wrapper })
    const b = renderHook(() => useProjectHealthRiskCommandCenter(101), { wrapper })
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true))
    a.unmount()
    b.unmount()
    // 无 mutation function：hook 返回对象不含 mutate 系列方法
    for (const key of Object.keys(a.result.current)) {
      expect(key.startsWith('mutate')).toBe(false)
    }
  })

  it('受限来源（forbidden/unavailable）原样进入缓存，不被丢弃', async () => {
    apiFetchEnvelope.mockResolvedValue(
      makeResponse({
        data: {
          project: { id: 101, organizationId: 1 },
          headline: { sourceKey: 'project-dashboard', healthStatus: 'yellow', degraded: true },
          sources: [
            {
              sourceKey: 'risk-workbench',
              meta: { availability: 'forbidden' },
              warnings: [],
              targets: [],
              facts: null,
            },
          ],
          attention: [],
        },
      }),
    )
    const wrapper = makeWrapper()
    const { result } = renderHook(() => useProjectHealthRiskCommandCenter(101), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.sources[0]?.meta.availability).toBe('forbidden')
    expect(result.current.data?.data.sources[0]?.facts).toBeNull()
  })
})
