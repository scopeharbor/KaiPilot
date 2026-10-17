/**
 * OCR 权限/审计 —— 下游敏感复用边界守卫（v3-ocr-permission-and-audit §6.13–6.14）
 *
 * 在 OCR privacy copy/export 与 optional AI handoff 的敏感复用边界调用
 * `OcrPermissionAuditResolver.resolve`，依据返回的决策快照 `result` 决定是否放行：
 * - allow / confirm_required → 继续走模块自身逻辑（不得绕过其 preview/确认/idempotency 契约）
 * - 其余（denied / metadata_only / stale_blocked / retention_blocked / privacy_blocked）
 *   → 阻止敏感复用，返回低敏原因码/降级，并写低敏审计（writeOcrBoundaryAudit）
 *
 * 隐私能力（v3-ocr-privacy-policy-controls）已落地：copy/export 的隐私决策由
 * `OcrPrivacyCopyExportService` 自身消费（本守卫不重复判定隐私规则，只做权限门）。
 * optional AI handoff 未落地：用守卫式降级（capability_unavailable / degraded），
 * 并额外要求 `ai:trigger` 权限（避免 OCR 内容未经许可进入 AI 模型）。
 *
 * 红线：不调用真实 provider/model；不自动写正式项目数据；不改写通用 RBAC/AuditLog；
 * 不破坏 copy/export 既有的 preview/确认/idempotency；前端权限声明不可信。
 */
import {
  buildDecisionSnapshot,
  type OcrArtifactRef,
  type OcrAuthorizationDecisionSnapshot,
  type OcrPermissionAction,
  type OcrPermissionReasonCode,
  type OcrPrivacyCopyExportExecuteInput,
  type OcrPrivacyCopyExportPreviewInput,
  type OcrPrivacyCopyExportPreviewResponse,
  type OcrPrivacyCopyExportRun,
  type OcrPrivacyPolicy,
  type OcrSourceRef,
} from '@aiproj/types'
import type { Permission } from '#rbac'
import AuditService from '#services/audit_service'
import { OcrPermissionAuditResolver } from './ocr_permission_audit_resolver.js'
import {
  buildOcrPermissionAuditEntry,
  writeOcrBoundaryAudit,
} from './ocr_permission_audit_logger.js'
import {
  DefaultProjectMembershipAdapter,
  type OcrProjectMembershipAdapter,
} from './ocr_permission_audit_adapters.js'
import { OcrPrivacyCopyExportService } from './ocr_privacy_copy_export_service.js'

/** 守卫输入的范围上下文（低敏：仅 actor/项目/来源引用与哈希）。 */
export interface OcrDownstreamGuardContext {
  readonly actorId: number
  readonly organizationId: number
  readonly projectId: number
  readonly sourceRef?: OcrSourceRef | null
  readonly artifactRef?: OcrArtifactRef | null
  readonly sourceHash?: string | null
}

/** 阻止敏感复用时的低敏降级描述（不含任何敏感载荷）。 */
export interface OcrDownstreamBlocked {
  readonly result: OcrAuthorizationDecisionSnapshot['result']
  readonly reasonCodes: readonly OcrPermissionReasonCode[]
  readonly outputMode: OcrAuthorizationDecisionSnapshot['outputMode']
  readonly decisionHash: string
  readonly degraded: boolean
}

/** 守卫结果：放行（data）或阻止（blocked）。 */
export type OcrDownstreamGuardResult<T> =
  | { readonly allowed: true; readonly data: T }
  | { readonly allowed: false; readonly blocked: OcrDownstreamBlocked }

/** optional AI handoff 预览（占位：能力未落地，本 change 不构造）。 */
export interface OcrAiHandoffPreview {
  readonly handoffPreviewHash: string
  readonly recordCount: number
  readonly estimatedCharacters: number
}

