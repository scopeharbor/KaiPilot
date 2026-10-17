/**
 * v3-plugin-security-gate — Gate Service（任务 4.1 / 4.11 / 5.1 / 5.7）
 * v3-plugin-policy-bundles — 组织策略包 shadow / enforcement 接入（任务 3.3 / 3.5）：
 * - 每次授权加载当前组织 verified policy snapshot（可注入 loader，缺省走
 *   PluginPolicyBundleService.loadVerifiedSnapshot）。
 * - shadow（默认）：策略求值与既有决策并行记录差异，不改变结果、不扩大权限。
 * - enforcement（PLUGIN_POLICY_ENFORCEMENT=on）：显式 deny / 正式写无 allow /
 *   snapshot 损坏时 fail closed 到 'policy-denied'；absent 回退既有逐项授权边界。
 */
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type {
  PluginSecurityGateRequest,
  PluginSecurityGateDecision,
  PluginSecurityGateAuthorization,
  PluginSecurityGateReasonCode,
  VerifiedPluginPolicySnapshot,
} from '@aiproj/types'
import {
  validateGateRequestShape,
  normalizeGateRequest,
  deriveScopeGrantSnapshot,
  buildGateReceiptBinding,
  createGateAuthorization,
  evaluateGatePrerequisites,
  sortGateReasonCodes,
  evaluatePluginPolicy,
  type PluginPolicyEvaluateResult,
} from '@aiproj/types'
import {
  resolveEnabledInstallation,
  resolveTrustedScope,
  resolvePolicy,
  resolveSeamReadiness,
  resolveConfirmationReadiness,
} from './resolvers.js'
import type { PluginSecurityGateTrustedContext } from '@aiproj/types'

/** 策略快照装载结果（与服务层 LoadedPolicySnapshot 同构，避免循环依赖）。 */
export type GatePolicyLoaded =
  | { state: 'ok'; snapshot: VerifiedPluginPolicySnapshot }
  | { state: 'absent' }
  | { state: 'corrupt'; reasonCode: string }

/** shadow 记录（低敏；不含实体数据）。 */
export interface GatePolicyShadow {
  state: GatePolicyLoaded['state']
  /** 策略求值结论（仅 ok 时）。 */
  policyAllowed?: boolean
  policyReasonCode?: string
  policyDigest?: string
  revision?: number
  /** 与既有 gate 决策是否存在差异。 */
  diverged?: boolean
}

/** 缺省 loader：动态导入策略服务，异常一律按 corrupt fail closed。 */
async function defaultPolicySnapshotLoader(organizationId: number): Promise<GatePolicyLoaded> {
  try {
    const [{ default: PluginPolicyBundleService }, { default: PluginChangeRequestService }] =
      await Promise.all([
        import('#services/plugin_policy_bundle_service'),
        import('#services/plugin_change_request_service'),
      ])
    const svc = new PluginPolicyBundleService(new PluginChangeRequestService())
    return (await svc.loadVerifiedSnapshot(organizationId)) as GatePolicyLoaded
  } catch {
    return { state: 'corrupt', reasonCode: 'policy-snapshot-invalid' }
  }
}

/** actor 角色解析（server-owned；失败返回空集 → enforcement 下写类默认拒绝）。 */
async function resolveActorRoles(organizationId: number, actorId: number): Promise<string[]> {
  try {
    const { default: OrganizationMember } = await import('#models/organization_member')
    const row = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', actorId)
      .first()
    if (!row) return []
    const { canonicalRoleFromOrganizationRole } = await import('../../../start/rbac/roles.js')
    const canonical = canonicalRoleFromOrganizationRole((row as any).role)
    return canonical ? [canonical] : []
  } catch {
    return []
  }
}

/** 低敏 shadow 差异环形缓冲（上限 50 条；供诊断/测试检查，不外发）。 */
const POLICY_SHADOW_FINDINGS: Array<GatePolicyShadow & { organizationId: number; at: string }> = []

function isPolicyEnforcementEnabled(): boolean {
  return process.env.PLUGIN_POLICY_ENFORCEMENT === 'on'
}

/** 记录低敏 shadow 差异/损坏 finding（环形上限 50；测试经 readPolicyShadowFindings 检查）。 */
function recordShadowFinding(shadow: GatePolicyShadow, organizationId: number): void {
  POLICY_SHADOW_FINDINGS.push({ ...shadow, organizationId, at: new Date().toISOString() })
  if (POLICY_SHADOW_FINDINGS.length > 50) POLICY_SHADOW_FINDINGS.shift()
}

/** 只读导出（诊断/测试用；返回副本防篡改）。 */
export function readPolicyShadowFindings(): Array<
  GatePolicyShadow & { organizationId: number; at: string }
> {
  return [...POLICY_SHADOW_FINDINGS]
}

