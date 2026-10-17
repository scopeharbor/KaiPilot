/**
 * BiCustomReportPolicy —— 自定义报表权限策略。
 *
 * 覆盖组织成员、BI/report 权限、personal owner、shared management、
 * project/portfolio scope 和字段级权限。
 *
 * v3-bi-custom-report-builder §3.3
 */
import type BiCustomReportDefinition from '#models/bi_custom_report_definition'
import { REPORT_MANAGE, REPORT_VIEW } from '#start/rbac/permissions'

export interface Actor {
  id: number
  organizationId: number
  permissions: Set<string>
}

export class BiCustomReportPolicy {
  /**
   * 检查 actor 是否为目标组织成员。
   */
  static isOrgMember(actor: Actor, organizationId: number): boolean {
    return actor.organizationId === organizationId
  }

  /**
   * 检查 actor 是否有基础报表查看权限。
   */
  static canViewReports(actor: Actor): boolean {
    return actor.permissions.has(REPORT_VIEW)
  }

  /**
   * 检查 actor 是否有报表管理权限（创建/编辑/删除/共享/默认/归档/恢复）。
   */
  static canManageReports(actor: Actor): boolean {
    return actor.permissions.has(REPORT_MANAGE) || actor.permissions.has('admin')
  }

  /**
   * 检查 actor 是否可查看某个特定数据源。
   */
  static canViewDataSource(actor: Actor, permissionTag: string): boolean {
    return actor.permissions.has(permissionTag) || actor.permissions.has('admin')
  }

  /**
   * 检查 actor 是否可查看特定字段。
   */
  static canViewField(actor: Actor, permissionTag?: string): boolean {
    if (!permissionTag) return true
    return actor.permissions.has(permissionTag) || actor.permissions.has('admin')
  }

  /**
   * 检查 actor 是否可读取某个定义。
   * - personal 定义：只有 owner 可读
   * - shared 定义：同组织成员且有 report:view 权限
   * - project scoped 定义：还需要检查项目权限
   */
  static canRead(actor: Actor, def: BiCustomReportDefinition): boolean {
    if (!this.isOrgMember(actor, def.organizationId)) return false

    if (def.archivedAt) {
      // 归档定义只有 owner 和管理员可读
      return def.ownerActorId === actor.id || this.canManageReports(actor)
    }

    if (def.visibility === 'personal') {
      return def.ownerActorId === actor.id
    }

    // shared 定义
    if (def.visibility === 'shared') {
      return this.canViewReports(actor)
    }

    return false
  }

  /**
   * 检查 actor 是否可创建定义。
   */
  static canCreate(actor: Actor, organizationId: number, visibility: string): boolean {
    if (!this.isOrgMember(actor, organizationId)) return false

    if (visibility === 'shared') {
      return this.canManageReports(actor)
    }

    return this.canViewReports(actor)
  }

  /**
   * 检查 actor 是否可更新定义。
   */
  static canUpdate(actor: Actor, def: BiCustomReportDefinition): boolean {
    if (!this.isOrgMember(actor, def.organizationId)) return false

    if (def.visibility === 'personal') {
      return def.ownerActorId === actor.id
    }

    return this.canManageReports(actor)
  }

  /**
   * 检查 actor 是否可复制定义。
   */
  static canCopy(actor: Actor, def: BiCustomReportDefinition): boolean {
    if (!this.isOrgMember(actor, def.organizationId)) return false

    if (def.visibility === 'personal') {
      return def.ownerActorId === actor.id
    }

    return this.canViewReports(actor)
  }

  /**
   * 检查 actor 是否可设为默认。
   */
  static canSetDefault(actor: Actor, def: BiCustomReportDefinition): boolean {
    if (!this.isOrgMember(actor, def.organizationId)) return false
    return this.canManageReports(actor)
  }

  /**
   * 检查 actor 是否可归档/恢复定义。
   */
  static canArchiveRestore(actor: Actor, def: BiCustomReportDefinition): boolean {
    if (!this.isOrgMember(actor, def.organizationId)) return false

    if (def.visibility === 'personal') {
      return def.ownerActorId === actor.id
    }

    return this.canManageReports(actor)
  }

  /**
   * 按权限过滤数据源列表。
   */
  static filterDataSourcesByPermission(
    actor: Actor,
    dataSourceKeys: string[],
    permissionTagMap: Map<string, string>,
  ): string[] {
    return dataSourceKeys.filter((key) => {
      const tag = permissionTagMap.get(key)
      if (!tag) return false
      return this.canViewDataSource(actor, tag)
    })
  }

  /**
   * 字段级脱敏：返回 actor 可查看的字段列表。
   */
  static filterFieldsByPermission(
    actor: Actor,
    fields: string[],
    fieldPermissionMap: Map<string, string | undefined>,
  ): { visible: string[]; redacted: string[] } {
    const visible: string[] = []
    const redacted: string[] = []

    for (const field of fields) {
      const tag = fieldPermissionMap.get(field)
      if (this.canViewField(actor, tag)) {
        visible.push(field)
      } else {
        redacted.push(field)
      }
    }

    return { visible, redacted }
  }
}
