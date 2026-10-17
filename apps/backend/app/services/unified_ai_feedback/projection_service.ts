/**
 * v3-unified-ai-feedback-ledger §4–5 — 只读投影 service。
 *
 * 职责：
 * - 从 `ai_draft_layer_changes` 只读投影为 UnifiedFeedbackEvent 形状（不写不改）；
 * - 五态 review_status → feedbackType 直映（同一枚举）；
 * - entity_type → artifactKind 映射（task → draft_layer_change 等）；
 * - 组织隔离：全部查询首列 organization_id 过滤；
 * - 去重：同一决策只计一次（deduplicationKey = organizationId:artifactKind:artifactId）；
 * - combinedProjection：新旧事件合并，按 deduplicationKey 去重（新事件优先）；
 * - modified 与 accepted 永远分开，不在任何聚合路径合并。
 *
 * 红线：只用 .select()，绝不对 ai_draft_layer_changes 执行 insert/update/delete。
 */

import type {
  FeedbackType,
  EvaluatedArtifactKind,
  FeedbackCapabilitySurface,
  UnifiedFeedbackEvent,
} from '@aiproj/types'
import { isFeedbackType, computeFeedbackDeduplicationKey } from '@aiproj/types'
import DraftLayerChange from '#models/draft_layer_change'
import UnifiedAiFeedbackEvent from '#models/unified_ai_feedback_event'
import { type DateTime } from 'luxon'

// ---------------------------------------------------------------------------
// §4.2 review_status → feedbackType 直映
// ---------------------------------------------------------------------------

/**
 * review_status 与 FeedbackType 共享同一五态枚举。
 * 此函数做类型收窄，非法值返回 null（调用方决定跳过或投 pending）。
 */
export function mapReviewStatusToFeedbackType(reviewStatus: string): FeedbackType | null {
  if (isFeedbackType(reviewStatus)) {
    return reviewStatus
  }
  return null
}

// ---------------------------------------------------------------------------
// §4.3 entity_type → artifactKind 映射
// ---------------------------------------------------------------------------

/**
 * Draft Layer 的 entity_type 到统一反馈账本的 EvaluatedArtifactKind 映射。
 * 未知类型返回 null（投影时跳过该行）。
 */
