import type Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import type User from '#models/user'

/**
 * 把用户加入一个已存在的项目（新建指定名称的项目角色 + 成员关系）。
 * 供 Timeline 权限测试给同一项目挂载不同角色成员。
 */
export async function createProjectMembership(
  project: Project,
  user: User,
  roleName: string,
): Promise<ProjectMember> {
  const role = await ProjectRole.create({
    projectId: project.id,
    name: roleName,
    description: roleName,
    permissions: [] as unknown as string[],
    isSystem: true,
  })
  return ProjectMember.create({
    projectId: project.id,
    userId: user.id,
    projectRoleId: role.id,
    isActive: true,
  })
}
