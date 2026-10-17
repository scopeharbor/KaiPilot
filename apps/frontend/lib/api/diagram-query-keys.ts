export const DIAGRAM_QUERY_KEYS = {
  all: ['diagrams'] as const,
  lists: () => [...DIAGRAM_QUERY_KEYS.all, 'list'] as const,
  list: (projectId: number, filters?: Record<string, unknown>) =>
    [...DIAGRAM_QUERY_KEYS.lists(), projectId, filters] as const,
  details: () => [...DIAGRAM_QUERY_KEYS.all, 'detail'] as const,
  detail: (diagramId: number) => [...DIAGRAM_QUERY_KEYS.details(), diagramId] as const,
  mermaid: (diagramId: number) => [...DIAGRAM_QUERY_KEYS.all, 'mermaid', diagramId] as const,
}
