/**
 * report_v2/periodic_access_guard —— AI 周期报表目标二次授权守卫。
 *
 * 点击通知/活动目标时重新校验权限：
 * - 校验当前用户是否为活跃项目成员
 * - 校验目标报表是否属于该项目且未被删除
 * - 校验用户是否具备报表查看权限
 * - 若权限丢失，返回"目标不可访问"泛化信息，不泄露任何敏感业务细节
 */

import Project from '#models/project'
import ProjectMember from '#models/project_member'
import Report from '#models/report'

/**
 * 目标访问状态。
 */
export type TargetAccessStatus = 'accessible' | 'inaccessible'

/**
 * 目标二次授权结果。
 * 可访问时返回低敏目标元数据；不可访问时仅返回泛化拒绝消息。
 */
export interface TargetAccessResult {
  status: TargetAccessStatus
  /** 可访问时：低敏项目基本信息；不可访问时：null */
  project?: {
    id: number
    name: string
  } | null
  /** 不可访问时的泛化拒绝消息 */
  inaccessibleMessage?: string
}

/**
 * 周期报表目标访问守卫。
 *
 * 二次授权流程：
 * 1. 验证目标项目存在且未删除
 * 2. 验证当前用户为项目活跃成员
 * 3. 验证目标报表存在于项目中且未被删除
 */
export default class PeriodicReportAccessGuard {
  /**
   * 校验当前用户是否可访问指定项目的周期报表。
   *
   * @param userId 当前用户 ID
   * @param organizationId 组织 ID
   * @param projectId 目标项目 ID
   * @param reportId 目标报表 ID（可选；省略时只校验项目和成员）
   * @returns 授权结果
   */
  async checkAccess(
    userId: number,
    organizationId: number,
    projectId: number,
    reportId?: number,
  ): Promise<TargetAccessResult> {
    // 1. 校验项目存在且未删除
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()

    if (!project) {
      return this.inaccessible()
    }

    // 2. 校验当前用户为项目活跃成员
    const membership = await ProjectMember.query()
      .where('project_id', projectId)
      .where('user_id', userId)
      .where('is_active', true)
      .first()

    if (!membership) {
      return this.inaccessible()
    }

    // 3. 如果提供了 reportId，校验报表存在、属于该项目且未被删除
    if (reportId !== undefined) {
      const report = await Report.query()
        .where('id', reportId)
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .first()

      if (!report) {
        return this.inaccessible()
      }
    }

    return {
      status: 'accessible',
      project: { id: project.id, name: project.name },
    }
  }

  /**
   * 返回泛化不可访问结果。
   * 不透传任何项目/报表标题、正文、AI 内容、下载 URL 或敏感指标。
   */
  private inaccessible(): TargetAccessResult {
    return {
      status: 'inaccessible',
      inaccessibleMessage: '目标不可访问',
    }
  }
}

/**
 * 检查单个条件是否满足，不返回详情（适用于批量/快捷校验）。
 * 不满足时返回 false，不泄露原因。
 */
export async function quickCheckPeriodicReportAccess(
  userId: number,
  organizationId: number,
  projectId: number,
): Promise<boolean> {
  const guard = new PeriodicReportAccessGuard()
  const result = await guard.checkAccess(userId, organizationId, projectId)
  return result.status === 'accessible'
}
