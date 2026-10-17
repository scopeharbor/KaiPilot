/**
 * custom-views —— TanStack Query 分层 keys（v2-custom-views-view-config）。
 *
 * 工厂保证 invalidate 粒度：列表按 project、详情按 project+viewId。
 */
export const customViewsKeys = {
  all: ['custom-views'] as const,
  lists: () => [...customViewsKeys.all, 'list'] as const,
  list: (projectId: number) => [...customViewsKeys.lists(), projectId] as const,
  details: () => [...customViewsKeys.all, 'detail'] as const,
  detail: (projectId: number, viewId: number) =>
    [...customViewsKeys.details(), projectId, viewId] as const,
}
