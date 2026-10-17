/**
 * v3-triz-to-delivery-closed-loop —— ClosedLoopReadModelService（tasks 5.8–5.10）。
 *
 * 分页 read model：先取有界 link keys，再按 kind 批量 hydrate（每 kind 恰一次批量
 * 查询，禁止 N+1），最后以纯函数 projector 投影确定性 posture。读取零副作用：
 * 不写 links/events/audit 之外的任何记录——本服务根本不写。
 *
 * freshness（D4 优先级 2）：decision 非 active，或任一 required ref 的 revisionHint
 * 与权威 updatedAt 漂移 → 整项 source_stale fail closed（同事实恒同投影）。
 */
import db from '@adonisjs/lucid/services/db'
import type {
  TrizDlAuthorizedEntitySummary,
  TrizDlClosedLoopItem,
  TrizDlClosedLoopSummary,
  TrizDlEntityFact,
  TrizDlEntityKind,
  TrizDlEntityRef,
  TrizDlLinkMode,
  TrizDlPosture,
  TrizDlVerificationConclusion,
  TrizDlWarningCode,
} from '@aiproj/types'
import { sortTrizDlItems, trizDlStableSerialize, projectTrizDlPosture } from '@aiproj/types'
import type { TrizDlClosedAdapterRegistry } from './read_adapters.js'

export class TrizDlItemNotFoundError extends Error {
  constructor() {
    super('闭环项不存在')
    this.name = 'TrizDlItemNotFoundError'
  }
}

interface LinkRow {
  id: number | string
  organization_id: number | string
  project_id: number | string
  decision_log_id: number | string
  delivery_refs: string | null
  context_refs: string | null
  link_mode: string
  superseded_by_link_id: number | string | null
  created_at: string | Date
}

interface DecisionRow {
  id: number | string
  decision_status: string
}

function parseRefs(raw: string | null): TrizDlEntityRef[] {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is TrizDlEntityRef =>
        !!r && typeof r === 'object' && 'kind' in (r as object) && 'entityId' in (r as object),
    )
  } catch {
    return []
  }
}

export interface ListParams {
  organizationId: number
  projectId: number
  actorUserId: number
  page?: number
  perPage?: number
  postureFilter?: TrizDlPosture
  /** 隐藏实体集合由上游 Policy 决定；read model 只负责不可见化。 */
  hiddenEntityIds?: ReadonlySet<string>
}

export interface ListResult {
  items: TrizDlClosedLoopItem[]
  meta: {
    page: number
    perPage: number
    totalVisibleInWindow: number
    hasHiddenRefs: boolean
  }
  summary: TrizDlClosedLoopSummary
}

