import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { LIST_GROUP_FIELDS, type ListGroupField } from '@/lib/api/list-view'

/**
 * 旧版任务表格的个人显示偏好（v3-classic-ui-openproject-table，OpenProject「配置视图」）：
 * 可选列、分组字段、是否显示合计。只存本机；选择框、ID 与任务列固定显示。
 */
export const TASK_TABLE_OPTIONAL_COLUMNS = [
  'priority',
  'status',
  'assignee',
  'startDate',
  'progressPercent',
  'endDate',
  'estimatedHours',
] as const

export type TaskTableColumnId = (typeof TASK_TABLE_OPTIONAL_COLUMNS)[number]

export const TASK_TABLE_COLUMN_LABELS: Record<TaskTableColumnId, string> = {
  priority: '优先级',
  status: '状态',
  assignee: '负责人',
  startDate: '开始日期',
  progressPercent: '进度',
  endDate: '计划截止',
  estimatedHours: '工时',
}

export const TASK_TABLE_GROUP_LABELS: Record<ListGroupField, string> = {
  status: '状态',
  priority: '优先级',
  assignee: '负责人',
}

/** 默认与改版前一致：除开始日期外全部显示。 */
export const DEFAULT_TASK_TABLE_COLUMNS: readonly TaskTableColumnId[] =
  TASK_TABLE_OPTIONAL_COLUMNS.filter((column) => column !== 'startDate')

export const TASK_TABLE_STORE_KEY = 'aiproj-task-table'

export interface TaskTableState {
  columns: TaskTableColumnId[]
  groupBy: ListGroupField | null
  showSums: boolean
  setColumnVisible: (column: TaskTableColumnId, visible: boolean) => void
  setGroupBy: (groupBy: ListGroupField | null) => void
  setShowSums: (showSums: boolean) => void
  reset: () => void
}

function isColumnId(value: unknown): value is TaskTableColumnId {
  return (
    typeof value === 'string' && (TASK_TABLE_OPTIONAL_COLUMNS as readonly string[]).includes(value)
  )
}

function isGroupField(value: unknown): value is ListGroupField {
  return typeof value === 'string' && (LIST_GROUP_FIELDS as readonly string[]).includes(value)
}

/** 按固定顺序排列，保证列顺序与表头一致、与勾选先后无关。 */
function ordered(columns: Iterable<TaskTableColumnId>): TaskTableColumnId[] {
  const set = new Set(columns)
  return TASK_TABLE_OPTIONAL_COLUMNS.filter((column) => set.has(column))
}

export const useTaskTableStore = create<TaskTableState>()(
  persist(
    (set) => ({
      columns: [...DEFAULT_TASK_TABLE_COLUMNS],
      groupBy: null,
      showSums: false,
      setColumnVisible: (column, visible) =>
        set((state) => ({
          columns: ordered(
            visible
              ? [...state.columns, column]
              : state.columns.filter((current) => current !== column),
          ),
        })),
      setGroupBy: (groupBy) => set({ groupBy }),
      setShowSums: (showSums) => set({ showSums }),
      reset: () =>
        set({ columns: [...DEFAULT_TASK_TABLE_COLUMNS], groupBy: null, showSums: false }),
    }),
    {
      name: TASK_TABLE_STORE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        columns: state.columns,
        groupBy: state.groupBy,
        showSums: state.showSums,
      }),
      // 本机数据可能被改坏或来自旧版本：未知列、未知分组一律丢弃。
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<TaskTableState>
        return {
          ...current,
          columns: Array.isArray(saved.columns)
            ? ordered(saved.columns.filter(isColumnId))
            : current.columns,
          groupBy: isGroupField(saved.groupBy) ? saved.groupBy : null,
          showSums: saved.showSums === true,
        }
      },
    },
  ),
)
