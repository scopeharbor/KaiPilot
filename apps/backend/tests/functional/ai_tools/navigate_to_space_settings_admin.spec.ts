// v3-ui-next-settings-admin-domains W9 · tasks 9.9 —— `navigate_to_space` 设置空间 /
// 管理后台 / 项目设置镜头功能测试。
//
// 覆盖：
// - lens='settings'：无 projectId 返回 /next/settings、携带合法 targetId 返回对应子路径、
//   未注册 targetId 安全回落门户路径；非组织成员拒绝（PermissionDeniedException）；
// - lens='admin'：system:admin 用户返回 /next/admin[/targetId]；非 system:admin 用户
//   返回既有 403 拒绝语义；
// - lens='project_settings'：正常返回 /next/projects/:id/settings；缺少 projectId 抛 422；
//   跨租户/不存在项目维持既有 404 ResourceNotFoundException 语义（RL-05 防探测）；
// - 既有镜头零回归：kanban/charts/resources 等镜头解算行为与权限校验保持不变。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import type User from '#models/user'
import ProjectService from '#services/project_service'
import RbacService from '#services/rbac_service'
import { createNavigateToSpaceTool } from '#services/ai_tools/handlers/navigate_to_space'
import type { ToolExecutionContext } from '#services/ai_tools/handlers/index'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function deps() {
  return {
    projectService: await app.container.make(ProjectService),
    rbacService: await app.container.make(RbacService),
  }
}

function ctxFor(user: User, organizationId: number): ToolExecutionContext {
  return { user, organizationId, requestId: 'navigate-settings-admin-test' }
}

