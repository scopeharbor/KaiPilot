import type User from '#models/user'
import RbacService from '#services/rbac_service'
import ResourceSkillMatrixCache, {
  buildMatrixCacheKey,
} from '#services/resource_skill_matrix_cache'
import { RESOURCE_VIEW } from '#start/rbac/permissions'
import { type ResourceSkillMatrixDimensionAccess } from '#policies/resource_skill_matrix_policy'
import {
  RESOURCE_SKILL_MATRIX_DEFAULT_DATE_WINDOW_DAYS,
  RESOURCE_SKILL_MATRIX_DEFAULT_TOP_N,
  RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY,
  RESOURCE_SKILL_MATRIX_GROUP_BY,
  RESOURCE_SKILL_MATRIX_METRIC_VERSION,
  RESOURCE_SKILL_MATRIX_SCOPES,
  RESOURCE_SKILL_MATRIX_SORT_FIELDS,
  RESOURCE_SKILL_MATRIX_SOURCES,
  RESOURCE_SKILL_MATRIX_WARNING_CODES,
  type ResourceCandidateSummary,
  type ResourceSkillMatrixMeta,
  type ResourceSkillMatrixQuery,
  type ResourceSkillMatrixResponse,
  type ResourceSkillMatrixRow,
  type ResourceSkillMatrixSummaryResponse,
  type ResourceSkillMatrixWarning,
  type SkillAdvisoryCandidate,
  type SkillCoverageSummary,
  type SkillGapEntry,
  normalizeSkillTag,
  stableStringHash,
  buildSkillCoverageSummary,
  buildSkillGapSummary,
  sortMatrixRowsByGapSeverity,
  sortMatrixRowsBySkillKey,
} from '@aiproj/types'

// ─── Internal Fact Types ────────────────────────────────────────────────────

interface ResourceFact {
  id: number
  projectId: number
  name: string
  role: string
  skillTags: string | null
  dailyCapacityHours: number
  status: string
}

interface TaskRequirementFact {
  id: number
  projectId: number
  taskId: number
  role: string | null
  skillTags: string | null
  estimatedPersonDays: number | null
  allocationPercent: number | null
  status: string
}

interface SkillFact {
  skillKey: string
  name: string
  version: string
  status: string
  category: string | null
  tags: string[]
  domain: string | null
}

interface MatrixServiceReaders {
  readResources?: (organizationId: number, projectIds: number[]) => Promise<ResourceFact[]>
  readTaskRequirements?: (
    organizationId: number,
    projectIds: number[],
  ) => Promise<TaskRequirementFact[]>
  readSkills?: (organizationId: number) => Promise<SkillFact[]>
  readSourceSignature?: (organizationId: number) => Promise<string>
}

export interface MatrixSummaryWithCacheInfo {
  summary: ResourceSkillMatrixSummaryResponse
  cacheHit: boolean
  cacheDegraded: boolean
}

export default class ResourceSkillMatrixService {
  constructor(
    private readonly readers: MatrixServiceReaders = {},
    private readonly cache: ResourceSkillMatrixCache = new ResourceSkillMatrixCache(),
  ) {}

  /**
   * 获取矩阵摘要。
   */
  async getSummary(
    user: User,
    organizationId: number,
    query: ResourceSkillMatrixQuery = {},
    access: ResourceSkillMatrixDimensionAccess = {
      canViewResourceFacts: false,
      canViewSkillDetails: false,
    },
    /** v3-resource-gap-analysis: 统一缺口引用注入（能力可用时填充） */
    gapAnalysisRef?: {
      metricVersion: string
      reasonCodes: string[]
      severity: string
      evidenceHashes: string[]
    },
  ): Promise<ResourceSkillMatrixSummaryResponse> {
    const result = await this.getSummaryWithCacheInfo(
      user,
      organizationId,
      query,
      access,
      gapAnalysisRef,
    )
    return result.summary
  }

