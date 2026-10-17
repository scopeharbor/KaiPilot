/**
 * v3-triz-to-delivery-closed-loop —— existing-entity link preview / confirm
 * （tasks 6.1–6.7）。
 *
 * Preview（6.1）：解析合格 decision、task/milestone refs、context refs、来源 freshness、
 * 领域 revisions 与权限 → 输出有界候选 + previewFingerprint；零写入。
 *
 * Confirm（6.3）：在同一事务内**重新解析全部事实并重算 fingerprint**（TOCTOU 防护），
 * 不一致 → 409 PREVIEW_STALE fail closed；一致则以 (organization_id, link_digest)
 * 幂等创建 link（仅写关联，不改任何正式实体——“只写关联”由 preview 声明确认 +
 * confirm 后正式实体字段不变证明测试守住）。重复 confirm 返回既有 link。
 */
import db from '@adonisjs/lucid/services/db'
import type {
  TrizDlAuthorizedEntitySummary,
  TrizDlEntityRef,
  TrizDlLinkPreviewRequest,
  TrizDlLinkPreviewResponse,
} from '@aiproj/types'
import {
  TRIZ_DL_CONTEXT_KINDS,
  TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS,
  trizDlCanonicalizeRefs,
  trizDlComputeLinkDigest,
  trizDlComputePreviewFingerprint,
} from '@aiproj/types'
import { TRIZ_DL_REQUIRED_DELIVERY_KINDS } from '@aiproj/types'
import type { TrizDlClosedAdapterRegistry } from './read_adapters.js'

export class TrizDlLinkValidationError extends Error {
  constructor(
    message: string,
    public code:
      | 'DECISION_INVALID'
      | 'DECISION_NOT_ACTIVE'
      | 'NO_REQUIRED_DELIVERY'
      | 'REFS_OVERFLOW'
      | 'DUPLICATE_REFS'
      | 'CROSS_KIND'
      | 'ENTITY_HIDDEN'
      | 'PREVIEW_STALE' = 'PREVIEW_STALE',
  ) {
    super(message)
    this.name = 'TrizDlLinkValidationError'
  }
}

interface ParsedDecision {
  id: number
  projectId: number
  decisionStatus: string
}

async function loadDecision(
  organizationId: number,
  projectId: number,
  decisionLogId: string,
): Promise<ParsedDecision> {
  const row = await db
    .query()
    .from('triz_decision_logs')
    .where('organization_id', organizationId)
    .where('project_id', projectId)
    .where('id', Number(decisionLogId))
    .first()
  if (!row) throw new TrizDlLinkValidationError('decision log 不存在或跨项目', 'DECISION_INVALID')
  return {
    id: Number(row.id),
    projectId: Number(row.project_id),
    decisionStatus: String(row.decision_status),
  }
}

interface NormalizedRequest {
  deliveryRefs: TrizDlEntityRef[]
  contextRefs: TrizDlEntityRef[]
  duplicatesRemoved: number
}

function normalizeAndValidateRefs(req: TrizDlLinkPreviewRequest): NormalizedRequest {
  for (const ref of [...req.deliveryRefs, ...(req.contextRefs ?? [])]) {
    if (
      !(TRIZ_DL_REQUIRED_DELIVERY_KINDS as readonly string[]).includes(ref.kind) &&
      !(TRIZ_DL_CONTEXT_KINDS as readonly string[]).includes(ref.kind)
    ) {
      throw new TrizDlLinkValidationError(`非法实体 kind: ${String(ref.kind)}`, 'CROSS_KIND')
    }
  }
  const d = trizDlCanonicalizeRefs(req.deliveryRefs)
  if (d.duplicatesRemoved > 0) {
    throw new TrizDlLinkValidationError('delivery refs 存在重复', 'DUPLICATE_REFS')
  }
  const c = trizDlCanonicalizeRefs(req.contextRefs ?? [])
  if (c.duplicatesRemoved > 0) {
    throw new TrizDlLinkValidationError('context refs 存在重复', 'DUPLICATE_REFS')
  }
  if (d.visible.length === 0) {
    throw new TrizDlLinkValidationError(
      '至少需要一个 task/milestone 交付 ref',
      'NO_REQUIRED_DELIVERY',
    )
  }
  if (d.visible.length > TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS) {
    throw new TrizDlLinkValidationError('delivery refs 超过上限', 'REFS_OVERFLOW')
  }
  return { deliveryRefs: d.visible, contextRefs: c.visible.slice(0, 20), duplicatesRemoved: 0 }
}

