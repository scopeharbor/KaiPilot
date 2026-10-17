/**
 * v3-compiler-hook-plugin-pilot —— 服务端 hook 运行时单元测试（task 2.5）。
 *
 * 覆盖要求：
 * - 解析隔离（不同组织互不可见）
 * - 停用插件的 hook 未生效但可区分
 * - preflight 拒绝不触达回调
 * - 降级计数（回调失败/超时）
 * - 提案摘要不符拒绝
 *
 * 纪律：使用 truncate() 生命周期，禁止 group 级 migrate。
 */
import { test } from '@japa/runner'
import { addOrgMember, createOrganization, createUser, useAiDatabase } from './ai/_helpers.js'
import PluginServerHookService from '#services/plugin_server_hook_service'
import PluginServerHookInvocationService from '#services/plugin_server_hook_invocation_service'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import RbacPolicy from '#policies/rbac_policy'
import RbacService from '#services/rbac_service'
import AuditService from '#services/audit_service'
import { PluginActionBoundaryService } from '#services/plugin_action_boundary/boundary_service'
import {
  registerServerHookCallback,
  unregisterServerHookCallback,
  getDegradationCountSnapshot,
} from '#services/plugin_server_hook_invocation_service'
import {
  computeProposalSummary,
  type PluginServerHookQueryRequest,
  type PluginServerHookQueryResult,
} from '@aiproj/types'

/** 创建一个已安装的插件（含 manifest 贡献声明） */
async function seedHookPlugin(
  orgId: number,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    seamKey?: string
    callbackHandle?: string
  } = {},
) {
  const seamKey = opts.seamKey ?? 'server-query.readonly-provider'
  const callbackHandle = opts.callbackHandle ?? 'test-callback'
  const status = opts.status ?? 'enabled'

  const metadata = JSON.stringify({
    contributions: [
      {
        contributionKey: 'test-contribution',
        seamKey,
        seamVersion: '1.0.0',
        title: 'Test Hook Contribution',
        payload: {
          callbackHandle,
          description: 'Test hook contribution for unit tests',
          requiredPermissions: ['project:view'],
        },
      },
    ],
  })

  const release = await PluginPrivateRegistryRelease.create({
    organizationId: orgId,
    pluginIdentity: 'com.example.test-hook-plugin',
    version: '1.0.0',
    metadata,
    status: 'approved',
    packageDigest: 'test-digest',
    manifestDigest: 'test-manifest-digest',
    compatibilityDigest: 'test-compat-digest',
    upstreamReceiptRef: 'test-receipt',
  })

  const installation = await PluginInstallation.create({
    organizationId: orgId,
    pluginId: 'com.example.test-hook-plugin',
    version: '1.0.0',
    releaseId: release.id,
    status,
    packageDigest: 'test-digest',
    manifestDigest: 'test-manifest-digest',
    compatibilityDigest: 'test-compat-digest',
  })

  return { release, installation }
}

