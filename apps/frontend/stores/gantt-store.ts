import { create, type StateCreator } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  GanttDependencyDraft,
  GanttEntry,
  GanttGranularity,
  GanttScheduleDraft,
} from '@/lib/gantt/types'
import type {
  GanttInteractionDraft,
  GanttInteractionMode,
  GanttNavigationTarget,
} from '@/lib/gantt/interaction-types'

/** localStorage 持久化 key（仅应用级单例使用；dev harness / 测试的独立实例不持久化）。 */
export const GANTT_STORE_KEY = 'aiproj-gantt'

/**
 * 甘特视图态（T018 → V2 gantt-interaction-upgrade）。**每视图实例一份**。
 *
 * V1 覆盖：粒度、双入口、悬停/选中任务、「显示全部依赖」/「问题链」开关、拖拽 preview/pending。
 * V2 交互层（design D1）新增：多选集合、焦点任务、交互模式、统一草稿、叠加层可控开关、导航目标。
 * 视口滚动态不入此 store（走 `useGanttViewport` 命令式更新，脱离 React 渲染循环，design D8）。
 *
 * 与 `ui-store`（密度/主题）正交：密度切换由 `[data-density]` 级联，甘特读解析后的行高。
 */
export interface GanttViewState {
  granularity: GanttGranularity
  setGranularity: (g: GanttGranularity) => void

  entry: GanttEntry
  setEntry: (e: GanttEntry) => void

  /** 交互模式（design D3）：默认 `select`，切换只改可交互图元、并清理未确认草稿。 */
  mode: GanttInteractionMode
  setMode: (mode: GanttInteractionMode) => void

  /** 悬停任务 id（驱动依赖链高亮）；null=无。 */
  hoveredTaskId: number | null
  setHoveredTaskId: (id: number | null) => void

  /** 选中任务 id（驻留高亮，点击设定）。多选时为「主选」/最后选中项。 */
  selectedTaskId: number | null
  setSelectedTaskId: (id: number | null) => void

  /** 多选集合（design D1）：批量审查/定位用；引用在每次变更时替换以触发渲染。 */
  selection: Set<number>
  toggleSelection: (id: number) => void
  setSelection: (ids: Iterable<number>) => void
  clearSelection: () => void

  /** 键盘焦点任务（与鼠标选中解耦；键盘导航/步进锚点）。 */
  focusTaskId: number | null
  setFocusTaskId: (id: number | null) => void

  /** 统一交互草稿（design D2）：拖拽/键盘/表单产出同一类，页面转 preview/mutation。 */
  draft: GanttInteractionDraft | null
  setDraft: (draft: GanttInteractionDraft | null) => void
  clearDraft: () => void

  /** 导航目标（design D5）：只改视口/焦点；页面消费后置空。 */
  navigationTarget: GanttNavigationTarget | null
  requestNavigation: (target: GanttNavigationTarget) => void
  clearNavigation: () => void

  /** 「显示全部依赖」开关（标准入口）：绕过上下文裁剪、显示全量 muted 连线。 */
  showAllDependencies: boolean
  toggleShowAllDependencies: () => void
  setShowAllDependencies: (v: boolean) => void

  /** 「问题链常显」开关：端点落在受阻/逾期任务的依赖常显（4.5）。 */
  showProblemChain: boolean
  toggleShowProblemChain: () => void
  setShowProblemChain: (v: boolean) => void

  /** 关键路径连线常显（两入口默认 true，可显式关闭）。 */
  showCriticalPath: boolean
  toggleShowCriticalPath: () => void
  setShowCriticalPath: (v: boolean) => void

  /** 基线对比叠加开关（原页面局部态，迁入 store 便于持久化）。 */
  compareBaseline: boolean
  toggleCompareBaseline: () => void
  setCompareBaseline: (v: boolean) => void

  /** 选中任务上下游链路高亮开关。 */
  showSelectedChain: boolean
  toggleShowSelectedChain: () => void

  dragPreview: GanttScheduleDraft | null
  setDragPreview: (preview: GanttScheduleDraft | null) => void
  pendingSchedule: GanttScheduleDraft | null
  setPendingSchedule: (schedule: GanttScheduleDraft | null) => void
  dependencyDraft: GanttDependencyDraft | null
  setDependencyDraft: (draft: GanttDependencyDraft | null) => void

  /** 测试/退出视图时复位交互态（不动持久化偏好）。 */
  resetInteraction: () => void
}