  async getSummaryWithCacheInfo(
    user: User,
    organizationId: number,
    query: ResourceSkillMatrixQuery = {},
    access: ResourceSkillMatrixDimensionAccess = {
      canViewResourceFacts: false,
      canViewSkillDetails: false,
    },
    gapAnalysisRef?: {
      metricVersion: string
      reasonCodes: string[]
      severity: string
      evidenceHashes: string[]
    },
  ): Promise<MatrixSummaryWithCacheInfo> {
    const normalized = this.normalizeQuery(query)

    // 尝试缓存
    if (this.cache.isEnabled()) {
      const cacheKey = buildMatrixCacheKey({
        organizationId,
        actorId: Number(user.id),
        metricVersion: RESOURCE_SKILL_MATRIX_METRIC_VERSION,
        scope: normalized.scope,
        topN: normalized.topN,
        groupBy: normalized.groupBy,
        sort: normalized.sort,
        from: normalized.from,
        to: normalized.to,
        search: normalized.search,
      })

      try {
        const signature = await this.readSourceSignature(organizationId)
        const lookup = this.cache.get(cacheKey, signature)
        if (lookup.hit && lookup.summary) {
          return { summary: lookup.summary, cacheHit: true, cacheDegraded: false }
        }
        const summary = await this.computeSummary(
          user,
          organizationId,
          normalized,
          access,
          gapAnalysisRef,
        )
        try {
          this.cache.set(cacheKey, organizationId, summary, signature)
        } catch {
          return {
            summary: { ...summary, warnings: [...summary.warnings, this.cacheDegradedWarning()] },
            cacheHit: false,
            cacheDegraded: true,
          }
        }
        return { summary, cacheHit: false, cacheDegraded: false }
      } catch {
        const summary = await this.computeSummary(
          user,
          organizationId,
          normalized,
          access,
          gapAnalysisRef,
        )
        return {
          summary: { ...summary, warnings: [...summary.warnings, this.cacheDegradedWarning()] },
          cacheHit: false,
          cacheDegraded: true,
        }
      }
    }

    return {
      summary: await this.computeSummary(user, organizationId, normalized, access, gapAnalysisRef),
      cacheHit: false,
      cacheDegraded: false,
    }
  }

  /**
   * 获取完整矩阵（含行数据）。
   */
  async getMatrix(
    user: User,
    organizationId: number,
    query: ResourceSkillMatrixQuery = {},
    access: ResourceSkillMatrixDimensionAccess = {
      canViewResourceFacts: false,
      canViewSkillDetails: false,
    },
  ): Promise<ResourceSkillMatrixResponse> {
    const normalized = this.normalizeQuery(query)
    const resources = await this.readVisibleResources(organizationId, user, normalized.projectIds)
    const requirements = await this.readVisibleRequirements(
      organizationId,
      user,
      normalized.projectIds,
    )
    const skills = access.canViewSkillDetails ? await this.readVisibleSkills(organizationId) : []

    const meta = this.buildMeta(user, organizationId, normalized, resources, requirements, skills)
    const rows = this.buildMatrixRows(resources, requirements, skills, normalized, access)
    const warnings = rows.flatMap((row) => row.warnings)

    return { meta, rows, warnings }
  }

  // ─── Compute ──────────────────────────────────────────────────────────────

  private async computeSummary(
    user: User,
    organizationId: number,
    normalized: ReturnType<ResourceSkillMatrixService['normalizeQuery']>,
    access: ResourceSkillMatrixDimensionAccess,
    gapAnalysisRef?: {
      metricVersion: string
      reasonCodes: string[]
      severity: string
      evidenceHashes: string[]
    },
  ): Promise<ResourceSkillMatrixSummaryResponse> {
    const resources = await this.readVisibleResources(organizationId, user, normalized.projectIds)
    const requirements = await this.readVisibleRequirements(
      organizationId,
      user,
      normalized.projectIds,
    )
    const skills = access.canViewSkillDetails ? await this.readVisibleSkills(organizationId) : []

    const meta = this.buildMeta(user, organizationId, normalized, resources, requirements, skills)
    const { coverageBySkill, gaps, rows } = this.computeMatrix(
      resources,
      requirements,
      skills,
      access,
    )

    const overallCoverageRatio =
      coverageBySkill.length > 0
        ? coverageBySkill.reduce((sum, cov) => sum + cov.coverageRatio, 0) / coverageBySkill.length
        : 0

    const criticalGaps = gaps
      .filter((gap) => gap.severity === 'critical' || gap.severity === 'high')
      .slice(0, 10)

    // v3-resource-gap-analysis: 注入统一缺口引用
    if (gapAnalysisRef) {
      for (const gap of criticalGaps) {
        gap.gapAnalysisRef = gapAnalysisRef
      }
    }

    const rowsResult = rows.slice(0, normalized.topN)
    const warnings = rowsResult.flatMap((row) => row.warnings)

    return {
      meta,
      overallCoverageRatio: Math.round(overallCoverageRatio * 100) / 100,
      totalGaps: gaps.length,
      totalCandidateResources: rowsResult.reduce((sum, r) => sum + r.candidateResources.length, 0),
      totalSkillAdvisories: rowsResult.reduce((sum, r) => sum + r.skillAdvisory.length, 0),
      coverageBySkill: coverageBySkill.slice(0, normalized.topN),
      criticalGaps,
      warnings,
      ...(gapAnalysisRef ? { gapAnalysisRef } : {}),
    }
  }

