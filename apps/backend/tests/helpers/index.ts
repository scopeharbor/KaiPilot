/**
 * 跨项目依赖等测试套件的公用装配。
 *
 * 设计取向与 `tests/functional/auth/_helpers.ts` 一致：用 Lucid 模型直接建数据，
 * 不手写 SQL。`db` 形参保留是为了兼容既有用例的调用形态（`createTestOrg(s.db)`），
 * 实际建数据走模型，不需要它。
 */
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import User from '#models/user'

/** 组织成员角色 → organization_members.role 的合法取值。 */
type OrgMemberRole = 'owner' | 'admin' | 'member' | 'viewer'

/** 用例里用的业务角色别名 → 组织成员角色。 */
const ROLE_ALIAS: Record<string, OrgMemberRole> = {
  owner: 'owner',
  pmo: 'admin',
  admin: 'admin',
  member: 'member',
  observer: 'viewer',
  viewer: 'viewer',
}

/**
 * 迁移数据库并返回容器/db 句柄。
 * 迁移是幂等的，可在 `group.each.setup` 里反复调用。
 */
export async function setupTest() {
  await testUtils.db().migrate()
  return { db, container: app.container, app }
}

let seq = 0
function uniqueSuffix(): string {
  seq += 1
  return `${seq}-${process.pid}`
}

/** 建组织（无 owner 时先建一个占位 owner）。 */
export async function createTestOrg(_db?: unknown): Promise<Organization> {
  const suffix = uniqueSuffix()
  const owner = await User.create({
    fullName: '组织所有者',
    email: `org-owner-${suffix}@test.local`,
    password: 'Passw0rd!',
    authProvider: 'local',
    isActive: true,
    isSuperAdmin: false,
    roleVersion: 0,
  })
  const org = await Organization.create({
    ownerId: owner.id,
    name: `测试组织-${suffix}`,
    slug: `org-${suffix}`,
    // 默认 enterprise：本 helper 供功能测试装配「完整权限的管理员组织」；
    // 套餐权益门控（free 不授 SSO/KMS/DLP/合规等企业能力）下须用付费档保持
    // 既有 owner/admin 能力断言语义不变。测 free 门控的用例显式传 planTier: 'free'。
    planTier: 'enterprise',
  })
  await OrganizationMember.create({
    organizationId: org.id,
    userId: owner.id,
    role: 'owner',
  })
  return org
}

/**
 * 建用户；`org` 非空时同时写入 organization_members。
 * `options.role` 接受业务角色别名（pmo/observer 等），映射到组织成员角色。
 */
export async function createTestUser(
  _db?: unknown,
  org?: Organization | null,
  options: { role?: string } = {},
): Promise<User> {
  const suffix = uniqueSuffix()
  const user = await User.create({
    fullName: `测试用户-${suffix}`,
    email: `user-${suffix}@test.local`,
    password: 'Passw0rd!',
    authProvider: 'local',
    isActive: true,
    isSuperAdmin: false,
    roleVersion: 0,
  })

  if (org) {
    await OrganizationMember.create({
      organizationId: org.id,
      userId: user.id,
      role: ROLE_ALIAS[options.role ?? 'member'] ?? 'member',
    })
  }

  return user
}
