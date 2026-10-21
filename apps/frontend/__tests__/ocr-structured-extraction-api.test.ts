/**
 * OCR 结构化提取 API 客户端：路径、查询串与 HTTP 方法。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiFetch }))

import { ocrStructuredExtractionApi as api } from '@/lib/api/ocr-structured-extraction'

const BASE = '/projects/5/ocr/structured-extraction'

function lastCall() {
  return apiFetch.mock.calls.at(-1) as [string, RequestInit | undefined]
}

describe('ocrStructuredExtractionApi', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    apiFetch.mockResolvedValue({ data: null })
  })

  it('profile：列表查询串、详情、创建、更新与归档', async () => {
    await api.listProfiles(5)
    expect(lastCall()[0]).toBe(`${BASE}/profiles`)

    await api.listProfiles(5, { scope: 'project', status: 'active', page: 2, perPage: 10 })
    expect(lastCall()[0]).toBe(`${BASE}/profiles?scope=project&status=active&page=2&perPage=10`)

    await api.getProfile(5, 3)
    expect(lastCall()[0]).toBe(`${BASE}/profiles/3`)

    const input = { name: '发票' } as never
    await api.createProfile(5, input)
    expect(lastCall()).toEqual([
      `${BASE}/profiles`,
      { method: 'POST', body: JSON.stringify(input) },
    ])

    await api.updateProfile(5, 3, input)
    expect(lastCall()).toEqual([
      `${BASE}/profiles/3`,
      { method: 'PUT', body: JSON.stringify(input) },
    ])

    await api.archiveProfile(5, 3)
    expect(lastCall()).toEqual([`${BASE}/profiles/3/archive`, { method: 'PATCH' }])
  })

  it('run：创建、列表查询串、详情与候选', async () => {
    const input = { extractionId: 9 } as never
    await api.createRun(5, input)
    expect(lastCall()).toEqual([`${BASE}/runs`, { method: 'POST', body: JSON.stringify(input) }])

    await api.listRuns(5)
    expect(lastCall()[0]).toBe(`${BASE}/runs`)

    await api.listRuns(5, {
      extractionId: 9,
      profileId: 3,
      status: 'succeeded',
      provenance: 'ai',
      sort: '-createdAt',
      page: 1,
      perPage: 20,
    } as never)
    expect(lastCall()[0]).toBe(
      `${BASE}/runs?extractionId=9&profileId=3&status=succeeded&provenance=ai&sort=-createdAt&page=1&perPage=20`,
    )

    await api.getRun(5, 11)
    expect(lastCall()[0]).toBe(`${BASE}/runs/11`)

    await api.getCandidates(5, 11)
    expect(lastCall()[0]).toBe(`${BASE}/runs/11/candidates`)
  })

  it('确认预览、保存，以及快照列表与详情', async () => {
    const preview = { runId: 11 } as never
    await api.previewConfirmation(5, preview)
    expect(lastCall()).toEqual([
      `${BASE}/preview`,
      { method: 'POST', body: JSON.stringify(preview) },
    ])

    await api.saveConfirmation(5, preview)
    expect(lastCall()).toEqual([`${BASE}/save`, { method: 'POST', body: JSON.stringify(preview) }])

    await api.listSnapshots(5)
    expect(lastCall()[0]).toBe(`${BASE}/snapshots`)

    await api.listSnapshots(5, { extractionId: 9, profileId: 3, page: 2, perPage: 5 })
    expect(lastCall()[0]).toBe(`${BASE}/snapshots?extractionId=9&profileId=3&page=2&perPage=5`)

    await api.getSnapshot(5, 4)
    expect(lastCall()[0]).toBe(`${BASE}/snapshots/4`)
  })
})
