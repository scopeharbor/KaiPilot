import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type {
  AiMarker,
  Marked,
  ProjectDraft,
  ProjectDraftTask,
  ProjectDraftWbsNode,
} from '@aiproj/types'
import {
  buildTaskLookup,
  buildWbsNodeCodeMap,
  buildWbsTree,
  compareOutlineCodes,
  extractMarkedValue,
  flattenWbsNodes,
  formatConfidence,
  formatDateSpan,
  formatDurationDays,
  formatISODate,
  getDefaultExpandedNodeIds,
  indexTasksByWbsNode,
  isMarkedValue,
} from '@/lib/next/draft-review-helpers'
import { NextDraftModuleInspector } from '@/components/next/review/NextDraftModuleInspector'

// ---------------------------------------------------------------------------
// 测试夹具：9 模块完整 ProjectDraft（Marked 字段齐全，WBS 三层结构）
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
    wbsNodeId: 'w1a',
    name: mk('需求调研执行'),
    description: mk('访谈核心用户并输出需求清单'),
    status: 'not_started',
    durationDays: mk(3, { confidence: 0.42 }),
    startDate: mk('2026-08-01T00:00:00.000Z'),
    endDate: mk('2026-08-04T00:00:00.000Z'),
    assigneeHint: mk('产品经理'),
    assigneeRoleIds: mk(['pm', 'research']),
  },
  {
    id: 'task-b',
    wbsNodeId: 'w2b',
    name: mk('后端接口开发'),
    description: mk(''),
    status: 'in_progress',
    durationDays: mk(15),
    startDate: mk('2026-08-05T00:00:00.000Z'),
    endDate: mk('2026-08-20T00:00:00.000Z'),
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
      lagDays: mk(2),
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

function renderInspector() {
  return render(<NextDraftModuleInspector draft={DRAFT} />)
}

function childrenListOf(nodeId: string): HTMLElement | null {
  return document.querySelector(`ul#nx-wbs-children-${nodeId}`)
}

// ---------------------------------------------------------------------------
// 1.1 纯函数投影
// ---------------------------------------------------------------------------

describe('lib/next/draft-review-helpers（tasks 1.1）', () => {
  test('compareOutlineCodes 按数值段排序：1.10 排在 1.2 之后', () => {
    expect(compareOutlineCodes('1.2', '1.10')).toBeLessThan(0)
    expect(compareOutlineCodes('1.10', '1.2')).toBeGreaterThan(0)
    expect(compareOutlineCodes('1', '1.1')).toBeLessThan(0)
    expect(compareOutlineCodes('2', '1.10')).toBeGreaterThan(0)
    expect(compareOutlineCodes('1.1', '1.1')).toBe(0)
  })

  test('buildWbsTree 按 parentId 重建嵌套树并递归排序（忽略输入 children）', () => {
    const tree = buildWbsTree(WBS_FLAT)
    expect(tree.map((node) => node.outlineCode)).toEqual(['1', '2', '3'])
    expect(tree[0]?.children.map((node) => node.outlineCode)).toEqual(['1.1', '1.2'])
    expect(tree[0]?.children[0]?.children.map((node) => node.outlineCode)).toEqual(['1.1.1'])

    // 输入本身携带 children 时以 parentId 为权威，不产生重复嵌套
    const w1WithRedundantChildren: ProjectDraftWbsNode = {
      ...(WBS_FLAT[0] as ProjectDraftWbsNode),
      children: [WBS_FLAT[1] as ProjectDraftWbsNode],
    }
    const duplicated = buildWbsTree([w1WithRedundantChildren, WBS_FLAT[1] as ProjectDraftWbsNode])
    expect(duplicated[0]?.children).toHaveLength(1)

    expect(buildWbsTree([])).toEqual([])
  })

  test('buildWbsTree 悬空 parentId 按根节点兜底，不丢数据', () => {
    const orphan = wbsNode('orphan', '9', '悬空节点', 'missing-parent')
    const tree = buildWbsTree([orphan, ...WBS_FLAT])
    expect(tree.map((node) => node.id)).toContain('orphan')
  })

  test('flattenWbsNodes / buildWbsNodeCodeMap / getDefaultExpandedNodeIds', () => {
    const tree = buildWbsTree(WBS_FLAT)
    expect(flattenWbsNodes(tree)).toHaveLength(WBS_FLAT.length)
    expect(buildWbsNodeCodeMap(tree).get('w1a')).toBe('1.1')
    expect(buildWbsNodeCodeMap(tree).get('w1a1')).toBe('1.1.1')

    // 默认展开前两层节点：w1（第 1 层）、w1a（第 2 层）展开，w1a1（第 3 层）收起
    const expanded = getDefaultExpandedNodeIds(tree)
    expect(expanded.has('w1')).toBe(true)
    expect(expanded.has('w1a')).toBe(true)
    expect(expanded.has('w1a1')).toBe(false)
    expect(expanded.has('w2')).toBe(true)
  })

  test('indexTasksByWbsNode / buildTaskLookup 按归属快速索引', () => {
    const index = indexTasksByWbsNode(TASKS)
    expect(index.get('w1a')?.map((task) => task.id)).toEqual(['task-a'])
    expect(index.get('w2b')?.map((task) => task.id)).toEqual(['task-b'])
    expect(index.get('missing')).toBeUndefined()

    const lookup = buildTaskLookup(TASKS)
    expect(lookup.get('task-a')?.id).toBe('task-a')
    expect(lookup.get('missing')).toBeUndefined()
  })

  test('Marked 提取与格式化：纯值、置信度、工期与日期', () => {
    expect(extractMarkedValue(mk('智能客服系统'))).toBe('智能客服系统')
    expect(isMarkedValue(mk(3))).toBe(true)
    expect(isMarkedValue('plain')).toBe(false)
    expect(formatConfidence(0.82)).toBe('82%')
    expect(formatConfidence(0.845)).toBe('85%')
    expect(formatDurationDays(10)).toBe('10 天')
    expect(formatDurationDays(0.5)).toBe('0.5 天')
    expect(formatISODate('2026-08-01T00:00:00.000Z')).toBe('2026-08-01')
    expect(formatISODate('')).toBe('—')
    expect(formatDateSpan('2026-08-01', '2026-10-30')).toBe('2026-08-01 至 2026-10-30')
    expect(formatDateSpan('2026-08-01', '2026-08-01')).toBe('2026-08-01')
    expect(formatDateSpan('', '')).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// 1.7 / 1.8 模块检视四区主容器
// ---------------------------------------------------------------------------

describe('components/next/review/NextDraftModuleInspector（tasks 1.7）', () => {
  test('渲染 tablist / tab / tabpanel 完整 ARIA 语义，默认选中项目章程', () => {
    renderInspector()

    const tablist = screen.getByRole('tablist', { name: '草案模块检视' })
    expect(tablist).toBeInTheDocument()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '项目章程',
      'WBS 分解树',
      '任务清单',
      '甘特预览',
    ])

    const charterTab = screen.getByRole('tab', { name: '项目章程' })
    expect(charterTab).toHaveAttribute('aria-selected', 'true')
    expect(charterTab).toHaveAttribute('aria-controls', 'nx-draft-panel-charter')

    // 默认仅章程面板可见（隐藏面板不出现在默认 role 查询中）
    expect(screen.getByRole('tabpanel', { name: '项目章程' })).toBeVisible()
    expect(screen.queryByRole('tabpanel', { name: 'WBS 分解树' })).toBeNull()

    // 章程内容完整回显
    const charterPanel = screen.getByRole('tabpanel', { name: '项目章程' })
    expect(within(charterPanel).getByText('智能客服系统')).toBeInTheDocument()
    expect(within(charterPanel).getByText('用 AI 重塑企业客服效率')).toBeInTheDocument()
    expect(within(charterPanel).getByText('覆盖 Web 端与移动端客服工作台')).toBeInTheDocument()
    expect(within(charterPanel).getByText('完成需求分析')).toBeInTheDocument()
    expect(within(charterPanel).getByText('上线 v1 版本')).toBeInTheDocument()
    expect(within(charterPanel).getByText('核心流程自动化率达 80%')).toBeInTheDocument()
    expect(within(charterPanel).getByText('2026-08-01 至 2026-10-30')).toBeInTheDocument()
  })

  test('点击标签切换各面板且 aria-selected 同步', () => {
    renderInspector()

    fireEvent.click(screen.getByRole('tab', { name: 'WBS 分解树' }))
    expect(screen.getByRole('tab', { name: 'WBS 分解树' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'WBS 分解树' })).toBeVisible()
    expect(screen.queryByRole('tabpanel', { name: '项目章程' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '任务清单' }))
    expect(screen.getByRole('tab', { name: '任务清单' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: '任务清单' })).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: '甘特预览' }))
    expect(screen.getByRole('tab', { name: '甘特预览' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: '甘特预览' })).toBeVisible()
  })

  test('键盘 ArrowLeft / ArrowRight / Home / End 切换并移送焦点（roving tabindex）', () => {
    renderInspector()

    const charterTab = screen.getByRole('tab', { name: '项目章程' })
    fireEvent.keyDown(charterTab, { key: 'ArrowRight' })
    const wbsTab = screen.getByRole('tab', { name: 'WBS 分解树' })
    expect(wbsTab).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(wbsTab)

    fireEvent.keyDown(wbsTab, { key: 'ArrowRight' })
    const tasksTab = screen.getByRole('tab', { name: '任务清单' })
    expect(tasksTab).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(tasksTab)

    fireEvent.keyDown(tasksTab, { key: 'ArrowLeft' })
    expect(wbsTab).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(wbsTab)

    fireEvent.keyDown(wbsTab, { key: 'Home' })
    expect(charterTab).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(charterTab)

    fireEvent.keyDown(charterTab, { key: 'End' })
    const ganttTab = screen.getByRole('tab', { name: '甘特预览' })
    expect(ganttTab).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(ganttTab)

    // 边界回绕：甘特 -> ArrowRight -> 章程
    fireEvent.keyDown(ganttTab, { key: 'ArrowRight' })
    expect(charterTab).toHaveAttribute('aria-selected', 'true')
  })

  test('非导航键不触发切换（Enter/Space 保持当前标签）', () => {
    renderInspector()
    const charterTab = screen.getByRole('tab', { name: '项目章程' })
    fireEvent.keyDown(charterTab, { key: 'Enter' })
    fireEvent.keyDown(charterTab, { key: ' ' })
    expect(charterTab).toHaveAttribute('aria-selected', 'true')
  })
})

