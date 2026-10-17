import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import type {
  AiMarker,
  Marked,
  ProjectDraft,
  ProjectDraftSelection,
  ProjectDraftTask,
  ProjectDraftWbsNode,
} from '@aiproj/types'
import { buildWbsTree } from '@/lib/next/draft-review-helpers'
import {
  buildFullSelection,
  buildWbsNodeIdMap,
  collectWbsNodes,
  collectWbsRoots,
  computeSelectionCounts,
  createEmptySelection,
  findDanglingDependencies,
  resolveAncestors,
  resolveDescendantWbsAndTasks,
  resolveWbsCheckState,
} from '@/lib/next/draft-selection-helpers'
import { NextDraftWbsSection } from '@/components/next/review/NextDraftWbsSection'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

// ---------------------------------------------------------------------------
// 测试夹具：三层 WBS + 3 任务 + 2 依赖（与后端 import_selection 语义对齐）
// ---------------------------------------------------------------------------

function mk<T>(value: T, overrides: Partial<AiMarker> = {}): Marked<T> {
  return {
    value,
    marker: {
      confidence: 0.9,
      source: 'inferred',
      reason: '依据项目类型与常见交付规模推断。',
      needsConfirmation: true,
      ...overrides,
    },
  }
}

function wbsNode(
  id: string,
  outlineCode: string,
  name: string,
  parentId: string | null,
  overrides: Partial<ProjectDraftWbsNode> = {},
): ProjectDraftWbsNode {
  return {
    id,
    parentId,
    outlineCode,
    name: mk(name),
    description: mk(''),
    isLeaf: overrides.isLeaf ?? false,
    isNote: overrides.isNote ?? false,
    children: [],
  }
}

const WBS_FLAT: ProjectDraftWbsNode[] = [
  wbsNode('w1', '1', '项目准备', null),
  wbsNode('w1a', '1.1', '需求调研', 'w1'),
  wbsNode('w1a1', '1.1.1', '调研问卷', 'w1a', { isLeaf: true }),
  wbsNode('w1b', '1.2', '环境搭建', 'w1', { isLeaf: true }),
  wbsNode('w2', '2', '核心开发', null),
  wbsNode('w2a', '2.1', '前端开发', 'w2', { isLeaf: true }),
  wbsNode('w2b', '2.2', '后端开发', 'w2', { isLeaf: true, isNote: true }),
  wbsNode('w3', '3', '上线发布', null, { isLeaf: true }),
]

const TASKS: ProjectDraftTask[] = [
  {
    id: 'task-a',
    wbsNodeId: 'w1a1',
    name: mk('需求调研执行'),
    description: mk('访谈核心用户并输出需求清单'),
    status: 'not_started',
    durationDays: mk(3),
    startDate: mk('2026-08-01T00:00:00.000Z'),
    endDate: mk('2026-08-04T00:00:00.000Z'),
    assigneeHint: mk('产品经理'),
    assigneeRoleIds: mk(['pm', 'research']),
  },
  {
    id: 'task-b',
    wbsNodeId: 'w2a',
    name: mk('前端界面开发'),
    description: mk(''),
    status: 'not_started',
    durationDays: mk(15),
    startDate: mk('2026-08-05T00:00:00.000Z'),
    endDate: mk('2026-08-20T00:00:00.000Z'),
    assigneeHint: mk('前端工程师'),
  },
  {
    id: 'task-c',
    wbsNodeId: 'w2b',
    name: mk('后端接口开发'),
    description: mk(''),
    status: 'not_started',
    durationDays: mk(20),
    startDate: mk('2026-08-05T00:00:00.000Z'),
    endDate: mk('2026-08-25T00:00:00.000Z'),
    assigneeHint: mk('后端工程师'),
  },
]