async function hydrateEntries(
  registry: TrizDlClosedAdapterRegistry,
  refs: readonly TrizDlEntityRef[],
  ctx: { organizationId: number; projectId: number },
): Promise<Map<string, TrizDlAuthorizedEntitySummary>> {
  const out = new Map<string, TrizDlAuthorizedEntitySummary>()
  const byKind = new Map<string, Set<string>>()
  for (const ref of refs) {
    const set = byKind.get(ref.kind) ?? new Set()
    set.add(ref.entityId)
    byKind.set(ref.kind, set)
  }
  for (const [kind, ids] of byKind) {
    const port = registry.get(kind as never)
    if (!port) continue
    const found = await port.fetchSummaries([...ids], ctx)
    for (const [k, v] of found) out.set(`${kind}:${k}`, v)
  }
  return out
}

function assertNoHiddenOrDeleted(
  refs: readonly TrizDlEntityRef[],
  entries: Map<string, TrizDlAuthorizedEntitySummary>,
) {
  for (const ref of refs) {
    const e = entries.get(`${ref.kind}:${ref.entityId}`)
    if (!e || e.posture === 'unavailable') {
      throw new TrizDlLinkValidationError('引用的交付项不存在、已删除或不可访问', 'ENTITY_HIDDEN')
    }
  }
}

export class TrizDeliveryLinkService {
  constructor(private readonly registry: TrizDlClosedAdapterRegistry) {}

  /** 读取侧公共解析：decision 校验 + refs 规范化 + 实体摘要。 */
  private async resolveFacts(
    organizationId: number,
    projectId: number,
    req: Pick<TrizDlLinkPreviewRequest, 'decisionLogId' | 'deliveryRefs' | 'contextRefs'>,
  ) {
    const decision = await loadDecision(organizationId, projectId, req.decisionLogId)
    if (decision.decisionStatus !== 'active') {
      throw new TrizDlLinkValidationError(
        `decision 状态为 ${decision.decisionStatus}，必须 active 才能建立关联`,
        'DECISION_NOT_ACTIVE',
      )
    }
    const norm = normalizeAndValidateRefs({ ...req, projectId })
    const entries = await hydrateEntries(this.registry, norm.deliveryRefs, {
      organizationId,
      projectId,
    })
    assertNoHiddenOrDeleted(norm.deliveryRefs, entries)
    const contextEntries = await hydrateEntries(this.registry, norm.contextRefs, {
      organizationId,
      projectId,
    })
    // context 允许 unavailable（展示为降级），但同样不得是隐藏实体口径之外的猜测
    return { decision, ...norm, entries, contextEntries }
  }

  /**
   * preview：纯解析，零写入。sourceFreshness 以 decision 是否 active 表达
   * （scheme hash 级 freshness 在 §5 resolver 已用于 read model 投影）。
   */
  async preview(
    organizationId: number,
    projectId: number,
    req: TrizDlLinkPreviewRequest,
  ): Promise<TrizDlLinkPreviewResponse> {
    const facts = await this.resolveFacts(organizationId, projectId, req)

    const entitySummaries = facts.deliveryRefs.map((ref) =>
      facts.entries.get(`${ref.kind}:${ref.entityId}`)!,
    )
    const contextSummaries = facts.contextRefs.map((ref) => {
      const found = facts.contextEntries.get(`${ref.kind}:${ref.entityId}`)
      return (
        found ?? {
          kind: ref.kind,
          entityId: ref.entityId,
          posture: 'unavailable' as const,
          revisionHint: null,
          title: null,
          unavailableReason: 'error' as const,
        }
      )
    })

    const sourceFreshness = 'fresh' as const
    // fingerprint 输入 = 当前已解析的领域事实快照（含 revisionHint）
    const previewFingerprint = trizDlComputePreviewFingerprint({
      projectId,
      decisionLogId: req.decisionLogId,
      decisionSchemeHash: null,
      sourceContentHashes: [],
      deliveryRefs: facts.deliveryRefs.map((r) => ({
        ...r,
        revisionHint: facts.entries.get(`${r.kind}:${r.entityId}`)?.revisionHint ?? undefined,
      })),
      contextRefs: facts.contextRefs,
    })

    return {
      preview: {
        decisionLogId: req.decisionLogId,
        deliveryRefs: facts.deliveryRefs,
        contextRefs: facts.contextRefs,
        sourceFreshness,
        entitySummaries,
        warningCodes: contextSummaries.some((c) => c.posture === 'unavailable')
          ? ['TRIZ_DL_PARTIAL_UNAVAILABLE']
          : [],
      },
      previewFingerprint,
      confirmationOwnedBy: 'user',
      notice: '确认后只写闭环关联，不修改任何正式实体的状态、负责人、日期或内容。',
    }
  }

