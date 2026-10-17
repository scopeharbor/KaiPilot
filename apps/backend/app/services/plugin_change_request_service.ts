/**
 * v3-plugin-approval-change-flow —— PluginChangeRequestService（统一变更请求状态机服务）。
 *
 * 职责（design.md D1~D5）：
 * 1. 持久化统一 PluginChangeRequest（install / permission-upgrade / version-upgrade 共用）。
 * 2. 阶段不可跳跃：preview →（策略要求时）审批 → 显式确认 → 核心事务提交 → 可信审计。
 *    审批 ≠ 确认：approve 与 confirm 是两条独立事件与权限。
 * 3. CAS 决策：所有状态推进以 rowVersion compare-and-swap 执行，并发失败返回 stale。
 * 4. 一次性确认句柄：服务器签发有界 digest，绑定 request/actor/org/project/revision/digest/expiresAt；
 *    客户端只回传句柄字符串，authority 字段全部由服务端重建校验。
 * 5. 提交门：领域提交与可信审计 receipt 在同一事务内完成；apply 失败落 failed（可重试、不重复应用）。
 *
 * 本服务不理解安装或 registry 内部字段；领域提交经 applyDelegate 委托既有 service transaction
 * （design.md D2），领域校验错误保持各 adapter 独立 reason code。
 */
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import AuditLog from '#models/audit_log'
import PluginChangeRequest from '#models/plugin_change_request'
import PluginChangeDecision from '#models/plugin_change_decision'
import {
  buildChangeConfirmHandle,
  computeChangeDecisionId,
  computeChangeDiffDigest,
  computeChangeHandleCoreDigest,
  isChangeRequestExpired,
  isChangeTerminalState,
  sanitizeChangeForAudit,
  transitionChangeRequestState,
  checkMakerCheckerForChange,
  type PluginChangeAuditReceipt,
  type PluginChangeCanonicalDiff,
  type PluginChangeConfirmHandle,
  type PluginChangeErrorCode,
  type PluginChangeKind,
  type PluginChangeRequestRecord,
  type PluginChangeRequestState,
} from '@aiproj/types'

// ── 异常 ──

export class PluginChangeRequestError extends Error {
  constructor(
    public readonly code: PluginChangeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PluginChangeRequestError'
  }
}

// ── 结果类型 ──

export type ChangeFlowResult<T> =
  { ok: true; data: T } | { ok: false; code: PluginChangeErrorCode; message: string }

/** 领域提交委托：adapter 在同一事务内完成领域写入与可信审计 receipt。 */
export interface ChangeApplyContext {
  request: PluginChangeRequest
  trx: TransactionClientContract
  executorRef: string
}

export type ChangeApplyDelegate = (ctx: ChangeApplyContext) => Promise<PluginChangeAuditReceipt>

// ── 输入类型 ──

export interface CreateChangeRequestInput {
  organizationId: number
  projectId: number | null
  kind: PluginChangeKind
  pluginId: string
  requestedBy: string
  targetRevision: string
  diff: PluginChangeCanonicalDiff
  permissionDigest: string
  compatibilityDigest: string
  approvalRequired: boolean
  /** 请求有效期秒数（默认 24h）。 */
  ttlSeconds?: number
}

export interface ListRequestsFilter {
  state?: string
  kind?: string
  pluginId?: string
  page?: number
  perPage?: number
}

const DEFAULT_REQUEST_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_HANDLE_TTL_SECONDS = 600

@inject()
export class PluginChangeRequestService {
  // ==========================================================================
  // 1. 创建与预览推进
  // ==========================================================================

