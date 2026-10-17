import { resolveDefaultEntry } from '@/lib/navigation'

/**
 * 解析项目默认入口 URL（v2-custom-views-view-config）。
 *
 * 若当前用户设定了默认自定义视图，则返回该自定义视图 URL（带 `?customView=ID`），
 * 否则返回基础默认视图 URL。
 *
 * @param projectId - 项目 ID
 * @param defaultCustomViewId - 当前用户的默认自定义视图 ID（null / undefined 表示无默认）
 */
export function resolveDefaultViewUrl(
  projectId: number,
  defaultCustomViewId: number | null | undefined,
): string {
  return resolveDefaultEntry(projectId, defaultCustomViewId)
}
