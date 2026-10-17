/**
 * v3-plugin-policy-bundles —— 组织策略包服务（任务 3.1）。
 *
 * copy / enable / disable 三类策略变更全部经统一插件变更流提交
 * （kind = `policy-bundle-change`，design D4 兼容扩展）：preview 影响摘要 →
 * maker-checker 审批 → 发起人显式确认（一次性句柄）→ 同一事务内落库 + 可信审计
 * receipt（审计失败整体回滚，fail-closed）。审批 ≠ 确认由共享 flow 保证。
 *
 * 红线：
 * - 策略只能收紧：副本相对模板的收紧性在创建/升级时用 @aiproj/types 纯函数校验，
 *   违反直接拒绝（不产生 change request）。
 * - 组织隔离与 rowVersion CAS 由 Model/迁移承担。
 * - loadVerifiedSnapshot 是 security gate 的唯一快照入口；损坏/版本未知 fail closed。
 */
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import PluginPolicyBundle from '#models/plugin_policy_bundle'
import PluginPolicyBundleActivation from '#models/plugin_policy_bundle_activation'
import PluginChangeRequest from '#models/plugin_change_request'
import {
  getBuiltinPluginPolicyTemplate,
  validatePluginPolicyBundleDocument,
  computePluginPolicyBundleDigest,
  createVerifiedPluginPolicySnapshot,
  verifyPluginPolicySnapshot,
  PLUGIN_POLICY_BUNDLE_LIMITS,
  PLUGIN_CHANGE_TERMINAL_STATES,
  type PluginPolicyBundleDocument,
  type PluginPolicyBundleRule,
  type VerifiedPluginPolicySnapshot,
  type PluginChangeCanonicalDiff,
} from '@aiproj/types'
import PluginChangeRequestService, {
  appendTrustedChangeAuditReceipt,
  type ChangeApplyDelegate,
} from '#services/plugin_change_request_service'
// ── 类型 ──

export interface PolicyImpactSummary {
  action: 'copy' | 'enable' | 'disable' | 'upgrade'
  bundleId: string
  /** 受影响角色（排序去重）。 */
  rolesAffected: string[]
  /** 受影响运行时操作（排序去重）。 */
  operationsAffected: string[]
  /** 受影响宿主 permission key（排序去重）。 */
  permissionKeysAffected: string[]
  /** 新增/移除的目标规则计数（有界 ≤64）。 */
  addedTargets: number
  removedTargets: number
  /** 摘要不含实体名称或项目数据（design D4）。 */
  bounded: true
}

/** 快照装载结果（gate 消费；corrupt → enforcement 下 fail closed）。 */
export type LoadedPolicySnapshot =
  | { state: 'ok'; snapshot: VerifiedPluginPolicySnapshot }
  | { state: 'absent' }
  | { state: 'corrupt'; reasonCode: string }

// ── 内部工具 ──

function targetKeyOf(rule: PluginPolicyBundleRule): string {
  const target = rule.operation != null ? `op:${rule.operation}` : `perm:${rule.permissionKey}`
  return `${rule.role}|${target}`
}

function indexRules(rules: readonly PluginPolicyBundleRule[]): Map<string, PluginPolicyBundleRule> {
  return new Map(rules.map((r) => [targetKeyOf(r), r]))
}

const MAX_SUMMARY_TARGETS = Math.min(64, PLUGIN_POLICY_BUNDLE_LIMITS.MAX_RULES)

/** 构建 canonical diff（低敏目标级差异；不含实体名称/数据）。 */
function buildPolicyChangeDiff(input: {
  bundleId: string
  before?: PluginPolicyBundleDocument | null
  after?: PluginPolicyBundleDocument | null
}): PluginChangeCanonicalDiff {
  const beforeIdx = input.before ? indexRules(input.before.rules) : new Map()
  const afterIdx = input.after ? indexRules(input.after.rules) : new Map()
  const added: string[] = []
  const removed: string[] = []
  const unchanged: string[] = []
  for (const key of afterIdx.keys()) (beforeIdx.has(key) ? unchanged : added).push(key)
  for (const key of beforeIdx.keys()) if (!afterIdx.has(key)) removed.push(key)
  const cap = (arr: string[]) => [...new Set(arr)].sort().slice(0, MAX_SUMMARY_TARGETS)
  return {
    kind: 'policy-bundle-change',
    pluginId: `policy-bundle:${input.bundleId}`,
    permissionDelta: {
      added: cap(added),
      removed: cap(removed),
      unchanged: cap(unchanged).slice(
        0,
        MAX_SUMMARY_TARGETS -
          Math.min(added.length, MAX_SUMMARY_TARGETS) -
          Math.min(removed.length, MAX_SUMMARY_TARGETS),
      ),
    },
    compatibilityDigestBefore: input.before ? computePluginPolicyBundleDigest(input.before) : null,
    compatibilityDigestAfter: input.after ? computePluginPolicyBundleDigest(input.after) : null,
  }
}

