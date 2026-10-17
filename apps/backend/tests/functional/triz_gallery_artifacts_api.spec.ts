// v3-triz-contradiction-copilot tasks 4.1 —— 分馆产物 CRUD 集成测试。
//
// 覆盖（tasks 4.1 验收 + spec「分馆产物的持久化与权限」+「分馆访问的权限与中性防护」）：
// - 认证 401 / 无写权限 403（MEMBER 只读，且拒绝留痕）/ 跨组织统一 404（不泄露存在性）；
// - 创建 / 更新（**版本递增**，旧版本行保留）/ 删除（**整链软删**）；
// - 审计事件（DIAGRAM_CREATED / UPDATED / DELETED，低敏元数据：类型 / 版本 / 参数哈希）；
// - **软删后历史仍可查**（`includeDeleted=true` 等价机制）；
// - **版本回退可用**（`?version=1` 与 `/:id/versions` 取回旧版本内容）；
// - 低敏：内容含 prompt / 模型输出类键名 → 422；非对象内容 → 422；
// - **写入集合只含本表**：任务 / 风险 / 变更 / 旧轨矛盾 / 通用图表表在全程零写入。
import AuditLog from '#models/audit_log'
import ChangeRequest from '#models/change_request'
import Diagram from '#models/diagram'
import ProjectContradiction from '#models/project_contradiction'
import Risk from '#models/risk'
import Task from '#models/task'
import TrizGalleryArtifact from '#models/triz_gallery_artifact'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const API_PREFIX = '/api/v1'

function endpoint(projectId: number, suffix = ''): string {
  return `${API_PREFIX}/projects/${projectId}/triz-gallery-artifacts${suffix}`
}

