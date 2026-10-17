// @aiproj/backend — TenantSelectionSnapshotService（v3-multitenant-tenant-identification §7）。
//
// spec「Background work MUST carry tenant selection snapshots」：租户作用域的后台作业、
// 批量预览、导出构建器、AI/Compiler 续跑与确认流必须携带低敏 tenant selection snapshot；
// worker 在**任何副作用之前**（写库、生成制品、调 provider、发通知、写 ledger、更新状态）
// 必须重新解析有效租户。
//
// 与 `TenantJobScopeService`（isolation 层）的分工：那一层校验 job payload 的 scope 声明
// 与派生制品命名空间；本服务校验「签发这份快照的那个人，现在还属于那个组织吗」——
// 即 membership freshness 与 selection epoch，这是识别层的事实。
//
// 三道复核（缺一不可，全部 fail closed）：
//   1. **membership freshness**：`TenantResolutionService.revalidateSnapshot` 重查成员/角色/
//      组织状态，比对 `membershipVersionHash`（成员被移除、角色降权、组织删除 → stale）；
//   2. **selection epoch 栅栏**：比对快照 epoch 与服务端当前 epoch（组织切换过就 stale，
//      **包括切回原组织**——那时 scope hash 复原，只有 epoch 拦得住）；
//   3. **跨租重放**：快照组织与当前有效租户组织不一致 → 拒绝，且不产生任何目标副作用。
//
// 低敏保证（§7.5）：快照只含 actorRef / 组织 ID / 枚举 / hash / requestId / idempotencyKey /
// 时间戳与 epoch。落 job payload 与日志前用 `sanitizeForPayload` 再过一道 forbidden key 扫描。

import { inject } from '@adonisjs/core'
import TenantResolutionService from './tenant_resolution_service.js'
import TenantSelectionStateService from './tenant_selection_state_service.js'
import TenantSelectionInvalidationService from './tenant_selection_invalidation_service.js'
import TenantIdentificationAuditService from './tenant_identification_audit_service.js'
import {
  buildTenantSelectionSnapshot,
  hasTenantIdForbiddenKeys,
  type EffectiveTenantContext,
  type TenantResolutionReason,
  type TenantSelectionSnapshot,
} from '@aiproj/types/multitenant-tenant-identification'

/** 快照复核结果（低敏）。 */
export interface TenantSnapshotRevalidation {
  ok: boolean
  /** 重新解析出的当前有效租户决定（失败时为失败决定，携带 reason）。 */
  context: EffectiveTenantContext
  reason: TenantResolutionReason
  /** 哪一道复核否掉的（供排查，低敏枚举）。 */
  failedCheck: 'membership' | 'epoch' | 'replay' | null
}

@inject()
export default class TenantSelectionSnapshotService {
  // 依赖都能无参构造，故给默认值：既支持容器注入，也支持
  // `new TenantSelectionSnapshotService()` 这种在既有 Service 里就地组装的用法
  //（如 ReportExportService，它的构造签名不属本 change，不宜为一个可选依赖改破坏性）。
  constructor(
    private resolution: TenantResolutionService = new TenantResolutionService(),
    private selectionState: TenantSelectionStateService = new TenantSelectionStateService(),
    private invalidation: TenantSelectionInvalidationService = new TenantSelectionInvalidationService(),
    private identificationAudit: TenantIdentificationAuditService = new TenantIdentificationAuditService(),
  ) {}

  /**
   * 为后台作业 / 批量预览 / 导出构建器 / AI-Compiler 续跑句柄创建 selection snapshot（§7.1）。
   *
   * epoch 从服务端 selection state 现读，不接受调用方传入——否则调用方可以塞一个
   * 永不过期的值，栅栏就形同虚设。
   */
  async createForBackgroundWork(params: {
    context: EffectiveTenantContext
    permissionSnapshotHash: string
    sourceRefs: string[]
    idempotencyKey: string
    requestId: string
  }): Promise<TenantSelectionSnapshot> {
    const userId = this.userIdOf(params.context.actorRef)
    const selectionEpoch = userId === null ? null : await this.selectionState.currentEpoch(userId)

    return buildTenantSelectionSnapshot({
      context: params.context,
      permissionSnapshotHash: params.permissionSnapshotHash,
      sourceRefs: params.sourceRefs,
      idempotencyKey: params.idempotencyKey,
      requestId: params.requestId,
      selectionEpoch,
    })
  }