export interface OcrDownstreamGuardDeps {
  readonly resolver?: OcrPermissionAuditResolver
  readonly copyExport?: OcrPrivacyCopyExportService
  readonly audit?: AuditService
  readonly membership?: OcrProjectMembershipAdapter
  /** optional AI handoff 能力是否已落地（本 change 恒 false，未强制接入）。 */
  readonly aiHandoffAvailable?: boolean
}

export class OcrPermissionDownstreamGuard {
  readonly #resolver: OcrPermissionAuditResolver
  readonly #copyExport: OcrPrivacyCopyExportService
  readonly #audit: AuditService
  readonly #membership: OcrProjectMembershipAdapter
  readonly #aiHandoffAvailable: boolean

  constructor(deps: OcrDownstreamGuardDeps = {}) {
    this.#resolver = deps.resolver ?? new OcrPermissionAuditResolver()
    this.#copyExport = deps.copyExport ?? new OcrPrivacyCopyExportService()
    this.#audit = deps.audit ?? new AuditService()
    this.#membership = deps.membership ?? new DefaultProjectMembershipAdapter()
    this.#aiHandoffAvailable = deps.aiHandoffAvailable ?? false
  }

  /**
   * 守卫：OCR 隐私复制/导出预览。
   * 放行后仍走 `OcrPrivacyCopyExportService.preview` 自身的策略/格式/计数/文本长度校验。
   */
  async guardCopyExportPreview(
    input: OcrPrivacyCopyExportPreviewInput,
    policy: OcrPrivacyPolicy,
    extractions: Array<{
      id: number
      sourceHash: string | null
      textLength: number
      pageCount: number
      lifecycleState: string
      holdActive: boolean
    }>,
    ctx: OcrDownstreamGuardContext,
  ): Promise<OcrDownstreamGuardResult<OcrPrivacyCopyExportPreviewResponse>> {
    const gate = await this.#gate('copy_export_preview', ctx)
    if (!gate.allowed) return { allowed: false, blocked: gate.blocked }
    const preview = this.#copyExport.preview(input, policy, extractions)
    return { allowed: true, data: preview }
  }

  /**
   * 守卫：OCR 隐私复制/导出执行。
   * 放行后仍走 `OcrPrivacyCopyExportService.execute` 自身的预览哈希重校验、
   * 显式确认 token 与幂等 Key 复用契约。
   */
  async guardCopyExportExecute(
    input: OcrPrivacyCopyExportExecuteInput,
    policy: OcrPrivacyPolicy,
    extractions: Array<{
      id: number
      sourceHash: string | null
      textLength: number
      pageCount: number
    }>,
    confirmedBy: number | null,
    ctx: OcrDownstreamGuardContext,
  ): Promise<OcrDownstreamGuardResult<OcrPrivacyCopyExportRun>> {
    const gate = await this.#gate('copy_export_execution', ctx)
    if (!gate.allowed) return { allowed: false, blocked: gate.blocked }
    const run = await this.#copyExport.execute(input, policy, extractions, confirmedBy)
    return { allowed: true, data: run }
  }

  /**
   * 守卫：optional AI handoff。
   * 本 change 能力未落地：即便 resolver 放行（confirm_required），仍以守卫式降级
   * 返回 `capability_unavailable` / `degraded`，并写低敏 `OCR_PERMISSION_AI_HANDOFF_BLOCK` 审计。
   * 额外门控 `ai:trigger` 权限，避免未授权的 OCR 内容触发 AI 模型。
   */
  async guardAiHandoff(
    _input: unknown,
    ctx: OcrDownstreamGuardContext,
  ): Promise<OcrDownstreamGuardResult<OcrAiHandoffPreview>> {
    const gate = await this.#gate('optional_ai_handoff', ctx)
    if (!gate.allowed) return { allowed: false, blocked: gate.blocked }

    // 能力未落地：确定性降级（先门控 ai:trigger，再判能力是否可用）。
    const blocked = await this.#degradeAiHandoff(gate.snapshot, ctx)
    return { allowed: false, blocked }
  }

