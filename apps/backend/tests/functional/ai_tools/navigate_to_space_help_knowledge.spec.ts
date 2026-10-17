// v3-ui-next-help-knowledge-domain W3 · tasks 3.6 —— `navigate_to_space` 帮助/知识
// 全域镜头功能测试（spec「空间地图坐标点亮与 AI 同事意图直达三通道闭环」要求 3）。
//
// 覆盖：
// - lens='help' / lens='knowledge' 收录白名单，handler 传入 `{ lens: 'help' }` /
//   `{ lens: 'knowledge' }`（不带 projectId）成功返回全局路径 /next/help 与
//   /next/knowledge，结果 projectId 恒为 null（全域镜头无项目载体）；
// - 全域镜头跳过项目存在性/组织归属校验：附带任意 projectId（含跨组织/不存在）
//   均不触发 404，仍返回全局绝对路径（帮助中心/知识底座为登录全员可达的全局
//   视窗，零组织级资源校验，RL-05 无涉组织数据）；
// - 组织上下文校验与只读 zero-mutation 承诺（RL-01）：handler 在真实组织会话
//   ctx 下执行、数据库行数零变化；
// - 既有项目镜头行为零回归：gantt 旧轨路径拼装与 projectId 保留不变，项目镜头
//   缺 projectId 仍抛 422，跨组织项目镜头仍统一 404；lens schema enum 收录两
//   新镜头且 required 契约不变。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import type User from '#models/user'
import ProjectService from '#services/project_service'
import { createNavigateToSpaceTool } from '#services/ai_tools/handlers/index'
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
  }
}

function ctxFor(user: User, organizationId: number): ToolExecutionContext {
  return { user, organizationId, requestId: 'navigate-help-knowledge-test' }
}

test.group('AI tools: navigate_to_space help/knowledge 全域镜头', (group) => {
  useAuthDatabase(group)

  test('lens=help 不带 projectId → SUCCESS + path=/next/help + projectId=null', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-help-owner') })
    const org = await createOrganization(owner)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    const result = await tool.handler(ctx, { lens: 'help' })
    assert.equal(result.status, 'SUCCESS')
    assert.deepEqual(result.data, {
      projectId: null,
      lens: 'help',
      depth: 'workbench',
      targetId: null,
      path: '/next/help',
    })
  })

  test('lens=knowledge 不带 projectId → SUCCESS + path=/next/knowledge + projectId=null', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-knowledge-owner') })
    const org = await createOrganization(owner)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    const result = await tool.handler(ctx, { lens: 'knowledge' })
    assert.equal(result.status, 'SUCCESS')
    assert.deepEqual(result.data, {
      projectId: null,
      lens: 'knowledge',
      depth: 'workbench',
      targetId: null,
      path: '/next/knowledge',
    })
  })

  test('全域镜头跳过项目校验：附带跨组织/不存在的 projectId 仍成功直达全局路径（不 404）', async ({
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('nav-global-orga') })
    const orgA = await createOrganization(ownerA)
    const outsider = await createUser({ email: uniqueEmail('nav-global-orgb') })
    const orgB = await createOrganization(outsider)
    const { project } = await createProjectWithMember(
      orgA,
      ownerA,
      ownerA,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tool = createNavigateToSpaceTool(await deps())
    // 组织 B 用户附带组织 A 的项目 ID 请求全域镜头：不做项目归属校验，正常直达
    const foreign = await tool.handler(ctxFor(outsider, orgB.id), {
      projectId: project.id,
      lens: 'help',
    })
    assert.equal(foreign.status, 'SUCCESS')
    assert.equal(foreign.data.path, '/next/help')
    assert.equal(foreign.data.projectId, null)

    // 附带不存在的项目 ID 同样不受影响（不存在性绝不参与全域导航判定）
    const ghost = await tool.handler(ctxFor(ownerA, orgA.id), {
      projectId: 999_999,
      lens: 'knowledge',
    })
    assert.equal(ghost.status, 'SUCCESS')
    assert.equal(ghost.data.path, '/next/knowledge')
  })

  test('组织上下文执行 + 只读 zero-mutation 承诺（RL-01）：数据库行数零变化', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-global-owner') })
    const org = await createOrganization(owner)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)
    const before = await Task.query().count('* as total')

    for (const lens of ['help', 'knowledge'] as const) {
      const result = await tool.handler(ctx, { lens })
      assert.equal(result.status, 'SUCCESS')
      assert.isTrue(result.data.path.startsWith('/next/'))
    }

    const after = await Task.query().count('* as total')
    assert.equal(Number(after[0]?.$extras?.total ?? 0), Number(before[0]?.$extras?.total ?? 0))
  })

  test('lens 白名单与 schema 契约：enum 收录 help/knowledge，required 契约不变', async ({
    assert,
  }) => {
    const { projectService } = await deps()
    const tool = createNavigateToSpaceTool({ projectService })
    const schema = tool.parametersJsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    const lensEnum = (schema.properties?.lens as { enum?: string[] })?.enum
    assert.isArray(lensEnum)
    assert.isTrue(lensEnum?.includes('help'))
    assert.isTrue(lensEnum?.includes('knowledge'))
    // 既有项目镜头成员不受影响
    assert.isTrue(lensEnum?.includes('kanban'))
    assert.isTrue(lensEnum?.includes('gantt'))
    assert.isTrue(lensEnum?.includes('files'))
    // required 契约已在 pmo 批次收口为 ['lens']（项目镜头缺 projectId 由 handler 维持 422）
    assert.deepEqual(schema.required, ['lens'])
  })

  test('既有项目镜头零回归：gantt 旧轨路径拼装不变；缺 projectId 仍 422；跨组织仍 404', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('nav-legacy-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('nav-legacy-outsider') })
    const orgB = await createOrganization(outsider)
    const tool = createNavigateToSpaceTool(await deps())
    const ctx = ctxFor(owner, org.id)

    // 项目镜头路径拼装与 projectId 保留不变（旧轨形态）
    const gantt = await tool.handler(ctx, { projectId: project.id, lens: 'gantt' })
    assert.equal(gantt.data.path, `/projects/${project.id}/gantt`)
    assert.equal(gantt.data.projectId, project.id)

    // 项目镜头缺 projectId 仍抛 422（仅 help/knowledge 全域镜头容缺）
    let caught: unknown = null
    try {
      await tool.handler(ctx, { lens: 'gantt' })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ValidationException)

    // 跨组织项目镜头仍统一 404（RL-05，与全域镜头容缺语义严格区分）
    let crossOrg: unknown = null
    try {
      await tool.handler(ctxFor(outsider, orgB.id), { projectId: project.id, lens: 'kanban' })
    } catch (error) {
      crossOrg = error
    }
    assert.instanceOf(crossOrg, ResourceNotFoundException)
  })
})