  /**
   * 创建 draft 请求并记录 requested 决策事件。
   * diff/digest 由 adapter 层构建后传入，本服务不解释其内部字段。
   */
  async create(input: CreateChangeRequestInput): Promise<PluginChangeRequest> {
    if (input.diff.kind !== input.kind || input.diff.pluginId !== input.pluginId) {
      throw new PluginChangeRequestError(
        'plugin-change-payload-invalid',
        'Diff kind/pluginId must match the request',
      )
    }

    return await db.transaction(async (trx) => {
      const now = DateTime.now()
      const requestUid = `chg-${randomUUID()}`
      const row = await PluginChangeRequest.create(
        {
          organizationId: input.organizationId,
          projectId: input.projectId,
          requestUid,
          kind: input.kind,
          state: 'draft',
          pluginId: input.pluginId,
          requestedBy: input.requestedBy,
          targetRevision: input.targetRevision,
          diffJson: input.diff,
          diffDigest: computeChangeDiffDigest(input.diff),
          permissionDigest: input.permissionDigest,
          compatibilityDigest: input.compatibilityDigest,
          approvalRequired: input.approvalRequired,
          approvedBy: null,
          handleDigest: null,
          handleActorRef: null,
          handleExpiresAt: null,
          rowVersion: 1,
          expiresAt: now.plus({ seconds: input.ttlSeconds ?? DEFAULT_REQUEST_TTL_SECONDS }),
        },
        { client: trx },
      )

      await this.appendDecision(trx, {
        organizationId: input.organizationId,
        requestId: row.id,
        event: 'requested',
        actorRef: input.requestedBy,
        idempotencyKey: `requested:${requestUid}`,
        fromState: 'draft',
        toState: 'draft',
        reasonCode: null,
        diffDigest: row.diffDigest,
      })

      return row
    })
  }

  /**
   * previewed 推进：draft/failed → pending-approval | awaiting-confirmation。
   * failed → awaiting-confirmation 是重试路径（必须先重新预览）。
   */
  async attachPreview(
    organizationId: number,
    requestUid: string,
    opts?: { approvalRequired?: boolean },
  ): Promise<ChangeFlowResult<PluginChangeRequest>> {
    const row = await this.getByUid(organizationId, requestUid)
    const terminal = this.checkNotTerminal(row)
    if (!terminal.ok) return terminal

    const approvalRequired = opts?.approvalRequired ?? row.approvalRequired
    const result = transitionChangeRequestState(row.state, 'previewed', { approvalRequired })
    if (!result.ok) {
      return { ok: false, code: result.error, message: `Cannot preview from state ${row.state}` }
    }

    return await db.transaction(async (trx) => {
      const casOk = await this.casUpdate(trx, {
        id: row.id,
        organizationId,
        expectedRowVersion: row.rowVersion,
        patch: { state: result.next, row_version: row.rowVersion + 1 },
      })
      if (!casOk) {
        return {
          ok: false as const,
          code: 'plugin-change-stale' as const,
          message: 'Concurrent modification detected; re-preview required',
        }
      }
      await this.appendDecision(trx, {
        organizationId,
        requestId: row.id,
        event: 'previewed',
        actorRef: row.requestedBy,
        idempotencyKey: `previewed:${row.requestUid}:${row.rowVersion}`,
        fromState: row.state,
        toState: result.next,
        reasonCode: null,
        diffDigest: row.diffDigest,
      })
      const updated = await this.getByUidWithClient(trx, organizationId, requestUid)
      return { ok: true as const, data: updated }
    })
  }

  // ==========================================================================
  // 2. 审批 / 拒绝 / 撤回（审批 ≠ 确认）
  // ==========================================================================