  private computeMatrix(
    resources: ResourceFact[],
    requirements: TaskRequirementFact[],
    skills: SkillFact[],
    access: ResourceSkillMatrixDimensionAccess,
  ): {
    coverageBySkill: SkillCoverageSummary[]
    gaps: SkillGapEntry[]
    rows: ResourceSkillMatrixRow[]
  } {
    // 收集所有技能标签
    const resourceSkillMap = new Map<string, ResourceFact[]>()
    const requirementSkillMap = new Map<string, TaskRequirementFact[]>()

    for (const resource of resources) {
      const parsedSkills = this.parseSkillTags(resource.skillTags)
      for (const skill of parsedSkills) {
        const normKey = normalizeSkillTag(skill)
        if (!normKey) continue
        const list = resourceSkillMap.get(normKey) ?? []
        list.push(resource)
        resourceSkillMap.set(normKey, list)
      }
    }

    for (const req of requirements) {
      const parsedSkills = this.parseSkillTags(req.skillTags)
      if (parsedSkills.length === 0) continue
      for (const skill of parsedSkills) {
        const normKey = normalizeSkillTag(skill)
        if (!normKey) continue
        const list = requirementSkillMap.get(normKey) ?? []
        list.push(req)
        requirementSkillMap.set(normKey, list)
      }
    }

    const allSkillKeys = new Set([...resourceSkillMap.keys(), ...requirementSkillMap.keys()])

    const coverageBySkill: SkillCoverageSummary[] = []
    const gaps: SkillGapEntry[] = []
    const rows: ResourceSkillMatrixRow[] = []

    for (const skillKey of allSkillKeys) {
      const skillResources = resourceSkillMap.get(skillKey) ?? []
      const skillRequirements = requirementSkillMap.get(skillKey) ?? []

      const totalAvailable = skillResources.reduce(
        (sum, resource) => sum + resource.dailyCapacityHours * 20, // ~20 工作日/月
        0,
      )
      const totalAllocated = skillResources.length * 40 // 估算已分配 40h/resource/month

      const requiredCapacityHours = skillRequirements.reduce((sum, req) => {
        const personDays = req.estimatedPersonDays ?? 0
        const allocationPercent = req.allocationPercent ?? 100
        return sum + Number(personDays) * 8 * (Number(allocationPercent) / 100)
      }, 0)

      const coverage = buildSkillCoverageSummary({
        skillKey,
        skilledResourceCount: skillResources.length,
        totalResourceCount: resources.length,
        totalAvailableCapacityHours: totalAvailable,
        totalAllocatedCapacityHours: totalAllocated,
      })
      coverageBySkill.push(coverage)

      const gap = buildSkillGapSummary({
        skillKey,
        requirementCount: skillRequirements.length,
        requiredCapacityHours,
        availableCapacityHours: totalAvailable,
        requirementSourceRefs: skillRequirements.map((req) => `task_req:${skillKey}:${req.id}`),
      })
      if (gap.severity !== 'none' || skillRequirements.length > 0) {
        gaps.push(gap)
      }

      // Build candidate resources
      const candidates: ResourceCandidateSummary[] = access.canViewResourceFacts
        ? skillResources.map((resource) => ({
            resourceId: resource.id,
            resourceName: resource.name,
            role: resource.role,
            availableCapacityHours: resource.dailyCapacityHours * 20,
            allocatedCapacityHours: 40,
            remainingCapacityHours: resource.dailyCapacityHours * 20 - 40,
            skillTags: this.parseSkillTags(resource.skillTags),
            conflictSummary: resource.dailyCapacityHours < 2 ? ['资源容量不足'] : [],
          }))
        : []

      // Build skill advisory
      const advisory: SkillAdvisoryCandidate[] = access.canViewSkillDetails
        ? skills
            .filter(
              (skill) =>
                skill.tags.some((tag) => normalizeSkillTag(tag) === skillKey) ||
                (skill.domain && normalizeSkillTag(skill.domain) === skillKey),
            )
            .map((skill) => ({
              skillName: skill.name,
              skillKey: skill.skillKey,
              skillVersion: skill.version,
              skillStatus: skill.status,
              skillCategory: skill.category ?? undefined,
              matchedTags: skill.tags.filter((tag) => normalizeSkillTag(tag) === skillKey),
              matchReason: skill.tags.some((tag) => normalizeSkillTag(tag) === skillKey)
                ? `技能标签与 Compiler Skill ${skill.name} 标签匹配`
                : `技能与 Compiler Skill ${skill.name} 领域匹配`,
              evaluationOnly: skill.status === 'eval',
              advisoryOnly: true,
              activationApplied: false,
              drillDownUrl: `/organization/${0}/skills/${skill.skillKey}`,
            }))
        : []

      const rowWarnings: ResourceSkillMatrixWarning[] = []
      if (!access.canViewResourceFacts) {
        rowWarnings.push({
          code: RESOURCE_SKILL_MATRIX_WARNING_CODES.RESOURCE_DETAIL_FORBIDDEN,
          message: '无资源详情权限，候选资源已脱敏',
          skillKey,
          severity: 'warning',
        })
      }
      if (
        !access.canViewSkillDetails &&
        skills.some((s) => s.tags.some((t) => normalizeSkillTag(t) === skillKey))
      ) {
        rowWarnings.push({
          code: RESOURCE_SKILL_MATRIX_WARNING_CODES.SKILL_ADVISORY_FORBIDDEN,
          message: '无 Skill 查看权限，Skill advisory 已脱敏',
          skillKey,
          severity: 'warning',
        })
      }
      if (gap.severity === 'critical') {
        rowWarnings.push({
          code: RESOURCE_SKILL_MATRIX_WARNING_CODES.NO_CANDIDATE_FOR_REQUIREMENT,
          message: `技能 ${skillKey} 存在严重缺口，无可用资源`,
          skillKey,
          severity: 'critical',
        })
      }

      rows.push({
        skillKey,
        skillLabel: skillKey,
        resourceCount: skillResources.length,
        totalAvailableCapacityHours: totalAvailable,
        totalAllocatedCapacityHours: totalAllocated,
        remainingCapacityHours: totalAvailable - totalAllocated,
        requirementCount: skillRequirements.length,
        requiredCapacityHours,
        coverageRatio: coverage.coverageRatio,
        gapSeverity: gap.severity,
        candidateResources: candidates,
        skillAdvisory: advisory,
        conflictSummary: [],
        evidenceRefs: [
          {
            source: RESOURCE_SKILL_MATRIX_SOURCES.PROJECT_RESOURCE,
            refSeed: `skill:${skillKey}`,
            valueSummary: `${skillResources.length} resources / ${totalAvailable}h avail`,
            visibility: RESOURCE_SKILL_MATRIX_EVIDENCE_VISIBILITY.LOW_SENSITIVITY,
            lastUpdatedAt: new Date().toISOString(),
          },
        ],
        warnings: rowWarnings,
      })
    }

    return { coverageBySkill, gaps, rows: this.sortRows(rows, 'gap_severity') }
  }

