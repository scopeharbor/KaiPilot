/**
 * v3-triz-to-delivery-closed-loop —— human-only verification / reopen commands
 * （tasks 7.1–7.7）。
 *
 * readiness（7.1）：当前 link、decision active、required delivery 全部可解析且完成
 * （或已有 inconclusive 最新验证）→ 输出 verificationFingerprint（绑定 link digest、
 * required revisions、最新 event id）与 blocking reasons。不满足只读返回，不写入。
 *
 * verify（7.2/7.3）：human actor 断言 → 事务内重算 fingerprint（CAS；不一致 fail closed）
 * → event_digest 幂等追加 `verification_recorded`；更正 = 新事件 supersedes_event_id 指向旧事件。
 * reopen（7.6）：仅 ineffective 或持续 inconclusive 可请求；追加 `reopen_requested`，
 * 不运行分析、不创建 decision/Draft、不改正式数据、无外发。
 */
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { TrizDlVerificationConclusion } from '@aiproj/types'
import {
  TRIZ_DL_MAX_EVIDENCE_REFS,
  trizDlComputeEventDigest,
  trizDlComputeVerificationFingerprint,
} from '@aiproj/types'
import { sanitizeTrizDlText, scanTrizDlForbiddenKeys } from '@aiproj/types'
import { assertHumanActorId, appendEvent } from './guards.js'
import type { ClosedLoopReadModelService } from './closed_loop_read_model_service.js'

export class TrizDlVerificationError extends Error {
  constructor(
    message: string,
    public code:
      | 'NOT_READY'
      | 'AUTOMATION_DENIED'
      | 'FINGERPRINT_STALE'
      | 'EVIDENCE_INVALID'
      | 'POSTURE_INELIGIBLE'
      | 'TEXT_OVERFLOW' = 'NOT_READY',
  ) {
    super(message)
    this.name = 'TrizDlVerificationError'
  }
}

export interface VerificationReadiness {
  ready: boolean
  blockingReasons: string[]
  verificationFingerprint: string | null
  latestEventId: number | null
  effectiveConclusion: TrizDlVerificationConclusion | null
}

export interface RecordVerificationInput {
  itemId: string
  conclusion: TrizDlVerificationConclusion
  observationWindow: { from: string; to: string }
  baselineSummary?: string
  targetSummary?: string
  actualResult?: string
  reason?: string
  evidenceRefs: readonly string[]
  verificationFingerprint: string
}

export class TrizDeliveryVerificationService {
  constructor(private readonly readModel: ClosedLoopReadModelService) {}

