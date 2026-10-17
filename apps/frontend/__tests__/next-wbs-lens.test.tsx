/**
 * W1 WBS 镜头组件渲染与虚拟化测试（v3-ui-next-remaining-lenses tasks 1.4）。
 *
 * 覆盖（spec「WBS 结构俯瞰镜头渲染与虚拟化」场景 + 统一状态反馈要求）：
 * - 数据加载骨架屏（role=status / aria-busy）→ 就绪后原位呈现树；
 * - 层次大纲渲染：等宽编码、缩进深度（data-wbs-depth）、任务状态微标与起止日期、
 *   纯汇总工作包子项计数；
 * - 行首箭头逐级折叠/展开（零网络写请求断言）；工具栏「展开全部」
 *   （覆盖服务端 collapsed 初始折叠）与「折叠至 L2」即时重算；
 * - 空树空态引导卡；接口异常错误卡 + 「重新载入」触发 refetch 恢复；
 * - 性能预算：500 节点视口裁剪（活动 DOM 行数 ≤ 50）与滚动窗口平移、
 *   `onRenderComplete` 度量回调；
 * - 精确档（precise）紧凑行高降级（32px），功能等价。
 *
 * 虚拟化 jsdom 策略：为滚动容器注入 offsetHeight/offsetWidth 几何
 * （virtual-core 经 `elementResizeObserver` 读取元素 offset 尺寸计算视口），
 * 行高恒为 estimateSize（未挂 measureElement ref，不触发真实行测量）。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { WorkspaceWbsLens } from '@/components/next/lenses/WorkspaceWbsLens'
import { wbsApi, type WbsNode } from '@/lib/api/wbs'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { useNextTrackStore } from '@/stores/next-track-store'

const PROJECT_ID = 101

const VIEWPORT_HEIGHT = 600

/** 虚拟滚动视口几何：jsdom 缺省 offsetHeight/offsetWidth 恒 0，注入后 virtualizer 才能裁剪。 */
function installScrollMetrics() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-wbs-scroll-viewport') ? VIEWPORT_HEIGHT : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-wbs-scroll-viewport') ? 900 : 0
  })
}

