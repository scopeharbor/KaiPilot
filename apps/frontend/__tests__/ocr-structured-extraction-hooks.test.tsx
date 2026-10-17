/**
 * OCR Structured Extraction — TanStack Query Hooks 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api/ocr-structured-extraction', () => ({
  ocrStructuredExtractionApi: { listProfiles: vi.fn() },
}))

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

import { ocrStructuredExtractionApi } from '@/lib/api/ocr-structured-extraction'
import {
  ocrStructuredExtractionKeys,
  useOcrExtractionProfiles,
} from '../hooks/use-ocr-structured-extraction'

beforeEach(() => {
  vi.mocked(ocrStructuredExtractionApi.listProfiles).mockReset()
})

describe('ocrStructuredExtractionKeys', () => {
  it('generates correct all key', () => {
    expect(ocrStructuredExtractionKeys.all(1)).toEqual(['ocr-structured-extraction', 1])
  })

  it('generates correct profiles key', () => {
    expect(ocrStructuredExtractionKeys.profiles(1)).toEqual([
      'ocr-structured-extraction',
      1,
      'profiles',
    ])
  })

  it('generates correct profileList key', () => {
    const key = ocrStructuredExtractionKeys.profileList(1, { scope: 'builtin' })
    expect(key).toEqual(['ocr-structured-extraction', 1, 'profiles', 'list', { scope: 'builtin' }])
  })

  it('generates correct profileDetail key', () => {
    expect(ocrStructuredExtractionKeys.profileDetail(1, 5)).toEqual([
      'ocr-structured-extraction',
      1,
      'profiles',
      'detail',
      5,
    ])
  })

  it('generates correct runs key', () => {
    expect(ocrStructuredExtractionKeys.runs(1)).toEqual(['ocr-structured-extraction', 1, 'runs'])
  })

  it('generates correct runList key', () => {
    expect(ocrStructuredExtractionKeys.runList(1, { status: 'completed' })).toEqual([
      'ocr-structured-extraction',
      1,
      'runs',
      'list',
      { status: 'completed' },
    ])
  })

  it('generates correct runDetail key', () => {
    expect(ocrStructuredExtractionKeys.runDetail(1, 10)).toEqual([
      'ocr-structured-extraction',
      1,
      'runs',
      'detail',
      10,
    ])
  })

  it('generates correct runCandidates key', () => {
    expect(ocrStructuredExtractionKeys.runCandidates(1, 10)).toEqual([
      'ocr-structured-extraction',
      1,
      'runs',
      'candidates',
      10,
    ])
  })

  it('generates correct snapshots key', () => {
    expect(ocrStructuredExtractionKeys.snapshots(1)).toEqual([
      'ocr-structured-extraction',
      1,
      'snapshots',
    ])
  })

  it('generates correct snapshotList key', () => {
    expect(ocrStructuredExtractionKeys.snapshotList(1, { page: 1 })).toEqual([
      'ocr-structured-extraction',
      1,
      'snapshots',
      'list',
      { page: 1 },
    ])
  })

  it('generates correct snapshotDetail key', () => {
    expect(ocrStructuredExtractionKeys.snapshotDetail(1, 15)).toEqual([
      'ocr-structured-extraction',
      1,
      'snapshots',
      'detail',
      15,
    ])
  })
})

// query key 只证明「键长什么样」，不证明 hook 真的按该键取数；
// 这里补一条端到端行为用例：hook 必须把 params 透传给 API 且返回其结果。
describe('useOcrExtractionProfiles', () => {
  it('按 params 调用 API 并返回数据', async () => {
    const payload = { data: [{ id: 1, name: '内置发票' }], meta: { total: 1 } }
    vi.mocked(ocrStructuredExtractionApi.listProfiles).mockResolvedValue(payload as never)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useOcrExtractionProfiles(7, { scope: 'builtin' }), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ocrStructuredExtractionApi.listProfiles).toHaveBeenCalledWith(7, { scope: 'builtin' })
    expect(result.current.data).toEqual(payload)
  })

  it('projectId 为 0 时不发起请求', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useOcrExtractionProfiles(0), { wrapper: createWrapper(queryClient) })

    expect(ocrStructuredExtractionApi.listProfiles).not.toHaveBeenCalled()
  })
})

// 验证 hooks 可以被正确导入（不依赖 mock 数据）
describe('useOcrStructuredExtraction hooks imports', () => {
  it('all hooks are importable', async () => {
    const mod = await import('../hooks/use-ocr-structured-extraction')
    expect(mod.useOcrExtractionProfiles).toBeDefined()
    expect(mod.useOcrExtractionProfile).toBeDefined()
    expect(mod.useOcrExtractionRuns).toBeDefined()
    expect(mod.useOcrExtractionRun).toBeDefined()
    expect(mod.useOcrExtractionCandidates).toBeDefined()
    expect(mod.useOcrExtractionSnapshots).toBeDefined()
    expect(mod.useOcrExtractionSnapshot).toBeDefined()
    expect(mod.useCreateOcrExtractionProfile).toBeDefined()
    expect(mod.useUpdateOcrExtractionProfile).toBeDefined()
    expect(mod.useArchiveOcrExtractionProfile).toBeDefined()
    expect(mod.useCreateOcrExtractionRun).toBeDefined()
    expect(mod.useOcrStructuredExtractionPreview).toBeDefined()
    expect(mod.useOcrStructuredExtractionSave).toBeDefined()
  })
})