  /**
   * worker 在任何副作用之前复核快照（§7.2）。
   *
   * `currentDecision` 可选：确认流（同一请求里带着当前 effective tenant）传入以做第三道
   * 跨租重放检查；纯后台 worker（无请求上下文）不传，此时前两道仍然生效。
   */
  async revalidateBeforeSideEffect(params: {
    snapshot: TenantSelectionSnapshot
    currentDecision?: EffectiveTenantContext | null
    operation: string
  }): Promise<TenantSnapshotRevalidation> {
    const { snapshot } = params

    // 第三道先跑：跨租重放最廉价也最该早拒（省掉一次查库）。
    if (
      params.currentDecision &&
      snapshot.organizationId !== null &&
      params.currentDecision.organizationId !== snapshot.organizationId
    ) {
      const failed = this.failDecision(snapshot, 'REPLAY_REJECTED')
      await this.auditRejection(snapshot, failed, params.operation, 'replay')
      return { ok: false, context: failed, reason: 'REPLAY_REJECTED', failedCheck: 'replay' }
    }

    // 第一道：membership freshness（重查成员/角色/组织状态）。
    const revalidated = await this.resolution.revalidateSnapshot({
      actorRef: snapshot.actorRef,
      organizationId: snapshot.organizationId,
      expectedMembershipVersionHash: snapshot.membershipVersionHash ?? null,
    })
    if (!revalidated.ok) {
      // 统一不变量：交给 worker 的失败决定**不携带具体组织**。
      // `TenantResolutionService` 的失败决定会保留 JWT 声明的组织（供中间件按 reason
      // 决定是否挂 `ctx.tenant`），但 worker 侧没有那个语义——它只该看到"不可用"，
      // 否则一个 stale 决定里的组织可能被当成已解析租户继续用下去。
      const failed = { ...this.failDecision(snapshot, revalidated.context.resolutionReason) }
      await this.auditRejection(snapshot, failed, params.operation, 'membership')
      return {
        ok: false,
        context: failed,
        reason: revalidated.context.resolutionReason,
        failedCheck: 'membership',
      }
    }

    // 第二道：selection epoch 栅栏。
    const userId = this.userIdOf(snapshot.actorRef)
    const currentEpoch = userId === null ? 0 : await this.selectionState.currentEpoch(userId)
    const fresh = this.invalidation.isSelectionFresh({
      handleEpoch: snapshot.selectionEpoch ?? null,
      currentEpoch,
      handleOrganizationId: snapshot.organizationId,
      currentOrganizationId: revalidated.context.organizationId,
    })
    if (!fresh) {
      const failed = this.failDecision(snapshot, 'MEMBERSHIP_STALE')
      await this.auditRejection(snapshot, failed, params.operation, 'epoch')
      return { ok: false, context: failed, reason: 'MEMBERSHIP_STALE', failedCheck: 'epoch' }
    }

    return {
      ok: true,
      context: revalidated.context,
      reason: revalidated.context.resolutionReason,
      failedCheck: null,
    }
  }

  /**
   * 断言快照可用于产生副作用；不可用则抛错，调用方（worker/确认流）不得继续（§7.3）。
   *
   * 刻意抛 `Error` 而非 HTTP 异常：worker 不在 HTTP 上下文里；HTTP 确认流应捕获它并
   * 转成注册过的非泄露错误（404/409），避免把内部 reason 直接透给调用方。
   */
  async assertUsableForSideEffect(params: {
    snapshot: TenantSelectionSnapshot
    currentDecision?: EffectiveTenantContext | null
    operation: string
  }): Promise<EffectiveTenantContext> {
    const result = await this.revalidateBeforeSideEffect(params)
    if (!result.ok) {
      throw new Error(`租户选择快照已失效：${result.reason}`)
    }
    return result.context
  }

  /**
   * 把快照收敛成可安全写进 job payload / 日志的低敏对象（§7.5）。
   *
   * 白名单式拷贝（而非删黑名单字段）：将来给快照加字段时，不会因为忘记加进黑名单
   * 而把敏感值漏进 payload。最后再跑一次 forbidden key 扫描兜底。
   */
  sanitizeForPayload(snapshot: TenantSelectionSnapshot): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      schemaVersion: snapshot.schemaVersion,
      actorRef: snapshot.actorRef,
      organizationId: snapshot.organizationId,
      projectId: snapshot.projectId ?? null,
      scopeMode: snapshot.scopeMode,
      selectionSource: snapshot.selectionSource,
      resolutionReason: snapshot.resolutionReason,
      membershipVersionHash: snapshot.membershipVersionHash ?? null,
      scopeHash: snapshot.scopeHash,
      permissionSnapshotHash: snapshot.permissionSnapshotHash,
      sourceRefs: [...snapshot.sourceRefs],
      idempotencyKey: snapshot.idempotencyKey,
      requestId: snapshot.requestId,
      issuedAt: snapshot.issuedAt,
      selectionEpoch: snapshot.selectionEpoch ?? null,
    }
    if (hasTenantIdForbiddenKeys(payload)) {
      throw new Error('租户选择快照包含禁止字段，拒绝写入 job payload')
    }
    return payload
  }

  private userIdOf(actorRef: string): number | null {
    const raw = Number(actorRef.split(':')[1] ?? '')
    return Number.isFinite(raw) && raw > 0 ? raw : null
  }

  private failDecision(
    snapshot: TenantSelectionSnapshot,
    reason: TenantResolutionReason,
  ): EffectiveTenantContext {
    return {
      actorRef: snapshot.actorRef,
      // 失败决定不携带具体组织：下游不得把它当成"已解析租户"使用。
      organizationId: null,
      projectId: null,
      membershipRole: null,
      membershipVersionHash: null,
      scopeMode: snapshot.scopeMode,
      selectionSource: 'server_selection',
      resolutionReason: reason,
      scopeHash: snapshot.scopeHash,
      resolvedAt: new Date().toISOString(),
      warningCodes: ['REPLAY_STALE_OR_INVALID'],
      isSuperAdmin: false,
    }
  }

  private async auditRejection(
    snapshot: TenantSelectionSnapshot,
    context: EffectiveTenantContext,
    operation: string,
    failedCheck: 'membership' | 'epoch' | 'replay',
  ): Promise<void> {
    const base = {
      actorRef: snapshot.actorRef,
      userId: this.userIdOf(snapshot.actorRef),
      // 记 actor 自己的 scope，不记重放目标的归属。
      organizationId: context.organizationId,
      projectId: null,
      scopeMode: snapshot.scopeMode,
      selectionSource: snapshot.selectionSource,
      resolutionReason: context.resolutionReason,
      scopeHash: snapshot.scopeHash,
      operation: `job.${operation}`,
      requestId: snapshot.requestId,
      idempotencyKey: snapshot.idempotencyKey,
    }
    if (failedCheck === 'replay') {
      await this.identificationAudit.recordDenial(base)
      return
    }
    await this.identificationAudit.recordStale(base)
  }
}
