/**
 * v2-triz-ai-clarification-cards —— TRIZ 矛盾只读 Adapter（tasks 2.1）。
 *
 * 为 TRIZ 澄清流程提供已授权的矛盾低敏 snapshot。
 * 同 TrizContradictionReadAdapter 职责一致但返回 TrizClarificationSourceRef 类型。
 * 严格只读：禁止 refresh/confirm/dismiss/supersede 等写操作。
 */
import ProjectContradiction from '#models/project_contradiction'
import type ContradictionPolicy from '#policies/contradiction_policy'
import type User from '#models/user'
import type {
  ContradictionStatus,
  ContradictionSeverity,
  ContradictionType,
  ProjectParameterKey,
  InventivePrincipleId,
} from '@aiproj/types'
import type { TrizClarificationSourceRef } from '@aiproj/types'

export interface TrizClarificationSourceOptions {
  /** 是否包含 draft 待确认候选（默认 false — 仅 confirmed） */
  includeDraft?: boolean
  /** 最多返回矛盾数量（默认 20） */
  limit?: number
  /** 是否跳过 stale 矛盾（默认 false） */
  skipStale?: boolean
}

export class TrizClarificationSourceAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrizClarificationSourceAdapterError'
  }
}

/**
 * TrizClarificationSourceAdapter —— 澄清流程对 TRIZ 矛盾的只读访问适配器。
 *
 * - 只返回低敏 TrizClarificationSourceRef（不包含完整 evidence、AI 解释正文等）
 * - 强制执行组织/项目/contradiction:view 权限
 * - 权限不足时静默返回空数组（不泄漏数量）
 */
export class TrizClarificationSourceAdapter {
  constructor(private policy: ContradictionPolicy) {}

  async getAuthorizedSnapshots(
    user: User,
    organizationId: number,
    projectId: number,
    options: TrizClarificationSourceOptions = {},
  ): Promise<TrizClarificationSourceRef[]> {
    const { includeDraft = false, limit = 20, skipStale = false } = options

    // 权限检查 — 无 contradiction:view 则静默返回空
    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) {
      return []
    }

    // 构建查询（只读，不触发任何 side-effect）
    const statuses: ContradictionStatus[] = ['confirmed']
    if (includeDraft) {
      statuses.push('draft')
    }

    const query = ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', statuses)
      .select(
        'id',
        'key',
        'title',
        'type',
        'status',
        'severity',
        'confidence',
        'stale',
        'stale_reason',
        'improving_parameter_key',
        'worsening_parameter_key',
        'parameter_key',
        'input_signature',
        'output_hash',
        'suggested_principles',
        'evidence',
      )

    // 可选跳过 stale
    if (skipStale) {
      query.where('stale', false)
    }

    // 按严重度降序
    query.orderByRaw(
      "CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END",
    )
    query.orderBy('confidence', 'desc')
    query.limit(Math.min(limit, 100))

    const contradictions = await query

    // 映射为低敏 ref
    return contradictions.map((c) => this.toClarificationRef(c))
  }

  /**
   * 查询单个矛盾的低敏 ref。
   * 无权限时返回 null。
   */
  async getSnapshotByKey(
    user: User,
    organizationId: number,
    projectId: number,
    key: string,
  ): Promise<TrizClarificationSourceRef | null> {
    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) return null

    const contradiction = await ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('key', key)
      .first()

    if (!contradiction) return null
    return this.toClarificationRef(contradiction)
  }

  /**
   * 检查项目是否有可见矛盾（无权限时静默返回 false）。
   */
  async hasVisibleContradictions(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) return false

    const count = await ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', ['confirmed'])
      .limit(1)
      .count('* as count')

    return Number(count[0].$extras?.count ?? 0) > 0
  }

  // ── Private ──

  private toClarificationRef(contradiction: any): TrizClarificationSourceRef {
    const rawPrinciples = contradiction.suggestedPrinciples ?? []
    const suggestedPrinciples = Array.isArray(rawPrinciples)
      ? rawPrinciples.map((p: any) => ({
          principleId: String(p.principleId ?? p.principle_id ?? '') as InventivePrincipleId,
          name: String(p.name ?? ''),
        }))
      : []

    const rawEvidence = contradiction.evidence ?? []
    const affectedScope = Array.isArray(rawEvidence)
      ? rawEvidence.map((_: any) => String(_.entityType ?? ''))
      : []

    return {
      contradictionId: Number(contradiction.id ?? 0),
      key: String(contradiction.key ?? ''),
      type: (contradiction.type ?? 'technical') as ContradictionType,
      status: (contradiction.status ?? 'draft') as ContradictionStatus,
      severity: (contradiction.severity ?? 'medium') as ContradictionSeverity,
      confidence: Number(contradiction.confidence ?? 0),
      stale: Boolean(contradiction.stale ?? false),
      staleReason: contradiction.stale_reason ?? null,
      improvingParameterKey: (contradiction.improving_parameter_key ??
        null) as ProjectParameterKey | null,
      worseningParameterKey: (contradiction.worsening_parameter_key ??
        null) as ProjectParameterKey | null,
      parameterKey: (contradiction.parameter_key ?? null) as ProjectParameterKey | null,
      title: String(contradiction.title ?? ''),
      affectedScope,
      suggestedPrinciples,
      inputSignature: String(contradiction.input_signature ?? ''),
      outputHash: contradiction.output_hash ?? null,
    }
  }
}
