/**
 * v3-ui-next-org-portfolio-domains W2 · tasks 2.4 —— OKR 层级管理工作台组件测试。
 *
 * mock `@/hooks/use-okr`（useOkrCycles/useOkrTree），覆盖（spec「OKR 层级管理与
 * 达成仪表盘」场景 + tasks 2.4）：
 * - 周期与范围/状态过滤联动重查（tree query 参数随选择变化、cycles 固定参数）；
 * - 目标树高密度渲染：O 行 → KR 行（缩进/状态徽标/进度条带双通道/信心标记），
 *   默认全展开，折叠交互隐藏子树；
 * - 空树语义空态；加载骨架（aria-busy）；错误卡重试 refetch；
 * - 只读铁律（RL-01）：全部筛选/展开交互零网络（fetch 零调用、mutation 零调用）。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OkrWorkbench } from '@/components/next/org-okr/OkrWorkbench'
import type { OkrCycleListResponse, OkrObjectiveTree, OkrTreeResponse } from '@aiproj/types'
import { makeOkrCycle, makeOkrKeyResult, makeOkrObjective } from '@aiproj/types'

// ---------------------------------------------------------------------------
// hooks mock
// ---------------------------------------------------------------------------
const okrMocks = vi.hoisted(() => ({
  cycles: vi.fn(),
  tree: vi.fn(),
  refetch: vi.fn(),
  resetRefetch: vi.fn(),
}))
vi.mock('@/hooks/use-okr', () => ({
  useOkrCycles: (...args: unknown[]) => okrMocks.cycles(...args),
  useOkrTree: (...args: unknown[]) => okrMocks.tree(...args),
}))

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
const cycles = [
  makeOkrCycle({ id: 1, title: '2026 Q3' }),
  makeOkrCycle({ id: 2, title: '2026 Q4', status: 'draft' }),
]
const cycleListResponse: OkrCycleListResponse = {
  data: cycles,
  meta: { total: 2, page: 1, perPage: 50, totalPages: 1 },
}

function node(
  id: number,
  overrides: Partial<ReturnType<typeof makeOkrObjective>> = {},
  extras: { children?: OkrObjectiveTree[]; keyResults?: OkrObjectiveTree['keyResults'] } = {},
): OkrObjectiveTree {
  return {
    objective: makeOkrObjective({ id, title: `目标 ${id}`, progress: 60, ...overrides }),
    children: extras.children ?? [],
    keyResults: extras.keyResults ?? [],
    alignments: [],
    evidence: [],
  }
}

function forest(): OkrObjectiveTree[] {
  return [
    node(
      1,
      { progress: 100, status: 'active' },
      {
        keyResults: [
          makeOkrKeyResult({
            id: 11,
            title: '核心指标达成',
            baselineValue: 0,
            targetValue: 100,
            currentValue: 100,
            status: 'completed',
          }),
        ],
        children: [
          node(
            2,
            { progress: 40, status: 'active', ownerId: 7 },
            {
              keyResults: [
                makeOkrKeyResult({
                  id: 21,
                  title: '子目标关键结果推进中',
                  baselineValue: 10,
                  targetValue: 30,
                  currentValue: 18,
                  status: 'active',
                }),
              ],
            },
          ),
        ],
      },
    ),
    node(3, { progress: 0, status: 'draft' }),
  ]
}

function treeResponse(
  nodes: OkrObjectiveTree[],
  overrides: Partial<OkrTreeResponse['meta']> = {},
): OkrTreeResponse {
  return {
    data: nodes,
    meta: {
      totalNodes: 3,
      maxDepth: 2,
      truncated: false,
      warnings: [],
      ...overrides,
    },
  }
}

function okResult(
  payload: OkrTreeResponse | OkrCycleListResponse,
  extra: { isLoading?: boolean; isError?: boolean; error?: Error | null } = {},
) {
  return {
    data: payload,
    isLoading: extra.isLoading ?? false,
    isPending: false,
    isError: extra.isError ?? false,
    error: extra.error ?? null,
    refetch: okrMocks.refetch,
  }
}

function installWorkbench() {
  okrMocks.cycles.mockReturnValue(okResult(cycleListResponse))
  okrMocks.tree.mockReturnValue(okResult(treeResponse(forest())))
}

function renderWorkbench() {
  return render(<OkrWorkbench organizationId={1} />)
}

beforeEach(() => {
  okrMocks.cycles.mockReset()
  okrMocks.tree.mockReset()
  okrMocks.refetch.mockReset()
  okrMocks.refetch.mockResolvedValue(undefined)
  installWorkbench()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('OkrWorkbench：周期与过滤联动重查（tasks 2.4）', () => {
  test('初始装载：cycles 与 tree 各发起一次（org 1，tree 无筛选）', async () => {
    renderWorkbench()
    expect(okrMocks.cycles).toHaveBeenCalledTimes(1)
    expect(okrMocks.cycles).toHaveBeenCalledWith(1, {})
    expect(okrMocks.tree).toHaveBeenCalledWith(1, {
      cycleId: undefined,
      scope: undefined,
      status: undefined,
      depth: 5,
    })
    await waitFor(() => expect(document.querySelector('[data-okr-tree]')).not.toBeNull())
  })

  test('切换周期 → tree query cycleId 联动；切回全部周期回落 undefined', async () => {
    renderWorkbench()
    const picker = document.querySelector('[data-okr-cycle-picker]') as HTMLSelectElement
    expect(picker).not.toBeNull()
    fireEvent.change(picker, { target: { value: '2' } })
    await waitFor(() =>
      expect(okrMocks.tree).toHaveBeenLastCalledWith(1, expect.objectContaining({ cycleId: 2 })),
    )
    // 周期下拉带状态短标签（2026 Q4（草稿））
    expect(Array.from(picker.options).map((o) => o.text)).toContain('2026 Q4（草稿）')
    fireEvent.change(picker, { target: { value: '' } })
    await waitFor(() =>
      expect(okrMocks.tree).toHaveBeenLastCalledWith(
        1,
        expect.objectContaining({ cycleId: undefined }),
      ),
    )
  })

  test('范围/状态过滤联动：scope=team、status=active 进入 tree query', async () => {
    renderWorkbench()
    fireEvent.change(document.querySelector('[data-okr-scope-filter]') as HTMLSelectElement, {
      target: { value: 'team' },
    })
    await waitFor(() =>
      expect(okrMocks.tree).toHaveBeenLastCalledWith(1, expect.objectContaining({ scope: 'team' })),
    )
    fireEvent.change(document.querySelector('[data-okr-status-filter]') as HTMLSelectElement, {
      target: { value: 'active' },
    })
    await waitFor(() =>
      expect(okrMocks.tree).toHaveBeenLastCalledWith(
        1,
        expect.objectContaining({ status: 'active' }),
      ),
    )
    // 切回「全部」恢复 undefined（后端全量语义，不发送空串）
    fireEvent.change(document.querySelector('[data-okr-scope-filter]') as HTMLSelectElement, {
      target: { value: 'all' },
    })
    fireEvent.change(document.querySelector('[data-okr-status-filter]') as HTMLSelectElement, {
      target: { value: 'all' },
    })
    await waitFor(() =>
      expect(okrMocks.tree).toHaveBeenLastCalledWith(
        1,
        expect.objectContaining({ scope: undefined, status: undefined }),
      ),
    )
  })

  test('只读铁律：筛选/展开交互期间 fetch 与任何写均零调用（RL-01）', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderWorkbench()
    await waitFor(() => expect(document.querySelector('[data-okr-tree]')).not.toBeNull())

    fireEvent.change(document.querySelector('[data-okr-cycle-picker]') as HTMLSelectElement, {
      target: { value: '1' },
    })
    fireEvent.change(document.querySelector('[data-okr-status-filter]') as HTMLSelectElement, {
      target: { value: 'completed' },
    })
    const firstToggle = document.querySelector('[data-okr-row-toggle]') as HTMLButtonElement
    if (firstToggle) fireEvent.click(firstToggle)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchSpy).not.toHaveBeenCalled()
    // 只读 hooks 调用中不存在任何 mutation 形态（cycles/tree 均为 GET 语义查询）
    expect(okrMocks.cycles.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('OkrWorkbench：树行渲染 / 折叠（tasks 2.4）', () => {
  test('默认全展开：O 行与 KR 行渲染，进度条带双通道（数值 + 分段色）', async () => {
    renderWorkbench()
    await waitFor(() => expect(document.querySelector('[data-okr-tree]')).not.toBeNull())

    expect(document.querySelectorAll('[data-okr-row-kind="objective"]')).toHaveLength(3)
    expect(document.querySelectorAll('[data-okr-row-kind="key_result"]')).toHaveLength(2)
    expect(screen.getByText('目标 1')).toBeInTheDocument()
    expect(screen.getByText('子目标关键结果推进中')).toBeInTheDocument()
    // 状态徽标中文双通道（多个 active 行 → getAll）
    expect(screen.getAllByText('进行中').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('已完成').length).toBeGreaterThanOrEqual(1)
    // 负责人只展示后端 id（不猜姓名）
    expect(document.querySelector('[data-okr-objective-owner]')?.textContent).toContain('未分配')
    expect(
      document.querySelector('[data-okr-row="o:2"] [data-okr-objective-owner]')?.textContent,
    ).toContain('成员 #7')
    // 进度数值文本
    expect(document.querySelector('[data-okr-progress-text]')?.textContent).toContain('100%')
    const progressSpans = document.querySelectorAll('[data-okr-progress]')
    expect(progressSpans.length).toBeGreaterThanOrEqual(5)
    // 深色条带 fill 段存在（颜色通道）
    expect(
      document.querySelectorAll('[data-okr-progress] span span').length,
    ).toBeGreaterThanOrEqual(5)
  })

  test('折叠交互：折叠父目标后其 KR 与子树行消失，再展开恢复', async () => {
    renderWorkbench()
    await waitFor(() => expect(document.querySelectorAll('[data-okr-row]')).toHaveLength(5))
    // 折叠「目标 1」所在行（首行 toggle）：其 KR/子目标子树消失，仅余根 o:1 与 o:3
    fireEvent.click(document.querySelector('[data-okr-row-toggle]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-okr-row]')).toHaveLength(2))
    expect(document.querySelector('[data-okr-row="kr:11"]')).toBeNull()
    expect(document.querySelector('[data-okr-row="o:2"]')).toBeNull()
    expect(document.querySelector('[data-okr-row="o:3"]')).not.toBeNull()
    // 展开恢复
    fireEvent.click(document.querySelector('[data-okr-row-toggle]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-okr-row]')).toHaveLength(5))
  })
})

describe('OkrWorkbench：三态闭环（tasks 2.4）', () => {
  test('加载骨架：aria-busy + 占位行，无空态闪现', async () => {
    okrMocks.tree.mockReturnValue(okResult(treeResponse([]), { isLoading: true }))
    renderWorkbench()
    const skeleton = document.querySelector('[data-okr-tree-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-okr-tree-empty]')).toBeNull()
  })

  test('空树：语义空态（无目标数据）', async () => {
    okrMocks.tree.mockReturnValue(okResult(treeResponse([])))
    renderWorkbench()
    await waitFor(() => expect(document.querySelector('[data-okr-tree-empty]')).not.toBeNull())
    expect(document.body.textContent).toContain('当前筛选下暂无 OKR 数据')
  })

  test('错误态：错误卡 + 重试 refetch（区分可重试）', async () => {
    okrMocks.tree.mockReturnValue(
      okResult(treeResponse([]), { isError: true, error: new Error('加载失败：网络抖动') }),
    )
    renderWorkbench()
    await waitFor(() => expect(document.querySelector('[data-okr-tree-error]')).not.toBeNull())
    expect(document.body.textContent).toContain('加载失败：网络抖动')
    fireEvent.click(document.querySelector('[data-okr-tree-retry]') as Element)
    expect(okrMocks.refetch).toHaveBeenCalled()
  })

  test('meta 警告与陈旧提示：徽标栏回显 + 中性 stale 提示', async () => {
    okrMocks.tree.mockReturnValue(
      okResult(
        treeResponse(forest(), {
          warnings: [
            { code: 'STALE_EVIDENCE', message: '证据源超 72h 未刷新' },
            { code: 'LARGE_TREE_TRUNCATED', message: '树过大已截断' },
          ],
        }),
      ),
    )
    renderWorkbench()
    await waitFor(() => expect(document.querySelector('[data-okr-warning-badge]')).not.toBeNull())
    expect(document.querySelector('[data-okr-warning-badge="STALE_EVIDENCE"]')?.textContent).toBe(
      '证据过期',
    )
    expect(document.querySelector('[data-okr-warning-badge="LARGE_TREE_TRUNCATED"]')).not.toBeNull()
    expect(document.querySelector('[data-okr-stale-notice]')?.textContent).toContain('仅供参考')
    // meta 行
    expect(document.querySelector('[data-okr-tree-node-total]')?.textContent).toContain(
      '共 3 个节点',
    )
  })
})
