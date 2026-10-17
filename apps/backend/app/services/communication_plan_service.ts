/**
 * v3-chart-gallery-data-foundation —— CommunicationPlanService（W3.3）。
 *
 * 项目沟通管理计划 CRUD：
 * - 所有查询强制 organization_id 物理隔离（RL-05），跨租户一律抛
 *   ResourceNotFoundException（HTTP 404）；
 * - ownerId（责任人）必须属于当前组织成员；
 * - reportTemplateKey 为与既有周期报表服务联动的模板标识（非外键，纯标识串），
 *   模板目录存在性校验由 W5 校验器层负责（模板注册表跨域）；
 * - isActive 为启停开关：停用保留配置（软关闭），软删除（deleted_at）为最终移除。
 */
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import CommunicationPlan from '#models/communication_plan'
import type {
  CommunicationChannel,
  CommunicationFrequency,
  CommunicationType,
} from '#models/communication_plan'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import { DateTime } from 'luxon'

export interface CreateCommunicationPlanInput {
  name: string
  ownerId: number
  communicationType?: CommunicationType
  purpose: string
  frequency?: CommunicationFrequency
  channel?: CommunicationChannel
  audience: string
  deliverable?: string | null
  reportTemplateKey?: string | null
  isActive?: boolean
}

export interface UpdateCommunicationPlanInput extends Partial<CreateCommunicationPlanInput> {}

export interface CommunicationPlanListFilters {
  communicationType?: CommunicationType
  frequency?: CommunicationFrequency
  channel?: CommunicationChannel
  isActive?: boolean
  search?: string
  sort?: string
  page?: number
  perPage?: number
}

const COMMUNICATION_TYPES: readonly CommunicationType[] = [
  'meeting',
  'report',
  'email',
  'instant_message',
]
const FREQUENCIES: readonly CommunicationFrequency[] = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'milestone_driven',
  'ad_hoc',
]
const CHANNELS: readonly CommunicationChannel[] = [
  'in_person',
  'video_conference',
  'email',
  'wechat_work',
  'feishu',
  'pdf_export',
]