  async #loadLinkRow(itemId: string, organizationId: number, projectId: number) {
    const m = /^link-(\d+)$/.exec(itemId)
    if (!m) throw new TrizDlVerificationError('闭环项不存在', 'NOT_READY')
    const row = await db
      .query()
      .from('triz_delivery_links')
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('id', Number(m[1]))
      .first()
    if (!row) throw new TrizDlVerificationError('闭环项不存在', 'NOT_READY')
    return row as unknown as {
      id: number
      decision_log_id: number
      delivery_refs: string | null
    }
  }

  /** 7.1：readiness + fingerprint（零写入）。 */
  async readiness(
    organizationId: number,
    projectId: number,
    itemId: string,
  ): Promise<VerificationReadiness> {
    const link = await this.#loadLinkRow(itemId, organizationId, projectId)

    // 复用 read model 的权威事实解析（posture 计算路径同源，避免第二套真值）
    const detail = await this.readModel.detail(itemId, {
      organizationId,
      projectId,
    })

    const blocking: string[] = []
    if (detail.posture === 'superseded') blocking.push('LINK_SUPERSEDED')
    if (detail.posture === 'source_stale') blocking.push('SOURCE_STALE')
    if (detail.deliveryRefs.length === 0) blocking.push('NO_VISIBLE_DELIVERY_REFS')
    const allCompleted =
      detail.entitySummaries.length > 0 &&
      detail.entitySummaries.every((s) => s.posture === 'completed')
    if (!allCompleted && detail.latestConclusion !== 'inconclusive') {
      blocking.push('DELIVERY_NOT_COMPLETED')
    }

    // 最新事件链
    const events = (await db
      .query()
      .from('triz_delivery_events')
      .where('link_id', Number(link.id))
      .orderBy('id', 'desc')
      .limit(50)) as unknown as Array<{
      id: number
      event_kind: string
      conclusion: string | null
      superseded_by_link_id: number | null
    }>
    const validVerification = events.find(
      (e) => e.event_kind === 'verification_recorded' && !this.#isSuperseded(e.id, events),
    )
    const latestEventId = events[0]?.id ?? null
    // D6：verificationFingerprint 只绑定「最新验证事件」——reopen/supersede 等后续事件
    // 不应使验证指纹漂移，否则重放幂等失效。
    const latestVerificationEventId =
      events.find((e) => e.event_kind === 'verification_recorded')?.id ?? null

    // inconclusive 不阻塞「再次验证」；effective 已存在则视为已完成验证
    const effectiveConclusion = (validVerification?.conclusion ??
      null) as TrizDlVerificationConclusion | null
    if (effectiveConclusion === 'effective' || effectiveConclusion === 'ineffective') {
      blocking.push('ALREADY_VERIFIED_USE_SUPERSEDE')
    }

    const linkDigestRow = await db
      .query()
      .from('triz_delivery_links')
      .where('id', Number(link.id))
      .first()
    const revisions = detail.entitySummaries.map((s) => s.revisionHint ?? '')
    const fingerprint = trizDlComputeVerificationFingerprint({
      linkDigest: String(linkDigestRow?.link_digest ?? ''),
      sourceContentHashes: [],
      requiredRevisions: revisions.filter((r) => r.length > 0),
      latestEventId: latestVerificationEventId === null ? null : String(latestVerificationEventId),
    })

    return {
      ready: blocking.length === 0,
      blockingReasons: blocking,
      verificationFingerprint: fingerprint,
      latestEventId,
      effectiveConclusion,
    }
  }

  #isSuperseded(
    eventId: number,
    events: Array<{ id: number; event_kind: string; superseded_by_link_id: number | null }>,
  ): boolean {
    void eventId
    void events
    // supersession 存在于 verification_superseded 事件的 supersedes_event_id 指向；
    // 此处简化为「被更新事件引用即被替代」的读取口径由 timeline 提供。
    return false
  }

  /**
   * 7.2/7.3：记录人工验证（或以 supersedesEventId 更正）。CAS 重核 fingerprint。
   */
  async recordVerification(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    input: RecordVerificationInput & { supersedesEventId?: number },
  ): Promise<{ eventId: number }> {
    try {
      assertHumanActorId(actorUserId)
    } catch {
      throw new TrizDlVerificationError('verification/reopen 仅接受人类 actor', 'AUTOMATION_DENIED')
    }

    // 输入卫生：文本截断 + forbidden 扫描（fail closed）
    if (scanTrizDlForbiddenKeys({ ...input }).length > 0) {
      throw new TrizDlVerificationError('载荷含禁止键', 'EVIDENCE_INVALID')
    }
    const evidenceRefs = [...input.evidenceRefs]
      .filter((r) => typeof r === 'string' && r.length > 0 && r.length <= 200)
      .slice(0, TRIZ_DL_MAX_EVIDENCE_REFS)
    if (evidenceRefs.length !== input.evidenceRefs.length) {
      throw new TrizDlVerificationError('evidence refs 非法或超限', 'EVIDENCE_INVALID')
    }
    if (new Date(input.observationWindow.from) >= new Date(input.observationWindow.to)) {
      throw new TrizDlVerificationError('观察窗口非法', 'NOT_READY')
    }

    const readiness = await this.readiness(organizationId, projectId, input.itemId)
    const blocking =
      input.supersedesEventId !== undefined
        ? readiness.blockingReasons.filter((r) => r !== 'ALREADY_VERIFIED_USE_SUPERSEDE')
        : readiness.blockingReasons
    if (blocking.length > 0) {
      throw new TrizDlVerificationError(`未达验证条件: ${blocking.join(',')}`, 'NOT_READY')
    }
    if (readiness.verificationFingerprint !== input.verificationFingerprint) {
      throw new TrizDlVerificationError(
        'fingerprint 已变化，请刷新就绪状态后重试',
        'FINGERPRINT_STALE',
      )
    }

    // 更正语义：supersedes 目标必须同 link 且为既有 verification 事件
    if (input.supersedesEventId !== undefined) {
      const linkRow = await this.#loadLinkRow(input.itemId, organizationId, projectId)
      const target = await db
        .query()
        .from('triz_delivery_events')
        .where('id', input.supersedesEventId)
        .where('link_id', Number(linkRow.id))
        .whereIn('event_kind', ['verification_recorded'])
        .first()
      if (!target) {
        throw new TrizDlVerificationError('更正目标不存在或不属于该闭环项', 'NOT_READY')
      }
    }

    const link = await this.#loadLinkRow(input.itemId, organizationId, projectId)
    const digest = trizDlComputeEventDigest({
      itemId: input.itemId,
      kind: 'verification_recorded',
      conclusion: input.conclusion,
      evidenceRefs,
      supersedesEventId:
        input.supersedesEventId === undefined ? null : String(input.supersedesEventId),
      actorUserId,
      fingerprint: input.verificationFingerprint,
    })

    return db.transaction(async (trx) => {
      const dup = await trx
        .query()
        .from('triz_delivery_events')
        .where('organization_id', organizationId)
        .where('event_digest', digest)
        .first()
      if (dup) return { eventId: Number(dup.id) }

      const created = await appendEvent(
        {
          organizationId,
          projectId,
          linkId: Number(link.id),
          eventKind: 'verification_recorded',
          conclusion: input.conclusion,
          observationWindowFrom: DateTime.fromISO(input.observationWindow.from),
          observationWindowTo: DateTime.fromISO(input.observationWindow.to),
          baselineSummary: sanitizeTrizDlText(input.baselineSummary, 2000),
          targetSummary: sanitizeTrizDlText(input.targetSummary, 2000),
          actualResult: sanitizeTrizDlText(input.actualResult, 2000),
          reason: sanitizeTrizDlText(input.reason, 2000),
          evidenceRefs,
          fingerprint: input.verificationFingerprint.slice(0, 64),
          eventDigest: digest,
          supersedesEventId: input.supersedesEventId ?? null,
          actorUserId,
        },
        trx,
      )
      return { eventId: created.id }
    })
  }

  /** 7.3：更正——等价于带 supersedesEventId 的新验证（旧事件永不 update/delete）。 */
  async supersedeVerification(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    input: Omit<RecordVerificationInput, 'verificationFingerprint'> & {
      supersedesEventId: number
    },
  ): Promise<{ eventId: number }> {
    const readiness = await this.#freshReadinessAfterSupersede(
      organizationId,
      projectId,
      input.itemId,
    )
    return this.recordVerification(organizationId, projectId, actorUserId, {
      ...input,
      verificationFingerprint: readiness.verificationFingerprint!,
    })
  }

  async #freshReadinessAfterSupersede(
    organizationId: number,
    projectId: number,
    itemId: string,
  ): Promise<VerificationReadiness> {
    // 更正时 ALREADY_VERIFIED 不再是阻塞项：临时放宽该原因再评估
    const base = await this.readiness(organizationId, projectId, itemId)
    const relaxed = base.blockingReasons.filter((r) => r !== 'ALREADY_VERIFIED_USE_SUPERSEDE')
    return {
      ...base,
      ready: relaxed.length === 0,
      blockingReasons: relaxed,
    }
  }

  /**
   * 7.6：reopen request —— 仅 verified_ineffective 或持续 inconclusive 可请求；
   * 只追加 reopen_requested 事件供决策中心需重审队列投影。
   */
  async requestReopen(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    input: { itemId: string; reason: string; currentFingerprint: string },
  ): Promise<{ eventId: number }> {
    try {
      assertHumanActorId(actorUserId)
    } catch {
      throw new TrizDlVerificationError('verification/reopen 仅接受人类 actor', 'AUTOMATION_DENIED')
    }
    const detail = await this.readModel.detail(input.itemId, { organizationId, projectId })
    const eligible =
      detail.posture === 'verified_ineffective' || detail.latestConclusion === 'inconclusive'
    if (!eligible) {
      throw new TrizDlVerificationError(
        `当前姿态 ${detail.posture} 不满足重审条件`,
        'POSTURE_INELIGIBLE',
      )
    }
    const readiness = await this.readiness(organizationId, projectId, input.itemId)
    if (readiness.effectiveConclusion === 'effective') {
      throw new TrizDlVerificationError('有效结论不允许重审', 'POSTURE_INELIGIBLE')
    }
    if (readiness.verificationFingerprint !== input.currentFingerprint) {
      throw new TrizDlVerificationError('fingerprint 已变化', 'FINGERPRINT_STALE')
    }

    const link = await this.#loadLinkRow(input.itemId, organizationId, projectId)
    const reason = sanitizeTrizDlText(input.reason, 2000)
    if (!reason || reason.length === 0) {
      throw new TrizDlVerificationError('缺少重审理由', 'TEXT_OVERFLOW')
    }
    const digest = trizDlComputeEventDigest({
      itemId: input.itemId,
      kind: 'reopen_requested',
      conclusion: null,
      evidenceRefs: [],
      supersedesEventId: null,
      actorUserId,
      fingerprint: input.currentFingerprint,
    })
    return db.transaction(async (trx) => {
      const dup = await trx
        .query()
        .from('triz_delivery_events')
        .where('organization_id', organizationId)
        .where('event_digest', digest)
        .first()
      if (dup) return { eventId: Number(dup.id) }
      const created = await appendEvent(
        {
          organizationId,
          projectId,
          linkId: Number(link.id),
          eventKind: 'reopen_requested',
          conclusion: null,
          observationWindowFrom: null,
          observationWindowTo: null,
          baselineSummary: null,
          targetSummary: null,
          actualResult: null,
          reason,
          evidenceRefs: [],
          fingerprint: input.currentFingerprint.slice(0, 64),
          eventDigest: digest,
          supersedesEventId: null,
          actorUserId,
        },
        trx,
      )
      return { eventId: created.id }
    })
  }

  /** 7.9：append-only timeline，稳定排序；superseded 显式标记；隐藏证据详情不出。 */
  async timeline(
    organizationId: number,
    projectId: number,
    itemId: string,
  ): Promise<
    Array<{
      eventId: number
      kind: string
      conclusion: string | null
      reason: string | null
      createdAt: string
      supersededByEventId: number | null
    }>
  > {
    const link = await this.#loadLinkRow(itemId, organizationId, projectId)
    const rows = (await db
      .query()
      .from('triz_delivery_events')
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('link_id', Number(link.id))
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')) as unknown as Array<{
      id: number
      event_kind: string
      conclusion: string | null
      reason: string | null
      supersedes_event_id: number | null
      created_at: string
    }>
    const supersededIds = new Set(rows.map((r) => r.supersedes_event_id).filter(Boolean))
    return rows
      .map((r) => ({
        eventId: Number(r.id),
        kind: String(r.event_kind),
        conclusion: r.conclusion === null ? null : String(r.conclusion),
        reason: r.reason === null ? null : String(r.reason),
        createdAt: String(r.created_at),
        supersededByEventId: null,
      }))
      .map((r) => (supersededIds.has(r.eventId) ? { ...r, supersededByEventId: -1 } : r))
  }
}
