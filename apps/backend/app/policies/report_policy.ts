import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  REPORT_VIEW,
  REPORT_CREATE,
  REPORT_EXPORT,
  REPORT_DOWNLOAD,
  AI_CONFIRM,
  type Permission,
} from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * ReportPolicy —— 报表能力权限判定（design D6）。
 *
 * V1 四类权限 + V2 扩展：
 * - view            : 查看历史列表与快照、模板目录、工作台
 * - generate        : 触发一次模板生成（V1）/ 创建版本（V2）
 * - export          : 触发 Markdown/CSV 导出并落盘（V1）/ 多格式导出（V2）
 * - download        : 通过 API 下载已生成的导出文件
 * - aiReview        : AI 草稿人工确认/拒绝（V2）
 * - reviewPeriodic  : AI 周期报表审核（V2 AI 周期报表扩展）
 * - periodicExport  : 周期报表导出（含草稿标识检查）（V2 AI 周期报表扩展）
 *
 * 组织隔离由 Service 层 `projectExistsInOrg` 保证：跨组织访问返回 404，
 * 本 Policy 只负责在组织+项目上下文下评估 RBAC，不判定资源存在性。
 */
@inject()
export default class ReportPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(REPORT_VIEW, user, organizationId, projectId)
  }

  async generate(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(REPORT_CREATE, user, organizationId, projectId)
  }

  async export(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(REPORT_EXPORT, user, organizationId, projectId)
  }

  async download(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(REPORT_DOWNLOAD, user, organizationId, projectId)
  }

  /** V2 新增：AI 草稿审核权限（需要 ai:confirm 权限） */
  async aiReview(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(AI_CONFIRM, user, organizationId, projectId)
  }

  /** V2 AI 周期报表新增：审核周期报表（需要 ai:confirm 权限） */
  async reviewPeriodic(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(AI_CONFIRM, user, organizationId, projectId)
  }

  /** V2 AI 周期报表新增：导出周期报表（需要 export 权限 + 草稿标识检查） */
  async periodicExport(
    user: User,
    organizationId: number,
    projectId: number,
    _isDraftOverride?: boolean,
  ): Promise<boolean> {
    const baseAllowed = await this.allows(REPORT_EXPORT, user, organizationId, projectId)
    if (!baseAllowed) return false
    // draftOverride 不需要额外权限，但需要在 service 层检查状态
    return true
  }

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看报表')
    }
  }

  async authorizeGenerate(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.generate(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权生成报表')
    }
  }

  async authorizeExport(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.export(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权导出报表')
    }
  }

  async authorizeDownload(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.download(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权下载报表')
    }
  }

  /** V2 新增：AI 草稿审核权限守卫 */
  async authorizeAiReview(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.aiReview(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权审核 AI 报表草稿')
    }
  }

  /** V2 AI 周期报表新增：周期审核权限守卫 */
  async authorizeReviewPeriodic(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    if (!(await this.reviewPeriodic(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权审核周期报表')
    }
  }

  /** V2 AI 周期报表新增：周期导出权限守卫 */
  async authorizePeriodicExport(
    user: User,
    organizationId: number,
    projectId: number,
    isDraftOverride?: boolean,
  ): Promise<void> {
    if (!(await this.periodicExport(user, organizationId, projectId, isDraftOverride))) {
      throw new PermissionDeniedException('无权导出周期报表')
    }
  }

  private async allows(
    permission: Permission,
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
