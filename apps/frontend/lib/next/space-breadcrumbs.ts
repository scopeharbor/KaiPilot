import { PRESET_SPACE_COORDINATES } from './space-coordinates'

/**
 * 空间坐标回显格式化器（v3-ui-next-shell-space-map D4 / spec「空间坐标动态回显」）。
 *
 * 顶栏消费 `usePathname()` 派生当前坐标文本，如 `/next · 角色首页`；
 * 视觉要求（等宽 / 弱对比度 / `·` 点状分隔符）由消费方（NextTopbar, W1）应用。
 * 本模块为纯函数，`usePathname` 绑定留在消费方，便于单测。
 *
 * 标签映射直接由 `PRESET_SPACE_COORDINATES`（W2 坐标白名单）派生，与空间地图卡片
 * 标题同源（W4 收敛裁决：坐标统一「角色首页」，见 spec「`/next · 角色首页`」示例），
 * 杜绝两处维护导致的标签漂移。
 */
export interface BreadcrumbMeta {
  pathDisplay: string
  label: string
}

const BREADCRUMB_BY_PATH: Readonly<Record<string, BreadcrumbMeta>> = Object.fromEntries(
  PRESET_SPACE_COORDINATES.map((coordinate) => [
    coordinate.path,
    { pathDisplay: coordinate.path, label: coordinate.title },
  ]),
)

/**
 * 上下文实体空间（动态派生坐标）路径模式：`/next/projects/:id`（含深层子路由）。
 * 单项目空间属于动态实体空间，绝不可进 PRESET_SPACE_COORDINATES 静态白名单
 * （租户物理隔离 + RBAC 控制，见 v3-ui-next-project-space design Decision 2）。
 */
const PROJECT_SPACE_PATH_RE = /^\/next\/projects\/(\d+)/

/**
 * 将 pathname 解析为等宽回显文本（未匹配的深层子路由走「空间探索」兜底）。
 *
 * 第二参 `entityTitle` 支持上下文实体空间动态标题：
 * - `/next/projects/:id` 匹配时，提供标题 → `/next/projects/:id · <实体标题>`；
 * - 加载中或缺省 → `/next/projects/:id · 项目空间`；
 * - 标题由项目空间容器在数据加载成功后经 entity store 上报，宿主消费（W4 装配）。
 */
export function resolveSpaceBreadcrumb(pathname: string, entityTitle?: string): string {
  const matched = BREADCRUMB_BY_PATH[pathname]
  if (matched) {
    return `${matched.pathDisplay} · ${matched.label}`
  }
  const projectMatch = PROJECT_SPACE_PATH_RE.exec(pathname)
  if (projectMatch) {
    const projectId = projectMatch[1]
    const title = entityTitle?.trim()
    return `/next/projects/${projectId} · ${title ? title : '项目空间'}`
  }
  // settings/admin 深层子路由前缀回显（W9 · tasks 9.3）
  if (pathname.startsWith('/next/settings/')) {
    return `${pathname} · 设置空间`
  }
  if (pathname.startsWith('/next/admin/')) {
    return `${pathname} · 管理后台`
  }
  // 针对未完全匹配的深层子路由兜底
  if (pathname.startsWith('/next/')) {
    return `${pathname} · 空间探索`
  }
  return `${pathname}`
}