const DRAFT: ProjectDraft = {
  schemaVersion: '1.0',
  projectType: 'software',
  charter: {
    title: mk('智能客服系统'),
    vision: mk('用 AI 重塑企业客服效率'),
    scope: mk('覆盖 Web 端与移动端客服工作台'),
    objectives: mk(['完成需求分析', '上线 v1 版本']),
    successCriteria: mk(['核心流程自动化率达 80%']),
    startDate: mk('2026-08-01'),
    endDate: mk('2026-10-30'),
  },
  wbs: WBS_FLAT,
  tasks: TASKS,
  dependencies: [
    {
      id: 'dep-1',
      predecessorId: 'task-a',
      successorId: 'task-b',
      type: 'FS',
      lagDays: mk(0),
    },
    {
      id: 'dep-2',
      predecessorId: 'task-c',
      successorId: 'task-a',
      type: 'SS',
      lagDays: mk(1),
    },
  ],
  acceptanceCriteria: [
    {
      id: 'acc-1',
      statement: mk('自动化处理率达 80% 以上'),
      linkedTaskId: 'task-b',
      linkedSuccessIndex: 0,
    },
  ],
  resourceHints: [
    { id: 'res-1', role: mk('前端工程师'), headcount: mk(2), allocationNote: mk('项目期中入场') },
  ],
  riskHints: [
    {
      id: 'risk-1',
      description: mk('第三方接口不稳定'),
      level: mk('high'),
      mitigation: mk('预留本地降级方案'),
    },
  ],
  milestoneHints: [
    { id: 'ms-1', name: mk('v1 上线'), targetDate: mk('2026-10-30'), linkedTaskIds: ['task-b'] },
  ],
  ganttPreview: {
    startDate: mk('2026-08-01'),
    endDate: mk('2026-10-30'),
    totalDurationDays: mk(90),
    criticalPathTaskIds: ['task-b'],
    phaseCount: 3,
  },
}

const FULL_SELECTION: ProjectDraftSelection = buildFullSelection(DRAFT)

beforeEach(() => {
  useAiProjectDraftStore.setState({ draft: DRAFT })
  useAiDraftConfirmStore.getState().resetConfirmState()
})

// ---------------------------------------------------------------------------
// 1.1 纯函数：父链追溯 / 子树级联 / 悬空依赖 / 统计
// ---------------------------------------------------------------------------