const SORT_COLUMNS: Record<string, string> = {
  id: 'id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  name: 'name',
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

export default class CommunicationPlanService {
  async list(
    organizationId: number,
    projectId: number,
    filters: CommunicationPlanListFilters = {},
  ): Promise<{
    data: CommunicationPlan[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    const query = CommunicationPlan.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      // 显式软删过滤：paginate 的 count 子查询不经过模型 beforeFind 钩子
      .whereNull('deleted_at')

    if (filters.communicationType) query.where('communication_type', filters.communicationType)
    if (filters.frequency) query.where('frequency', filters.frequency)
    if (filters.channel) query.where('channel', filters.channel)
    if (filters.isActive !== undefined) query.where('is_active', filters.isActive)
    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      query.where((builder) => {
        builder
          .whereILike('name', keyword)
          .orWhereILike('purpose', keyword)
          .orWhereILike('audience', keyword)
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

  async create(
    organizationId: number,
    projectId: number,
    input: CreateCommunicationPlanInput,
    actorUserId: number,
  ): Promise<CommunicationPlan> {
    await this.projectOrFail(organizationId, projectId)

    if (!input.name || !input.name.trim()) {
      throw new ValidationException('沟通事项名称不能为空')
    }
    if (!input.purpose || !input.purpose.trim()) {
      throw new ValidationException('沟通目的不能为空')
    }
    if (!input.audience || !input.audience.trim()) {
      throw new ValidationException('目标受众不能为空')
    }
    if (!input.ownerId || !Number.isInteger(input.ownerId)) {
      throw new ValidationException('沟通计划必须指定责任人 ownerId')
    }
    await this.assertOrgMember(organizationId, Number(input.ownerId))

    const communicationType = enumOf<CommunicationType>(
      input.communicationType,
      COMMUNICATION_TYPES,
      'communicationType',
      'meeting',
    )
    const frequency = enumOf<CommunicationFrequency>(
      input.frequency,
      FREQUENCIES,
      'frequency',
      'weekly',
    )
    const channel = enumOf<CommunicationChannel>(
      input.channel,
      CHANNELS,
      'channel',
      'video_conference',
    )

    return CommunicationPlan.create({
      organizationId,
      projectId,
      ownerId: Number(input.ownerId),
      name: input.name.trim(),
      communicationType,
      purpose: input.purpose.trim(),
      frequency,
      channel,
      audience: input.audience.trim(),
      deliverable: input.deliverable ?? null,
      reportTemplateKey: this.normalizeTemplateKey(input.reportTemplateKey),
      isActive: input.isActive ?? true,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })
  }

  async get(organizationId: number, projectId: number, planId: number): Promise<CommunicationPlan> {
    await this.projectOrFail(organizationId, projectId)
    return this.planOrFail(organizationId, projectId, planId)
  }

  async update(
    organizationId: number,
    projectId: number,
    planId: number,
    input: UpdateCommunicationPlanInput,
    actorUserId: number,
  ): Promise<CommunicationPlan> {
    const plan = await this.planOrFail(organizationId, projectId, planId)

    if (input.name !== undefined) {
      if (!input.name.trim()) throw new ValidationException('沟通事项名称不能为空')
      plan.name = input.name.trim()
    }
    if (input.purpose !== undefined) {
      if (!input.purpose.trim()) throw new ValidationException('沟通目的不能为空')
      plan.purpose = input.purpose.trim()
    }
    if (input.audience !== undefined) {
      if (!input.audience.trim()) throw new ValidationException('目标受众不能为空')
      plan.audience = input.audience.trim()
    }
    if (input.communicationType !== undefined) {
      plan.communicationType = enumOf<CommunicationType>(
        input.communicationType,
        COMMUNICATION_TYPES,
        'communicationType',
      )
    }
    if (input.frequency !== undefined) {
      plan.frequency = enumOf<CommunicationFrequency>(input.frequency, FREQUENCIES, 'frequency')
    }
    if (input.channel !== undefined) {
      plan.channel = enumOf<CommunicationChannel>(input.channel, CHANNELS, 'channel')
    }
    if (input.ownerId !== undefined) {
      if (!Number.isInteger(input.ownerId)) {
        throw new ValidationException('ownerId 必须为正整数')
      }
      await this.assertOrgMember(organizationId, Number(input.ownerId))
      plan.ownerId = Number(input.ownerId)
    }
    if (input.deliverable !== undefined) {
      plan.deliverable = input.deliverable ?? null
    }
    if (input.reportTemplateKey !== undefined) {
      plan.reportTemplateKey = this.normalizeTemplateKey(input.reportTemplateKey)
    }
    if (input.isActive !== undefined) {
      plan.isActive = Boolean(input.isActive)
    }

    plan.updatedBy = actorUserId
    await plan.save()
    return plan
  }

  /** 启停开关切换（软关闭/重新启用，保留配置）。 */
  async setActive(
    organizationId: number,
    projectId: number,
    planId: number,
    isActive: boolean,
    actorUserId: number,
  ): Promise<CommunicationPlan> {
    const plan = await this.planOrFail(organizationId, projectId, planId)
    plan.isActive = Boolean(isActive)
    plan.updatedBy = actorUserId
    await plan.save()
    return plan
  }

  async softDelete(
    organizationId: number,
    projectId: number,
    planId: number,
    actorUserId: number,
  ): Promise<void> {
    const plan = await this.planOrFail(organizationId, projectId, planId)
    plan.deletedAt = DateTime.now()
    plan.updatedBy = actorUserId
    await plan.save()
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

  private async planOrFail(
    organizationId: number,
    projectId: number,
    planId: number,
  ): Promise<CommunicationPlan> {
    const plan = await CommunicationPlan.query()
      .where('id', planId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!plan) throw new ResourceNotFoundException('沟通计划不存在')
    return plan
  }

  private async assertOrgMember(organizationId: number, userId: number): Promise<void> {
    const belongs = await OrganizationMember.belongsToOrganization(organizationId, userId)
    if (!belongs) {
      throw new ValidationException('沟通计划责任人必须属于当前组织')
    }
  }

  private normalizeTemplateKey(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null
    const trimmed = value.trim()
    if (!trimmed) return null
    if (trimmed.length > 64) {
      throw new ValidationException('reportTemplateKey 长度不能超过 64')
    }
    return trimmed
  }
}