function makeNode(overrides: Partial<WbsNode> & { id: number; name: string }): WbsNode {
  return {
    projectId: PROJECT_ID,
    parentId: null,
    path: '/',
    code: '',
    depth: 0,
    isLeaf: true,
    collapsed: false,
    displayOrder: 0,
    taskId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

interface TreeSeed {
  id: number
  parentId: number | null
  code: string
  depth: number
  displayOrder?: number
  collapsed?: boolean
  name?: string
}

/**
 * 标准样例树（4 级）：
 * ```
 * 1 根工作包A
 * ├ 2 子包A1
 * │  ├ 3 叶子A1.1
 * │  └ 4 A1.2 ── 5 A1.2.1
 * └ 6 子包A2（绑定任务 in_progress）
 * 7 根工作包B
 * ```
 */
function treeFixture(seeds: TreeSeed[] = sampleSeeds()): WbsNode[] {
  return seeds.map((seed) => ({
    ...makeNode({
      id: seed.id,
      name: seed.name ?? `节点 ${seed.id}`,
      parentId: seed.parentId,
      code: seed.code,
      depth: seed.depth,
      collapsed: seed.collapsed ?? false,
      displayOrder: seed.displayOrder ?? seed.id - 1,
    }),
    isLeaf: !seeds.some((other) => other.parentId === seed.id),
  }))
}

function sampleSeeds(): TreeSeed[] {
  return [
    { id: 1, parentId: null, code: '1', depth: 0, name: '根工作包A' },
    { id: 2, parentId: 1, code: '1.1', depth: 1, name: '子包A1' },
    { id: 3, parentId: 2, code: '1.1.1', depth: 2, name: '叶子A1.1' },
    { id: 4, parentId: 2, code: '1.1.2', depth: 2, name: 'A1.2' },
    { id: 5, parentId: 4, code: '1.1.2.1', depth: 3, name: 'A1.2.1' },
    { id: 6, parentId: 1, code: '1.2', depth: 1, name: '子包A2' },
    { id: 7, parentId: null, code: '2', depth: 0, name: '根工作包B' },
  ]
}

/** 给样例树 6 号节点绑定任务摘要（状态 + 起止日期）。 */
function treeWithTask(): WbsNode[] {
  const nodes = treeFixture()
  return nodes.map((node) =>
    node.id === 6
      ? {
          ...node,
          taskId: 200,
          task: {
            id: 200,
            name: '任务：A2 交付',
            status: 'in_progress',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
          },
        }
      : node,
  )
}

/** 500 个根级节点大型项目（全部展开可见）。 */
function largeTreeFixture(): WbsNode[] {
  return Array.from({ length: 500 }, (_, index) => {
    const id = index + 1
    return makeNode({
      id,
      name: `工作包 ${id}`,
      parentId: null,
      code: String(index + 1),
      depth: 0,
      displayOrder: index,
    })
  })
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function TestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** setup.ts 的 matchMedia mock 会被 vi.restoreAllMocks 复位，beforeEach 需重建。 */
function installMatchMediaMock() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function renderLens(
  overrides: {
    onRenderComplete?: (metric: { durationMs: number; activeElements: number }) => void
    onOpenTask?: (taskId: number) => void
    focusTaskId?: number | null
  } = {},
) {
  return render(<WorkspaceWbsLens projectId={PROJECT_ID} {...overrides} />, { wrapper: wrapper() })
}

function rowsIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-wbs-row]'))
}

function visibleNodeIds(container: HTMLElement): number[] {
  return rowsIn(container)
    .map((row) => Number(row.getAttribute('data-wbs-node-id')))
    .sort((a, b) => a - b)
}

describe('components/next/lenses/WorkspaceWbsLens', () => {
  let treeSpy: MockInstance<typeof wbsApi.tree>

  beforeEach(() => {
    vi.restoreAllMocks()
    installMatchMediaMock()
    installScrollMetrics()
    // 精确档测试在用例内显式置位；此处统一复位保证用例间隔离
    // （不在 afterEach 复位：组件仍挂载时改 store 会触发 act 外重渲染告警）
    useNextTrackStore.setState({ immersionTier: null })
    treeSpy = vi.spyOn(wbsApi, 'tree')
  })

  test('加载中呈现仪器感骨架屏（aria-busy），数据就绪后原位呈现大纲树', async () => {
    let resolveTree!: (nodes: WbsNode[]) => void
    treeSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTree = resolve
        }) as ReturnType<typeof wbsApi.tree>,
    )
    const { container } = renderLens()

    const skeleton = await screen.findByRole('status')
    expect(skeleton).toHaveAttribute('data-wbs-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('根工作包A')).not.toBeInTheDocument()

    await act(async () => {
      resolveTree(treeFixture())
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(await screen.findByText('根工作包A')).toBeInTheDocument()
    expect(screen.queryByText('根工作包B')).toBeInTheDocument()
    expect(container.querySelector('[data-wbs-skeleton]')).toBeNull()
  })

  test('层次大纲渲染：等宽编码、缩进深度、任务状态微标 + 起止日期、汇总子项计数', async () => {
    treeSpy.mockResolvedValue(treeWithTask())
    const { container } = renderLens()
    await screen.findByText('根工作包A')

    const allRows = rowsIn(container)
    expect(allRows).toHaveLength(7)

    const codes = Array.from(container.querySelectorAll('[data-wbs-code]')).map(
      (el) => el.textContent,
    )
    expect(codes).toEqual(['1', '1.1', '1.1.1', '1.1.2', '1.1.2.1', '1.2', '2'])

    const depthOf = (id: number) =>
      container
        .querySelector(`[data-wbs-row][data-wbs-node-id="${id}"]`)
        ?.getAttribute('data-wbs-depth')
    expect(depthOf(1)).toBe('0')
    expect(depthOf(3)).toBe('2')
    expect(depthOf(5)).toBe('3')

    // 绑定任务的工作包：状态发丝线微标 + 起止日期
    const taskRow = container.querySelector('[data-wbs-row][data-wbs-node-id="6"]')
    expect(taskRow?.querySelector('[data-wbs-task-summary]')?.textContent).toContain('进行中')
    expect(taskRow?.querySelector('[data-wbs-task-summary]')?.textContent).toContain(
      '2026-09-01 ~ 2026-09-30',
    )
    // 纯汇总工作包：直属子项数量
    expect(
      rowsIn(container)
        .find((row) => row.getAttribute('data-wbs-node-id') === '1')
        ?.querySelector('[data-wbs-child-count]')?.textContent,
    ).toBe('2 个子项')
    // 无任务且无子项的叶节点：右侧无摘要
    const leafRow = rowsIn(container).find((row) => row.getAttribute('data-wbs-node-id') === '7')
    expect(leafRow?.querySelector('[data-wbs-task-summary]')).toBeNull()
    expect(leafRow?.querySelector('[data-wbs-child-count]')).toBeNull()
  })

  test('行首箭头逐级折叠 / 展开：子树即时收拢与恢复，零网络写请求', async () => {
    treeSpy.mockResolvedValue(treeFixture())
    const { container } = renderLens()
    await screen.findByText('子包A1')

    const rootRow = container.querySelector('[data-wbs-row][data-wbs-node-id="1"]')
    expect(rootRow).toHaveAttribute('aria-expanded', 'true')

    // 折叠根工作包A：其整支子树（2~6）收拢，仅剩根级行
    fireEvent.click(screen.getByRole('button', { name: '折叠：根工作包A' }))
    expect(rootRow).toHaveAttribute('aria-expanded', 'false')
    expect(visibleNodeIds(container)).toEqual([1, 7])
    expect(container.querySelector('[data-wbs-row-count]')?.textContent).toContain('可见 2 / 7')
    expect(screen.queryByText('子包A1')).not.toBeInTheDocument()
    // 只读防线：折叠/展开仅前端内存态，取数请求数不增长
    expect(treeSpy).toHaveBeenCalledTimes(1)

    // 再次点击恢复展开
    fireEvent.click(screen.getByRole('button', { name: '展开：根工作包A' }))
    expect(rootRow).toHaveAttribute('aria-expanded', 'true')
    expect(visibleNodeIds(container)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(treeSpy).toHaveBeenCalledTimes(1)
  })

  test('工具栏「展开全部」：覆盖服务端 collapsed 初始折叠态并展开所有层级', async () => {
    const seeds = sampleSeeds().map((seed) => (seed.id === 2 ? { ...seed, collapsed: true } : seed))
    treeSpy.mockResolvedValue(treeFixture(seeds))
    const { container } = renderLens()
    await screen.findByText('根工作包A')

    // 初始尊重接口折叠标记：子包A1（2）保留但子树（3/4/5）不可见
    expect(screen.queryByText('叶子A1.1')).not.toBeInTheDocument()
    expect(visibleNodeIds(container)).toEqual([1, 2, 6, 7])
    const collapsedRow = container.querySelector('[data-wbs-row][data-wbs-node-id="2"]')
    expect(collapsedRow).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: '展开全部' }))
    expect(screen.getByText('叶子A1.1')).toBeInTheDocument()
    expect(visibleNodeIds(container)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(container.querySelector('[data-wbs-row-count]')?.textContent).toContain('可见 7 / 7')
    expect(treeSpy).toHaveBeenCalledTimes(1)
  })

  test('工具栏「折叠至 L2」：收起更深层级，随后「展开全部」恢复全量', async () => {
    treeSpy.mockResolvedValue(treeFixture())
    const { container } = renderLens()
    await screen.findByText('叶子A1.1')

    fireEvent.click(screen.getByRole('button', { name: '折叠至 L2' }))
    // 深度 ≥2 的具子项节点（4）收拢 → 5 隐藏；4 自身保留，1/2/3/6/7 保持可见
    expect(screen.queryByText('A1.2.1')).not.toBeInTheDocument()
    expect(visibleNodeIds(container)).toEqual([1, 2, 3, 4, 6, 7])
    const node4 = container.querySelector('[data-wbs-row][data-wbs-node-id="4"]')
    expect(node4).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('[data-wbs-row-count]')?.textContent).toContain('可见 6 / 7')

    fireEvent.click(screen.getByRole('button', { name: '展开全部' }))
    expect(screen.getByText('A1.2.1')).toBeInTheDocument()
    expect(visibleNodeIds(container)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  test('空树呈现标准空态引导卡', async () => {
    treeSpy.mockResolvedValue([])
    const { container } = renderLens()
    await waitFor(() => expect(container.querySelector('[data-wbs-empty]')).not.toBeNull())
    expect(screen.getByText('当前项目尚未创建 WBS 工作分解结构')).toBeInTheDocument()
    expect(container.querySelector('[data-wbs-row]')).toBeNull()
  })

  test('接口异常展示错误重试卡，点击「重新载入」触发 refetch 并平滑恢复', async () => {
    treeSpy.mockRejectedValueOnce(new Error('模拟网络断开')).mockResolvedValue(treeFixture())
    const { container } = renderLens()

    const errorCard = await screen.findByRole('alert')
    expect(errorCard).toHaveAttribute('data-wbs-error')
    expect(screen.getByText('WBS 大纲加载失败')).toBeInTheDocument()
    expect(screen.getByText('模拟网络断开')).toBeInTheDocument()
    expect(container.querySelector('[data-wbs-row]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    expect(await screen.findByText('根工作包A')).toBeInTheDocument()
    expect(container.querySelector('[data-wbs-error]')).toBeNull()
    expect(treeSpy).toHaveBeenCalledTimes(2)
  })

  test('性能预算：500 节点视口虚拟滚动裁剪（活动 DOM 行 ≤ 50），滚动后窗口平移且保持低位', async () => {
    treeSpy.mockResolvedValue(largeTreeFixture())
    const { container } = renderLens()

    // 首屏：仅视口行 + overscan，500 行中只有约 23~31 行实例化
    await waitFor(() => expect(rowsIn(container).length).toBeGreaterThan(0))
    expect(container.querySelector('[data-wbs-row-count]')?.textContent).toContain('可见 500 / 500')
    const initialRows = rowsIn(container)
    expect(initialRows.length).toBeGreaterThanOrEqual(5)
    expect(initialRows.length).toBeLessThanOrEqual(50)
    // 内衬总高度 = 500 × 40px，滚动条可全量通行
    const innerSpacer = container.querySelector('[data-wbs-scroll-viewport] > div')
    expect(innerSpacer).toHaveStyle({ height: '20000px' })

    // 纵向滚动至中部（行 250 附近）：jsdom 无真实滚动布局，用实例属性覆写 scrollTop，
    // 再派发 scroll 事件驱动 virtualizer 重算可见窗口。
    const viewport = container.querySelector('[data-wbs-scroll-viewport]') as HTMLElement
    act(() => {
      Object.defineProperty(viewport, 'scrollTop', {
        configurable: true,
        value: 10_000,
      })
      fireEvent.scroll(viewport)
    })
    await waitFor(() => {
      const firstId = Number(rowsIn(container)[0]?.getAttribute('data-wbs-node-id'))
      expect(firstId).toBeGreaterThan(100)
    })
    expect(rowsIn(container).length).toBeLessThanOrEqual(50)
    // 视口外行被回收：滚动后首行不再是 1
    const firstId = Number(rowsIn(container)[0]?.getAttribute('data-wbs-node-id'))
    expect(firstId).not.toBe(1)
  })

  test('onRenderComplete 上报首屏渲染耗时与活动行 DOM 数（≤ 50）', async () => {
    treeSpy.mockResolvedValue(largeTreeFixture())
    const onRenderComplete = vi.fn()
    renderLens({ onRenderComplete })

    await waitFor(() => expect(onRenderComplete).toHaveBeenCalled())
    const metric = onRenderComplete.mock.calls[0]?.[0] as {
      durationMs: number
      activeElements: number
    }
    expect(metric.durationMs).toBeGreaterThanOrEqual(0)
    expect(metric.activeElements).toBeGreaterThanOrEqual(1)
    expect(metric.activeElements).toBeLessThanOrEqual(50)
  })

  test('精确档（precise）紧凑行高降级为 32px，展开/折叠功能等价', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    treeSpy.mockResolvedValue(treeFixture())
    const { container } = renderLens()
    await screen.findByText('子包A1')

    expect(container.querySelector('[data-wbs-lens]')).toHaveAttribute('data-wbs-tone', 'precise')
    const row = container.querySelector('[data-wbs-row]') as HTMLElement
    expect(row.style.height).toBe('32px')

    // 功能等价：精确档下折叠交互 100% 可用
    fireEvent.click(screen.getByRole('button', { name: '折叠：根工作包A' }))
    expect(visibleNodeIds(container)).toEqual([1, 7])
  })

  describe('任务行：点任务打开详情、聚焦任务自动展开定位', () => {
    function listOf(tasks: Array<Partial<Task> & { id: number; name: string; wbsNodeId: number }>) {
      return {
        data: tasks.map((task) => ({
          status: 'not_started',
          startDate: '2026-09-01',
          endDate: '2026-09-05',
          ...task,
        })) as unknown as Task[],
        meta: { total: tasks.length, page: 1, perPage: 100, totalPages: 1 },
      }
    }

    test('工作包下列出所属任务，点任务行与绑定任务的节点名都打开详情', async () => {
      treeSpy.mockResolvedValue(treeWithTask())
      vi.spyOn(tasksApi, 'list').mockResolvedValue(
        listOf([
          { id: 301, name: '登录页开发', wbsNodeId: 3 },
          { id: 302, name: '注册页开发', wbsNodeId: 3, status: 'in_progress' },
          // 节点 6 自身绑定的任务不重复成行
          { id: 200, name: '任务：A2 交付', wbsNodeId: 6 },
        ]),
      )
      const onOpenTask = vi.fn()
      const { container } = renderLens({ onOpenTask })

      const taskRow = await screen.findByText('登录页开发')
      expect(container.querySelectorAll('[data-wbs-task-row]')).toHaveLength(2)
      fireEvent.click(taskRow)
      expect(onOpenTask).toHaveBeenLastCalledWith(301)
      fireEvent.keyDown(taskRow.closest('[data-wbs-task-row]')!, { key: 'Enter' })
      expect(onOpenTask).toHaveBeenCalledTimes(2)

      fireEvent.click(container.querySelector('[data-wbs-open-task]')!)
      expect(onOpenTask).toHaveBeenLastCalledWith(200)
    })

    test('只挂任务的叶子工作包可折叠/展开任务行', async () => {
      treeSpy.mockResolvedValue(treeFixture())
      vi.spyOn(tasksApi, 'list').mockResolvedValue(
        listOf([{ id: 301, name: '登录页开发', wbsNodeId: 3 }]),
      )
      const { container } = renderLens({ onOpenTask: vi.fn() })
      await screen.findByText('登录页开发')
      fireEvent.click(screen.getByRole('button', { name: '折叠：叶子A1.1' }))
      expect(container.querySelector('[data-wbs-task-row]')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '展开：叶子A1.1' }))
      expect(container.querySelector('[data-wbs-task-row]')).not.toBeNull()
    })

    test('聚焦任务：展开被折叠的祖先并高亮该任务行', async () => {
      const nodes = treeFixture().map((node) =>
        node.id === 2 ? { ...node, collapsed: true } : node,
      )
      treeSpy.mockResolvedValue(nodes)
      vi.spyOn(tasksApi, 'list').mockResolvedValue(
        listOf([{ id: 305, name: 'A1.2.1 的任务', wbsNodeId: 5 }]),
      )
      const { container } = renderLens({ onOpenTask: vi.fn(), focusTaskId: 305 })
      const row = await screen.findByText('A1.2.1 的任务')
      expect(row.closest('[data-wbs-task-row]')).toHaveAttribute('data-focused', 'true')
      expect(visibleNodeIds(container)).toEqual(expect.arrayContaining([2, 4, 5]))
    })
  })
})