/** 从 diff 提取有界影响摘要（preview 展示；确定性、无 I/O）。 */
export function buildPolicyImpactSummary(
  diff: PluginChangeCanonicalDiff,
  action: PolicyImpactSummary['action'],
  bundleId: string,
): PolicyImpactSummary {
  const roles = new Set<string>()
  const ops = new Set<string>()
  const perms = new Set<string>()
  let addedTargets = 0
  let removedTargets = 0
  const consume = (keys: readonly string[], isAdd: boolean) => {
    if (isAdd) addedTargets += keys.length
    else removedTargets += keys.length
    for (const k of keys) {
      const [role, target] = k.split('|')
      if (role) roles.add(role)
      if (target?.startsWith('op:')) ops.add(target.slice(3))
      else if (target?.startsWith('perm:')) perms.add(target.slice(5))
    }
  }
  consume(diff.permissionDelta?.added ?? [], true)
  consume(diff.permissionDelta?.removed ?? [], false)
  return {
    action,
    bundleId,
    rolesAffected: [...roles].sort(),
    operationsAffected: [...ops].sort(),
    permissionKeysAffected: [...perms].sort(),
    addedTargets: Math.min(addedTargets, MAX_SUMMARY_TARGETS),
    removedTargets: Math.min(removedTargets, MAX_SUMMARY_TARGETS),
    bounded: true,
  }
}

// ── 服务 ──

@inject()
export class PluginPolicyBundleService {
  private changeFlow: PluginChangeRequestService

  constructor(changeFlow: PluginChangeRequestService) {
    this.changeFlow = changeFlow
  }

  /**
   * 从内置模板复制组织副本 v1 并发起统一变更流请求（copy 动作）。
   * 收紧性校验失败 / 模板未知 / 已存在同名副本 v1 时拒绝且不产生 request。
   */
  async requestCopyFromTemplate(input: {
    organizationId: number
    templateId: string
    requestedBy: string
    /** 副本可选初始收紧（必须仍通过 baseline 校验）；缺省为模板原样。 */
    rulesOverride?: PluginPolicyBundleRule[]
  }): Promise<
    | {
        ok: true
        requestUid: string
        document: PluginPolicyBundleDocument
        digest: string
        summary: PolicyImpactSummary
      }
    | { ok: false; code: string; message: string }
  > {
    const template = getBuiltinPluginPolicyTemplate(input.templateId)
    if (!template)
      return {
        ok: false,
        code: 'policy-template-unknown',
        message: `unknown template ${input.templateId}`,
      }

    const rawDoc: any = JSON.parse(JSON.stringify(template.document))
    rawDoc.bundleId = `org-copy.${template.templateId}`
    rawDoc.version = 1
    rawDoc.sourceTemplateId = template.templateId
    rawDoc.sourceTemplateVersion = template.templateVersion
    if (input.rulesOverride) rawDoc.rules = input.rulesOverride

    // 宿主已知 permission 集：内置模板词表即宿主封闭集（安装/注册表管理权限）
    const knownPerms = [
      'plugin_registry:view',
      'plugin_registry:submit',
      'plugin_registry:review',
      'plugin_registry:manage',
      'plugin_registry:rollback',
      'plugin_install:view',
      'plugin_install:manage',
    ]
    const validated = validatePluginPolicyBundleDocument(rawDoc, {
      knownPermissionKeys: knownPerms,
      baselineDocument: template.document,
    })
    if (!validated.valid || !validated.normalized || !validated.digest) {
      const blocking = validated.findings
        .filter((f) => f.severity === 'blocking')
        .map((f) => f.code)
      return {
        ok: false,
        code: blocking.includes('policy-template-expansion')
          ? 'policy-template-expansion'
          : 'policy-document-invalid',
        message: `org copy rejected: ${blocking.join(',')}`,
      }
    }
    const doc = validated.normalized
    const existing = await PluginPolicyBundle.findVersion(input.organizationId, doc.bundleId, 1)
    if (existing)
      return { ok: false, code: 'policy-copy-exists', message: 'org copy already exists' }
    // 防重：同一 (org,bundle) 已有未决变更请求时不重复开单（副本行确认后才落库）
    const pending = await PluginChangeRequest.query()
      .where('organization_id', input.organizationId)
      .where('kind', 'policy-bundle-change')
      .where('plugin_id', `policy-bundle:${doc.bundleId}`)
      .whereNotIn('state', [...PLUGIN_CHANGE_TERMINAL_STATES])
      .first()
    if (pending)
      return {
        ok: false,
        code: 'policy-copy-exists',
        message: 'a policy change request is already open',
      }

    const diff = buildPolicyChangeDiff({ bundleId: doc.bundleId, after: doc })
    const request = await this.changeFlow.create({
      organizationId: input.organizationId,
      projectId: null,
      kind: 'policy-bundle-change',
      pluginId: diff.pluginId!,
      requestedBy: input.requestedBy,
      targetRevision: `copy:v${doc.version}:${validated.digest}`,
      diff,
      permissionDigest: validated.digest,
      compatibilityDigest: validated.digest,
      approvalRequired: true,
    })
    const preview = await this.changeFlow.attachPreview(input.organizationId, request.requestUid)
    if (!preview.ok) return { ok: false, code: preview.code, message: preview.message }

    return {
      ok: true,
      requestUid: request.requestUid,
      document: doc,
      digest: validated.digest,
      summary: buildPolicyImpactSummary(diff, 'copy', doc.bundleId),
    }
  }

