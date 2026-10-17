/**
 * v3-copilot-live-submission-channel —— 回合端点 functional 测试（任务 4.20）。
 *
 * 覆盖四条路径：
 * - 未认证 → 401 `AUTH_REQUIRED`
 * - 跨组织 → 拿不到另一组织的会话/数据（不泄露其存在）
 * - 越权引用 → 被拒引用只回计数，不回被拒实体的类型/ID/名称/原因
 * - 正常回合 → 200，返回会话 ID、destination 排序、统计与低敏 envelope
 *
 * 红线断言（不是可选项）：
 * - 端点**零域写**：一次回合不得新增任何任务/风险/变更等正式数据；
 * - 响应不含 prompt、模型输出全文、token 与 secret。
 */
import { test } from '@japa/runner'
import Task from '#models/task'
import Project from '#models/project'
import { ProjectRoleName } from '#rbac'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const BASE = '/api/v1/copilot/turns'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** 建一个「组织 + 项目 + 项目经理」的完整可用主体。 */
async function setupActor(prefix: string) {
  const owner = await createUser({ email: uniqueEmail(prefix) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

test.group('Copilot 回合端点 —— functional', (group) => {
  useAuthDatabase(group)

  test('未认证提交回合返回 401', async ({ client }) => {
    const res = await client.post(BASE).json({ text: '帮我看看项目风险', scope: 'global' })
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('创建项目意图使用真实组织权限返回创建入口，回合本身不创建项目', async ({
    client,
    assert,
  }) => {
    const { owner, org } = await setupActor('turn-create-project')
    const token = await login(client, owner.email)
    const before = await Project.query().where('organization_id', org.id).count('* as total')
    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        sessionId: null,
        scope: 'global',
        attribution: { organizationId: org.id },
        text: '帮我创建一个新项目：校园读书会',
        mentions: [],
      })
    res.assertStatus(200)
    assert.isTrue(
      res
        .body()
        .data.destinations.some(
          (destination: { destination: string; requiresUserConfirmation: boolean }) =>
            destination.destination === 'project_creation' && destination.requiresUserConfirmation,
        ),
    )
    const after = await Project.query().where('organization_id', org.id).count('* as total')
    assert.equal(Number(after[0].$extras.total), Number(before[0].$extras.total))
  })

  test('全局只读模式：未导入/跨组织 draftId 归属被剥离且零域写', async ({ client, assert }) => {
    const { owner } = await setupActor('turn-draft-global')
    const other = await createOrganization(owner)
    const token = await login(client, owner.email)
    const before = (await Task.query().count('* as total')) as unknown as Array<{ total: number }>

    // 跨组织归属必须拒绝，且不泄露草案 ID 或另一组织 ID。
    const crossOrg = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        sessionId: null,
        scope: 'global',
        attribution: { organizationId: other.id, draftId: 'draft_other_org' },
        text: '把项目排期推迟一周',
        mentions: [],
        currentRoute: '/ai-create',
      })
    crossOrg.assertStatus(422)
    crossOrg.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
    assert.notInclude(crossOrg.text(), 'draft_other_org')

    // 未导入草案的 draftId 在全局模式下不进入归属、不读取草案，且零域写。
    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        sessionId: null,
        scope: 'global',
        attribution: { draftId: 'draft_not_imported' },
        text: '把项目排期推迟一周',
        mentions: [],
        currentRoute: '/ai-create',
      })
    res.assertStatus(200)
    const data = res.body().data as Record<string, unknown>
    assert.equal(data.scope, 'global')
    assert.notInclude(JSON.stringify(data), 'draft_not_imported')
    assert.notInclude(res.text(), 'draft_not_imported')
    const after = (await Task.query().count('* as total')) as unknown as Array<{ total: number }>
    assert.equal(after[0].total, before[0].total, '全局只读回合不得产生任何正式写')
  })

  test('正常回合返回会话与路由结果，且零域写', async ({ client, assert }) => {
    const { owner, org, project } = await setupActor('turn-ok')
    const token = await login(client, owner.email)

    const before = await Task.query().where('project_id', project.id).count('* as total')

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        sessionId: null,
        scope: 'project',
        attribution: { organizationId: org.id, projectId: project.id },
        text: '帮我看看这个项目当前的风险',
        mentions: [],
      })

    res.assertStatus(200)
    const data = res.body().data
    assert.isString(data.sessionId)
    assert.isString(data.messageId)
    assert.isArray(data.destinations)
    assert.equal(data.scope, 'project')

    // 红线：回合是建议通道，不写正式数据
    const after = await Task.query().where('project_id', project.id).count('* as total')
    assert.equal(
      Number(after[0].$extras.total),
      Number(before[0].$extras.total),
      '回合端点不得新增任何任务',
    )

    // 红线：低敏 envelope——不含 prompt / 模型输出全文 / token / secret
    const json = JSON.stringify(res.body())
    assert.notMatch(json, /"(prompt|prompts|modelOutput|model_output|apiKey|api_key|secret)"\s*:/)
  })

  test('跨组织归属拿不到另一组织的数据', async ({ client, assert }) => {
    const a = await setupActor('turn-org-a')
    const b = await setupActor('turn-org-b')
    const tokenA = await login(client, a.owner.email)

    // A 组织的用户声称自己在 B 组织的项目下提问
    const res = await client
      .post(BASE)
      .bearerToken(tokenA)
      .json({
        sessionId: null,
        scope: 'project',
        attribution: { organizationId: b.org.id, projectId: b.project.id },
        text: '把这个项目的任务列出来',
        mentions: [],
      })

    // 不搜裸数字（'2' 会命中任何 id/计数，是个假断言）。
    // 判定标准：响应不得回出 B 组织项目的名称，也不得把归属回显成 B 的项目。
    const json = JSON.stringify(res.body())
    assert.notInclude(json, b.project.name, '响应不得回出另一组织项目的名称')
    if (res.status() === 200) {
      const attribution = res.body().data?.attribution
      if (attribution) {
        assert.notEqual(attribution.projectId, b.project.id, '归属不得落到另一组织的项目上')
      }
    }
  })

  test('越权引用只回被拒计数，不回被拒实体的任何标识', async ({ client, assert }) => {
    const a = await setupActor('turn-ref-a')
    const b = await setupActor('turn-ref-b')
    const tokenA = await login(client, a.owner.email)

    // B 组织下建一个任务，A 组织的用户在提及里引用它
    // tasks 是项目派生资源，没有自己的 organization_id（见 TenantScopeRegistry），
    // 组织归属经 project 判定，所以这里只挂 projectId。
    const foreignTask = await Task.create({
      projectId: b.project.id,
      name: '越权引用目标任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    const res = await client
      .post(BASE)
      .bearerToken(tokenA)
      .json({
        sessionId: null,
        scope: 'project',
        attribution: { organizationId: a.org.id, projectId: a.project.id },
        text: '看看这个任务',
        // MentionReference 要求 entityType/entityId/label/organizationId 四个字段齐全，
        // 缺 organizationId 会被 isMentionReference 直接过滤掉——那样连权限复核都进不去，
        // 被拒计数恒为 0，这条断言就验不到东西了。
        mentions: [
          {
            entityType: 'task',
            entityId: foreignTask.id,
            label: '越权引用目标任务',
            organizationId: a.org.id,
            projectId: b.project.id,
          },
        ],
      })

    res.assertStatus(200)
    const data = res.body().data
    // 只回计数——回原因或标识就能反推实体存在（spec REQ 非泄露）
    assert.equal(data.rejectedReferenceCount, 1)

    const json = JSON.stringify(res.body())
    assert.notInclude(json, '越权引用目标任务', '响应不得回出被拒实体的名称')
    assert.notMatch(json, /"rejected(Refs|References|Entities)"\s*:/)
  })
})
