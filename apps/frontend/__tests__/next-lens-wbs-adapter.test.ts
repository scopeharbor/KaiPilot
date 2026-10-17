/**
 * W1 WBS 数据适配纯函数单元测试（v3-ui-next-remaining-lenses tasks 1.2）。
 *
 * 覆盖 `lib/next/lenses-wbs-adapter.ts`：
 * - 多级嵌套（1~4 级）默认展开态拍平输出的深度 / 子项计数 / 展开态精确断言；
 * - 动态添加/移除折叠节点后的可见行重算；
 * - 根节点折叠整树收拢；
 * - `collapsedSet` 权威语义：负载 `collapsed` 字段不参与可见性判定；
 * - `createInitialCollapsedSet` 尊重接口折叠标记；
 * - `buildCollapseToSecondLevelSet`（折叠至 L2：保留根与一级子工作包）精确断言；
 * - 孤立节点（父节点缺失）排除与 displayOrder 无序输入排序。
 */
import { describe, expect, test } from 'vitest'
import type { WbsNode } from '@/lib/api/wbs'
import {
  buildCollapseToSecondLevelSet,
  computeVisibleWbsRows,
  createInitialCollapsedSet,
} from '@/lib/next/lenses-wbs-adapter'

function makeNode(overrides: Partial<WbsNode> & { id: number; name: string }): WbsNode {
  return {
    projectId: 1,
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
 * 标准样例树（1~4 级嵌套）：
 * ```
 * 1 根工作包A
 * ├ 2 子包A1        ── 3 叶子A1.1
 * │                   └ 4 A1.2 ── 5 A1.2.1
 * └ 6 子包A2（叶子，绑定任务）
 * 7 根工作包B（叶子）
 * ```
 */
function seedTree(seeds: TreeSeed[]): WbsNode[] {
  const byId = new Map(seeds.map((seed) => [seed.id, seed]))
  return seeds.map((seed) => {
    const parentCode = seed.parentId !== null ? byId.get(seed.parentId)?.code : undefined
    return makeNode({
      id: seed.id,
      name: seed.name ?? `节点 ${seed.id}`,
      parentId: seed.parentId,
      code: seed.code,
      depth: seed.depth,
      isLeaf: !seeds.some((other) => other.parentId === seed.id),
      collapsed: seed.collapsed ?? false,
      displayOrder: seed.displayOrder ?? Math.max(0, seed.id - 1),
      ...(parentCode ? { path: `/${seed.parentId}/` } : {}),
    })
  })
}

function mainTree(): WbsNode[] {
  return seedTree([
    { id: 1, parentId: null, code: '1', depth: 0, name: '根工作包A' },
    { id: 2, parentId: 1, code: '1.1', depth: 1, name: '子包A1' },
    { id: 3, parentId: 2, code: '1.1.1', depth: 2, name: '叶子A1.1' },
    { id: 4, parentId: 2, code: '1.1.2', depth: 2, name: 'A1.2' },
    { id: 5, parentId: 4, code: '1.1.2.1', depth: 3, name: 'A1.2.1' },
    { id: 6, parentId: 1, code: '1.2', depth: 1, name: '子包A2' },
    { id: 7, parentId: null, code: '2', depth: 0, name: '根工作包B' },
  ])
}

const idsOf = (rows: ReturnType<typeof computeVisibleWbsRows>) => rows.map((row) => row.node.id)

describe('lib/next/lenses-wbs-adapter', () => {
  test('空节点数组恒产生空可见行（任何折叠集）', () => {
    expect(computeVisibleWbsRows([], new Set())).toEqual([])
    expect(computeVisibleWbsRows([], new Set([1, 2]))).toEqual([])
  })

  test('单节点（叶子）行：depth0、无子项、未展开', () => {
    const rows = computeVisibleWbsRows([makeNode({ id: 1, name: '孤立单节点' })], new Set())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      depth: 0,
      hasChildren: false,
      isExpanded: false,
      childCount: 0,
    })
    expect(rows[0]?.node.id).toBe(1)
  })

  test('默认全展开的 4 级嵌套树：DFS 顺序、深度、子项计数与展开态精确断言', () => {
    const rows = computeVisibleWbsRows(mainTree(), new Set())
    expect(idsOf(rows)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 2, 3, 1, 0])
    expect(rows.map((row) => row.childCount)).toEqual([2, 2, 0, 1, 0, 0, 0])
    expect(rows.map((row) => row.hasChildren)).toEqual([
      true,
      true,
      false,
      true,
      false,
      false,
      false,
    ])
    // 有子项且未被折叠 → isExpanded；叶子恒 false
    expect(rows.map((row) => row.isExpanded)).toEqual([
      true,
      true,
      false,
      true,
      false,
      false,
      false,
    ])
    // 层次编码透传节点负载
    expect(rows.map((row) => row.node.code)).toEqual([
      '1',
      '1.1',
      '1.1.1',
      '1.1.2',
      '1.1.2.1',
      '1.2',
      '2',
    ])
  })

  test('孤立节点（父节点缺失）被排除；displayOrder 无序输入按序重排输出', () => {
    // 打乱根下的 displayOrder（子包A2 先于 子包A1）并混入父节点不存在的孤立节点
    const scrambled = seedTree([
      { id: 1, parentId: null, code: '1', depth: 0, name: '根工作包A', displayOrder: 0 },
      { id: 2, parentId: 1, code: '1.1', depth: 1, name: '子包A1', displayOrder: 1 },
      { id: 3, parentId: 2, code: '1.1.1', depth: 2, name: '叶子A1.1', displayOrder: 0 },
      { id: 4, parentId: 2, code: '1.1.2', depth: 2, name: 'A1.2', displayOrder: 1 },
      { id: 5, parentId: 4, code: '1.1.2.1', depth: 3, name: 'A1.2.1', displayOrder: 0 },
      { id: 6, parentId: 1, code: '1.2', depth: 1, name: '子包A2', displayOrder: 0 },
      { id: 7, parentId: null, code: '2', depth: 0, name: '根工作包B', displayOrder: 1 },
      // 孤立节点：父节点不存在于数组中
      { id: 99, parentId: 404, code: '9', depth: 5, name: '游离节点', displayOrder: 0 },
    ])
    const rows = computeVisibleWbsRows(scrambled, new Set())
    expect(idsOf(rows)).toEqual([1, 6, 2, 3, 4, 5, 7])
    expect(rows.some((row) => row.node.id === 99)).toBe(false)
    // 遍历深度由祖先链推导，与负载 depth 字段无关
    const a2 = rows.find((row) => row.node.id === 6)
    expect(a2?.depth).toBe(1)
  })

  test('折叠中间节点：折叠节点自身保留、子树整支收拢，兄弟与其余分支不受影响', () => {
    const rows = computeVisibleWbsRows(mainTree(), new Set([2]))
    expect(idsOf(rows)).toEqual([1, 2, 6, 7])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 0])
  })

  test('折叠根节点：根自身保留，仅剩其余根可见', () => {
    const rows = computeVisibleWbsRows(mainTree(), new Set([1]))
    expect(idsOf(rows)).toEqual([1, 7])
    expect(rows.map((row) => row.depth)).toEqual([0, 0])
  })

  test('动态添加 / 移除折叠节点即时重算可见行', () => {
    const withA12Collapsed = computeVisibleWbsRows(mainTree(), new Set([4]))
    expect(idsOf(withA12Collapsed)).toEqual([1, 2, 3, 4, 6, 7])

    const restored = computeVisibleWbsRows(mainTree(), new Set())
    expect(idsOf(restored)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  test('collapsedSet 为权威折叠态：负载 collapsed 字段不参与可见性判定', () => {
    const nodes = mainTree()
    // 节点 2 负载标记 collapsed，但集合为空 → 子树仍然可见（用户展开态接管）
    const overridden = nodes.map((node) => (node.id === 2 ? { ...node, collapsed: true } : node))
    expect(idsOf(computeVisibleWbsRows(overridden, new Set()))).toEqual([1, 2, 3, 4, 5, 6, 7])

    // 反向：负载未折叠，但集合命中 → 折叠节点的子树收拢（节点自身保留）
    expect(idsOf(computeVisibleWbsRows(nodes, new Set([4])))).toEqual([1, 2, 3, 4, 6, 7])
  })

  test('createInitialCollapsedSet 尊重接口返回的 collapsed 标记', () => {
    const collapsed2 = mainTree().map((node) =>
      node.id === 2 ? { ...node, collapsed: true } : node,
    )
    expect(createInitialCollapsedSet(collapsed2)).toEqual(new Set([2]))
    expect(createInitialCollapsedSet(mainTree())).toEqual(new Set())

    const rows = computeVisibleWbsRows(collapsed2, createInitialCollapsedSet(collapsed2))
    expect(idsOf(rows)).toEqual([1, 2, 6, 7])
  })

  test('折叠至 L2：收起 depth>=2 具子项节点，仅保留根与一级子工作包展开', () => {
    const collapsed = buildCollapseToSecondLevelSet(mainTree())
    // 仅 4（depth2，拥有 5）需要收起；3（depth2 叶子）折叠无意义不入集
    expect(collapsed).toEqual(new Set([4]))
    expect(idsOf(computeVisibleWbsRows(mainTree(), collapsed))).toEqual([1, 2, 3, 4, 6, 7])
  })

  test('折叠至 L2 于 5 级深链：链上全部 depth>=2 具子项节点收拢，可见行截断至第 3 级', () => {
    const chain = seedTree([
      { id: 11, parentId: null, code: '1', depth: 0, name: 'L1' },
      { id: 12, parentId: 11, code: '1.1', depth: 1, name: 'L2' },
      { id: 13, parentId: 12, code: '1.1.1', depth: 2, name: 'L3' },
      { id: 14, parentId: 13, code: '1.1.1.1', depth: 3, name: 'L4' },
      { id: 15, parentId: 14, code: '1.1.1.1.1', depth: 4, name: 'L5' },
    ])
    const collapsed = buildCollapseToSecondLevelSet(chain)
    expect(collapsed).toEqual(new Set([13, 14]))
    const rows = computeVisibleWbsRows(chain, collapsed)
    expect(idsOf(rows)).toEqual([11, 12, 13])
    expect(rows[2]).toMatchObject({ depth: 2, hasChildren: true, isExpanded: false })
  })
})