async function login(client: any, user: any): Promise<string> {
  const res = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

function authed(client: any, token: string, orgId: number) {
  const headers = { Authorization: `Bearer ${token}`, 'x-organization-id': String(orgId) }
  return {
    get: (url: string) => client.get(url).headers(headers),
    post: (url: string) => client.post(url).headers(headers),
    patch: (url: string) => client.patch(url).headers(headers),
    delete: (url: string) => client.delete(url).headers(headers),
  }
}

async function tableCount(model: { query: () => any }): Promise<number> {
  const rows = (await model.query().count('* as total')) as unknown as Array<{
    $extras: { total: number | string }
  }>
  return Number(rows[0]?.$extras?.total ?? 0)
}

/** 业务表（分馆产物之外的一切）：本 change MUST NOT 写入。 */
async function businessTableCounts(): Promise<Record<string, number>> {
  return {
    tasks: await tableCount(Task),
    risks: await tableCount(Risk),
    changeRequests: await tableCount(ChangeRequest),
    contradictions: await tableCount(ProjectContradiction),
    diagrams: await tableCount(Diagram),
  }
}

const NINE_WINDOWS_CONTENT = {
  cells: [
    { key: 'present.system', text: '当前痛点：联调排期逾期', contextRefs: ['risk:1'] },
    { key: 'future.subsystem', text: '待建设的模块', contextRefs: ['task:2'] },
  ],
  annotations: ['来自预填草案的人工确认版本'],
}

test.group('TRIZ 分馆产物 API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('triz-gallery-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { owner, org, project, token }
  }

  test('未认证访问分馆产物返回 401', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('triz-gallery-anon') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const res = await client.get(endpoint(Number(project.id)))
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('MEMBER 只读：列表 200，写入 403 且零写入并留痕', async ({ client, assert }) => {
    const { owner, org } = await setup(client)
    const member = await createUser({ email: uniqueEmail('triz-gallery-member') })
    await addOrgMember(org, member, 'member')
    const { project } = await createProjectWithMember(org, owner, member, ProjectRoleName.MEMBER)
    const token = await login(client, member)
    const api = authed(client, token, Number(org.id))

    const list = await api.get(endpoint(Number(project.id)))
    list.assertStatus(200)
    const body = list.body() as { data: unknown[]; meta: Record<string, number> }
    assert.lengthOf(body.data, 0)
    assert.equal(body.meta.total, 0)

    // 写入：MEMBER 只有 diagram:view，无 diagram:manage（design D17 ③ 的权限裁定）
    const create = await api.post(endpoint(Number(project.id))).json({
      artifactType: 'nine_windows',
      content: NINE_WINDOWS_CONTENT,
    })
    create.assertStatus(403)
    create.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    const update = await api.patch(endpoint(Number(project.id), '/1')).json({
      content: { cells: [] },
    })
    update.assertStatus(403)

    const remove = await api.delete(endpoint(Number(project.id), '/1'))
    remove.assertStatus(403)

    assert.equal(await tableCount(TrizGalleryArtifact), 0)

    const denials = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('action', 'reject')
    assert.isAtLeast(denials.length, 1)
    const metadata = denials[0].metadata as Record<string, unknown>
    assert.equal(metadata.status, 'REJECTED')
    assert.match(String(metadata.parametersHash), /^[0-9a-f]{64}$/)
    assert.equal(metadata.missingPermission, 'diagram:manage')
  })

  test('跨组织访问统一 404（列表 / 详情 / 创建 / 更新 / 删除）', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const created = await authed(client, token, Number(org.id))
      .post(endpoint(Number(project.id)))
      .json({ artifactType: 'nine_windows', content: NINE_WINDOWS_CONTENT })
    created.assertStatus(201)
    const artifactId = (created.body() as { data: { id: number } }).data.id

    const outsider = await createUser({ email: uniqueEmail('triz-gallery-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const outsiderToken = await login(client, outsider)
    const outside = authed(client, outsiderToken, Number(outsiderOrg.id))

    for (const res of [
      await outside.get(endpoint(Number(project.id))),
      await outside.get(endpoint(Number(project.id), `/${artifactId}`)),
      await outside.post(endpoint(Number(project.id))).json({
        artifactType: 'nine_windows',
        content: NINE_WINDOWS_CONTENT,
      }),
      await outside.patch(endpoint(Number(project.id), `/${artifactId}`)).json({
        content: { cells: [] },
      }),
      await outside.delete(endpoint(Number(project.id), `/${artifactId}`)),
    ]) {
      res.assertStatus(404)
      res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
      assert.notInclude(res.text(), String(project.name))
    }

    // 他组织写入未生效
    assert.equal(await tableCount(TrizGalleryArtifact), 1)
  })

  test('创建 / 更新版本递增 / 审计事件，且业务表零写入', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))
    const before = await businessTableCounts()

    const created = await api
      .post(endpoint(Number(project.id)))
      .json({ artifactType: 'nine_windows', content: NINE_WINDOWS_CONTENT })
    created.assertStatus(201)
    const first = (created.body() as { data: Record<string, any> }).data
    assert.equal(first.version, 1)
    assert.equal(first.artifactType, 'nine_windows')
    assert.equal(first.artifactTypeLabel, '九屏幕')
    assert.isTrue(first.isCurrent)
    assert.deepEqual(first.content, NINE_WINDOWS_CONTENT)
    assert.notInclude(created.text(), 'prompt')

    // 列表统一信封 + 类型过滤（默认每类只给当前版本）
    const list = await api.get(endpoint(Number(project.id)))
    list.assertStatus(200)
    const listBody = list.body() as {
      data: Array<Record<string, any>>
      meta: Record<string, number>
    }
    assert.lengthOf(listBody.data, 1)
    assert.equal(listBody.meta.total, 1)
    assert.equal(listBody.meta.page, 1)
    assert.equal(listBody.meta.totalPages, 1)

    const filtered = await api.get(endpoint(Number(project.id), '?artifactType=s_curve'))
    filtered.assertStatus(200)
    assert.lengthOf((filtered.body() as { data: unknown[] }).data, 0)

    // 更新 = 版本递增（新增下一版，旧版本行保留）
    const updated = await api.patch(endpoint(Number(project.id), `/${first.id}`)).json({
      content: { cells: [{ key: 'present.system', text: '第二轮修改后的痛点' }], annotations: [] },
    })
    updated.assertStatus(200)
    const second = (updated.body() as { data: Record<string, any> }).data
    assert.equal(second.version, 2)
    assert.equal(second.previousVersion, 1)
    assert.notEqual(second.id, first.id)

    // 审计：create + update 各一条，低敏元数据
    const createAudits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('action', 'create')
    assert.lengthOf(createAudits, 1)
    const createMetadata = createAudits[0].metadata as Record<string, unknown>
    assert.equal(createMetadata.toolName, 'triz_gallery_artifact')
    assert.equal(createMetadata.artifactType, 'nine_windows')
    assert.equal(createMetadata.version, 1)
    assert.match(String(createMetadata.parametersHash), /^[0-9a-f]{64}$/)
    assert.notInclude(JSON.stringify(createMetadata), '联调排期逾期')

    const updateAudits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('action', 'update')
    assert.lengthOf(updateAudits, 1)
    const updateMetadata = updateAudits[0].metadata as Record<string, unknown>
    assert.equal(updateMetadata.version, 2)
    assert.equal(updateMetadata.previousVersion, 1)

    // 写入集合只含本表：业务表零写入
    assert.deepEqual(await businessTableCounts(), before)
    assert.equal(await tableCount(TrizGalleryArtifact), 2)
  })

  test('版本回退可用：取回旧版本内容（?version=1 与 /versions）', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const created = await api
      .post(endpoint(Number(project.id)))
      .json({ artifactType: 'function_analysis', content: { nodes: [{ id: 'n1' }], edges: [] } })
    created.assertStatus(201)
    const firstId = (created.body() as { data: { id: number } }).data.id

    const updated = await api.patch(endpoint(Number(project.id), `/${firstId}`)).json({
      content: { nodes: [{ id: 'n1' }, { id: 'n2' }], edges: [{ from: 'n1', to: 'n2' }] },
    })
    updated.assertStatus(200)
    const secondId = (updated.body() as { data: { id: number } }).data.id

    // 详情按版本号回退读取旧版本内容
    const oldVersion = await api.get(endpoint(Number(project.id), `/${secondId}?version=1`))
    oldVersion.assertStatus(200)
    const oldData = (oldVersion.body() as { data: Record<string, any> }).data
    assert.equal(oldData.version, 1)
    assert.deepEqual(oldData.content.nodes, [{ id: 'n1' }])

    // 版本历史：两条版本，最新为 current
    const versions = await api.get(endpoint(Number(project.id), `/${firstId}/versions`))
    versions.assertStatus(200)
    const rows = (versions.body() as { data: Array<Record<string, any>> }).data
    assert.lengthOf(rows, 2)
    assert.equal(rows[0].version, 2)
    assert.isTrue(rows[0].isCurrent)
    assert.equal(rows[1].version, 1)
    assert.isFalse(rows[1].isCurrent)

    // 回退动作 = 用旧版本内容再保存为新版本（写入仍走更新端点，旧版本行继续保留）
    const rollback = await api
      .patch(endpoint(Number(project.id), `/${secondId}`))
      .json({ content: oldData.content })
    rollback.assertStatus(200)
    assert.equal((rollback.body() as { data: { version: number } }).data.version, 3)
    assert.equal(await tableCount(TrizGalleryArtifact), 3)
  })

  test('软删：默认不可见，历史（includeDeleted）仍可查', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const created = await api
      .post(endpoint(Number(project.id)))
      .json({ artifactType: 's_curve', content: { stages: ['婴儿期', '成长期'] } })
    created.assertStatus(201)
    const artifactId = (created.body() as { data: { id: number } }).data.id

    const removed = await api.delete(endpoint(Number(project.id), `/${artifactId}`))
    removed.assertStatus(200)
    const removedBody = (removed.body() as { data: Record<string, any> }).data
    assert.isTrue(removedBody.deleted)
    assert.equal(removedBody.deletedRows, 1)
    assert.equal(removedBody.artifactType, 's_curve')

    // 默认视图：软删后不可见、详情 404（不泄露存在性）
    const list = await api.get(endpoint(Number(project.id)))
    list.assertStatus(200)
    assert.lengthOf((list.body() as { data: unknown[] }).data, 0)

    const hidden = await api.get(endpoint(Number(project.id), `/${artifactId}`))
    hidden.assertStatus(404)
    hidden.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    // 历史查询（等价机制）：includeDeleted=true 仍可查（软删不物理破坏历史）
    const history = await api.get(endpoint(Number(project.id), '?includeDeleted=true'))
    history.assertStatus(200)
    const historyRows = (history.body() as { data: Array<Record<string, any>> }).data
    assert.lengthOf(historyRows, 1)
    assert.isTrue(historyRows[0].deleted)
    assert.isNotNull(historyRows[0].deletedAt)

    const historyDetail = await api.get(
      endpoint(Number(project.id), `/${artifactId}?includeDeleted=true`),
    )
    historyDetail.assertStatus(200)
    assert.deepEqual((historyDetail.body() as { data: Record<string, any> }).data.content, {
      stages: ['婴儿期', '成长期'],
    })

    // 库层：行仍在（软删而非物理删除）
    assert.equal(await tableCount(TrizGalleryArtifact), 1)
    const row = await TrizGalleryArtifact.query().where('id', artifactId).firstOrFail()
    assert.isNotNull(row.deletedAt)

    // 删除审计
    const audits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('action', 'delete')
    assert.lengthOf(audits, 1)
    assert.equal((audits[0].metadata as Record<string, unknown>).artifactType, 's_curve')
  })

  test('低敏：内容含 prompt / 模型输出键名或非对象一律 422', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const withPrompt = await api.post(endpoint(Number(project.id))).json({
      artifactType: 'nine_windows',
      content: { cells: [], prompt: '你是 TRIZ 专家……' },
    })
    withPrompt.assertStatus(422)
    withPrompt.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })

    const nestedOutput = await api.post(endpoint(Number(project.id))).json({
      artifactType: 'function_analysis',
      content: { nodes: [{ id: 'n1', modelOutput: '模型输出全文' }] },
    })
    nestedOutput.assertStatus(422)

    const notObject = await api.post(endpoint(Number(project.id))).json({
      artifactType: 'nine_windows',
      content: '纯文本内容',
    })
    notObject.assertStatus(422)

    const badType = await api.post(endpoint(Number(project.id))).json({
      artifactType: 'unknown_type',
      content: { cells: [] },
    })
    badType.assertStatus(422)

    assert.equal(await tableCount(TrizGalleryArtifact), 0)
  })
})