  /**
   * maker-checker 审批：pending-approval → approved。
   * 审批者不得是发起人（self-approval-denied）。
   */
  async approve(
    organizationId: number,
    requestUid: string,
    approverRef: string,
    idempotencyKey: string,
  ): Promise<ChangeFlowResult<PluginChangeRequest>> {
    const row = await this.getByUid(organizationId, requestUid)
    const terminal = this.checkNotTerminal(row)
    if (!terminal.ok) return terminal

    // 幂等重放：同一 (request, approved, idempotencyKey) 已决策且请求已处于 approved 时，
    // 返回当前状态而非报错（API 层重试语义）。必须在状态守卫之前判定。
    const replayUid = computeChangeDecisionId(String(row.id), 'approved', idempotencyKey)
    if (row.state === 'approved') {
      const replayed = await PluginChangeDecision.query()
        .where('organizationId', organizationId)
        .where('decisionUid', replayUid)
        .first()
      if (replayed) {
        return { ok: true, data: row }
      }
    }

    if (row.state !== 'pending-approval') {
      return {
        ok: false,
        code: 'plugin-change-illegal-transition',
        message: `Approve requires pending-approval state, got ${row.state}`,
      }
    }

    const makerChecker = checkMakerCheckerForChange({
      event: 'approved',
      requesterRef: row.requestedBy,
      decisionMakerRef: approverRef,
    })
    if (!makerChecker.ok) {
      return { ok: false, code: makerChecker.code, message: 'Approver must differ from requester' }
    }

    return await db.transaction(async (trx) => {
      const casOk = await this.casUpdate(trx, {
        id: row.id,
        organizationId,
        expectedRowVersion: row.rowVersion,
        patch: {
          state: 'approved',
          approved_by: approverRef,
          row_version: row.rowVersion + 1,
        },
      })
      if (!casOk) {
        return {
          ok: false as const,
          code: 'plugin-change-stale' as const,
          message: 'Concurrent decision detected; re-preview required',
        }
      }
      await this.appendDecision(trx, {
        organizationId,
        requestId: row.id,
        event: 'approved',
        actorRef: approverRef,
        idempotencyKey,
        fromState: row.state,
        toState: 'approved',
        reasonCode: null,
        diffDigest: row.diffDigest,
      })
      const updated = await this.getByUidWithClient(trx, organizationId, requestUid)
      return { ok: true as const, data: updated }
    })
  }

  /** 拒绝：pending-approval → rejected（终态、幂等）。 */
  async reject(
    organizationId: number,
    requestUid: string,
    rejectorRef: string,
    idempotencyKey: string,
    reasonCode: PluginChangeErrorCode = 'plugin-change-permission-denied',
  ): Promise<ChangeFlowResult<PluginChangeRequest>> {
    const row = await this.getByUid(organizationId, requestUid)
    const terminal = this.checkNotTerminal(row)
    if (!terminal.ok) return terminal

    if (row.state !== 'pending-approval') {
      return {
        ok: false,
        code: 'plugin-change-illegal-transition',
        message: `Reject requires pending-approval state, got ${row.state}`,
      }
    }

    const makerChecker = checkMakerCheckerForChange({
      event: 'rejected',
      requesterRef: row.requestedBy,
      decisionMakerRef: rejectorRef,
    })
    if (!makerChecker.ok) {
      return { ok: false, code: makerChecker.code, message: 'Rejector must differ from requester' }
    }

    return await db.transaction(async (trx) => {
      const casOk = await this.casUpdate(trx, {
        id: row.id,
        organizationId,
        expectedRowVersion: row.rowVersion,
        patch: { state: 'rejected', row_version: row.rowVersion + 1 },
      })
      if (!casOk) {
        return {
          ok: false as const,
          code: 'plugin-change-stale' as const,
          message: 'Concurrent decision detected',
        }
      }
      await this.appendDecision(trx, {
        organizationId,
        requestId: row.id,
        event: 'rejected',
        actorRef: rejectorRef,
        idempotencyKey,
        fromState: row.state,
        toState: 'rejected',
        reasonCode,
        diffDigest: row.diffDigest,
      })
      const updated = await this.getByUidWithClient(trx, organizationId, requestUid)
      return { ok: true as const, data: updated }
    })
  }

