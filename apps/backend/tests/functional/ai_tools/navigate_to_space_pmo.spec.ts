// v3-ui-next-pmo-domain W9 · tasks 9.5 —— `navigate_to_space` PMO 组合层镜头
// 功能测试（spec「组织级空间坐标与 AI 同事全域导航闭环」要求 3 / scenario 组织镜头
// 解算 PMO 路径）。
//
// 覆盖：
// - lens='pmo' + 8 个 target（pmo-overview…pmo-impact-analysis）收录：schema lens
//   enum 收录 'pmo'、target property enum 收录 8 项、scope property 声明
//   project|organization；required 契约保持既有声明（settings-admin 收口前不改）；
// - 合法 PMO 目标不带 projectId 成功返回静态路径表对应全局绝对路径
//   （/next/pmo 与 /next/pmo/**），结果 projectId 恒为 null（无项目载体）；
//   省略 target 落组合仪表盘 /next/pmo；
// - PMO 目标跳过项目存在性/组织归属校验：附带任意 projectId（含跨组织/不存在）均
//   不触发 404，仍返回全局绝对路径；未知 target 显式 422（不拼装假路径）；
// - PMO 目标按 [PORTFOLIO_VIEW] 在 ctx 组织上下文内判定：非组织成员导航被拒
//   （403 PERMISSION_DENIED、零路径产出）；组织成员（member/viewer 持 portfolio:view）
//   放行；
// - 既有项目镜头行为零回归：gantt 旧轨路径拼装不变、项目镜头缺 projectId 仍 422、
//   跨组织项目镜头仍统一 404。
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
  PMO_NAVIGATE_TO_SPACE_TARGETS,
  PMO_TARGET_PATH_BY_TARGET,
  PMO_TARGET_PERMISSION_SETS,
  createNavigateToSpaceTool,
  pmoTargetPath,
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
  return { user, organizationId, requestId: 'navigate-pmo-test' }
}