/** 清空（测试隔离用）。 */
export function resetPolicyShadowFindings(): void {
  POLICY_SHADOW_FINDINGS.length = 0
}

const FORMAL_WRITE_OPERATIONS = new Set([
  'execute',
  'command-proposal',
  'skill-adapter',
  'compiler-contribution',
])

export interface AuthorizeInput {
  request: PluginSecurityGateRequest
  organizationId: number
  projectId?: number
  actorId: number
  /** 省略即走默认连接：resolvers 的 trx 全部是可选参数（见 resolvers.ts）。 */
  trx?: TransactionClientContract
  auditService?: any
  seamCatalog?: Record<string, any>
  permissionVocabulary?: Record<string, any>
  /** 注入式策略快照装载器（测试桩用；缺省走组织策略服务）。 */
  policySnapshotLoader?: (organizationId: number) => Promise<GatePolicyLoaded>
}
export interface AuthorizeResult {
  decision: PluginSecurityGateDecision
  authorization?: PluginSecurityGateAuthorization
  /** shadow/enforcement 的策略求值记录（低敏）。 */
  shadow?: GatePolicyShadow
}
const REQUEST_CACHE = new Map<string, { snapshotDigest: string; at: number }>()
function memoKey(input: {
  organizationId: number
  projectId?: number
  pluginId: string
  operation: string
  permissionDigest: string
  scopeGrantDigest?: string
}): string {
  return `${input.organizationId}:${input.projectId ?? ''}:${input.pluginId}:${input.operation}:${input.permissionDigest}:${input.scopeGrantDigest ?? ''}`
}
export class PluginSecurityGateService {
  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    try {
      const shape = validateGateRequestShape(input.request)
      if (!shape.valid || !shape.normalized)
        return this.denied(input.request, shape.reasonCode ?? 'unknown-field', 'shape-invalid')
      const request = normalizeGateRequest(shape.normalized)
      const scopeRes = await resolveTrustedScope({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: input.actorId,
        trx: input.trx,
      })
      if (!scopeRes.valid) return this.denied(request, 'scope-mismatch', scopeRes.reason)
      const installRes = await resolveEnabledInstallation(
        { organizationId: input.organizationId, pluginId: request.pluginId },
        input.trx,
      )
      if (!installRes.found || !installRes.installation || !installRes.digests)
        return this.denied(request, 'install-invalid', installRes.reason)
      const grantRes = deriveScopeGrantSnapshot({
        organizationScope: scopeRes.organizationScope,
        ...(scopeRes.projectScope ? { projectScope: scopeRes.projectScope } : {}),
        installation: installRes.installation,
        digests: installRes.digests,
        referenceTime: request.referenceTime,
        grantedPermissions: request.requestedPermissions,
      })
      if (!grantRes.ok) return this.denied(request, grantRes.reasonCode, grantRes.details)
      const scopeGrant = grantRes.snapshot
      const cacheKey = memoKey({
        organizationId: input.organizationId,
        projectId: input.projectId,
        pluginId: request.pluginId,
        operation: request.operation,
        permissionDigest: installRes.digests.permissionDigest,
        scopeGrantDigest: scopeGrant.snapshotDigest,
      })
      if (REQUEST_CACHE.has(cacheKey)) {
      } else {
        REQUEST_CACHE.set(cacheKey, { snapshotDigest: scopeGrant.snapshotDigest, at: Date.now() })
        if (REQUEST_CACHE.size > 1000) {
          const first = REQUEST_CACHE.keys().next().value as string
          REQUEST_CACHE.delete(first)
        }
      }
      const policyRes = await resolvePolicy({
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: input.actorId,
        operation: request.operation,
      })
      const seamRes = await resolveSeamReadiness({ seamKey: request.seamKey, trx: input.trx })
      const confirmRes = await resolveConfirmationReadiness()
      // ── v3-plugin-policy-bundles：加载 verified snapshot 并求值 ──
      // （比较与 enforcement 在既有 gate 求值之后进行，见下方 shadow 段）
      let loaded: GatePolicyLoaded = { state: 'absent' }
      try {
        loaded = await (input.policySnapshotLoader ?? defaultPolicySnapshotLoader)(
          input.organizationId,
        )
        if (
          loaded.state === 'ok' &&
          (!loaded.snapshot || typeof loaded.snapshot.digest !== 'string')
        ) {
          loaded = { state: 'corrupt', reasonCode: 'policy-snapshot-invalid' }
        }
      } catch {
        loaded = { state: 'corrupt', reasonCode: 'policy-snapshot-invalid' }
      }
      let policyEval: PluginPolicyEvaluateResult | undefined
      if (loaded.state === 'ok') {
        const actorRoles = await resolveActorRoles(input.organizationId, input.actorId)
        policyEval = evaluatePluginPolicy({
          snapshot: loaded.snapshot,
          actorRoles: actorRoles as never,
          target: { operation: request.operation },
          scopeKind: request.scopeKind === 'project' ? 'project' : 'organization',
          rbacAllowed: policyRes.allowed,
        })
      }
      if (REQUEST_CACHE.size > 2000) REQUEST_CACHE.clear()
      if (loaded.state === 'ok') {
        const ck = `${memoKey({ organizationId: input.organizationId, projectId: input.projectId, pluginId: request.pluginId, operation: request.operation, permissionDigest: installRes.digests.permissionDigest, scopeGrantDigest: scopeGrant.snapshotDigest })}:rev${loaded.snapshot.revision}`
        REQUEST_CACHE.set(ck, { snapshotDigest: scopeGrant.snapshotDigest, at: Date.now() })
      }
      const trustedContext: PluginSecurityGateTrustedContext = {
        organizationScope: scopeRes.organizationScope,
        ...(scopeRes.projectScope ? { projectScope: scopeRes.projectScope } : {}),
        actorRef: `actor:${input.actorId}`,
        installation: installRes.installation,
        digests: installRes.digests,
        policyResults: policyRes.policyResults,
        seamHostReady: seamRes.hostReady,
        confirmationReady: confirmRes.ready,
        auditAvailable: confirmRes.auditAvailable,
        networkAuthorized: confirmRes.networkAuthorized,
      }
      const seamCatalog = input.seamCatalog ?? {}
      const permissionVocabulary = input.permissionVocabulary ?? {}
      const evalRes = evaluateGatePrerequisites({
        request,
        trustedContext,
        seamCatalog,
        permissionVocabulary,
        scopeGrant,
      })

      // ── v3-plugin-policy-bundles：shadow 记录差异；enforcement 时 fail closed ──
      let shadow: GatePolicyShadow | undefined
      if (loaded.state === 'ok' && policyEval) {
        shadow = {
          state: 'ok',
          policyAllowed: policyEval.allowed,
          ...(policyEval.reasonCode ? { policyReasonCode: policyEval.reasonCode } : {}),
          policyDigest: policyEval.policyDigest,
          revision: policyEval.revision,
          diverged: policyEval.allowed !== evalRes.allowed,
        }
        if (shadow.diverged) recordShadowFinding(shadow, input.organizationId)
        if (isPolicyEnforcementEnabled() && !policyEval.allowed) {
          // 显式收紧：策略拒绝 → 终局 denied（不产生 receipt/authorization，零下游调用）
          const deniedDecision = this.buildDecision(
            request,
            scopeGrant,
            {
              ...evalRes,
              allowed: false,
              reasonCode: 'policy-denied',
              reasonCodes: sortGateReasonCodes([
                ...evalRes.reasonCodes,
                'policy-denied',
              ] as PluginSecurityGateReasonCode[]),
            },
            'denied',
          )
          await this.auditBestEffort(deniedDecision, input)
          return { decision: deniedDecision, shadow }
        }
      } else if (loaded.state === 'corrupt') {
        shadow = { state: 'corrupt', policyReasonCode: loaded.reasonCode }
        recordShadowFinding(shadow, input.organizationId)
        if (isPolicyEnforcementEnabled() && FORMAL_WRITE_OPERATIONS.has(request.operation)) {
          // snapshot 损坏：高风险操作 fail closed（spec Requirement 6），读类不受影响
          const deniedDecision = this.buildDecision(
            request,
            scopeGrant,
            {
              ...evalRes,
              allowed: false,
              reasonCode: 'policy-denied',
              reasonCodes: sortGateReasonCodes([
                ...evalRes.reasonCodes,
                'policy-denied',
              ] as PluginSecurityGateReasonCode[]),
            },
            'denied',
          )
          await this.auditBestEffort(deniedDecision, input)
          return { decision: deniedDecision, shadow }
        }
      } else {
        shadow = { state: 'absent' }
      }

      if (!evalRes.allowed) {
        const decision = this.buildDecision(request, scopeGrant, evalRes, 'denied')
        await this.auditBestEffort(decision, input)
        return { decision, shadow }
      }
      const decision = this.buildDecision(request, scopeGrant, evalRes, 'allowed')
      const receipt = buildGateReceiptBinding({
        organizationScope: trustedContext.organizationScope,
        ...(trustedContext.projectScope ? { projectScope: trustedContext.projectScope } : {}),
        pluginId: request.pluginId,
        ...(request.contributionKey ? { contributionKey: request.contributionKey } : {}),
        seamKey: request.seamKey,
        operation: request.operation,
        manifestDigest: installRes.digests.manifestDigest,
        permissionDigest: installRes.digests.permissionDigest,
        scopeGrantDigest: scopeGrant.snapshotDigest,
        requestedPermissions: request.requestedPermissions,
        decisionId: decision.decisionId,
        idempotencyKey: request.idempotencyKey,
        ...(request.correlationKey ? { correlationKey: request.correlationKey } : {}),
        // 任务 3.5：policy digest 进入可信 authorization receipt
        ...(loaded.state === 'ok' && policyEval ? { policyDigest: policyEval.policyDigest } : {}),
      })
      // 放行必须留下可信 receipt：没有事务就没有 receipt，此处 fail closed 而不是静默放行。
      // （允许 trx 省略是给「只读判定/必然拒绝」的调用方用的，见 AuthorizeInput.trx 注释。）
      const decisionTrx = input.trx
      if (!decisionTrx) return this.denied(request, 'audit-unavailable', 'transaction-required')
      try {
        const { recordDecision } =
          await import('#services/plugin_permission_decision/decision_recorder')
        await recordDecision({
          record: {
            decisionId: decision.decisionId,
            schemaVersion: '1',
            createdAt: decision.createdAt,
            mode: 'plugin-runtime',
            operation: request.operation as any,
            outcome: 'allowed',
            organizationScope: trustedContext.organizationScope,
            projectScope: trustedContext.projectScope,
            pluginId: request.pluginId,
            pluginVersion: installRes.installation.pluginVersion,
            targetRef: request.targetRef ?? `${request.seamKey}:${request.pluginId}`,
            requestedPermissions: request.requestedPermissions.map(
              (k) => ({ permissionKey: k, granted: true }) as any,
            ),
            grantedPermissions: request.requestedPermissions.map(
              (k) =>
                ({
                  permissionKey: k,
                  scopeBinding: { organizationScope: trustedContext.organizationScope },
                }) as any,
            ),
            evaluation: {
              outcome: 'allowed',
              prerequisiteChecks: evalRes.prerequisiteChecks as any,
              evaluatedAt: evalRes.evaluatedAt,
            } as any,
            idempotencyKey: request.idempotencyKey,
            inputFingerprint: scopeGrant.snapshotDigest,
            actorRef: trustedContext.actorRef,
            observationDegraded: false,
          } as any,
          organizationId: input.organizationId,
          projectId: input.projectId,
          trx: decisionTrx,
          auditService: input.auditService,
        })
      } catch (e) {
        return this.denied(request, 'audit-unavailable', (e as Error).message)
      }
      decision.receipt = receipt as any
      const authorization = createGateAuthorization(receipt)
      return { decision, authorization, shadow }
    } catch (err) {
      return this.denied(input.request, 'unknown-error', (err as Error).message)
    }
  }
  async authorizeAndRun<T>(
    input: AuthorizeInput,
    callback: (auth: PluginSecurityGateAuthorization) => Promise<T>,
  ): Promise<{ decision: PluginSecurityGateDecision; result?: T }> {
    const { decision, authorization } = await this.authorize(input)
    if (decision.outcome !== 'allowed' || !authorization) return { decision }
    try {
      const result = await callback(authorization)
      return { decision, result }
    } catch (e) {
      return { decision }
    }
  }
  private buildDecision(
    request: PluginSecurityGateRequest,
    scopeGrant: any,
    evalRes: {
      allowed: boolean
      reasonCode?: PluginSecurityGateReasonCode
      reasonCodes: PluginSecurityGateReasonCode[]
      prerequisiteChecks: any[]
      evaluatedAt: string
    },
    outcome: 'allowed' | 'denied',
  ): PluginSecurityGateDecision {
    const decisionId = `gate:${request.pluginId}:${request.operation}:${request.idempotencyKey}`
    return {
      decisionId,
      schemaVersion: '1.0',
      createdAt: new Date().toISOString(),
      outcome,
      ...(evalRes.reasonCode ? { reasonCode: evalRes.reasonCode } : {}),
      reasonCodes: sortGateReasonCodes(evalRes.reasonCodes),
      scopeGrantDigest: scopeGrant?.snapshotDigest,
      prerequisiteChecks: evalRes.prerequisiteChecks,
      receipt: undefined as any,
    }
  }
  private async denied(
    request: PluginSecurityGateRequest,
    reasonCode: PluginSecurityGateReasonCode,
    _details?: string,
  ): Promise<AuthorizeResult> {
    const decision: PluginSecurityGateDecision = {
      decisionId: `gate:${request.pluginId}:${request.operation}:${request.idempotencyKey}`,
      schemaVersion: '1.0',
      createdAt: new Date().toISOString(),
      outcome: 'denied',
      reasonCode,
      reasonCodes: [reasonCode],
      prerequisiteChecks: [{ prerequisite: 'installation', passed: false, reasonCode }],
    }
    return { decision }
  }
  private async auditBestEffort(
    _decision: PluginSecurityGateDecision,
    _input: AuthorizeInput,
  ): Promise<void> {
    return
  }
}
export default PluginSecurityGateService