  /**
   * 撤回：发起人（或经 Policy 授权的管理员）在 applied 前撤回。
   * 终态化后后续确认必须被拒绝且目标状态不变。
   */
  async withdraw(
    organizationId: number,
    requestUid: string,
    actorRef: string,
    opts?: { forceByPolicy?: boolean },
  ): Promise<ChangeFlowResult<PluginChangeRequest>> {
    const row = await this.getByUid(organizationId, requestUid)
    const terminal = this.checkNotTerminal(row)
    if (!terminal.ok) return terminal

    if (actorRef !== row.requestedBy && !opts?.forceByPolicy) {
      return {
        ok: false,
        code: 'plugin-change-permission-denied',
        message: 'Only the requester or an authorized administrator may withdraw',
      }
    }

    return await db.transaction(async (trx) => {
      const casOk = await this.casUpdate(trx, {
        id: row.id,
        organizationId,
        expectedRowVersion: row.rowVersion,
        patch: { state: 'withdrawn', row_version: row.rowVersion + 1 },
      })
      if (!casOk) {
        return {
          ok: false as const,
          code: 'plugin-change-stale' as const,
          message: 'Concurrent modification detected',
        }
      }
      await this.appendDecision(trx, {
        organizationId,
        requestId: row.id,
        event: 'withdrawn',
        actorRef,
        idempotencyKey: `withdrawn:${row.requestUid}:${row.rowVersion}`,
        fromState: row.state,
        toState: 'withdrawn',
        reasonCode: null,
        diffDigest: row.diffDigest,
      })
      const updated = await this.getByUidWithClient(trx, organizationId, requestUid)
      return { ok: true as const, data: updated }
    })
  }

  // ==========================================================================
  // 3. 确认句柄签发与一次性消费
  // ==========================================================================

  /**
   * 签发确认句柄（服务器签发有界 digest）。
   * - approved 状态：先记录 confirmed 事件推进到 awaiting-confirmation（审批 ≠ 确认）。
   * - awaiting-confirmation：直接签发（替换旧句柄）。
   */
  async issueConfirmHandle(
    organizationId: number,
    requestUid: string,
    executorRef: string,
  ): Promise<ChangeFlowResult<PluginChangeConfirmHandle>> {
    let row = await this.getByUid(organizationId, requestUid)
    const terminal = this.checkNotTerminal(row)
    if (!terminal.ok) return { ok: false, code: terminal.code, message: terminal.message }

    if (isChangeRequestExpired(row.expiresAt.toISO()!, DateTime.now().toISO()!)) {
      const expired = await this.expireIfDue(organizationId, requestUid)
      if (!expired.ok) return expired
      return {
        ok: false,
        code: 'plugin-change-expired',
        message: 'Change request has expired',
      }
    }

    if (row.state === 'approved') {
      const moved = await db.transaction(async (trx) => {
        const casOk = await this.casUpdate(trx, {
          id: row.id,
          organizationId,
          expectedRowVersion: row.rowVersion,
          patch: { state: 'awaiting-confirmation', row_version: row.rowVersion + 1 },
        })
        if (!casOk) return false
        await this.appendDecision(trx, {
          organizationId,
          requestId: row.id,
          event: 'confirmed',
          actorRef: executorRef,
          idempotencyKey: `confirmed:${row.requestUid}:${row.rowVersion}`,
          fromState: 'approved',
          toState: 'awaiting-confirmation',
          reasonCode: null,
          diffDigest: row.diffDigest,
        })
        return true
      })
      if (!moved) {
        return {
          ok: false,
          code: 'plugin-change-stale',
          message: 'Concurrent modification detected; re-preview required',
        }
      }
      row = await this.getByUid(organizationId, requestUid)
    }

    if (row.state !== 'awaiting-confirmation') {
      return {
        ok: false,
        code: 'plugin-change-illegal-transition',
        message: `Handle issuance requires awaiting-confirmation state, got ${row.state}`,
      }
    }

    const handle = buildChangeConfirmHandle({
      requestId: row.requestUid,
      organizationId: String(organizationId),
      projectId: row.projectId === null ? null : String(row.projectId),
      actorRef: executorRef,
      rowVersion: row.rowVersion,
      targetRevision: row.targetRevision,
      diffDigest: row.diffDigest,
      permissionDigest: row.permissionDigest,
      compatibilityDigest: row.compatibilityDigest,
      nowIso: DateTime.now().toISO()!,
      ttlSeconds: DEFAULT_HANDLE_TTL_SECONDS,
    })

    await PluginChangeRequest.query()
      .where('id', row.id)
      .where('organizationId', organizationId)
      .update({
        // 存核心绑定摘要（不含 expiresAt）：时间文本经 SQLite 往返形式会变，
        // 等值对照必须只依赖稳定字段；有效期由独立过期检查承担。
        handle_digest: computeChangeHandleCoreDigest(this.handleCoreFromRow(row, executorRef)),
        handle_actor_ref: executorRef,
        // Lucid 对 datetime 列用 DateTime.fromSQL 消费，必须存 SQL 格式（含偏移量），
        // 否则读回 invalid → 被误判为已过期。
        handle_expires_at: DateTime.fromISO(handle.expiresAt).toSQL(),
      })

    return { ok: true, data: handle }
  }