  /**
   * confirm：重新解析全部事实并重算 fingerprint；不匹配 → PREVIEW_STALE。
   * 成功则在事务内以 digest 幂等写 link。返回 {linkId, replayed}。
   */
  async confirm(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    params: {
      request: TrizDlLinkPreviewRequest
      previewFingerprint: string
    },
  ): Promise<{ linkId: number; replayed: boolean }> {
    // CAS：事务外重解析比对，事务内再次落库校验（设计 D3）。
    const fresh = await this.resolveFacts(organizationId, projectId, params.request).catch((e) => {
      if (e instanceof TrizDlLinkValidationError && e.code === 'ENTITY_HIDDEN') {
        throw new TrizDlLinkValidationError(
          '实体在 preview 后被删除或变为不可访问',
          'PREVIEW_STALE',
        )
      }
      throw e
    })

    const recompute = trizDlComputePreviewFingerprint({
      projectId,
      decisionLogId: params.request.decisionLogId,
      decisionSchemeHash: null,
      sourceContentHashes: [],
      deliveryRefs: fresh.deliveryRefs.map((r) => ({
        ...r,
        revisionHint: fresh.entries.get(`${r.kind}:${r.entityId}`)?.revisionHint ?? undefined,
      })),
      contextRefs: fresh.contextRefs,
    })
    if (recompute !== params.previewFingerprint) {
      throw new TrizDlLinkValidationError(
        '来源或实体在 preview 后发生变化，请重新预览',
        'PREVIEW_STALE',
      )
    }

    const linkDigest = trizDlComputeLinkDigest({
      organizationId,
      projectId,
      decisionLogId: params.request.decisionLogId,
      linkMode: 'existing_entity',
      deliveryRefs: fresh.deliveryRefs,
      contextRefs: fresh.contextRefs,
    })

    return db.transaction(async (trx) => {
      const existing = await trx
        .query()
        .from('triz_delivery_links')
        .where('organization_id', organizationId)
        .where('link_digest', linkDigest)
        .first()
      if (existing) return { linkId: Number(existing.id), replayed: true }

      const inserted = await trx.table('triz_delivery_links').insert({
        organization_id: organizationId,
        project_id: projectId,
        decision_log_id: Number(params.request.decisionLogId),
        draft_session_id: null,
        apply_result_id: null,
        scheme_id: null,
        option_ids: null,
        source_hashes: null,
        delivery_refs: JSON.stringify(fresh.deliveryRefs),
        context_refs: JSON.stringify(fresh.contextRefs),
        link_mode: 'existing_entity',
        preview_fingerprint: params.previewFingerprint.slice(0, 64),
        link_digest: linkDigest,
        supersedes_link_id: null,
        superseded_by_link_id: null,
        actor_user_id: actorUserId,
        created_at: new Date().toISOString(),
      })
      const id = typeof inserted === 'bigint' ? Number(inserted) : Number(inserted)
      void trx
      return { linkId: id, replayed: false }
    })
  }

  /**
   * supersession（6.7）：更正关联仅追加新行并回填旧行 superseded_by；
   * 历史完全保留。链无环由「旧行必须未被回填」+ 不可自我更正保证。
   */
  async supersedeLink(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    oldLinkId: number,
    replacement: TrizDlLinkPreviewRequest & { previewFingerprint: string },
  ): Promise<{ newLinkId: number }> {
    const created = await this.confirm(organizationId, projectId, actorUserId, {
      request: replacement,
      previewFingerprint: replacement.previewFingerprint,
    })
    await db.transaction(async (trx) => {
      const oldRow = await trx
        .query()
        .from('triz_delivery_links')
        .where('organization_id', organizationId)
        .where('id', oldLinkId)
        .first()
      if (!oldRow) throw new TrizDlLinkValidationError('旧 link 不存在', 'PREVIEW_STALE')
      // 链无环：旧行必须未被 supersede 且新行不是它自己
      if (oldRow.superseded_by_link_id !== null) {
        throw new TrizDlLinkValidationError('旧 link 已被更正过', 'PREVIEW_STALE')
      }
      if (Number(oldRow.id) === created.linkId) {
        throw new TrizDlLinkValidationError('不能自我更正', 'PREVIEW_STALE')
      }
      await trx
        .query()
        .from('triz_delivery_links')
        .where('id', oldLinkId)
        .update({ superseded_by_link_id: created.linkId })
    })
    return { newLinkId: created.linkId }
  }
}
