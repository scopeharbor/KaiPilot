/**
 * v3-chart-gallery-data-foundation —— StakeholderService（W3.1）。
 *
 * 利害关系人登记表 CRUD + 权力-利益四象限聚合：
 * - 所有查询强制 organization_id 物理隔离（RL-05），跨租户一律抛
 *   ResourceNotFoundException（HTTP 404），杜绝存在性泄露；
 * - internal 干系人绑定的 userId 必须属于当前组织（防跨租户用户引用注入），
 *   external 干系人不绑用户；
 * - management_strategy 与 power/interest 四象限互为表里：显式传入优先，
 *   未显式传入时按四象限自动推导，保证登记表与象限视图一致；
 * - 软删除（deleted_at），模型默认查询已排除已删记录。
 */
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import ProjectStakeholder from '#models/project_stakeholder'
import type {
  StakeholderAttitude,
  StakeholderLevel,
  StakeholderStrategy,
  StakeholderType,
} from '#models/project_stakeholder'
import { DateTime } from 'luxon'

export interface CreateStakeholderInput {
  name: string
  /** 可选的内部用户绑定（外部干系人为 null）。 */
  userId?: number | null
  organizationName?: string | null
  roleTitle?: string | null
  stakeholderType?: StakeholderType
  powerLevel?: StakeholderLevel
  interestLevel?: StakeholderLevel
  attitude?: StakeholderAttitude
  expectations?: string | null
  managementStrategy?: StakeholderStrategy
  contactInfo?: Record<string, string> | null
}

export interface UpdateStakeholderInput extends Partial<CreateStakeholderInput> {}

export interface StakeholderListFilters {
  stakeholderType?: StakeholderType
  managementStrategy?: StakeholderStrategy
  search?: string
  sort?: string
  page?: number
  perPage?: number
}

/** 四象限视图的 JSON 桶键（camelCase，对应 design D3.3 输出契约）。 */
export type QuadrantBucketKey = 'manageClosely' | 'keepSatisfied' | 'keepInformed' | 'monitor'

export interface StakeholderQuadrantResponse {
  summary: Record<QuadrantBucketKey, number>
  quadrants: Record<QuadrantBucketKey, ProjectStakeholder[]>
}

const STAKEHOLDER_TYPES: readonly StakeholderType[] = ['internal', 'external']
const LEVELS: readonly StakeholderLevel[] = ['low', 'medium', 'high']
const ATTITUDES: readonly StakeholderAttitude[] = ['supportive', 'neutral', 'resistant', 'leading']
const STRATEGIES: readonly StakeholderStrategy[] = [
  'manage_closely',
  'keep_satisfied',
  'keep_informed',
  'monitor',
]

const QUADRANT_BUCKET_KEYS: Record<StakeholderStrategy, QuadrantBucketKey> = {
  manage_closely: 'manageClosely',
  keep_satisfied: 'keepSatisfied',
  keep_informed: 'keepInformed',
  monitor: 'monitor',
}

const SORT_COLUMNS: Record<string, string> = {
  id: 'id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  name: 'name',
  powerLevel: 'power_level',
  interestLevel: 'interest_level',
}

function enumOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string,
  fallback?: T,
): T {
  if (value === undefined || value === null) {
    if (fallback === undefined) {
      throw new ValidationException(`缺少必填字段 ${fieldName}`)
    }
    return fallback
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationException(`${fieldName} 取值非法`)
  }
  return value as T
}

/**
 * 权力-利益四象限分类（design D3.3）：
 * - 重点管理 manage_closely：power=high && interest=high
 * - 令其满意 keep_satisfied：power=high && interest!=high
 * - 随时知会 keep_informed：power!=high && interest=high
 * - 监督观察 monitor：power!=high && interest!=high
 */
export function deriveStakeholderStrategy(
  powerLevel: StakeholderLevel,
  interestLevel: StakeholderLevel,
): StakeholderStrategy {
  if (powerLevel === 'high' && interestLevel === 'high') return 'manage_closely'
  if (powerLevel === 'high') return 'keep_satisfied'
  if (interestLevel === 'high') return 'keep_informed'
  return 'monitor'
}