  /** 启用/停用某版本的激活（enable/disable 动作；目标版本必须已存在）。 */
  async requestActivationChange(input: {
    organizationId: number
    bundleId: string
    version: number
    action: 'enable' | 'disable'
    requestedBy: string
  }): Promise<
    | { ok: true; requestUid: string; summary: PolicyImpactSummary }
    | { ok: false; code: string; message: string }
  > {
    const versionRow = await PluginPolicyBundle.findVersion(
      input.organizationId,
      input.bundleId,
      input.version,
    )
    if (!versionRow)
      return {
        ok: false,
        code: 'policy-version-not-found',
        message: 'bundle version not found in org',
      }

    const currentActivation = await db.transaction(async (trx) =>
      PluginPolicyBundleActivation.query({ client: trx })
        .where('organization_id', input.organizationId)
        .first(),
    )
    let beforeDoc: PluginPolicyBundleDocument | null = null
    if (currentActivation && currentActivation.status === 'active') {
      const row = await PluginPolicyBundle.findVersion(
        input.organizationId,
        currentActivation.bundleId,
        currentActivation.activeVersion,
      )
      if (row) {
        beforeDoc = {
          schemaVersion: '1.0',
          bundleId: row.bundleId,
          version: row.version,
          sourceTemplateId: row.sourceTemplateId,
          sourceTemplateVersion: row.sourceTemplateVersion,
          descriptionZh: row.descriptionZh,
          rules: row.rulesJson,
        }
      }
    }
    const afterDoc =
      input.action === 'enable'
        ? ({
            schemaVersion: '1.0',
            bundleId: versionRow.bundleId,
            version: versionRow.version,
            sourceTemplateId: versionRow.sourceTemplateId,
            sourceTemplateVersion: versionRow.sourceTemplateVersion,
            descriptionZh: versionRow.descriptionZh,
            rules: versionRow.rulesJson,
          } as PluginPolicyBundleDocument)
        : null

    const diff = buildPolicyChangeDiff({
      bundleId: input.bundleId,
      before: beforeDoc as PluginPolicyBundleDocument | null,
      after: afterDoc,
    })
    const request = await this.changeFlow.create({
      organizationId: input.organizationId,
      projectId: null,
      kind: 'policy-bundle-change',
      pluginId: diff.pluginId!,
      requestedBy: input.requestedBy,
      targetRevision: `${input.action}:v${input.version}:${versionRow.documentDigest}`,
      diff,
      permissionDigest: versionRow.documentDigest,
      compatibilityDigest: versionRow.documentDigest,
      approvalRequired: true,
    })
    const preview = await this.changeFlow.attachPreview(input.organizationId, request.requestUid)
    if (!preview.ok) return { ok: false, code: preview.code, message: preview.message }

    return {
      ok: true,
      requestUid: request.requestUid,
      summary: buildPolicyImpactSummary(
        diff,
        input.action === 'enable' ? 'enable' : 'disable',
        input.bundleId,
      ),
    }
  }

