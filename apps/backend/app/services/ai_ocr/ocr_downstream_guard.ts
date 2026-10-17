import type AuditService from '#services/audit_service'
import { PermissionDeniedException } from '#exceptions/api_exception'
import {
  OcrPermissionAuditResolver,
  type OcrResolveInput,
} from './ocr_permission_audit_resolver.js'
import { writeOcrBoundaryAudit } from './ocr_permission_audit_logger.js'
import type { OcrAuthorizationDecisionSnapshot } from '@aiproj/types'

/**
 * OCR 下游集成守卫（v3-ocr-permission-and-audit §6）
 *
 * 在敏感复用边界（即将暴露或复用敏感 OCR 内容处）调用 `OcrPermissionAuditResolver`
 * 解析授权决策快照，依据 `result` 决定是否放行：
 * - `allow` / `confirm_required` → 继续（仍需目标模块自身 preview/确认/idempotency 契约）。
 * - `denied` / `stale_blocked` / `retention_blocked` / `privacy_blocked` → 阻止敏感复用，
 *   写一条低敏边界审计并抛 `PermissionDeniedException`。
 * - `metadata_only` → 默认阻止；`allowMetadataOnly` 为 true 时放行（用于保留管理/状态等
 *   仅元数据路径，满足「敏感复用被阻断但 metadata-only 状态仍可读」）。
 *
 * 红线：不调用真实 provider/model；不自动写正式项目数据；不以 `metadata_only` 泄露敏感内容。
 * 前端权限声明不可信，一律以服务端 resolver 输出为准。
 */
export interface OcrDownstreamGuardOptions {
  /** 是否把 `metadata_only` 视为放行（保留管理/状态等仅元数据路径）。 */
  readonly allowMetadataOnly?: boolean
}

export class OcrDownstreamGuard {
  readonly #audit: AuditService
  readonly #resolver: OcrPermissionAuditResolver

  constructor(
    audit: AuditService,
    resolver: OcrPermissionAuditResolver = new OcrPermissionAuditResolver(),
  ) {
    this.#audit = audit
    this.#resolver = resolver
  }

  /**
   * 静默守卫：返回快照供调用方决定动作，不抛异常。
   * 放行集：allow / confirm_required（/ 可选 metadata_only）。
   */
  async resolve(
    input: OcrResolveInput,
    // 放行集判定在 isAllowed 里做，本方法只回传原始快照；
    // 保留形参是为了与 guard(input, options) 调用形态一致。
    _options: OcrDownstreamGuardOptions = {},
  ): Promise<OcrAuthorizationDecisionSnapshot> {
    return this.#resolver.resolve(input)
  }

  /** 是否放行该决策快照。 */
  isAllowed(
    snapshot: OcrAuthorizationDecisionSnapshot,
    options: OcrDownstreamGuardOptions = {},
  ): boolean {
    return (
      snapshot.result === 'allow' ||
      snapshot.result === 'confirm_required' ||
      (options.allowMetadataOnly === true && snapshot.result === 'metadata_only')
    )
  }

  /**
   * 守卫式解析：解析决策；若被拒则写低敏边界审计并抛 `PermissionDeniedException`。
   * 返回放行快照（供调用方继续走模块自身逻辑）。
   */
  async guard(
    input: OcrResolveInput,
    options: OcrDownstreamGuardOptions = {},
  ): Promise<OcrAuthorizationDecisionSnapshot> {
    const snapshot = await this.#resolver.resolve(input)
    if (this.isAllowed(snapshot, options)) return snapshot
    await writeOcrBoundaryAudit(this.#audit, snapshot)
    throw new PermissionDeniedException('OCR 权限/审计守卫阻止该操作', {
      details: { reasonCodes: snapshot.reasonCodes },
    })
  }
}