  /** 统一门控：resolver 决策 → 放行或写低敏边界审计。 */
  async #gate(
    action: OcrPermissionAction,
    ctx: OcrDownstreamGuardContext,
  ): Promise<
    | { allowed: true; snapshot: OcrAuthorizationDecisionSnapshot }
    | { allowed: false; blocked: OcrDownstreamBlocked }
  > {
    const snapshot = await this.#resolver.resolve({
      actorId: ctx.actorId,
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      action,
      sourceRef: ctx.sourceRef ?? null,
      artifactRef: ctx.artifactRef ?? null,
      sourceHash: ctx.sourceHash ?? null,
    })
    if (snapshot.result === 'allow' || snapshot.result === 'confirm_required') {
      return { allowed: true, snapshot }
    }
    await writeOcrBoundaryAudit(this.#audit, snapshot)
    return { allowed: false, blocked: toBlocked(snapshot) }
  }

  /** AI handoff 守卫式降级：判定原因码并写低敏审计。 */
  async #degradeAiHandoff(
    snapshot: OcrAuthorizationDecisionSnapshot,
    ctx: OcrDownstreamGuardContext,
  ): Promise<OcrDownstreamBlocked> {
    // 1) ai:trigger 门控：缺少该权限 → 阻止（permission_missing + degraded）。
    const membership = await this.#membership.resolveMembership(
      ctx.actorId,
      ctx.organizationId,
      ctx.projectId,
    )
    if (!membership.permissions.has('ai:trigger' as Permission)) {
      return this.#writeAiHandoffBlock(snapshot, ['permission_missing', 'degraded'])
    }
    // 2) 能力未落地 → capability_unavailable + degraded。
    if (!this.#aiHandoffAvailable) {
      return this.#writeAiHandoffBlock(snapshot, ['capability_unavailable', 'degraded'])
    }
    // 3) 能力已落地（后续 handoff 服务接入后在此分支执行真实 handoff）。
    return this.#writeAiHandoffBlock(snapshot, ['capability_unavailable', 'degraded'])
  }

  /** 构造降级快照并写一条低敏 AI handoff 阻止审计。 */
  async #writeAiHandoffBlock(
    snapshot: OcrAuthorizationDecisionSnapshot,
    reasonCodes: readonly OcrPermissionReasonCode[],
  ): Promise<OcrDownstreamBlocked> {
    const degraded = buildDecisionSnapshot({
      action: snapshot.action,
      result: 'degraded',
      requiredPermission: snapshot.requiredPermission,
      grantedPermissionSource: snapshot.grantedPermissionSource,
      roleVersion: snapshot.roleVersion,
      actorRef: snapshot.actorRef,
      organizationRef: snapshot.organizationRef,
      projectRef: snapshot.projectRef,
      sourceRef: snapshot.sourceRef,
      artifactRef: snapshot.artifactRef,
      sourceHash: snapshot.sourceHash,
      lifecycleState: snapshot.lifecycleState,
      retentionState: snapshot.retentionState,
      holdActive: snapshot.holdActive,
      staleStatus: snapshot.staleStatus,
      privacyRef: snapshot.privacyRef,
      privacyHash: snapshot.privacyHash,
      outputMode: 'blocked',
      requiresConfirmation: false,
      reasonCodes,
    })
    await this.#audit.log(
      buildOcrPermissionAuditEntry({
        event: 'OCR_PERMISSION_AI_HANDOFF_BLOCK',
        snapshot: degraded,
      }),
    )
    return toBlocked(degraded)
  }
}

/** 低敏阻止描述：仅取枚举码 / 哈希 / 输出模式。 */
function toBlocked(snapshot: OcrAuthorizationDecisionSnapshot): OcrDownstreamBlocked {
  return {
    result: snapshot.result,
    reasonCodes: snapshot.reasonCodes,
    outputMode: snapshot.outputMode,
    decisionHash: snapshot.decisionHash,
    degraded: snapshot.result === 'degraded',
  }
}
