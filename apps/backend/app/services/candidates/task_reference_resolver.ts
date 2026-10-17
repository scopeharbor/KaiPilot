/**
 * v2-5-code-repository-auto-linking —— 组织范围的任务引用解析器。
 *
 * 设计 D2/D4:
 * - 在当前组织和项目上下文内验证任务存在性与可见性
 * - 对缺失、已删除、跨组织/项目不可见引用返回不泄露存在性的稳定结果
 * - 首期只验证任务存在性，任务编号自动匹配需后续 task_key 字段支持
 */

import Task from '#models/task'
import { DateTime } from 'luxon'
import Project from '#models/project'

// ---------------------------------------------------------------------------
// 解析结果
// ---------------------------------------------------------------------------

export interface ResolveReferenceResult {
  /** 是否匹配到可访问的任务 */
  matched: boolean
  /** 匹配到的任务 ID（仅 matched=true 时有） */
  taskId?: number
  /** 匹配到的任务名称（仅 matched=true 时有） */
  taskName?: string
  /** 稳定 reason code */
  reason:
    | 'matched'
    | 'no_reference'
    | 'task_not_found'
    | 'task_deleted'
    | 'cross_organization'
    | 'cross_project'
    | 'no_visible_project'
  /** 不泄露存在性的通用消息（对未授权统一返回"未找到"） */
  message: string
}

// ---------------------------------------------------------------------------
// 解析器
// ---------------------------------------------------------------------------

export class TaskReferenceResolver {
  /**
   * 按用户可见的任务引用字符串解析任务。
   * 首期没有 task_key 字段，先从引用中提取数字 ID，并保持不存在性保护。
   */
  async resolve(
    organizationId: number,
    taskReference: string,
    projectId?: number,
  ): Promise<ResolveReferenceResult> {
    const normalized = taskReference.trim()
    if (!normalized) {
      return {
        matched: false,
        reason: 'no_reference',
        message: '未提供有效的任务引用',
      }
    }

    const numericReference = normalized.match(/\d+/)?.[0]
    if (!numericReference) {
      return {
        matched: false,
        reason: 'task_not_found',
        message: '未找到匹配的任务',
      }
    }

    // v3-multitenant-database-isolation §5.5：任务经父级链（tasks → projects.organization_id）
    // 一次性 scope 解析。原实现先无条件按 id 取任务、再比较组织，并用不同的 reason
    // （task_not_found / no_visible_project）区分「不存在」与「存在但属他租」——
    // reason 会落进 link_candidates 记录，构成任务存在性侧信道。现在两种情况同形。
    const task = await Task.query()
      .where('id', Number(numericReference))
      .whereIn('project_id', Project.query().select('id').where('organization_id', organizationId))
      .first()
    if (!task || task.deletedAt) {
      return {
        matched: false,
        reason: 'task_not_found',
        message: '未找到匹配的任务',
      }
    }

    const project = await Project.query()
      .where('id', Number(task.projectId))
      .where('organization_id', organizationId)
      .first()
    if (!project) {
      return {
        matched: false,
        reason: 'task_not_found',
        message: '未找到匹配的任务',
      }
    }

    if (projectId && Number(task.projectId) !== projectId) {
      return {
        matched: false,
        reason: 'cross_project',
        message: '未找到匹配的任务',
      }
    }

    return {
      matched: true,
      taskId: Number(task.id),
      taskName: task.name,
      reason: 'matched',
      message: '匹配到可访问的任务',
    }
  }

  async resolveMany(
    organizationId: number,
    taskReferences: string[],
    projectId?: number,
  ): Promise<ResolveReferenceResult[]> {
    const uniqueReferences = [...new Set(taskReferences.map((ref) => ref.trim()).filter(Boolean))]
    return Promise.all(uniqueReferences.map((ref) => this.resolve(organizationId, ref, projectId)))
  }

  /**
   * 按任务 ID 解析任务，验证组织归属和项目访问。
   * 首期通过 task.id 查找。后续可扩展为通过 task_key/identifier 查找。
   *
   * @param organizationId 当前组织 ID
   * @param projectId 当前项目 ID
   * @param taskId 任务 ID（从候选提取上下文中获得）
   * @returns 解析结果
   */
  async resolveById(
    organizationId: number,
    projectId: number,
    taskId: number,
  ): Promise<ResolveReferenceResult> {
    if (!taskId || taskId <= 0) {
      return {
        matched: false,
        reason: 'no_reference',
        message: '未提供有效的任务引用',
      }
    }

    const task = await Task.query().where('id', taskId).where('project_id', projectId).first()

    if (!task) {
      return {
        matched: false,
        reason: 'task_not_found',
        message: '未找到匹配的任务',
      }
    }

    if (task.deletedAt && task.deletedAt <= DateTime.utc()) {
      return {
        matched: false,
        reason: 'task_deleted',
        message: '匹配任务已被删除',
      }
    }

    const project = await Project.query().where('id', Number(task.projectId)).first()
    if (!project || Number(project.organizationId) !== organizationId) {
      return {
        matched: false,
        reason: 'cross_organization',
        message: '未找到匹配的任务',
      }
    }

    return {
      matched: true,
      taskId: Number(task.id),
      taskName: task.name,
      reason: 'matched',
      message: '匹配到可访问的任务',
    }
  }

  /**
   * 验证任务是否属于给定组织。
   */
  async verifyOrganization(taskId: number, organizationId: number): Promise<boolean> {
    const task = await Task.query().where('id', taskId).first()

    if (!task) return false

    const project = await Project.query()
      .where('id', Number(task.projectId))
      .where('organization_id', organizationId)
      .first()

    return !!project
  }
}
