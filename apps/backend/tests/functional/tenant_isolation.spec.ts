// v3-multitenant-isolation-architecture §3.6/3.7 —— tenant_middleware API 级测试。
// 覆盖：body organizationId mismatch 统一 404 且零写入副作用；body 与服务端一致时正常放行；
// 路由参数 organizationId 不一致统一 404；前端伪造权限/scope 声明（isSuperAdmin/scopeMode）
// 被忽略——服务端以 DB 记录为准。
//
// 注：测试客户端 loginAs 签发的 token organizationId=null（无租户上下文），
// 故此处用 TokenService 手工签发带组织 claim 的 access token，驱动 middleware 的租户分支。
import { test } from '@japa/runner'
import TokenService from '#services/token_service'
import TenantScopeRegistry from '#services/tenant_scope_registry'
import { CanonicalRole, ROLE_PERMISSIONS, ProjectRoleName } from '#rbac'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

function tableFor(resourceType: string): string {
  const tables: Record<string, string> = {
    organization: 'organizations',
    project: 'projects',
    task: 'tasks',
    wbs: 'wbs_nodes',
    member: 'project_members',
    file: 'attachments',
    report: 'reports',
    audit: 'audit_logs',
    ai_draft: 'ai_project_drafts',
    compiler_run: 'compiler_runs',
    compiler_artifact: 'compiler_artifacts',
    kms_ledger: 'kms_events',
    dlp_ledger: 'dlp_events',
    watermark_ledger: 'watermark_events',
    compliance_evidence: 'compliance_evidence_packages',
    source_attribution: 'source_attributions',
    knowledge_item: 'knowledge_items',
    // v3-sso-saml2 §2.5：新增资源类型必须同步补这里，否则本 spec 的字段漂移防护
    // 会以「未配置租户资源表名映射」直接抛错（这正是它该做的事）。
    sso_saml_provider: 'sso_saml_providers',
    sso_saml_login_attempt: 'sso_saml_login_attempts',
    sso_saml_identity: 'sso_saml_identities',
    // v3-sso-oidc §2.5：新增资源类型必须同步补这里（字段漂移防护）。
    sso_oidc_provider: 'sso_oidc_providers',
    sso_oidc_login_attempt: 'sso_oidc_login_attempts',
    sso_oidc_identity: 'sso_oidc_identities',
    // v3-scim-provisioning §3.5：新增资源类型必须同步补这里（字段漂移防护）。
    scim_provider: 'scim_providers',
    scim_token: 'scim_tokens',
    scim_user_link: 'scim_user_links',
    scim_group_link: 'scim_group_links',
    scim_group_membership: 'scim_group_memberships',
    scim_sync_event: 'scim_sync_events',
    // v3-scim-attribute-mapping §3.4：映射 profile 快照（字段漂移防护）。
    scim_profile_snapshot: 'scim_profile_snapshots',
    // v3-plugin-private-registry-lifecycle：插件目录租户数据（字段漂移防护）。
    // 注意真实表名带 private_ 段：plugin_private_registry_*。
    plugin_registry_entry: 'plugin_private_registry_entries',
    plugin_registry_release: 'plugin_private_registry_releases',
    plugin_registry_review: 'plugin_private_registry_reviews',
    plugin_registry_operation: 'plugin_private_registry_operations',
  }
  const table = tables[resourceType]
  if (!table) {
    throw new Error(`未配置租户资源表名映射: ${resourceType}`)
  }
  return table
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return db.connection().schema.hasColumn(table, column)
}