export interface CreateGanttViewStoreOptions {
  granularity?: GanttGranularity
  entry?: GanttEntry
  mode?: GanttInteractionMode
  /** 传入即启用 localStorage 持久化（仅应用级单例用）。 */
  persistKey?: string
}

/** 持久化子集：仅用户 UI 偏好，**绝不含**任务/依赖/里程碑/基线等业务数据（spec R7）。 */
function persistedPrefs(state: GanttViewState) {
  return {
    entry: state.entry,
    granularity: state.granularity,
    mode: state.mode,
    showAllDependencies: state.showAllDependencies,
    showProblemChain: state.showProblemChain,
    showCriticalPath: state.showCriticalPath,
    compareBaseline: state.compareBaseline,
  }
}

function stateCreator(options?: CreateGanttViewStoreOptions): StateCreator<GanttViewState> {
  return (set, get) => ({
    granularity: options?.granularity ?? 'day',
    setGranularity: (granularity) => set({ granularity }),

    entry: options?.entry ?? 'standard',
    setEntry: (entry) => set({ entry }),

    mode: options?.mode ?? 'select',
    // 切换模式时清理未确认草稿——避免残留草稿被下个模式误提交（task 1.4「草稿清理」）。
    setMode: (mode) => set({ mode, draft: null }),

    hoveredTaskId: null,
    setHoveredTaskId: (hoveredTaskId) => set({ hoveredTaskId }),

    selectedTaskId: null,
    setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),

    selection: new Set<number>(),
    toggleSelection: (id) => {
      const next = new Set(get().selection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      set({ selection: next, selectedTaskId: id })
    },
    setSelection: (ids) => set({ selection: new Set(ids) }),
    clearSelection: () => set({ selection: new Set<number>() }),

    focusTaskId: null,
    setFocusTaskId: (focusTaskId) => set({ focusTaskId }),

    draft: null,
    setDraft: (draft) => set({ draft }),
    clearDraft: () => set({ draft: null }),

    navigationTarget: null,
    requestNavigation: (navigationTarget) => set({ navigationTarget }),
    clearNavigation: () => set({ navigationTarget: null }),

    showAllDependencies: false,
    toggleShowAllDependencies: () => set({ showAllDependencies: !get().showAllDependencies }),
    setShowAllDependencies: (showAllDependencies) => set({ showAllDependencies }),

    showProblemChain: false,
    toggleShowProblemChain: () => set({ showProblemChain: !get().showProblemChain }),
    setShowProblemChain: (showProblemChain) => set({ showProblemChain }),

    showCriticalPath: true,
    toggleShowCriticalPath: () => set({ showCriticalPath: !get().showCriticalPath }),
    setShowCriticalPath: (showCriticalPath) => set({ showCriticalPath }),

    compareBaseline: false,
    toggleCompareBaseline: () => set({ compareBaseline: !get().compareBaseline }),
    setCompareBaseline: (compareBaseline) => set({ compareBaseline }),

    showSelectedChain: true,
    toggleShowSelectedChain: () => set({ showSelectedChain: !get().showSelectedChain }),

    dragPreview: null,
    setDragPreview: (dragPreview) => set({ dragPreview }),
    pendingSchedule: null,
    setPendingSchedule: (pendingSchedule) => set({ pendingSchedule }),
    dependencyDraft: null,
    setDependencyDraft: (dependencyDraft) => set({ dependencyDraft }),

    resetInteraction: () =>
      set({
        mode: options?.mode ?? 'select',
        hoveredTaskId: null,
        selectedTaskId: null,
        selection: new Set<number>(),
        focusTaskId: null,
        draft: null,
        navigationTarget: null,
        dragPreview: null,
        pendingSchedule: null,
        dependencyDraft: null,
      }),
  })
}

export function createGanttViewStore(options?: CreateGanttViewStoreOptions) {
  if (options?.persistKey) {
    return create<GanttViewState>()(
      persist(stateCreator(options), {
        name: options.persistKey,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => persistedPrefs(state as GanttViewState),
      }),
    )
  }
  return create<GanttViewState>(stateCreator(options))
}

/** 默认单例（应用内甘特视图，持久化 UI 偏好）。dev harness/测试用 `createGanttViewStore` 建独立实例。 */
export const useGanttStore = createGanttViewStore({ persistKey: GANTT_STORE_KEY })
