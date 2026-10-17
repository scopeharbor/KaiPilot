// v3-multitenant-isolation-architecture §4.1/§4.3/§4.4 —— 资源级跨租户负例。
//
// 覆盖：
// - 派生聚合先 scope 后计算：审计 stats 的 byDay/byAction/bySeverity 不得计入他组织行
//   （回归 §4.1 修复：旧实现的 byDay 直接查 `audit_logs` 全表，构成跨租户计数侧信道）
// - 项目级适配端点的项目归属解析必须在租户 scope 内完成，他组织项目与不存在的项目
//   返回同一个 404，不得用状态码区分存在性（§4.3）
// - 被拒请求零写入副作用（§4.4）
//
// 注：测试客户端 loginAs 签发的 token organizationId=null（无租户上下文），
// 故用 TokenService 手工签发带组织 claim 的 access token 驱动 middleware 的租户分支。
import { test } from '@japa/runner'
import TokenService from '#services/token_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import {
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'
import Project from '#models/project'

test.group('Tenant isolation — 资源级派生值与引用（§4.1/§4.3/§4.4）', (group) => {
  useAuthDatabase(group)

  let tokenSvc: TokenService
  let auditSvc: AuditService
  let orgA: Awaited<ReturnType<typeof createOrganization>>
  let orgB: Awaited<ReturnType<typeof createOrganization>>
  let memberA: Awaited<ReturnType<typeof createUser>>
  let projectB: Project

  group.each.setup(async () => {
    tokenSvc = await app.container.make(TokenService)
    auditSvc = await app.container.make(AuditService)

    const ownerA = await createUser({ email: uniqueEmail('tir-owna') })
    orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('tir-ownb') })
    orgB = await createOrganization(ownerB)

    // orgA 管理员（非 owner、非 super admin → 租户一致性检查与 scope 均生效）。
    memberA = await createUser({ email: uniqueEmail('tir-mema') })
    await addOrgMember(orgA, memberA, 'admin')

    // orgB 的项目：orgA 的用户不得以任何方式确认它的存在。
    projectB = await Project.create({
      organizationId: orgB.id,
      name: '他组织项目',
      code: `PB${Date.now()}`,
      createdBy: ownerB.id,
    })
  })

  async function orgToken(userId: number, organizationId: number): Promise<string> {
    return tokenSvc.generateAccessToken({
      sub: userId,
      organizationId,
      roleVersion: 0,
      permissions: [],
    })
  }

  /** 给两个组织各写入若干条审计日志（同一天，便于 byDay 聚合断言）。 */
  async function seedAuditLogs(orgACount: number, orgBCount: number): Promise<void> {
    for (let i = 0; i < orgACount; i += 1) {
      await auditSvc.log({
        event: AuditEvent.USER_CREATED,
        userId: memberA.id,
        organizationId: Number(orgA.id),
        severity: 'info',
      })
    }
    for (let i = 0; i < orgBCount; i += 1) {
      await auditSvc.log({
        event: AuditEvent.USER_UPDATED,
        userId: memberA.id,
        organizationId: Number(orgB.id),
        severity: 'warning',
      })
    }
  }

  test('审计 stats 的 byDay 只统计当前组织（跨租户计数不得泄漏）', async ({ client, assert }) => {
    await seedAuditLogs(2, 5)

    const token = await orgToken(memberA.id, Number(orgA.id))
    const res = await client
      .get('/api/v1/audit-logs/stats')
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const data = res.body().data as {
      byDay: Array<{ date: string; count: number }>
      byAction: Record<string, number>
      bySeverity: Record<string, number>
    }

    const byDayTotal = data.byDay.reduce((sum, row) => sum + Number(row.count), 0)
    const scopedTotal = await db
      .from('audit_logs')
      .where('organization_id', Number(orgA.id))
      .count('* as total')
    const globalTotal = await db.from('audit_logs').count('* as total')

    assert.isAbove(
      Number(globalTotal[0].total),
      Number(scopedTotal[0].total),
      '前置条件：他组织必须已有审计行，否则该用例无法证伪',
    )
    assert.equal(
      byDayTotal,
      Number(scopedTotal[0].total),
      'byDay 合计必须等于当前组织行数，不得计入他组织',
    )
  })

  test('审计 stats 的 byAction/bySeverity 不含他组织专属取值', async ({ client, assert }) => {
    await seedAuditLogs(2, 5)

    const token = await orgToken(memberA.id, Number(orgA.id))
    const res = await client
      .get('/api/v1/audit-logs/stats')
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const data = res.body().data as {
      byAction: Record<string, number>
      bySeverity: Record<string, number>
    }

    // orgB 的行全部是 warning 级；orgA 的行全部是 info 级。
    assert.isUndefined(data.bySeverity.warning, 'bySeverity 不得出现他组织专属的 warning 计数')
    assert.equal(Number(data.bySeverity.info ?? 0), 2, 'info 计数应只含当前组织的 2 行')
  })

  test('项目详情：他组织项目与不存在项目返回同一个 404（无存在性侧信道）', async ({
    client,
    assert,
  }) => {
    const token = await orgToken(memberA.id, Number(orgA.id))

    const crossTenant = await client
      .get(`/api/v1/projects/${projectB.id}`)
      .header('Authorization', `Bearer ${token}`)

    const missing = await client
      .get('/api/v1/projects/99999999')
      .header('Authorization', `Bearer ${token}`)

    crossTenant.assertStatus(404)
    missing.assertStatus(404)
    assert.deepEqual(
      crossTenant.body(),
      missing.body(),
      '他组织项目与不存在项目的响应体必须完全一致，否则可据此判定目标存在',
    )
    assert.isFalse(
      JSON.stringify(crossTenant.body()).includes('他组织项目'),
      '404 响应不得泄露他组织项目名称',
    )
  })

  test('跨租户读取被拒后不产生任何写入副作用', async ({ client, assert }) => {
    const token = await orgToken(memberA.id, Number(orgA.id))
    const before = await db.from('audit_logs').count('* as total')

    await client
      .get(`/api/v1/projects/${projectB.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)

    const rows = await db.from('tasks').where('project_id', projectB.id).count('* as total')
    assert.equal(Number(rows[0].total), 0, '被拒的跨租户请求不得在他组织项目下写入任务')

    // 允许写入拒绝审计（低敏），但不得写入业务行。
    const after = await db.from('audit_logs').count('* as total')
    assert.isAtLeast(Number(after[0].total), Number(before[0].total))
  })
})