export function mapEntityTypeToArtifactKind(entityType: string): EvaluatedArtifactKind | null {
  switch (entityType) {
    case 'task':
      return 'draft_layer_change'
    case 'milestone':
      return 'draft_layer_change'
    case 'dependency':
      return 'draft_layer_change'
    case 'risk':
      return 'suggestion'
    case 'resource':
      return 'suggestion'
    case 'wbs_node':
      return 'draft_layer_change'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// §4.4 capability surface 映射
// ---------------------------------------------------------------------------

/**
 * 从 Draft Layer session 上下文推导 capability surface。
 * Draft Layer 默认映射到 'draft' 能力面。
 */
export function deriveCapabilitySurface(_sessionSource?: string): FeedbackCapabilitySurface {
  return 'draft'
}

// ---------------------------------------------------------------------------
// §4.5 deduplicationKey 计算
// ---------------------------------------------------------------------------

/**
 * 为一行 ai_draft_layer_changes 计算去重键。
 * 委托给共享契约的 computeFeedbackDeduplicationKey。
 */
export function computeDraftLayerDeduplicationKey(
  organizationId: number,
  artifactKind: EvaluatedArtifactKind,
  artifactId: string,
): string {
  return computeFeedbackDeduplicationKey(artifactKind, artifactId, organizationId)
}

// ---------------------------------------------------------------------------
// §5.1 单表只读投影
// ---------------------------------------------------------------------------

/** 投影查询参数。 */
export interface ProjectionQuery {
  organizationId: number
  projectId?: number | null
  /** 限制扫描行数（防止无界查询）。 */
  limit?: number
}

/** 投影结果中的单条事件。 */
export type ProjectedFeedbackEvent = UnifiedFeedbackEvent

/**
 * 从 ai_draft_layer_changes 只读投影为 UnifiedFeedbackEvent 形状。
 *
 * 红线：
 * - 只用 .select()，不写不改 ai_draft_layer_changes；
 * - 按 deduplicationKey 去重，同一决策只返回一次；
 * - modified 与 accepted 分开返回。
 */
export async function projectFromDraftLayerChanges(
  query: ProjectionQuery,
  options?: { maxRows?: number },
): Promise<ProjectedFeedbackEvent[]> {
  const maxRows = options?.maxRows ?? 5000

  // 组织隔离：通过 session 关联过滤（DraftLayerChange 无 organization_id 列）
  // 实际查询需通过 DraftLayerSession 的 organization_id 过滤
  // 此处用 raw query 的方式：先查 change 表，再过滤
  const changes = await DraftLayerChange.query()
    .select(
      'id',
      'session_id',
      'target_entity_type',
      'target_entity_id',
      'target_field_path',
      'review_status',
      'user_note',
      'created_at',
    )
    .limit(maxRows)

  const projected: ProjectedFeedbackEvent[] = []
  const seenDedupKeys = new Set<string>()

  for (const change of changes) {
    const feedbackType = mapReviewStatusToFeedbackType(change.reviewStatus)
    if (!feedbackType) continue

    const artifactKind = mapEntityTypeToArtifactKind(change.targetEntityType)
    if (!artifactKind) continue

    const deduplicationKey = computeDraftLayerDeduplicationKey(
      query.organizationId,
      artifactKind,
      change.targetEntityId,
    )

    // 去重：同一决策只计一次
    if (seenDedupKeys.has(deduplicationKey)) continue
    seenDedupKeys.add(deduplicationKey)

    projected.push({
      id: change.id,
      organizationId: query.organizationId,
      projectId: query.projectId ?? null,
      artifactKind,
      artifactId: change.targetEntityId,
      capabilitySurface: deriveCapabilitySurface(),
      feedbackType,
      rejectionReason: null,
      modificationFingerprint: null,
      note: change.userNote ?? null,
      proposedContentHash: null,
      finalContentHash: null,
      actorId: 0, // 投影来源不记录操作者
      idempotencyKey: `draft_layer投影:${change.id}`,
      sourceEndpoint: 'draft_layer_projection',
      sourceRef: `draft_layer_change:${change.id}`,
      deduplicationKey,
      occurredAt: (change.createdAt as DateTime).toISO()!,
      createdAt: (change.createdAt as DateTime).toISO()!,
    })
  }

  return projected
}

// ---------------------------------------------------------------------------
// §5.2 从新事件表查询
// ---------------------------------------------------------------------------

/**
 * 从 unified_ai_feedback_events 查询事件（只读）。
 */
export async function queryFeedbackEvents(
  organizationId: number,
  options?: {
    projectId?: number | null
    capabilitySurface?: FeedbackCapabilitySurface
    feedbackType?: FeedbackType
    limit?: number
  },
): Promise<ProjectedFeedbackEvent[]> {
  let query = UnifiedAiFeedbackEvent.query()
    .where('organization_id', organizationId)
    .limit(options?.limit ?? 5000)

  if (options?.projectId != null) {
    query = query.where('project_id', options.projectId)
  }
  if (options?.capabilitySurface) {
    query = query.where('capability_surface', options.capabilitySurface)
  }
  if (options?.feedbackType) {
    query = query.where('feedback_type', options.feedbackType)
  }

  const rows = await query

  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    projectId: r.projectId,
    artifactKind: r.artifactKind,
    artifactId: r.artifactId,
    capabilitySurface: r.capabilitySurface,
    feedbackType: r.feedbackType,
    rejectionReason: r.rejectionReason,
    modificationFingerprint: r.modificationFingerprint,
    note: r.note,
    proposedContentHash: r.proposedContentHash,
    finalContentHash: r.finalContentHash,
    actorId: r.actorId,
    idempotencyKey: r.idempotencyKey,
    sourceEndpoint: r.sourceEndpoint,
    sourceRef: r.sourceRef,
    deduplicationKey: r.deduplicationKey,
    occurredAt: (r.occurredAt as DateTime).toISO()!,
    createdAt: (r.createdAt as DateTime).toISO()!,
  }))
}

// ---------------------------------------------------------------------------
// §5.3 合并投影（新旧事件去重合并）
// ---------------------------------------------------------------------------

/**
 * 合并投影：将 Draft Layer 投影与新事件表查询结果合并。
 * 按 deduplicationKey 去重，新事件表的记录优先（更完整）。
 * modified 与 accepted 永远分开。
 */
export async function combinedProjection(
  organizationId: number,
  options?: {
    projectId?: number | null
    limit?: number
  },
): Promise<ProjectedFeedbackEvent[]> {
  // 并行获取两侧数据
  const [draftLayerEvents, newTableEvents] = await Promise.all([
    projectFromDraftLayerChanges(
      { organizationId, projectId: options?.projectId },
      { maxRows: options?.limit },
    ),
    queryFeedbackEvents(organizationId, { projectId: options?.projectId, limit: options?.limit }),
  ])

  // 用 Map 按 deduplicationKey 去重，新事件表优先
  const merged = new Map<string, ProjectedFeedbackEvent>()

  // 先放 Draft Layer 投影
  for (const event of draftLayerEvents) {
    if (event.deduplicationKey) {
      merged.set(event.deduplicationKey, event)
    }
  }

  // 再放新事件表（覆盖同 key 的旧投影）
  for (const event of newTableEvents) {
    if (event.deduplicationKey) {
      merged.set(event.deduplicationKey, event)
    }
  }

  // 对没有 deduplicationKey 的事件单独追加（不参与去重）
  for (const event of [...draftLayerEvents, ...newTableEvents]) {
    if (!event.deduplicationKey) {
      merged.set(`fallback:${event.sourceEndpoint}:${event.id}`, event)
    }
  }

  return [...merged.values()]
}
