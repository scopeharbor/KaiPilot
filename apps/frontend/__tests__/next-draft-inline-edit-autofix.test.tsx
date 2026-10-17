/**
 * v3-ui-next-draft-confirm W2（W-B）—— 任务表勾选、草案态就地编辑、未选策略、
 * 确认前重检与自动修正 Diff 复核门禁单元测试（tasks 1.4/1.5/2.1/2.2/2.3/2.4/2.5/2.6）。
 *
 * 并行开发约定：确认 Store（`@/stores/ai-draft-confirm-store`）由 W-A（tasks 1.2）
 * 交付，本测试文件以 vi.mock 按 design.md D1~D3 契约实现同构内存 Store 隔离验证；
 * 草案 Store（`@/stores/ai-project-draft-store`）消费真实实现（tasks 2.1 由本工组扩展）。
 *
 * 覆盖：
 * - 表头全选/半选与行级勾选联动（toggleTask / selectAll / clearAll 接线与选中态呈现）；
 * - 任务名/工期（0.5~365 步长 0.5）/起止日（endDate >= startDate）/负责人就地编辑：
 *   失焦回车提交、越界与步长校验、AIMarker 升级 explicit 消除假设警报；
 * - 单项（resetDraftFieldEdit）与整任务（resetTaskEdits）撤销修改还原 AI 生成值；
 * - 未选内容处置策略单选（discard/save_as_draft/ask_later）与全部接受模式隐藏；
 * - 悬空依赖横幅与解绑影响透视抽屉（确认排除/撤销排除）；
 * - 确认前重检（aiDraftApi.validate）与 Warning「我已复核」勾选机制；
 * - 自动修正 Diff 复核模态框强制门禁（aiDraftApi.get 拉取新版本重审，RL-02）。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  DraftValidationIssue,
  DraftValidationReport,
  ProjectDraft,
  ProjectDraftDetail,
  ProjectDraftMeta,
  ProjectDraftTask,
  ProjectDraftWbsNode,
} from '@aiproj/types'
import { NextDraftAutoFixModal } from '@/components/next/review/NextDraftAutoFixModal'
import { NextDraftPartialAcceptPanel } from '@/components/next/review/NextDraftPartialAcceptPanel'
import { NextDraftTasksSection } from '@/components/next/review/NextDraftTasksSection'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'

// ---------------------------------------------------------------------------
// Module mocks（并行期隔离：API 客户端 + W-A 确认 Store 契约实现）
// ---------------------------------------------------------------------------

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  reject: vi.fn(),
  validate: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@/lib/api/ai-draft', () => ({
  aiDraftApi: {
    get: apiMock.get,
    save: apiMock.save,
    reject: apiMock.reject,
    validate: apiMock.validate,
    confirm: apiMock.confirm,
  },
}))

/** W-A 确认 Store 契约（design.md D1~D3 / tasks 1.2），测试内同构实现。 */
interface ConfirmStoreTestState {
  mode: 'all' | 'partial'
  selection: {
    taskIds: string[]
    wbsNodeIds: string[]
    acceptanceIds: string[]
    milestoneIds: string[]
    riskHintIds: string[]
    unselectedStrategy: 'discard' | 'save_as_draft' | 'ask_later'
  }
  acknowledgedWarnings: boolean
  isConfirming: boolean
  confirmError: string | null
  confirmModalOpen: boolean
  autoFixModalState: {
    open: boolean
    diffs: Array<{ path: string; before: unknown; after: unknown; reason: string }>
    version: number
  }
  unlinkedAlertTaskId: string | null
  initSelection: (draft: ProjectDraft) => void
  toggleTask: (taskId: string, draft: ProjectDraft) => void
  toggleWbs: (nodeId: string, draft: ProjectDraft) => void
  setMode: (mode: 'all' | 'partial', draft: ProjectDraft) => void
  selectAll: (draft: ProjectDraft) => void
  clearAll: () => void
  setUnselectedStrategy: (strategy: 'discard' | 'save_as_draft' | 'ask_later') => void
  setAcknowledgedWarnings: (value: boolean) => void
  resetConfirmState: () => void
}

