import RbacService from '#services/rbac_service'
import type User from '#models/user'
import { inject } from '@adonisjs/core'

/**
 * 文件策略（V2 扩展）：覆盖版本、标签、批量、恢复、永久删除和实体关联。
 * V1：file:view / file:manage
 * V2 扩展：file:version:upload, file:version:download, file:tag:manage,
 *          file:batch:delete, file:restore, file:permanent_delete, file:link:manage
 */
@inject()
export default class FilePolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:view', user, organizationId, projectId)
  }

  async manage(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:manage', user, organizationId, projectId)
  }

  // V2 版本上传
  async uploadVersion(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:manage', user, organizationId, projectId)
  }

  // V2 版本下载（与 view 同权限）
  async downloadVersion(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:view', user, organizationId, projectId)
  }

  // V2 标签管理
  async manageTags(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:manage', user, organizationId, projectId)
  }

  // V2 标签查看
  async viewTags(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:view', user, organizationId, projectId)
  }

  // V2 批量操作
  async batchAction(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:manage', user, organizationId, projectId)
  }

  // V2 恢复回收站
  async restore(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:manage', user, organizationId, projectId)
  }

  // V2 永久删除
  async permanentDelete(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:manage', user, organizationId, projectId)
  }

  // V2 实体关联管理
  async manageLinks(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:manage', user, organizationId, projectId)
  }

  // V3 Markdown 导入（preview + confirm 均需 file:manage；preview 校验潜在写入目标）
  async markdownImport(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:manage', user, organizationId, projectId)
  }

  // V3 Markdown 导出（file:view 即可；单文档与选中树导出同权限）
  async markdownExport(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('file:view', user, organizationId, projectId)
  }

  private async allows(
    permission: 'file:view' | 'file:manage',
    user: User,
    organizationId: number,
    projectId?: number,
  ): Promise<boolean> {
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
