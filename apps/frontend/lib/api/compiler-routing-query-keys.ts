/**
 * v2-5-compiler-dynamic-routing-management-ui —— Compiler Routing 管理 query keys。
 *
 * 扩展 COMPILER_QUERY_KEYS 的分层模式，保持一致性。
 */
export const COMPILER_ROUTING_QUERY_KEYS = {
  all: ['compiler-routing'] as const,
  rules: () => [...COMPILER_ROUTING_QUERY_KEYS.all, 'rules'] as const,
  runDecision: (runId: number) =>
    [...COMPILER_ROUTING_QUERY_KEYS.all, 'run-decision', runId] as const,
  simulate: () => [...COMPILER_ROUTING_QUERY_KEYS.all, 'simulate'] as const,
}
