import type { CustomViewConfig } from '@aiproj/types'

/**
 * ViewConfigAdapter —— 各基础视图（Kanban/List/Calendar/Gantt/WBS）的配置适配器契约。
 *
 * 每个视图实现此接口，统一 capture/apply/searchParams 行为，
 * 供自定义视图保存与恢复时调度。
 *
 * @template TLocalState - 该视图本地状态的类型；仅在 capture 中消费。
 */
export interface ViewConfigAdapter<TLocalState = unknown> {
  /** 从当前视图的搜索参数和本地状态中捕获并序列化为 CustomViewConfig。保存视图时调用。 */
  capture: (searchParams: URLSearchParams, localState: TLocalState) => CustomViewConfig

  /** 将 CustomViewConfig 应用到当前视图。切换/恢复视图时调用。 */
  apply: (config: CustomViewConfig) => void

  /** 将 CustomViewConfig 转为 URL searchParams。导航到对应基础视图路由时附带到 URL。 */
  toSearchParams: (config: CustomViewConfig) => URLSearchParams

  /** 生成配置的可读摘要，用于视图列表中展示配置快照。例如："已筛选 3 个状态，按截止日排序" */
  summarize: (config: CustomViewConfig) => string
}