  /**
   * 确认并应用：一次性消费句柄 → 同一事务内执行 applyDelegate（领域提交 + 可信审计 receipt）
   * → CAS 置 applied 并回填 receipt。apply 失败则整体回滚并在独立事务落 failed（可重试）。
   */
  async confirmAndApply(input: {
    organizationId: number
    requestUid: string
    executorRef: string
    /** 客户端仅回传句柄字符串；authority 字段全部服务端重建。 */
    handle: string
    applyDelegate: ChangeApplyDelegate
  }): Promise<
    ChangeFlowResult<{ request: PluginChangeRequest; receipt: PluginChangeAuditReceipt }>
  > {
    const row = await this.getByUid(input.organizationId, input.requestUid)

    // 1. 终态幂等：applied/rejected/withdrawn/expired 上的重复确认稳定返回 already-decided
    if (isChangeTerminalState(row.state)) {
      return {
        ok: false,
        code: 'plugin-change-already-decided',
        message: `Request already in terminal state ${row.state}`,
      }
    }
    if (row.state === 'draft' || row.state === 'pending-approval') {
      return {
        ok: false,
        code: 'plugin-change-illegal-transition',
        message: `Confirm requires awaiting-confirmation state, got ${row.state}`,
      }
    }

    // 2. 过期检查（惰性过期）
    if (isChangeRequestExpired(row.expiresAt.toISO()!, DateTime.now().toISO()!)) {
      await this.expireIfDue(input.organizationId, input.requestUid)
      return { ok: false, code: 'plugin-change-expired', message: 'Change request has expired' }
    }

    // 3. 句柄存在性：无活动句柄 = 已消费或从未签发
    if (!row.handleDigest || !row.handleActorRef || !row.handleExpiresAt) {
      return {
        ok: false,
        code: 'plugin-change-handle-invalid',
        message: 'No active confirm handle; request a new one',
      }
    }

    // 4. 服务端重建核心绑定并与呈现的句柄对照（客户端不提供 authority 字段）。
    //    任一绑定值变化（含签发后行版本前进、目标 release 替换、旧句柄重放、伪造值）
    //    统一映射为 stale：fail closed 且要求重新预览，绝不静默刷新或提交。
    const expectedHandle = `chg-cfm-${row.handleDigest.slice(0, 12)}-${row.rowVersion}`
    if (input.handle !== expectedHandle) {
      return {
        ok: false,
        code: 'plugin-change-stale',
        message: 'Handle does not match the current binding; re-preview required',
      }
    }
    if (input.executorRef !== row.handleActorRef) {
      return {
        ok: false,
        code: 'plugin-change-permission-denied',
        message: 'Executor does not match the handle grantee',
      }
    }
    if (isChangeRequestExpired(row.handleExpiresAt.toISO()!, DateTime.now().toISO()!)) {
      return { ok: false, code: 'plugin-change-handle-expired', message: 'Handle has expired' }
    }

    // 5. 提交门：领域提交 + 可信审计 receipt + CAS applied 同一事务
    try {
      const applied = await db.transaction(async (trx) => {
        // 事务内重读并复核新鲜度（防签发后状态漂移）
        const fresh = await PluginChangeRequest.query({ client: trx })
          .where('id', row.id)
          .where('organizationId', input.organizationId)
          .first()
        if (
          !fresh ||
          fresh.state !== 'awaiting-confirmation' ||
          fresh.rowVersion !== row.rowVersion ||
          fresh.handleDigest !== row.handleDigest
        ) {
          throw new PluginChangeRequestError(
            'plugin-change-stale',
            'Binding changed after handle issuance; re-preview required',
          )
        }

        // 领域提交 + 可信审计（delegate 内部审计失败必须抛出 → 整体回滚）
        const receipt = await input.applyDelegate({
          request: fresh,
          trx,
          executorRef: input.executorRef,
        })

        const casOk = await this.casUpdate(trx, {
          id: fresh.id,
          organizationId: input.organizationId,
          expectedRowVersion: fresh.rowVersion,
          patch: {
            state: 'applied',
            row_version: fresh.rowVersion + 1,
            handle_digest: null,
            handle_actor_ref: null,
            handle_expires_at: null,
          },
        })
        if (!casOk) {
          throw new PluginChangeRequestError(
            'plugin-change-stale',
            'Concurrent modification during apply',
          )
        }

        await this.appendDecision(trx, {
          organizationId: input.organizationId,
          requestId: fresh.id,
          event: 'applied',
          actorRef: input.executorRef,
          idempotencyKey: `applied:${fresh.requestUid}:${fresh.rowVersion}`,
          fromState: 'awaiting-confirmation',
          toState: 'applied',
          reasonCode: null,
          diffDigest: fresh.diffDigest,
          receipt,
        })

        const updated = await PluginChangeRequest.find(fresh.id, { client: trx })
        return { request: updated!, receipt }
      })
      return { ok: true, data: applied }
    } catch (error) {
      const code =
        error instanceof PluginChangeRequestError ? error.code : 'plugin-change-apply-failed'
      // 绑定类失败（stale 等）：请求保持原状态与活动句柄，不落 failed
      if (error instanceof PluginChangeRequestError) {
        return { ok: false, code, message: error.message }
      }
      // 领域提交失败：独立事务落 failed（可重试、不重复应用的低敏失败状态）
      await this.markFailed(input.organizationId, input.requestUid, code)
      return {
        ok: false,
        code,
        message: error instanceof Error ? error.message : 'Apply failed',
      }
    }
  }