  private sortRows(rows: ResourceSkillMatrixRow[], sortField: string): ResourceSkillMatrixRow[] {
    switch (sortField) {
      case RESOURCE_SKILL_MATRIX_SORT_FIELDS.GAP_SEVERITY:
        return sortMatrixRowsByGapSeverity(rows)
      case RESOURCE_SKILL_MATRIX_SORT_FIELDS.SKILL_KEY:
        return sortMatrixRowsBySkillKey(rows)
      case RESOURCE_SKILL_MATRIX_SORT_FIELDS.COVERAGE:
        return [...rows].sort((a, b) => a.coverageRatio - b.coverageRatio)
      default:
        return sortMatrixRowsByGapSeverity(rows)
    }
  }

  buildMatrixRows(
    resources: ResourceFact[],
    requirements: TaskRequirementFact[],
    skills: SkillFact[],
    normalized: ReturnType<ResourceSkillMatrixService['normalizeQuery']>,
    access: ResourceSkillMatrixDimensionAccess,
  ): ResourceSkillMatrixRow[] {
    const { rows } = this.computeMatrix(resources, requirements, skills, access)
    return rows.slice(0, normalized.topN)
  }

  // ─── Readers ──────────────────────────────────────────────────────────────

  private async readVisibleResources(
    organizationId: number,
    user: User,
    projectIds?: number[],
  ): Promise<ResourceFact[]> {
    if (this.readers.readResources) {
      return this.readers.readResources(organizationId, projectIds ?? [])
    }

    const { default: ResourceModel } = await import('#models/resource')
    const rbac = new RbacService()
    let query = ResourceModel.query().where('status', 'active')

    if (projectIds && projectIds.length > 0) {
      query = query.whereIn('project_id', projectIds)
    }

    const allResources = await query
    const visible: ResourceFact[] = []
    for (const resource of allResources) {
      const check = await rbac.check(
        user,
        RESOURCE_VIEW,
        organizationId,
        Number(resource.projectId),
      )
      if (!check.allowed) continue
      visible.push({
        id: Number(resource.id),
        projectId: Number(resource.projectId),
        name: resource.name,
        role: resource.role,
        skillTags: resource.skillTags,
        dailyCapacityHours: Number(resource.dailyCapacityHours),
        status: resource.status,
      })
    }
    return visible
  }

