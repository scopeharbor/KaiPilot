import Project from '#models/project'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import Task from '#models/task'
import TaskResourceRequirement from '#models/task_resource_requirement'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { AuthContext } from '#types/auth'
import type User from '#models/user'
import { inject } from '@adonisjs/core'
import {
  type NormalizedResourceContentionQuery,
  type ResourceContentionEvidence,
  type ResourceContentionItem,
  type ResourceContentionMatrix,
  type ResourceContentionMatrixCell,
  type ResourceContentionMatrixRow,
  type ResourceContentionMeta,
  type ResourceContentionSourceFreshness,
  type ResourceContentionSuggestionPreview,
  type ResourceContentionSummary,
  type ResourceContentionWarning,
  type ResourceContentionSeverity,
  type ResourceContentionReasonCode,
  deriveResourceContentionSeverity,
  emptyReasonCounts,
  emptySeverityCounts,
  computeQuerySignatureHash,
  computeContentionSourceSignature,
  makeLowSensitiveEvidenceHash,
  makeResourceContentionFreshness,
  resourceContentionStableHash,
  RESOURCE_CONTENTION_METRIC_VERSION,
  RESOURCE_CONTENTION_SOURCES,
  RESOURCE_CONTENTION_REDACTION_STATES,
  RESOURCE_CONTENTION_REASON_CODES,
  RESOURCE_CONTENTION_SEVERITIES,
  RESOURCE_CONTENTION_WARNING_CODES,
  RESOURCE_CONTENTION_TARGET_KINDS,
} from '@aiproj/types'
import type { ResourceContentionDetectionAccess } from '#policies/resource_contention_detection_policy'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ContentionCandidate {
  reasonCode: ResourceContentionReasonCode
  resourceId: number
  resourceName: string
  projectIds: number[]
  projectNames: string[]
  taskId: number | null
  allocationId: number | null
  from: string
  to: string
  loadPercent: number | null
  affectedDateBuckets: string[]
  description: string
  remediationHint: string
  overloadRatio: number
  unavailableCapacity: boolean
  criticalSkill: boolean
  dateProximityDays: number
  isDraft: boolean
}

// ─── Service ────────────────────────────────────────────────────────────────

@inject()
export default class ResourceContentionDetectionService {
  constructor(private readonly audit: AuditService = new AuditService()) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════