export interface DetailResult extends TrizDlClosedLoopItem {
  entitySummaries: TrizDlAuthorizedEntitySummary[]
  contextSummaries: TrizDlAuthorizedEntitySummary[]
  linkMode: TrizDlLinkMode
  legacyUnlinked: boolean
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export class ClosedLoopReadModelService {
  constructor(private readonly registry: TrizDlClosedAdapterRegistry) {}

  async list(params: ListParams): Promise<ListResult> {
    const page = Math.max(1, params.page ?? 1)
    const perPageRaw = params.perPage ?? 20
    const { TRIZ_DL_MAX_PER_PAGE } = await import('@aiproj/types')
    const perPage = Math.min(Math.max(1, perPageRaw), TRIZ_DL_MAX_PER_PAGE)

    const rows = (await db
      .query()
      .from('triz_delivery_links')
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .orderBy('id', 'asc')
      .offset((page - 1) * perPage)
      .limit(perPage)) as unknown as LinkRow[]

    // decision 批量
    const decisionIds = [...new Set(rows.map((r) => String(r.decision_log_id)))]
    const decisions = new Map<string, DecisionRow>()
    for (const ids of chunk(decisionIds, 100)) {
      const found = (await db
        .query()
        .from('triz_decision_logs')
        .whereIn('id', ids.map(Number))) as unknown as DecisionRow[]
      for (const d of found) decisions.set(String(d.id), d)
    }

    // §7 接入：本页 links 的验证事件批量读取（每页恰一次查询）
    const pageLinkIds = rows.map((r) => Number(r.id))
    const verificationsByLink = new Map<
      number,
      { conclusion: TrizDlVerificationConclusion; eventId: number }
    >()
    if (pageLinkIds.length > 0) {
      const evRows = (await db
        .query()
        .from('triz_delivery_events')
        .whereIn('link_id', pageLinkIds)
        .orderBy('id', 'asc')) as unknown as Array<{
        id: number
        link_id: number | string
        event_kind: string
        conclusion: string | null
        supersedes_event_id: number | null
      }>
      const superseded = new Set(
        evRows.map((e) => e.supersedes_event_id).filter((v): v is number => v !== null),
      )
      for (const e of evRows) {
        if (e.event_kind !== 'verification_recorded') continue
        if (superseded.has(Number(e.id))) continue
        if (
          e.conclusion === 'effective' ||
          e.conclusion === 'ineffective' ||
          e.conclusion === 'inconclusive'
        ) {
          verificationsByLink.set(Number(e.link_id), {
            conclusion: e.conclusion,
            eventId: Number(e.id),
          })
        }
      }
    }

    // 按 kind 跨页聚合批量 hydrate（每 kind 每 chunk 一次查询）
    const entriesByKind = await this.#hydrateAll(rows, params)

    let hasHiddenRefs = false
    const items: TrizDlClosedLoopItem[] = []

    for (const row of rows) {
      const itemId = `link-${row.id}`
      const decisionLogId = String(row.decision_log_id)
      const linkSuperseded = row.superseded_by_link_id !== null
      const decision = decisions.get(decisionLogId)
      // D4 语义分工：仅显式 supersede 链产生 'superseded'；
      // decision 缺失/archived 或 revision 漂移 → source_stale（fail closed）。
      const decisionSuperseded = !!decision && decision.decision_status === 'superseded'
      const decisionUnresolvable = !decision || decision.decision_status === 'archived'

      const deliveryRefsAll = parseRefs(row.delivery_refs)
      const contextRefsAll = parseRefs(row.context_refs)
      const facts: TrizDlEntityFact[] = []
      const visibleRefs: TrizDlEntityRef[] = []
      const visibleContextRefs: TrizDlEntityRef[] = []
      let itemHasHiddenRefs = false

      for (const ref of deliveryRefsAll) {
        const entry = entriesByKind.get(ref.kind)?.get(ref.entityId)
        if (!entry) {
          facts.push({ ref, state: 'missing', posture: null })
          continue
        }
        if (entry.posture === 'unavailable') {
          hasHiddenRefs = true
          itemHasHiddenRefs = true
          // 无权限/已删除实体：不进入可见 refs/计数/标题语料
          facts.push({ ref, state: 'unavailable', posture: null })
          continue
        }
        facts.push({ ref, state: 'ok', posture: entry.posture })
        visibleRefs.push(ref)
      }

      for (const ref of contextRefsAll) {
        const entry = entriesByKind.get(ref.kind)?.get(ref.entityId)
        if (!entry || entry.posture === 'unavailable') {
          hasHiddenRefs = true
          itemHasHiddenRefs = true
          continue
        }
        visibleContextRefs.push(ref)
      }

      // revision 漂移检测：仅对已快照 revisionHint 的 ok facts 比对
      const revisionDrifted = facts.some((f) => {
        if (f.state !== 'ok') return false
        const hint = f.ref.revisionHint
        if (!hint) return false
        const current = entriesByKind.get(f.ref.kind)?.get(f.ref.entityId)?.revisionHint
        return current !== null && current !== undefined && current !== hint
      })

      const sourceFreshness: 'fresh' | 'stale' =
        decisionUnresolvable || revisionDrifted ? 'stale' : 'fresh'

      // §7：最新有效验证（superseded 链排除后取最后一条）；
      // fresh 口径与整体来源一致（drift/archived 时旧验证仅作历史 → source_stale 优先）。
      const verif = verificationsByLink.get(Number(row.id))
      const latestVerification = verif
        ? {
            conclusion: verif.conclusion,
            fresh: sourceFreshness === 'fresh',
            superseded: false,
          }
        : null

      const projection = projectTrizDlPosture({
        linkSuperseded,
        decisionSuperseded,
        sourceFreshness,
        hasValidLink: true,
        latestVerification,
        requiredDeliveryFacts: facts,
      })

      const warnings: TrizDlWarningCode[] = [...projection.warningCodes]
      if (itemHasHiddenRefs) {
        warnings.push('TRIZ_DL_HIDDEN_ENTITY')
      }

      items.push({
        itemId,
        projectId: Number(row.project_id),
        organizationId: Number(row.organization_id),
        decisionLogId,
        linkMode: row.link_mode as TrizDlLinkMode,
        posture: projection.posture,
        warningCodes: warnings,
        degradedReasons: [],
        deliveryRefs: visibleRefs,
        contextRefs: visibleContextRefs,
        latestConclusion: verif?.conclusion ?? null,
        // 排序必须绑定权威事实，不能使用读取时钟；否则相同事实的重复读取会因
        // 毫秒边界产生不同顺序，违反确定性投影契约。
        updatedAt: new Date(row.created_at).toISOString(),
      })
    }

    const filtered =
      params.postureFilter !== undefined
        ? items.filter((i) => i.posture === params.postureFilter)
        : items
    const sorted = sortTrizDlItems(filtered)

    return {
      items: sorted,
      meta: {
        page,
        perPage,
        totalVisibleInWindow: sorted.length,
        hasHiddenRefs,
      },
      summary: this.#summarize(sorted),
    }
  }

  async detail(
    itemId: string,
    ctx: Pick<ListParams, 'organizationId' | 'projectId' | 'hiddenEntityIds'>,
  ): Promise<DetailResult> {
    const m = /^link-(\d+)$/.exec(itemId)
    if (!m) throw new TrizDlItemNotFoundError()
    const row = (await db
      .query()
      .from('triz_delivery_links')
      .where('organization_id', ctx.organizationId)
      .where('project_id', ctx.projectId)
      .where('id', Number(m[1]))
      .first()) as unknown as LinkRow | undefined
    if (!row) throw new TrizDlItemNotFoundError()

    const entriesByKind = await this.#hydrateAll([row], ctx)

    // 详情必须定位到目标 link 所在的稳定 id 窗口；固定读取第一页会让第 1 页之后的
    // link 退回默认 posture，并可能忽略当前 verification/source freshness。
    const rankRow = (await db
      .query()
      .from('triz_delivery_links')
      .where('organization_id', ctx.organizationId)
      .where('project_id', ctx.projectId)
      .where('id', '<=', Number(m[1]))
      .count('* as total')
      .first()) as unknown as { total: number | string } | undefined
    const perPage = 100
    const rank = Number(rankRow?.total ?? 1)
    const list = await this.list({
      ...ctx,
      actorUserId: 0,
      page: Math.max(1, Math.ceil(rank / perPage)),
      perPage,
    })
    const base =
      list.items.find((i) => i.itemId === itemId) ??
      ({
        itemId,
        projectId: Number(row.project_id),
        organizationId: Number(row.organization_id),
        decisionLogId: String(row.decision_log_id),
        linkMode: row.link_mode as TrizDlLinkMode,
        posture: 'delivery_linked',
        warningCodes: [],
        degradedReasons: [],
        deliveryRefs: parseRefs(row.delivery_refs),
        contextRefs: parseRefs(row.context_refs),
        latestConclusion: null,
        updatedAt: new Date(row.created_at).toISOString(),
      } satisfies TrizDlClosedLoopItem)

    const entitySummaries = base.deliveryRefs
      .map((ref) => entriesByKind.get(ref.kind)?.get(ref.entityId))
      .filter((e): e is TrizDlAuthorizedEntitySummary => !!e)
    const contextSummaries = parseRefs(row.context_refs)
      .map((ref) => entriesByKind.get(ref.kind)?.get(ref.entityId))
      .filter((e): e is TrizDlAuthorizedEntitySummary => !!e)

    return {
      ...base,
      entitySummaries,
      contextSummaries,
      linkMode: row.link_mode as TrizDlLinkMode,
      legacyUnlinked: parseRefs(row.delivery_refs).length === 0,
    }
  }

  #summarize(items: readonly TrizDlClosedLoopItem[]): TrizDlClosedLoopSummary {
    const totals = Object.fromEntries(
      (
        [
          'superseded',
          'source_stale',
          'verified_effective',
          'verified_ineffective',
          'blocked',
          'in_progress',
          'awaiting_verification',
          'delivery_linked',
          'awaiting_apply',
        ] as TrizDlPosture[]
      ).map((p) => [p, 0]),
    ) as Record<TrizDlPosture, number>
    for (const i of items) totals[i.posture] += 1
    return {
      projectId: items[0]?.projectId ?? 0,
      totals,
      visibleItemCount: items.length,
      hasHiddenItems: items.some((i) => i.warningCodes.includes('TRIZ_DL_HIDDEN_ENTITY')),
      degradedReasons: [],
      generatedAt: new Date().toISOString(),
    }
  }

