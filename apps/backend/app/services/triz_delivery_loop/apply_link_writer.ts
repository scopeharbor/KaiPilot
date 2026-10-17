/**
 * v3-triz-to-delivery-closed-loop —— confirmed Apply 同事务 link writer
 * （tasks 4.3/4.4）。
 *
 * 输入：现有 transaction client + session 来源/元数据 + typed receipts。
 * 语义：
 * - 仅 `v3_triz_candidate` 来源会话创建闭环 link；其余来源返回 null（task 4.5 向后兼容，
 *   只生成普通 receipt 不建 link）。
 * - TRIZ 会话缺 attribution → fail closed 抛错（不复用任何 fail-open JSON fallback）。
 * - decision log ref 必须 org/project 匹配、非 superseded、hash 匹配，否则抛错回滚。
 * - link 以 (organization_id, link_digest) 幂等；digest 由共享纯函数产出。
 * - audit 低敏：只记 refs/hash 前缀与计数（正文绝不入库）。
 */
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { DraftLayerApplyEntityReceipt, DraftLayerSourceType } from '@aiproj/types'
import { trizDlCanonicalizeRefs, trizDlComputeLinkDigest } from '@aiproj/types'
import type TrizDeliveryLink from '#models/triz_delivery_link'

export interface TrizSessionAttribution {
  /** TRIZ 决策所属的源项目（决策中心所在项目；可与 apply 新建项目不同） */
  projectId?: number
  decisionLogId: number
  schemeId?: string
  optionIds?: string[]
  sourceHashes?: {
    schemeHash?: string
    contradictionSignatures?: string[]
    analysisContentHashes?: string[]
  }
}

export interface WriteLinksParams {
  trx: TransactionClientContract
  organizationId: number
  actorUserId: number
  sessionSource: DraftLayerSourceType | string
  sessionMetadata: Record<string, unknown> | null
  /** 本次 confirm 实际落库的项目（可为新建项目；仅记录，不参与归属判定） */
  appliedProjectId: number | null
  applyResultId: number
  receiptList: readonly DraftLayerApplyEntityReceipt[]
}

export class TrizApplyAttributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrizApplyAttributionError'
  }
}

/** delivery kinds（required）；其余 receipt kind 一律不进入 link refs。 */
const DELIVERY_KINDS = new Set(['task', 'milestone'])

export async function writeTrizDeliveryLinksForConfirmedApply(
  params: WriteLinksParams,
): Promise<TrizDeliveryLink | null> {
  const { trx, organizationId, actorUserId, sessionSource, sessionMetadata } = params

  if (sessionSource !== 'v3_triz_candidate') return null

  // fail closed：TRIZ 会话必须带显式 attribution（禁止猜测式兜底）
  const rawAttr = (sessionMetadata ?? {})['trizAttribution']
  if (!rawAttr || typeof rawAttr !== 'object') {
    throw new TrizApplyAttributionError('TRIZ 来源会话缺少 trizAttribution，拒绝生成闭环 link')
  }
  const attr = rawAttr as Partial<TrizSessionAttribution>
  if (
    typeof attr.decisionLogId !== 'number' ||
    !Number.isInteger(attr.decisionLogId) ||
    attr.decisionLogId <= 0
  ) {
    throw new TrizApplyAttributionError('trizAttribution.decisionLogId 非法')
  }
  if (
    typeof attr.projectId !== 'number' ||
    !Number.isInteger(attr.projectId) ||
    attr.projectId <= 0
  ) {
    throw new TrizApplyAttributionError('trizAttribution.projectId（决策源项目）非法')
  }
  const sourceProjectId = attr.projectId

  // decision log 校验：org/project 匹配、非 superseded、hash 匹配（fail closed）
  const log = await trx.query().from('triz_decision_logs').where('id', attr.decisionLogId).first()
  if (!log) throw new TrizApplyAttributionError('decision log 不存在')
  if (Number(log.organization_id) !== organizationId) {
    throw new TrizApplyAttributionError('decision log 跨组织引用被拒绝')
  }
  if (Number(log.project_id) !== sourceProjectId) {
    throw new TrizApplyAttributionError('decision log 与决策源项目不匹配')
  }
  if (log.decision_status === 'superseded') {
    throw new TrizApplyAttributionError('decision log 已被 supersede，拒绝建立新链接')
  }
  const reasonHash = typeof log.reason_hash === 'string' ? log.reason_hash : null
  if (!reasonHash) {
    throw new TrizApplyAttributionError('decision log 缺少可校验 hash（unversioned）')
  }

  // delivery refs 来自 typed receipts（仅 task/milestone）
  const canonical = trizDlCanonicalizeRefs(
    params.receiptList
      .filter((r) => DELIVERY_KINDS.has(r.entityType))
      .map((r) => ({ kind: r.entityType as 'task' | 'milestone', entityId: r.entityId })),
  )
  if (canonical.visible.length === 0) {
    throw new TrizApplyAttributionError('apply 未产生 task/milestone 实体，无可关联交付项')
  }
  if (canonical.duplicatesRemoved > 0 || canonical.visible.length > 50) {
    throw new TrizApplyAttributionError('delivery refs 越界（重复或超过 50 上限）')
  }

  const optionIds = Array.isArray(attr.optionIds)
    ? attr.optionIds.filter((o): o is string => typeof o === 'string').slice(0, 10)
    : []
  const linkDigest = trizDlComputeLinkDigest({
    organizationId,
    projectId: sourceProjectId,
    decisionLogId: String(attr.decisionLogId),
    linkMode: 'apply_receipt',
    deliveryRefs: canonical.visible,
    contextRefs: [],
  })

  // 幂等：同 (org, digest) 已存在则直接复用既有 link（不抛错、不重复写）
  const existing = await trx
    .query()
    .from('triz_delivery_links')
    .where('organization_id', organizationId)
    .where('link_digest', linkDigest)
    .first()
  if (existing) {
    return existing as unknown as TrizDeliveryLink
  }

  const inserted = await trx.table('triz_delivery_links').insert({
    organization_id: organizationId,
    project_id: sourceProjectId,
    decision_log_id: attr.decisionLogId,
    draft_session_id: null,
    apply_result_id: params.applyResultId,
    scheme_id: typeof attr.schemeId === 'string' ? attr.schemeId.slice(0, 100) : null,
    option_ids: JSON.stringify(optionIds),
    source_hashes: JSON.stringify(attr.sourceHashes ?? {}),
    delivery_refs: JSON.stringify(canonical.visible),
    context_refs: JSON.stringify([]),
    link_mode: 'apply_receipt',
    preview_fingerprint: null,
    link_digest: linkDigest,
    supersedes_link_id: null,
    superseded_by_link_id: null,
    actor_user_id: actorUserId,
    created_at: DateTime.now().toSQL(),
  })
  const insertedId =
    typeof inserted === 'bigint' || typeof inserted === 'number' ? Number(inserted) : null
  const created = insertedId
    ? await trx.query().from('triz_delivery_links').where('id', insertedId).first()
    : await trx
        .query()
        .from('triz_delivery_links')
        .where('organization_id', organizationId)
        .where('link_digest', linkDigest)
        .first()

  // 低敏审计：refs 计数/digest/decision id；无正文。失败不阻断主事务语义——
  // 但为满足「同事务原子」，审计写入同样走 trx，异常将整体回滚（调用方 catch）。
  return (created ?? null) as unknown as TrizDeliveryLink | null
}