  private async readVisibleRequirements(
    organizationId: number,
    user: User,
    projectIds?: number[],
  ): Promise<TaskRequirementFact[]> {
    if (this.readers.readTaskRequirements) {
      return this.readers.readTaskRequirements(organizationId, projectIds ?? [])
    }

    const { default: TaskResourceRequirement } = await import('#models/task_resource_requirement')
    const rbac = new RbacService()
    let query = TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .whereNot('status', 'cancelled')

    if (projectIds && projectIds.length > 0) {
      query = query.whereIn('project_id', projectIds)
    }

    const allReqs = await query
    const visible: TaskRequirementFact[] = []
    for (const req of allReqs) {
      const check = await rbac.check(user, RESOURCE_VIEW, organizationId, Number(req.projectId))
      if (!check.allowed) continue
      visible.push({
        id: Number(req.id),
        projectId: Number(req.projectId),
        taskId: Number(req.taskId),
        role: req.role ?? null,
        skillTags: req.skillTags ?? null,
        estimatedPersonDays: req.estimatedPersonDays as number | null,
        allocationPercent: req.allocationPercent as number | null,
        status: req.status,
      })
    }
    return visible
  }

  private async readVisibleSkills(organizationId: number): Promise<SkillFact[]> {
    if (this.readers.readSkills) {
      return this.readers.readSkills(organizationId)
    }

    const { default: CompilerSkill } = await import('#models/compiler_skill')
    const skills = await CompilerSkill.query()
      .where('organization_id', organizationId)
      .whereIn('status', ['active', 'eval'])

    return skills.map((skill) => ({
      skillKey: skill.skillKey,
      name: skill.name,
      version: skill.version,
      status: skill.status,
      category:
        typeof skill.category === 'object' ? ((skill.category as any).primary ?? null) : null,
      tags: Array.isArray(skill.tags) ? skill.tags : [],
      domain: null,
    }))
  }

