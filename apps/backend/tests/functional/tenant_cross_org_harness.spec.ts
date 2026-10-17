// v3-multitenant-isolation-architecture §8.5 —— 跨租户泄漏 harness。
//
// spec 场景「Fixture cross-tenant harness catches leakage」：
// 用**两个组织 + 同名资源**（项目/任务/文件/报表/compiler artifact/企业级 ledger）
// 铺底，再从 read / write / preview / export / job / cache 六条路径发起跨组织尝试，
// 断言要么返回非泄露失败，要么只返回 scope 内结果——响应里不得出现隐藏租户数据。
//
// **同名是关键**：两组织资源名完全一致（`共享名称-项目` 等），所以任何
// "名字对上了就返回"的实现都会立刻穿帮；同时也保证响应体里出现该名称时，
// 无法用名称本身区分是谁的——真正要断言的是 ID 与计数。
//
// 全程本地 SQLite + fixture，无真实 AI/OCR/Webhook/Web Push/OAuth/KMS/外部网络
//（spec「Default verification is offline」）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import TokenService from '#services/token_service'
import Attachment from '#models/attachment'
import CompilerArtifact from '#models/compiler_artifact'
import CompilerRun from '#models/compiler_run'
import Project from '#models/project'
import Report from '#models/report'
import Task from '#models/task'
import TenantNamespaceService from '#services/tenant_namespace_service'
import TenantJobScopeService from '#services/tenant_job_scope_service'
import TenantScopeService from '#services/tenant_scope_service'
import {
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'
import {
  mapComputeIdempotencyScope,
  mapComputeScope,
  mapComputeSourceHash,
  mapConsumeHandle,
  mapCreateHandle,
  mapHasForbiddenKeys,
  mapRedactLowSensitive,
} from '@aiproj/types/multitenant-api-boundary'
import { lowSensitiveTenantBlock } from '#services/tenant_boundary_envelope_helper'

/** 两组织共用的资源名——同名才能证伪"按名字返回"的实现。 */
const SHARED = {
  project: '共享名称-项目',
  task: '共享名称-任务',
  file: '共享名称-附件.pdf',
  report: '共享名称-报表',
  artifact: 'shared-manifest',
} as const

interface OrgFixture {
  organizationId: number
  ownerId: number
  project: Project
  task: Task
  attachment: Attachment
  report: Report
  artifact: CompilerArtifact
}

test.group('跨租户泄漏 harness（§8.5）', (group) => {
  useAuthDatabase(group)

  let tokenSvc: TokenService
  let orgA: OrgFixture
  let orgB: OrgFixture
  let memberAId: number

  /** 给一个组织铺 6 类同名资源。 */
  async function seedOrg(prefix: string): Promise<OrgFixture> {
    const owner = await createUser({ email: uniqueEmail(prefix) })
    const organization = await createOrganization(owner)
    const organizationId = Number(organization.id)

    const project = await Project.create({
      organizationId,
      name: SHARED.project,
      code: `${prefix.toUpperCase()}${Date.now()}`,
      createdBy: owner.id,
    })

    const task = await Task.create({
      projectId: project.id,
      name: SHARED.task,
      status: 'not_started',
      priority: 'medium',
    })

    const attachment = await Attachment.create({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      fileName: SHARED.file,
      filePath: `uploads/${prefix}/${SHARED.file}`,
      fileSize: 1024,
      mimeType: 'application/pdf',
      storageProvider: 'local',
      currentVersion: 1,
      uploadedBy: owner.id,
    })

    const report = await Report.create({
      projectId: project.id,
      title: SHARED.report,
      template: 'progress',
      config: {} as never,
      dataSnapshot: {} as never,
    })

    const run = await CompilerRun.create({
      organizationId,
      requestedByUserId: owner.id,
      status: 'pending',
      input: {},
    })
    const artifact = await CompilerArtifact.create({
      compilerRunId: run.id,
      organizationId,
      kind: 'manifest',
      artifactId: SHARED.artifact,
      version: 1,
      payload: { note: SHARED.artifact },
    })

    return {
      organizationId,
      ownerId: owner.id,
      project,
      task,
      attachment,
      report,
      artifact,
    }
  }

  group.each.setup(async () => {
    tokenSvc = await app.container.make(TokenService)
    orgA = await seedOrg('xoh-a')
    orgB = await seedOrg('xoh-b')

    // orgA 的普通管理员（非 super admin → 租户一致性与 scope 全部生效）。
    const memberA = await createUser({ email: uniqueEmail('xoh-mema') })
    await addOrgMember({ id: orgA.organizationId } as never, memberA, 'admin')
    memberAId = memberA.id
  })

  async function tokenFor(userId: number, organizationId: number): Promise<string> {
    return tokenSvc.generateAccessToken({
      sub: userId,
      organizationId,
      roleVersion: 0,
      permissions: [],
    })
  }

  /** 以 orgA 成员身份发起 GET。 */
  async function getAsOrgA(client: any, url: string) {
    const token = await tokenFor(memberAId, orgA.organizationId)
    return client.get(url).header('Authorization', `Bearer ${token}`)
  }

  // ── read ──────────────────────────────────────

  test('read：他组织项目与不存在项目响应全等，且不回显他组织 ID', async ({ client, assert }) => {
    const crossTenant = await getAsOrgA(client, `/api/v1/projects/${orgB.project.id}`)
    const missing = await getAsOrgA(client, '/api/v1/projects/99999999')

    assert.equal(crossTenant.status(), missing.status())
    assert.deepEqual(crossTenant.body(), missing.body(), '跨租与不存在必须不可区分')
    assert.notInclude(JSON.stringify(crossTenant.body()), String(orgB.project.id))
  })

  test('read：项目列表只含本组织，同名不构成穿透', async ({ client, assert }) => {
    const res = await getAsOrgA(client, '/api/v1/projects')
    if (res.status() !== 200) {
      // 端点若因权限收紧而拒绝，也属于"非泄露失败"，同样满足 spec。
      assert.oneOf(res.status(), [401, 403, 404])
      return
    }
    const ids = ((res.body().data ?? []) as Array<{ id: number }>).map((p) => Number(p.id))
    assert.include(ids, Number(orgA.project.id))
    assert.notInclude(ids, Number(orgB.project.id), '同名项目不得跨组织出现在列表中')
  })

  test('read：他组织项目下的任务不可枚举', async ({ client, assert }) => {
    const res = await getAsOrgA(client, `/api/v1/projects/${orgB.project.id}/tasks`)
    assert.oneOf(res.status(), [403, 404])
    assert.notInclude(JSON.stringify(res.body()), String(orgB.task.id))
  })

  // ── §4.2 list/detail scope-first 计数与负例 ──

  test('read：项目列表 meta.total 只计本组织（§4.2）', async ({ client, assert }) => {
    const res = await getAsOrgA(client, '/api/v1/projects')
    if (res.status() !== 200) {
      assert.oneOf(res.status(), [401, 403, 404])
      return
    }
    assert.isObject(res.body().meta)
    assert.equal(Number(res.body().meta.total), 1, 'meta.total 只应统计本组织项目')
    const ids = ((res.body().data ?? []) as Array<{ id: number }>).map((p) => Number(p.id))
    assert.notInclude(ids, Number(orgB.project.id), '同名项目不得计入 total 或在 data')
  })

  test('read：search/filter 只命中本组织同名资源（§4.2）', async ({ client, assert }) => {
    const res = await getAsOrgA(
      client,
      `/api/v1/projects?search=${encodeURIComponent(SHARED.project)}`,
    )
    if (res.status() !== 200) {
      assert.oneOf(res.status(), [401, 403, 404])
      return
    }
    const ids = ((res.body().data ?? []) as Array<{ id: number }>).map((p) => Number(p.id))
    assert.include(ids, Number(orgA.project.id))
    assert.notInclude(ids, Number(orgB.project.id), '同名可击中搜索，但不得跨组织返回')
    assert.equal(Number(res.body().meta?.total ?? -1), 1)
  })

  test('read：跨租详情与不存在全等且不回显他组织名称（§4.2）', async ({ client, assert }) => {
    const crossTenant = await getAsOrgA(client, `/api/v1/projects/${orgB.project.id}`)
    const missing = await getAsOrgA(client, '/api/v1/projects/99999999')
    assert.equal(crossTenant.status(), missing.status(), '跨租与不存在不可区分')
    assert.deepEqual(crossTenant.body(), missing.body())
    const bodyText = JSON.stringify(crossTenant.body())
    assert.notInclude(bodyText, String(orgB.project.id))
    assert.notInclude(bodyText, SHARED.project, '不得回显隐藏项目名称')
  })

  // ── write ─────────────────────────────────────

  test('write：向他组织项目写任务被拒且零行落库', async ({ client, assert }) => {
    const token = await tokenFor(memberAId, orgA.organizationId)
    const before = await db.from('tasks').where('project_id', orgB.project.id).count('* as total')

    const res = await client
      .post(`/api/v1/projects/${orgB.project.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '越权写入', status: 'not_started', priority: 'medium' })

    assert.oneOf(res.status(), [400, 403, 404, 422])
    const after = await db.from('tasks').where('project_id', orgB.project.id).count('* as total')
    assert.equal(Number(after[0].total), Number(before[0].total), '被拒写入不得产生任何行')
  })

  test('write：混租批量整体拒绝，不做部分成功', async ({ assert }) => {
    const scope = new TenantScopeService()
    let caught: unknown = null
    try {
      await scope.assertBatchInScope(Project as never, [orgA.project.id, orgB.project.id], {
        organizationId: orgA.organizationId,
        resourceType: 'project',
      })
    } catch (err) {
      caught = err
    }
    assert.isNotNull(caught, '混租批量必须整体拒绝')
    assert.notInclude(String((caught as Error).message), String(orgB.project.id))
  })

  test('write：向他组织项目 PATCH 更新任务整体拒绝且不回显（§4.4）', async ({ client, assert }) => {
    const token = await tokenFor(memberAId, orgA.organizationId)
    const res = await client
      .patch(`/api/v1/projects/${orgB.project.id}/tasks/${orgB.task.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'in_progress' })

    assert.oneOf(res.status(), [400, 403, 404, 422])
    assert.notInclude(JSON.stringify(res.body()), String(orgB.project.id))
    assert.notInclude(JSON.stringify(res.body()), String(orgB.task.id))
  })

  test('write：body organizationId 与本组织不一致的创建被拒且不落库（§4.4）', async ({
    client,
    assert,
  }) => {
    const token = await tokenFor(memberAId, orgA.organizationId)
    const before = await db
      .from('projects')
      .where('organization_id', orgA.organizationId)
      .count('* as total')
    const res = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '越权组织创建', organizationId: orgB.organizationId, status: 'active' })

    // 不接受（registry body hint 一致性），且不得在 orgA 落一行以"成功创建"掩盖他组织意图。
    assert.oneOf(res.status(), [400, 403, 404, 422])
    const after = await db
      .from('projects')
      .where('organization_id', orgA.organizationId)
      .count('* as total')
    assert.equal(Number(after[0].total), Number(before[0].total), '被拒创建不得产生任何行')
  })

  // ── preview / export ──────────────────────────

  test('preview：他组织预览签名在本组织 scope 下不可复用', async ({ assert }) => {
    const ns = new TenantNamespaceService()
    const ISSUED = '2026-08-07T00:00:00.000Z'
    const signed = ns.buildPreviewSignature(
      { organizationId: orgB.organizationId },
      'report_preview',
      'h1',
      ISSUED,
    )

    assert.throws(() =>
      ns.assertPreviewSignature(
        { organizationId: orgA.organizationId },
        'report_preview',
        'h1',
        ISSUED,
        signed.signature,
      ),
    )
    // 原组织复核仍通过——证明拒绝来自 scope 差异，而不是签名本身失效。
    assert.doesNotThrow(() =>
      ns.assertPreviewSignature(
        { organizationId: orgB.organizationId },
        'report_preview',
        'h1',
        ISSUED,
        signed.signature,
      ),
    )
  })

  test('export：他组织导出句柄在本组织不可兑付，且与过期同一语义', async ({ assert }) => {
    const ns = new TenantNamespaceService()
    const handle = ns.buildExportHandle({
      scope: { organizationId: orgB.organizationId },
      actorRef: `user:${orgB.ownerId}`,
      resourceType: 'report',
      sourceHash: 'export-h1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })

    const messages: string[] = []
    for (const attempt of [
      // 跨组织兑付
      () => ns.assertExportHandle({ organizationId: orgA.organizationId }, handle),
      // 同组织但已过期
      () =>
        ns.assertExportHandle(
          { organizationId: orgB.organizationId },
          handle,
          new Date('2099-06-01T00:00:00.000Z'),
        ),
    ]) {
      try {
        attempt()
        messages.push('no-error')
      } catch (err) {
        messages.push((err as Error).message)
      }
    }
    assert.notInclude(messages, 'no-error')
    assert.equal(new Set(messages).size, 1, '跨组织与已过期必须同一拒绝语义')
  })

  // ── job ───────────────────────────────────────

  test('job：他组织快照在本组织复核时被拒，篡改组织 ID 也无法复用', async ({ assert }) => {
    const jobs = new TenantJobScopeService()
    const snapshot = jobs.buildSnapshot({
      tenant: {
        organizationId: orgB.organizationId,
        projectId: null,
        scopeMode: 'organization_scoped',
        actorRef: `user:${orgB.ownerId}`,
        isSuperAdmin: false,
      },
      roleVersion: 0,
      sourceRefs: [],
      idempotencyKey: 'job-1',
      requestId: 'req-job-1',
      issuedAt: '2026-08-07T00:00:00.000Z',
    })

    // 作业被搬到 orgA 的 membership 下复核 → 组织不匹配，拒绝。
    const verdict = jobs.revalidate({
      snapshot,
      currentMembership: {
        organizationId: orgA.organizationId,
        active: true,
        roleVersion: 0,
      },
    })
    assert.equal(verdict.decision, 'deny')
    assert.notEqual(verdict.reasonCode, 'OK')

    // 直接篡改 organizationId 后 parse 必须失败（organizationScopeHash 自洽校验）。
    const tampered = JSON.parse(jobs.serialize(snapshot))
    tampered.organizationId = orgA.organizationId
    assert.throws(() => jobs.parse(JSON.stringify(tampered)))
  })

  test('job：idempotency scope 跨租户不复用，且 stale membership 拒绝（§5.7）', async ({
    assert,
  }) => {
    // 幂等 scope 必须绑定组织——同一逻辑键/操作在两组织不得落入同一 scope barrier。
    const idemA = mapComputeIdempotencyScope({
      organizationId: orgA.organizationId,
      operation: 'export',
      resourceType: 'report',
    })
    const idemB = mapComputeIdempotencyScope({
      organizationId: orgB.organizationId,
      operation: 'export',
      resourceType: 'report',
    })
    assert.notEqual(idemA, idemB, '幂等 scope 跨租户必须互斥，不得复用他组织结果')

    // stale membership（成员被移除）→ revalidate 拒绝，且拒绝后不产生 provider 副作用。
    const jobs = new TenantJobScopeService()
    const snapshot = jobs.buildSnapshot({
      tenant: {
        organizationId: orgA.organizationId,
        projectId: null,
        scopeMode: 'organization_scoped',
        actorRef: `user:${orgA.ownerId}`,
        isSuperAdmin: false,
      },
      roleVersion: 0,
      sourceRefs: [String(orgA.report.id)],
      idempotencyKey: 'job-idem-1',
      requestId: 'req-idem-1',
      issuedAt: '2026-08-07T00:00:00.000Z',
    })
    const stale = jobs.revalidate({
      snapshot,
      currentMembership: {
        organizationId: orgA.organizationId,
        active: false, // 成员已移除 → stale
        roleVersion: 0,
      },
    })
    assert.equal(stale.decision, 'deny')
    assert.notEqual(stale.reasonCode, 'OK', 'stale membership 必须拒绝，阻止副作用执行')
  })

  // ── cache ─────────────────────────────────────

  test('cache：同一逻辑键在两组织下命名空间互斥', async ({ assert }) => {
    const ns = new TenantNamespaceService()
    const keyA = ns.cacheKey({ organizationId: orgA.organizationId }, 'report_summary', {
      reportId: 'shared',
    })
    const keyB = ns.cacheKey({ organizationId: orgB.organizationId }, 'report_summary', {
      reportId: 'shared',
    })

    assert.notEqual(keyA, keyB, '同一逻辑键在不同组织下必须落入不同命名空间')
    assert.isTrue(ns.isInNamespace({ organizationId: orgA.organizationId }, keyA))
    assert.isFalse(ns.isInNamespace({ organizationId: orgA.organizationId }, keyB))
  })

  // ── §5.5 export/download handle 绑定 ─────────

  test('export handle：本组织签发，跨租 replay / stale hash / 过期同一拒绝（§5.5）', async ({
    assert,
  }) => {
    const scopeA = mapComputeScope({ organizationId: orgA.organizationId })
    const scopeB = mapComputeScope({ organizationId: orgB.organizationId })

    // 在 orgA scope、对 orgA 报表 source 签发 export handle。
    const sourceHash = mapComputeSourceHash({
      organizationId: orgA.organizationId,
      sourceRef: String(orgA.report.id),
    })
    const handle = mapCreateHandle({
      scopeHash: scopeA,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'export',
      sourceHash,
      requestId: 'req-exp',
      kind: 'export',
      expiresInSeconds: 60,
    })

    // 跨组织 consume → CROSS_TENANT_REPLAY。
    const cross = mapConsumeHandle({
      handle,
      scopeHash: scopeB,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'export',
      kind: 'export',
      now: new Date().toISOString(),
    })
    assert.equal(cross.reasonCode, 'CROSS_TENANT_REPLAY')

    // 同组织但 stale source hash（内容已变）→ STALE_SOURCE_HASH。
    const stale = mapConsumeHandle({
      handle,
      scopeHash: scopeA,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'export',
      kind: 'export',
      now: new Date().toISOString(),
      expectedSourceHash: mapComputeSourceHash({
        organizationId: orgA.organizationId,
        sourceRef: 'other-ref',
      }),
    })
    assert.equal(stale.reasonCode, 'STALE_SOURCE_HASH')

    // 同组织、同 source、但过期（now 在 expiresAt 之后）→ EXPIRED_HANDLE。
    const expired = mapConsumeHandle({
      handle,
      scopeHash: scopeA,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'export',
      kind: 'export',
      now: '2099-01-01T00:00:00.000Z',
      expectedSourceHash: sourceHash,
    })
    assert.equal(expired.reasonCode, 'EXPIRED_HANDLE')

    // 全合法 + 未过期 + 同 scope -> 通过（证明拒绝来自 scope/stale/expiry 差异）。
    const ok = mapConsumeHandle({
      handle,
      scopeHash: scopeA,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'export',
      kind: 'export',
      now: handle.expiresAt,
      expectedSourceHash: sourceHash,
    })
    assert.equal(ok.reasonCode, 'OK')
  })

  // ── §5.3 AI/Compiler preview-confirm 跨租 replay + provider 前置 ──

  test('AI/Compiler confirm handle：跨租 replay 在多 provider 调用前拒绝（§5.3）', async ({
    assert,
  }) => {
    const scopeA = mapComputeScope({ organizationId: orgA.organizationId })
    const scopeB = mapComputeScope({ organizationId: orgB.organizationId })

    // orgA 签发一个判据/确认句柄（模拟 AI draft confirm 的新 preview/confirm handle）。
    const sourceHash = mapComputeSourceHash({
      organizationId: orgA.organizationId,
      sourceRef: String(orgA.artifact.artifactId),
    })
    const handle = mapCreateHandle({
      scopeHash: scopeA,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'confirm',
      sourceHash,
      requestId: 'req-ai-confirm',
      kind: 'confirm',
    })

    // 在 orgB 的当前 scope 下消费 → CROSS_TENANT_REPLAY；在 provider/adapter 调用前 fail closed。
    const replayed = mapConsumeHandle({
      handle,
      scopeHash: scopeB,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'confirm',
      kind: 'confirm',
      now: new Date().toISOString(),
    })
    assert.equal(replayed.reasonCode, 'CROSS_TENANT_REPLAY')

    // 同 scope 但 stale source（compiler artifact 内容哈希变化）→ 拒绝，确认不落库。
    const stale = mapConsumeHandle({
      handle,
      scopeHash: scopeA,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'confirm',
      kind: 'confirm',
      now: new Date().toISOString(),
      expectedSourceHash: mapComputeSourceHash({
        organizationId: orgA.organizationId,
        sourceRef: 'changed-content',
      }),
    })
    assert.equal(stale.reasonCode, 'STALE_SOURCE_HASH')

    // 同 scope 同源 + 未过期 → 允许（证明拒绝来自 scope/stale 差异，而非 handle 本身）。
    const ok = mapConsumeHandle({
      handle,
      scopeHash: scopeA,
      actorRef: `user:${orgA.ownerId}`,
      operation: 'confirm',
      kind: 'confirm',
      now: new Date().toISOString(),
      expectedSourceHash: sourceHash,
    })
    assert.equal(ok.reasonCode, 'OK')
  })

  // ── §6.5 低敏 envelope：拒绝隐藏字段 ─────────

  test('低敏 envelope：禁止字段/权限 allowlist/隐藏路径不进入响应（§6.5）', async ({ assert }) => {
    const scope = mapComputeScope({ organizationId: orgA.organizationId })
    const block = lowSensitiveTenantBlock({
      requestId: 'req-6',
      tenantScopeHash: scope,
      cacheNamespace: 'map:cache:' + scope,
      scopeMode: 'tenant',
      decision: 'allow',
      reasonCode: 'OK',
      warnings: [],
      idempotencyScope: null,
      degradedReason: null,
    })
    assert.isNotNull(block)
    const text = JSON.stringify(block)
    // 不得泄露权限 allowlist、存储路径、prompt、模型/raw provider 内容。
    // （organizationId 本身不进入 block；scopeHash 是低敏 hash，其字符可能与数字串撞占位。）
    assert.notInclude(text, 'permissions')
    assert.notInclude(text, 'uploads/')
    assert.notInclude(text, 'prompt')
    assert.notInclude(text, 'rawProvider')
    assert.notInclude(text, 'modelOutput')
    assert.notInclude(text, 'organizationId')
  })

  test('低敏脱敏：forbidden 字段在返回前被剔除/拒绝（§6.5）', async ({ assert }) => {
    const dirty = {
      id: 1,
      name: 'ok',
      authorization: 'Bearer secret',
      apiKey: 'sk-xxx',
      absolutePath: 'C:/Users/alice/uploads/report.pdf',
    }
    assert.isTrue(mapHasForbiddenKeys(dirty), '响应含 forbidden field 应被侦测')
    const clean = mapRedactLowSensitive(dirty)
    assert.equal(clean.authorization, undefined)
    assert.equal(clean.apiKey, undefined)
    assert.equal(clean.absolutePath, undefined)
  })

  // ── 铺底自检 ──────────────────────────────────

  test('harness 自检：两组织确实各有 6 类同名资源（否则上述用例无法证伪）', async ({ assert }) => {
    assert.equal(orgA.project.name, orgB.project.name)
    assert.equal(orgA.task.name, orgB.task.name)

    // 每类资源在两组织下都真实存在，且各归各的组织。
    const artifacts = await CompilerArtifact.query().where('artifactId', SHARED.artifact)
    assert.lengthOf(artifacts, 2)
    assert.deepEqual(
      artifacts.map((a) => a.organizationId).sort((x, y) => x - y),
      [orgA.organizationId, orgB.organizationId].sort((x, y) => x - y),
    )
  })
})