  /** 按 kind 去重并分块批量 hydrate；每 kind 每个 chunk 恰一次查询（无 N+1）。 */
  async #hydrateAll(
    rows: readonly LinkRow[],
    params: Pick<ListParams, 'organizationId' | 'projectId' | 'hiddenEntityIds'>,
  ): Promise<Map<TrizDlEntityKind, Map<string, TrizDlAuthorizedEntitySummary>>> {
    const idsByKind = new Map<TrizDlEntityKind, Set<string>>()
    for (const row of rows) {
      for (const ref of [...parseRefs(row.delivery_refs), ...parseRefs(row.context_refs)]) {
        const set = idsByKind.get(ref.kind) ?? new Set<string>()
        set.add(ref.entityId)
        idsByKind.set(ref.kind, set)
      }
    }
    const out = new Map<TrizDlEntityKind, Map<string, TrizDlAuthorizedEntitySummary>>()
    for (const [kind, ids] of idsByKind) {
      const port = this.registry.get(kind)
      if (!port) continue
      const acc = new Map<string, TrizDlAuthorizedEntitySummary>()
      // 每页最多 100 links × 50 delivery/context refs。1000 保持在现代 SQLite
      // 参数预算内，并将最坏页的 adapter 查询数控制在冻结的总查询预算之下。
      for (const idsChunk of chunk([...ids], 1000)) {
        const found = await port.fetchSummaries(idsChunk, {
          organizationId: params.organizationId,
          projectId: params.projectId,
          hiddenEntityIds: params.hiddenEntityIds,
        })
        for (const [k, v] of found) acc.set(k, v)
      }
      out.set(kind, acc)
    }
    void trizDlStableSerialize // 保留引用：调试时用稳定序列化输出 diff
    return out
  }
}