  private async readSourceSignature(organizationId: number): Promise<string> {
    if (this.readers.readSourceSignature) {
      return this.readers.readSourceSignature(organizationId)
    }

    const { default: ResourceModel } = await import('#models/resource')
    const { default: TaskResourceRequirement } = await import('#models/task_resource_requirement')
    const { default: CompilerSkill } = await import('#models/compiler_skill')

    const [resourceCount, reqCount, skillCount] = await Promise.all([
      ResourceModel.query().where('status', 'active').count('* as total'),
      TaskResourceRequirement.query()
        .where('organization_id', organizationId)
        .whereNot('status', 'cancelled')
        .count('* as total'),
      CompilerSkill.query()
        .where('organization_id', organizationId)
        .whereIn('status', ['active', 'eval'])
        .count('* as total'),
    ])

    const rCount = Number((resourceCount[0] as any).$extras?.total ?? 0)
    const reqT = Number((reqCount[0] as any).$extras?.total ?? 0)
    const sCount = Number((skillCount[0] as any).$extras?.total ?? 0)

    return `res:${rCount}|req:${reqT}|skill:${sCount}`
  }

  // ─── Utils ────────────────────────────────────────────────────────────────

  private normalizeQuery(query: ResourceSkillMatrixQuery) {
    const now = new Date()
    const defaultFrom = new Date(
      now.getTime() - RESOURCE_SKILL_MATRIX_DEFAULT_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .split('T')[0]
    const defaultTo = now.toISOString().split('T')[0]

    return {
      scope: query.scope ?? RESOURCE_SKILL_MATRIX_SCOPES.ORGANIZATION,
      projectIds: query.projectIds ?? [],
      skillKeys: query.skillKeys ?? [],
      resourceStatuses: query.resourceStatuses ?? [],
      requirementStatuses: query.requirementStatuses ?? [],
      includeSkillAdvisory: query.includeSkillAdvisory ?? false,
      from: query.from ?? defaultFrom,
      to: query.to ?? defaultTo,
      topN: Math.min(query.topN ?? RESOURCE_SKILL_MATRIX_DEFAULT_TOP_N, 50),
      groupBy: query.groupBy ?? RESOURCE_SKILL_MATRIX_GROUP_BY.SKILL,
      sort: query.sort ?? RESOURCE_SKILL_MATRIX_SORT_FIELDS.GAP_SEVERITY,
      search: query.search ?? undefined,
      page: query.page ?? 1,
      perPage: Math.min(query.perPage ?? 20, 100),
    }
  }

  private buildMeta(
    user: User,
    organizationId: number,
    query: ReturnType<ResourceSkillMatrixService['normalizeQuery']>,
    resources: ResourceFact[],
    requirements: TaskRequirementFact[],
    skills: SkillFact[],
  ): ResourceSkillMatrixMeta {
    return {
      calculatedAt: new Date().toISOString(),
      metricVersion: RESOURCE_SKILL_MATRIX_METRIC_VERSION,
      organizationId,
      actorId: Number(user.id),
      scope: query.scope,
      visibleProjectCount: new Set([
        ...resources.map((r) => r.projectId),
        ...requirements.map((r) => r.projectId),
      ]).size,
      visibleResourceCount: resources.length,
      visibleRequirementCount: requirements.length,
      visibleSkillCount: skills.length,
      dateWindow: { from: query.from, to: query.to },
      sourceFreshness: [
        {
          source: RESOURCE_SKILL_MATRIX_SOURCES.PROJECT_RESOURCE,
          lastUpdatedAt: new Date().toISOString(),
          stale: false,
        },
        {
          source: RESOURCE_SKILL_MATRIX_SOURCES.TASK_REQUIREMENT,
          lastUpdatedAt: new Date().toISOString(),
          stale: false,
        },
        {
          source: RESOURCE_SKILL_MATRIX_SOURCES.SKILL_REGISTRY,
          lastUpdatedAt: new Date().toISOString(),
          stale: false,
        },
      ],
      inputSignatureHash: stableStringHash(
        `${organizationId}:${user.id}:${query.scope}:${query.from}:${query.to}`,
      ),
    }
  }

  private parseSkillTags(value: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }

  private cacheDegradedWarning(): ResourceSkillMatrixWarning {
    return {
      code: RESOURCE_SKILL_MATRIX_WARNING_CODES.CACHE_DEGRADED,
      message: '资源技能矩阵派生缓存当前不可用，已直接按来源事实计算',
      severity: 'info',
    }
  }
}
