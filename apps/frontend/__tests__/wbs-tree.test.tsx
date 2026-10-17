import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WbsTree } from '@/components/views/wbs/WbsTree'
import type { WbsNode } from '@/lib/api/wbs'
import { flattenVisibleWbs, moveWbsOptimistically } from '@/lib/wbs-tree'

const mutations = {
  create: vi.fn(),
  update: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
}
let treeData: WbsNode[] = []
let writable = true
let treeLoading = false
let treeError = false
const refetch = vi.fn()

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 52,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, start: index * 52 })),
  }),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: (permission: string) => writable || permission === 'task:view',
  }),
}))

vi.mock('@/hooks/use-wbs-tree', () => ({
  useWbsTree: () => ({
    data: treeData,
    isLoading: treeLoading,
    isError: treeError,
    refetch,
  }),
  useCreateWbsNode: () => ({
    mutateAsync: mutations.create,
    isPending: false,
  }),
  useUpdateWbsNode: () => ({
    mutate: mutations.update,
    mutateAsync: mutations.update,
  }),
  useMoveWbsNode: () => ({ mutate: mutations.move }),
  useDeleteWbsNode: () => ({ mutate: mutations.remove }),
}))

function node(overrides: Partial<WbsNode> & Pick<WbsNode, 'id' | 'name'>): WbsNode {
  return {
    projectId: 1,
    parentId: null,
    path: `/${overrides.id}/`,
    code: String(overrides.id),
    depth: 0,
    isLeaf: true,
    collapsed: false,
    displayOrder: 0,
    taskId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('WBS 树数据变换', () => {
  it('按层级展开并过滤折叠节点的后代', () => {
    const root = node({ id: 1, name: '根', isLeaf: false, code: '1' })
    const child = node({
      id: 2,
      name: '子',
      parentId: 1,
      path: '/1/2/',
      code: '1.1',
      depth: 1,
      isLeaf: false,
      collapsed: true,
    })
    const hidden = node({
      id: 3,
      name: '隐藏孙级',
      parentId: 2,
      path: '/1/2/3/',
      code: '1.1.1',
      depth: 2,
    })

    expect(flattenVisibleWbs([hidden, child, root]).map((row) => row.node.name)).toEqual([
      '根',
      '子',
    ])
  })

  it('乐观移动同步重算位置、路径、深度与 outlineNumber', () => {
    const root = node({ id: 1, name: '根', isLeaf: false, code: '1' })
    const a = node({
      id: 2,
      name: 'A',
      parentId: 1,
      path: '/1/2/',
      code: '1.1',
      depth: 1,
    })
    const b = node({
      id: 3,
      name: 'B',
      parentId: 1,
      path: '/1/3/',
      code: '1.2',
      depth: 1,
    })

    const moved = moveWbsOptimistically([root, a, b], 2, { parentId: 3, displayOrder: 0 })
    const nextA = moved.find((item) => item.id === 2)
    expect(nextA).toMatchObject({
      parentId: 3,
      path: '/1/3/2/',
      code: '1.1.1',
      depth: 2,
    })
  })
})

describe('WbsTree 组件', () => {
  beforeEach(() => {
    writable = true
    treeLoading = false
    treeError = false
    refetch.mockReset()
    mutations.create.mockReset()
    mutations.update.mockReset()
    mutations.move.mockReset()
    mutations.remove.mockReset()
    mutations.update.mockResolvedValue(undefined)
    mutations.create.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('渲染多层编码、虚拟列表与创建入口', async () => {
    treeData = [
      node({ id: 1, name: '项目根', code: '1', isLeaf: false }),
      node({
        id: 2,
        name: '需求分析',
        parentId: 1,
        path: '/1/2/',
        code: '1.1',
        depth: 1,
      }),
    ]
    render(<WbsTree projectId={1} />)

    expect(screen.getByText('工作分解结构')).toBeInTheDocument()
    expect(screen.getByText('需求分析')).toBeInTheDocument()
    expect(screen.getByText('1.1')).toBeInTheDocument()
    expect(screen.getByLabelText('新 WBS 节点名称')).toBeInTheDocument()
  })

  it('只读权限隐藏结构写控件但保留折叠操作', async () => {
    writable = false
    treeData = [
      node({ id: 1, name: '项目根', code: '1', isLeaf: false }),
      node({
        id: 2,
        name: '工作包',
        parentId: 1,
        path: '/1/2/',
        code: '1.1',
        depth: 1,
      }),
    ]
    render(<WbsTree projectId={1} />)

    expect(screen.queryByLabelText('新 WBS 节点名称')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('重命名 工作包')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('折叠'))
    expect(mutations.update).toHaveBeenCalledWith({
      nodeId: 1,
      input: { collapsed: true },
    })
  })

  it('空树显示带行动说明的引导状态', async () => {
    treeData = []
    render(<WbsTree projectId={1} />)
    expect(screen.getByText('从项目目标开始拆解')).toBeInTheDocument()
    expect(screen.getByText(/系统会自动维护编号和层级/)).toBeInTheDocument()
  })

  it('空态下点击创建根节点 CTA 能够有效唤起创建输入并提交', async () => {
    treeData = []
    render(<WbsTree projectId={1} />)
    expect(screen.queryByLabelText('新 WBS 节点名称')).not.toBeInTheDocument()

    const createButton = screen.getByRole('button', { name: '创建根节点' })
    fireEvent.click(createButton)

    const createInput = screen.getByLabelText('新 WBS 节点名称')
    expect(createInput).toBeInTheDocument()
    expect(createInput).toHaveAttribute('placeholder', '添加一级工作包')

    fireEvent.change(createInput, { target: { value: '首个工作包' } })
    fireEvent.submit(createInput.closest('form')!)

    await waitFor(() => expect(mutations.create).toHaveBeenCalledWith({ name: '首个工作包' }))
  })

  it('显示骨架与可重试的局部错误状态', async () => {
    treeLoading = true
    const { rerender } = render(<WbsTree projectId={1} />)
    expect(screen.getByLabelText('正在加载 WBS')).toBeInTheDocument()

    treeLoading = false
    treeError = true
    rerender(<WbsTree projectId={1} />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('支持创建子项、内联改名、折叠批量操作与删除确认', async () => {
    treeData = [
      node({ id: 1, name: '项目根', code: '1', isLeaf: false }),
      node({
        id: 2,
        name: '工作包',
        parentId: 1,
        path: '/1/2/',
        code: '1.1',
        depth: 1,
      }),
    ]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<WbsTree projectId={1} />)

    fireEvent.click(screen.getByLabelText('在 项目根 下添加子节点'))
    const createInput = screen.getByLabelText('新 WBS 节点名称')
    expect(createInput).toHaveAttribute('placeholder', '在「项目根」下添加子节点')
    fireEvent.change(createInput, { target: { value: '新工作包' } })
    fireEvent.submit(createInput.closest('form')!)
    await waitFor(() =>
      expect(mutations.create).toHaveBeenCalledWith({ name: '新工作包', parentId: 1 }),
    )

    fireEvent.click(screen.getByLabelText('重命名 工作包'))
    const renameInput = screen.getByLabelText('节点名称')
    fireEvent.change(renameInput, { target: { value: '已改名' } })
    fireEvent.keyDown(renameInput, { key: 'Enter' })
    await waitFor(() =>
      expect(mutations.update).toHaveBeenCalledWith({
        nodeId: 2,
        input: { name: '已改名' },
      }),
    )

    fireEvent.click(screen.getByLabelText('删除 工作包'))
    expect(confirm).toHaveBeenCalled()
    expect(mutations.remove).toHaveBeenCalledWith(2)
    confirm.mockRestore()
  })

  it('展开全部会持久化已折叠的非叶节点', async () => {
    treeData = [node({ id: 1, name: '项目根', code: '1', isLeaf: false, collapsed: true })]
    render(<WbsTree projectId={1} />)
    fireEvent.click(screen.getByRole('button', { name: '展开全部' }))
    await waitFor(() =>
      expect(mutations.update).toHaveBeenCalledWith({
        nodeId: 1,
        input: { collapsed: false },
      }),
    )
  })
})
