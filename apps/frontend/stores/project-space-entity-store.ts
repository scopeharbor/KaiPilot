import { create } from 'zustand'

/**
 * 活跃项目空间实体标题 Store（v3-ui-next-project-space design Decision 2「顶栏联动注册机制」）。
 *
 * 二元坐标分层模型中的「上下文实体空间」侧：单项目空间为动态实体，项目名称只能在
 * 数据加载成功后由 `ProjectSpaceContainer` 上报，绝不静态硬编码（租户隔离 + RBAC）。
 *
 * - `register(projectId, entityTitle)`：容器在项目加载成功且组织隔离校验通过后调用；
 * - `clear(projectId)`：容器卸载 / 加载失败 / 跨组织拦截时调用，仅当注册的
 *   projectId 与调用方一致才清空，避免路由参数 A→B 切换时旧标题抢先清掉新注册；
 * - 宿主 `NextAppShell` 订阅 `entityTitle` 后传入 `resolveSpaceBreadcrumb(pathname, title)`
 *   计算顶栏坐标文本（W4 装配点：NextAppShell 一行订阅 + 传参）。
 */
export interface ProjectSpaceEntityState {
  /** 当前活跃项目空间 id；null 表示无（如 404 / 加载失败 / 未进入项目路由）。 */
  projectId: number | null
  /** 项目名称；null 表示加载中或未注册。 */
  entityTitle: string | null
  register: (projectId: number, entityTitle: string) => void
  clear: (projectId: number) => void
}

export const useProjectSpaceEntityStore = create<ProjectSpaceEntityState>()((set, get) => ({
  projectId: null,
  entityTitle: null,

  register: (projectId, entityTitle) => set({ projectId, entityTitle }),

  clear: (projectId) => {
    if (get().projectId !== projectId) return
    set({ projectId: null, entityTitle: null })
  },
}))