describe('lib/next/draft-selection-helpers（tasks 1.1）', () => {
  test('collectWbsNodes 兼容扁平与嵌套输入、跨输入去重', () => {
    expect(collectWbsNodes(WBS_FLAT).map((node) => node.id)).toEqual([
      'w1',
      'w1a',
      'w1a1',
      'w1b',
      'w2',
      'w2a',
      'w2b',
      'w3',
    ])
    const tree = buildWbsTree(WBS_FLAT)
    expect(
      collectWbsNodes(tree)
        .map((node) => node.id)
        .sort(),
    ).toEqual(
      collectWbsNodes(WBS_FLAT)
        .map((node) => node.id)
        .sort(),
    )
    expect(buildWbsNodeIdMap(WBS_FLAT).get('w1a')?.outlineCode).toBe('1.1')
    expect(buildWbsNodeIdMap(WBS_FLAT).get('missing')).toBeUndefined()
    expect(collectWbsNodes([])).toEqual([])
  })

  test('resolveAncestors 自起点沿 parentId 回溯至根，含起点自身', () => {
    const map = buildWbsNodeIdMap(WBS_FLAT)
    expect([...resolveAncestors(map, ['w1a1'])]).toEqual(['w1a1', 'w1a', 'w1'])
    expect([...resolveAncestors(map, ['w1'])]).toEqual(['w1'])
    expect([...resolveAncestors(map, ['w1a1', 'w2a'])]).toEqual(['w1a1', 'w1a', 'w1', 'w2a', 'w2'])
    expect([...resolveAncestors(map, ['missing'])]).toEqual([])
  })

  test('resolveAncestors 悬空 parentId 只保留自身（与服务端父链保留同口径）', () => {
    const map = buildWbsNodeIdMap([wbsNode('orphan', '9', '悬空节点', 'missing-parent')])
    expect([...resolveAncestors(map, ['orphan'])]).toEqual(['orphan'])
  })

  test('resolveDescendantWbsAndTasks 递归子树与挂载任务（含自身层级）', () => {
    const flat = resolveDescendantWbsAndTasks(WBS_FLAT, 'w1', TASKS)
    expect(flat.wbsNodeIds).toEqual(['w1', 'w1a', 'w1a1', 'w1b'])
    expect(flat.taskIds).toEqual(['task-a'])

    const leaf = resolveDescendantWbsAndTasks(WBS_FLAT, 'w1a1', TASKS)
    expect(leaf.wbsNodeIds).toEqual(['w1a1'])
    expect(leaf.taskIds).toEqual(['task-a'])

    const noTask = resolveDescendantWbsAndTasks(WBS_FLAT, 'w1b', TASKS)
    expect(noTask.wbsNodeIds).toEqual(['w1b'])
    expect(noTask.taskIds).toEqual([])

    // 嵌套输入与扁平输入结果一致（parentId 权威）
    const tree = buildWbsTree(WBS_FLAT)
    expect(resolveDescendantWbsAndTasks(tree, 'w1', TASKS)).toEqual(flat)

    expect(resolveDescendantWbsAndTasks(WBS_FLAT, 'missing', TASKS)).toEqual({
      wbsNodeIds: [],
      taskIds: [],
    })
  })

  test('findDanglingDependencies 两端均在选中集才可保留，一端缺失即悬空', () => {
    const deps = DRAFT.dependencies
    // 全选：无悬空
    expect(findDanglingDependencies(deps, ['task-a', 'task-b', 'task-c'])).toEqual([])
    // dep-2 后置 task-a 未选 → 悬空；dep-1 两端保留
    expect(findDanglingDependencies(deps, ['task-a', 'task-b']).map((dep) => dep.id)).toEqual([
      'dep-2',
    ])
    // 两端均未选 → 全部悬空
    expect(findDanglingDependencies(deps, []).map((dep) => dep.id)).toEqual(['dep-1', 'dep-2'])
    // Set 输入等价
    expect(
      findDanglingDependencies(deps, new Set(['task-a', 'task-b'])).map((dep) => dep.id),
    ).toEqual(['dep-2'])
    // 返回原始依赖记录（供解绑透视展示两端任务名/类型/滞后天数）
    const dangling = findDanglingDependencies(deps, ['task-a', 'task-b'])
    expect(dangling).toHaveLength(1)
    expect(dangling[0]).toBe(deps[1])
  })

  test('resolveWbsCheckState 三态：全选 checked / 部分 indeterminate / 未选 unchecked', () => {
    // 全选：节点自身 + 整棵子树（含挂载任务）均在选中集 → checked
    expect(resolveWbsCheckState(FULL_SELECTION, WBS_FLAT, 'w1', TASKS)).toBe('checked')
    expect(resolveWbsCheckState(FULL_SELECTION, WBS_FLAT, 'w3', TASKS)).toBe('checked')

    // 空选择集：全部 unchecked
    expect(resolveWbsCheckState(createEmptySelection(), WBS_FLAT, 'w1', TASKS)).toBe('unchecked')

    // 仅选中 w1a（子树 w1a1 与任务缺选）→ 节点已选但子树不全 → indeterminate
    const partialRoot: ProjectDraftSelection = {
      ...createEmptySelection(),
      wbsNodeIds: ['w1a'],
    }
    expect(resolveWbsCheckState(partialRoot, WBS_FLAT, 'w1a', TASKS)).toBe('indeterminate')

    // 仅选中深层叶节点 → 祖先未选但子树内有选中项 → indeterminate
    const partialLeaf: ProjectDraftSelection = {
      ...createEmptySelection(),
      taskIds: ['task-a'],
      wbsNodeIds: ['w1a1'],
    }
    expect(resolveWbsCheckState(partialLeaf, WBS_FLAT, 'w1', TASKS)).toBe('indeterminate')
    expect(resolveWbsCheckState(partialLeaf, WBS_FLAT, 'w1a', TASKS)).toBe('indeterminate')
    expect(resolveWbsCheckState(partialLeaf, WBS_FLAT, 'w1a1', TASKS)).toBe('checked')
    // 与选中子节点无关的分支保持未选
    expect(resolveWbsCheckState(partialLeaf, WBS_FLAT, 'w2', TASKS)).toBe('unchecked')
  })

  test('computeSelectionCounts 全选 / 局部 / 悬空依赖计数', () => {
    const full = computeSelectionCounts(DRAFT, FULL_SELECTION)
    expect(full).toEqual({
      selectedTasks: 3,
      totalTasks: 3,
      selectedWbsNodes: 8,
      totalWbsNodes: 8,
      selectedBranches: 3,
      totalBranches: 3,
      totalDependencies: 2,
      selectedDependencies: 2,
      danglingDependencies: 0,
    })

    // 局部选择：任务 a/b + 各自 WBS 父链；dep-2（task-c 端）悬空
    const partial: ProjectDraftSelection = {
      ...createEmptySelection(),
      taskIds: ['task-a', 'task-b'],
      wbsNodeIds: ['w1a1', 'w1a', 'w1', 'w2a', 'w2'],
    }
    expect(computeSelectionCounts(DRAFT, partial)).toEqual({
      selectedTasks: 2,
      totalTasks: 3,
      selectedWbsNodes: 5,
      totalWbsNodes: 8,
      selectedBranches: 2,
      totalBranches: 3,
      totalDependencies: 2,
      selectedDependencies: 1,
      danglingDependencies: 1,
    })

    // 外部构造的「仅任务无 WBS」选择集：分支按挂载任务归并计数，不虚增
    const tasksOnly: ProjectDraftSelection = {
      ...createEmptySelection(),
      taskIds: ['task-a'],
    }
    expect(computeSelectionCounts(DRAFT, tasksOnly).selectedBranches).toBe(1)
    expect(computeSelectionCounts(DRAFT, tasksOnly).selectedTasks).toBe(1)
    // 过期任务 ID 不与草案元素求交，不虚增
    const stale: ProjectDraftSelection = { ...createEmptySelection(), taskIds: ['stale-1'] }
    expect(computeSelectionCounts(DRAFT, stale).selectedTasks).toBe(0)
  })

  test('collectWbsRoots / buildFullSelection / createEmptySelection', () => {
    expect(collectWbsRoots(WBS_FLAT).map((node) => node.id)).toEqual(['w1', 'w2', 'w3'])
    expect(FULL_SELECTION.taskIds).toEqual(['task-a', 'task-b', 'task-c'])
    expect(FULL_SELECTION.wbsNodeIds).toHaveLength(8)
    expect(FULL_SELECTION.acceptanceIds).toEqual(['acc-1'])
    expect(FULL_SELECTION.milestoneIds).toEqual(['ms-1'])
    expect(FULL_SELECTION.riskHintIds).toEqual(['risk-1'])
    expect(FULL_SELECTION.unselectedStrategy).toBe('discard')
    expect(createEmptySelection()).toEqual({
      taskIds: [],
      wbsNodeIds: [],
      acceptanceIds: [],
      milestoneIds: [],
      riskHintIds: [],
      unselectedStrategy: 'discard',
    })
  })
})