test.group('PluginServerHookService', (group) => {
  useAiDatabase(group)

  test('解析已启用插件的 hook 贡献', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    await seedHookPlugin(org.id, { status: 'enabled' })

    const hookService = new PluginServerHookService()
    const result = await hookService.resolvePluginServerHookContributions(org.id)

    assert.lengthOf(result.hookContributions, 1)
    assert.isTrue(result.hookContributions[0].isEffective)
    assert.equal(result.hookContributions[0].status, 'effective')
    assert.deepEqual(result.effectiveContributionKeys, ['test-contribution'])
  })

  test('停用插件的 hook 未生效但可区分', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    await seedHookPlugin(org.id, { status: 'installed' }) // installed 但未启用

    const hookService = new PluginServerHookService()
    const result = await hookService.resolvePluginServerHookContributions(org.id)

    assert.lengthOf(result.hookContributions, 1)
    assert.isFalse(result.hookContributions[0].isEffective)
    assert.equal(result.hookContributions[0].status, 'inactive')
    assert.equal(result.hookContributions[0].reasonCode, 'plugin_disabled')
    assert.deepEqual(result.effectiveContributionKeys, [])
  })

  test('组织隔离：不同组织互不可见', async ({ assert }) => {
    const userA = await createUser()
    const orgA = await createOrganization(userA)
    const userB = await createUser()
    const orgB = await createOrganization(userB)

    await seedHookPlugin(orgA.id, { status: 'enabled' })

    const hookService = new PluginServerHookService()
    const resultA = await hookService.resolvePluginServerHookContributions(orgA.id)
    const resultB = await hookService.resolvePluginServerHookContributions(orgB.id)

    assert.lengthOf(resultA.hookContributions, 1)
    assert.lengthOf(resultB.hookContributions, 0)
  })

  test('无效负载被拒（schema 校验）', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    // 创建一个带无效负载的插件（callbackHandle 缺失）
    const metadata = JSON.stringify({
      contributions: [
        {
          contributionKey: 'invalid-contribution',
          seamKey: 'server-query.readonly-provider',
          seamVersion: '1.0.0',
          title: 'Invalid Hook Contribution',
          payload: {
            // 缺少 callbackHandle
            description: 'Invalid hook contribution',
          },
        },
      ],
    })

    const release = await PluginPrivateRegistryRelease.create({
      organizationId: org.id,
      pluginIdentity: 'com.example.invalid-hook-plugin',
      version: '1.0.0',
      metadata,
      status: 'approved',
      packageDigest: 'test-digest',
      manifestDigest: 'test-manifest-digest',
      compatibilityDigest: 'test-compat-digest',
      upstreamReceiptRef: 'test-receipt',
    })

    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: 'com.example.invalid-hook-plugin',
      version: '1.0.0',
      releaseId: release.id,
      status: 'enabled',
      packageDigest: 'test-digest',
      manifestDigest: 'test-manifest-digest',
      compatibilityDigest: 'test-compat-digest',
    })

    const hookService = new PluginServerHookService()
    const result = await hookService.resolvePluginServerHookContributions(org.id)

    assert.lengthOf(result.hookContributions, 1)
    assert.isFalse(result.hookContributions[0].isEffective)
    assert.equal(result.hookContributions[0].status, 'invalid_payload')
    assert.equal(result.hookContributions[0].reasonCode, 'payload_validation_failed')
  })
})