// ---------------------------------------------------------------------------
// 1.3 WBS 分解树
// ---------------------------------------------------------------------------

describe('components/next/review/NextDraftWbsSection（tasks 1.3）', () => {
  test('树形展开折叠：默认展开前两层，点击节点展开第三层', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: 'WBS 分解树' }))
    const panel = screen.getByRole('tabpanel', { name: 'WBS 分解树' })

    // 大纲编码齐全，层级按树形展示
    expect(within(panel).getByText('1')).toBeInTheDocument()
    expect(within(panel).getByText('1.1')).toBeInTheDocument()
    expect(within(panel).getByText('1.2')).toBeInTheDocument()
    expect(within(panel).getByText('2')).toBeInTheDocument()
    expect(within(panel).getByText('2.1')).toBeInTheDocument()
    expect(within(panel).getByText('2.2')).toBeInTheDocument()
    expect(within(panel).getByText('3')).toBeInTheDocument()

    // 默认展开前两层节点：1.1（第 2 层）已展开，第三层 `1.1.1 调研问卷` 可见
    const w1aToggle = panel.querySelector('[data-wbs-node-id="w1a"]')
    expect(w1aToggle).not.toBeNull()
    expect(w1aToggle).toHaveAttribute('aria-expanded', 'true')
    expect(childrenListOf('w1a')).not.toHaveAttribute('hidden')
    expect(within(panel).getByText('1.1.1')).toBeInTheDocument()
    expect(within(panel).getByText('调研问卷')).toBeInTheDocument()

    // 点击 1.1 收起 → 第三层子节点隐藏
    fireEvent.click(w1aToggle as HTMLElement)
    expect(childrenListOf('w1a')).toHaveAttribute('hidden')
    expect(w1aToggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel.querySelector('[data-wbs-outline-code]')).not.toBeNull()

    // 再次点击展开 → 第三层子节点可见
    fireEvent.click(w1aToggle as HTMLElement)
    expect(childrenListOf('w1a')).not.toHaveAttribute('hidden')
    expect(w1aToggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getByText('1.1.1')).toBeInTheDocument()
  })

  test('全部展开 / 全部收起按钮', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: 'WBS 分解树' }))
    const panel = screen.getByRole('tabpanel', { name: 'WBS 分解树' })

    fireEvent.click(within(panel).getByText('全部收起'))
    expect(childrenListOf('w1')).toHaveAttribute('hidden')
    expect(childrenListOf('w2')).toHaveAttribute('hidden')
    // 根节点仍展示
    expect(within(panel).getByText('1')).toBeInTheDocument()

    fireEvent.click(within(panel).getByText('全部展开'))
    expect(childrenListOf('w1')).not.toHaveAttribute('hidden')
    expect(childrenListOf('w1a')).not.toHaveAttribute('hidden')
    expect(childrenListOf('w2')).not.toHaveAttribute('hidden')
    expect(within(panel).getByText('1.1.1')).toBeInTheDocument()
  })

  test('叶节点与说明节点（isNote）徽章', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: 'WBS 分解树' }))
    const panel = screen.getByRole('tabpanel', { name: 'WBS 分解树' })

    const leafBadges = panel.querySelectorAll('[data-wbs-leaf-badge]')
    expect(leafBadges.length).toBeGreaterThan(0)

    // 说明节点在后端开发（2.2）行内
    const rowWithNote = panel.querySelector('[aria-label*="2.2"]')
    expect(rowWithNote).not.toBeNull()
    expect(within(rowWithNote as HTMLElement).getByText('说明节点')).toBeInTheDocument()
  })

  test('空 WBS 时展示中性空态', () => {
    render(<NextDraftModuleInspector draft={{ ...DRAFT, wbs: [] }} />)
    fireEvent.click(screen.getByRole('tab', { name: 'WBS 分解树' }))
    expect(screen.getByText('暂无 WBS 分解结构')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 1.4 任务清单高密度仪器表
// ---------------------------------------------------------------------------

describe('components/next/review/NextDraftTasksSection（tasks 1.4）', () => {
  test('高密度表格完整渲染字段与 WBS 编码反查', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: '任务清单' }))
    const panel = screen.getByRole('tabpanel', { name: '任务清单' })

    const headers = within(panel)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(headers).toEqual([
      '选择',
      '任务名称',
      'WBS 编码',
      '工期',
      '计划起止',
      '状态',
      '负责人建议',
      '角色',
      '操作',
    ])

    const rows = within(panel).getAllByRole('row')
    expect(rows).toHaveLength(3) // 表头 + 2 任务

    // 任务 A：名称、所属 WBS 编码（1.1）、工期、起止区间、状态徽章、负责人、角色
    const taskARow = within(panel).getByText('需求调研执行').closest('tr') as HTMLElement
    expect(within(taskARow).getByText('1.1')).toBeInTheDocument()
    expect(within(taskARow).getByText('3 天')).toBeInTheDocument()
    expect(within(taskARow).getByText('2026-08-01 至 2026-08-04')).toBeInTheDocument()
    expect(within(taskARow).getByText('待处理')).toBeInTheDocument()
    expect(within(taskARow).getByText('产品经理')).toBeInTheDocument()
    expect(within(taskARow).getByText('pm')).toBeInTheDocument()
    expect(within(taskARow).getByText('research')).toBeInTheDocument()
    expect(within(taskARow).getByText('访谈核心用户并输出需求清单')).toBeInTheDocument()

    // 任务 B：状态 进行中；无角色时展示 '—'
    const taskBRow = within(panel).getByText('后端接口开发').closest('tr') as HTMLElement
    expect(within(taskBRow).getByText('2.2')).toBeInTheDocument()
    expect(within(taskBRow).getByText('进行中')).toBeInTheDocument()
    expect(within(taskBRow).getByText('—')).toBeInTheDocument()
  })

  test('推断字段挂微型置信度标签（含低置信度 42%）', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: '任务清单' }))
    const panel = screen.getByRole('tabpanel', { name: '任务清单' })

    const chips = panel.querySelectorAll('[data-marked-confidence]')
    expect(chips.length).toBeGreaterThan(0)
    expect(within(panel).getByText('42%')).toBeInTheDocument()
    expect(within(panel).getAllByText('90%').length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 1.5 甘特预览
// ---------------------------------------------------------------------------

describe('components/next/review/NextDraftGanttSection（tasks 1.5）', () => {
  test('总览条：总工期、阶段数、关键路径任务数与主轴跨度', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: '甘特预览' }))
    const panel = screen.getByRole('tabpanel', { name: '甘特预览' })

    expect(within(panel).getByText('90 天')).toBeInTheDocument()
    expect(within(panel).getByText('3')).toBeInTheDocument()
    expect(within(panel).getByText('1 项')).toBeInTheDocument()
    expect(within(panel).getByText('2026-08-01 至 2026-10-30')).toBeInTheDocument()
  })

  test('关键路径高亮：criticalPathTaskIds 内的任务挂战术冷蓝徽章', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: '甘特预览' }))
    const panel = screen.getByRole('tabpanel', { name: '甘特预览' })

    const badges = panel.querySelectorAll('[data-gantt-critical-badge]')
    expect(badges).toHaveLength(1)
    expect(within(badges[0] as HTMLElement).getByText('关键路径')).toBeInTheDocument()

    const taskARow = panel.querySelector('[data-gantt-task][data-task-id="task-a"]') as HTMLElement
    expect(taskARow.querySelector('[data-gantt-critical-badge]')).toBeNull()
  })

  test('依赖关系表：前置/后置任务名、FS 类型与滞后天数', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: '甘特预览' }))
    const panel = screen.getByRole('tabpanel', { name: '甘特预览' })

    const depRow = within(panel).getByText('FS · 完成-开始').closest('tr') as HTMLElement
    expect(within(depRow).getByText('需求调研执行')).toBeInTheDocument()
    expect(within(depRow).getByText('后端接口开发')).toBeInTheDocument()
    expect(within(depRow).getByText('2 天')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 1.6 配套辅助信息折叠区
// ---------------------------------------------------------------------------

describe('components/next/review/NextDraftSupportingSection（tasks 1.6）', () => {
  test('验收标准 / 资源建议 / 风险提示 / 里程碑手风琴展开与等级徽章', () => {
    renderInspector()

    // 默认全部收起
    for (const panelId of ['acceptance', 'resource', 'risk', 'milestone']) {
      const toggle = document.querySelector(`[data-support-panel-id="${panelId}"]`)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    }

    // 验收标准
    fireEvent.click(document.querySelector('[data-support-panel-id="acceptance"]') as HTMLElement)
    expect(screen.getByText('自动化处理率达 80% 以上')).toBeInTheDocument()

    // 资源建议
    fireEvent.click(document.querySelector('[data-support-panel-id="resource"]') as HTMLElement)
    expect(screen.getByText('前端工程师')).toBeInTheDocument()
    expect(screen.getByText('2 人')).toBeInTheDocument()
    expect(screen.getByText('项目期中入场')).toBeInTheDocument()

    // 风险提示（高影响等级）
    fireEvent.click(document.querySelector('[data-support-panel-id="risk"]') as HTMLElement)
    expect(screen.getByText('第三方接口不稳定')).toBeInTheDocument()
    expect(screen.getByText('高风险')).toBeInTheDocument()
    expect(screen.getByText('缓解措施：预留本地降级方案')).toBeInTheDocument()

    // 里程碑
    fireEvent.click(document.querySelector('[data-support-panel-id="milestone"]') as HTMLElement)
    expect(screen.getByText('v1 上线')).toBeInTheDocument()
    expect(screen.getByText('2026-10-30')).toBeInTheDocument()
    expect(screen.getByText('关联任务 1 项')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 1.8 只读红线断言（RL-01 / RL-06）
// ---------------------------------------------------------------------------

describe('模块检视只读红线（RL-01 / RL-06）', () => {
  test('任务表区可编辑（勾选/行内编辑），其余检视区严格只读；零保存/提交/确认类按钮', () => {
    const { container } = renderInspector()

    // B2c-2 起任务清单支持行级勾选与就地编辑：全部可编辑控件（input）只允许
    // 出现在任务清单区（[data-tasks-section]），其余模块检视区保持零可编辑控件
    const interactiveControls = container.querySelectorAll(
      'input, textarea, select, [contenteditable="true"]',
    )
    expect(interactiveControls.length).toBeGreaterThan(0)
    for (const control of Array.from(interactiveControls)) {
      expect(control.closest('[data-tasks-section]')).not.toBeNull()
    }

    // 默认章程视图：可访问性树中不存在任何编辑/保存/提交类按钮（隐藏面板不参与）
    for (const interactiveName of ['保存', '提交', '确认', '确定', '修改']) {
      expect(screen.queryByRole('button', { name: new RegExp(interactiveName) })).toBeNull()
    }

    // 展开任务清单：勾选框（表头全选 + 行级）与行内编辑触发器可交互，
    // 零「保存/提交/确认」式提交按钮；非编辑态不挂载输入框
    fireEvent.click(screen.getByRole('tab', { name: '任务清单' }))
    const panel = screen.getByRole('tabpanel', { name: '任务清单' })
    expect(within(panel).getAllByRole('checkbox')).toHaveLength(3) // 表头全选 + 2 行级勾选
    expect(panel.querySelectorAll('[data-edit-trigger]').length).toBeGreaterThan(0)
    expect(panel.querySelectorAll('[data-edit-input]')).toHaveLength(0)
    for (const interactiveName of ['保存', '提交', '确认', '确定', '删除']) {
      expect(within(panel).queryByRole('button', { name: new RegExp(interactiveName) })).toBeNull()
    }
  })

  test('切回章程面板时 WBS 折叠本地态不因标签切换丢失', () => {
    renderInspector()
    fireEvent.click(screen.getByRole('tab', { name: 'WBS 分解树' }))
    // 默认展开态下点击 1.1 收起
    fireEvent.click(document.querySelector('[data-wbs-node-id="w1a"]') as HTMLElement)
    expect(childrenListOf('w1a')).toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '项目章程' }))
    fireEvent.click(screen.getByRole('tab', { name: 'WBS 分解树' }))
    expect(childrenListOf('w1a')).toHaveAttribute('hidden')
  })
})