test.group('AI tools: navigate_to_space settings / admin / project_settings 镜头', (group) => {
  useAuthDatabase(group)

  test('lens=settings 无 projectId 返回 /next/settings，合法 targetId 直达，未注册回落', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-set-owner') })
    const org = await createOrganization(owner)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // 1. 无 projectId、无 target 返回门户路径
    const portal = await tool.handler(ctx, { lens: 'settings' })
    assert.equal(portal.status, 'SUCCESS')
    assert.deepEqual(portal.data, {
      projectId: null,
      lens: 'settings',
      depth: 'workbench',
      targetId: null,
      path: '/next/settings',
    })

    // 2. 携带合法 targetId（如 security/kms）返回对应子路径
    const kms = await tool.handler(ctx, { lens: 'settings', targetId: 'security/kms' })
    assert.equal(kms.status, 'SUCCESS')
    assert.deepEqual(kms.data, {
      projectId: null,
      lens: 'settings',
      depth: 'workbench',
      targetId: null,
      path: '/next/settings/security/kms',
    })

    // 携带 target 字段（如 profile）直达
    const profile = await tool.handler(ctx, { lens: 'settings', target: 'profile' })
    assert.equal(profile.status, 'SUCCESS')
    assert.equal(profile.data.path, '/next/settings/profile')

    // 3. 未注册 targetId 回落门户路径（RL-14 绝不拼装假路径）
    const fallback = await tool.handler(ctx, {
      lens: 'settings',
      targetId: 'non-existent-secret-page',
    })
    assert.equal(fallback.status, 'SUCCESS')
    assert.equal(fallback.data.path, '/next/settings')
    assert.equal(fallback.data.projectId, null)
  })

  test('非组织成员导航 settings 被拒（403 PERMISSION_DENIED）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('nav-set-org-owner') })
    const org = await createOrganization(owner)
    const outsider = await createUser({ email: uniqueEmail('nav-set-outsider') })
    const tool = createNavigateToSpaceTool(await deps())

    let caught: unknown = null
    try {
      await tool.handler(ctxFor(outsider, org.id), { lens: 'settings' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })

  test('lens=admin 返回 /next/admin[/targetId]，仅 system:admin 放行，无权返回拒绝语义', async ({
    assert,
  }) => {
    const adminUser = await createUser({
      email: uniqueEmail('nav-admin-super'),
      isSuperAdmin: true,
    })
    const regularUser = await createUser({
      email: uniqueEmail('nav-admin-reg'),
      isSuperAdmin: false,
    })
    const org = await createOrganization(adminUser)
    const tool = createNavigateToSpaceTool(await deps())

    // 1. system:admin 放行门户与合法 targetId
    const portal = await tool.handler(ctxFor(adminUser, org.id), { lens: 'admin' })
    assert.equal(portal.status, 'SUCCESS')
    assert.deepEqual(portal.data, {
      projectId: null,
      lens: 'admin',
      depth: 'workbench',
      targetId: null,
      path: '/next/admin',
    })

    const users = await tool.handler(ctxFor(adminUser, org.id), {
      lens: 'admin',
      targetId: 'users',
    })
    assert.equal(users.status, 'SUCCESS')
    assert.equal(users.data.path, '/next/admin/users')

    // 未注册 targetId 回落门户
    const adminFallback = await tool.handler(ctxFor(adminUser, org.id), {
      lens: 'admin',
      targetId: 'unknown-console',
    })
    assert.equal(adminFallback.data.path, '/next/admin')

    // 2. 普通用户访问 admin 镜头拒绝（403 PERMISSION_DENIED）
    let caught: unknown = null
    try {
      await tool.handler(ctxFor(regularUser, org.id), { lens: 'admin' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, PermissionDeniedException)
  })

  test('lens=project_settings 返回 /next/projects/:id/settings，跨租户与缺 ID 校验照旧', async ({
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('nav-ps-ownera') })
    const orgA = await createOrganization(ownerA)
    const outsider = await createUser({ email: uniqueEmail('nav-ps-outsider') })
    const orgB = await createOrganization(outsider)
    const { project } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())

    // 1. 本组织成员携带有效 projectId 成功解算路径
    const result = await tool.handler(ctxFor(ownerA, orgA.id), {
      lens: 'project_settings',
      projectId: project.id,
    })
    assert.equal(result.status, 'SUCCESS')
    assert.deepEqual(result.data, {
      projectId: project.id,
      lens: 'project_settings',
      depth: 'workbench',
      targetId: null,
      path: `/next/projects/${project.id}/settings`,
    })

    // 2. 缺失 projectId 抛 422 ValidationException
    let noIdError: unknown = null
    try {
      await tool.handler(ctxFor(ownerA, orgA.id), { lens: 'project_settings' })
    } catch (error) {
      noIdError = error
    }
    assert.instanceOf(noIdError, ValidationException)

    // 3. 跨租户访问项目设置触发 404 ResourceNotFoundException（RL-05 非泄露语义）
    let crossOrgError: unknown = null
    try {
      await tool.handler(ctxFor(outsider, orgB.id), {
        lens: 'project_settings',
        projectId: project.id,
      })
    } catch (error) {
      crossOrgError = error
    }
    assert.instanceOf(crossOrgError, ResourceNotFoundException)

    // 4. 不存在的项目 ID 同样触发 404
    let notFoundError: unknown = null
    try {
      await tool.handler(ctxFor(ownerA, orgA.id), {
        lens: 'project_settings',
        projectId: 999_999,
      })
    } catch (error) {
      notFoundError = error
    }
    assert.instanceOf(notFoundError, ResourceNotFoundException)
  })

  test('既有 kanban / charts / resources 等镜头路径回归不变', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('nav-reg-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // kanban
    const kanban = await tool.handler(ctx, { lens: 'kanban', projectId: project.id })
    assert.equal(kanban.status, 'SUCCESS')
    assert.equal(kanban.data.path, `/projects/${project.id}/kanban`)

    // charts
    const charts = await tool.handler(ctx, {
      lens: 'charts',
      projectId: project.id,
      chart: 'resource-load',
    })
    assert.equal(charts.status, 'SUCCESS')
    assert.equal(charts.data.path, `/next/projects/${project.id}/charts/resource-load`)

    // resources
    const resources = await tool.handler(ctx, { lens: 'resources', projectId: project.id })
    assert.equal(resources.status, 'SUCCESS')
    assert.equal(resources.data.path, `/next/projects/${project.id}/resources`)
  })
})
