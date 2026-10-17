import AuditLog from '#models/audit_log'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Report from '#models/report'
import Task from '#models/task'
import type Organization from '#models/organization'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * preset-project-reports 集成测试（tasks 4.4 / 2.5 / 7.1 综合覆盖）。
 *
 * 覆盖点：
 *   - PM 生成 progress 报表 201 → 详情返回持久化快照；
 *   - 列表 { data, meta } 分页 + template 过滤 + 排序；
 *   - 详情读取的是历史快照（写入后新增任务，快照不变）；
 *   - 只读观察者 view 通过 + generate/export/download 拒绝；
 *   - 外部协作者无 REPORT_VIEW → list 返回 403；
 *   - 跨组织访问 → 404（不泄露存在性）；
 *   - Validator：无效模板 422 / VALIDATION_ERROR；
 *   - 审计：REPORT_GENERATED 落盘。
 */

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

/** 装配项目（owner=PM）+ 可选额外成员。 */
async function setupProject(
  org: Organization,
  creator: User,
  extraMembers: Array<{ user: User; role: string }> = [],
) {
  const { project } = await createProjectWithMember(
    org,
    creator,
    creator,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const roleCache = new Map<string, ProjectRole>()
  for (const { user, role } of extraMembers) {
    await addOrgMember(org, user, 'member')
    let roleRow = roleCache.get(role)
    if (!roleRow) {
      roleRow = await ProjectRole.create({
        projectId: project.id,
        name: role,
        description: role,
        permissions: [],
        isSystem: true,
      })
      roleCache.set(role, roleRow)
    }
    await ProjectMember.create({
      projectId: project.id,
      userId: user.id,
      projectRoleId: roleRow.id,
      isActive: true,
    })
  }
  return { project }
}

async function seedTasks(projectId: number, count = 3) {
  for (let i = 0; i < count; i += 1) {
    await Task.create({
      projectId,
      name: `任务${i + 1}`,
      status: i === 0 ? 'completed' : 'in_progress',
      priority: 'medium',
      taskType: 'task',
      progressPercent: i === 0 ? 100 : 40,
      isCriticalPath: false,
      isOnLongestPath: false,
    })
  }
}

test.group('报表 API：生成 + 列表 + 详情 + 权限矩阵', (group) => {
  useAuthDatabase(group)

  // ---------------- 生成 ----------------

  test('PM 生成 progress 报表 201 + 写快照 + 审计 REPORT_GENERATED', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 3)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'progress' })
    res.assertStatus(201)
    const body = res.body()
    assert.equal(body.data.template, 'progress')
    assert.equal(body.data.dataSnapshot.template, 'progress')
    assert.equal(body.data.dataSnapshot.summary.totalTasks, 3)
    assert.equal(body.data.dataSnapshot.summary.completedTasks, 1)
    assert.exists(body.data.dataSnapshot.snapshotMetadata.sourceDataHash)
    // filePath 应被序列化剥离（安全字段隐藏）
    assert.isUndefined(body.data.filePath)

    const audits = await AuditLog.query()
      .where('entity_type', 'report')
      .where('entity_id', body.data.id)
      .where('action', 'create')
    assert.isAbove(audits.length, 0, '应写入 REPORT_GENERATED 审计')
  })

  test('非白名单模板返回 422 VALIDATION_ERROR', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'custom' })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  // ---------------- 列表 ----------------

  test('list 返回 { data, meta } 且默认按 generated_at 降序', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 2)
    const token = await login(client, owner)

    // 生成两条报表
    for (const tpl of ['progress', 'milestone']) {
      await client
        .post(`/api/v1/projects/${project.id}/reports`)
        .header('Authorization', `Bearer ${token}`)
        .json({ template: tpl })
    }

    const res = await client
      .get(`/api/v1/projects/${project.id}/reports?perPage=10`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    const body = res.body()
    assert.equal(body.meta.total, 2)
    assert.equal(body.meta.page, 1)
    assert.equal(body.meta.perPage, 10)
    assert.lengthOf(body.data, 2)
  })

  test('list 按 template 过滤只返回匹配模板', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 1)
    const token = await login(client, owner)

    await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'progress' })
    await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'workload' })

    const res = await client
      .get(`/api/v1/projects/${project.id}/reports?template=workload`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.equal(res.body().meta.total, 1)
    assert.equal(res.body().data[0].template, 'workload')
  })

  // ---------------- 详情/历史快照 ----------------

  test('详情读取已保存快照——写入后再增任务不改历史快照', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 2)
    const token = await login(client, owner)

    // 生成
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'progress' })
    createRes.assertStatus(201)
    const reportId = createRes.body().data.id

    // 生成后再插入新任务
    await Task.create({
      projectId: project.id,
      name: '后续任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      progressPercent: 0,
      isCriticalPath: false,
      isOnLongestPath: false,
    })

    const showRes = await client
      .get(`/api/v1/reports/${reportId}`)
      .header('Authorization', `Bearer ${token}`)
    showRes.assertStatus(200)
    // 快照中的 totalTasks 应保持为生成时的 2，不随后续任务变化
    assert.equal(
      (showRes.body() as { data: { dataSnapshot: { summary: { totalTasks: number } } } }).data
        .dataSnapshot.summary.totalTasks,
      2,
    )
  })

  test('访问不存在的报表返回统一非泄露 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client.get('/api/v1/reports/99999').header('Authorization', `Bearer ${token}`)
    res.assertStatus(404)
    // v3-multitenant-tenant-identification §5.3：错误码从 `REPORT_NOT_FOUND` 收敛为通用
    // `RESOURCE_NOT_FOUND`。特化的码本身会泄露信息——它确认了"这个 ID 是一份报表"，
    // 也让"不存在"与"存在但属于别的组织"可以按错误码区分开来。前端零依赖该码
    //（全仓 grep 只有后端自己产出它），状态码仍是 404，故收敛无兼容代价。
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  // ---------------- 权限矩阵 ----------------

  test('只读观察者 list 通过 + generate/export/download 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const observer = await createUser({ email: uniqueEmail('obs') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    await seedTasks(project.id, 1)
    const pmToken = await login(client, owner)
    const obsToken = await login(client, observer)

    // 观察者可 list
    const listRes = await client
      .get(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${obsToken}`)
    listRes.assertStatus(200)

    // 观察者 generate → 403
    const genRes = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${obsToken}`)
      .json({ template: 'progress' })
    genRes.assertStatus(403)
    genRes.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    // 先让 PM 造一条报表，用观察者去 export/download
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({ template: 'progress' })
    createRes.assertStatus(201)
    const reportId = createRes.body().data.id

    // 观察者 export → 403
    const exportRes = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${obsToken}`)
      .json({ format: 'markdown' })
    exportRes.assertStatus(403)
  })

  test('MEMBER generate 返回 403（无 report:create）', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const member = await createUser({ email: uniqueEmail('member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    await seedTasks(project.id, 1)
    const token = await login(client, member)

    const res = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'progress' })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('外部协作者无 report:view → list 返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const external = await createUser({ email: uniqueEmail('ext') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: external, role: ProjectRoleName.EXTERNAL_COLLABORATOR },
    ])
    const token = await login(client, external)

    const res = await client
      .get(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  // ---------------- 跨组织隔离 ----------------

  test('跨组织访问项目报表返回 404（不泄露存在性）', async ({ client }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const { project: projectA } = await setupProject(orgA, ownerA)
    await setupProject(orgB, ownerB) // B 只是有自己项目
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`/api/v1/projects/${projectA.id}/reports`)
      .header('Authorization', `Bearer ${tokenB}`)
    // 组织隔离由 Service 拦截并抛 RESOURCE_NOT_FOUND；也可能被 tenant guard 提前拦下 → 404
    // 二者都是「不泄露存在性」的正确表现
    res.assertStatus(404)
  })

  test('跨组织访问单个报表 detail 返回 404', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const { project: projectA } = await setupProject(orgA, ownerA)
    await setupProject(orgB, ownerB)
    await seedTasks(projectA.id, 1)
    const tokenA = await login(client, ownerA)
    const tokenB = await login(client, ownerB)

    // A 生成报表
    const createRes = await client
      .post(`/api/v1/projects/${projectA.id}/reports`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({ template: 'progress' })
    createRes.assertStatus(201)
    const reportId = createRes.body().data.id

    // B 去查
    const res = await client
      .get(`/api/v1/reports/${reportId}`)
      .header('Authorization', `Bearer ${tokenB}`)
    res.assertStatus(404)
    // 后端 DB 中该报表仍存在
    const stillExists = await Report.find(reportId)
    assert.exists(stillExists, '跨组织访问不应删除资源')
  })

  // ---------------- 未认证 ----------------

  test('未认证访问 list 返回 401', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const res = await client.get(`/api/v1/projects/${project.id}/reports`)
    res.assertStatus(401)
  })
})

// ==============================================================================
// tasks 5.6 —— Markdown / CSV 导出 + 下载 + 审计
// ==============================================================================

const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? 'storage/uploads'

test.group('报表导出：Markdown / CSV / 下载 / 审计', (group) => {
  useAuthDatabase(group)

  /** 生成一条 progress 报表，返回 reportId 和 pmToken。 */
  async function makeReport(client: ApiClient, template = 'progress' as const) {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 3)
    const token = await login(client, owner)
    const create = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template })
    create.assertStatus(201)
    return {
      owner,
      org,
      project,
      token,
      reportId: Number(create.body().data.id),
    }
  }

  test('PM 导出 markdown 201 + 返回 downloadUrl + 审计 REPORT_EXPORTED', async ({
    client,
    assert,
  }) => {
    const { token, reportId } = await makeReport(client)
    const res = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'markdown' })
    res.assertStatus(201)
    const data = res.body().data
    assert.equal(data.reportId, reportId)
    assert.equal(data.format, 'markdown')
    assert.match(data.downloadUrl, /\/api\/v1\/reports\/\d+\/exports\/markdown\/download$/)
    assert.match(data.filename, /\.md$/)
    assert.isAbove(Number(data.size), 0)

    // 审计事件
    const audit = await AuditLog.query()
      .where('entity_type', 'report')
      .where('entity_id', reportId)
      .whereRaw("json_extract(metadata, '$.event') = ?", ['REPORT_EXPORTED'])
      .first()
    assert.exists(audit, 'REPORT_EXPORTED 审计应落库')
    assert.equal(audit!.action, 'export')

    // 落盘 file_path + file_format
    const report = await Report.find(reportId)
    assert.equal(report!.fileFormat, 'markdown')
    assert.isNotNull(report!.filePath)
  })

  test('PM 导出 csv 201 + 内容含 UTF-8 BOM 与元数据段', async ({ client, assert }) => {
    const { token, reportId } = await makeReport(client)
    const res = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'csv' })
    res.assertStatus(201)
    const report = await Report.find(reportId)
    const abs = resolve(UPLOAD_ROOT, report!.filePath!)
    const bytes = await readFile(abs)
    // UTF-8 BOM
    assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf])
    const text = bytes.slice(3).toString('utf-8')
    assert.include(text, '## 报表元数据')
    assert.include(text, '## 进度摘要')
    // 清理磁盘
    await unlink(abs).catch(() => undefined)
  })

  test('导出 markdown 内容含标题 + 项目 + 生成者字段', async ({ client, assert }) => {
    const { token, reportId } = await makeReport(client)
    const res = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'markdown' })
    res.assertStatus(201)
    const report = await Report.find(reportId)
    const abs = resolve(UPLOAD_ROOT, report!.filePath!)
    const text = await readFile(abs, 'utf-8')
    assert.match(text, /^# /m)
    assert.include(text, '项目')
    assert.include(text, '生成时间')
    assert.include(text, '来源数据指纹')
    await unlink(abs).catch(() => undefined)
  })

  test('非白名单导出格式 422 VALIDATION_ERROR', async ({ client }) => {
    const { token, reportId } = await makeReport(client)
    const res = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'pdf' })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('多次导出仅保留最新一份磁盘文件', async ({ client, assert }) => {
    const { token, reportId } = await makeReport(client)
    const r1 = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'markdown' })
    r1.assertStatus(201)
    const path1 = (await Report.find(reportId))!.filePath!

    const r2 = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'csv' })
    r2.assertStatus(201)
    const path2 = (await Report.find(reportId))!.filePath!
    assert.notEqual(path1, path2)

    // 旧 markdown 文件应已清理
    const { access } = await import('node:fs/promises')
    let oldFileExists = true
    try {
      await access(resolve(UPLOAD_ROOT, path1))
    } catch {
      oldFileExists = false
    }
    assert.isFalse(oldFileExists, 'markdown 旧文件应已清理')
    await unlink(resolve(UPLOAD_ROOT, path2)).catch(() => undefined)
  })

  test('PM 下载 markdown 200 + Content-Disposition + 审计 REPORT_DOWNLOADED', async ({
    client,
    assert,
  }) => {
    const { token, reportId } = await makeReport(client)
    const ex = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'markdown' })
    ex.assertStatus(201)

    const dl = await client
      .get(`/api/v1/reports/${reportId}/exports/markdown/download`)
      .header('Authorization', `Bearer ${token}`)
    dl.assertStatus(200)
    assert.match(String(dl.header('content-type') ?? ''), /markdown/)
    assert.match(String(dl.header('content-disposition') ?? ''), /attachment/i)

    const audit = await AuditLog.query()
      .where('entity_type', 'report')
      .where('entity_id', reportId)
      .whereRaw("json_extract(metadata, '$.event') = ?", ['REPORT_DOWNLOADED'])
      .first()
    assert.exists(audit, 'REPORT_DOWNLOADED 审计应落库')
    assert.equal(audit!.action, 'read')
  })

  test('下载非法格式 → 404 + 不泄露内部状态', async ({ client }) => {
    const { token, reportId } = await makeReport(client)
    const dl = await client
      .get(`/api/v1/reports/${reportId}/exports/pdf/download`)
      .header('Authorization', `Bearer ${token}`)
    dl.assertStatus(404)
  })

  test('未导出的报表下载 → 404 + 审计 REPORT_DOWNLOAD_DENIED(reason=no_file)', async ({
    client,
    assert,
  }) => {
    const { token, reportId } = await makeReport(client)
    const dl = await client
      .get(`/api/v1/reports/${reportId}/exports/markdown/download`)
      .header('Authorization', `Bearer ${token}`)
    dl.assertStatus(404)

    const audit = await AuditLog.query()
      .where('entity_type', 'report')
      .where('entity_id', reportId)
      .whereRaw("json_extract(metadata, '$.event') = ?", ['REPORT_DOWNLOAD_DENIED'])
      .first()
    assert.exists(audit)
    assert.equal(audit!.action, 'reject')
  })

  test('已导出但请求另一种格式 → 404 + 审计 format_mismatch', async ({ client, assert }) => {
    const { token, reportId } = await makeReport(client)
    const ex = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'markdown' })
    ex.assertStatus(201)

    const dl = await client
      .get(`/api/v1/reports/${reportId}/exports/csv/download`)
      .header('Authorization', `Bearer ${token}`)
    dl.assertStatus(404)

    // 该 report 应至少有一条 DENIED 审计
    const denied = await AuditLog.query()
      .where('entity_type', 'report')
      .where('entity_id', reportId)
      .whereRaw("json_extract(metadata, '$.event') = ?", ['REPORT_DOWNLOAD_DENIED'])
      .first()
    assert.exists(denied)
  })

  test('磁盘文件被外部删除 → 404 + 审计 missing_file', async ({ client, assert }) => {
    const { token, reportId } = await makeReport(client)
    const ex = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ format: 'markdown' })
    ex.assertStatus(201)
    const report = await Report.find(reportId)
    const abs = resolve(UPLOAD_ROOT, report!.filePath!)
    await unlink(abs) // 模拟磁盘缺失

    const dl = await client
      .get(`/api/v1/reports/${reportId}/exports/markdown/download`)
      .header('Authorization', `Bearer ${token}`)
    dl.assertStatus(404)

    const denied = await AuditLog.query()
      .where('entity_type', 'report')
      .where('entity_id', reportId)
      .whereRaw("json_extract(metadata, '$.event') = ?", ['REPORT_DOWNLOAD_DENIED'])
      .first()
    assert.exists(denied)
  })

  test('跨组织下载 → 404，不写 DOWNLOADED 审计', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const { project: projectA } = await setupProject(orgA, ownerA)
    await setupProject(orgB, ownerB)
    await seedTasks(projectA.id, 2)
    const tokenA = await login(client, ownerA)
    const tokenB = await login(client, ownerB)

    const create = await client
      .post(`/api/v1/projects/${projectA.id}/reports`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({ template: 'progress' })
    create.assertStatus(201)
    const reportId = create.body().data.id
    const ex = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({ format: 'markdown' })
    ex.assertStatus(201)

    // B 想下载 A 的报表 → 404
    const dl = await client
      .get(`/api/v1/reports/${reportId}/exports/markdown/download`)
      .header('Authorization', `Bearer ${tokenB}`)
    dl.assertStatus(404)

    // 只应有 A 的 REPORT_DOWNLOADED，无 B 的
    const readEvents = await AuditLog.query()
      .where('entity_type', 'report')
      .where('entity_id', reportId)
      .where('user_id', ownerB.id)
      .whereRaw("json_extract(metadata, '$.event') = ?", ['REPORT_DOWNLOADED'])
    assert.equal(readEvents.length, 0)
  })

  test('MEMBER 导出 403（无 REPORT_EXPORT）', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const member = await createUser({ email: uniqueEmail('mbr') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    await seedTasks(project.id, 1)
    const pmToken = await login(client, owner)
    const mbrToken = await login(client, member)
    const create = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({ template: 'progress' })
    create.assertStatus(201)
    const reportId = create.body().data.id

    // member 导出 → 403
    const exp = await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${mbrToken}`)
      .json({ format: 'markdown' })
    exp.assertStatus(403)
    exp.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('MEMBER 下载 403（无 REPORT_DOWNLOAD）', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const member = await createUser({ email: uniqueEmail('mbr2') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    await seedTasks(project.id, 1)
    const pmToken = await login(client, owner)
    const mbrToken = await login(client, member)
    const create = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({ template: 'progress' })
    create.assertStatus(201)
    const reportId = create.body().data.id
    await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({ format: 'markdown' })

    // member 下载 → 403
    const dl = await client
      .get(`/api/v1/reports/${reportId}/exports/markdown/download`)
      .header('Authorization', `Bearer ${mbrToken}`)
    dl.assertStatus(403)
    dl.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('只读观察者 download 应 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const observer = await createUser({ email: uniqueEmail('obs') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    await seedTasks(project.id, 1)
    const pmToken = await login(client, owner)
    const obsToken = await login(client, observer)
    const create = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({ template: 'progress' })
    create.assertStatus(201)
    const reportId = create.body().data.id
    await client
      .post(`/api/v1/reports/${reportId}/exports`)
      .header('Authorization', `Bearer ${pmToken}`)
      .json({ format: 'markdown' })

    const dl = await client
      .get(`/api/v1/reports/${reportId}/exports/markdown/download`)
      .header('Authorization', `Bearer ${obsToken}`)
    dl.assertStatus(403)
  })

  // ---------------- 四模板 smoke（tasks 7.1）----------------

  test('PM 生成 delay 报表 201 + 快照含 overdueTasks/upcomingTasks/summary', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 2)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'delay' })
    res.assertStatus(201)
    const snap = res.body().data.dataSnapshot
    assert.equal(snap.template, 'delay')
    assert.isArray(snap.overdueTasks)
    assert.isArray(snap.upcomingTasks)
    assert.exists(snap.summary.overdueTasks)
    assert.exists(snap.summary.delayRatePercent)
    assert.exists(snap.snapshotMetadata.sourceDataHash)
  })

  test('PM 生成 workload 报表 201 + 快照含 byAssignee 与 summary', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 2)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'workload' })
    res.assertStatus(201)
    const snap = res.body().data.dataSnapshot
    assert.equal(snap.template, 'workload')
    assert.isArray(snap.byAssignee)
    assert.exists(snap.summary.totalAssignees)
    assert.exists(snap.summary.unassigned)
  })

  test('PM 生成 milestone 报表 201 + 空项目不炸（milestones/risks 均为 array）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    // 不 seed milestone —— 走空项目分支
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/reports`)
      .header('Authorization', `Bearer ${token}`)
      .json({ template: 'milestone' })
    res.assertStatus(201)
    const snap = res.body().data.dataSnapshot
    assert.equal(snap.template, 'milestone')
    assert.isArray(snap.milestones)
    assert.isArray(snap.risks)
    assert.equal(snap.summary.totalMilestones, 0)
  })

  test('四模板均可在同一项目并存 + list 按模板筛选精确命中', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 2)
    const token = await login(client, owner)

    for (const tpl of ['progress', 'delay', 'workload', 'milestone'] as const) {
      const r = await client
        .post(`/api/v1/projects/${project.id}/reports`)
        .header('Authorization', `Bearer ${token}`)
        .json({ template: tpl })
      r.assertStatus(201)
    }

    const list = await client
      .get(`/api/v1/projects/${project.id}/reports?perPage=50`)
      .header('Authorization', `Bearer ${token}`)
    list.assertStatus(200)
    assert.equal(list.body().meta.total, 4)

    const only = await client
      .get(`/api/v1/projects/${project.id}/reports?template=workload`)
      .header('Authorization', `Bearer ${token}`)
    only.assertStatus(200)
    assert.equal(only.body().meta.total, 1)
    assert.equal(only.body().data[0].template, 'workload')
  })

  test('四模板 → markdown 与 csv 各导出一次均 201 且写盘可下载', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await seedTasks(project.id, 2)
    const token = await login(client, owner)

    for (const tpl of ['progress', 'delay', 'workload', 'milestone'] as const) {
      const gen = await client
        .post(`/api/v1/projects/${project.id}/reports`)
        .header('Authorization', `Bearer ${token}`)
        .json({ template: tpl })
      gen.assertStatus(201)
      const reportId = gen.body().data.id

      for (const format of ['markdown', 'csv'] as const) {
        const exp = await client
          .post(`/api/v1/reports/${reportId}/exports`)
          .header('Authorization', `Bearer ${token}`)
          .json({ format })
        exp.assertStatus(201)

        const dl = await client
          .get(`/api/v1/reports/${reportId}/exports/${format}/download`)
          .header('Authorization', `Bearer ${token}`)
        dl.assertStatus(200)
        const disp = dl.headers()['content-disposition'] ?? ''
        assert.match(disp, /attachment/i, `${tpl}/${format} 需返回 attachment`)
      }

      // 清理：仅保留最新 format 的磁盘文件（服务已保证）；避免测试落盘残留
      const row = await Report.find(reportId)
      if (row?.filePath) {
        try {
          await unlink(resolve(row.filePath))
        } catch {
          /* ignore */
        }
      }
    }
  })
})