  // ==========================================================================
  // 4. 过期与查询
  // ==========================================================================

  /** 惰性过期单条请求。 */
  async expireIfDue(
    organizationId: number,
    requestUid: string,
  ): Promise<ChangeFlowResult<PluginChangeRequest>> {
    const row = await this.getByUid(organizationId, requestUid)
    if (isChangeTerminalState(row.state)) {
      return { ok: true, data: row }
    }
    if (!isChangeRequestExpired(row.expiresAt.toISO()!, DateTime.now().toISO()!)) {
      return { ok: true, data: row }
    }
    await db.transaction(async (trx) => {
      const casOk = await this.casUpdate(trx, {
        id: row.id,
        organizationId,
        expectedRowVersion: row.rowVersion,
        patch: { state: 'expired', row_version: row.rowVersion + 1 },
      })
      if (casOk) {
        await this.appendDecision(trx, {
          organizationId,
          requestId: row.id,
          event: 'expired',
          actorRef: 'system',
          idempotencyKey: `expired:${row.requestUid}:${row.rowVersion}`,
          fromState: row.state,
          toState: 'expired',
          reasonCode: 'plugin-change-expired',
          diffDigest: row.diffDigest,
        })
      }
    })
    return { ok: true, data: await this.getByUid(organizationId, requestUid) }
  }

  /** 批量过期到期请求（供定时任务/读路径惰性触发）。 */
  async expireAllDue(limit = 100): Promise<number> {
    const due = await PluginChangeRequest.query()
      .whereNotIn('state', ['applied', 'rejected', 'withdrawn', 'expired'])
      .where('expiresAt', '<=', DateTime.now().toJSDate())
      .limit(limit)
    let count = 0
    for (const row of due) {
      const res = await this.expireIfDue(row.organizationId, row.requestUid)
      if (res.ok && res.data.state === 'expired') count += 1
    }
    return count
  }

  getByUid(organizationId: number, requestUid: string): Promise<PluginChangeRequest> {
    return PluginChangeRequest.forOrganization(organizationId)
      .where('requestUid', requestUid)
      .firstOrFail()
  }

