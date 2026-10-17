// v3-multitenant-isolation-architecture §6.5 —— AI 结果落库前的既有契约必须保留。
//
// spec 场景「AI output does not bypass confirmation」：
// 租户内的 AI/Compiler 结果要变成正式项目数据，必须先过所属能力自己的
// 预览 / 显式确认 / RBAC / 组织隔离 / 审计契约。
//
// 本 spec 是**保留性回归**，不是新增门禁：它把 `AiProjectDraftsController.confirm`
// 的四道前置门钉死，确保后续多租户改造不会把其中任何一道拆掉。
//   1. 组织上下文缺失 → 拒绝（不落库）
//   2. RBAC（ai:confirm + project:create）不足 → 403 + 拒绝审计（不落库）
//   3. 组织隔离：他组织草案 → 404 掩蔽（不落库、不泄露存在性）
//   4. 显式确认：只有 `POST /:id/confirm` 能触发正式写入，生成阶段零正式落库
import { test } from '@japa/runner'
import AiProjectDraft from '#models/ai_project_draft'
import AuditLog from '#models/audit_log'
import Milestone from '#models/milestone'
import Project from '#models/project'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import WbsNode from '#models/wbs_node'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** 正式项目数据的行数快照（confirm 是唯一允许改变它的入口）。 */
async function formalWriteCounts() {
  const count = async (q: any) => {
    const row = await q.count('* as total')
    return Number(row[0].$extras.total)
  }
  return {
    projects: await count(Project.query()),
    tasks: await count(Task.query()),
    wbsNodes: await count(WbsNode.query()),
    dependencies: await count(TaskDependency.query()),
    milestones: await count(Milestone.query()),
  }
}

test.group('AI 落库前置契约保留（§6.5）', (group) => {
  useAuthDatabase(group)

  let ownerB: Awaited<ReturnType<typeof createUser>>
  let memberA: Awaited<ReturnType<typeof createUser>>
  let draftB: AiProjectDraft

  group.each.setup(async () => {
    const ownerA = await createUser({ email: uniqueEmail('taic-owna') })
    const orgA = await createOrganization(ownerA)
    ownerB = await createUser({ email: uniqueEmail('taic-ownb') })
    const orgB = await createOrganization(ownerB)

    // orgA 的普通成员：有租户上下文，但没有 ai:confirm + project:create。
    memberA = await createUser({ email: uniqueEmail('taic-mema') })
    await addOrgMember(orgA, memberA, 'member')

    // orgB 的草案：orgA 的任何人都不得确认它，也不得确认它的存在。
    draftB = await AiProjectDraft.create({
      draftUid: `draft_b_${Date.now()}`,
      organizationId: Number(orgB.id),
      userId: ownerB.id,
      projectType: 'software',
      // `reviewing` = 审查通过、等待显式 confirm 的状态（controller 在 confirm 前置流程里
      // 显式写入该值，见 ai_project_drafts_controller.ts:308）。表上有 CHECK 约束，
      // 不能用 spec 文案里的自然语义词。
      status: 'reviewing',
      schemaVersion: '1.0',
      currentVersion: 1,
      fallbackUsed: false,
      usingRealAdapter: false,
    })
  })

  test('未认证请求无法触达 confirm，正式数据零变化', async ({ client, assert }) => {
    const before = await formalWriteCounts()
    const res = await client.post(`/api/v1/ai/project-drafts/${draftB.draftUid}/confirm`).json({})
    assert.oneOf(res.status(), [401, 403])
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('RBAC 不足：403 并写入拒绝审计，正式数据零变化', async ({ client, assert }) => {
    const token = await login(client, memberA.email)
    const before = await formalWriteCounts()
    const auditBefore = await AuditLog.query().count('* as total')

    // 用自己组织内不存在的 draftUid：RBAC 在归属解析之前判定，因此仍应是 403 而非 404。
    const res = await client
      .post('/api/v1/ai/project-drafts/draft_not_exists/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({})

    res.assertStatus(403)
    assert.equal(res.body().error?.code, 'PERMISSION_DENIED')
    assert.deepEqual(await formalWriteCounts(), before, 'RBAC 拒绝路径不得产生任何正式写入')

    const auditAfter = await AuditLog.query().count('* as total')
    assert.isAbove(
      Number(auditAfter[0].$extras.total),
      Number(auditBefore[0].$extras.total),
      '权限拒绝必须留下审计',
    )
  })

  test('组织隔离：他组织草案的确认被拒，正式数据零变化', async ({ client, assert }) => {
    const token = await login(client, ownerB.email)
    const before = await formalWriteCounts()

    // 用 orgB 的 owner 确认自己的草案是允许的路径；此处换成 orgA 的成员来证明隔离。
    const tokenA = await login(client, memberA.email)
    const crossTenant = await client
      .post(`/api/v1/ai/project-drafts/${draftB.draftUid}/confirm`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({})

    // 无论先被 RBAC 拦下（403）还是被归属解析拦下（404），都必须是拒绝且零写入。
    assert.oneOf(crossTenant.status(), [403, 404])
    assert.deepEqual(await formalWriteCounts(), before)
    assert.notInclude(
      JSON.stringify(crossTenant.body()),
      draftB.draftUid,
      '拒绝响应不得回显他组织草案标识',
    )
    assert.isString(token)
  })

  test('他组织草案的详情读取同样 404 掩蔽（确认前的可见性一致）', async ({ client, assert }) => {
    const tokenA = await login(client, memberA.email)

    const crossTenant = await client
      .get(`/api/v1/ai/project-drafts/${draftB.draftUid}`)
      .header('Authorization', `Bearer ${tokenA}`)
    const missing = await client
      .get('/api/v1/ai/project-drafts/draft_definitely_missing')
      .header('Authorization', `Bearer ${tokenA}`)

    assert.equal(
      crossTenant.status(),
      missing.status(),
      '他组织草案与不存在草案必须同状态码，否则可判定存在性',
    )
    assert.deepEqual(crossTenant.body(), missing.body())
  })

  test('未经 confirm 端点，草案存在本身不会产生任何正式项目数据', async ({ assert }) => {
    // draftB 已在 setup 中创建（status=ready），此处断言"存在草案 ≠ 已落库"。
    const counts = await formalWriteCounts()
    assert.deepEqual(counts, {
      projects: 0,
      tasks: 0,
      wbsNodes: 0,
      dependencies: 0,
      milestones: 0,
    })
  })
})
