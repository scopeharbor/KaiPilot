import type User from '#models/user'
import type {
  OrganizationResourcePoolSummary,
  OrganizationResourcePoolMeta,
  OrganizationResourcePoolMetric,
  OrganizationResourcePoolWarning,
  OrganizationResourcePoolSourceFreshness,
  OrganizationResourcePoolResourceRow,
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolCapacityMatrixRow,
  OrganizationResourcePoolCapacityCell,
  OrganizationResourcePoolSkillItem,
  OrganizationResourcePoolConflict,
  OrganizationResourcePoolDemandGap,
  NormalizedOrganizationResourcePoolQuery,
  OrganizationResourcePoolLoadStatus,
  OrganizationResourcePoolConflictSeverity,
} from '@aiproj/types'
import {
  ORGANIZATION_RESOURCE_POOL_METRIC_KEYS,
  ORGANIZATION_RESOURCE_POOL_METRIC_VERSION,
  ORGANIZATION_RESOURCE_POOL_SOURCES,
  ORGANIZATION_RESOURCE_POOL_STATUSES,
  ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES,
  ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES,
  ORGANIZATION_RESOURCE_POOL_WARNING_CODES,
  ORGANIZATION_RESOURCE_POOL_TARGET_KINDS,
  ORGANIZATION_RESOURCE_POOL_LOW_CARDINALITY_THRESHOLD,
  ORGANIZATION_RESOURCE_POOL_DEFAULT_OVERLOADED_THRESHOLD,
  ORGANIZATION_RESOURCE_POOL_MAX_SCAN_PROJECTS,
  mapLoadBucket,
  makeOrganizationResourcePoolFreshness,
  mergeOrganizationResourcePoolWarnings,
  normalizeCapacityHours,
  normalizeUtilizationPercent,
  organizationResourcePoolStableHash,
  normalizeOrganizationResourcePoolQuery,
} from '@aiproj/types'
import type { OrganizationResourcePoolAccess } from '#policies/organization_resource_pool_policy'
import type OrganizationResourcePoolPolicy from '#policies/organization_resource_pool_policy'

// ─── 内部类型 ──────────────────────────────────────────────────────────────────

interface ProjectFact {
  id: number
  organizationId: number
  name: string
  status: string
  healthStatus: string | null
  updatedAt: string | null
  createdBy: number | null
}

interface ResourceFact {
  id: number
  projectId: number
  userId: number | null
  name: string
  email: string | null
  resourceType: string
  role: string
  status: string
  dailyCapacityHours: number
  skillTags: string | null
  roleTags: string | null
  updatedAt: string | null
}

interface AllocationFact {
  id: number
  resourceId: number
  taskId: number
  allocationPercent: number
  startDate: string | null
  endDate: string | null
  updatedAt: string | null
}

interface RequirementFact {
  id: number
  projectId: number
  taskId: number
  role: string
  skillTags: string | null
  allocationPercent: number | null
  startDate: string
  endDate: string
  priority: string
  status: string
  updatedAt: string | null
}

interface AvailabilityFact {
  id: number
  resourceId: number
  startDate: string
  endDate: string
  capacityOverrideHours: number
  status: string
  updatedAt: string | null
}

interface ResourceLoadFact {
  resourceId: number
  allocatedHours: number
  allocatedPercent: number
  projectIds: number[]
  dateRange: { from: string; to: string }
}

// ─── Readers 接口（DI/测试注入点）──────────────────────────────────────────────