test.group('AI tools: navigate_to_space PMO 组合层镜头', (group) => {
  useAuthDatabase(group)

  test('8 个 PMO target 收录：静态路径表与前端坐标一一对应；schema 契约增量', async ({
    assert,
  }) => {
    const { projectService } = await deps()
    const tool = createNavigateToSpaceTool({ projectService })
    const schema = tool.parametersJsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    const lensEnum = (schema.properties?.lens as { enum?: string[] })?.enum
    const targetSchema = schema.properties?.target as { enum?: string[] } | undefined
    const scopeSchema = schema.properties?.scope as { enum?: string[] } | undefined

    assert.isArray(lensEnum)
    assert.isTrue(lensEnum?.includes('pmo'), "lens 'pmo' 应收录进 schema enum")
    assert.isArray(targetSchema?.enum)
    assert.equal(PMO_NAVIGATE_TO_SPACE_TARGETS.length, 8)
    for (const target of PMO_NAVIGATE_TO_SPACE_TARGETS) {
      assert.isTrue(targetSchema?.enum?.includes(target), `target ${target} 应收录进 enum`)
      const path = pmoTargetPath(target)!
      assert.equal(path, PMO_TARGET_PATH_BY_TARGET[target])
      assert.isTrue(path.startsWith('/next/pmo'), `target ${target} 应为新轨 PMO 路径`)
      assert.isFalse(path.includes(':id'), `target ${target} 路径不应含 :id 占位`)
      assert.deepEqual([...PMO_TARGET_PERMISSION_SETS[target]], ['portfolio:view'])
    }
    // 决策详情动态路由不设 target：静态路径即决策队列列表页
    assert.equal(PMO_TARGET_PATH_BY_TARGET['pmo-decisions'], '/next/pmo/decisions')
    // scope 声明 project|organization；required 已在 pmo 批次收口为 ['lens']
    assert.deepEqual(scopeSchema?.enum, ['project', 'organization'])
    assert.deepEqual(schema.required, ['lens'])
    // 既有镜头零回归：help/knowledge、org 镜头与项目镜头仍在 enum
    assert.isTrue(lensEnum?.includes('help'))
    assert.isTrue(lensEnum?.includes('knowledge'))
    assert.isTrue(lensEnum?.includes('org_overview'))
    assert.isTrue(lensEnum?.includes('global_risks'))
    assert.isTrue(lensEnum?.includes('kanban'))
  })

  test('合法 PMO 目标不带 projectId → SUCCESS + 静态全局路径 + projectId=null（owner 全 target 可达）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-pmo-owner') })
    const org = await createOrganization(owner)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)
    const before = await Task.query().count('* as total')

    // owner（org_admin 全权）逐一导航 8 个 PMO 目标
    for (const target of PMO_NAVIGATE_TO_SPACE_TARGETS) {
      const result = await tool.handler(ctx, { lens: 'pmo', target })
      assert.equal(result.status, 'SUCCESS')
      assert.deepEqual(result.data, {
        projectId: null,
        lens: 'pmo',
        depth: 'workbench',
        targetId: null,
        path: PMO_TARGET_PATH_BY_TARGET[target],
      })
    }

    // 省略 target 落组合仪表盘（/next/pmo）
    const overview = await tool.handler(ctx, { lens: 'pmo' })
    assert.equal(overview.status, 'SUCCESS')
    assert.equal(overview.data.path, '/next/pmo')
    assert.equal(overview.data.projectId, null)

    // 只读 zero-mutation 承诺（RL-01）
    const after = await Task.query().count('* as total')
    assert.equal(Number(after[0]?.$extras?.total ?? 0), Number(before[0]?.$extras?.total ?? 0))
  })

  test('PMO 目标跳过项目校验：附带跨组织/不存在的 projectId 仍成功直达（不 404，不泄露存在性）', async ({
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('nav-pmo-global-a') })
    const orgA = await createOrganization(ownerA)
    const outsider = await createUser({ email: uniqueEmail('nav-pmo-global-b') })
    const orgB = await createOrganization(outsider)
    const { project } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    // 组织 B 成员附带组织 A 的项目 ID 请求 PMO 目标：不做项目归属校验，正常直达
    const foreign = await tool.handler(ctxFor(outsider, orgB.id), {
      projectId: project.id,
      lens: 'pmo',
      target: 'pmo-traffic-light',
    })
    assert.equal(foreign.status, 'SUCCESS')
    assert.equal(foreign.data.path, '/next/pmo/traffic-light')
    assert.equal(foreign.data.projectId, null)

    // 附带不存在的项目 ID 同样不受影响（不存在性绝不参与组织导航判定）
    const ghost = await tool.handler(ctxFor(ownerA, orgA.id), {
      projectId: 999_999,
      lens: 'pmo',
      target: 'pmo-decisions',
      scope: 'organization',
    })
    assert.equal(ghost.status, 'SUCCESS')
    assert.equal(ghost.data.path, '/next/pmo/decisions')
    assert.equal(ghost.data.projectId, null)
  })

  test('未知 target 显式 422（零假路径产出）；scope=project 显式声明不改变 pmo 全域解析', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-pmo-target-owner') })
    const org = await createOrganization(owner)
    const tool = createNavigateToSpaceTool(await deps())

    let caught: unknown = null
    try {
      await tool.handler(ctxFor(owner, org.id), { lens: 'pmo', target: 'pmo-unknown-page' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ValidationException)

    // 即便错误声明 project scope，lens='pmo' 仍按全域解析（lens 本身即组织级镜头）
    const declaredProject = await tool.handler(ctxFor(owner, org.id), {
      projectId: 1,
      scope: 'project',
      lens: 'pmo',
      target: 'pmo-impact-analysis',
    })
    assert.equal(declaredProject.status, 'SUCCESS')
    assert.equal(declaredProject.data.path, '/next/pmo/impact-analysis')
    assert.equal(declaredProject.data.projectId, null)
  })

  test('非组织成员导航 PMO 被拒：403 PERMISSION_DENIED 且零路径产出（portfolio:view 缺失）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-pmo-denied-owner') })
    const org = await createOrganization(owner)
    const outsider = await createUser({ email: uniqueEmail('nav-pmo-outsider') })
    // outsider 不属于 org（无组织角色 → 权限集为空），即使附带项目 ID 也拒绝
    const tool = createNavigateToSpaceTool(await deps())

    let caught: unknown = null
    try {
      await tool.handler(ctxFor(outsider, org.id), {
        projectId: 1,
        lens: 'pmo',
        target: 'pmo-overview',
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, PermissionDeniedException)
    assert.equal((caught as PermissionDeniedException).code, 'PERMISSION_DENIED')
  })

  test('组织成员持 portfolio:view 即放行：member 与 viewer 均可达全部 PMO 目标', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-pmo-member-owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('nav-pmo-member') })
    await addOrgMember(org, member, 'member')
    const viewer = await createUser({ email: uniqueEmail('nav-pmo-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    const tool = createNavigateToSpaceTool(await deps())

    for (const user of [member, viewer]) {
      for (const target of PMO_NAVIGATE_TO_SPACE_TARGETS) {
        const result = await tool.handler(ctxFor(user, org.id), { lens: 'pmo', target })
        assert.equal(result.status, 'SUCCESS', `${user.email} 导航 ${target} 应放行`)
        assert.equal(result.data.path, PMO_TARGET_PATH_BY_TARGET[target])
      }
    }
  })

  test('既有项目镜头零回归：gantt 旧轨路径拼装不变；缺 projectId 仍 422；跨组织仍 404', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-pmo-legacy-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('nav-pmo-legacy-outsider') })
    const orgB = await createOrganization(outsider)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // 项目镜头路径拼装与 projectId 保留不变（旧轨形态）
    const gantt = await tool.handler(ctx, { projectId: project.id, lens: 'gantt' })
    assert.equal(gantt.data.path, `/projects/${project.id}/gantt`)
    assert.equal(gantt.data.projectId, project.id)

    // 项目镜头缺 projectId 仍抛 422（仅 help/knowledge、pmo 与组织镜头容缺）
    let caught: unknown = null
    try {
      await tool.handler(ctx, { lens: 'gantt' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ValidationException)

    // 跨组织项目镜头仍统一 404（RL-05，与组织/PMO 镜头容缺语义严格区分）
    let crossOrg: unknown = null
    try {
      await tool.handler(ctxFor(outsider, orgB.id), { projectId: project.id, lens: 'kanban' })
    } catch (error) {
      crossOrg = error
    }
    assert.instanceOf(crossOrg, ResourceNotFoundException)
  })
})
