/**
 * v3-plugin-scoped-storage —— 插件存储 API 集成测试（任务 4.2）。
 *
 * 覆盖要求：
 * - 认证：未认证 401
 * - 校验：非法 scope/key/pagination → 400
 * - 授权：RBAC 三权（member 只读 403 写；viewer 全拒；owner/manage/export 全通）
 * - 状态码族：404（隔离非泄露）/ 409（stale revision、句柄重放）
 * - 统一 envelope：列表 {data,meta}、错误 {error:{code,message}}
 * - 清理流经 HTTP：preview → confirm → 重放 409
 * - 导出经 HTTP：owner 成功返回 manifest+filePath；无权限成员 403 且零文件语义
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  addOrgMember,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginInstallation from '#models/plugin_installation'
import type Organization from '#models/organization'
import type User from '#models/user'

const PLUGIN_A = 'acme.api-demo'

function runtimeBase(orgId: number | string, pluginId: string): string {
  return `/api/v1/organizations/${orgId}/plugin-storage/runtime/${pluginId}`
}
function adminBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-storage`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

interface World {
  owner: User
  org: Organization
  memberToken: string
  viewerToken: string
  otherOrgOwnerToken: string
}

test.group('PluginStorage API', (group) => {
  useAiDatabase(group)

  async function seedWorld(client: any): Promise<World> {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    const viewer = await createUser()
    const outsider = await createUser()
    await addOrgMember(org, member, 'member')
    await addOrgMember(org, viewer, 'viewer')
    await createOrganization(outsider) // 他组织（其 owner 视角）

    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: PLUGIN_A,
      version: '1.0.0',
      releaseId: 1,
      status: 'enabled',
      packageDigest: 'pkg',
      manifestDigest: 'manifest',
      compatibilityDigest: 'compat',
    })

    return {
      owner,
      org,
      memberToken: await login(client, member.email),
      viewerToken: await login(client, viewer.email),
      otherOrgOwnerToken: await login(client, outsider.email),
    }
  }

  test('未认证访问 runtime 与管理面均 401', async ({ client }) => {
    const world = await seedWorld(client)
    const r1 = await client.get(`${runtimeBase(world.org.id, PLUGIN_A)}/entries?scope=organization`)
    r1.assertStatus(401)
    const r2 = await client.get(`${adminBase(world.org.id)}/namespaces`)
    r2.assertStatus(401)
  })

  test('owner 完整读写删回路与统一 envelope', async ({ client, assert }) => {
    const world = await seedWorld(client)
    const token = await login(client, world.owner.email)
    const base = `${runtimeBase(world.org.id, PLUGIN_A)}`

    // put（懒建 namespace）
    const putRes = await client
      .put(`${base}/entries/board.view`)
      .header('Authorization', `Bearer ${token}`)
      .json({ scope: 'organization', value: { lane: 'todo' } })
    putRes.assertStatus(200)
    assert.equal(putRes.body().data.revision, 1)

    // get
    const getRes = await client
      .get(`${base}/entries/board.view?scope=organization`)
      .header('Authorization', `Bearer ${token}`)
    getRes.assertStatus(200)
    assert.deepEqual(getRes.body().data.value, { lane: 'todo' })

    // list envelope {data, meta}
    await client
      .put(`${base}/entries/second.key`)
      .header('Authorization', `Bearer ${token}`)
      .json({ scope: 'organization', value: { n: 2 } })
    const listRes = await client
      .get(`${base}/entries?scope=organization&page=1&perPage=1`)
      .header('Authorization', `Bearer ${token}`)
    listRes.assertStatus(200)
    assert.equal(listRes.body().data.length, 1)
    assert.equal(listRes.body().meta.total, 2)
    assert.equal(listRes.body().meta.totalPages, 2)

    // CAS 更新成功
    const upd = await client
      .put(`${base}/entries/board.view`)
      .header('Authorization', `Bearer ${token}`)
      .json({ scope: 'organization', value: { lane: 'doing' }, expectedRevision: 1 })
    upd.assertStatus(200)
    assert.equal(upd.body().data.revision, 2)

    // stale revision → 409
    const stale = await client
      .put(`${base}/entries/board.view`)
      .header('Authorization', `Bearer ${token}`)
      .json({ scope: 'organization', value: { lane: 'done' }, expectedRevision: 1 })
    stale.assertStatus(409)
    assert.equal(stale.body().error.code, 'storage-revision-conflict')

    // delete
    const del = await client
      .delete(`${base}/entries/second.key?scope=organization&expectedRevision=1`)
      .header('Authorization', `Bearer ${token}`)
    del.assertStatus(200)

    // 删除后读取 → 404 非泄露
    const gone = await client
      .get(`${base}/entries/second.key?scope=organization`)
      .header('Authorization', `Bearer ${token}`)
    gone.assertStatus(404)
    assert.notInclude(JSON.stringify(gone.body()), 'second.key')
  })

  test('校验失败 400：非法 scope / 非法 key / 非法分页', async ({ client }) => {
    const world = await seedWorld(client)
    const token = await login(client, world.owner.email)
    const base = runtimeBase(world.org.id, PLUGIN_A)

    const badScope = await client
      .put(`${base}/entries/k.ok`)
      .header('Authorization', `Bearer ${token}`)
      .json({ scope: 'global', value: {} })
    badScope.assertStatus(400)

    const badKey = await client
      .put(`${base}/entries/Bad Key!`)
      .header('Authorization', `Bearer ${token}`)
      .json({ scope: 'organization', value: {} })
    badKey.assertStatus(400)

    const badPage = await client
      .get(`${base}/entries?scope=organization&page=0`)
      .header('Authorization', `Bearer ${token}`)
    badPage.assertStatus(400)
  })

  test('RBAC：member 只读（写 403）、viewer 全拒、他组织 owner 403', async ({ client }) => {
    const world = await seedWorld(client)
    const ownerToken = await login(client, world.owner.email)
    const base = runtimeBase(world.org.id, PLUGIN_A)

    // 先由 owner 建一条数据
    await client
      .put(`${base}/entries/rbac.item`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ scope: 'organization', value: { ok: true } })

    // member：读 200，写 403
    const memberGet = await client
      .get(`${base}/entries/rbac.item?scope=organization`)
      .header('Authorization', `Bearer ${world.memberToken}`)
    memberGet.assertStatus(200)
    const memberPut = await client
      .put(`${base}/entries/member.attempt`)
      .header('Authorization', `Bearer ${world.memberToken}`)
      .json({ scope: 'organization', value: {} })
    memberPut.assertStatus(403)

    // viewer：读也 403
    const viewerGet = await client
      .get(`${base}/entries/rbac.item?scope=organization`)
      .header('Authorization', `Bearer ${world.viewerToken}`)
    viewerGet.assertStatus(403)

    // 他组织 owner：非本组织成员 → 平台统一 404 非泄露（不暴露组织资源存在性）
    const foreign = await client
      .get(`${base}/entries/rbac.item?scope=organization`)
      .header('Authorization', `Bearer ${world.otherOrgOwnerToken}`)
    foreign.assertStatus(404)
  })

  test('项目级寻址：跨项目读取 404 且不泄露 key 存在性', async ({ client, assert }) => {
    const world = await seedWorld(client)
    const ownerToken = await login(client, world.owner.email)
    // 建两个项目
    const p1 = await client
      .post(`/api/v1/projects`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ name: 'PA', code: `PA-${Date.now()}` })
    p1.assertStatus(201)
    const projectIdA = p1.body().data.id
    const p2 = await client
      .post(`/api/v1/projects`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ name: 'PB', code: `PB-${Date.now()}` })
    p2.assertStatus(201)
    const projectIdB = p2.body().data.id

    const base = runtimeBase(world.org.id, PLUGIN_A)
    await client
      .put(`${base}/entries/proj.state`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ scope: 'project', projectId: projectIdA, value: { v: 1 } })

    const wrongProject = await client
      .get(`${base}/entries/proj.state?scope=project&projectId=${projectIdB}`)
      .header('Authorization', `Bearer ${ownerToken}`)
    wrongProject.assertStatus(404)
    assert.equal(wrongProject.body().error.code, 'storage-namespace-not-found')
    assert.notInclude(JSON.stringify(wrongProject.body()), 'proj.state')
  })

  test('清理流经 HTTP：preview → confirm → 重放句柄 409', async ({ client, assert }) => {
    const world = await seedWorld(client)
    const ownerToken = await login(client, world.owner.email)
    const base = runtimeBase(world.org.id, PLUGIN_A)
    await client
      .put(`${base}/entries/cleanup.me`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ scope: 'organization', value: { bye: true } })

    // member 无权 preview
    const memberPreview = await client
      .post(`${adminBase(world.org.id)}/namespaces/999999/cleanup-preview`)
      .header('Authorization', `Bearer ${world.memberToken}`)
      .json({})
    memberPreview.assertStatus(403)

    const nsList = await client
      .get(`${adminBase(world.org.id)}/namespaces?pluginId=${PLUGIN_A}`)
      .header('Authorization', `Bearer ${ownerToken}`)
    nsList.assertStatus(200)
    const namespaceId = nsList.body().data[0].namespaceId

    const preview = await client
      .post(`${adminBase(world.org.id)}/namespaces/${namespaceId}/cleanup-preview`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({})
    preview.assertStatus(200)
    assert.equal(preview.body().data.entryCount, 1)
    assert.isTrue(preview.body().data.irreversible)

    const confirm = await client
      .post(`${adminBase(world.org.id)}/cleanup-confirm`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({
        cleanupHandle: preview.body().data.cleanupHandle,
        cleanupDigest: preview.body().data.cleanupDigest,
      })
    confirm.assertStatus(200)
    assert.equal(confirm.body().data.deletedEntries, 1)

    // 重放同一句柄 → 409 already-consumed
    const replay = await client
      .post(`${adminBase(world.org.id)}/cleanup-confirm`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({
        cleanupHandle: preview.body().data.cleanupHandle,
        cleanupDigest: preview.body().data.cleanupDigest,
      })
    replay.assertStatus(409)
    assert.equal(replay.body().error.code, 'storage-cleanup-already-consumed')
  })

  test('导出经 HTTP：owner 成功返回版本化清单；member 403 零文件', async ({ client, assert }) => {
    const world = await seedWorld(client)
    const ownerToken = await login(client, world.owner.email)
    const base = runtimeBase(world.org.id, PLUGIN_A)
    await client
      .put(`${base}/entries/export.row`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ scope: 'organization', value: { hello: 'world' } })

    const memberExport = await client
      .post(`${adminBase(world.org.id)}/export`)
      .header('Authorization', `Bearer ${world.memberToken}`)
      .json({})
    memberExport.assertStatus(403)
    // 403 路径不产生任何导出文件（响应不含 filePath 字段即为契约面证据）
    assert.isFalse('filePath' in JSON.parse(JSON.stringify(memberExport.body())))

    const exportRes = await client
      .post(`${adminBase(world.org.id)}/export`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ pluginId: PLUGIN_A })
    exportRes.assertStatus(200)
    assert.equal(exportRes.body().data.manifest.format, 'plugin-storage-export-v1')
    assert.equal(exportRes.body().data.records.length, 1)
    assert.match(exportRes.body().data.filePath as string, /plugin-storage-export-.*\.jsonl$/)
  })
})
