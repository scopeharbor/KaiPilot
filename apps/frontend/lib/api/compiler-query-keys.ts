export const COMPILER_QUERY_KEYS = {
  all: ['compiler-runs'] as const,
  lists: () => [...COMPILER_QUERY_KEYS.all, 'list'] as const,
  details: () => [...COMPILER_QUERY_KEYS.all, 'detail'] as const,
  detail: (runId: number) => [...COMPILER_QUERY_KEYS.details(), runId] as const,
  observabilitySummary: (runId: number) =>
    [...COMPILER_QUERY_KEYS.all, 'observability-summary', runId] as const,
}
