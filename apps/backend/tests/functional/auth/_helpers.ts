import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import User from '#models/user'
import limiter from '@adonisjs/limiter/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import type { Group } from '@japa/runner/core'

/**
 * 认证/授权功能测试公用装配。
 * - 每组开始迁移（结束回滚）；
 * - 每个用例前清空数据表与限流器状态（内存限流器在进程内共享，须逐用例清零，避免串扰）。
 *
 * 注意：`testUtils.db().truncate()` 是「先 migrate、返回 db:truncate 清理函数」的
 * 复合 API（见 @adonisjs/lucid test_utils/database.js）。必须返回该清理函数交由 japa
 * 在用例后执行，否则 db:truncate 永不运行、表跨用例残留。
 */
export function useAuthDatabase(group: Group) {
  // group 级用 truncate 而不是 migrate：migrate() 返回的 cleanup 是 `migration:reset`，
  // 会在 group teardown 把全部 224 个迁移**整体回滚**。bootstrap 只在 runner 级 migrate
  // 一次，于是后续任何不自带 DB 生命周期又要查库的 spec 会随执行顺序撞上 `no such table`
  // ——同一份代码换个执行顺序换个结果。truncate() 同样先跑 migration:run（幂等），
  // 但 cleanup 是 db:truncate：清数据、留 schema，数据隔离语义不变而 schema 不再消失。
  group.setup(() => testUtils.db().truncate())
  group.each.setup(async () => {
    await limiter.clear()
    // truncate() 先 migrate（幂等）、再返回 db:truncate 清理函数；返回它交由 japa
    // 在用例后执行，保证下一用例表已清空。
    return await testUtils.db().truncate()
  })
}

let seq = 0
/** 生成唯一邮箱，避免用例间账户/锁定状态串扰。 */
export function uniqueEmail(prefix = 'user'): string {
  seq += 1
  return `${prefix}-${seq}-${process.pid}@test.local`
}

const STRONG_PASSWORD = 'Passw0rd!'
export { STRONG_PASSWORD }

/** 创建一个已激活用户（密码经 withAuthFinder 哈希）。 */
export async function createUser(
  overrides: Partial<{
    email: string
    password: string
    fullName: string | null
    isActive: boolean
    isSuperAdmin: boolean
    roleVersion: number
  }> = {},
): Promise<User> {
  return User.create({
    fullName: overrides.fullName ?? '测试用户',
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? STRONG_PASSWORD,
    authProvider: 'local',
    isActive: overrides.isActive ?? true,
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    roleVersion: overrides.roleVersion ?? 0,
  })
}

/** 创建组织并把 owner 写入 organization_members。 */
export async function createOrganization(owner: User): Promise<Organization> {
  const org = await Organization.create({
    ownerId: owner.id,
    name: '测试组织',
    slug: `org-${owner.id}-${Date.now()}`,
    // 默认 enterprise：本 helper 供授权类功能测试装配「完整权限的管理员组织」，
    // 套餐权益门控（free 不授企业能力）下须用付费档，既有 admin 能力断言语义不变；
    // 需要显式测 free 门控的用例请自行建组织并传 planTier: 'free'。
    planTier: 'enterprise',
  })
  await OrganizationMember.create({
    organizationId: org.id,
    userId: owner.id,
    role: 'owner',
  })
  return org
}

/** 把用户加为组织成员（指定 organization_members.role）。 */
export async function addOrgMember(
  org: Organization,
  user: User,
  role: 'owner' | 'admin' | 'member' | 'viewer',
): Promise<OrganizationMember> {
  return OrganizationMember.create({
    organizationId: org.id,
    userId: user.id,
    role,
  })
}

/** 创建项目 + 指定名称的项目角色，并把用户加为该角色的项目成员。 */
export async function createProjectWithMember(
  org: Organization,
  creator: User,
  member: User,
  roleName: string,
  permissions: string[] = [],
): Promise<{ project: Project; role: ProjectRole; membership: ProjectMember }> {
  const project = await Project.create({
    organizationId: org.id,
    name: '测试项目',
    code: `P${Date.now()}`,
    createdBy: creator.id,
  })
  const role = await ProjectRole.create({
    projectId: project.id,
    name: roleName,
    description: roleName,
    permissions: permissions as unknown as string[],
    isSystem: true,
  })
  const membership = await ProjectMember.create({
    projectId: project.id,
    userId: member.id,
    projectRoleId: role.id,
    isActive: true,
  })
  return { project, role, membership }
}

/**
 * 从「创建类」接口响应体中取 data.id。
 * 测试专用：Tuyau 对部分 controller 返回类型会推断为 `void | 对象 | 对象[]` 联合，
 * 直接 `.body().data.id` 触发 TS2339。此处集中断言，保持用例整洁。
 */
export function dataId(res: { body(): unknown }): number {
  return (res.body() as { data: { id: number } }).data.id
}

/**
 * 带组织上下文的 Authorization 头（`Bearer <token>`）。
 *
 * `client.loginAs(user)` 签发的令牌不带组织（organizationId=null）；登记在 RBAC 路由规则表里的
 * 组织级路由会因「需要组织上下文」直接 403。这类用例改用本函数，按指定组织签发令牌，
 * roleVersion 取数据库最新值，避免被判为过期令牌。
 */
export async function orgBearer(user: User, organizationId: number): Promise<string> {
  const { default: app } = await import('@adonisjs/core/services/app')
  const { default: TokenService } = await import('#services/token_service')
  const tokens = await app.container.make(TokenService)
  const fresh = await User.findOrFail(user.id)
  const token = await tokens.generateAccessToken({
    sub: fresh.id,
    organizationId,
    roleVersion: fresh.roleVersion,
    permissions: [],
  })
  return `Bearer ${token}`
}
