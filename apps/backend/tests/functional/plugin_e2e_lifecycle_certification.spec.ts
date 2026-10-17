/**
 * v3-plugin-e2e-lifecycle-certification —— 插件端到端生命周期认证套件（W5c 任务 2.1~2.4）。
 *
 * 认证对象：官方 canary 包（com.aiproj.canary-query）。全部步骤通过**真实 HTTP API**
 * （Japa apiClient）驱动既有安装状态机，不复制任何生命周期实现：
 * - 任务 2.1：隔离数据库（每用例 truncate 快照）+ 双租户 fixture；重复认证 digest 一致；
 *   并发双租户互不污染。
 * - 任务 2.2：API 生命周期 runner 覆盖 package-verification/install/permission/enable/
 *   execute/disable/upgrade/rollback/uninstall/residue；中断后必需步骤 not-run 必须 fail-closed，
 *   且数据库状态保持一致。
 * - 任务 2.3：兼容矩阵（破坏性版本拒绝）、健康诊断（崩溃/超时/配额低敏证据）、
 *   安全门（enabled/disabled/cross-tenant 决策理由）断言；权限提升必须再确认；过期 preview 拒绝。
 * - 任务 2.4：跨租读取/执行/升级/卸载全部阻断；失败与卸载后无越权残留和孤儿授权。
 *
 * 报告契约使用共享层 @aiproj/types 的 plugin-e2e-lifecycle-certification 纯函数判定。
 */
import { test } from '@japa/runner'
import PluginInstallation from '#models/plugin_installation'
import CompilerSkill from '#models/compiler_skill'
import PluginServerHookService from '#services/plugin_server_hook_service'
import PluginServerHookInvocationService, {
  clearDegradationCounters,
  getDegradationCountSnapshot,
  registerServerHookCallback,
  unregisterServerHookCallback,
} from '#services/plugin_server_hook_invocation_service'
import PluginSkillAdapterService from '#services/plugin_skill_adapter_service'
import PluginSecurityGateService from '#services/plugin_security_gate/gate_service'
import HealthQueryService from '#services/plugin_runtime_health/health_query_service'
import HealthEventRecorder from '#services/plugin_runtime_health/health_event_recorder'
import RbacPolicy from '#policies/rbac_policy'
import RbacService from '#services/rbac_service'
import AuditService from '#services/audit_service'
import {
  CANARY_ADVISORY_FIXTURE_RESULT,
  CANARY_ADVISORY_PLUGIN_ID,
  CANARY_QUERY_FIXTURE_RESULT,
  CANARY_QUERY_PLUGIN_ID,
  CANARY_QUERY_RELEASE_METADATA,
  PLUGIN_E2E_REQUIRED_STEP_IDS,
  PLUGIN_E2E_SCHEMA_VERSION,
  type PluginE2ECertificationReport,
  type PluginServerHookQueryRequest,
  canonicalizeReport,
  createReleaseProfile,
  evaluateReportConclusion,
  isCiGatePass,
  validateCertificationReport,
} from '@aiproj/types'
import { seedCanaryRelease } from '../fixtures/first_party_plugin_canary_releases.js'
import {
  PluginLifecycleCertRunner,
  evaluateResidueScan,
} from '../fixtures/plugin_e2e_lifecycle_runner.js'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'

function base(organizationId: number) {
  return `/api/v1/organizations/${organizationId}/plugin-installations`
}

async function login(client: any, email: string) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email, password: STRONG_PASSWORD })
  response.assertStatus(200)
  return response.body().data.accessToken as string
}

/** Japa ApiResponse 的 status 是方法；兼容两种形态取数值。 */
function httpStatusOf(response: any): number {
  return typeof response.status === 'function' ? response.status() : response.status
}

/** 通用两步命令流（preview → confirm），resolve 为最终响应对象（供 apiOk 消费）。 */
async function commandFlow(
  client: any,
  token: string,
  organizationId: number,
  payload: Record<string, unknown>,
): Promise<{ status: number | (() => number); body: () => any }> {
  const previewResponse = await client
    .post(`${base(organizationId)}/commands/preview`)
    .bearerToken(token)
    .json(payload)
  if (httpStatusOf(previewResponse) !== 200) return previewResponse
  const preview = previewResponse.body().data
  const isEnable = payload.action === 'enable'
  return client
    .post(`${base(organizationId)}/commands/confirm`)
    .bearerToken(token)
    .json({
      previewHandle: preview.previewHandle,
      previewDigest: preview.previewDigest,
      ...(isEnable
        ? { permissionConfirmed: true, permissionDigest: preview.permissionDigest }
        : {}),
    })
}

/** enable 两步流（携带权限确认字段）。 */
function enableFlow(client: any, token: string, organizationId: number) {
  return commandFlow(client, token, organizationId, {
    action: 'enable',
    pluginId: CANARY_QUERY_PLUGIN_ID,
  })
}

/** 双租户夹具：两个独立组织与所有者 token（每次用例从 truncate 快照启动）。 */
async function seedDualTenant(client: any) {
  const ownerA = await createUser()
  const ownerB = await createUser()
  const organizationA = await createOrganization(ownerA)
  const organizationB = await createOrganization(ownerB)
  return {
    ownerA,
    ownerB,
    organizationA,
    organizationB,
    tokenA: await login(client, ownerA.email),
    tokenB: await login(client, ownerB.email),
  }
}