  /**
   * 构造 apply delegate：同一事务内写入 bundle 版本行 + upsert 激活行 + 可信审计 receipt。
   * payload 由调用方闭包捕获（confirmAndApply 时仍与 request diff 绑定一致）。
   */
  buildApplyDelegate(payload: {
    action: 'copy' | 'enable' | 'disable'
    document: PluginPolicyBundleDocument | null
    digest: string | null
  }): ChangeApplyDelegate {
    return async ({ request, trx, executorRef }) => {
      if (payload.action !== 'disable') {
        if (!payload.document || !payload.digest)
          throw new Error('policy apply payload missing document')
        // 版本行幂等写入（唯一键兜底并发重复应用）
        const exists = await PluginPolicyBundle.query({ client: trx })
          .where('organization_id', request.organizationId)
          .where('bundle_id', payload.document.bundleId)
          .where('version', payload.document.version)
          .first()
        if (!exists) {
          await PluginPolicyBundle.create(
            {
              organizationId: request.organizationId,
              bundleId: payload.document.bundleId,
              sourceTemplateId: payload.document.sourceTemplateId ?? 'member-readonly',
              sourceTemplateVersion: payload.document.sourceTemplateVersion ?? 1,
              version: payload.document.version,
              descriptionZh: payload.document.descriptionZh,
              rulesJson: payload.document.rules,
              documentDigest: payload.digest,
            },
            { client: trx },
          )
        }
      }
      // upsert 激活行（每组织唯一；CAS row_version 防并发激活）
      const activation = await PluginPolicyBundleActivation.query({ client: trx })
        .where('organization_id', request.organizationId)
        .first()
      if (payload.action === 'disable') {
        if (activation) {
          const casd = (await PluginPolicyBundleActivation.query({ client: trx })
            .where('id', activation.id)
            .where('row_version', activation.rowVersion)
            .update({
              status: 'disabled',
              revision: activation.revision + 1,
              row_version: activation.rowVersion + 1,
              activated_by: executorRef,
              activated_at: DateTime.now().toSQL(),
            })) as unknown as number
          if (casd === 0) throw new Error('activation concurrent modification')
        }
      } else {
        if (!payload.document) throw new Error('activation requires document')
        if (activation) {
          const casd = (await PluginPolicyBundleActivation.query({ client: trx })
            .where('id', activation.id)
            .where('row_version', activation.rowVersion)
            .update({
              bundle_id: payload.document.bundleId,
              active_version: payload.document.version,
              status: 'active',
              revision: activation.revision + 1,
              row_version: activation.rowVersion + 1,
              activated_by: executorRef,
              activated_at: DateTime.now().toSQL(),
            })) as unknown as number
          if (casd === 0) throw new Error('activation concurrent modification')
        } else {
          await PluginPolicyBundleActivation.create(
            {
              organizationId: request.organizationId,
              bundleId: payload.document.bundleId,
              activeVersion: payload.document.version,
              status: 'active',
              revision: 1,
              rowVersion: 1,
              activatedBy: executorRef,
              activatedAt: DateTime.now(),
            },
            { client: trx },
          )
        }
      }
      return await appendTrustedChangeAuditReceipt({
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: null,
        // audit_logs.action 为封闭词表（1768850000000），复用生命周期动词 apply；
        // 策略语义经 metadata.kind/action 低敏区分。
        action: 'apply',
        requestUid: request.requestUid,
        metadata: {
          domain: 'plugin-policy-bundle',
          flowKind: request.kind,
          policyAction: payload.action,
          bundleId: payload.document?.bundleId ?? request.targetRevision.split(':')[0],
          documentDigest: payload.digest,
          executorRef,
        },
        client: trx,
      })
    }
  }

  /**
   * security gate 快照入口：读取激活行 + 版本行 → verified snapshot。
   * absent = 未启用/已禁用（gate 回退既有逐项授权）；corrupt = 解析/digest 失败
   * （enforcement 下 gate 必须 deny 高风险操作，绝不回退 allow-all）。
   */
  async loadVerifiedSnapshot(
    organizationId: number,
    trx?: TransactionClientContract,
  ): Promise<LoadedPolicySnapshot> {
    try {
      const activation = await PluginPolicyBundleActivation.query(trx ? { client: trx } : undefined)
        .where('organization_id', organizationId)
        .first()
      if (!activation || activation.status !== 'active') return { state: 'absent' }
      const versionRow = await PluginPolicyBundle.findVersion(
        organizationId,
        activation.bundleId,
        activation.activeVersion,
      )
      if (!versionRow) return { state: 'corrupt', reasonCode: 'policy-snapshot-invalid' }
      const document: PluginPolicyBundleDocument = {
        schemaVersion: '1.0',
        bundleId: versionRow.bundleId,
        version: versionRow.version,
        sourceTemplateId: versionRow.sourceTemplateId,
        sourceTemplateVersion: versionRow.sourceTemplateVersion,
        descriptionZh: versionRow.descriptionZh,
        rules: versionRow.rulesJson,
      }
      const check = validatePluginPolicyBundleDocument(document)
      const snapshot = createVerifiedPluginPolicySnapshot({
        document,
        revision: activation.revision,
        activatedAt: versionRow.createdAt.toISO() ?? DateTime.now().toISO(),
        organizationScope: `org:${organizationId}`,
      })
      const verify = verifyPluginPolicySnapshot(snapshot, {
        organizationScope: `org:${organizationId}`,
      })
      if (!check.valid || !verify.valid || snapshot.digest !== versionRow.documentDigest) {
        return { state: 'corrupt', reasonCode: verify.reasonCode ?? 'policy-snapshot-invalid' }
      }
      return { state: 'ok', snapshot }
    } catch {
      return { state: 'corrupt', reasonCode: 'policy-snapshot-invalid' }
    }
  }
}

export default PluginPolicyBundleService
