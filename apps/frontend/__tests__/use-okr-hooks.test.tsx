/**
 * OKR hooks：查询键、启用条件、调用的 API，以及 mutation 成功后失效的缓存。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apis } = vi.hoisted(() => {
  const resolved = () => vi.fn().mockResolvedValue({ data: 'ok' })
  return {
    apis: {
      okrCyclesApi: {
        list: resolved(),
        get: resolved(),
        create: resolved(),
        update: resolved(),
        archive: resolved(),
      },
      okrObjectivesApi: {
        list: resolved(),
        get: resolved(),
        create: resolved(),
        update: resolved(),
      },
      okrTreeApi: { get: resolved() },
      okrKeyResultsApi: { list: resolved(), create: resolved(), update: resolved() },
      okrProgressApi: { update: resolved(), history: resolved() },
      okrAlignmentsApi: { create: resolved() },
      okrEvidenceApi: { list: resolved(), create: resolved() },
      okrAiDraftApi: { generate: resolved(), confirm: resolved() },
      okrBackflowApi: {
        list: resolved(),
        get: resolved(),
        recalculate: resolved(),
        batchRecalculate: resolved(),
        confirm: resolved(),
        reject: resolved(),
      },
    },
  }
})

vi.mock('@/lib/api/okr', () => apis)

import * as okr from '@/hooks/use-okr'

const ORG = 3
let client: QueryClient

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  for (const group of Object.values(apis)) for (const fn of Object.values(group)) fn.mockClear()
})

describe('okrKeys', () => {
  it('键按组织分层，详情键挂在列表键下', () => {
    expect(okr.okrKeys.cycleList(ORG)).toEqual(['okr', ORG, 'cycles', {}])
    expect(okr.okrKeys.progressHistory(ORG, 9)).toEqual([
      'okr',
      ORG,
      'keyResults',
      9,
      'progressHistory',
    ])
    expect(okr.okrKeys.alignments(ORG, 4)).toEqual(['okr', ORG, 'objectives', 4, 'alignments'])
    expect(okr.okrKeys.evidenceList(ORG, { page: 2 } as never)).toEqual([
      'okr',
      ORG,
      'evidence',
      { page: 2 },
    ])
    expect(okr.okrKeys.tree(ORG)).toEqual(['okr', ORG, 'tree', {}])
    expect(okr.okrBackflowKeys.suggestion(ORG, 5)).toEqual([
      'okr',
      ORG,
      'backflow',
      'suggestions',
      5,
    ])
  })
})

describe('OKR 查询 hooks', () => {
  const cases: Array<[string, () => unknown, ReturnType<typeof vi.fn>, unknown[]]> = [
    ['useOkrCycles', () => okr.useOkrCycles(ORG), apis.okrCyclesApi.list, [ORG, {}]],
    ['useOkrCycle', () => okr.useOkrCycle(ORG, 1), apis.okrCyclesApi.get, [ORG, 1]],
    ['useOkrObjectives', () => okr.useOkrObjectives(ORG), apis.okrObjectivesApi.list, [ORG, {}]],
    ['useOkrObjective', () => okr.useOkrObjective(ORG, 2), apis.okrObjectivesApi.get, [ORG, 2]],
    ['useOkrTree', () => okr.useOkrTree(ORG), apis.okrTreeApi.get, [ORG, {}]],
    ['useOkrKeyResults', () => okr.useOkrKeyResults(ORG), apis.okrKeyResultsApi.list, [ORG, {}]],
    [
      'useOkrProgressHistory',
      () => okr.useOkrProgressHistory(ORG, 4),
      apis.okrProgressApi.history,
      [ORG, 4],
    ],
    ['useOkrEvidence', () => okr.useOkrEvidence(ORG), apis.okrEvidenceApi.list, [ORG, {}]],
    [
      'useOkrBackflowSuggestions',
      () => okr.useOkrBackflowSuggestions(ORG),
      apis.okrBackflowApi.list,
      [ORG, {}],
    ],
    [
      'useOkrBackflowSuggestion',
      () => okr.useOkrBackflowSuggestion(ORG, 6),
      apis.okrBackflowApi.get,
      [ORG, 6],
    ],
  ]

  it.each(cases)('%s 调用对应 API', async (_name, hook, api, args) => {
    const { result } = renderHook(hook as () => { isSuccess: boolean }, { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api).toHaveBeenCalledWith(...args)
  })

  it('组织或资源 ID 非正数时不请求', () => {
    renderHook(() => okr.useOkrCycles(0), { wrapper })
    renderHook(() => okr.useOkrCycle(ORG, 0), { wrapper })
    renderHook(() => okr.useOkrObjective(ORG, 0), { wrapper })
    renderHook(() => okr.useOkrProgressHistory(ORG, 0), { wrapper })
    renderHook(() => okr.useOkrBackflowSuggestion(ORG, 0), { wrapper })
    expect(apis.okrCyclesApi.list).not.toHaveBeenCalled()
    expect(apis.okrCyclesApi.get).not.toHaveBeenCalled()
    expect(apis.okrObjectivesApi.get).not.toHaveBeenCalled()
    expect(apis.okrProgressApi.history).not.toHaveBeenCalled()
    expect(apis.okrBackflowApi.get).not.toHaveBeenCalled()
  })
})

describe('OKR mutation hooks', () => {
  type Mut = { mutateAsync: (v: never) => Promise<unknown> }
  const cases: Array<
    [
      string,
      () => Mut,
      unknown,
      ReturnType<typeof vi.fn>,
      unknown[],
      ReadonlyArray<readonly unknown[]>,
    ]
  > = [
    [
      'useCreateOkrCycle',
      () => okr.useCreateOkrCycle(ORG) as Mut,
      { name: 'Q4' },
      apis.okrCyclesApi.create,
      [ORG, { name: 'Q4' }],
      [okr.okrKeys.cycles(ORG)],
    ],
    [
      'useUpdateOkrCycle',
      () => okr.useUpdateOkrCycle(ORG) as Mut,
      { cycleId: 1, input: { name: 'x' } },
      apis.okrCyclesApi.update,
      [ORG, 1, { name: 'x' }],
      [okr.okrKeys.cycles(ORG), okr.okrKeys.cycle(ORG, 1)],
    ],
    [
      'useArchiveOkrCycle',
      () => okr.useArchiveOkrCycle(ORG) as Mut,
      1,
      apis.okrCyclesApi.archive,
      [ORG, 1],
      [okr.okrKeys.cycles(ORG)],
    ],
    [
      'useCreateOkrObjective',
      () => okr.useCreateOkrObjective(ORG) as Mut,
      { title: 'o' },
      apis.okrObjectivesApi.create,
      [ORG, { title: 'o' }],
      [okr.okrKeys.objectives(ORG), okr.okrKeys.all(ORG)],
    ],
    [
      'useUpdateOkrObjective',
      () => okr.useUpdateOkrObjective(ORG) as Mut,
      { objectiveId: 2, input: { title: 'p' } },
      apis.okrObjectivesApi.update,
      [ORG, 2, { title: 'p' }],
      [okr.okrKeys.objectives(ORG), okr.okrKeys.objective(ORG, 2)],
    ],
    [
      'useCreateOkrKeyResult',
      () => okr.useCreateOkrKeyResult(ORG) as Mut,
      { title: 'kr' },
      apis.okrKeyResultsApi.create,
      [ORG, { title: 'kr' }],
      [okr.okrKeys.keyResults(ORG), okr.okrKeys.all(ORG)],
    ],
    [
      'useUpdateOkrKeyResult',
      () => okr.useUpdateOkrKeyResult(ORG) as Mut,
      { krId: 4, input: { title: 'k' } },
      apis.okrKeyResultsApi.update,
      [ORG, 4, { title: 'k' }],
      [okr.okrKeys.keyResults(ORG), okr.okrKeys.keyResult(ORG, 4)],
    ],
    [
      'useUpdateOkrProgress',
      () => okr.useUpdateOkrProgress(ORG) as Mut,
      { krId: 4, input: { value: 5 } },
      apis.okrProgressApi.update,
      [ORG, 4, { value: 5 }],
      [
        okr.okrKeys.keyResults(ORG),
        okr.okrKeys.keyResult(ORG, 4),
        okr.okrKeys.progressHistory(ORG, 4),
        okr.okrKeys.all(ORG),
      ],
    ],
    [
      'useCreateOkrAlignment',
      () => okr.useCreateOkrAlignment(ORG) as Mut,
      { a: 1 },
      apis.okrAlignmentsApi.create,
      [ORG, { a: 1 }],
      [okr.okrKeys.all(ORG)],
    ],
    [
      'useCreateOkrEvidence',
      () => okr.useCreateOkrEvidence(ORG) as Mut,
      { e: 1 },
      apis.okrEvidenceApi.create,
      [ORG, { e: 1 }],
      [okr.okrKeys.evidence(ORG)],
    ],
    [
      'useOkrAiDraft',
      () => okr.useOkrAiDraft(ORG) as Mut,
      { prompt: 'p' },
      apis.okrAiDraftApi.generate,
      [ORG, { prompt: 'p' }],
      [],
    ],
    [
      'useConfirmOkrAiDraft',
      () => okr.useConfirmOkrAiDraft(ORG) as Mut,
      { d: 1 },
      apis.okrAiDraftApi.confirm,
      [ORG, { d: 1 }],
      [okr.okrKeys.all(ORG)],
    ],
    [
      'useRecalculateOkrBackflow',
      () => okr.useRecalculateOkrBackflow(ORG) as Mut,
      4,
      apis.okrBackflowApi.recalculate,
      [ORG, 4],
      [okr.okrBackflowKeys.all(ORG)],
    ],
    [
      'useBatchRecalculateOkrBackflow',
      () => okr.useBatchRecalculateOkrBackflow(ORG) as Mut,
      { scope: 'cycle', scopeId: 1, maxKrCount: 10 },
      apis.okrBackflowApi.batchRecalculate,
      [ORG, 'cycle', 1, 10],
      [okr.okrBackflowKeys.all(ORG)],
    ],
    [
      'useConfirmOkrBackflow',
      () => okr.useConfirmOkrBackflow(ORG) as Mut,
      { suggestionId: 5, note: '好' },
      apis.okrBackflowApi.confirm,
      [ORG, 5, '好'],
      [okr.okrKeys.keyResults(ORG), okr.okrBackflowKeys.all(ORG)],
    ],
    [
      'useRejectOkrBackflow',
      () => okr.useRejectOkrBackflow(ORG) as Mut,
      { suggestionId: 5, reasonCode: 'stale', reasonNote: 'n' },
      apis.okrBackflowApi.reject,
      [ORG, 5, 'stale', 'n'],
      [okr.okrBackflowKeys.all(ORG)],
    ],
  ]

  it.each(cases)('%s 调用 API 并失效相关缓存', async (_name, hook, variables, api, args, keys) => {
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(hook, { wrapper })
    await act(() => result.current.mutateAsync(variables as never))
    expect(api).toHaveBeenCalledWith(...args)
    expect(spy.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(keys)
  })
})