export interface OrganizationResourcePoolReaders {
  readVisibleProjects?: (organizationId: number, user: User) => Promise<ProjectFact[]>
  readResources?: (projectIds: number[]) => Promise<ResourceFact[]>
  readAllocations?: (
    resourceIds: number[],
    from?: string | null,
    to?: string | null,
  ) => Promise<AllocationFact[]>
  readRequirements?: (
    projectIds: number[],
    from?: string | null,
    to?: string | null,
  ) => Promise<RequirementFact[]>
  readAvailabilityExceptions?: (
    resourceIds: number[],
    from?: string | null,
    to?: string | null,
  ) => Promise<AvailabilityFact[]>
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const MAX_SCAN_PROJECTS = ORGANIZATION_RESOURCE_POOL_MAX_SCAN_PROJECTS ?? 2000

export default class OrganizationResourcePoolService {
  constructor(
    private readonly readers: OrganizationResourcePoolReaders = {},
    private readonly policy?: OrganizationResourcePoolPolicy,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Catalogue
  // ═══════════════════════════════════════════════════════════════════════════

  async catalogue(
    user: User,
    organizationId: number,
    rawQuery: Record<string, unknown> = {},
    access?: OrganizationResourcePoolAccess,
  ): Promise<OrganizationResourcePoolSummary> {
    const query = normalizeOrganizationResourcePoolQuery(rawQuery as never)
    return this.getSummary(user, organizationId, query, access)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════

  async getSummary(
    user: User,
    organizationId: number,
    query: NormalizedOrganizationResourcePoolQuery = normalizeOrganizationResourcePoolQuery(),
    access?: OrganizationResourcePoolAccess,
  ): Promise<OrganizationResourcePoolSummary> {
    const projects = await this.readVisibleProjects(organizationId, user)
    const projectIds = projects.map((p) => p.id)

    if (projectIds.length === 0) {
      return this.buildEmptySummary(organizationId, user, query)
    }

    const resources = await this.readResources(projectIds)
    const resourceIds = resources.map((r) => r.id)

    const [allocations, requirements, availabilityFacts] = await Promise.all([
      this.readAllocations(resourceIds, query.from, query.to),
      this.readRequirements(projectIds, query.from, query.to),
      this.readAvailabilityExceptions(resourceIds, query.from, query.to),
    ])

    // 计算负载事实
    const loadFacts = this.computeLoadFacts(resources, allocations, availabilityFacts)
    const capacity = this.computeCapacity(loadFacts, resources)

    // 计算分布
    const loadDistribution = this.computeLoadDistribution(loadFacts)
    const skillCoverage = this.computeSkillCoverage(resources, allocations, requirements, access)
    const conflicts = this.detectConflicts(
      resources,
      loadFacts,
      allocations,
      availabilityFacts,
      projects,
    )
    const demandGaps = this.detectDemandGaps(requirements, resources, projects)

    // 指标
    const metrics = this.buildMetrics(
      resources,
      projects,
      loadFacts,
      capacity,
      loadDistribution,
      skillCoverage,
      conflicts,
      demandGaps,
      access,
    )

    // Freshness
    const sourceFreshness = this.buildSourceFreshness(
      resources,
      allocations,
      requirements,
      projects,
      availabilityFacts,
      query,
    )

    // Warnings
    const warnings = mergeOrganizationResourcePoolWarnings(
      sourceFreshness
        .filter((f) => f.isStale)
        .map((f) => ({
          code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.SOURCE_STALE,
          message: `来源 ${f.source} 数据已超过新鲜度阈值`,
          source: f.source,
        })),
      this.detectLowCardinalityWarnings(skillCoverage, loadDistribution),
    )

    return {
      meta: this.buildMeta(organizationId, user, projects.length, query),
      metrics,
      warnings,
      sourceFreshness,
      resourceCount: resources.length,
      linkedUserCount: access?.canViewLinkedUsers
        ? new Set(resources.map((r) => r.userId).filter(Boolean)).size
        : null,
      capacity,
      loadDistribution,
      skillCoverage,
      demandGapCount: demandGaps.length,
      conflictCount: conflicts.length,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Resources List
  // ═══════════════════════════════════════════════════════════════════════════

  async listResources(
    user: User,
    organizationId: number,
    query: NormalizedOrganizationResourcePoolQuery = normalizeOrganizationResourcePoolQuery(),
    access?: OrganizationResourcePoolAccess,
  ): Promise<{ rows: OrganizationResourcePoolResourceRow[]; total: number }> {
    const projects = await this.readVisibleProjects(organizationId, user)
    const projectIds = projects.map((p) => p.id)
    const projectMap = new Map(projects.map((p) => [p.id, p]))

    if (projectIds.length === 0) return { rows: [], total: 0 }

    const resources = await this.readResources(projectIds)
    const resourceIds = resources.map((r) => r.id)
    const [allocations, availabilityFacts] = await Promise.all([
      this.readAllocations(resourceIds, query.from, query.to),
      this.readAvailabilityExceptions(resourceIds, query.from, query.to),
    ])
    const loadFacts = this.computeLoadFacts(resources, allocations, availabilityFacts)

    // 过滤
    let filtered = resources.map((r) =>
      this.buildResourceRow(r, loadFacts, projectMap, access, query),
    )
    filtered = this.applyResourceFilters(filtered, query)
    filtered = this.applyResourceSort(filtered, query)

    const total = filtered.length
    const page = query.page
    const perPage = query.perPage
    const paged = filtered.slice((page - 1) * perPage, page * perPage)

    return { rows: paged.slice(0, query.topN), total }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Capacity Matrix
  // ═══════════════════════════════════════════════════════════════════════════

  async getCapacityMatrix(
    user: User,
    organizationId: number,
    query: NormalizedOrganizationResourcePoolQuery = normalizeOrganizationResourcePoolQuery(),
    access?: OrganizationResourcePoolAccess,
  ): Promise<OrganizationResourcePoolCapacityMatrix> {
    const projects = await this.readVisibleProjects(organizationId, user)
    const projectIds = projects.map((p) => p.id)

    const from = query.from ?? new Date().toISOString().slice(0, 10)
    const to =
      query.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    if (projectIds.length === 0) return { from, to, rows: [] }

    const resources = await this.readResources(projectIds)
    const resourceIds = resources.map((r) => r.id)
    const [allocations, availabilityFacts] = await Promise.all([
      this.readAllocations(resourceIds, from, to),
      this.readAvailabilityExceptions(resourceIds, from, to),
    ])
    const loadFacts = this.computeLoadFacts(resources, allocations, availabilityFacts)

    const rows: OrganizationResourcePoolCapacityMatrixRow[] = resources
      .slice(0, query.topN)
      .map((r) =>
        this.buildCapacityRow(r, loadFacts, allocations, availabilityFacts, from, to, access),
      )

    return { from, to, rows }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Skills
  // ═══════════════════════════════════════════════════════════════════════════

  async getSkills(
    user: User,
    organizationId: number,
    query: NormalizedOrganizationResourcePoolQuery = normalizeOrganizationResourcePoolQuery(),
    access?: OrganizationResourcePoolAccess,
  ): Promise<OrganizationResourcePoolSkillItem[]> {
    const projects = await this.readVisibleProjects(organizationId, user)
    const projectIds = projects.map((p) => p.id)
    if (projectIds.length === 0) return []

    const resources = await this.readResources(projectIds)
    const resourceIds = resources.map((r) => r.id)
    const [allocations, requirements] = await Promise.all([
      this.readAllocations(resourceIds, query.from, query.to),
      this.readRequirements(projectIds, query.from, query.to),
    ])

    return this.computeSkillCoverage(resources, allocations, requirements, access)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Conflicts
  // ═══════════════════════════════════════════════════════════════════════════

  async getConflicts(
    user: User,
    organizationId: number,
    query: NormalizedOrganizationResourcePoolQuery = normalizeOrganizationResourcePoolQuery(),
    _access?: OrganizationResourcePoolAccess,
  ): Promise<{ conflicts: OrganizationResourcePoolConflict[]; total: number }> {
    const projects = await this.readVisibleProjects(organizationId, user)
    const projectIds = projects.map((p) => p.id)

    if (projectIds.length === 0) return { conflicts: [], total: 0 }

    const resources = await this.readResources(projectIds)
    const resourceIds = resources.map((r) => r.id)
    const [allocations, availabilityFacts] = await Promise.all([
      this.readAllocations(resourceIds, query.from, query.to),
      this.readAvailabilityExceptions(resourceIds, query.from, query.to),
    ])
    const loadFacts = this.computeLoadFacts(resources, allocations, availabilityFacts)

    const conflicts = this.detectConflicts(
      resources,
      loadFacts,
      allocations,
      availabilityFacts,
      projects,
    ).filter((c) => !query.conflictSeverity || c.severity === query.conflictSeverity)

    const page = query.page
    const perPage = query.perPage
    const paged = conflicts.slice((page - 1) * perPage, page * perPage)

    return { conflicts: paged, total: conflicts.length }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Demand Gaps
  // ═══════════════════════════════════════════════════════════════════════════

  async getDemandGaps(
    user: User,
    organizationId: number,
    query: NormalizedOrganizationResourcePoolQuery = normalizeOrganizationResourcePoolQuery(),
    _access?: OrganizationResourcePoolAccess,
    /** v3-resource-gap-analysis: 统一缺口引用注入（能力可用时填充） */
    gapAnalysisRef?: {
      metricVersion: string
      reasonCodes: string[]
      severity: string
      evidenceHashes: string[]
    },
  ): Promise<{ gaps: OrganizationResourcePoolDemandGap[]; total: number }> {
    const projects = await this.readVisibleProjects(organizationId, user)
    const projectIds = projects.map((p) => p.id)

    if (projectIds.length === 0) return { gaps: [], total: 0 }

    const resources = await this.readResources(projectIds)
    const requirements = await this.readRequirements(projectIds, query.from, query.to)
    const gaps = this.detectDemandGaps(requirements, resources, projects)

    // v3-resource-gap-analysis: 注入统一缺口引用（仅当可用时）
    if (gapAnalysisRef) {
      for (const gap of gaps) {
        gap.gapAnalysisRef = gapAnalysisRef
      }
    }

    const page = query.page
    const perPage = query.perPage
    const paged = gaps.slice((page - 1) * perPage, page * perPage)

    return { gaps: paged, total: gaps.length }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Drill-Down
  // ═══════════════════════════════════════════════════════════════════════════

  async drillDown(
    user: User,
    organizationId: number,
    kind: string,
    _targetId?: number,
    resourceId?: number,
    projectId?: number,
    taskId?: number,
  ): Promise<unknown> {
    if (this.policy) {
      await this.policy.authorizeDrillDown(user, organizationId, kind, projectId, resourceId)
    }

    // 下钻只返回有界授权数据——不返回实体全量字段
    switch (kind) {
      case 'project':
        return this.drillProject(projectId!, organizationId, user)
      case 'resource':
        return this.drillResource(resourceId!, organizationId, user)
      case 'task':
        return this.drillTask(taskId!, organizationId, user)
      default:
        return { authorized: false, kind }
    }
  }

  // ─── 内部：可见项目解析 ─────────────────────────────────────────────────

  private async readVisibleProjects(organizationId: number, user: User): Promise<ProjectFact[]> {
    if (this.readers.readVisibleProjects) {
      const projects = await this.readers.readVisibleProjects(organizationId, user)
      return projects.filter((p) => Number(p.organizationId) === Number(organizationId))
    }

    const { default: ProjectModel } = await import('#models/project')
    const { default: RbacService } = await import('#services/rbac_service')
    const { PROJECT_VIEW } = await import('#start/rbac/permissions')
    const rbac = new RbacService()

    const rows = await ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .orderBy('updated_at', 'desc')
      .limit(MAX_SCAN_PROJECTS)

    const visible: ProjectFact[] = []
    for (const project of rows) {
      const { allowed } = await rbac.check(user, PROJECT_VIEW, organizationId, Number(project.id))
      if (!allowed && Number(project.createdBy) !== Number(user.id)) continue
      visible.push({
        id: Number(project.id),
        organizationId: Number(project.organizationId),
        name: project.name,
        status: project.status,
        healthStatus: (project as { healthStatus?: string | null }).healthStatus ?? null,
        updatedAt: project.updatedAt?.toISO() ?? null,
        createdBy: project.createdBy ? Number(project.createdBy) : null,
      })
    }
    return visible
  }

  private async readResources(projectIds: number[]): Promise<ResourceFact[]> {
    if (this.readers.readResources) return this.readers.readResources(projectIds)
    if (projectIds.length === 0) return []

    const { default: ResourceModel } = await import('#models/resource')
    const rows = await ResourceModel.query()
      .whereIn('project_id', projectIds)
      .whereNull('deleted_at')
      .select(
        'id',
        'project_id',
        'user_id',
        'name',
        'email',
        'resource_type',
        'role',
        'status',
        'daily_capacity_hours',
        'skill_tags',
        'role_tags',
        'updated_at',
      )

    return rows.map((r) => ({
      id: Number(r.id),
      projectId: Number((r as { projectId: number }).projectId),
      userId: (r as { userId: number | null }).userId
        ? Number((r as { userId: number | null }).userId)
        : null,
      name: r.name,
      email: (r as { email: string | null }).email ?? null,
      resourceType: (r as { resourceType: string }).resourceType,
      role: (r as { role: string }).role,
      status: (r as { status: string }).status,
      dailyCapacityHours: Number((r as { dailyCapacityHours: number }).dailyCapacityHours ?? 8),
      skillTags: (r as { skillTags: string | null }).skillTags ?? null,
      roleTags: (r as { roleTags: string | null }).roleTags ?? null,
      updatedAt: r.updatedAt?.toISO() ?? null,
    }))
  }

  private async readAllocations(
    resourceIds: number[],
    from?: string | null,
    to?: string | null,
  ): Promise<AllocationFact[]> {
    if (this.readers.readAllocations) return this.readers.readAllocations(resourceIds, from, to)
    if (resourceIds.length === 0) return []

    const { default: ResourceAllocationModel } = await import('#models/resource_allocation')
    let query = ResourceAllocationModel.query()
      .whereIn('resource_id', resourceIds)
      .select(
        'id',
        'resource_id',
        'task_id',
        'allocation_percent',
        'start_date',
        'end_date',
        'updated_at',
      )

    if (from) query = query.where('end_date', '>=', from.slice(0, 10))
    if (to) query = query.where('start_date', '<=', to.slice(0, 10))

    const rows = await query
    return rows.map((a) => ({
      id: Number(a.id),
      resourceId: Number((a as { resourceId: number }).resourceId),
      taskId: Number((a as { taskId: number }).taskId),
      allocationPercent: Number((a as { allocationPercent: number }).allocationPercent ?? 0),
      startDate: (a as { startDate: string | null }).startDate?.toString() ?? null,
      endDate: (a as { endDate: string | null }).endDate?.toString() ?? null,
      updatedAt: a.updatedAt?.toISO() ?? null,
    }))
  }

  private async readRequirements(
    projectIds: number[],
    from?: string | null,
    to?: string | null,
  ): Promise<RequirementFact[]> {
    if (this.readers.readRequirements) return this.readers.readRequirements(projectIds, from, to)
    if (projectIds.length === 0) return []

    const { default: TaskResourceRequirementModel } =
      await import('#models/task_resource_requirement')
    let query = TaskResourceRequirementModel.query()
      .whereIn('project_id', projectIds)
      .whereNotIn('status', ['fulfilled', 'cancelled'])

    if (from) query = query.where('end_date', '>=', from.slice(0, 10))
    if (to) query = query.where('start_date', '<=', to.slice(0, 10))

    const rows = await query
    return rows.map((req) => ({
      id: Number(req.id),
      projectId: Number((req as { projectId: number }).projectId),
      taskId: Number((req as { taskId: number }).taskId),
      role: (req as { role: string }).role,
      skillTags: (req as { skillTags: string | null }).skillTags ?? null,
      allocationPercent: (req as { allocationPercent: number | null }).allocationPercent ?? null,
      startDate: req.startDate?.toString() ?? '',
      endDate: req.endDate?.toString() ?? '',
      priority: (req as { priority: string }).priority,
      status: (req as { status: string }).status,
      updatedAt: req.updatedAt?.toISO() ?? null,
    }))
  }

  private async readAvailabilityExceptions(
    resourceIds: number[],
    from?: string | null,
    to?: string | null,
  ): Promise<AvailabilityFact[]> {
    if (this.readers.readAvailabilityExceptions)
      return this.readers.readAvailabilityExceptions(resourceIds, from, to)
    if (resourceIds.length === 0) return []

    const { default: ResourceAvailabilityExceptionModel } =
      await import('#models/resource_availability_exception')
    let query = ResourceAvailabilityExceptionModel.query()
      .whereIn('resource_id', resourceIds)
      .where('status', 'confirmed')

    if (from) query = query.where('end_date', '>=', from.slice(0, 10))
    if (to) query = query.where('start_date', '<=', to.slice(0, 10))

    const rows = await query
    return rows.map((e) => ({
      id: Number(e.id),
      resourceId: Number((e as { resourceId: number }).resourceId),
      startDate: e.startDate?.toString() ?? '',
      endDate: e.endDate?.toString() ?? '',
      capacityOverrideHours: Number(
        (e as { capacityOverrideHours: number }).capacityOverrideHours ?? 0,
      ),
      status: (e as { status: string }).status,
      updatedAt: e.updatedAt?.toISO() ?? null,
    }))
  }

  // ─── 负载计算 ─────────────────────────────────────────────────────────────

  private computeLoadFacts(
    resources: ResourceFact[],
    allocations: AllocationFact[],
    availabilityFacts: AvailabilityFact[],
  ): Map<number, ResourceLoadFact> {
    const map = new Map<number, ResourceLoadFact>()

    // 初始化
    for (const r of resources) {
      map.set(r.id, {
        resourceId: r.id,
        allocatedHours: 0,
        allocatedPercent: 0,
        projectIds: [],
        dateRange: { from: '', to: '' },
      })
    }

    // 从分配事实聚合——不复用任务 assignee
    for (const a of allocations) {
      const fact = map.get(a.resourceId)
      if (!fact) continue
      fact.allocatedPercent += a.allocationPercent
      // 估算分配小时 = dailyCapacityHours * (percent/100) * 天数
      const resource = resources.find((r) => r.id === a.resourceId)
      const hoursPerDay = resource?.dailyCapacityHours ?? 8
      const days = this.allocationDays(a.startDate, a.endDate)
      fact.allocatedHours += normalizeCapacityHours(
        hoursPerDay * (a.allocationPercent / 100) * days,
      )
    }

    // 从可用性例外中扣除不可用容量
    for (const avail of availabilityFacts) {
      const fact = map.get(avail.resourceId)
      if (!fact) continue
      if (avail.capacityOverrideHours <= 0) {
        // 不可用时段：分配的容量需要标记
      }
    }

    return map
  }

  private allocationDays(startDate: string | null, endDate: string | null): number {
    if (!startDate || !endDate) return 1
    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 1
    return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1)
  }

  // ─── 容量计算 ─────────────────────────────────────────────────────────────

  private computeCapacity(
    loadFacts: Map<number, ResourceLoadFact>,
    resources: ResourceFact[],
  ): OrganizationResourcePoolSummary['capacity'] {
    let totalHours = 0
    let allocatedHours = 0

    for (const r of resources) {
      totalHours += normalizeCapacityHours(r.dailyCapacityHours * 30) // 30-day default window
      const fact = loadFacts.get(r.id)
      if (fact) {
        allocatedHours += fact.allocatedHours
      }
    }

    const remainingHours = normalizeCapacityHours(totalHours - allocatedHours)
    const averageUtilizationPercent =
      totalHours > 0 ? normalizeUtilizationPercent((allocatedHours / totalHours) * 100) : 0

    return {
      totalHours: normalizeCapacityHours(totalHours),
      allocatedHours: normalizeCapacityHours(allocatedHours),
      remainingHours,
      averageUtilizationPercent,
    }
  }

  // ─── 负载分布 ─────────────────────────────────────────────────────────────

  private computeLoadDistribution(
    loadFacts: Map<number, ResourceLoadFact>,
  ): Record<OrganizationResourcePoolLoadStatus, number> {
    const dist: Record<string, number> = {
      [ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.IDLE]: 0,
      [ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL]: 0,
      [ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.HIGH]: 0,
      [ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.OVERLOADED]: 0,
      [ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.UNAVAILABLE]: 0,
    }

    for (const [, fact] of loadFacts) {
      const bucket = mapLoadBucket(fact.allocatedPercent)
      dist[bucket] += 1
    }

    return dist as Record<OrganizationResourcePoolLoadStatus, number>
  }

  // ─── 技能覆盖 ─────────────────────────────────────────────────────────────

  private computeSkillCoverage(
    resources: ResourceFact[],
    allocations: AllocationFact[],
    requirements: RequirementFact[],
    access?: OrganizationResourcePoolAccess,
  ): OrganizationResourcePoolSkillItem[] {
    if (access && !access.canViewResourceDetails) {
      return [] // 权限不足时返回空（低敏）
    }

    const skillMap = new Map<
      string,
      { resources: Set<number>; capacity: number; allocated: number; demand: number }
    >()

    // 资源技能
    for (const r of resources) {
      const tags = r.skillTags
        ? r.skillTags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
      for (const tag of tags) {
        const entry = skillMap.get(tag) ?? {
          resources: new Set(),
          capacity: 0,
          allocated: 0,
          demand: 0,
        }
        entry.resources.add(r.id)
        entry.capacity += r.dailyCapacityHours * 30
        skillMap.set(tag, entry)
      }
    }

    // 分配对应技能
    for (const a of allocations) {
      const resource = resources.find((r) => r.id === a.resourceId)
      if (!resource?.skillTags) continue
      const tags = resource.skillTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const hoursPerTag =
        (resource.dailyCapacityHours *
          (a.allocationPercent / 100) *
          this.allocationDays(a.startDate, a.endDate)) /
        tags.length
      for (const tag of tags) {
        const entry = skillMap.get(tag)
        if (entry) entry.allocated += hoursPerTag
      }
    }

    // 需求技能
    for (const req of requirements) {
      const tags = req.skillTags
        ? req.skillTags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [req.role]
      for (const tag of tags) {
        const entry = skillMap.get(tag) ?? {
          resources: new Set(),
          capacity: 0,
          allocated: 0,
          demand: 0,
        }
        entry.demand += 1
        skillMap.set(tag, entry)
      }
    }

    const items: OrganizationResourcePoolSkillItem[] = []
    for (const [skill, entry] of skillMap) {
      const remaining = normalizeCapacityHours(entry.capacity - entry.allocated)
      const redacted = entry.resources.size < ORGANIZATION_RESOURCE_POOL_LOW_CARDINALITY_THRESHOLD
      items.push({
        skill: redacted ? null : skill,
        resourceCount: redacted ? null : entry.resources.size,
        capacityHours: normalizeCapacityHours(entry.capacity),
        allocatedHours: normalizeCapacityHours(entry.allocated),
        remainingHours: remaining,
        demandCount: entry.demand,
        gap: entry.demand > 0 && remaining <= 0,
        redacted,
      })
    }

    return items
  }

  // ─── 冲突检测 ─────────────────────────────────────────────────────────────

  private detectConflicts(
    resources: ResourceFact[],
    loadFacts: Map<number, ResourceLoadFact>,
    allocations: AllocationFact[],
    availabilityFacts: AvailabilityFact[],
    projects: ProjectFact[],
  ): OrganizationResourcePoolConflict[] {
    const conflicts: OrganizationResourcePoolConflict[] = []
    const projectMap = new Map(projects.map((p) => [p.id, p]))

    // 过载冲突
    for (const [resourceId, fact] of loadFacts) {
      if (fact.allocatedPercent > ORGANIZATION_RESOURCE_POOL_DEFAULT_OVERLOADED_THRESHOLD) {
        const resource = resources.find((r) => r.id === resourceId)
        conflicts.push({
          conflictId: organizationResourcePoolStableHash(`overload:${resourceId}`),
          severity:
            fact.allocatedPercent > 150
              ? ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.CRITICAL
              : ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.ERROR,
          resourceId,
          resourceName: resource?.name ?? null,
          projectIds: fact.projectIds.length > 0 ? fact.projectIds : null,
          projectNames: fact.projectIds
            .map((pid) => projectMap.get(pid)?.name ?? null)
            .filter((n): n is string => n !== null),
          description: `资源分配超过 ${ORGANIZATION_RESOURCE_POOL_DEFAULT_OVERLOADED_THRESHOLD}%：${fact.allocatedPercent.toFixed(0)}%`,
          date: null,
          remediationHint: '建议调整分配百分比或增加资源容量',
          target: resourceId
            ? {
                kind: ORGANIZATION_RESOURCE_POOL_TARGET_KINDS.RESOURCE,
                href: `/resources/${resourceId}`,
                authorized: true,
              }
            : null,
          redacted: false,
        })
      }
    }

    // 不可用日期分配冲突
    for (const avail of availabilityFacts) {
      if (avail.capacityOverrideHours <= 0) {
        const resAllocs = allocations.filter(
          (a) =>
            a.resourceId === avail.resourceId &&
            a.startDate &&
            a.endDate &&
            a.startDate <= avail.endDate &&
            a.endDate >= avail.startDate,
        )
        // 每个不可用区间只产出一条冲突，而不是每条命中分配产出一条：
        // conflictId 只由 resourceId + startDate 派生，逐条 push 会得到 N 个
        // 字段完全相同、ID 也相同的重复项（原循环变量因此从头到尾没被用过）。
        if (resAllocs.length > 0) {
          const resource = resources.find((r) => r.id === avail.resourceId)
          conflicts.push({
            conflictId: organizationResourcePoolStableHash(
              `unavailable:${avail.resourceId}:${avail.startDate}`,
            ),
            severity: ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.WARNING,
            resourceId: avail.resourceId,
            resourceName: resource?.name ?? null,
            projectIds: null,
            projectNames: null,
            description: `资源在 ${avail.startDate} ~ ${avail.endDate} 不可用，但存在分配`,
            date: avail.startDate,
            remediationHint: '建议调整分配日期或取消不可用标记',
            target: null,
            redacted: false,
          })
        }
      }
    }

    // 跨项目争用——同一资源在多个项目中被分配
    for (const [resourceId, fact] of loadFacts) {
      const resourceAllocs = allocations.filter((a) => a.resourceId === resourceId)
      const distinctProjectIds = new Set<number>()
      for (const a of resourceAllocs) {
        if (a.taskId) distinctProjectIds.add(a.taskId)
      }
      if (distinctProjectIds.size > 1 && fact.allocatedPercent > 80) {
        const resource = resources.find((r) => r.id === resourceId)
        conflicts.push({
          conflictId: organizationResourcePoolStableHash(`contention:${resourceId}`),
          severity: ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.WARNING,
          resourceId,
          resourceName: resource?.name ?? null,
          projectIds: [...distinctProjectIds],
          projectNames: [...distinctProjectIds]
            .map((pid) => projectMap.get(pid)?.name ?? null)
            .filter((n): n is string => n !== null),
          description: `资源跨 ${distinctProjectIds.size} 个项目分配，总利用率 ${fact.allocatedPercent.toFixed(0)}%`,
          date: null,
          remediationHint: '跨项目资源争用，建议协调项目时间线',
          target: resourceId
            ? {
                kind: ORGANIZATION_RESOURCE_POOL_TARGET_KINDS.RESOURCE,
                href: `/resources/${resourceId}`,
                authorized: true,
              }
            : null,
          redacted: false,
        })
      }
    }

    return conflicts
  }

  // ─── 需求缺口 ─────────────────────────────────────────────────────────────

  private detectDemandGaps(
    requirements: RequirementFact[],
    resources: ResourceFact[],
    projects: ProjectFact[],
  ): OrganizationResourcePoolDemandGap[] {
    const gaps: OrganizationResourcePoolDemandGap[] = []
    const projectMap = new Map(projects.map((p) => [p.id, p]))
    const allSkills = new Set<string>()
    for (const r of resources) {
      if (r.skillTags) {
        r.skillTags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((s) => allSkills.add(s))
      }
    }

    for (const req of requirements) {
      if (req.status === 'matched' || req.status === 'fulfilled') continue
      const tags = req.skillTags
        ? req.skillTags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [req.role]
      const hasNoMatch = tags.some((t) => !allSkills.has(t))
      if (hasNoMatch || req.status === 'open') {
        gaps.push({
          gapId: organizationResourcePoolStableHash(`gap:${req.id}`),
          skill: req.skillTags ?? req.role,
          role: req.role,
          projectId: req.projectId,
          projectName: projectMap.get(req.projectId)?.name ?? null,
          taskId: req.taskId,
          dateWindow: { from: req.startDate, to: req.endDate },
          priority: req.priority,
          target: {
            kind: ORGANIZATION_RESOURCE_POOL_TARGET_KINDS.PROJECT,
            href: `/projects/${req.projectId}`,
            authorized: true,
          },
          redacted: false,
        })
      }
    }

    return gaps
  }

  // ─── Resource Row 构造 ────────────────────────────────────────────────────

  private buildResourceRow(
    r: ResourceFact,
    loadFacts: Map<number, ResourceLoadFact>,
    _projectMap: Map<number, ProjectFact>,
    access: OrganizationResourcePoolAccess | undefined,
    query: NormalizedOrganizationResourcePoolQuery,
  ): OrganizationResourcePoolResourceRow {
    const fact = loadFacts.get(r.id)
    const allocatedPercent = fact?.allocatedPercent ?? 0
    const allocatedHours = fact?.allocatedHours ?? 0
    const capacityHours = normalizeCapacityHours(r.dailyCapacityHours * 30)
    const remainingHours = normalizeCapacityHours(capacityHours - allocatedHours)
    const utilizationPercent = normalizeUtilizationPercent(
      capacityHours > 0 ? (allocatedHours / capacityHours) * 100 : 0,
    )
    const loadStatus = mapLoadBucket(utilizationPercent)
    const canViewDetails = access?.canViewResourceDetails ?? false

    const conflictFlags: OrganizationResourcePoolConflictSeverity[] = []
    if (allocatedPercent > ORGANIZATION_RESOURCE_POOL_DEFAULT_OVERLOADED_THRESHOLD) {
      conflictFlags.push(
        allocatedPercent > 150
          ? ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.CRITICAL
          : ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.ERROR,
      )
    }

    return {
      resourceId: r.id,
      resourceName: canViewDetails ? r.name : null,
      resourceType: r.resourceType as OrganizationResourcePoolResourceRow['resourceType'],
      role: canViewDetails ? r.role : null,
      status: r.status,
      skillTags:
        canViewDetails && r.skillTags
          ? r.skillTags
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
      department: null, // V1 无一等部门来源
      linkedUserId: access?.canViewLinkedUsers && r.userId ? r.userId : null,
      projectCount: fact ? 1 : 0, // 简化——按资源出现即项目数
      totalCapacityHours: capacityHours,
      totalAllocatedHours: allocatedHours,
      totalRemainingHours: remainingHours,
      utilizationPercent,
      loadStatus,
      conflictFlags,
      freshness: makeOrganizationResourcePoolFreshness({
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
        lastUpdatedAt: r.updatedAt,
        staleThresholdMinutes: query.freshnessWindowMinutes,
      }),
      target: canViewDetails
        ? {
            kind: ORGANIZATION_RESOURCE_POOL_TARGET_KINDS.RESOURCE,
            href: `/resources/${r.id}`,
            authorized: true,
          }
        : null,
      redacted: !canViewDetails,
    }
  }

  // ─── Capacity Row 构造 ────────────────────────────────────────────────────

  private buildCapacityRow(
    r: ResourceFact,
    loadFacts: Map<number, ResourceLoadFact>,
    allocations: AllocationFact[],
    availabilityFacts: AvailabilityFact[],
    from: string,
    to: string,
    access: OrganizationResourcePoolAccess | undefined,
  ): OrganizationResourcePoolCapacityMatrixRow {
    const fact = loadFacts.get(r.id)
    const canViewDetails = access?.canViewResourceDetails ?? false
    const totalAllocatedHours = fact?.allocatedHours ?? 0
    const totalCapacityHours = normalizeCapacityHours(r.dailyCapacityHours * 30)
    const totalRemainingHours = normalizeCapacityHours(totalCapacityHours - totalAllocatedHours)
    const utilizationPercent = normalizeUtilizationPercent(
      totalCapacityHours > 0 ? (totalAllocatedHours / totalCapacityHours) * 100 : 0,
    )

    // 生成逐日 cells——简化为按日期范围展开
    const cells: OrganizationResourcePoolCapacityCell[] = []
    const fromDate = new Date(from)
    const toDate = new Date(to)
    const resAllocs = allocations.filter((a) => a.resourceId === r.id)
    const resAvails = availabilityFacts.filter((a) => a.resourceId === r.id)

    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10)
      const dailyCapacity = r.dailyCapacityHours

      // 检查可用性例外
      const availOverride = resAvails.find((a) => a.startDate <= dateStr && a.endDate >= dateStr)
      const effectiveCapacity = availOverride ? availOverride.capacityOverrideHours : dailyCapacity

      // 检查分配
      const dayAllocs = resAllocs.filter(
        (a) => a.startDate && a.endDate && a.startDate <= dateStr && a.endDate >= dateStr,
      )
      const totalAllocPercent = dayAllocs.reduce((sum, a) => sum + a.allocationPercent, 0)
      const allocatedToday = effectiveCapacity * (totalAllocPercent / 100)
      const remainingToday = Math.max(0, effectiveCapacity - allocatedToday)
      const utilToday =
        effectiveCapacity > 0
          ? normalizeUtilizationPercent((allocatedToday / effectiveCapacity) * 100)
          : 0

      cells.push({
        date: dateStr,
        capacityHours: normalizeCapacityHours(effectiveCapacity),
        allocatedHours: normalizeCapacityHours(allocatedToday),
        remainingHours: normalizeCapacityHours(remainingToday),
        utilizationPercent: utilToday,
        loadStatus: mapLoadBucket(utilToday),
        conflictFlags:
          totalAllocPercent > ORGANIZATION_RESOURCE_POOL_DEFAULT_OVERLOADED_THRESHOLD
            ? [ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES.ERROR]
            : [],
      })
    }

    return {
      resourceId: r.id,
      resourceName: canViewDetails ? r.name : null,
      role: canViewDetails ? r.role : null,
      loadStatus: mapLoadBucket(utilizationPercent),
      totalCapacityHours,
      totalAllocatedHours,
      totalRemainingHours,
      utilizationPercent,
      cells,
      redacted: !canViewDetails,
    }
  }

  // ─── 过滤与排序 ─────────────────────────────────────────────────────────

  private applyResourceFilters(
    rows: OrganizationResourcePoolResourceRow[],
    query: NormalizedOrganizationResourcePoolQuery,
  ): OrganizationResourcePoolResourceRow[] {
    return rows.filter((r) => {
      if (query.resourceType && r.resourceType !== query.resourceType) return false
      if (query.role && r.role !== query.role) return false
      if (query.loadStatus && r.loadStatus !== query.loadStatus) return false
      if (
        query.search &&
        r.resourceName &&
        !r.resourceName.toLowerCase().includes(query.search.toLowerCase())
      )
        return false
      return true
    })
  }

  private applyResourceSort(
    rows: OrganizationResourcePoolResourceRow[],
    query: NormalizedOrganizationResourcePoolQuery,
  ): OrganizationResourcePoolResourceRow[] {
    const dir = query.order === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      let cmp = 0
      switch (query.sort) {
        case 'name':
          cmp = (a.resourceName ?? '').localeCompare(b.resourceName ?? '')
          break
        case 'role':
          cmp = (a.role ?? '').localeCompare(b.role ?? '')
          break
        case 'utilization':
          cmp = a.utilizationPercent - b.utilizationPercent
          break
        case 'capacity':
          cmp = a.totalCapacityHours - b.totalCapacityHours
          break
        case 'allocated':
          cmp = a.totalAllocatedHours - b.totalAllocatedHours
          break
        case 'remaining':
          cmp = a.totalRemainingHours - b.totalRemainingHours
          break
        case 'load_status':
          cmp = a.loadStatus.localeCompare(b.loadStatus)
          break
        case 'updated_at':
        default:
          cmp = a.resourceId - b.resourceId
      }
      return cmp === 0 ? a.resourceId - b.resourceId : cmp * dir
    })
  }

  // ─── Metrics ──────────────────────────────────────────────────────────────

  private buildMetrics(
    resources: ResourceFact[],
    projects: ProjectFact[],
    _loadFacts: Map<number, ResourceLoadFact>,
    capacity: OrganizationResourcePoolSummary['capacity'],
    loadDistribution: Record<OrganizationResourcePoolLoadStatus, number>,
    skillCoverage: OrganizationResourcePoolSkillItem[],
    conflicts: OrganizationResourcePoolConflict[],
    demandGaps: OrganizationResourcePoolDemandGap[],
    access?: OrganizationResourcePoolAccess,
  ): OrganizationResourcePoolMetric[] {
    const activeResources = resources.filter((r) => r.status === 'active').length
    const linkedUsers = access?.canViewLinkedUsers
      ? new Set(resources.map((r) => r.userId).filter(Boolean)).size
      : null

    const metrics: OrganizationResourcePoolMetric[] = [
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_RESOURCES,
        value: resources.length,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ACTIVE_RESOURCES,
        value: activeResources,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.LINKED_USER_COUNT,
        value: linkedUsers,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.MEMBERSHIP,
        status:
          linkedUsers !== null
            ? ORGANIZATION_RESOURCE_POOL_STATUSES.OK
            : ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.VISIBLE_PROJECT_COUNT,
        value: projects.length,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.TOTAL_CAPACITY_HOURS,
        value: capacity.totalHours,
        unit: 'hours',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.ALLOCATED_CAPACITY_HOURS,
        value: capacity.allocatedHours,
        unit: 'hours',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.REMAINING_CAPACITY_HOURS,
        value: capacity.remainingHours,
        unit: 'hours',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.AVERAGE_UTILIZATION_PERCENT,
        value: capacity.averageUtilizationPercent,
        unit: 'percent',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.IDLE_RESOURCE_COUNT,
        value: loadDistribution[ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.IDLE] ?? 0,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.NORMAL_LOAD_RESOURCE_COUNT,
        value: loadDistribution[ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL] ?? 0,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.HIGH_LOAD_RESOURCE_COUNT,
        value: loadDistribution[ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.HIGH] ?? 0,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.OVERLOADED_RESOURCE_COUNT,
        value: loadDistribution[ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.OVERLOADED] ?? 0,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.SKILL_COVERAGE_COUNT,
        value: skillCoverage.length,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.DEMAND_GAP_COUNT,
        value: demandGaps.length,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REQUIREMENT,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
      {
        key: ORGANIZATION_RESOURCE_POOL_METRIC_KEYS.CONFLICT_COUNT,
        value: conflicts.length,
        unit: 'count',
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED,
        status: ORGANIZATION_RESOURCE_POOL_STATUSES.OK,
      },
    ]

    return metrics
  }

  // ─── Freshness ────────────────────────────────────────────────────────────

  private buildSourceFreshness(
    resources: ResourceFact[],
    allocations: AllocationFact[],
    requirements: RequirementFact[],
    projects: ProjectFact[],
    _availabilityFacts: AvailabilityFact[],
    query: NormalizedOrganizationResourcePoolQuery,
  ): OrganizationResourcePoolSourceFreshness[] {
    const latest = (items: Array<{ updatedAt: string | null }>): string | null => {
      const times = items
        .map((i) => i.updatedAt)
        .filter((v): v is string => Boolean(v))
        .map((v) => new Date(v).getTime())
        .filter((v) => Number.isFinite(v))
      return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
    }

    return [
      makeOrganizationResourcePoolFreshness({
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
        lastUpdatedAt: latest(resources),
        staleThresholdMinutes: query.freshnessWindowMinutes,
      }),
      makeOrganizationResourcePoolFreshness({
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
        lastUpdatedAt: latest(allocations),
        staleThresholdMinutes: query.freshnessWindowMinutes,
      }),
      makeOrganizationResourcePoolFreshness({
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REQUIREMENT,
        lastUpdatedAt: latest(requirements),
        staleThresholdMinutes: query.freshnessWindowMinutes,
      }),
      makeOrganizationResourcePoolFreshness({
        source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
        lastUpdatedAt: latest(projects),
        staleThresholdMinutes: query.freshnessWindowMinutes,
      }),
    ]
  }

  // ─── Low-Cardinality Warning ──────────────────────────────────────────────

  private detectLowCardinalityWarnings(
    skillCoverage: OrganizationResourcePoolSkillItem[],
    _loadDistribution: Record<string, number>,
  ): OrganizationResourcePoolWarning[] {
    const warnings: OrganizationResourcePoolWarning[] = []
    for (const skill of skillCoverage) {
      if (skill.redacted) {
        warnings.push({
          code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.LOW_CARDINALITY_REDACTED,
          message: '低基数维度已脱敏以保护隐私',
          source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
        })
        break
      }
    }
    return warnings
  }

  // ─── Empty Summary ────────────────────────────────────────────────────────

  private buildEmptySummary(
    organizationId: number,
    user: User,
    query: NormalizedOrganizationResourcePoolQuery,
  ): OrganizationResourcePoolSummary {
    return {
      meta: this.buildMeta(organizationId, user, 0, query),
      metrics: [],
      warnings: [
        {
          code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.EMPTY_ORGANIZATION_RESOURCE_POOL,
          message: '当前组织没有可见项目或资源',
        },
      ],
      sourceFreshness: [
        makeOrganizationResourcePoolFreshness({
          source: ORGANIZATION_RESOURCE_POOL_SOURCES.PROJECT,
          lastUpdatedAt: new Date().toISOString(),
          staleThresholdMinutes: query.freshnessWindowMinutes,
        }),
      ],
      resourceCount: 0,
      linkedUserCount: null,
      capacity: {
        totalHours: 0,
        allocatedHours: 0,
        remainingHours: 0,
        averageUtilizationPercent: 0,
      },
      loadDistribution: { idle: 0, normal: 0, high: 0, overloaded: 0, unavailable: 0 },
      skillCoverage: [],
      demandGapCount: 0,
      conflictCount: 0,
    }
  }

  // ─── Meta ─────────────────────────────────────────────────────────────────

  private buildMeta(
    organizationId: number,
    user: User,
    visibleProjectCount: number,
    query: NormalizedOrganizationResourcePoolQuery,
  ): OrganizationResourcePoolMeta {
    return {
      calculatedAt: new Date().toISOString(),
      metricVersion: ORGANIZATION_RESOURCE_POOL_METRIC_VERSION,
      organizationId,
      actorId: Number(user.id),
      visibleProjectCount,
      querySignatureHash: organizationResourcePoolStableHash(
        `${organizationId}:${user.id}:${visibleProjectCount}:${query.view}:${query.sort}`,
      ),
    }
  }

  // ─── Source Signature ─────────────────────────────────────────────────────

  computeSourceSignature(
    resources: ResourceFact[],
    allocations: AllocationFact[],
    requirements: RequirementFact[],
    projects: ProjectFact[],
  ): string {
    const counts = [
      resources.length,
      allocations.length,
      requirements.length,
      projects.length,
    ].join(':')
    const maxUpdated = [
      resources
        .map((r) => r.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
      allocations
        .map((a) => a.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
      requirements
        .map((r) => r.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
      projects
        .map((p) => p.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
    ].join(':')
    return organizationResourcePoolStableHash(`${counts}:${maxUpdated}`)
  }

  // ─── Drill-Down Helpers ──────────────────────────────────────────────────

  private async drillProject(projectId: number, organizationId: number, _user: User) {
    const { default: ProjectModel } = await import('#models/project')
    const project = await ProjectModel.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) return { authorized: false }
    return {
      authorized: true,
      kind: 'project',
      projectId: Number(project.id),
      name: project.name,
      status: project.status,
    }
  }

  private async drillResource(resourceId: number, _organizationId: number, _user: User) {
    const { default: ResourceModel } = await import('#models/resource')
    const resource = await ResourceModel.find(resourceId)
    if (!resource) return { authorized: false }
    return {
      authorized: true,
      kind: 'resource',
      resourceId: Number(resource.id),
      name: resource.name,
      role: (resource as { role: string }).role,
      status: (resource as { status: string }).status,
    }
  }

  private async drillTask(taskId: number, _organizationId: number, _user: User) {
    const { default: TaskModel } = await import('#models/task')
    const task = await TaskModel.find(taskId)
    if (!task) return { authorized: false }
    return {
      authorized: true,
      kind: 'task',
      taskId: Number(task.id),
      name: task.name,
      status: task.status,
    }
  }
}
