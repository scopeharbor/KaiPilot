// @aiproj/backend — TenantBoundaryGateService（v3-multitenant-isolation-architecture §6.2）。
//
// spec「Isolation runs before provider call」：任何会调用 AI / OCR / Webhook /
// Web Push / 外部集成 provider，或触发 DLP、水印、KMS 解密的流程，都必须**先**完成
// 租户 scope 与资源可见性校验；校验失败必须阻止 provider 调用本身，而不是
// "先调用再丢弃结果"（后者已经把租户数据送出边界，且会产生外部副作用与计费）。
//
// 用法：把 adapter 调用包进 `runAfterIsolation`，闭包只在门禁通过后才执行。
// 这样"失败即零调用"可以被测试直接断言（mock adapter 的调用计数为 0）。
//
// 本 service 不替代各能力自己的 RBAC 与预览/确认契约（见 §6.5），只保证
// 租户边界在最外层、且先于外部边界发生。

import { PermissionDeniedException } from '#exceptions/api_exception'
import {
  buildMultitenantAuditMetadata,
  isBatchSameTenant,
  type MultitenantAuditMetadata,
  type MultitenantOperationType,
  type MultitenantReasonCode,
  type MultitenantResourceType,
} from '@aiproj/types/multitenant-isolation-architecture'
import TenantScopeRegistry from './tenant_scope_registry.js'

export interface TenantBoundaryCheck {
  /** 服务端解析出的组织 scope；null/undefined/非正整数一律 fail closed。 */
  organizationId: number | null | undefined
  resourceType: MultitenantResourceType
  operationType: MultitenantOperationType
  actorRef: string
  requestId: string
  /**
   * 调用方在 scope 内解析出的引用归属组织列表（可为空）。
   * 只要有一个不属于当前组织，整体拒绝——provider 不得被调用。
   */
  resolvedOwners?: Array<number | string>
  /**
   * 声明这是显式全局操作（super admin 低敏全局）；
   * 必须经 registry 的 `allowSuperAdminGlobal` 显式许可，否则拒绝。
   */
  requiresGlobal?: boolean
  projectId?: number | null
  idempotencyKey?: string | null
}

export interface TenantBoundaryDenial {
  reasonCode: MultitenantReasonCode
  /** 低敏审计元数据，可直接落审计（不含隐藏资源名/计数/provider payload）。 */
  audit: MultitenantAuditMetadata
}

export class TenantBoundaryDeniedError extends PermissionDeniedException {
  constructor(readonly denial: TenantBoundaryDenial) {
    super('操作被拒绝')
  }
}

export default class TenantBoundaryGateService {
  /**
   * 纯判定：返回 null 表示通过，否则返回低敏拒绝信息。
   * 判定顺序 fail closed，且不区分"资源不存在"与"跨租户"。
   */
  evaluate(check: TenantBoundaryCheck): TenantBoundaryDenial | null {
    const organizationId = Number(check.organizationId)

    if (
      check.organizationId === null ||
      check.organizationId === undefined ||
      !Number.isInteger(organizationId) ||
      organizationId <= 0
    ) {
      return this.deny(check, 'NO_TENANT_CONTEXT', 0)
    }

    if (check.requiresGlobal) {
      try {
        TenantScopeRegistry.assertGlobalAllowed(check.resourceType)
      } catch {
        return this.deny(check, 'GLOBAL_NOT_ALLOWED', organizationId)
      }
    }

    const status = TenantScopeRegistry.statusOf(check.resourceType)
    if (status === 'unsupported') {
      return this.deny(check, 'UNSUPPORTED_RESOURCE', organizationId)
    }

    if (check.resolvedOwners && check.resolvedOwners.length > 0) {
      const verdict = isBatchSameTenant({
        currentOrganizationId: organizationId,
        resolvedOwners: check.resolvedOwners,
      })
      if (verdict.decision !== 'allow') {
        return this.deny(check, 'MIXED_TENANT_REFERENCE', organizationId)
      }
    }

    return null
  }

  /** 抛出版：拒绝时统一 PERMISSION_DENIED，reason code 只进审计元数据不进 message。 */
  assertBoundary(check: TenantBoundaryCheck): void {
    const denial = this.evaluate(check)
    if (denial) {
      throw new TenantBoundaryDeniedError(denial)
    }
  }

  /**
   * 隔离通过后才执行外部边界调用。
   *
   * `invoke` 是 AI/OCR/Webhook/Web Push/KMS decrypt/DLP/水印 adapter 的调用闭包：
   * 门禁不通过时**绝不执行**它——这是"失败阻止 provider 调用"的落点。
   */
  async runAfterIsolation<T>(check: TenantBoundaryCheck, invoke: () => Promise<T>): Promise<T> {
    this.assertBoundary(check)
    return invoke()
  }

  /**
   * 判定 + 不抛出的分流版：返回 `{ allowed, denial, value }`。
   * `invoke` 同样只在 allowed 时执行。
   */
  async tryAfterIsolation<T>(
    check: TenantBoundaryCheck,
    invoke: () => Promise<T>,
  ): Promise<{ allowed: boolean; denial: TenantBoundaryDenial | null; value: T | null }> {
    const denial = this.evaluate(check)
    if (denial) {
      return { allowed: false, denial, value: null }
    }
    return { allowed: true, denial: null, value: await invoke() }
  }

  private deny(
    check: TenantBoundaryCheck,
    reasonCode: MultitenantReasonCode,
    organizationId: number,
  ): TenantBoundaryDenial {
    return {
      reasonCode,
      audit: buildMultitenantAuditMetadata({
        actorRef: check.actorRef,
        organizationId,
        projectId: check.projectId ?? null,
        resourceType: check.resourceType,
        operationType: check.operationType,
        reasonCode,
        decision: 'deny',
        requestId: check.requestId,
        idempotencyKey: check.idempotencyKey ?? null,
      }),
    }
  }
}