function buildCertQueryRequest(
  organizationId: number,
  userId: number,
  contributionKey: string,
): PluginServerHookQueryRequest {
  return {
    seamKey: 'server-query.readonly-provider',
    contributionKey,
    pluginId: CANARY_QUERY_PLUGIN_ID,
    pluginVersion: '1.0.0',
    context: {
      organizationId,
      userId,
      userRoles: ['admin'],
      requestedPermissions: ['project:view'],
      scope: 'organization',
    },
    payload: {},
  }
}

/**
 * 完整正向生命周期（release profile 全部必需步骤），返回规范化报告与过程证据。
 * 每次调用自建独立双租户命名空间，可重复执行（任务 2.1 可复现性基础）。
 */
async function runFullPositiveLifecycle(client: any): Promise<{
  report: PluginE2ECertificationReport
}> {
  const { ownerA, organizationA, tokenA } = await seedDualTenant(client)
  const queryV1 = await seedCanaryRelease(organizationA.id, 'query', '1.0.0')
  const queryV11 = await seedCanaryRelease(organizationA.id, 'query', '1.1.0')

  const runner = new PluginLifecycleCertRunner()

  // ── package-verification：篡改 digest 的安装预览必须在包校验处被拒 ──
  await runner.apiMustDeny(
    'package-verification',
    client
      .post(`${base(organizationA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({
        action: 'install',
        pluginId: CANARY_QUERY_PLUGIN_ID,
        releaseId: queryV1.id,
        expectedDigest: 'sha256:tampered-package',
      }),
    ['plugin-install-digest-mismatch'],
  )

  // ── install-preview / install-confirm ──
  const installPreview = await runner.apiOk(
    'install-preview',
    client
      .post(`${base(organizationA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: queryV1.id }),
  )
  const installed = await runner.apiOk(
    'install-confirm',
    client
      .post(`${base(organizationA.id)}/commands/confirm`)
      .bearerToken(tokenA)
      .json({
        previewHandle: installPreview.previewHandle,
        previewDigest: installPreview.previewDigest,
      }),
  )
  if (installed.status !== 'installed') {
    throw new Error(`install-confirm produced status ${installed.status}`)
  }

  // ── enable（预览+确认整流）与 permission-confirmation（授权摘要绑定核验）──
  const enabled = await runner.apiOk('enable', enableFlow(client, tokenA, organizationA.id))
  const detailResponse = await client
    .get(`${base(organizationA.id)}/${encodeURIComponent(CANARY_QUERY_PLUGIN_ID)}`)
    .bearerToken(tokenA)
  detailResponse.assertStatus(200)
  const confirmationOk =
    enabled.status === 'enabled' &&
    detailResponse.body().data.permissionConfirmation?.permissionDigest !== null &&
    detailResponse.body().data.permissionConfirmation.permissionKeys.includes('aiproj.project-view')
  runner.judge('permission-confirmation', confirmationOk, 'unverified-evidence')

  // ── execute：生产 hook 解析 + 调用路径；fixture 零 provider 调用、零正式写入 ──
  registerServerHookCallback('cert-canary-callback', async () => CANARY_QUERY_FIXTURE_RESULT)
  try {
    const resolved = await new PluginServerHookService().resolvePluginServerHookContributions(
      organizationA.id,
    )
    const contributionVisible = resolved.effectiveContributionKeys.includes('canary-query-summary')
    runner.judge('execute', contributionVisible, 'unknown-error', 'contribution resolved')
    if (!contributionVisible) {
      const diagDetail = await client
        .get(`${base(organizationA.id)}/${encodeURIComponent(CANARY_QUERY_PLUGIN_ID)}`)
        .bearerToken(tokenA)
      throw new Error(
        `canary contribution not effective after enable; installation=${JSON.stringify(
          diagDetail.body()?.data ?? null,
        )}; resolved=${JSON.stringify(resolved.hookContributions)}`,
      )
    }

    const invocation = new PluginServerHookInvocationService(
      new RbacPolicy(new RbacService()),
      new AuditService(),
    )
    const result = await invocation.invokeQueryCallback(
      buildCertQueryRequest(organizationA.id, ownerA.id, 'canary-query-summary'),
      'cert-positive-run',
      'cert-canary-callback',
    )
    const executeOk =
      !!result.result &&
      result.result.data.projectCount === CANARY_QUERY_FIXTURE_RESULT.data.projectCount &&
      CANARY_QUERY_FIXTURE_RESULT.providerCalls === 0 &&
      CANARY_QUERY_FIXTURE_RESULT.draftPersisted === false
    if (!executeOk) throw new Error(result.error ?? 'execute mismatch')
  } finally {
    unregisterServerHookCallback('cert-canary-callback')
  }

  // ── disable + revoked-grant 负例：禁用后贡献立即失效 ──
  // disable 是 PLUGIN_E2E_REQUIRED_STEP_IDS 之一，必须经 runner 记录，
  // 否则报告缺步骤 -> evaluateReportConclusion 判 missing-required-step。
  const disabled = await runner.apiOk(
    'disable',
    commandFlow(client, tokenA, organizationA.id, {
      action: 'disable',
      pluginId: CANARY_QUERY_PLUGIN_ID,
    }),
  )
  if (disabled.status !== 'installed') {
    throw new Error(`disable produced status ${disabled.status}`)
  }
  const resolvedAfterDisable =
    await new PluginServerHookService().resolvePluginServerHookContributions(organizationA.id)
  runner.judge(
    'revoked-grant',
    !resolvedAfterDisable.effectiveContributionKeys.includes('canary-query-summary'),
    'blocking-negative-not-denied',
  )
  await runner.apiMustDeny(
    'undeclared-capability',
    client
      .post(`${base(organizationA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'enable', pluginId: 'com.aiproj.never-registered' }),
    ['plugin-install-not-found', 'plugin-install-illegal-transition'],
  )

  // ── upgrade / rollback（回滚走同一升级门，均为预览+确认整流）──
  const upgraded = await runner.apiOk(
    'upgrade',
    commandFlow(client, tokenA, organizationA.id, {
      action: 'upgrade',
      pluginId: CANARY_QUERY_PLUGIN_ID,
      releaseId: queryV11.id,
    }),
  )
  if (upgraded.version !== '1.1.0') throw new Error(`upgrade version ${upgraded.version}`)
  const rolledBack = await runner.apiOk(
    'rollback',
    commandFlow(client, tokenA, organizationA.id, {
      action: 'upgrade',
      pluginId: CANARY_QUERY_PLUGIN_ID,
      releaseId: queryV1.id,
    }),
  )
  if (rolledBack.version !== '1.0.0') throw new Error(`rollback version ${rolledBack.version}`)

  // ── uninstall + uninstall-residue 负例 ──
  await runner.apiOk(
    'uninstall',
    commandFlow(client, tokenA, organizationA.id, {
      action: 'uninstall',
      pluginId: CANARY_QUERY_PLUGIN_ID,
    }),
  )
  const repeatUninstall = await client
    .post(`${base(organizationA.id)}/commands/preview`)
    .bearerToken(tokenA)
    .json({ action: 'uninstall', pluginId: CANARY_QUERY_PLUGIN_ID })
  const rowsAfterUninstall = await PluginInstallation.query()
    .where('organization_id', organizationA.id)
    .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
  const otherTenantRows = await PluginInstallation.query()
    .where('organization_id', '<>', organizationA.id)
    .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
  const repeatUninstallDenied = httpStatusOf(repeatUninstall) === 400
  const residueOk =
    repeatUninstallDenied &&
    rowsAfterUninstall.every(
      (r) => r.status === 'uninstalled' && r.permissionConfirmation === null,
    ) &&
    evaluateResidueScan({
      organizationRows: rowsAfterUninstall.map((r) => ({ status: r.status })),
      otherTenantRows: otherTenantRows.length,
      activeOtherPluginRows: otherTenantRows.filter((r) => r.status === 'enabled').length,
    })
  runner.judge('uninstall-residue', residueOk, 'residue-found')

  // ── residue-inspection：全组织扫描（本插件终态唯一、无孤儿启用行）──
  runner.judge('residue-inspection', residueOk && repeatUninstallDenied, 'residue-found')

  const evaluated = evaluateReportConclusion(runner.steps)
  const raw: Omit<PluginE2ECertificationReport, 'digest'> = {
    schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
    hostRef: 'host:ace-test-runner',
    pluginId: CANARY_QUERY_PLUGIN_ID,
    pluginVersion: '1.0.0',
    profile: createReleaseProfile(),
    steps: runner.steps,
    conclusion: evaluated.conclusion,
    ...(evaluated.blockingReason ? { blockingReason: evaluated.blockingReason } : {}),
    counts: { total: 0, pass: 0, fail: 0, notRun: 0, degraded: 0 },
    generatedAt: new Date().toISOString(),
    fixtureRef: 'fixture:plugin-e2e-cert-run',
  }
  return { report: canonicalizeReport(raw) }
}

/** 单命令动作流（enable/disable/uninstall/upgrade 等），enable 自动携带权限确认字段。 */
async function commandAction(
  client: any,
  token: string,
  organizationId: number,
  action: string,
  releaseId?: number,
) {
  const previewResponse = await client
    .post(`${base(organizationId)}/commands/preview`)
    .bearerToken(token)
    .json({ action, pluginId: CANARY_QUERY_PLUGIN_ID, ...(releaseId ? { releaseId } : {}) })
  previewResponse.assertStatus(200)
  const preview = previewResponse.body().data
  const confirmResponse = await client
    .post(`${base(organizationId)}/commands/confirm`)
    .bearerToken(token)
    .json({
      previewHandle: preview.previewHandle,
      previewDigest: preview.previewDigest,
      ...(action === 'enable'
        ? { permissionConfirmed: true, permissionDigest: preview.permissionDigest }
        : {}),
    })
  confirmResponse.assertStatus(200)
  return confirmResponse.body().data
}

test.group(
  'Plugin E2E lifecycle certification（v3-plugin-e2e-lifecycle-certification）',
  (group) => {
    useAiDatabase(group)
    group.teardown(() => {
      unregisterServerHookCallback('cert-canary-callback')
      unregisterServerHookCallback('cert-crash-callback')
      unregisterServerHookCallback('cert-timeout-callback')
    })

    test('2.2 完整正向生命周期产出 pass 认证报告且门禁放行', async ({ client, assert }) => {
      const { report } = await runFullPositiveLifecycle(client)

      const nonPassSteps = report.steps
        .filter((s) => s.conclusion !== 'pass')
        .map((s) => `${s.stepId}:${s.conclusion}:${s.reasonCode}`)
        .join(',')
      assert.equal(
        report.conclusion,
        'pass',
        `blocking=${report.blockingReason ?? 'none'}; non-pass=[${nonPassSteps}]`,
      )
      assert.equal(report.profile.kind, 'release')
      const validation = validateCertificationReport(report)
      assert.isTrue(validation.valid, `report must validate: ${validation.errors.join('; ')}`)
      assert.isTrue(isCiGatePass(report))
      // 必需步骤全部 pass 且有低敏 evidence ref
      for (const stepId of PLUGIN_E2E_REQUIRED_STEP_IDS) {
        const step = report.steps.find((s) => s.stepId === stepId)
        assert.isDefined(step, `required step ${stepId} present`)
        assert.equal(step!.conclusion, 'pass')
        assert.isTrue(
          typeof step!.evidenceRef === 'string' && step!.evidenceRef!.startsWith('fixture:'),
        )
      }
    })

    test('2.1 相同输入重复认证产生一致 digest 与规范化报告', async ({ client, assert }) => {
      const run1 = await runFullPositiveLifecycle(client)
      const run2 = await runFullPositiveLifecycle(client)

      assert.equal(run1.report.digest, run2.report.digest)
      assert.equal(run1.report.reproCommand, run2.report.reproCommand)
      // generatedAt 允许变化，不参与 digest
      assert.notEqual(run1.report.generatedAt, run2.report.generatedAt)
    })

    test('2.1 并发双租户生命周期互不污染', async ({ client, assert }) => {
      const tenantSetup = async () => {
        const ctx = await seedDualTenant(client)
        const release = await seedCanaryRelease(ctx.organizationA.id, 'query', '1.0.0')
        return { ctx, release }
      }
      const [{ ctx: ctxA, release: relA }, { ctx: ctxB, release: relB }] = await Promise.all([
        tenantSetup(),
        tenantSetup(),
      ])

      const installAndEnable = async (
        ctx: Awaited<ReturnType<typeof seedDualTenant>>,
        release: any,
      ) => {
        const previewResponse = await client
          .post(`${base(ctx.organizationA.id)}/commands/preview`)
          .bearerToken(ctx.tokenA)
          .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: release.id })
        previewResponse.assertStatus(200)
        const preview = previewResponse.body().data
        const confirmResponse = await client
          .post(`${base(ctx.organizationA.id)}/commands/confirm`)
          .bearerToken(ctx.tokenA)
          .json({ previewHandle: preview.previewHandle, previewDigest: preview.previewDigest })
        confirmResponse.assertStatus(200)
        const enablePreviewResponse = await client
          .post(`${base(ctx.organizationA.id)}/commands/preview`)
          .bearerToken(ctx.tokenA)
          .json({ action: 'enable', pluginId: CANARY_QUERY_PLUGIN_ID })
        enablePreviewResponse.assertStatus(200)
        const enablePreview = enablePreviewResponse.body().data
        const enableConfirm = await client
          .post(`${base(ctx.organizationA.id)}/commands/confirm`)
          .bearerToken(ctx.tokenA)
          .json({
            previewHandle: enablePreview.previewHandle,
            previewDigest: enablePreview.previewDigest,
            permissionConfirmed: true,
            permissionDigest: enablePreview.permissionDigest,
          })
        enableConfirm.assertStatus(200)
        return enableConfirm.body().data
      }

      const [instA, instB] = await Promise.all([
        installAndEnable(ctxA, relA),
        installAndEnable(ctxB, relB),
      ])
      assert.equal(instA.status, 'enabled')
      assert.equal(instB.status, 'enabled')

      // 执行资格按租户解析：各自可见自己的贡献，互不串扰
      const hookService = new PluginServerHookService()
      const resolutionA = await hookService.resolvePluginServerHookContributions(
        ctxA.organizationA.id,
      )
      const keysA = resolutionA.effectiveContributionKeys
      const resolutionB = await hookService.resolvePluginServerHookContributions(
        ctxB.organizationA.id,
      )
      const keysB = resolutionB.effectiveContributionKeys
      assert.include(keysA, 'canary-query-summary')
      assert.include(keysB, 'canary-query-summary')

      // 卸载 A 后 B 不受影响
      await commandAction(client, ctxA.tokenA, ctxA.organizationA.id, 'uninstall')
      const afterA = await hookService.resolvePluginServerHookContributions(ctxA.organizationA.id)
      const keysAfterA = afterA.effectiveContributionKeys
      const afterB = await hookService.resolvePluginServerHookContributions(ctxB.organizationA.id)
      const keysBAfterA = afterB.effectiveContributionKeys
      assert.notInclude(keysAfterA, 'canary-query-summary')
      assert.include(keysBAfterA, 'canary-query-summary')
    })

    test('2.2 步骤中断产生 not-run fail-closed 报告且状态保持', async ({ client, assert }) => {
      const { organizationA, tokenA } = await seedDualTenant(client)
      const release = await seedCanaryRelease(organizationA.id, 'query', '1.0.0')

      const runner = new PluginLifecycleCertRunner()
      const preview = await runner.apiOk(
        'install-preview',
        client
          .post(`${base(organizationA.id)}/commands/preview`)
          .bearerToken(tokenA)
          .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: release.id }),
      )

      // 中断：不再 confirm。其余必需步骤补记 not-run。
      runner.markUnrun(PLUGIN_E2E_REQUIRED_STEP_IDS)
      const evaluated = evaluateReportConclusion(runner.steps)
      assert.equal(evaluated.conclusion, 'fail')
      assert.equal(evaluated.blockingReason, 'missing-required-step')

      const interrupted: Omit<PluginE2ECertificationReport, 'digest'> = {
        schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
        hostRef: 'host:ace-test-runner',
        pluginId: CANARY_QUERY_PLUGIN_ID,
        pluginVersion: '1.0.0',
        profile: createReleaseProfile(),
        steps: runner.steps,
        conclusion: evaluated.conclusion,
        blockingReason: evaluated.blockingReason!,
        counts: { total: 0, pass: 0, fail: 0, notRun: 0, degraded: 0 },
        generatedAt: new Date().toISOString(),
        fixtureRef: 'fixture:plugin-e2e-cert-interrupted',
      }
      const report = canonicalizeReport(interrupted)
      assert.isFalse(isCiGatePass(report))
      assert.isTrue(report.counts.notRun >= 5)

      // 状态保持：确认从未发生 → 无安装行（无半写状态）；且原预览句柄仍可续办完成安装
      // （一次性句柄只在消费后失效——中断不误伤用户重试，属正确产品语义）
      const rows = await PluginInstallation.query()
        .where('organization_id', organizationA.id)
        .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
      assert.lengthOf(rows, 0)
      const resumed = await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({ previewHandle: preview.previewHandle, previewDigest: preview.previewDigest })
      resumed.assertStatus(200)
      assert.equal(resumed.body().data.status, 'installed')
      const rowsAfterResume = await PluginInstallation.query()
        .where('organization_id', organizationA.id)
        .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
      assert.lengthOf(rowsAfterResume, 1)
      // 消费后的句柄重放才被拒绝
      const replay = await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({ previewHandle: preview.previewHandle, previewDigest: preview.previewDigest })
      replay.assertStatus(400)
      replay.assertBodyContains({ error: { code: 'plugin-install-preview-expired' } })
    })

    test('2.3 破坏性版本/未再确认提权/过期 preview 均被兼容矩阵与状态机阻断', async ({
      client,
      assert,
    }) => {
      const { organizationA, tokenA } = await seedDualTenant(client)

      // 破坏性版本：宿主范围不匹配的 approved 行（纵深防御）仍被安装预览拒绝
      const incompatible = await seedCanaryRelease(organizationA.id, 'query', '2.0.0', {
        status: 'draft',
        metadata: {
          ...CANARY_QUERY_RELEASE_METADATA,
          name: 'breaking-major',
          compatibilityMatrix: {
            pluginVersion: '2.0.0',
            hostRange: '>=4.0.0 <5.0.0',
            manifestSchemaVersion: '1.0',
            permissionModelVersion: '1.0',
            channel: 'stable',
            requiredSeams: [],
          },
          contributions: [],
        },
      })
      incompatible.status = 'approved'
      await incompatible.save()
      const breakingDenied = await client
        .post(`${base(organizationA.id)}/commands/preview`)
        .bearerToken(tokenA)
        .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: incompatible.id })
      breakingDenied.assertStatus(400)
      breakingDenied.assertBodyContains({ error: { code: 'plugin-install-source-incompatible' } })

      // 正常安装并启用基线版本
      const baseRelease = await seedCanaryRelease(organizationA.id, 'query', '1.0.2')
      const installPreviewResponse = await client
        .post(`${base(organizationA.id)}/commands/preview`)
        .bearerToken(tokenA)
        .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: baseRelease.id })
      installPreviewResponse.assertStatus(200)
      const installPreview = installPreviewResponse.body().data
      const installConfirm = await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({
          previewHandle: installPreview.previewHandle,
          previewDigest: installPreview.previewDigest,
        })
      installConfirm.assertStatus(200)
      await commandAction(client, tokenA, organizationA.id, 'enable')

      // 权限提升升级：未携带再确认 → 拒绝；旧版本保持不变
      const elevatedMetadata = {
        ...CANARY_QUERY_RELEASE_METADATA,
        version: '1.1.0',
        permissions: [
          ...CANARY_QUERY_RELEASE_METADATA.permissions,
          {
            permissionKey: 'aiproj.project-export',
            seamKey: 'server-query.readonly-provider',
            sideEffect: 'read-only',
            network: 'none',
            purpose: 'Cert elevation fixture',
          },
        ],
        compatibilityMatrix: {
          pluginVersion: '1.1.0',
          hostRange: '>=3.0.0 <4.0.0',
          manifestSchemaVersion: '1.0',
          permissionModelVersion: '1.0',
          channel: 'stable',
          requiredSeams: CANARY_QUERY_RELEASE_METADATA.contributions.map((item) => ({
            seamKey: item.seamKey,
            seamVersion: item.seamVersion,
          })),
        },
      }
      const elevatedRelease = await seedCanaryRelease(organizationA.id, 'query', '1.1.0', {
        metadata: elevatedMetadata,
      })
      const elevationPreviewResponse = await client
        .post(`${base(organizationA.id)}/commands/preview`)
        .bearerToken(tokenA)
        .json({
          action: 'upgrade',
          pluginId: CANARY_QUERY_PLUGIN_ID,
          releaseId: elevatedRelease.id,
        })
      elevationPreviewResponse.assertStatus(200)
      const elevationPreview = elevationPreviewResponse.body().data
      const deniedConfirm = await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({
          previewHandle: elevationPreview.previewHandle,
          previewDigest: elevationPreview.previewDigest,
        })
      deniedConfirm.assertStatus(400)
      deniedConfirm.assertBodyContains({ error: { code: 'plugin-install-permission-unconfirmed' } })
      const unchanged = await PluginInstallation.query()
        .where('organization_id', organizationA.id)
        .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
        .firstOrFail()
      assert.equal(unchanged.version, '1.0.2')
      assert.equal(unchanged.status, 'enabled')

      // 过期 preview：消费后的句柄重放与跨租重放同响应（不可区分）
      const stalePreviewResponse = await client
        .post(`${base(organizationA.id)}/commands/preview`)
        .bearerToken(tokenA)
        .json({
          action: 'upgrade',
          pluginId: CANARY_QUERY_PLUGIN_ID,
          releaseId: elevatedRelease.id,
        })
      stalePreviewResponse.assertStatus(200)
      const stalePreview = stalePreviewResponse.body().data
      const consumed = await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({
          previewHandle: stalePreview.previewHandle,
          previewDigest: stalePreview.previewDigest,
          permissionConfirmed: true,
          permissionDigest: stalePreview.permissionDigest,
        })
      consumed.assertStatus(200)
      const replay = await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({
          previewHandle: stalePreview.previewHandle,
          previewDigest: stalePreview.previewDigest,
        })
      replay.assertStatus(400)
      replay.assertBodyContains({ error: { code: 'plugin-install-preview-expired' } })

      // 安全门：enabled 安装可解析（拒绝仅来自 seam 未 host-ready），禁用后退化为 install-invalid
      // （探针不显式开事务——SQLite 池容量 1，避免与 HTTP 连接互锁；resolver 缺省走全局连接）
      const gate = new PluginSecurityGateService()
      const gateReq = {
        pluginId: CANARY_QUERY_PLUGIN_ID,
        seamKey: 'server-query.readonly-provider',
        operation: 'execute' as const,
        requestedPermissions: [] as string[],
        scopeKind: 'organization' as const,
        idempotencyKey: 'cert-gate-probe',
        referenceTime: new Date().toISOString(),
      }
      const enabledDecision = await gate.authorize({
        request: gateReq,
        organizationId: organizationA.id,
        actorId: 0,
        seamCatalog: {},
        permissionVocabulary: {},
      })
      assert.equal(enabledDecision.decision.outcome, 'denied')
      // enabled 安装已被正确解析：拒绝理由不再来自安装解析（当前目录 seam 均 cataloged，
      // 终局拒绝来自 seam/network 等就绪度检查，reasonCode 集合随目录演进而变化，不硬编码）
      assert.notInclude(enabledDecision.decision.reasonCodes as string[], 'install-invalid')
      assert.notEqual(enabledDecision.decision.reasonCode, 'install-invalid')
      await commandAction(client, tokenA, organizationA.id, 'disable')
      const disabledDecision = await gate.authorize({
        request: gateReq,
        organizationId: organizationA.id,
        actorId: 0,
        seamCatalog: {},
        permissionVocabulary: {},
      })
      assert.equal(disabledDecision.decision.outcome, 'denied')
      assert.equal(disabledDecision.decision.reasonCode, 'install-invalid')
    })

    test('2.3 崩溃/超时/配额产生低敏健康证据并按租户隔离', async ({ client, assert }) => {
      const { ownerA, organizationA, organizationB, tokenA } = await seedDualTenant(client)
      const release = await seedCanaryRelease(organizationA.id, 'query', '1.0.0')
      const installPreviewResponse = await client
        .post(`${base(organizationA.id)}/commands/preview`)
        .bearerToken(tokenA)
        .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: release.id })
      installPreviewResponse.assertStatus(200)
      const installPreview = installPreviewResponse.body().data
      const installConfirm = await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({
          previewHandle: installPreview.previewHandle,
          previewDigest: installPreview.previewDigest,
        })
      installConfirm.assertStatus(200)
      const installation = installConfirm.body().data

      const invocation = new PluginServerHookInvocationService(
        new RbacPolicy(new RbacService()),
        new AuditService(),
      )
      const request = buildCertQueryRequest(organizationA.id, ownerA.id, 'cert-health')

      // 崩溃
      registerServerHookCallback('cert-crash-callback', async () => {
        throw new Error('SECRET_CRASH_DETAIL_XYZ')
      })
      const crashed = await invocation.invokeQueryCallback(
        request,
        'cert-crash-run',
        'cert-crash-callback',
      )
      assert.isDefined(crashed.error)
      assert.equal(getDegradationCountSnapshot('cert-crash-run')?.failures, 1)
      clearDegradationCounters('cert-crash-run')
      unregisterServerHookCallback('cert-crash-callback')

      // 超时（契约上限 5s）
      registerServerHookCallback('cert-timeout-callback', () => new Promise<never>(() => undefined))
      const timedOut = await invocation.invokeQueryCallback(
        request,
        'cert-timeout-run',
        'cert-timeout-callback',
      )
      assert.isDefined(timedOut.error)
      assert.equal(getDegradationCountSnapshot('cert-timeout-run')?.timeouts, 1)
      clearDegradationCounters('cert-timeout-run')
      unregisterServerHookCallback('cert-timeout-callback')

      // 配额（max=1，第二次必须拒绝）
      registerServerHookCallback('cert-quota-callback', async () => CANARY_QUERY_FIXTURE_RESULT)
      const quotaFirst = await invocation.invokeQueryCallback(
        request,
        'cert-quota-run',
        'cert-quota-callback',
        1,
      )
      const quotaDenied = await invocation.invokeQueryCallback(
        request,
        'cert-quota-run',
        'cert-quota-callback',
        1,
      )
      assert.isDefined(quotaFirst.result)
      assert.isDefined(quotaDenied.error)
      assert.deepEqual(getDegradationCountSnapshot('cert-quota-run'), {
        totalAttempts: 2,
        successes: 1,
        failures: 1,
        timeouts: 0,
        skipped: 1,
      })
      clearDegradationCounters('cert-quota-run')
      unregisterServerHookCallback('cert-quota-callback')

      // 健康证据持久化（以真实 installationId 经 recorder 写入），经查询服务读出
      const recorder = new HealthEventRecorder()
      await recorder.record({
        organizationId: organizationA.id,
        installationId: Number(installation.id),
        pluginId: CANARY_QUERY_PLUGIN_ID,
        pluginVersion: '1.0.0',
        contributionKey: 'cert-health',
        seamKey: 'server-query.readonly-provider',
        outcome: 'crash',
        reasonCode: 'crash',
        latencyMs: 3,
        invocationId: 'cert-health-crash-event',
      })
      await recorder.record({
        organizationId: organizationA.id,
        installationId: Number(installation.id),
        pluginId: CANARY_QUERY_PLUGIN_ID,
        pluginVersion: '1.0.0',
        contributionKey: 'cert-health',
        seamKey: 'server-query.readonly-provider',
        outcome: 'quota_exceeded',
        reasonCode: 'call_quota',
        quotaKind: 'call',
        latencyMs: 0,
        invocationId: 'cert-health-quota-event',
      })

      const healthService = new HealthQueryService()
      const events = await healthService.listEvents(
        organizationA.id,
        Number(installation.id),
        1,
        50,
      )
      const outcomes = events.data.map((e) => e.outcome).sort()
      assert.include(outcomes, 'crash')
      assert.include(outcomes, 'quota_exceeded')

      // 低敏：事件投影不含回调错误原文
      const eventsJson = JSON.stringify(events)
      assert.notInclude(eventsJson, 'SECRET_CRASH_DETAIL_XYZ')

      // 租户隔离：他租健康快照为零
      const foreignSnapshots = await healthService.listSnapshots(organizationB.id, {})
      assert.equal(foreignSnapshots.data.length, 0)
      const ownSnapshots = await healthService.listSnapshots(organizationA.id, {})
      assert.equal(ownSnapshots.data.length, 1)
    })

    test('2.4 跨租读取/执行/升级/卸载全部阻断且无残留授权', async ({ client, assert }) => {
      const { ownerA, organizationA, organizationB, tokenA, tokenB } = await seedDualTenant(client)
      const release = await seedCanaryRelease(organizationA.id, 'query', '1.0.0')
      const installPreviewResponse = await client
        .post(`${base(organizationA.id)}/commands/preview`)
        .bearerToken(tokenA)
        .json({ action: 'install', pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: release.id })
      installPreviewResponse.assertStatus(200)
      const installPreview = installPreviewResponse.body().data
      await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({
          previewHandle: installPreview.previewHandle,
          previewDigest: installPreview.previewDigest,
        })
        .then((r: any) => r.assertStatus(200))

      // 跨租读取：403/404 不可区分（policy 统一隐藏存在性），且不泄露版本/授权细节
      const foreignRead = await client
        .get(`${base(organizationA.id)}/${encodeURIComponent(CANARY_QUERY_PLUGIN_ID)}`)
        .bearerToken(tokenB)
      assert.include([403, 404], foreignRead.status())
      if (foreignRead.status() === 200) throw new Error('cross-tenant read leaked installation')

      // 跨租写命令（disable/upgrade/uninstall）：全部阻断（403/404 等价）
      for (const action of ['disable', 'upgrade', 'uninstall'] as const) {
        const foreignCommand = await client
          .post(`${base(organizationA.id)}/commands/preview`)
          .bearerToken(tokenB)
          .json({ action, pluginId: CANARY_QUERY_PLUGIN_ID, releaseId: release.id })
        assert.include([403, 404], foreignCommand.status())
      }

      // 跨租执行：B 租解析不到贡献；preflight 组织不匹配 fail closed
      const hookService = new PluginServerHookService()
      const foreignResolution = await hookService.resolvePluginServerHookContributions(
        organizationB.id,
      )
      const foreignKeys = foreignResolution.effectiveContributionKeys
      assert.notInclude(foreignKeys, 'canary-query-summary')
      const invocation = new PluginServerHookInvocationService(
        new RbacPolicy(new RbacService()),
        new AuditService(),
      )
      const preflight = await invocation.preflight(ownerA, ['project:view'], organizationB.id)
      assert.isFalse(preflight.allowed)
      assert.equal(preflight.reasonCode, 'organization_mismatch')

      // 跨租安全门决策：对 B 租等价于不存在（探针不开显式事务，理由同上）
      const gate = new PluginSecurityGateService()
      const foreignGate = await gate.authorize({
        request: {
          pluginId: CANARY_QUERY_PLUGIN_ID,
          seamKey: 'server-query.readonly-provider',
          operation: 'execute' as const,
          requestedPermissions: [] as string[],
          scopeKind: 'organization' as const,
          idempotencyKey: 'cert-cross-gate',
          referenceTime: new Date().toISOString(),
        },
        organizationId: organizationB.id,
        actorId: ownerA.id,
        seamCatalog: {},
        permissionVocabulary: {},
      })
      assert.equal(foreignGate.decision.outcome, 'denied')
      assert.equal(foreignGate.decision.reasonCode, 'install-invalid')

      // 卸载后残留扫描：A 租只剩软卸载行且授权清空；B 租零行
      await commandAction(client, tokenA, organizationA.id, 'uninstall')
      const rowsA = await PluginInstallation.query().where('organization_id', organizationA.id)
      const rowsB = await PluginInstallation.query().where('organization_id', organizationB.id)
      assert.lengthOf(rowsB, 0)
      assert.isTrue(
        rowsA.every((r) => r.status === 'uninstalled' && r.permissionConfirmation === null),
      )
      assert.isTrue(
        evaluateResidueScan({
          organizationRows: rowsA.map((r) => ({ status: r.status })),
          otherTenantRows: rowsB.length,
          activeOtherPluginRows: rowsB.filter((r) => r.status === 'enabled').length,
        }),
      )
    })

    test('3.2 后端锚点：advisory canary 仅建议、零 provider、零正式写入', async ({
      client,
      assert,
    }) => {
      const { ownerA, organizationA, tokenA } = await seedDualTenant(client)
      const advisory = await seedCanaryRelease(organizationA.id, 'advisory', '1.0.0')
      const installPreviewResponse = await client
        .post(`${base(organizationA.id)}/commands/preview`)
        .bearerToken(tokenA)
        .json({ action: 'install', pluginId: CANARY_ADVISORY_PLUGIN_ID, releaseId: advisory.id })
      installPreviewResponse.assertStatus(200)
      const installPreview = installPreviewResponse.body().data
      await client
        .post(`${base(organizationA.id)}/commands/confirm`)
        .bearerToken(tokenA)
        .json({
          previewHandle: installPreview.previewHandle,
          previewDigest: installPreview.previewDigest,
        })
        .then((r: any) => r.assertStatus(200))
      // Skill 贡献生效要求安装处于 enabled（与 hook 贡献同一状态门槛）
      const enableFlowResponse = await commandFlow(client, tokenA, organizationA.id, {
        action: 'enable',
        pluginId: CANARY_ADVISORY_PLUGIN_ID,
      })
      if (httpStatusOf(enableFlowResponse) !== 200) throw new Error('advisory enable failed')

      // advisory Skill 引用宿主既有 Skill，不复制实现
      await CompilerSkill.create({
        organizationId: organizationA.id,
        skillKey: 'skill-sw-dev',
        name: 'SW Development',
        version: '1.0.0',
        description: 'Host-owned skill',
        status: 'active',
        category: { primary: 'domain' },
        tags: ['cert'],
        activation: {},
        knowledge: {},
        basePriority: 10,
        createdBy: ownerA.id,
        updatedBy: ownerA.id,
      })
      const resolution = await new PluginSkillAdapterService().resolvePluginSkillContributions(
        organizationA.id,
        CANARY_ADVISORY_PLUGIN_ID,
      )
      assert.deepEqual(resolution.effectiveSkillKeys, ['skill-sw-dev'])
      assert.isTrue(resolution.skillBundles[0]!.isEffective)

      // 反幻觉/仅建议边界：fixture 层面固定零 provider、零落库、含人工确认话术
      assert.isTrue(CANARY_ADVISORY_FIXTURE_RESULT.advisory)
      assert.isTrue(CANARY_ADVISORY_FIXTURE_RESULT.bounded)
      assert.equal(CANARY_ADVISORY_FIXTURE_RESULT.providerCalls, 0)
      assert.isFalse(CANARY_ADVISORY_FIXTURE_RESULT.draftPersisted)
      assert.include(CANARY_ADVISORY_FIXTURE_RESULT.draft.summary, '人工确认')
    })
  },
)