// ---------------------------------------------------------------------------
// 1.2 交互 Store：勾选联动、模式切换与清空保护
// ---------------------------------------------------------------------------

describe('stores/ai-draft-confirm-store（tasks 1.2）', () => {
  test('initSelection 默认全部接受 + 完整选择集 + discard 策略', () => {
    useAiDraftConfirmStore.getState().initSelection(DRAFT)
    const state = useAiDraftConfirmStore.getState()
    expect(state.mode).toBe('all')
    expect(state.selection).toEqual(FULL_SELECTION)
    expect(state.acknowledgedWarnings).toBe(false)
    expect(state.isConfirming).toBe(false)
    expect(state.confirmError).toBeNull()
    expect(state.confirmModalOpen).toBe(false)
    expect(state.autoFixModalState).toEqual({ open: false, diffs: [], version: 0 })
    expect(state.unlinkedAlertTaskId).toBeNull()
  })

  test('toggleTask 选中任务自动补全直接 WBS 节点与完整祖先父链', () => {
    useAiDraftConfirmStore.getState().clearAll()
    useAiDraftConfirmStore.getState().toggleTask('task-a', DRAFT)
    const state = useAiDraftConfirmStore.getState()
    expect(state.mode).toBe('partial')
    expect(state.selection.taskIds).toEqual(['task-a'])
    expect(state.selection.wbsNodeIds.sort()).toEqual(['w1', 'w1a', 'w1a1'])
  })

  test('toggleTask 反选仅移除该任务，不触碰 WBS 节点集', () => {
    useAiDraftConfirmStore.getState().clearAll()
    const store = useAiDraftConfirmStore.getState()
    store.toggleTask('task-a', DRAFT)
    useAiDraftConfirmStore.getState().toggleTask('task-a', DRAFT)
    const state = useAiDraftConfirmStore.getState()
    expect(state.selection.taskIds).toEqual([])
    expect(state.selection.wbsNodeIds.sort()).toEqual(['w1', 'w1a', 'w1a1'])
  })

  test('toggleTask 在全部接受模式下点按即退出全选并以完整集为基数', () => {
    useAiDraftConfirmStore.getState().initSelection(DRAFT)
    useAiDraftConfirmStore.getState().toggleTask('task-a', DRAFT)
    const state = useAiDraftConfirmStore.getState()
    expect(state.mode).toBe('partial')
    expect(state.selection.taskIds).toEqual(['task-b', 'task-c'])
    // 其余 WBS 节点保持选中（仅任务反选）
    expect(state.selection.wbsNodeIds).toHaveLength(8)
  })

  test('toggleWbs 勾选层级节点包含整棵子树（节点 + 子孙 + 挂载任务）与祖先父链', () => {
    useAiDraftConfirmStore.getState().clearAll()
    useAiDraftConfirmStore.getState().toggleWbs('w1a', DRAFT)
    const state = useAiDraftConfirmStore.getState()
    expect(state.mode).toBe('partial')
    expect(state.selection.wbsNodeIds.sort()).toEqual(['w1', 'w1a', 'w1a1'])
    expect(state.selection.taskIds).toEqual(['task-a'])
  })

  test('toggleWbs 反选父节点联动清除整棵子树与挂载任务，祖先保留', () => {
    useAiDraftConfirmStore.getState().clearAll()
    const store = useAiDraftConfirmStore.getState()
    store.toggleWbs('w2', DRAFT)
    useAiDraftConfirmStore.getState().toggleWbs('w2', DRAFT)
    const state = useAiDraftConfirmStore.getState()
    expect(state.selection.taskIds).toEqual([])
    expect(state.selection.wbsNodeIds).toEqual([])
    expect(state.selection.wbsNodeIds.length).toBe(0)

    // 反选「需求调研」后其父节点 w1 作为独立选择保留，子节点清除
    useAiDraftConfirmStore.getState().clearAll()
    useAiDraftConfirmStore.getState().toggleWbs('w1a', DRAFT)
    useAiDraftConfirmStore.getState().toggleWbs('w1a', DRAFT)
    const second = useAiDraftConfirmStore.getState()
    expect(second.selection.wbsNodeIds).toEqual(['w1'])
    expect(second.selection.taskIds).toEqual([])
  })

  test('toggleWbs 在全部接受模式下反选即退出全选并清除子树', () => {
    useAiDraftConfirmStore.getState().initSelection(DRAFT)
    useAiDraftConfirmStore.getState().toggleWbs('w1a', DRAFT)
    const state = useAiDraftConfirmStore.getState()
    expect(state.mode).toBe('partial')
    expect(state.selection.wbsNodeIds.sort()).toEqual(['w1', 'w1b', 'w2', 'w2a', 'w2b', 'w3'])
    expect(state.selection.taskIds).toEqual(['task-b', 'task-c'])
  })

  test('setMode：all 恢复完整选择集；partial 保留当前集', () => {
    useAiDraftConfirmStore.getState().clearAll()
    useAiDraftConfirmStore.getState().toggleTask('task-a', DRAFT)
    useAiDraftConfirmStore.getState().setMode('all', DRAFT)
    expect(useAiDraftConfirmStore.getState().selection).toEqual(FULL_SELECTION)
    expect(useAiDraftConfirmStore.getState().mode).toBe('all')

    useAiDraftConfirmStore.getState().setMode('partial', DRAFT)
    expect(useAiDraftConfirmStore.getState().mode).toBe('partial')
    expect(useAiDraftConfirmStore.getState().selection).toEqual(FULL_SELECTION)
  })

  test('selectAll / clearAll：一键全选与清空保护', () => {
    useAiDraftConfirmStore.getState().clearAll()
    useAiDraftConfirmStore.getState().selectAll(DRAFT)
    expect(useAiDraftConfirmStore.getState().mode).toBe('all')
    expect(useAiDraftConfirmStore.getState().selection).toEqual(FULL_SELECTION)

    const store = useAiDraftConfirmStore.getState()
    store.setUnselectedStrategy('save_as_draft')
    useAiDraftConfirmStore.getState().clearAll()
    const state = useAiDraftConfirmStore.getState()
    expect(state.mode).toBe('partial')
    expect(state.selection.taskIds).toEqual([])
    expect(state.selection.wbsNodeIds).toEqual([])
    expect(state.selection.acceptanceIds).toEqual([])
    expect(state.selection.milestoneIds).toEqual([])
    expect(state.selection.riskHintIds).toEqual([])
    // 清空不重置未选策略
    expect(state.selection.unselectedStrategy).toBe('save_as_draft')
  })

  test('策略 / 警告复核 / 提交中 / 错误态原子更新与复位', () => {
    const store = useAiDraftConfirmStore.getState()
    store.setUnselectedStrategy('ask_later')
    useAiDraftConfirmStore.getState().setAcknowledgedWarnings(true)
    useAiDraftConfirmStore.getState().setIsConfirming(true)
    useAiDraftConfirmStore.getState().setConfirmError('网络连接超时')
    useAiDraftConfirmStore.setState({
      confirmModalOpen: true,
      autoFixModalState: { open: true, diffs: [], version: 3 },
      unlinkedAlertTaskId: 'task-a',
    })
    const state = useAiDraftConfirmStore.getState()
    expect(state.selection.unselectedStrategy).toBe('ask_later')
    expect(state.acknowledgedWarnings).toBe(true)
    expect(state.isConfirming).toBe(true)
    expect(state.confirmError).toBe('网络连接超时')
    expect(state.confirmModalOpen).toBe(true)
    expect(state.autoFixModalState).toEqual({ open: true, diffs: [], version: 3 })
    expect(state.unlinkedAlertTaskId).toBe('task-a')

    useAiDraftConfirmStore.getState().resetConfirmState()
    const reset = useAiDraftConfirmStore.getState()
    expect(reset.mode).toBe('all')
    expect(reset.selection).toEqual(createEmptySelection())
    expect(reset.acknowledgedWarnings).toBe(false)
    expect(reset.isConfirming).toBe(false)
    expect(reset.confirmError).toBeNull()
    expect(reset.confirmModalOpen).toBe(false)
    expect(reset.autoFixModalState).toEqual({ open: false, diffs: [], version: 0 })
    expect(reset.unlinkedAlertTaskId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 1.3 WBS 树 Checkbox 勾选交互：三态视觉 / 父链联动 / 反选子树清空
// ---------------------------------------------------------------------------

describe('components/next/review/NextDraftWbsSection（tasks 1.3）', () => {
  test('全部接受模式下全部节点渲染为选中态（Checkbox 三态之一 checked）', () => {
    useAiDraftConfirmStore.getState().initSelection(DRAFT)
    const first = render(<NextDraftWbsSection wbs={WBS_FLAT} />)

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(8)
    for (const checkbox of checkboxes) {
      expect(checkbox).toHaveAttribute('aria-checked', 'true')
    }
    // 未初始化选择集的默认态（mode: all）同样整体选中
    first.unmount()
    useAiDraftConfirmStore.getState().resetConfirmState()
    render(<NextDraftWbsSection wbs={WBS_FLAT} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(8)
  })

  test('勾选底层任务（经 toggleTask）父链自动全选：深叶 checked、半满祖先 indeterminate', () => {
    useAiDraftConfirmStore.getState().clearAll()
    useAiDraftConfirmStore.getState().toggleTask('task-a', DRAFT)
    render(<NextDraftWbsSection wbs={WBS_FLAT} />)

    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 1.1.1 调研问卷' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // 直接宿主与祖先节点均进入选择集
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 1.1 需求调研' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // w1 子树含未选环境搭建（1.2）→ 半选
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 1 项目准备' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 2 核心开发' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  test('补选兄弟分支后祖先由半选变全选', () => {
    useAiDraftConfirmStore.getState().clearAll()
    const store = useAiDraftConfirmStore.getState()
    store.toggleTask('task-a', DRAFT)
    useAiDraftConfirmStore.getState().toggleWbs('w1b', DRAFT)
    render(<NextDraftWbsSection wbs={WBS_FLAT} />)

    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 1 项目准备' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 1.2 环境搭建' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('点击父节点复选框反选：联动清除整棵子树与挂载任务', () => {
    useAiDraftConfirmStore.getState().initSelection(DRAFT)
    render(<NextDraftWbsSection wbs={WBS_FLAT} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 WBS 节点 1.1 需求调研' }))

    // 退出全部接受模式，子树被清除
    expect(useAiDraftConfirmStore.getState().mode).toBe('partial')
    expect(useAiDraftConfirmStore.getState().selection.taskIds).toEqual(['task-b', 'task-c'])
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 1.1 需求调研' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 1.1.1 调研问卷' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    // w1 仍选中但子树不全 → 半选；无关分支保持选中
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 1 项目准备' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 2 核心开发' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('点击根节点复选框反选：整条分支（含任务）联动清空', () => {
    useAiDraftConfirmStore.getState().initSelection(DRAFT)
    render(<NextDraftWbsSection wbs={WBS_FLAT} />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 WBS 节点 2 核心开发' }))

    const state = useAiDraftConfirmStore.getState()
    expect(state.mode).toBe('partial')
    expect(state.selection.taskIds).toEqual(['task-a'])
    for (const id of ['w2', 'w2a', 'w2b']) {
      expect(state.selection.wbsNodeIds).not.toContain(id)
    }
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 2.1 前端开发' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('checkbox', { name: '选择 WBS 节点 3 上线发布' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('反选后再勾选同一父节点：子树恢复选中', () => {
    useAiDraftConfirmStore.getState().initSelection(DRAFT)
    render(<NextDraftWbsSection wbs={WBS_FLAT} />)

    const w1a = screen.getByRole('checkbox', { name: '选择 WBS 节点 1.1 需求调研' })
    fireEvent.click(w1a)
    fireEvent.click(w1a)

    const state = useAiDraftConfirmStore.getState()
    expect(state.mode).toBe('partial')
    expect(state.selection.taskIds.sort()).toEqual(['task-a', 'task-b', 'task-c'])
    expect(state.selection.wbsNodeIds.sort()).toEqual(FULL_SELECTION.wbsNodeIds.sort())
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toHaveAttribute('aria-checked', 'true')
    }
  })

  test('草案缺失时勾选零副作用（不崩溃、不改变状态）', () => {
    useAiProjectDraftStore.setState({ draft: null })
    useAiDraftConfirmStore.getState().resetConfirmState()
    render(<NextDraftWbsSection wbs={WBS_FLAT} />)

    const checkbox = screen.getByRole('checkbox', { name: '选择 WBS 节点 1.1 需求调研' })
    fireEvent.click(checkbox)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
    expect(useAiDraftConfirmStore.getState().mode).toBe('all')
  })
})

// ---------------------------------------------------------------------------
// 红线：WBS 勾选仅本地草案副本，零网络零持久化
// ---------------------------------------------------------------------------

describe('WBS 勾选红线（RL-01 / RL-06 / RL-12）', () => {
  test('勾选交互不产生任何请求挂载点，Checkbox 为无表单提交的纯按钮', () => {
    useAiDraftConfirmStore.getState().initSelection(DRAFT)
    const { container } = render(<NextDraftWbsSection wbs={WBS_FLAT} />)

    const checkboxes = container.querySelectorAll('[data-wbs-checkbox]')
    expect(checkboxes.length).toBe(8)
    for (const checkbox of checkboxes) {
      expect(checkbox.tagName).toBe('BUTTON')
      expect(checkbox.getAttribute('type')).toBe('button')
    }
    // 全界面零表单输入控件；选择集只进内存 Store，绝不落 sessionStorage
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0)
    const persistedKeys = Object.keys(sessionStorage)
    expect(persistedKeys.some((key) => key.includes('ai-draft-confirm'))).toBe(false)
  })
})
