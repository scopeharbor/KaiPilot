// v3-triz-contradiction-copilot tasks 4.2 —— 分馆只读查询端点集成测试。
//
// 覆盖（tasks 4.2 的端点部分 + spec「矛盾矩阵交互网格件」第 2/4 条、「九屏幕 3×3 空间卡件」第 3 条）：
// - 矩阵参数对端点：命中给出推荐原则与来源；空单元中性提示；参数越界 / 非整数 422；
// - 预填端点：九屏幕九格 / 功能分析初始图（默认确定性模板路径，`providerCalls = 0`）；
// - 认证 401 / 跨组织 404（不泄露存在性）；
// - **全程零写入**：分馆产物表与业务表计数不变（只读件 + 只产草案）。
import ChangeRequest from '#models/change_request'
import Risk from '#models/risk'
import Task from '#models/task'
import TrizGalleryArtifact from '#models/triz_gallery_artifact'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const API_PREFIX = '/api/v1'

function matrixEndpoint(projectId: number, query: string): string {
  return `${API_PREFIX}/projects/${projectId}/triz-gallery/matrix-principles?${query}`
}

function prefillEndpoint(projectId: number, artifactType: string): string {
  return `${API_PREFIX}/projects/${projectId}/triz-gallery/prefill?artifactType=${artifactType}`
}

async function login(client: any, user: any): Promise<string> {
  const res = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

function authed(client: any, token: string, orgId: number) {
  return (url: string) =>
    client
      .get(url)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(orgId))
}

async function tableCount(model: { query: () => any }): Promise<number> {
  const rows = (await model.query().count('* as total')) as unknown as Array<{
    $extras: { total: number | string }
  }>
  return Number(rows[0]?.$extras?.total ?? 0)
}

test.group('TRIZ 分馆只读查询 API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('triz-gallery-read-owner') })
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

  test('未认证访问分馆只读端点返回 401', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('triz-gallery-read-anon') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    for (const url of [
      matrixEndpoint(Number(project.id), 'improving=39&worsening=27'),
      prefillEndpoint(Number(project.id), 'nine_windows'),
    ]) {
      const res = await client.get(url)
      res.assertStatus(401)
      res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
    }
  })

  test('矩阵端点：命中给出原则与来源，空单元中性提示，越界 422', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const get = authed(client, token, Number(org.id))
    const before = {
      artifacts: await tableCount(TrizGalleryArtifact),
      tasks: await tableCount(Task),
      risks: await tableCount(Risk),
      changeRequests: await tableCount(ChangeRequest),
    }

    // spec 场景 1：#39 生产率 × #27 可靠性
    const hit = await get(matrixEndpoint(Number(project.id), 'improving=39&worsening=27'))
    hit.assertStatus(200)
    const hitData = (hit.body() as { data: Record<string, any> }).data
    assert.isTrue(hitData.matched)
    assert.isFalse(hitData.empty)
    assert.isNull(hitData.hint)
    assert.equal(hitData.improving.number, 39)
    assert.equal(hitData.worsening.number, 27)
    assert.isAtLeast(hitData.principles.length, 1)
    assert.isNotEmpty(hitData.principles[0].definition)
    assert.isAtLeast(hitData.mappings.length, 1)
    assert.isNotEmpty(hitData.mappings[0].source)
    assert.equal(hitData.knowledgePack.principleCount, 40)

    // 空单元：中性提示（不显示为错误、不 404）
    const empty = await get(matrixEndpoint(Number(project.id), 'improving=1&worsening=2'))
    empty.assertStatus(200)
    const emptyData = (empty.body() as { data: Record<string, any> }).data
    assert.isFalse(emptyData.matched)
    assert.isTrue(emptyData.empty)
    assert.isNotEmpty(emptyData.hint)
    assert.isEmpty(emptyData.principles)

    // 参数边界：0 / 40 / 非整数 → 422
    for (const query of [
      'improving=0&worsening=27',
      'improving=40&worsening=27',
      'improving=1.5&worsening=27',
    ]) {
      const res = await get(matrixEndpoint(Number(project.id), query))
      res.assertStatus(422)
      res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
    }

    // 只读件：零写入
    assert.equal(await tableCount(TrizGalleryArtifact), before.artifacts)
    assert.equal(await tableCount(Task), before.tasks)
    assert.equal(await tableCount(Risk), before.risks)
    assert.equal(await tableCount(ChangeRequest), before.changeRequests)
  })

  test('预填端点：九屏幕九格与功能分析初始图，默认模板路径零模型调用', async ({
    client,
    assert,
  }) => {
    const { org, project, token } = await setup(client)
    const get = authed(client, token, Number(org.id))

    const nine = await get(prefillEndpoint(Number(project.id), 'nine_windows'))
    nine.assertStatus(200)
    const nineDraft = (nine.body() as { data: Record<string, any> }).data
    assert.equal(nineDraft.artifactType, 'nine_windows')
    assert.equal(nineDraft.path, 'rule')
    assert.equal(nineDraft.modelUsage.providerCalls, 0)
    assert.equal(nineDraft.modelUsage.totalTokens, 0)
    assert.lengthOf(nineDraft.cells, 9)
    assert.equal(nineDraft.centerKey, 'present.system')
    assert.equal(nineDraft.filledCells, 9)
    assert.isTrue(nineDraft.cells.some((cell: Record<string, any>) => cell.locked === true))
    assert.isFalse(nineDraft.persisted)
    assert.isTrue(nineDraft.requiresHumanConfirmation)

    const graph = await get(prefillEndpoint(Number(project.id), 'function_analysis'))
    graph.assertStatus(200)
    const graphDraft = (graph.body() as { data: Record<string, any> }).data
    assert.equal(graphDraft.path, 'rule')
    assert.equal(graphDraft.modelUsage.providerCalls, 0)
    assert.isAtLeast(graphDraft.nodes.length, 2)
    assert.isAtLeast(graphDraft.edges.length, 1)
    assert.isArray(graphDraft.problemCandidates)
    assert.isFalse(graphDraft.persisted)

    // 只产草案：分馆产物表零写入
    assert.equal(await tableCount(TrizGalleryArtifact), 0)

    // 未知产物类型（矩阵 / S 曲线无需预填）→ 422
    const unsupported = await get(prefillEndpoint(Number(project.id), 's_curve'))
    unsupported.assertStatus(422)
    unsupported.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('跨组织访问统一 404（矩阵 / 预填）', async ({ client, assert }) => {
    const { project } = await setup(client)
    const outsider = await createUser({ email: uniqueEmail('triz-gallery-read-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const outsiderToken = await login(client, outsider)
    const get = authed(client, outsiderToken, Number(outsiderOrg.id))

    for (const url of [
      matrixEndpoint(Number(project.id), 'improving=39&worsening=27'),
      prefillEndpoint(Number(project.id), 'nine_windows'),
    ]) {
      const res = await get(url)
      res.assertStatus(404)
      res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
      assert.notInclude(res.text(), String(project.name))
    }
  })
})