vi.mock('@/stores/ai-draft-confirm-store', async () => {
  const { create } = await import('zustand')

  function allWbsIds(draft: ProjectDraft): string[] {
    const ids: string[] = []
    const walk = (nodes: ProjectDraftWbsNode[]): void => {
      for (const node of nodes) {
        ids.push(node.id)
        walk(node.children)
      }
    }
    walk(draft.wbs)
    return ids
  }

  function taskAncestorWbsIds(draft: ProjectDraft, taskId: string): string[] {
    const task = draft.tasks.find((item) => item.id === taskId)
    if (!task) return []
    const byId = new Map<string, ProjectDraftWbsNode>()
    for (const node of draft.wbs) byId.set(node.id, node)
    const ids: string[] = []
    let current = byId.get(task.wbsNodeId)
    while (current) {
      ids.push(current.id)
      current = current.parentId !== null ? byId.get(current.parentId) : undefined
    }
    return ids
  }

  function fullSelection(draft: ProjectDraft): ConfirmStoreTestState['selection'] {
    return {
      taskIds: draft.tasks.map((task) => task.id),
      wbsNodeIds: allWbsIds(draft),
      acceptanceIds: draft.acceptanceCriteria.map((item) => item.id),
      milestoneIds: draft.milestoneHints.map((item) => item.id),
      riskHintIds: draft.riskHints.map((item) => item.id),
      unselectedStrategy: 'discard',
    }
  }

  return {
    useAiDraftConfirmStore: create<ConfirmStoreTestState>((set) => ({
      mode: 'all',
      selection: {
        taskIds: [],
        wbsNodeIds: [],
        acceptanceIds: [],
        milestoneIds: [],
        riskHintIds: [],
        unselectedStrategy: 'discard',
      },
      acknowledgedWarnings: false,
      isConfirming: false,
      confirmError: null,
      confirmModalOpen: false,
      autoFixModalState: { open: false, diffs: [], version: 0 },
      unlinkedAlertTaskId: null,

      initSelection: (draft) => set(() => ({ mode: 'all', selection: fullSelection(draft) })),
      toggleTask: (taskId, draft) =>
        set((state) => {
          const has = state.selection.taskIds.includes(taskId)
          if (has) {
            return {
              mode: 'partial',
              selection: {
                ...state.selection,
                taskIds: state.selection.taskIds.filter((id) => id !== taskId),
              },
            }
          }
          return {
            mode: 'partial',
            selection: {
              ...state.selection,
              taskIds: [...state.selection.taskIds, taskId],
              wbsNodeIds: Array.from(
                new Set([...state.selection.wbsNodeIds, ...taskAncestorWbsIds(draft, taskId)]),
              ),
            },
          }
        }),
      toggleWbs: () => set((state) => state),
      setMode: (mode, draft) =>
        set((state) =>
          mode === 'all'
            ? { mode, selection: fullSelection(draft) }
            : { mode, selection: state.selection },
        ),
      selectAll: (draft) => set(() => ({ mode: 'all', selection: fullSelection(draft) })),
      clearAll: () =>
        set((state) => ({
          mode: 'partial',
          selection: { ...state.selection, taskIds: [], wbsNodeIds: [] },
        })),
      setUnselectedStrategy: (unselectedStrategy) =>
        set((state) => ({ selection: { ...state.selection, unselectedStrategy } })),
      setAcknowledgedWarnings: (acknowledgedWarnings) => set({ acknowledgedWarnings }),
      resetConfirmState: () =>
        set(() => ({
          mode: 'all',
          selection: {
            taskIds: [],
            wbsNodeIds: [],
            acceptanceIds: [],
            milestoneIds: [],
            riskHintIds: [],
            unselectedStrategy: 'discard',
          },
          acknowledgedWarnings: false,
          isConfirming: false,
          confirmError: null,
          confirmModalOpen: false,
          autoFixModalState: { open: false, diffs: [], version: 0 },
          unlinkedAlertTaskId: null,
        })),
    })),
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mk<T>(
  value: T,
  needsConfirmation = true,
): {
  value: T
  marker: { confidence: number; source: 'inferred'; reason: string; needsConfirmation: boolean }
} {
  return {
    value,
    marker: {
      confidence: 0.85,
      source: 'inferred',
      reason: '依据项目类型与常见交付规模推断。',
      needsConfirmation,
    },
  }
}

function makeTask(id: string, wbsNodeId: string, name: string, duration: number): ProjectDraftTask {
  return {
    id,
    wbsNodeId,
    name: mk(name),
    description: {
      value: '',
      marker: { confidence: 0.85, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    status: 'not_started',
    durationDays: {
      value: duration,
      marker: { confidence: 0.85, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
    startDate: {
      value: '2026-09-01',
      marker: { confidence: 0.85, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
    endDate: {
      value: '2026-09-14',
      marker: { confidence: 0.85, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
    assigneeHint: {
      value: '',
      marker: { confidence: 0.85, source: 'inferred', reason: '推断', needsConfirmation: true },
    },
  }
}

function makeDraft(): ProjectDraft {
  const w1: ProjectDraftWbsNode = {
    id: 'w1',
    parentId: null,
    outlineCode: '1',
    isLeaf: false,
    isNote: false,
    children: [],
    name: {
      value: '系统开发',
      marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    description: {
      value: '',
      marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
  }
  const w1a: ProjectDraftWbsNode = {
    id: 'w1a',
    parentId: 'w1',
    outlineCode: '1.1',
    isLeaf: true,
    isNote: false,
    children: [],
    name: {
      value: '需求调研',
      marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    description: {
      value: '',
      marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
  }
  const w1b: ProjectDraftWbsNode = {
    id: 'w1b',
    parentId: 'w1',
    outlineCode: '1.2',
    isLeaf: true,
    isNote: false,
    children: [],
    name: {
      value: '接口开发',
      marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
    description: {
      value: '',
      marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
    },
  }
  w1.children = [w1a, w1b]

  return {
    schemaVersion: '1.0',
    projectType: 'software',
    charter: {
      title: {
        value: '企业协作平台',
        marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      vision: {
        value: '协作高效',
        marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      scope: {
        value: '任务管理',
        marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      objectives: {
        value: ['交付可用平台'],
        marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      successCriteria: {
        value: ['看板可用'],
        marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      startDate: {
        value: '2026-09-01',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      endDate: {
        value: '2026-12-31',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
    },
    wbs: [w1],
    tasks: [makeTask('t1', 'w1a', '需求调研执行', 10), makeTask('t2', 'w1b', '后端接口开发', 8)],
    dependencies: [
      {
        id: 'd1',
        predecessorId: 't1',
        successorId: 't2',
        type: 'FS',
        lagDays: {
          value: 1,
          marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
      },
    ],
    acceptanceCriteria: [],
    resourceHints: [],
    riskHints: [],
    milestoneHints: [],
    ganttPreview: {
      startDate: {
        value: '2026-09-01',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      endDate: {
        value: '2026-12-31',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      totalDurationDays: {
        value: 120,
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      criticalPathTaskIds: ['t1'],
      phaseCount: 2,
    },
  }
}

function makeMeta(): ProjectDraftMeta {
  return {
    schemaVersion: '1.0',
    projectType: 'software',
    structuredStrategy: 'native',
    consistency: 'strict',
    fallbackUsed: false,
    provider: 'mock',
    model: 'mock-model',
    usingRealAdapter: false,
    appliedFixes: [],
    moduleCounts: {
      wbsNodes: 3,
      tasks: 2,
      dependencies: 1,
      acceptanceCriteria: 0,
      resourceHints: 0,
      riskHints: 0,
      milestoneHints: 0,
    },
  }
}

function makeValidation(overrides: Partial<DraftValidationReport> = {}): DraftValidationReport {
  return {
    overallRiskLevel: 'low',
    confidenceScore: 0.92,
    dimensionScores: {
      factualAccuracy: 90,
      logicalConsistency: 90,
      assumptionClarity: 88,
      completeness: 95,
      numericPlausibility: 90,
    },
    blocking: [],
    warning: [],
    info: [],
    ruleResults: [],
    autoFixDiffs: [],
    canConfirm: true,
    ...overrides,
  }
}

function makeDetail(overrides: Partial<ProjectDraftDetail> = {}): ProjectDraftDetail {
  return {
    draftId: 'df_w2_test',
    version: 1,
    status: 'reviewing',
    generationState: 'settled',
    projectType: 'software',
    draft: makeDraft(),
    meta: makeMeta(),
    validation: makeValidation(),
    events: [],
    ...overrides,
  }
}

function warningIssue(ruleId: string, message = `规则 ${ruleId} 告警`): DraftValidationIssue {
  return { ruleId, severity: 'warning', message, path: null, failed: true }
}

// ---------------------------------------------------------------------------
// Store 重置与挂载辅助
// ---------------------------------------------------------------------------

function resetDraftStore() {
  sessionStorage.clear()
  useAiProjectDraftStore.setState({
    schemaVersion: '1.0',
    userId: 1,
    organizationId: 1,
    status: 'ready',
    rawInput: '',
    cards: [],
    answers: {},
    parsedIntent: null,
    context: null,
    clarificationPhase: 'ready',
    activeCard: null,
    remainingCount: 0,
    completedCount: 0,
    totalCount: 0,
    questionPlanRevision: null,
    agentQuestionPlanToken: null,
    adaptiveSession: null,
    adaptiveSessionToken: null,
    questionPlanCoverage: null,
    error: null,
    restored: false,
    draftStatus: null,
    draftId: null,
    draftVersion: 0,
    draft: null,
    draftMeta: null,
    draftFailure: null,
    validation: null,
    moduleStatuses: {},
    lastEventSequence: 0,
    pendingModifications: [],
  })
}

/** 以审查现场形态载入 store（setDraftCompleted 捕获初始快照，供撤销还原）。 */
function mountReviewStore(draft: ProjectDraft = makeDraft()) {
  resetDraftStore()
  const store = useAiProjectDraftStore.getState()
  store.setDraftCompleted(draft, makeMeta(), makeValidation())
  useAiProjectDraftStore.setState({ draftId: 'df_w2_test', draftVersion: 1 })
  useAiDraftConfirmStore.getState().resetConfirmState()
  useAiDraftConfirmStore.getState().initSelection(draft)
}

/** 任务表测试 Harness：镜像 ReviewPanel→ModuleInspector 装配（订阅 store draft 驱动重渲染）。 */
function TasksHarness() {
  const draft = useAiProjectDraftStore((state) => state.draft)
  if (!draft) return null
  return <NextDraftTasksSection tasks={draft.tasks} wbs={draft.wbs} draft={draft} />
}

/** t1 任务行最新 DOM 节点（编辑提交后重渲染，需现取）。 */
function t1Row(): HTMLElement {
  const row = document.querySelector('[data-task-row][data-task-id="t1"]')
  if (!row) throw new Error('t1 任务行不存在')
  return row as HTMLElement
}

function storeDraft(): ProjectDraft {
  const draft = useAiProjectDraftStore.getState().draft
  if (!draft) throw new Error('draft store 未载入')
  return draft
}

const currentTask = (taskId: string): ProjectDraftTask => {
  const task = storeDraft().tasks.find((item) => item.id === taskId)
  if (!task) throw new Error(`任务 ${taskId} 不存在`)
  return task
}

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.validate.mockReset()
  apiMock.confirm.mockReset()
})

// ---------------------------------------------------------------------------
// 1.4 任务表 Checkbox：表头全选/半选、行级勾选联动确认 Store
// ---------------------------------------------------------------------------

describe('NextDraftTasksSection 行级多选（tasks 1.4）', () => {
  test('初始全部接受模式：所有任务行勾选、表头全选；统计呈现已选任务数', () => {
    mountReviewStore()
    render(<TasksHarness />)

    const checkboxes = document.querySelectorAll('[data-task-checkbox]')
    expect(checkboxes).toHaveLength(2)
    for (const checkbox of checkboxes) {
      expect(checkbox).toHaveProperty('checked', true)
    }
    const selectAll = document.querySelector('[data-task-select-all]') as HTMLInputElement
    expect(selectAll).toHaveProperty('checked', true)
    expect(selectAll.indeterminate).toBe(false)
  })

  test('行级取消勾选：联动确认 Store（mode 切 partial、taskIds 剔除、父链 WBS 保留）', () => {
    mountReviewStore()
    render(<TasksHarness />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择任务 需求调研执行' }))

    const confirm = useAiDraftConfirmStore.getState()
    expect(confirm.mode).toBe('partial')
    expect(confirm.selection.taskIds).toEqual(['t2'])
    // 父链级联包含：t1 所属 w1a 与其祖先 w1 仍在选择集（仅移除任务，不动大纲骨架）
    expect(confirm.selection.wbsNodeIds).toContain('w1a')
    expect(confirm.selection.wbsNodeIds).toContain('w1')

    const unchecked = document.querySelector(
      '[data-task-checkbox][aria-label="选择任务 需求调研执行"]',
    ) as HTMLInputElement
    expect(unchecked).toHaveProperty('checked', false)
    const selectAll = document.querySelector('[data-task-select-all]') as HTMLInputElement
    expect(selectAll.indeterminate).toBe(true)
    expect(selectAll).toHaveProperty('checked', false)
  })

  test('再次勾选恢复选中：taskIds 回补；表头全选态恢复', () => {
    mountReviewStore()
    render(<TasksHarness />)

    fireEvent.click(screen.getByRole('checkbox', { name: '选择任务 需求调研执行' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择任务 需求调研执行' }))

    const confirm = useAiDraftConfirmStore.getState()
    // 回补任务集中在同一集合（追加序与剔除序无关）
    expect(new Set(confirm.selection.taskIds)).toEqual(new Set(['t1', 't2']))
    const selectAll = document.querySelector('[data-task-select-all]') as HTMLInputElement
    expect(selectAll).toHaveProperty('checked', true)
    expect(selectAll.indeterminate).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2.2 就地编辑：工期/名称/起止日/负责人 + explicit 升级与边界校验
// ---------------------------------------------------------------------------

describe('NextDraftTasksSection 就地编辑（tasks 2.2）', () => {
  test('工期编辑提交：applyDraftFieldEdit 落本地草案 + pendingModifications + explicit 升级消除警报', () => {
    mountReviewStore()
    render(<TasksHarness />)

    // 进入工期编辑（t1 行）
    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑工期' }))
    const input = document.querySelector('[data-edit-input="duration"]') as HTMLInputElement
    expect(input).not.toBeNull()

    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.blur(input)

    const store = useAiProjectDraftStore.getState()
    expect(store.pendingModifications).toContainEqual({
      path: 'tasks[t1].durationDays',
      value: 8,
    })
    expect(store.draftStatus).toBe('editing')
    const task = currentTask('t1')
    expect(task.durationDays.value).toBe(8)
    expect(task.durationDays.marker.source).toBe('explicit')
    expect(task.durationDays.marker.confidence).toBe(1)
    expect(task.durationDays.marker.needsConfirmation).toBe(false)
    expect(task.durationDays.marker.reason).toContain('手动修改')
  })

  test('工期边界与步长校验：0.5 以下 / 365 以上 / 非 0.5 步长均拒绝且不落库', () => {
    mountReviewStore()
    render(<TasksHarness />)

    const enter = (value: string) => {
      // 前一次非法提交后编辑态保持打开（无触发按钮），无需重复点击
      const trigger = within(t1Row()).queryByRole('button', { name: '编辑工期' })
      if (trigger) fireEvent.click(trigger)
      const input = document.querySelector('[data-edit-input="duration"]') as HTMLInputElement
      fireEvent.change(input, { target: { value } })
      fireEvent.blur(input)
    }

    enter('0.4')
    expect(screen.getByText('工期需在 0.5~365 天之间')).toBeInTheDocument()
    enter('366')
    expect(screen.getByText('工期需在 0.5~365 天之间')).toBeInTheDocument()
    enter('8.3')
    expect(screen.getByText('工期步长为 0.5 天')).toBeInTheDocument()
    enter('')
    expect(screen.getByText('工期需为 0.5~365 天之间的数值')).toBeInTheDocument()

    expect(useAiProjectDraftStore.getState().pendingModifications).toHaveLength(0)
    expect(currentTask('t1').durationDays.value).toBe(10)
  })

  test('步进微调器：按 0.5 步长增减并在 0.5~365 边界钳制', () => {
    mountReviewStore()
    render(<TasksHarness />)

    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑工期' }))
    const input = document.querySelector('[data-edit-input="duration"]') as HTMLInputElement
    expect(input).toHaveValue(10)

    fireEvent.click(screen.getByRole('button', { name: '工期加 0.5 天' }))
    expect(input).toHaveValue(10.5)

    fireEvent.click(screen.getByRole('button', { name: '工期减 0.5 天' }))
    expect(input).toHaveValue(10)

    // 边界钳制：先输入到边界附近再步进（原先连点 1450 次，全量并发负载下会超时）
    fireEvent.change(input, { target: { value: '364' } })
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: '工期加 0.5 天' }))
    }
    expect(input).toHaveValue(365)
    fireEvent.click(screen.getByRole('button', { name: '工期加 0.5 天' }))
    expect(input).toHaveValue(365)

    fireEvent.change(input, { target: { value: '1.5' } })
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: '工期减 0.5 天' }))
    }
    expect(input).toHaveValue(0.5)
    fireEvent.click(screen.getByRole('button', { name: '工期减 0.5 天' }))
    expect(input).toHaveValue(0.5)

    // 失焦提交合法值
    fireEvent.blur(input)
    expect(useAiProjectDraftStore.getState().pendingModifications).toContainEqual({
      path: 'tasks[t1].durationDays',
      value: 0.5,
    })
  })

  test('回车提交与 Esc 取消', () => {
    mountReviewStore()
    render(<TasksHarness />)

    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑工期' }))
    const input = document.querySelector('[data-edit-input="duration"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '6.5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useAiProjectDraftStore.getState().pendingModifications).toContainEqual({
      path: 'tasks[t1].durationDays',
      value: 6.5,
    })

    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑工期' }))
    const again = document.querySelector('[data-edit-input="duration"]') as HTMLInputElement
    fireEvent.change(again, { target: { value: '999' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(useAiProjectDraftStore.getState().pendingModifications).toHaveLength(1)
    expect(currentTask('t1').durationDays.value).toBe(6.5)
  })

  test('任务名称编辑：非空、最长 100 字，失焦提交后名称就地更新', () => {
    mountReviewStore()
    render(<TasksHarness />)

    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑任务名称（需求调研执行）' }))
    const input = document.querySelector('[data-edit-input="name"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '需求调研与范围确认' } })
    fireEvent.blur(input)

    const store = useAiProjectDraftStore.getState()
    expect(store.pendingModifications).toContainEqual({
      path: 'tasks[t1].name',
      value: '需求调研与范围确认',
    })
    expect(storeDraft().tasks[0]?.name.value).toBe('需求调研与范围确认')

    // 空名拒绝（提交后行重渲染，按更新后的名称定位触发按钮）
    fireEvent.click(
      within(t1Row()).getByRole('button', { name: '编辑任务名称（需求调研与范围确认）' }),
    )
    const empty = document.querySelector('[data-edit-input="name"]') as HTMLInputElement
    fireEvent.change(empty, { target: { value: '   ' } })
    fireEvent.blur(empty)
    expect(screen.getByText('任务名称不能为空')).toBeInTheDocument()
  })

  test('计划起止日编辑：end < start 拒绝；合法修改成对提交且升级 explicit', () => {
    mountReviewStore()
    render(<TasksHarness />)

    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑计划起止' }))
    const startInput = document.querySelector('[data-edit-input="start"]') as HTMLInputElement
    const endInput = document.querySelector('[data-edit-input="end"]') as HTMLInputElement
    expect(startInput).not.toBeNull()
    expect(endInput).not.toBeNull()

    // 结束日在开始日之前 → 拒绝
    fireEvent.change(startInput, { target: { value: '2026-09-10' } })
    fireEvent.change(endInput, { target: { value: '2026-09-08' } })
    fireEvent.blur(startInput)
    expect(screen.getByText('结束日期不能早于开始日期')).toBeInTheDocument()
    expect(useAiProjectDraftStore.getState().pendingModifications).toHaveLength(0)

    // 合法成对修改：错误提示后恢复开始日为现值，仅变更结束日落库
    fireEvent.change(startInput, { target: { value: '2026-09-01' } })
    fireEvent.change(endInput, { target: { value: '2026-09-20' } })
    fireEvent.keyDown(endInput, { key: 'Enter' })
    expect(useAiProjectDraftStore.getState().pendingModifications).toContainEqual({
      path: 'tasks[t1].endDate',
      value: '2026-09-20',
    })
    expect(currentTask('t1').endDate.value).toBe('2026-09-20')
    expect(currentTask('t1').endDate.marker.source).toBe('explicit')
    // 未变更的开始日不落修改记录
    expect(useAiProjectDraftStore.getState().pendingModifications).not.toContainEqual({
      path: 'tasks[t1].startDate',
      value: '2026-09-10',
    })
  })

  test('负责人建议编辑：最长 50 字提交', () => {
    mountReviewStore()
    render(<TasksHarness />)

    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑负责人建议（）' }))
    const input = document.querySelector('[data-edit-input="assignee"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '王启明' } })
    fireEvent.blur(input)

    expect(useAiProjectDraftStore.getState().pendingModifications).toContainEqual({
      path: 'tasks[t1].assigneeHint',
      value: '王启明',
    })
    expect(currentTask('t1').assigneeHint.marker.source).toBe('explicit')
  })

  test('编辑后字段展示「已人工修正」徽章并移除推断置信度标签', () => {
    mountReviewStore()
    render(<TasksHarness />)

    const row = t1Row()
    expect(within(row).getAllByText('85%').length).toBeGreaterThan(0)

    fireEvent.click(within(row).getByRole('button', { name: '编辑工期' }))
    const input = document.querySelector('[data-edit-input="duration"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.blur(input)

    const updatedRow = document.querySelector('[data-task-row][data-task-id="t1"]') as HTMLElement
    expect(within(updatedRow).getByText('已人工修正')).toBeInTheDocument()
    expect(updatedRow.querySelector('[data-field-explicit]')).not.toBeNull()
    // 该字段推断置信度标签移除（4 个推断字段减为 3 个），其余字段保持推断态
    expect(updatedRow.querySelectorAll('[data-marked-confidence]')).toHaveLength(3)
    const otherRow = document.querySelector('[data-task-row][data-task-id="t2"]') as HTMLElement
    expect(within(otherRow).getAllByText('85%').length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 2.1 撤销修改：resetDraftFieldEdit / resetTaskEdits
// ---------------------------------------------------------------------------

describe('草案 Store 撤销修改（tasks 2.1）', () => {
  test('resetDraftFieldEdit：还原单项 AI 生成值并移除修改记录，其他字段修改保留', () => {
    mountReviewStore()
    useAiProjectDraftStore.getState().applyDraftFieldEdit('tasks[t1].durationDays', 5)
    useAiProjectDraftStore.getState().applyDraftFieldEdit('tasks[t1].name', '改名后的任务')

    useAiProjectDraftStore.getState().resetDraftFieldEdit('tasks[t1].durationDays')

    const store = useAiProjectDraftStore.getState()
    expect(store.pendingModifications).toEqual([{ path: 'tasks[t1].name', value: '改名后的任务' }])
    expect(storeDraft().tasks[0]?.durationDays.value).toBe(10)
    expect(storeDraft().tasks[0]?.durationDays.marker.source).toBe('inferred')
    expect(storeDraft().tasks[0]?.durationDays.marker.needsConfirmation).toBe(true)
    expect(storeDraft().tasks[0]?.name.value).toBe('改名后的任务')
  })

  test('resetTaskEdits：整任务字段全部还原为 AI 生成初始值（含推断标记）', () => {
    mountReviewStore()
    useAiProjectDraftStore.getState().applyDraftFieldEdit('tasks[t1].name', '改名后的任务')
    useAiProjectDraftStore.getState().applyDraftFieldEdit('tasks[t1].durationDays', 5)
    useAiProjectDraftStore.getState().applyDraftFieldEdit('tasks[t2].durationDays', 3)

    useAiProjectDraftStore.getState().resetTaskEdits('t1')

    const store = useAiProjectDraftStore.getState()
    expect(store.pendingModifications).toEqual([{ path: 'tasks[t2].durationDays', value: 3 }])
    expect(storeDraft().tasks.find((task) => task.id === 't1')?.name.value).toBe('需求调研执行')
    expect(storeDraft().tasks.find((task) => task.id === 't1')?.durationDays.value).toBe(10)
    expect(storeDraft().tasks.find((task) => task.id === 't1')?.durationDays.marker.source).toBe(
      'inferred',
    )
    expect(storeDraft().tasks.find((task) => task.id === 't2')?.durationDays.value).toBe(3)
  })

  test('行末「撤销修改」按钮：点击还原该任务全部字段并消失', async () => {
    mountReviewStore()
    render(<TasksHarness />)

    // 初始无撤销按钮
    expect(document.querySelector('[data-task-reset]')).toBeNull()

    // 编辑两个字段
    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑工期' }))
    const duration = document.querySelector('[data-edit-input="duration"]') as HTMLInputElement
    fireEvent.change(duration, { target: { value: '5' } })
    fireEvent.blur(duration)

    fireEvent.click(within(t1Row()).getByRole('button', { name: '编辑任务名称（需求调研执行）' }))
    const name = document.querySelector('[data-edit-input="name"]') as HTMLInputElement
    fireEvent.change(name, { target: { value: '改名后的任务' } })
    fireEvent.blur(name)

    // 编辑后行重渲染：重新定位最新 DOM 节点，撤销按钮按更新后的名称标注
    const row = t1Row()
    const resetButton = within(row).getByRole('button', { name: '撤销 改名后的任务 的修改' })
    fireEvent.click(resetButton)

    expect(useAiProjectDraftStore.getState().pendingModifications).toHaveLength(0)
    expect(storeDraft().tasks.find((task) => task.id === 't1')?.durationDays.value).toBe(10)
    expect(storeDraft().tasks.find((task) => task.id === 't1')?.name.value).toBe('需求调研执行')

    // 撤销后按钮消失、推断置信度恢复（重新查询最新 DOM 节点）
    await waitFor(() => expect(document.querySelector('[data-task-reset]')).toBeNull())
    const updatedRow = t1Row()
    expect(within(updatedRow).getAllByText('85%').length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 2.3 未选内容处置策略单选
// ---------------------------------------------------------------------------

describe('NextDraftPartialAcceptPanel 未选策略（tasks 2.3）', () => {
  function renderPanel() {
    return render(
      <NextDraftPartialAcceptPanel
        draftId="df_w2_test"
        draft={useAiProjectDraftStore.getState().draft!}
      />,
    )
  }

  test('全部接受模式下策略单选隐藏；切换局部选择后展示三个互斥选项', () => {
    mountReviewStore()
    renderPanel()
    expect(document.querySelector('[data-strategy-group]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '局部选择' }))
    const options = document.querySelectorAll('[data-strategy]')
    expect(options).toHaveLength(3)
    expect(screen.getByText('彻底丢弃未选项')).toBeInTheDocument()
    expect(screen.getByText('保留为后续草稿')).toBeInTheDocument()
    expect(screen.getByText('稍后提醒我')).toBeInTheDocument()
    // 默认 discard
    expect(useAiDraftConfirmStore.getState().selection.unselectedStrategy).toBe('discard')
  })

  test('选择「保留为后续草稿」：同步确认 Store unselectedStrategy（提交请求体映射）', () => {
    mountReviewStore()
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '局部选择' }))

    fireEvent.click(screen.getByRole('radio', { name: /保留为后续草稿/ }))
    expect(useAiDraftConfirmStore.getState().selection.unselectedStrategy).toBe('save_as_draft')

    fireEvent.click(screen.getByRole('radio', { name: /稍后提醒我/ }))
    expect(useAiDraftConfirmStore.getState().selection.unselectedStrategy).toBe('ask_later')

    // 切回全部接受：单选组隐藏
    fireEvent.click(screen.getByRole('button', { name: '全部接受' }))
    expect(document.querySelector('[data-strategy-group]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 1.5 悬空依赖解绑警示横幅与影响透视抽屉
// ---------------------------------------------------------------------------

describe('NextDraftPartialAcceptPanel 悬空依赖（tasks 1.5）', () => {
  test('取消勾选前置任务触发琥珀色横幅；抽屉列出两端任务名/类型/滞后天数', () => {
    mountReviewStore()
    render(
      <NextDraftPartialAcceptPanel
        draftId="df_w2_test"
        draft={useAiProjectDraftStore.getState().draft!}
      />,
    )

    // 全选态无横幅
    expect(document.querySelector('[data-dangling-banner]')).toBeNull()

    // 取消勾选 t1（t2 的 FS 前置）：外部 Store 变更需包在 act 中触发同步重渲染
    act(() => {
      useAiDraftConfirmStore.getState().toggleTask('t1', useAiProjectDraftStore.getState().draft!)
    })

    const banner = document.querySelector('[data-dangling-banner]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('1 条依赖因任务未勾选而悬空')

    fireEvent.click(screen.getByRole('button', { name: '查看解绑影响' }))
    const drawer = document.querySelector('[data-unlink-drawer]')
    expect(drawer).not.toBeNull()
    const depLine = drawer?.querySelector('[data-dangling-dep]')
    expect(depLine?.textContent).toContain('需求调研执行')
    expect(depLine?.textContent).toContain('[FS +1d]')
    expect(depLine?.textContent).toContain('后端接口开发')
  })

  test('任务行徽章打开该任务的解绑透视；确认排除折叠抽屉保持排除', () => {
    mountReviewStore()
    render(
      <NextDraftPartialAcceptPanel
        draftId="df_w2_test"
        draft={useAiProjectDraftStore.getState().draft!}
      />,
    )
    render(<TasksHarness />)

    act(() => {
      useAiDraftConfirmStore.getState().toggleTask('t1', storeDraft())
    })
    const badge = document.querySelector('[data-dangling-badge]')
    expect(badge).not.toBeNull()
    fireEvent.click(badge as HTMLElement)
    expect(useAiDraftConfirmStore.getState().unlinkedAlertTaskId).toBe('t1')
    expect(document.querySelector('[data-unlink-drawer]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '确认排除（自动解绑）' }))
    expect(document.querySelector('[data-unlink-drawer]')).toBeNull()
    expect(useAiDraftConfirmStore.getState().selection.taskIds).not.toContain('t1')
  })

  test('撤销排除（保留依赖）：重新包含被排除任务并折叠抽屉', () => {
    mountReviewStore()
    render(
      <NextDraftPartialAcceptPanel
        draftId="df_w2_test"
        draft={useAiProjectDraftStore.getState().draft!}
      />,
    )

    act(() => {
      useAiDraftConfirmStore.getState().toggleTask('t1', useAiProjectDraftStore.getState().draft!)
    })
    fireEvent.click(screen.getByRole('button', { name: '查看解绑影响' }))
    fireEvent.click(screen.getByRole('button', { name: '撤销排除（保留依赖）' }))

    expect(new Set(useAiDraftConfirmStore.getState().selection.taskIds)).toEqual(
      new Set(['t1', 't2']),
    )
    expect(document.querySelector('[data-unlink-drawer]')).toBeNull()
    expect(document.querySelector('[data-dangling-banner]')).toBeNull()
  })

  test('清空选择集：提示「至少需要选择 1 项任务方可转正」', () => {
    mountReviewStore()
    render(
      <NextDraftPartialAcceptPanel
        draftId="df_w2_test"
        draft={useAiProjectDraftStore.getState().draft!}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(useAiDraftConfirmStore.getState().selection.taskIds).toHaveLength(0)
    expect(screen.getByText('至少需要选择 1 项任务方可转正')).toBeInTheDocument()
    expect(screen.getByText(/已选 0\/2 项任务/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(useAiDraftConfirmStore.getState().selection.taskIds).toEqual(['t1', 't2'])
    expect(useAiDraftConfirmStore.getState().mode).toBe('all')
  })
})

// ---------------------------------------------------------------------------
// 2.5 确认前服务端重检与 Warning 人工确认机制
// ---------------------------------------------------------------------------

describe('确认前重检与警告勾选（tasks 2.5）', () => {
  function renderPanel() {
    return render(
      <NextDraftPartialAcceptPanel
        draftId="df_w2_test"
        draft={useAiProjectDraftStore.getState().draft!}
      />,
    )
  }

  test('重新校验：携带当前 selection 与就地编辑 modifications 调用 aiDraftApi.validate，报告回填草案 Store', async () => {
    mountReviewStore()
    apiMock.validate.mockResolvedValueOnce({
      version: 1,
      report: makeValidation({ warning: [warningIssue('HL-004')] }),
      autoFixDiffs: [],
    })
    // 就地编辑累积（与 confirm 载荷同构）：重检必须原样携带，服务端才能基于编辑后内容校验
    useAiProjectDraftStore.setState({
      pendingModifications: [{ path: 'tasks[t1].durationDays', value: 8 }],
    })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '重新校验' }))
    await waitFor(() => expect(apiMock.validate).toHaveBeenCalledTimes(1))

    const [calledDraftId, payload] = apiMock.validate.mock.calls[0] as [string, unknown]
    expect(calledDraftId).toBe('df_w2_test')
    expect(payload).toMatchObject({ phase: 'all', selection: expect.any(Object) })
    expect(payload).toMatchObject({
      modifications: [{ path: 'tasks[t1].durationDays', value: 8 }],
    })

    expect(useAiProjectDraftStore.getState().validation?.warning).toHaveLength(1)
  })

  test('Warning 告警且零 Blocking：呈现警告提示条与复核复选框；未勾选 acknowledgedWarnings 为 false、勾选后为 true', () => {
    mountReviewStore()
    useAiProjectDraftStore.setState({
      validation: makeValidation({ warning: [warningIssue('HL-004'), warningIssue('VE-003')] }),
    })
    renderPanel()

    const strip = document.querySelector('[data-warning-strip]') as HTMLElement
    expect(strip).not.toBeNull()
    expect(strip.textContent).toContain('2 项告警')
    expect(useAiDraftConfirmStore.getState().acknowledgedWarnings).toBe(false)

    const checkbox = document.querySelector('[data-ack-warnings-checkbox]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    fireEvent.click(checkbox)
    expect(useAiDraftConfirmStore.getState().acknowledgedWarnings).toBe(true)

    fireEvent.click(checkbox)
    expect(useAiDraftConfirmStore.getState().acknowledgedWarnings).toBe(false)
  })

  test('存在 Blocking 违规：阻断提示呈现且不渲染警告复核复选框', () => {
    mountReviewStore()
    useAiProjectDraftStore.setState({
      validation: makeValidation({
        blocking: [
          { ruleId: 'HL-007', severity: 'blocking', message: '依赖循环', path: null, failed: true },
        ],
      }),
    })
    renderPanel()

    expect(screen.getByText(/存在 1 项阻断级违规/)).toBeInTheDocument()
    expect(document.querySelector('[data-ack-warnings-checkbox]')).toBeNull()
  })

  test('重检产生自动修正：打开 AutoFix 模态（autoFixModalState 置位）', async () => {
    mountReviewStore()
    apiMock.validate.mockResolvedValueOnce({
      version: 2,
      report: makeValidation(),
      autoFixDiffs: [
        {
          path: 'tasks[t1].durationDays',
          before: 720,
          after: 30,
          reason: '工期超出上限，自动修正为 30 天',
        },
      ],
    })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '重新校验' }))
    await waitFor(() => expect(apiMock.validate).toHaveBeenCalledTimes(1))

    const modalState = useAiDraftConfirmStore.getState().autoFixModalState
    expect(modalState.open).toBe(true)
    expect(modalState.diffs).toHaveLength(1)
    expect(modalState.version).toBe(2)
  })

  test('重检失败：呈现错误提示且不写入校验报告', async () => {
    mountReviewStore()
    apiMock.validate.mockRejectedValueOnce({ code: 'AI_SERVICE_ERROR', message: '校验服务不可用' })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '重新校验' }))
    await screen.findByText('重新校验失败：校验服务不可用')
    expect(useAiProjectDraftStore.getState().validation?.warning).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2.4 自动修正 Diff 复核模态框（RL-02 强制门禁）
// ---------------------------------------------------------------------------

describe('NextDraftAutoFixModal（tasks 2.4）', () => {
  function openModal(version = 2) {
    useAiDraftConfirmStore.setState({
      autoFixModalState: {
        open: true,
        diffs: [
          {
            path: 'tasks[t1].durationDays',
            before: 720,
            after: 30,
            reason: '工期超出上限，自动修正为 30 天',
          },
        ],
        version,
      },
    })
  }

  test('未打开时不渲染任何 DOM', () => {
    mountReviewStore()
    const { container } = render(<NextDraftAutoFixModal />)
    expect(container.firstChild).toBeNull()
  })

  test('逐条展示路径/修正前/修正后/原因与新版本号，强制闭环确认按钮', () => {
    mountReviewStore()
    openModal(2)
    render(<NextDraftAutoFixModal />)

    const dialog = screen.getByRole('dialog', { name: '自动修正复核' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('v2')).toBeInTheDocument()
    expect(dialog.textContent).toContain('tasks[t1].durationDays')
    expect(within(dialog).getByText('720 天')).toBeInTheDocument()
    expect(within(dialog).getByText('30 天')).toBeInTheDocument()
    expect(dialog.textContent).toContain('工期超出上限，自动修正为 30 天')
    expect(screen.getByRole('button', { name: '已复核并载入新版本草案' })).toBeInTheDocument()
  })

  test('点击「已复核并载入新版本草案」：拉取最新版本重载工作面并重新初始化选择集', async () => {
    mountReviewStore()
    const newDraft = makeDraft()
    newDraft.tasks = newDraft.tasks.map((task) =>
      task.id === 't1'
        ? {
            ...task,
            durationDays: {
              value: 30,
              marker: {
                confidence: 0.99,
                source: 'inferred',
                reason: '自动修正',
                needsConfirmation: false,
              },
            },
          }
        : task,
    )
    apiMock.get.mockResolvedValueOnce(
      makeDetail({ version: 2, draft: newDraft, validation: makeValidation() }),
    )
    openModal(2)
    render(<NextDraftAutoFixModal />)

    fireEvent.click(screen.getByRole('button', { name: '已复核并载入新版本草案' }))

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('df_w2_test'))
    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftVersion).toBe(2)
    })
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('reviewing')
    expect(useAiProjectDraftStore.getState().draft?.tasks[0]?.durationDays.value).toBe(30)
    // 选择集按新草案重建为全选
    expect(useAiDraftConfirmStore.getState().selection.taskIds).toEqual(['t1', 't2'])
    // 模态框关闭
    expect(useAiDraftConfirmStore.getState().autoFixModalState.open).toBe(false)
    expect(screen.queryByRole('dialog', { name: '自动修正复核' })).toBeNull()
  })

  test('载入失败：保留模态框与错误提示，可原地重试', async () => {
    mountReviewStore()
    apiMock.get.mockRejectedValueOnce(new Error('Failed to fetch'))
    openModal(2)
    render(<NextDraftAutoFixModal />)

    fireEvent.click(screen.getByRole('button', { name: '已复核并载入新版本草案' }))
    await screen.findByText('新版本载入失败：Failed to fetch')
    expect(useAiDraftConfirmStore.getState().autoFixModalState.open).toBe(true)
    expect(useAiProjectDraftStore.getState().draftVersion).toBe(1)
  })

  test('「暂不载入」仅收起模态：不触发任何网络请求，确认流保持阻断', () => {
    mountReviewStore()
    openModal(2)
    render(<NextDraftAutoFixModal />)

    fireEvent.click(screen.getByRole('button', { name: '暂不载入' }))
    expect(useAiDraftConfirmStore.getState().autoFixModalState.open).toBe(false)
    expect(apiMock.get).not.toHaveBeenCalled()
    expect(apiMock.confirm).not.toHaveBeenCalled()
  })
})
