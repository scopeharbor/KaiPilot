/**
 * v3-chart-gallery-data-foundation —— ProjectCharterService（W2.1）。
 *
 * 项目章程领域服务：每项目至多一份现行章程（project_id UNIQUE），承载
 * draft → pending_approval → approved / rejected 审批治理生命周期。
 *
 * - 所有查询强制 `organization_id` 隔离；跨租户/查无一律 ResourceNotFoundException（404，RL-05）
 * - 仅 draft / rejected 状态的章程可直接编辑；rejected 被再次编辑视为升版（version + 1）
 * - pending_approval 只能等待审批决议（approve/reject）；approved 为终态禁止直接修改
 * - Service 层不含 HTTP；权限门禁由 W5 Policy 层执行
 */
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import ProjectCharter from '#models/project_charter'
import type { ProjectCharterApprovalStatus } from '#models/project_charter'
import Project from '#models/project'
import { DateTime } from 'luxon'

/** 创建章程草案载荷（字段对齐 AI 草案 charter 规范）。 */
export interface CreateCharterInput {
  title: string
  vision: string
  scope: string
  objectives: string[]
  successCriteria: string[]
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD */
  endDate: string
  businessCase?: string | null
}

/** 编辑载荷：全部可选，仅覆盖传入字段。 */
export type UpdateCharterInput = Partial<Omit<CreateCharterInput, 'businessCase'>> & {
  businessCase?: string | null
}

/** 审批决议动作。 */
export type CharterApprovalAction = 'approve' | 'reject'

/** 允许直接编辑的章程状态。 */
const EDITABLE_STATUSES: readonly ProjectCharterApprovalStatus[] = ['draft', 'rejected']

export default class ProjectCharterService {
  /**
   * 获取项目现行章程。项目不存在/跨组织 → 404；未创建章程时返回 null（W5 决定渲染空对象）。
   */
  async get(organizationId: number, projectId: number): Promise<ProjectCharter | null> {
    await this.projectOrFail(organizationId, projectId)
    return ProjectCharter.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
  }

  /** 首次创建项目章程草案（版本 1，状态 draft）。 */
  async create(
    organizationId: number,
    projectId: number,
    input: CreateCharterInput,
    actorUserId: number,
  ): Promise<ProjectCharter> {
    await this.projectOrFail(organizationId, projectId)

    const existing = await ProjectCharter.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (existing) {
      throw new ValidationException('该项目已存在章程，请直接编辑或提交审批')
    }

    this.assertDateRange(input.startDate, input.endDate)

    return ProjectCharter.create({
      organizationId,
      projectId,
      title: input.title,
      vision: input.vision,
      scope: input.scope,
      objectives: input.objectives,
      successCriteria: input.successCriteria,
      startDate: this.toDate(input.startDate),
      endDate: this.toDate(input.endDate),
      businessCase: input.businessCase ?? null,
      approvalStatus: 'draft',
      approvedBy: null,
      approvedAt: null,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })
  }

  /**
   * 编辑草案态或被驳回态章程（draft/rejected）。
   * 已提交审批（pending_approval）或已批准（approved）禁止直接修改；驳回后的修改视为升版。
   */
  async update(
    organizationId: number,
    projectId: number,
    input: UpdateCharterInput,
    actorUserId: number,
  ): Promise<ProjectCharter> {
    const charter = await this.charterOrFail(organizationId, projectId)

    if (charter.approvalStatus === 'approved') {
      throw new ValidationException('已批准的章程不可直接修改')
    }
    if (charter.approvalStatus === 'pending_approval') {
      throw new ValidationException('审批中的章程不可直接修改，请等待审批决议')
    }

    const startDate = input.startDate ?? charter.startDate.toFormat('yyyy-MM-dd')
    const endDate = input.endDate ?? charter.endDate.toFormat('yyyy-MM-dd')
    this.assertDateRange(startDate, endDate)

    charter.merge({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.vision !== undefined && { vision: input.vision }),
      ...(input.scope !== undefined && { scope: input.scope }),
      ...(input.objectives !== undefined && { objectives: input.objectives }),
      ...(input.successCriteria !== undefined && { successCriteria: input.successCriteria }),
      ...(input.startDate !== undefined && { startDate: this.toDate(input.startDate) }),
      ...(input.endDate !== undefined && { endDate: this.toDate(input.endDate) }),
      ...(input.businessCase !== undefined && { businessCase: input.businessCase ?? null }),
      updatedBy: actorUserId,
    })
    // 驳回后的再次修改视为升版（版本号递增后仍处于 rejected，重新提交进入审批）
    if (charter.approvalStatus === 'rejected') {
      charter.version += 1
    }

    await charter.save()
    return charter
  }

  /** 提交审批：draft | rejected → pending_approval。 */
  async submit(
    organizationId: number,
    projectId: number,
    actorUserId: number,
  ): Promise<ProjectCharter> {
    const charter = await this.charterOrFail(organizationId, projectId)

    if (!EDITABLE_STATUSES.includes(charter.approvalStatus)) {
      throw new ValidationException('仅草稿或被驳回状态的章程可提交审批')
    }

    charter.approvalStatus = 'pending_approval'
    charter.updatedBy = actorUserId
    await charter.save()
    return charter
  }

  /** 审批决议：仅 pending_approval 可执行；approve 固化审批人与时间，reject 驳回待升版重提。 */
  async approve(
    organizationId: number,
    projectId: number,
    action: CharterApprovalAction,
    actorUserId: number,
  ): Promise<ProjectCharter> {
    const charter = await this.charterOrFail(organizationId, projectId)

    if (charter.approvalStatus !== 'pending_approval') {
      throw new ValidationException('仅待审批状态的章程可执行审批决议')
    }

    if (action === 'approve') {
      charter.approvalStatus = 'approved'
      charter.approvedBy = actorUserId
      charter.approvedAt = DateTime.now()
    } else {
      charter.approvalStatus = 'rejected'
      charter.approvedBy = null
      charter.approvedAt = null
    }
    charter.updatedBy = actorUserId
    await charter.save()
    return charter
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async charterOrFail(organizationId: number, projectId: number): Promise<ProjectCharter> {
    const charter = await ProjectCharter.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!charter) throw new ResourceNotFoundException('项目章程不存在')
    return charter
  }

  private toDate(value: string): DateTime {
    const date = DateTime.fromISO(value)
    if (!date.isValid) throw new ValidationException('日期格式无效，应为 YYYY-MM-DD')
    return date
  }

  private assertDateRange(startDate: string, endDate: string): void {
    const start = this.toDate(startDate)
    const end = this.toDate(endDate)
    if (end < start) throw new ValidationException('结束日期不能早于开始日期')
  }
}