  /**
   * 事务内读取：必须走 trx 客户端。
   * SQLite 连接池大小为 1，事务回调里若走全局连接池会自锁死等。
   */
  private getByUidWithClient(
    trx: TransactionClientContract,
    organizationId: number,
    requestUid: string,
  ): Promise<PluginChangeRequest> {
    return PluginChangeRequest.query({ client: trx })
      .where('organizationId', organizationId)
      .where('requestUid', requestUid)
      .firstOrFail()
  }

  tryGetByUid(organizationId: number, requestUid: string): Promise<PluginChangeRequest | null> {
    return PluginChangeRequest.forOrganization(organizationId)
      .where('requestUid', requestUid)
      .first()
  }

  /** 组织隔离分页列表。 */
  async list(
    organizationId: number,
    filter: ListRequestsFilter,
  ): Promise<{
    data: PluginChangeRequest[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = Math.max(1, filter.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filter.perPage ?? 20))
    let q = PluginChangeRequest.forOrganization(organizationId)
    if (filter.state) q = q.where('state', filter.state)
    if (filter.kind) q = q.where('kind', filter.kind)
    if (filter.pluginId) q = q.where('pluginId', filter.pluginId)
    // Lucid 的聚合行不是模型实例，列名由别名决定（SQLite 返回 number，PG 返回字符串）
    const countRow = (await q.clone().count('* as total').first()) as unknown as
      { total?: number | string } | null | undefined
    const total = Number(countRow?.total ?? 0)
    const data = await q
      .orderBy('createdAt', 'desc')
      .offset((page - 1) * perPage)
      .limit(perPage)
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    }
  }

  /** 决策事件流水（append-only 只读）。 */
  listDecisions(organizationId: number, requestId: number): Promise<PluginChangeDecision[]> {
    return PluginChangeDecision.forOrganization(organizationId)
      .where('requestId', requestId)
      .orderBy('createdAt', 'asc')
  }

  /** 领域投影 DTO（低敏，供 API/UI）。 */
  toRecordDTO(row: PluginChangeRequest): PluginChangeRequestRecord & { numericId: number } {
    return {
      numericId: row.id,
      id: row.requestUid,
      organizationId: String(row.organizationId),
      projectId: row.projectId === null ? null : String(row.projectId),
      kind: row.kind,
      state: row.state,
      pluginId: row.pluginId,
      requestedBy: row.requestedBy,
      targetRevision: row.targetRevision,
      diff: row.diffJson,
      diffDigest: row.diffDigest,
      permissionDigest: row.permissionDigest,
      compatibilityDigest: row.compatibilityDigest,
      approvalRequired: row.approvalRequired,
      approvedBy: row.approvedBy,
      rowVersion: row.rowVersion,
      expiresAt: row.expiresAt.toISO()!,
      createdAt: row.createdAt.toISO()!,
      updatedAt: row.updatedAt?.toISO() ?? row.createdAt.toISO()!,
    }
  }

  // ==========================================================================
  // 5. 内部辅助
  // ==========================================================================

  private checkNotTerminal(row: PluginChangeRequest): ChangeFlowResult<null> {
    if (isChangeTerminalState(row.state)) {
      return {
        ok: false,
        code: 'plugin-change-already-decided',
        message: `Request already in terminal state ${row.state}`,
      }
    }
    return { ok: true, data: null }
  }

  /** 核心绑定字段（不含 expiresAt）——用于持久化摘要与签发/对照。 */
  private handleCoreFromRow(
    row: PluginChangeRequest,
    actorRef: string,
  ): Omit<PluginChangeConfirmHandle, 'handle' | 'expiresAt'> {
    return {
      requestId: row.requestUid,
      organizationId: String(row.organizationId),
      projectId: row.projectId === null ? null : String(row.projectId),
      actorRef,
      rowVersion: row.rowVersion,
      targetRevision: row.targetRevision,
      diffDigest: row.diffDigest,
      permissionDigest: row.permissionDigest,
      compatibilityDigest: row.compatibilityDigest,
    }
  }

  /** rowVersion CAS 更新（并发控制唯一入口）。patch 必须使用 snake_case 列名。 */
  private async casUpdate(
    trx: TransactionClientContract,
    opts: {
      id: number
      organizationId: number
      expectedRowVersion: number
      patch: Record<string, unknown>
    },
  ): Promise<boolean> {
    const affected: unknown = await trx
      .from('plugin_change_requests')
      .where('id', opts.id)
      .where('organization_id', opts.organizationId)
      .where('row_version', opts.expectedRowVersion)
      .update(opts.patch)
    if (typeof affected === 'number') return affected > 0
    if (Array.isArray(affected)) return affected.length > 0
    return false
  }

  /** append-only 决策事件（幂等唯一键保护）。 */
  private async appendDecision(
    trx: TransactionClientContract,
    input: {
      organizationId: number
      requestId: number
      event: Parameters<typeof computeChangeDecisionId>[1]
      actorRef: string
      idempotencyKey: string
      fromState: PluginChangeRequestState
      toState: PluginChangeRequestState
      reasonCode: PluginChangeErrorCode | null
      diffDigest: string
      receipt?: PluginChangeAuditReceipt | null
    },
  ): Promise<PluginChangeDecision> {
    const decisionUid = computeChangeDecisionId(
      String(input.requestId),
      input.event,
      input.idempotencyKey,
    )
    const existing = await PluginChangeDecision.query({ client: trx })
      .where('organizationId', input.organizationId)
      .where('decisionUid', decisionUid)
      .first()
    if (existing) return existing
    return await PluginChangeDecision.create(
      {
        organizationId: input.organizationId,
        requestId: input.requestId,
        decisionUid,
        event: input.event,
        actorRef: input.actorRef,
        idempotencyKey: input.idempotencyKey,
        fromState: input.fromState,
        toState: input.toState,
        reasonCode: input.reasonCode,
        diffDigest: input.diffDigest,
        auditLogId: input.receipt?.auditLogId ?? null,
        receiptCreatedAt: input.receipt ? DateTime.fromISO(input.receipt.createdAt) : null,
      },
      { client: trx },
    )
  }

  /** 失败落账（独立事务，可重试语义）。 */
  private async markFailed(
    organizationId: number,
    requestUid: string,
    reasonCode: PluginChangeErrorCode,
  ): Promise<void> {
    try {
      const row = await this.tryGetByUid(organizationId, requestUid)
      if (!row || isChangeTerminalState(row.state)) return
      await db.transaction(async (trx) => {
        const casOk = await this.casUpdate(trx, {
          id: row.id,
          organizationId,
          expectedRowVersion: row.rowVersion,
          patch: {
            state: 'failed',
            row_version: row.rowVersion + 1,
            handle_digest: null,
            handle_actor_ref: null,
            handle_expires_at: null,
          },
        })
        if (!casOk) return
        await this.appendDecision(trx, {
          organizationId,
          requestId: row.id,
          event: 'failed',
          actorRef: 'system',
          idempotencyKey: `failed:${row.requestUid}:${row.rowVersion}`,
          fromState: row.state,
          toState: 'failed',
          reasonCode,
          diffDigest: row.diffDigest,
        })
      })
    } catch {
      // 失败落账本身不再抛出（避免掩盖原始 apply 错误）
    }
  }
}

/**
 * 可信审计 receipt 写入器：在业务事务内创建 audit_logs 行并返回 receipt。
 * strict fail-closed：任何失败向上抛出使外层事务回滚（design.md D5）。
 * metadata 经低敏 sanitizer 处理。
 */
export async function appendTrustedChangeAuditReceipt(input: {
  organizationId: number
  projectId: number | null
  userId: number | null
  action: string
  requestUid: string
  metadata: Record<string, unknown>
  client: TransactionClientContract
}): Promise<PluginChangeAuditReceipt> {
  const created = await AuditLog.create(
    {
      action: input.action,
      severity: 'info',
      userId: input.userId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      entityType: 'plugin_change_request',
      entityId: null,
      changes: null,
      metadata: sanitizeChangeForAudit({
        requestUid: input.requestUid,
        ...input.metadata,
      }) as Record<string, unknown>,
    },
    { client: input.client },
  )
  return { auditLogId: created.id, createdAt: created.createdAt.toISO()! }
}

export default PluginChangeRequestService