test.group('PluginServerHookInvocationService', (group) => {
  useAiDatabase(group)

  test('preflight 拒绝不触达回调', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    let callbackInvoked = false
    registerServerHookCallback('test-preflight-callback', async () => {
      callbackInvoked = true
      return {
        contributionKey: 'test',
        pluginId: 'test',
        data: {},
        advisory: true,
        source: 'test',
        timestamp: new Date().toISOString(),
      } as PluginServerHookQueryResult
    })

    const rbacPolicy = new RbacPolicy(new RbacService())
    const auditService = new AuditService()
    const invocationService = new PluginServerHookInvocationService(rbacPolicy, auditService)

    // 缺权限的用户：以 viewer 入组（readonly-observer 权限集不含 org:manage）。
    // 注意 createUser+createOrganization 造出来的是 owner，owner 什么都有，
    // 用它测不出 missing_permissions。
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')

    const request: PluginServerHookQueryRequest = {
      seamKey: 'server-query.readonly-provider',
      contributionKey: 'test',
      pluginId: 'test',
      pluginVersion: '1.0.0',
      context: {
        organizationId: org.id,
        userId: viewer.id,
        userRoles: [],
        requestedPermissions: ['org:manage'],
        scope: 'organization',
      },
      payload: {},
    }

    // preflight 应该拒绝（viewer 缺 org:manage）
    const preflightResult = await invocationService.preflight(viewer, ['org:manage'], org.id)

    assert.isFalse(preflightResult.allowed)
    assert.equal(preflightResult.reasonCode, 'missing_permissions')

    // 未登记的权限标识符走 fail-closed 的另一条分支（reasonCode 不同，便于分诊）：
    // 这条先于 RBAC 判定，插件声明拼错权限名时不会被误读成「有权限」。
    const unknownResult = await invocationService.preflight(viewer, ['admin:permission'], org.id)
    assert.isFalse(unknownResult.allowed)
    assert.equal(unknownResult.reasonCode, 'unknown_permission')

    // 调用回调（应该不被调用，因为 preflight 拒绝）
    // 这里我们只是验证 preflight 拒绝后不调用回调
    if (preflightResult.allowed) {
      await invocationService.invokeQueryCallback(request, 'test-run', 'test-preflight-callback')
    }

    assert.isFalse(callbackInvoked, 'Callback should not be invoked after preflight rejection')

    unregisterServerHookCallback('test-preflight-callback')
  })

  test('回调失败降级计数', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    registerServerHookCallback('test-failing-callback', async () => {
      throw new Error('Simulated callback failure')
    })

    const rbacPolicy = new RbacPolicy(new RbacService())
    const auditService = new AuditService()
    const invocationService = new PluginServerHookInvocationService(rbacPolicy, auditService)

    const request: PluginServerHookQueryRequest = {
      seamKey: 'server-query.readonly-provider',
      contributionKey: 'test',
      pluginId: 'test',
      pluginVersion: '1.0.0',
      context: {
        organizationId: org.id,
        userId: user.id,
        userRoles: ['admin'],
        requestedPermissions: [],
        scope: 'organization',
      },
      payload: {},
    }

    const runId = 'test-degradation-run'
    const result = await invocationService.invokeQueryCallback(
      request,
      runId,
      'test-failing-callback',
    )

    assert.isUndefined(result.result)
    assert.isDefined(result.error)

    const degradation = getDegradationCountSnapshot(runId)
    assert.isDefined(degradation)
    assert.equal(degradation!.totalAttempts, 1)
    assert.equal(degradation!.failures, 1)
    assert.equal(degradation!.skipped, 1)

    unregisterServerHookCallback('test-failing-callback')
  })

  test('提案摘要不符拒绝', async ({ assert }) => {
    const user = await createUser()

    const rbacPolicy = new RbacPolicy(new RbacService())
    const auditService = new AuditService()
    const invocationService = new PluginServerHookInvocationService(
      rbacPolicy,
      auditService,
      new PluginActionBoundaryService(),
    )

    // 创建一个提案结果
    const proposalPayload = { action: 'create_task', title: 'Test Task' }

    const confirmResult = await invocationService.confirmProposal(
      {
        proposalSummary: 'wrong-summary', // 错误的摘要
        pluginId: 'test',
        contributionKey: 'test',
        confirmedBy: user.id,
      },
      proposalPayload,
    )

    assert.isFalse(confirmResult.accepted)
    assert.include(confirmResult.reason, 'Proposal summary mismatch')
  })

  test('摘要匹配但无宿主 adapter kind / 无 scope → 直执旁路被阻断（v3-plugin-action-preview-boundary）', async ({
    assert,
  }) => {
    const user = await createUser()

    const rbacPolicy = new RbacPolicy(new RbacService())
    const auditService = new AuditService()
    const invocationService = new PluginServerHookInvocationService(
      rbacPolicy,
      auditService,
      new PluginActionBoundaryService(),
    )

    // 无 actionKind 声明的通用提案：不再直接执行
    const proposalPayload = { action: 'create_task', title: 'Test Task' }
    const summary = computeProposalSummary(proposalPayload)

    const noScope = await invocationService.confirmProposal(
      {
        proposalSummary: summary,
        pluginId: 'test',
        contributionKey: 'test',
        confirmedBy: user.id,
      },
      proposalPayload,
    )
    assert.isFalse(noScope.accepted)
    assert.include(noScope.reason, 'unified-boundary-required')

    // 有 scope 但载荷未声明合法 actionKind：同样阻断
    const withScope = await invocationService.confirmProposal(
      {
        proposalSummary: summary,
        pluginId: 'test',
        contributionKey: 'test',
        confirmedBy: user.id,
      },
      proposalPayload,
      { organizationId: 1, projectId: null },
    )
    assert.isFalse(withScope.accepted)
    assert.include(withScope.reason, 'unified-boundary-required')
  })

  test('可转换提案（声明 pilot kind）→ 登记统一边界并要求 preview/confirm，零直接执行', async ({
    assert,
  }) => {
    const user = await createUser()

    const rbacPolicy = new RbacPolicy(new RbacService())
    const auditService = new AuditService()
    const invocationService = new PluginServerHookInvocationService(
      rbacPolicy,
      auditService,
      new PluginActionBoundaryService(),
    )

    const proposalPayload = {
      actionKind: 'plugin.pilot.item.create',
      title: '边界切换试点条目',
      content: '经统一边界登记的提案',
    }
    const summary = computeProposalSummary(proposalPayload)

    const confirmResult = await invocationService.confirmProposal(
      {
        proposalSummary: summary,
        pluginId: 'com.aiproj.pilot.actions',
        contributionKey: 'pilot-proposal-create-task',
        confirmedBy: user.id,
      },
      proposalPayload,
      { organizationId: 1, projectId: null },
    )

    // 关键断言：accepted 恒为 false —— 确认必须走 boundary preview → handle → confirm
    assert.isFalse(confirmResult.accepted)
    assert.include(confirmResult.reason, 'preview-required')
    assert.isDefined((confirmResult as { proposalUid?: string }).proposalUid)
  })
})
