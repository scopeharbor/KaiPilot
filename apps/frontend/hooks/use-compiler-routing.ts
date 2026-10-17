/**
 * v2-5-compiler-dynamic-routing-management-ui —— Compiler Routing 管理 hooks。
 *
 * 只读查看/决策/模拟结果走 TanStack Query。
 */
import { useQuery } from '@tanstack/react-query'
import { compilerRoutingApi } from '@/lib/api/compiler-routing'
import { COMPILER_ROUTING_QUERY_KEYS } from '@/lib/api/compiler-routing-query-keys'
import type { RoutingSimulateRequest } from '@aiproj/types/compiler-dynamic-routing'

/** 获取路由规则注册表快照。 */
export function useRoutingRules() {
  return useQuery({
    queryKey: COMPILER_ROUTING_QUERY_KEYS.rules(),
    queryFn: () => compilerRoutingApi.getRules(),
  })
}

/** 获取 per-run 路由决策证据。 */
export function useRunRoutingDecision(runId: number | null) {
  return useQuery({
    queryKey: COMPILER_ROUTING_QUERY_KEYS.runDecision(runId ?? 0),
    queryFn: () => compilerRoutingApi.getRunRoutingDecision(runId!),
    enabled: runId !== null,
  })
}

/** 路由模拟（dry-run）。 */
export function useRoutingSimulate(input: RoutingSimulateRequest | null) {
  return useQuery({
    queryKey: [...COMPILER_ROUTING_QUERY_KEYS.simulate(), input],
    queryFn: () => compilerRoutingApi.simulate(input!),
    enabled: input !== null,
  })
}