test.group('Tenant isolation — middleware/API（§3.6/3.7）', (group) => {
  useAuthDatabase(group)

  let tokenSvc: TokenService
  let orgA: Awaited<ReturnType<typeof createOrganization>>
  let orgB: Awaited<ReturnType<typeof createOrganization>>
  let memberA: Awaited<ReturnType<typeof createUser>>
  let projectA: { id: number }

  group.each.setup(async () => {
    tokenSvc = await app.container.make(TokenService)

    const ownerA = await createUser({ email: uniqueEmail('tiso-owna') })
    orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('tiso-ownb') })
    orgB = await createOrganization(ownerB)

    // orgA 管理员（非 owner、非 super admin → 一致性检查生效；同时满足 risk:manage）。
    memberA = await createUser({ email: uniqueEmail('tiso-mema') })
    await addOrgMember(orgA, memberA, 'admin')

    // memberA 同时是 orgA 项目 P0 的 PM，具备 risk:manage（供写入正例）。
    const created = await createProjectWithMember(
      orgA,
      ownerA,
      memberA,
      ProjectRoleName.PROJECT_MANAGER,
      [...ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER]],
    )
    projectA = { id: Number(created.project.id) }
  })

  /** 签发携带组织 claim 的 access token（模拟已登录组织成员）。 */
  async function orgToken(userId: number, organizationId: number): Promise<string> {
    return tokenSvc.generateAccessToken({
      sub: userId,
      organizationId,
      roleVersion: 0,
      permissions: [],
    })
  }

  test('body organizationId mismatch → 404 RESOURCE_NOT_FOUND 且零写入', async ({
    client,
    assert,
  }) => {
    const token = await orgToken(memberA.id, Number(orgA.id))
    const before = await db.from('risks').count('* as total')
    const totalBefore = Number(before[0].total)

    const res = await client
      .post(`/api/v1/projects/${projectA.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        organizationId: Number(orgB.id),
        title: '跨组织写入尝试',
        description: 'body 声称属于组织 B，服务端应按租户上下文拒绝',
      })

    res.assertStatus(404)
    assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')

    const after = await db.from('risks').count('* as total')
    assert.equal(Number(after[0].total), totalBefore, '被拒请求不得产生任何写入副作用')
  })

  test('body organizationId 与服务端一致 → 正常放行并写入', async ({ client, assert }) => {
    const token = await orgToken(memberA.id, Number(orgA.id))
    const res = await client
      .post(`/api/v1/projects/${projectA.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        organizationId: Number(orgA.id),
        title: '同组织风险',
        description: 'body 声明与租户上下文一致，允许写入',
      })

    res.assertStatus(201)
    const row = await db.from('risks').where('title', '同组织风险').first()
    assert.exists(row, '同组织请求应完成写入')
  })

  test('路由参数 organizationId mismatch → 统一 404（非泄露）', async ({ client, assert }) => {
    const token = await orgToken(memberA.id, Number(orgA.id))
    const res = await client
      .get(`/api/v1/organizations/${Number(orgB.id)}/resource-pool/summary`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(404)
    assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')
    assert.isFalse(
      JSON.stringify(res.body()).includes(String(orgB.id)),
      '404 响应不得泄露目标组织相关细节',
    )
  })

  test('registry 声明列与真实 DB 列一致（字段漂移防护，含手写模型兜底）', async ({ assert }) => {
    for (const decl of TenantScopeRegistry.all()) {
      if (decl.registryStatus !== 'registered') continue
      const table = tableFor(decl.resourceType)
      if (decl.organizationField) {
        assert.isTrue(
          await hasColumn(table, decl.organizationField),
          `${decl.resourceType}(${table}): 声明的组织列 ${decl.organizationField} 应存在于真实表`,
        )
      } else {
        assert.equal(decl.parentResolver, 'project', `${decl.resourceType} 派生声明须 project 解析`)
        assert.isTrue(
          await hasColumn(table, decl.projectField!),
          `${decl.resourceType}(${table}): 声明的项目列 ${decl.projectField} 应存在于真实表`,
        )
      }
    }
  })

  test('前端伪造权限/scope 声明被忽略：body 声称超管 + 他租组织仍 404', async ({
    client,
    assert,
  }) => {
    const token = await orgToken(memberA.id, Number(orgA.id))
    const res = await client
      .post(`/api/v1/projects/${projectA.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        organizationId: Number(orgB.id),
        isSuperAdmin: true,
        scopeMode: 'system_global',
        permissions: ['risk:manage', 'org:manage'],
        title: '伪造超管跨组织写入',
        description: '声明不足为凭，服务端以 DB 记录判定',
      })

    res.assertStatus(404)
    assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')
    const row = await db.from('risks').where('title', '伪造超管跨组织写入').first()
    assert.isNull(row, '伪造声明不得产生写入')
  })
})
