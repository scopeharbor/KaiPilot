// v3-ui-next-org-portfolio-domains W10 · tasks 10.6 —— `navigate_to_space` 组织/全局
// 镜头功能测试（spec「组织级空间坐标与 AI 同事全域导航闭环」要求 3）。
//
// 覆盖：
// - 17 个组织镜头（org_* / global_*）收录白名单：合法组织镜头不带 projectId 成功
//   返回静态路径表对应全局绝对路径（/next/organization/**、/next/resources/**、
//   /next/risks），结果 projectId 恒为 null（无项目载体）；容量环详情动态路由不设
//   lens，统一落列表页 /next/organization/resource-capacity-loops；
// - 组织镜头跳过项目存在性/组织归属校验：附带任意 projectId（含跨组织/不存在）均
//   不触发 404，仍返回全局绝对路径；
// - 组织镜头按逐镜头权限集合在 ctx 组织上下文内判定：无 resource_capacity_loop:view
//   的用户导航容量环被拒（403 PERMISSION_DENIED、零路径产出）；具备任一集合权限的
//   组织成员（member 持 plugin_registry:view）导航插件目录成功；
// - 既有项目镜头行为零回归：gantt 旧轨路径拼装不变、项目镜头缺 projectId 仍 422、
//   跨组织项目镜头仍统一 404；lens schema enum 收录 17 新镜头且 required 契约不变。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import Task from '#models/task'
import type User from '#models/user'
import ProjectService from '#services/project_service'
import RbacService from '#services/rbac_service'
import {
  ORG_LENS_PATH_BY_LENS,
  ORG_LENS_PERMISSION_SETS,
  ORG_NAVIGATE_TO_SPACE_LENSES,
  createNavigateToSpaceTool,
  orgLensPath,
} from '#services/ai_tools/handlers/navigate_to_space'
import type { ToolExecutionContext } from '#services/ai_tools/handlers/index'
import { ProjectRoleName } from '#rbac'
import {
  addOrgMember,
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
  return { user, organizationId, requestId: 'navigate-org-portfolio-test' }
}