  async getSummary(
    user: User,
    organizationId: number,
    query: NormalizedResourceContentionQuery,
    access: ResourceContentionDetectionAccess,
    ctx: AuthContext = {},
  ): Promise<ResourceContentionSummary> {
    const candidates = await this.detectCandidates(user, organizationId, query, access)
    const severityCounts = emptySeverityCounts()
    const reasonCounts = emptyReasonCounts()
    const affectedProjects = new Set<number>()
    const affectedResources = new Set<number>()
    const evidenceHashes: string[] = []

    for (const c of candidates) {
      const severity = deriveResourceContentionSeverity({
        overloadRatio: c.overloadRatio,
        unavailableCapacity: c.unavailableCapacity,
        affectedProjectCount: c.projectIds.length,
        criticalSkill: c.criticalSkill,
        dateProximityDays: c.dateProximityDays,
        isDraft: c.isDraft,
      })
      severityCounts[severity] += 1
      reasonCounts[c.reasonCode] += 1
      c.projectIds.forEach((id) => affectedProjects.add(id))
      affectedResources.add(c.resourceId)
      const evidenceHash = makeLowSensitiveEvidenceHash(
        RESOURCE_CONTENTION_SOURCES.COMPUTED,
        [String(c.resourceId), ...c.projectIds.map(String)],
        new Date().toISOString(),
      )
      evidenceHashes.push(evidenceHash)
    }

    const freshness = this.buildFreshness(query)
    const meta: ResourceContentionMeta = {
      calculatedAt: new Date().toISOString(),
      metricVersion: RESOURCE_CONTENTION_METRIC_VERSION,
      organizationId,
      actorId: user.id,
      visibleProjectCount: access.canViewProjectDetails ? affectedProjects.size : 0,
      visibleResourceCount: access.canViewResourceDetails ? affectedResources.size : 0,
      querySignatureHash: computeQuerySignatureHash(query),
      sourceSignatureHash: computeContentionSourceSignature(['resource_contention_detection.v1']),
    }

    // Low-sensitive audit
    await this.logReadAudit(
      user,
      organizationId,
      query,
      severityCounts,
      reasonCounts,
      freshness,
      ctx,
    )

    return {
      meta,
      severityCounts,
      reasonCounts,
      affectedProjectCount: access.canViewProjectDetails ? affectedProjects.size : 0,
      affectedResourceCount: access.canViewResourceDetails ? affectedResources.size : 0,
      totalContentions: candidates.length,
      sourceFreshness: freshness,
      warnings: this.buildWarnings(candidates.length, access),
      evidenceHashes: access.canViewEvidence ? evidenceHashes : [],
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // List
  // ═══════════════════════════════════════════════════════════════════════════

  async listItems(
    user: User,
    organizationId: number,
    query: NormalizedResourceContentionQuery,
    access: ResourceContentionDetectionAccess,
  ): Promise<{
    data: ResourceContentionItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const candidates = await this.detectCandidates(user, organizationId, query, access)
    const items = candidates.map((c) => this.candidateToItem(c, access))

    // Apply severity/reasonCode filter
    let filtered = items
    if (query.severity) {
      filtered = filtered.filter((item) => item.severity === query.severity)
    }
    if (query.reasonCode) {
      filtered = filtered.filter((item) => item.reasonCode === query.reasonCode)
    }

    // Sort
    filtered.sort((a, b) => {
      if (a.severity !== b.severity) {
        const order = { critical: 0, high: 1, warning: 2, info: 3 }
        return (order[a.severity] ?? 99) - (order[b.severity] ?? 99)
      }
      return a.from.localeCompare(b.from)
    })
    if (query.order === 'desc') filtered.reverse()

    // Paginate
    const page = query.page
    const perPage = query.perPage
    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    const start = (page - 1) * perPage
    const paged = filtered.slice(start, start + perPage)

    return {
      data: paged.slice(0, query.topN),
      meta: { total, page, perPage, totalPages },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Matrix
  // ═══════════════════════════════════════════════════════════════════════════

  async getMatrix(
    user: User,
    organizationId: number,
    query: NormalizedResourceContentionQuery,
    access: ResourceContentionDetectionAccess,
  ): Promise<ResourceContentionMatrix> {
    const candidates = await this.detectCandidates(user, organizationId, query, access)
    const from = query.from ?? new Date().toISOString().slice(0, 10)
    const to =
      query.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // Build date buckets
    const dates = this.buildDateBuckets(from, to)
    const resourceMap = new Map<
      number,
      {
        resourceId: number
        resourceName: string
        role: string | null
        candidates: ContentionCandidate[]
      }
    >()

    for (const c of candidates) {
      const entry = resourceMap.get(c.resourceId) ?? {
        resourceId: c.resourceId,
        resourceName: c.resourceName,
        role: null,
        candidates: [],
      }
      entry.candidates.push(c)
      resourceMap.set(c.resourceId, entry)
    }

    const rows: ResourceContentionMatrixRow[] = Array.from(resourceMap.values())
      .slice(0, query.topN)
      .map((entry) => {
        const maxSev = this.maxSeverity(entry.candidates)
        const cells: ResourceContentionMatrixCell[] = dates.map((date) => {
          const dayCandidates = entry.candidates.filter((c) => c.affectedDateBuckets.includes(date))
          const cellSeverity = this.maxSeverity(dayCandidates)
          const loadPct =
            dayCandidates.length > 0
              ? Math.max(...dayCandidates.map((c) => c.loadPercent ?? 0))
              : null

          return {
            date,
            severity: cellSeverity,
            reasonCode: dayCandidates[0]?.reasonCode ?? null,
            loadPercent: loadPct,
            contentionCount: dayCandidates.length,
            redactionState: access.canViewResourceDetails
              ? RESOURCE_CONTENTION_REDACTION_STATES.VISIBLE
              : RESOURCE_CONTENTION_REDACTION_STATES.REDACTED,
            drillDownTarget:
              dayCandidates.length > 0 && access.canViewResourceDetails
                ? { kind: RESOURCE_CONTENTION_TARGET_KINDS.RESOURCE, href: '', authorized: true }
                : null,
          }
        })

        return {
          resourceId: entry.resourceId,
          resourceName: access.canViewResourceDetails ? entry.resourceName : null,
          role: access.canViewResourceDetails ? entry.role : null,
          totalContentions: entry.candidates.length,
          maxSeverity: maxSev,
          cells,
          redactionState: access.canViewResourceDetails
            ? RESOURCE_CONTENTION_REDACTION_STATES.VISIBLE
            : RESOURCE_CONTENTION_REDACTION_STATES.REDACTED,
        }
      })

    return { from, to, rows }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Detail
  // ═══════════════════════════════════════════════════════════════════════════

  async getDetail(
    user: User,
    organizationId: number,
    contentionId: string,
    query: NormalizedResourceContentionQuery,
    access: ResourceContentionDetectionAccess,
  ): Promise<ResourceContentionItem | null> {
    const candidates = await this.detectCandidates(user, organizationId, query, access)
    const items = candidates.map((c) => this.candidateToItem(c, access))
    return items.find((item) => item.contentionId === contentionId) ?? null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Evidence
  // ═══════════════════════════════════════════════════════════════════════════

  async getEvidence(
    user: User,
    organizationId: number,
    contentionId: string,
    query: NormalizedResourceContentionQuery,
    access: ResourceContentionDetectionAccess,
  ): Promise<ResourceContentionEvidence | null> {
    if (!access.canViewEvidence) return null
    const detail = await this.getDetail(user, organizationId, contentionId, query, access)
    if (!detail) return null

    return {
      evidenceHash:
        detail.evidenceHash ??
        makeLowSensitiveEvidenceHash(
          RESOURCE_CONTENTION_SOURCES.COMPUTED,
          [contentionId],
          new Date().toISOString(),
        ),
      source: RESOURCE_CONTENTION_SOURCES.COMPUTED,
      lastUpdatedAt: new Date().toISOString(),
      metricKeys: ['contention_severity', 'contention_reason'],
      isLowSensitive: true,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Suggestion Preview
  // ═══════════════════════════════════════════════════════════════════════════

  async getSuggestionPreview(
    user: User,
    organizationId: number,
    contentionId: string,
    query: NormalizedResourceContentionQuery,
    access: ResourceContentionDetectionAccess,
    kind: 'rule' | 'ai' = 'rule',
  ): Promise<ResourceContentionSuggestionPreview[]> {
    const detail = await this.getDetail(user, organizationId, contentionId, query, access)
    if (!detail) return []

    if (kind === 'ai') {
      // AI suggestion is optional; returns advisory cards only
      return [
        {
          suggestionId: resourceContentionStableHash(`ai:${contentionId}:${Date.now()}`),
          contentionId,
          kind: 'ai',
          title: 'AI 建议（仅供审查）',
          description:
            'AI 争用建议仅作参考，不自动执行。请手动审查后通过正式资源调配或分配接口确认。',
          candidateActions: ['审查跨项目分配', '调整分配窗口', '联系资源负责人'],
          isAdvisory: true,
          redactionState: RESOURCE_CONTENTION_REDACTION_STATES.VISIBLE,
          createdAt: new Date().toISOString(),
        },
      ]
    }

    // Rule-based suggestion
    const actions = this.deriveRuleSuggestions(detail)
    return [
      {
        suggestionId: resourceContentionStableHash(`rule:${contentionId}:${Date.now()}`),
        contentionId,
        kind: 'rule',
        title: '规则建议',
        description: `基于争用类型 ${detail.reasonCode} 的处置建议`,
        candidateActions: actions,
        isAdvisory: true,
        redactionState: RESOURCE_CONTENTION_REDACTION_STATES.VISIBLE,
        createdAt: new Date().toISOString(),
      },
    ]
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private: Detection Engine
  // ═══════════════════════════════════════════════════════════════════════════

  private async detectCandidates(
    user: User,
    organizationId: number,
    query: NormalizedResourceContentionQuery,
    _access: ResourceContentionDetectionAccess,
  ): Promise<ContentionCandidate[]> {
    const candidates: ContentionCandidate[] = []

    // Get visible projects
    const projects = await this.readVisibleProjects(organizationId, user)
    const visibleProjectIds = query.projectIds
      ? projects.filter((p) => query.projectIds!.includes(p.id)).map((p) => p.id)
      : projects.map((p) => p.id)

    if (visibleProjectIds.length === 0) return []

    const from = query.from ?? new Date().toISOString().slice(0, 10)
    const to =
      query.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // Read resources across visible projects
    const resources = await Resource.query()
      .whereIn('project_id', visibleProjectIds)
      .where('status', 'active')
    const resourceIds = resources.map((r) => r.id)
    const resourceMap = new Map(resources.map((r) => [r.id, r]))

    if (resourceIds.length === 0) return []

    // Read allocations
    const allocations = await ResourceAllocation.query()
      .whereIn('resource_id', resourceIds)
      .where((q) => q.whereNull('start_date').orWhere('start_date', '<=', to))
      .where((q) => q.whereNull('end_date').orWhere('end_date', '>=', from))

    // Read tasks
    const taskIds = [...new Set(allocations.map((a) => a.taskId))]
    const tasks = await Task.query().whereIn('id', taskIds)
    const taskMap = new Map(tasks.map((t) => [t.id, t]))

    // Detect cross-project overload
    this.detectCrossProjectOverload(
      allocations,
      resourceMap,
      taskMap,
      from,
      to,
      visibleProjectIds,
      candidates,
    )

    // Detect unavailable allocations
    this.detectUnavailableAllocations(allocations, resourceMap, taskMap, candidates)

    // Detect duplicate reservations
    this.detectDuplicateReservations(allocations, resourceMap, taskMap, candidates)

    // Detect demand-window contentions
    await this.detectDemandWindowContentions(
      organizationId,
      visibleProjectIds,
      from,
      to,
      candidates,
    )

    // Apply resource/skill filters
    let filtered = candidates
    if (query.resourceIds) {
      filtered = filtered.filter((c) => query.resourceIds!.includes(c.resourceId))
    }

    return filtered
  }

  // ── Cross-Project Overload Detection ──────────────────────────────────────

  private detectCrossProjectOverload(
    allocations: ResourceAllocation[],
    resourceMap: Map<number, Resource>,
    taskMap: Map<number, Task>,
    from: string,
    to: string,
    _visibleProjectIds: number[],
    candidates: ContentionCandidate[],
  ): void {
    const dates = this.buildDateBuckets(from, to)
    const resourceAllocMap = new Map<number, ResourceAllocation[]>()
    for (const a of allocations) {
      const list = resourceAllocMap.get(a.resourceId) ?? []
      list.push(a)
      resourceAllocMap.set(a.resourceId, list)
    }

    for (const [resourceId, resAllocs] of resourceAllocMap) {
      const resource = resourceMap.get(resourceId)
      if (!resource) continue

      // Check per-date overload
      const affectedDates: string[] = []
      for (const date of dates) {
        const dateAllocs = resAllocs.filter((a) => {
          const s = a.startDate?.toISODate()
          const e = a.endDate?.toISODate()
          return s && e && s <= date && e >= date
        })
        const totalPct = dateAllocs.reduce((sum, a) => sum + (a.allocationPercent ?? 0), 0)
        if (totalPct > 100) {
          affectedDates.push(date)
        }
      }

      if (affectedDates.length === 0) continue

      const projectIds = new Set(
        resAllocs
          .map((a) => {
            const t = taskMap.get(a.taskId)
            return t?.projectId
          })
          .filter(Boolean) as number[],
      )

      // Only flag if cross-project (>= 2 projects)
      if (projectIds.size < 2) continue

      const maxPct = Math.max(...resAllocs.map((a) => a.allocationPercent ?? 0))
      const projectNames = [...projectIds].map(String)

      candidates.push({
        reasonCode: RESOURCE_CONTENTION_REASON_CODES.CROSS_PROJECT_OVERLOAD,
        resourceId,
        resourceName: resource.name,
        projectIds: [...projectIds],
        projectNames,
        taskId: null,
        allocationId: null,
        from,
        to,
        loadPercent: maxPct,
        affectedDateBuckets: affectedDates,
        description: `资源 ${resource.name} 在 ${affectedDates.length} 天内被 ${projectIds.size} 个项目共同占用超过 100%。`,
        remediationHint: '审查跨项目分配、调整分配比例或调度候选资源。',
        overloadRatio: maxPct,
        unavailableCapacity: false,
        criticalSkill: false,
        dateProximityDays: this.dateProximity(affectedDates[0]),
        isDraft: false,
      })
    }
  }

  // ── Unavailable Allocation Detection ──────────────────────────────────────

  private detectUnavailableAllocations(
    allocations: ResourceAllocation[],
    resourceMap: Map<number, Resource>,
    _taskMap: Map<number, Task>,
    candidates: ContentionCandidate[],
  ): void {
    for (const allocation of allocations) {
      const resource = resourceMap.get(allocation.resourceId)
      if (!resource) continue
      // Resources with status != 'active' or missing capacity are unavailable
      if (resource.status !== 'active' || (resource.dailyCapacityHours ?? 0) <= 0) {
        candidates.push({
          reasonCode: RESOURCE_CONTENTION_REASON_CODES.UNAVAILABLE_ALLOCATION,
          resourceId: allocation.resourceId,
          resourceName: resource.name,
          projectIds: [Number(resource.projectId)],
          projectNames: [String(resource.projectId)],
          taskId: allocation.taskId,
          allocationId: allocation.id,
          from: allocation.startDate?.toISODate() ?? new Date().toISOString().slice(0, 10),
          to: allocation.endDate?.toISODate() ?? new Date().toISOString().slice(0, 10),
          loadPercent: allocation.allocationPercent,
          affectedDateBuckets: [
            allocation.startDate?.toISODate() ?? new Date().toISOString().slice(0, 10),
          ],
          description: `资源 ${resource.name} 当前不可用但仍存在分配记录。`,
          remediationHint: '确认该资源状态，必要时将分配转移到可用资源。',
          overloadRatio: 0,
          unavailableCapacity: true,
          criticalSkill: false,
          dateProximityDays: 0,
          isDraft: false,
        })
      }
    }
  }

  // ── Duplicate Reservation Detection ───────────────────────────────────────

  private detectDuplicateReservations(
    allocations: ResourceAllocation[],
    resourceMap: Map<number, Resource>,
    taskMap: Map<number, Task>,
    candidates: ContentionCandidate[],
  ): void {
    const seen = new Map<string, ResourceAllocation[]>()
    for (const a of allocations) {
      const key = `${a.resourceId}:${a.taskId}`
      const list = seen.get(key) ?? []
      list.push(a)
      seen.set(key, list)
    }

    for (const resAllocs of seen.values()) {
      if (resAllocs.length < 2) continue
      const resource = resourceMap.get(resAllocs[0]!.resourceId)
      if (!resource) continue
      const task = taskMap.get(resAllocs[0]!.taskId)

      candidates.push({
        reasonCode: RESOURCE_CONTENTION_REASON_CODES.DUPLICATE_RESERVATION,
        resourceId: resAllocs[0]!.resourceId,
        resourceName: resource.name,
        projectIds: task ? [Number(task.projectId)] : [],
        projectNames: task ? [String(task.projectId)] : [],
        taskId: resAllocs[0]!.taskId,
        allocationId: null,
        from: resAllocs[0]!.startDate?.toISODate() ?? '',
        to: resAllocs[0]!.endDate?.toISODate() ?? '',
        loadPercent: resAllocs.reduce((sum, a) => sum + (a.allocationPercent ?? 0), 0),
        affectedDateBuckets: [],
        description: `资源 ${resource.name} 对任务 ${task?.name ?? resAllocs[0]!.taskId} 存在 ${resAllocs.length} 条重复分配记录。`,
        remediationHint: '合并或删除重复分配记录。',
        overloadRatio: 0,
        unavailableCapacity: false,
        criticalSkill: false,
        dateProximityDays: 0,
        isDraft: false,
      })
    }
  }

  // ── Demand Window Contention Detection ────────────────────────────────────

  private async detectDemandWindowContentions(
    organizationId: number,
    visibleProjectIds: number[],
    from: string,
    to: string,
    candidates: ContentionCandidate[],
  ): Promise<void> {
    const requirements = await TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .whereIn('project_id', visibleProjectIds)
      .whereNotIn('status', ['cancelled', 'fulfilled'])
      .where('start_date', '<=', to)
      .where('end_date', '>=', from)

    if (requirements.length === 0) return

    // Group by skill to detect multiple projects requiring same skill
    const skillDemandMap = new Map<string, TaskResourceRequirement[]>()
    for (const req of requirements) {
      const skills = this.parseJsonList(req.skillTags)
      for (const skill of skills) {
        const list = skillDemandMap.get(skill) ?? []
        list.push(req)
        skillDemandMap.set(skill, list)
      }
    }

    for (const [skill, reqs] of skillDemandMap) {
      const projectSet = new Set(reqs.map((r) => r.projectId))
      if (projectSet.size < 2) continue

      candidates.push({
        reasonCode: RESOURCE_CONTENTION_REASON_CODES.DEMAND_WINDOW_CONTENTION,
        resourceId: 0, // Not a specific resource
        resourceName: `技能: ${skill}`,
        projectIds: [...projectSet],
        projectNames: [...projectSet].map(String),
        taskId: null,
        allocationId: null,
        from,
        to,
        loadPercent: null,
        affectedDateBuckets: [],
        description: `技能 "${skill}" 被 ${projectSet.size} 个项目在同一窗口内需求，可能不足。`,
        remediationHint: '评估技能容量，补充具备该技能的资源或调整需求窗口。',
        overloadRatio: 0,
        unavailableCapacity: false,
        criticalSkill: true,
        dateProximityDays: this.dateProximity(from),
        isDraft: false,
      })
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildDateBuckets(from: string, to: string): string[] {
    const dates: string[] = []
    const start = new Date(from)
    const end = new Date(to)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10))
    }
    return dates
  }

  private dateProximity(dateStr: string): number {
    const d = new Date(dateStr)
    const now = new Date()
    return Math.max(0, Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
  }

  private maxSeverity(candidates: ContentionCandidate[]): ResourceContentionSeverity | null {
    if (candidates.length === 0) return null
    const sevs = candidates.map((c) =>
      deriveResourceContentionSeverity({
        overloadRatio: c.overloadRatio,
        unavailableCapacity: c.unavailableCapacity,
        affectedProjectCount: c.projectIds.length,
        criticalSkill: c.criticalSkill,
        dateProximityDays: c.dateProximityDays,
        isDraft: c.isDraft,
      }),
    )
    for (const s of [
      RESOURCE_CONTENTION_SEVERITIES.CRITICAL,
      RESOURCE_CONTENTION_SEVERITIES.HIGH,
      RESOURCE_CONTENTION_SEVERITIES.WARNING,
      RESOURCE_CONTENTION_SEVERITIES.INFO,
    ]) {
      if (sevs.includes(s)) return s
    }
    return null
  }

  private candidateToItem(
    c: ContentionCandidate,
    access: ResourceContentionDetectionAccess,
  ): ResourceContentionItem {
    const severity = deriveResourceContentionSeverity({
      overloadRatio: c.overloadRatio,
      unavailableCapacity: c.unavailableCapacity,
      affectedProjectCount: c.projectIds.length,
      criticalSkill: c.criticalSkill,
      dateProximityDays: c.dateProximityDays,
      isDraft: c.isDraft,
    })

    const contentionId = resourceContentionStableHash(
      `${c.reasonCode}:${c.resourceId}:${c.projectIds.join(',')}:${c.from}:${c.to}`,
    )

    const redacted = !access.canViewResourceDetails || !access.canViewProjectDetails

    return {
      contentionId,
      severity,
      reasonCode: c.reasonCode,
      resourceId: access.canViewResourceDetails ? c.resourceId : null,
      resourceName: access.canViewResourceDetails ? c.resourceName : null,
      projectIds: access.canViewProjectDetails ? c.projectIds : null,
      projectNames: access.canViewProjectDetails ? c.projectNames : null,
      taskId: c.taskId,
      allocationId: c.allocationId,
      from: c.from,
      to: c.to,
      loadPercent: c.loadPercent,
      affectedDateBuckets: c.affectedDateBuckets,
      description: redacted ? '争用详情已脱敏' : c.description,
      remediationHint: redacted ? null : c.remediationHint,
      evidenceHash: makeLowSensitiveEvidenceHash(
        RESOURCE_CONTENTION_SOURCES.COMPUTED,
        [String(c.resourceId), ...c.projectIds.map(String)],
        new Date().toISOString(),
      ),
      target: access.canViewProjectDetails
        ? { kind: RESOURCE_CONTENTION_TARGET_KINDS.RESOURCE, href: '', authorized: true }
        : null,
      redactionState: redacted
        ? RESOURCE_CONTENTION_REDACTION_STATES.REDACTED
        : RESOURCE_CONTENTION_REDACTION_STATES.VISIBLE,
      createdAt: new Date().toISOString(),
    }
  }

  private buildFreshness(
    _query: NormalizedResourceContentionQuery,
  ): ResourceContentionSourceFreshness[] {
    const now = new Date().toISOString()
    return [
      makeResourceContentionFreshness({
        source: RESOURCE_CONTENTION_SOURCES.RESOURCE_ALLOCATION,
        lastUpdatedAt: now,
      }),
      makeResourceContentionFreshness({
        source: RESOURCE_CONTENTION_SOURCES.RESOURCE_REQUIREMENT,
        lastUpdatedAt: now,
      }),
      makeResourceContentionFreshness({
        source: RESOURCE_CONTENTION_SOURCES.PROJECT,
        lastUpdatedAt: now,
      }),
      makeResourceContentionFreshness({
        source: RESOURCE_CONTENTION_SOURCES.COMPUTED,
        lastUpdatedAt: now,
      }),
    ]
  }

  private buildWarnings(
    totalContentions: number,
    access: ResourceContentionDetectionAccess,
  ): ResourceContentionWarning[] {
    const warnings: ResourceContentionWarning[] = []
    if (totalContentions === 0) {
      warnings.push({
        code: RESOURCE_CONTENTION_WARNING_CODES.EMPTY_CONTENTION_RESULT,
        message: '当前查询窗口内未检测到资源争用。',
      })
    }
    if (!access.canViewResourceDetails || !access.canViewProjectDetails) {
      warnings.push({
        code: RESOURCE_CONTENTION_WARNING_CODES.PERMISSION_REDACTED,
        message: '部分争用维度因权限不足已脱敏。',
      })
    }
    return warnings
  }

  private deriveRuleSuggestions(detail: ResourceContentionItem): string[] {
    const actions: string[] = []
    switch (detail.reasonCode) {
      case RESOURCE_CONTENTION_REASON_CODES.CROSS_PROJECT_OVERLOAD:
        actions.push('降低某项目的分配比例')
        actions.push('将分配窗口错开到不同时间段')
        actions.push('从候选资源中选替代资源')
        break
      case RESOURCE_CONTENTION_REASON_CODES.UNAVAILABLE_ALLOCATION:
        actions.push('将分配转移到可用资源')
        actions.push('更新资源状态或可用容量')
        break
      case RESOURCE_CONTENTION_REASON_CODES.CRITICAL_SKILL_CONTENTION:
        actions.push('补充具备该技能的备用资源')
        actions.push('调整需求窗口以错峰')
        break
      case RESOURCE_CONTENTION_REASON_CODES.DUPLICATE_RESERVATION:
        actions.push('合并或删除重复的分配记录')
        break
      case RESOURCE_CONTENTION_REASON_CODES.DEMAND_WINDOW_CONTENTION:
        actions.push('评估技能容量缺口')
        actions.push('调整需求优先级或窗口')
        break
      case RESOURCE_CONTENTION_REASON_CODES.DRAFT_ALLOCATION_CONTENTION:
        actions.push('审查调配草案并在正式确认前调整')
        break
      default:
        actions.push('审查争用详情并联系相关负责人')
    }
    return actions
  }

  private async readVisibleProjects(organizationId: number, user: User): Promise<Project[]> {
    if (user.isSuperAdmin) {
      return Project.query().where('organization_id', organizationId).whereNull('deleted_at')
    }

    // For non-admin, get projects where user is member or creator
    const { default: ProjectMemberModel } = await import('#models/project_member')
    const memberships = await ProjectMemberModel.query().where('user_id', user.id)

    // schema 基类把 project_id 声明为 bigint | number，whereIn 只接受基础标量数组
    const memberProjectIds = memberships.map((m) => Number(m.projectId))
    const projects = await Project.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .where((q) => {
        if (memberProjectIds.length > 0) {
          q.whereIn('id', memberProjectIds)
        }
        q.orWhere('created_by', user.id)
      })

    return projects
  }

  private parseJsonList(value: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  private async logReadAudit(
    user: User,
    organizationId: number,
    query: NormalizedResourceContentionQuery,
    severityCounts: Record<string, number>,
    reasonCounts: Record<string, number>,
    _freshness: ResourceContentionSourceFreshness[],
    ctx: AuthContext,
  ): Promise<void> {
    try {
      await this.audit.log({
        event: AuditEvent.ORG_RESOURCE_POOL_READ, // Reuse existing event
        userId: user.id,
        organizationId,
        entityType: 'resource_contention_detection',
        entityId: 0,
        requestId: ctx.requestId ?? null,
        metadata: {
          querySignatureHash: computeQuerySignatureHash(query),
          severityCounts,
          reasonCodes: Object.keys(reasonCounts).filter((k) => reasonCounts[k] > 0),
          warningCodes: [],
        },
      })
    } catch {
      // Audit is best-effort; never fail the read
    }
  }
}
