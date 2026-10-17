/**
 * v3-codegen-34-stage-candidate-runtime-execution —— 候选运行 Policy 单测。
 *
 * 覆盖 tasks 7.3：view / run 两个动作的判定链、未认证、缺组织上下文、
 * 超管直通、窄权限不回落（能读项目 ≠ 能触发 34 阶段执行）、跨组织拒绝。
 *
 * 之所以单独测：功能测试里 rbac_middleware 会先于控制器拒绝，
 * Policy 自身的 assert 分支拿不到覆盖。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import type { HttpContext } from '@adonisjs/core/http'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import User from '#models/user'
import CodegenCandidateRunPolicy from '#policies/codegen_candidate_run_policy'
import { AuthRequiredException, PermissionDeniedException } from '#exceptions/api_exception'

function fakeCtx(options: {
  user?: unknown
  organizationId?: number
  projectId?: number
}): HttpContext {
  return {
    authUser: options.user,
    tenant: options.organizationId ? { organizationId: options.organizationId } : undefined,
    request: {
      param: (key: string) =>
        key === 'projectId' && options.projectId ? String(options.projectId) : undefined,
    },
  } as unknown as HttpContext
}

let seq = 0
async function makeUser(overrides: Partial<{ isSuperAdmin: boolean }> = {}): Promise<User> {
  seq += 1
  return User.create({
    email: `codegen-policy-${seq}-${process.pid}@test.local`,
    password: 'Passw0rd!',
    fullName: '策略测试用户',
    authProvider: 'local',
    isActive: true,
    isSuperAdmin: overrides.isSuperAdmin ?? false,
  })
}

async function makeOrgWithProject(owner: User) {
  const org = await Organization.create({
    ownerId: owner.id,
    name: '候选运行组织',
    slug: `codegen-policy-${owner.id}-${seq}`,
  })
  await OrganizationMember.create({ organizationId: org.id, userId: owner.id, role: 'owner' })
  const project = await Project.create({
    organizationId: org.id,
    name: '候选运行项目',
    code: `CGP${owner.id}${seq}`,
    createdBy: owner.id,
  })
  return { org, project }
}

test.group('CodegenCandidateRunPolicy', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })
  group.each.setup(async () => {
    await testUtils.db().truncate()
  })

  test('未认证时抛 AUTH_REQUIRED', async ({ assert }) => {
    const policy = new CodegenCandidateRunPolicy(fakeCtx({ organizationId: 1 }))
    await assert.rejects(() => policy.view(), AuthRequiredException)
    await assert.rejects(() => policy.run(), AuthRequiredException)
  })

  test('缺组织上下文时一律拒绝', async ({ assert }) => {
    const user = await makeUser()
    const policy = new CodegenCandidateRunPolicy(fakeCtx({ user }))
    assert.isFalse(await policy.view())
    assert.isFalse(await policy.run())
  })

  test('超级管理员直通 view 与 run', async ({ assert }) => {
    const user = await makeUser({ isSuperAdmin: true })
    const policy = new CodegenCandidateRunPolicy(fakeCtx({ user, organizationId: 1 }))
    assert.isTrue(await policy.view())
    assert.isTrue(await policy.run())
  })

  test('组织 owner 同时具备 view 与 run', async ({ assert }) => {
    const owner = await makeUser()
    const { org, project } = await makeOrgWithProject(owner)
    const policy = new CodegenCandidateRunPolicy(
      fakeCtx({ user: owner, organizationId: org.id, projectId: project.id }),
    )
    assert.isTrue(await policy.view())
    assert.isTrue(await policy.run())
    await policy.assertView()
    await policy.assertRun()
  })

  test('MEMBER 只读：view 通过、run 拒绝且 assertRun 抛 PERMISSION_DENIED', async ({ assert }) => {
    const owner = await makeUser()
    const { org, project } = await makeOrgWithProject(owner)
    const member = await makeUser()
    await OrganizationMember.create({
      organizationId: org.id,
      userId: member.id,
      role: 'member',
    })
    const role = await ProjectRole.create({
      projectId: project.id,
      name: 'Member',
      description: 'Member',
      permissions: [] as unknown as string[],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: member.id,
      projectRoleId: role.id,
      isActive: true,
    })

    const policy = new CodegenCandidateRunPolicy(
      fakeCtx({ user: member, organizationId: org.id, projectId: project.id }),
    )
    assert.isTrue(await policy.view())
    assert.isFalse(await policy.run())
    await policy.assertView()
    await assert.rejects(() => policy.assertRun(), PermissionDeniedException)
  })

  test('无任何角色的用户 view 被拒且 assertView 抛 PERMISSION_DENIED', async ({ assert }) => {
    const owner = await makeUser()
    const { org, project } = await makeOrgWithProject(owner)
    const outsider = await makeUser()

    const policy = new CodegenCandidateRunPolicy(
      fakeCtx({ user: outsider, organizationId: org.id, projectId: project.id }),
    )
    assert.isFalse(await policy.view())
    await assert.rejects(() => policy.assertView(), PermissionDeniedException)
  })

  test('项目不属于当前组织时拒绝（cross_org_denied）', async ({ assert }) => {
    const ownerA = await makeUser()
    const a = await makeOrgWithProject(ownerA)
    const ownerB = await makeUser()
    const b = await makeOrgWithProject(ownerB)

    // 用 A 组织上下文去访问 B 组织的项目
    const policy = new CodegenCandidateRunPolicy(
      fakeCtx({ user: ownerA, organizationId: a.org.id, projectId: b.project.id }),
    )
    assert.isFalse(await policy.view())
    assert.isFalse(await policy.run())
  })
})