export default class StakeholderService {
  async list(
    organizationId: number,
    projectId: number,
    filters: StakeholderListFilters = {},
  ): Promise<{
    data: ProjectStakeholder[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    const query = ProjectStakeholder.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      // 显式软删过滤：paginate 的 count 子查询不经过模型 beforeFind 钩子
      .whereNull('deleted_at')

    if (filters.stakeholderType) query.where('stakeholder_type', filters.stakeholderType)
    if (filters.managementStrategy) query.where('management_strategy', filters.managementStrategy)
    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      query.where((builder) => {
        builder
          .whereILike('name', keyword)
          .orWhereILike('role_title', keyword)
          .orWhereILike('organization_name', keyword)
      })
    }

    const sort = filters.sort ?? '-createdAt'
    const direction = sort.startsWith('-') ? 'desc' : 'asc'
    const column = SORT_COLUMNS[sort.replace(/^[+-]/, '')] ?? 'created_at'
    query.orderBy(column, direction).orderBy('id', 'desc')

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()
    return {
      data: paginator.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  /**
   * 权力-利益四象限聚合视图（design D3.3）：
   * 按 power/interest 两个评估档位自动归类，与存储的 management_strategy
   * 解耦——手动覆盖过策略的干系人仍按实际权力/利益归入对应象限。
   */
  async getQuadrantView(
    organizationId: number,
    projectId: number,
  ): Promise<StakeholderQuadrantResponse> {
    await this.projectOrFail(organizationId, projectId)

    const stakeholders = await ProjectStakeholder.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('id', 'asc')

    const buckets: Record<QuadrantBucketKey, ProjectStakeholder[]> = {
      manageClosely: [],
      keepSatisfied: [],
      keepInformed: [],
      monitor: [],
    }

    for (const stakeholder of stakeholders) {
      const strategy = deriveStakeholderStrategy(stakeholder.powerLevel, stakeholder.interestLevel)
      buckets[QUADRANT_BUCKET_KEYS[strategy]].push(stakeholder)
    }

    return {
      summary: {
        manageClosely: buckets.manageClosely.length,
        keepSatisfied: buckets.keepSatisfied.length,
        keepInformed: buckets.keepInformed.length,
        monitor: buckets.monitor.length,
      },
      quadrants: buckets,
    }
  }

  async create(
    organizationId: number,
    projectId: number,
    input: CreateStakeholderInput,
    actorUserId: number,
  ): Promise<ProjectStakeholder> {
    await this.projectOrFail(organizationId, projectId)

    if (!input.name || !input.name.trim()) {
      throw new ValidationException('干系人姓名不能为空')
    }

    const stakeholderType = enumOf<StakeholderType>(
      input.stakeholderType,
      STAKEHOLDER_TYPES,
      'stakeholderType',
      'internal',
    )
    const powerLevel = enumOf<StakeholderLevel>(input.powerLevel, LEVELS, 'powerLevel', 'medium')
    const interestLevel = enumOf<StakeholderLevel>(
      input.interestLevel,
      LEVELS,
      'interestLevel',
      'medium',
    )
    const attitude = enumOf<StakeholderAttitude>(input.attitude, ATTITUDES, 'attitude', 'neutral')
    const managementStrategy =
      input.managementStrategy !== undefined && input.managementStrategy !== null
        ? enumOf<StakeholderStrategy>(input.managementStrategy, STRATEGIES, 'managementStrategy')
        : deriveStakeholderStrategy(powerLevel, interestLevel)

    const userId = input.userId ?? null
    if (userId !== null && stakeholderType === 'internal') {
      await this.assertOrgMember(organizationId, userId)
    }

    return ProjectStakeholder.create({
      organizationId,
      projectId,
      userId,
      name: input.name.trim(),
      organizationName: input.organizationName ?? null,
      roleTitle: input.roleTitle ?? null,
      stakeholderType,
      powerLevel,
      interestLevel,
      attitude,
      expectations: input.expectations ?? null,
      managementStrategy,
      contactInfo: input.contactInfo ?? {},
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })
  }

  async get(
    organizationId: number,
    projectId: number,
    stakeholderId: number,
  ): Promise<ProjectStakeholder> {
    await this.projectOrFail(organizationId, projectId)
    return this.stakeholderOrFail(organizationId, projectId, stakeholderId)
  }

  async update(
    organizationId: number,
    projectId: number,
    stakeholderId: number,
    input: UpdateStakeholderInput,
    actorUserId: number,
  ): Promise<ProjectStakeholder> {
    const stakeholder = await this.stakeholderOrFail(organizationId, projectId, stakeholderId)

    if (input.name !== undefined) {
      if (!input.name.trim()) throw new ValidationException('干系人姓名不能为空')
      stakeholder.name = input.name.trim()
    }
    if (input.stakeholderType !== undefined) {
      stakeholder.stakeholderType = enumOf<StakeholderType>(
        input.stakeholderType,
        STAKEHOLDER_TYPES,
        'stakeholderType',
      )
    }
    if (input.powerLevel !== undefined) {
      stakeholder.powerLevel = enumOf<StakeholderLevel>(input.powerLevel, LEVELS, 'powerLevel')
    }
    if (input.interestLevel !== undefined) {
      stakeholder.interestLevel = enumOf<StakeholderLevel>(
        input.interestLevel,
        LEVELS,
        'interestLevel',
      )
    }
    if (input.attitude !== undefined) {
      stakeholder.attitude = enumOf<StakeholderAttitude>(input.attitude, ATTITUDES, 'attitude')
    }
    if (input.managementStrategy !== undefined && input.managementStrategy !== null) {
      stakeholder.managementStrategy = enumOf<StakeholderStrategy>(
        input.managementStrategy,
        STRATEGIES,
        'managementStrategy',
      )
    }

    // 权力/利益变化且未显式指定策略 → 按四象限自动重推导，保持登记表自洽
    const hasLevelChange = input.powerLevel !== undefined || input.interestLevel !== undefined
    if (
      hasLevelChange &&
      (input.managementStrategy === undefined || input.managementStrategy === null)
    ) {
      stakeholder.managementStrategy = deriveStakeholderStrategy(
        stakeholder.powerLevel,
        stakeholder.interestLevel,
      )
    }

    if (input.userId !== undefined) {
      const userId = input.userId === null ? null : Number(input.userId)
      if (userId !== null && stakeholder.stakeholderType === 'internal') {
        await this.assertOrgMember(organizationId, userId)
      }
      stakeholder.userId = userId
    }
    if (input.organizationName !== undefined) {
      stakeholder.organizationName = input.organizationName ?? null
    }
    if (input.roleTitle !== undefined) {
      stakeholder.roleTitle = input.roleTitle ?? null
    }
    if (input.expectations !== undefined) {
      stakeholder.expectations = input.expectations ?? null
    }
    if (input.contactInfo !== undefined) {
      stakeholder.contactInfo = this.normalizeContactInfo(input.contactInfo)
    }

    stakeholder.updatedBy = actorUserId
    await stakeholder.save()
    return stakeholder
  }

  async softDelete(
    organizationId: number,
    projectId: number,
    stakeholderId: number,
    actorUserId: number,
  ): Promise<void> {
    const stakeholder = await this.stakeholderOrFail(organizationId, projectId, stakeholderId)
    stakeholder.deletedAt = DateTime.now()
    stakeholder.updatedBy = actorUserId
    await stakeholder.save()
  }

  // ---------------- 内部辅助 ----------------

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async stakeholderOrFail(
    organizationId: number,
    projectId: number,
    stakeholderId: number,
  ): Promise<ProjectStakeholder> {
    const stakeholder = await ProjectStakeholder.query()
      .where('id', stakeholderId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!stakeholder) throw new ResourceNotFoundException('干系人不存在')
    return stakeholder
  }

  private async assertOrgMember(organizationId: number, userId: number): Promise<void> {
    const belongs = await OrganizationMember.belongsToOrganization(organizationId, userId)
    if (!belongs) {
      throw new ValidationException('内部干系人绑定的用户必须属于当前组织')
    }
  }

  private normalizeContactInfo(value: Record<string, string> | null): Record<string, string> {
    if (value === null || value === undefined) return {}
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new ValidationException('contactInfo 必须是键值对象')
    }
    const clean: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') clean[key] = entry
    }
    return clean
  }
}
