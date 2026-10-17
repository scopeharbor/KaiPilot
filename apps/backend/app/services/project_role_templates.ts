import { CanonicalRole, ProjectRoleName, ROLE_PERMISSIONS } from '#rbac'

/**
 * 项目级系统角色模板（design D3）。
 *
 * 单一事实来源：project_roles_seeder 与 ProjectService.create 共用，
 * 避免模板漂移；权限串取自中央 ROLE_PERMISSIONS。
 */
export interface ProjectRoleTemplate {
  name: string
  description: string
  permissions: readonly string[]
}

export const PROJECT_ROLE_TEMPLATES: ProjectRoleTemplate[] = [
  {
    name: ProjectRoleName.OWNER,
    description: '项目所有者（创建者）：项目内全权',
    permissions: ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER],
  },
  {
    name: ProjectRoleName.PROJECT_MANAGER,
    description: '项目经理：项目设置 / 成员 / 任务 / WBS / 甘特 / 报表全权限',
    permissions: ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER],
  },
  {
    name: ProjectRoleName.MEMBER,
    description: '成员：创建/查看任务、更新自己负责的任务、发起变更、触发 AI',
    permissions: ROLE_PERMISSIONS[CanonicalRole.MEMBER],
  },
  {
    name: ProjectRoleName.EXTERNAL_COLLABORATOR,
    description: '外部协作者：受限查看 + 更新自己负责的任务',
    permissions: ROLE_PERMISSIONS[CanonicalRole.EXTERNAL_COLLABORATOR],
  },
  {
    name: ProjectRoleName.READONLY_OBSERVER,
    description: '只读观察者：全项目只读',
    permissions: ROLE_PERMISSIONS[CanonicalRole.READONLY_OBSERVER],
  },
]
