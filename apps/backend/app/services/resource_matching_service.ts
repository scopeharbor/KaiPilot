import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Resource from '#models/resource'
import TaskResourceRequirement from '#models/task_resource_requirement'
import ResourcePlanningService, {
  type ResourceMatrixRow,
} from '#services/resource_planning_service'

export interface ResourceMatchCandidate {
  resourceId: number
  resourceName: string
  role: string
  skillTags: string[]
  score: number
  availableCapacityHours: number
  requiredCapacityHours: number
  conflictSummary: string[]
  explanations: string[]
}

export interface ResourceMatchResult {
  requirementId: number
  taskId: number
  from: string
  to: string
  candidates: ResourceMatchCandidate[]
  meta: {
    totalCandidates: number
    generatedAt: string
    writesApplied: false
  }
}

export default class ResourceMatchingService {
  constructor(private planning = new ResourcePlanningService()) {}

  async matchRequirement(
    organizationId: number,
    projectId: number,
    requirementId: number,
    limit = 10,
  ): Promise<ResourceMatchResult> {
    await this.projectOrFail(organizationId, projectId)
    const requirement = await TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('id', requirementId)
      .first()
    if (!requirement) throw new ResourceNotFoundException('资源需求不存在')
    if (requirement.status === 'cancelled')
      throw new ValidationException('已取消的资源需求不能匹配')

    const planning = await this.planning.getPlanning(organizationId, projectId, {
      from: requirement.startDate.toISODate()!,
      to: requirement.endDate.toISODate()!,
      resourceStatus: 'active',
    })

    const resources = await Resource.query()
      .where('project_id', projectId)
      .where('status', 'active')
    const resourceMap = new Map(resources.map((resource) => [resource.id, resource]))
    const requirementSkills = this.parseJsonList(requirement.skillTags)
    const candidates = planning.matrix
      .map((row) =>
        this.scoreCandidate(row, resourceMap.get(row.resourceId), requirement, requirementSkills),
      )
      .filter((candidate): candidate is ResourceMatchCandidate => candidate !== null)
      .sort(
        (a, b) => b.score - a.score || a.resourceName.localeCompare(b.resourceName, 'zh-Hans-CN'),
      )
      .slice(0, Math.max(1, Math.min(50, limit)))

    return {
      requirementId: requirement.id,
      taskId: requirement.taskId,
      from: requirement.startDate.toISODate()!,
      to: requirement.endDate.toISODate()!,
      candidates,
      meta: {
        totalCandidates: candidates.length,
        generatedAt: new Date().toISOString(),
        writesApplied: false,
      },
    }
  }

  private scoreCandidate(
    row: ResourceMatrixRow,
    resource: Resource | undefined,
    requirement: TaskResourceRequirement,
    requirementSkills: string[],
  ): ResourceMatchCandidate | null {
    if (!resource) return null
    const roleMatched = this.matchesRole(resource, requirement.role)
    const matchedSkills = requirementSkills.filter((skill) => row.skillTags.includes(skill))
    const skillRatio =
      requirementSkills.length === 0 ? 1 : matchedSkills.length / requirementSkills.length
    if (!roleMatched && skillRatio === 0) return null

    const requiredCapacityHours = this.requiredCapacityHours(requirement, row)
    const availableCapacityHours = this.round(
      row.days.reduce((sum, day) => sum + Math.max(0, day.remainingHours), 0),
    )
    const hasOverload = row.days.some((day) => day.conflictFlags.includes('overload'))
    const hasUnavailable = row.days.some((day) =>
      day.conflictFlags.includes('unavailable_allocation'),
    )
    const capacityRatio =
      requiredCapacityHours > 0 ? Math.min(1, availableCapacityHours / requiredCapacityHours) : 1

    const roleScore = roleMatched ? 30 : 0
    const skillScore = Math.round(skillRatio * 40)
    const capacityScore = Math.round(capacityRatio * 20)
    const conflictScore = hasOverload || hasUnavailable ? 0 : 10
    const score = Math.max(0, Math.min(100, roleScore + skillScore + capacityScore + conflictScore))

    const conflictSummary: string[] = []
    if (hasOverload) conflictSummary.push('候选资源当前窗口存在过载日期')
    if (hasUnavailable) conflictSummary.push('候选资源当前窗口存在不可用日期分配')
    if (availableCapacityHours < requiredCapacityHours) {
      conflictSummary.push('候选资源剩余容量不足以完整覆盖需求')
    }

    return {
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      role: row.role,
      skillTags: row.skillTags,
      score,
      availableCapacityHours,
      requiredCapacityHours,
      conflictSummary,
      explanations: [
        roleMatched ? `角色匹配：${requirement.role}` : `角色不完全匹配：需求 ${requirement.role}`,
        requirementSkills.length > 0
          ? `技能匹配 ${matchedSkills.length}/${requirementSkills.length}：${matchedSkills.join('、') || '无'}`
          : '需求未指定技能，跳过技能扣分',
        `窗口剩余容量 ${availableCapacityHours} 小时，需求约 ${requiredCapacityHours} 小时`,
        conflictSummary.length > 0 ? conflictSummary.join('；') : '当前窗口未发现候选资源冲突',
      ],
    }
  }

  private requiredCapacityHours(
    requirement: TaskResourceRequirement,
    row: ResourceMatrixRow,
  ): number {
    if (requirement.estimatedPersonDays !== null) {
      return this.round(Number(requirement.estimatedPersonDays) * 8)
    }
    const percent = Number(requirement.allocationPercent ?? 100)
    return this.round(row.days.reduce((sum, day) => sum + day.capacityHours * (percent / 100), 0))
  }

  private matchesRole(resource: Resource, role: string): boolean {
    return new Set([resource.role, ...this.parseJsonList(resource.roleTags)]).has(role)
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

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100
  }
}
