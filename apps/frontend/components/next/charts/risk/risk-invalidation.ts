import type { QueryClient } from '@tanstack/react-query'

/**
 * 风险镜头统一缓存失效（v3-ui-next-chart-gallery tasks 4.2/4.3）。
 *
 * 受控编辑（新建/行内编辑/删除）成功后必须同时刷新：
 * - `['risks']` 前缀：登记底册列表 + 其他既有风险页面列表（RL-04 同缓存键）；
 * - `['risk-matrix']` 前缀：5×5 矩阵计数（useRiskMatrix 的 queryKey 前缀）。
 *
 * 不使用各既有 useXxxRisk mutation hook 自带失效（其仅覆盖 ['risks','list'] 与
 * detail 前缀，无法联动矩阵计数），由镜头内自持 mutation 统一走本入口。
 */
export function invalidateRiskChartData(queryClient: QueryClient): Promise<unknown[]> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['risks'] }),
    queryClient.invalidateQueries({ queryKey: ['risk-matrix'] }),
  ])
}