test.group('AI tools: navigate_to_space 组织/全局镜头', (group) => {
  useAuthDatabase(group)

  test('17 个组织镜头收录白名单：静态路径表与前端坐标一一对应', async ({ assert }) => {
    const { projectService } = await deps()
    const tool = createNavigateToSpaceTool({ projectService })
    const schema = tool.parametersJsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    const lensEnum = (schema.properties?.lens as { enum?: string[] })?.enum
    assert.isArray(lensEnum)
    assert.equal(ORG_NAVIGATE_TO_SPACE_LENSES.length, 17)
    for (const lens of ORG_NAVIGATE_TO_SPACE_LENSES) {
      assert.isTrue(lensEnum?.includes(lens), `lens ${lens} 应收录进 schema enum`)
      const path = orgLensPath(lens)!
      assert.equal(path, ORG_LENS_PATH_BY_LENS[lens])
      assert.isTrue(path.startsWith('/next/'), `lens ${lens} 应为新轨全局路径`)
      assert.isFalse(path.includes(':id'), `lens ${lens} 路径不应含 :id 占位`)
      assert.isAtLeast(ORG_LENS_PERMISSION_SETS[lens].length, 1)
    }
    // 容量环详情动态路由不设镜头：静态路径即列表页
    assert.equal(
      ORG_LENS_PATH_BY_LENS['org_capacity_loops'],
      '/next/organization/resource-capacity-loops',
    )
    // 既有成员零回归：help/knowledge 与项目镜头仍在 enum
    assert.isTrue(lensEnum?.includes('help'))
    assert.isTrue(lensEnum?.includes('knowledge'))
    assert.isTrue(lensEnum?.includes('kanban'))
    assert.isTrue(lensEnum?.includes('files'))
    // required 契约已在 pmo 批次收口为 ['lens']（项目镜头缺 projectId 由 handler 维持 422）
    assert.deepEqual(schema.required, ['lens'])
  })

  test('合法组织镜头不带 projectId → SUCCESS + 静态全局路径 + projectId=null（owner 全镜头可达）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-org-owner') })
    const org = await createOrganization(owner)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)
    const before = await Task.query().count('* as total')

    // owner（org_admin 全权）逐一导航全部 17 个组织镜头
    for (const lens of ORG_NAVIGATE_TO_SPACE_LENSES) {
      const result = await tool.handler(ctx, { lens })
      assert.equal(result.status, 'SUCCESS')
      assert.deepEqual(result.data, {
        projectId: null,
        lens,
        depth: 'workbench',
        targetId: null,
        path: ORG_LENS_PATH_BY_LENS[lens],
      })
    }

    // 只读 zero-mutation 承诺（RL-01）
    const after = await Task.query().count('* as total')
    assert.equal(Number(after[0]?.$extras?.total ?? 0), Number(before[0]?.$extras?.total ?? 0))
  })

  test('组织镜头跳过项目校验：附带跨组织/不存在的 projectId 仍成功直达（不 404，不泄露存在性）', async ({
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('nav-org-global-a') })
    const orgA = await createOrganization(ownerA)
    const outsider = await createUser({ email: uniqueEmail('nav-org-global-b') })
    const orgB = await createOrganization(outsider)
    const { project } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    // 组织 B 成员附带组织 A 的项目 ID 请求组织镜头：不做项目归属校验，正常直达
    const foreign = await tool.handler(ctxFor(outsider, orgB.id), {
      projectId: project.id,
      lens: 'org_resource_pool',
    })
    assert.equal(foreign.status, 'SUCCESS')
    assert.equal(foreign.data.path, '/next/organization/resource-pool')
    assert.equal(foreign.data.projectId, null)

    // 附带不存在的项目 ID 同样不受影响（不存在性绝不参与组织导航判定）
    const ghost = await tool.handler(ctxFor(ownerA, orgA.id), {
      projectId: 999_999,
      lens: 'global_risks',
    })
    assert.equal(ghost.status, 'SUCCESS')
    assert.equal(ghost.data.path, '/next/risks')
    assert.equal(ghost.data.projectId, null)
  })

  test('无 resource_capacity_loop:view 用户导航容量环被拒：403 PERMISSION_DENIED 且零路径产出', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-capacity-owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('nav-capacity-member') })
    // member 组织角色：持 ai:trigger / project:view / portfolio:view 等，但
    // resource_capacity_loop:view 仅 ORG_ADMIN 与 PROJECT_MANAGER 持有 → 组织镜头内拒绝
    await addOrgMember(org, member, 'member')
    const tool = createNavigateToSpaceTool(await deps())

    let caught: unknown = null
    try {
      await tool.handler(ctxFor(member, org.id), { lens: 'org_capacity_loops' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, PermissionDeniedException)
    assert.equal((caught as PermissionDeniedException).code, 'PERMISSION_DENIED')

    // viewer（READONLY_OBSERVER）同样无容量环查看权 → 拒绝
    const viewer = await createUser({ email: uniqueEmail('nav-capacity-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    let viewerCaught: unknown = null
    try {
      await tool.handler(ctxFor(viewer, org.id), { lens: 'org_capacity_loops' })
    } catch (error) {
      viewerCaught = error
    }
    assert.instanceOf(viewerCaught, PermissionDeniedException)
  })

  test('具备任一集合权限即放行：member 持插件视图权限可导航插件目录/插件策略与组织概览、全局资源', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-plugin-owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('nav-plugin-member') })
    await addOrgMember(org, member, 'member')
    const tool = createNavigateToSpaceTool(await deps())

    // MEMBER 角色持 plugin_registry:view（私有插件目录只读）→ 放行
    const allowed = await tool.handler(ctxFor(member, org.id), { lens: 'org_plugin_directory' })
    assert.equal(allowed.status, 'SUCCESS')
    assert.equal(allowed.data.path, '/next/organization/plugin-directory')

    // member 无 plugin_install:view？否——MEMBER 持 plugin_install:view（只读）→ 放行
    const policies = await tool.handler(ctxFor(member, org.id), { lens: 'org_plugin_policies' })
    assert.equal(policies.status, 'SUCCESS')
    assert.equal(policies.data.path, '/next/organization/plugin-policies')

    // member 持 org:view/portfolio:view → 组织概览放行；resource:view/portfolio:view → 全局资源放行
    const overview = await tool.handler(ctxFor(member, org.id), { lens: 'org_overview' })
    assert.equal(overview.status, 'SUCCESS')
    const resources = await tool.handler(ctxFor(member, org.id), { lens: 'global_resources' })
    assert.equal(resources.status, 'SUCCESS')
    assert.equal(resources.data.path, '/next/resources')
  })

  test('skill_matrix 镜头权限集含 ai:compiler:skill:view（与页守卫同集）；viewer 经 portfolio:view 放行', async ({
    assert,
  }) => {
    assert.deepEqual(
      [...ORG_LENS_PERMISSION_SETS['global_skill_matrix']],
      ['resource:view', 'portfolio:view', 'ai:compiler:skill:view'],
    )
    const owner = await createUser({ email: uniqueEmail('nav-skill-owner') })
    const org = await createOrganization(owner)
    const viewer = await createUser({ email: uniqueEmail('nav-skill-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    const tool = createNavigateToSpaceTool(await deps())
    // READONLY_OBSERVER 持 portfolio:view（且无 resource:view）→ 任一集合放行
    const result = await tool.handler(ctxFor(viewer, org.id), { lens: 'global_skill_matrix' })
    assert.equal(result.status, 'SUCCESS')
    assert.equal(result.data.path, '/next/resources/skill-matrix')
  })

  test('既有项目镜头零回归：gantt 旧轨路径拼装不变；缺 projectId 仍 422；跨组织仍 404', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-org-legacy-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('nav-org-legacy-outsider') })
    const orgB = await createOrganization(outsider)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // 项目镜头路径拼装与 projectId 保留不变（旧轨形态）
    const gantt = await tool.handler(ctx, { projectId: project.id, lens: 'gantt' })
    assert.equal(gantt.data.path, `/projects/${project.id}/gantt`)
    assert.equal(gantt.data.projectId, project.id)

    // 项目镜头缺 projectId 仍抛 422（仅 help/knowledge 与组织镜头容缺）
    let caught: unknown = null
    try {
      await tool.handler(ctx, { lens: 'gantt' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ValidationException)

    // 跨组织项目镜头仍统一 404（RL-05，与组织镜头容缺语义严格区分）
    let crossOrg: unknown = null
    try {
      await tool.handler(ctxFor(outsider, orgB.id), { projectId: project.id, lens: 'kanban' })
    } catch (error) {
      crossOrg = error
    }
    assert.instanceOf(crossOrg, ResourceNotFoundException)
  })
})
