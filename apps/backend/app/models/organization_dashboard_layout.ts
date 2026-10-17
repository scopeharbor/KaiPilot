import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type {
  OrganizationDashboardLayoutDensity,
  OrganizationDashboardLayoutModuleInstance,
  OrganizationDashboardLayoutScope,
} from '@aiproj/types'

/**
 * 组织 Dashboard 布局配置模型（v3-organization-dashboard-layout-builder §2.1）。
 *
 * 约束：
 *   - 系统默认布局（scope=system）不可写入，来自代码常量。
 *   - 个人布局（scope=personal）按 actor+organization 作用域唯一保存。
 *   - 组织共享布局（scope=shared）只有 owner/admin/授权 PMO 管理角色可创建和设为默认。
 *   - version 字段用于乐观锁，每次写入递增。
 */
export default class OrganizationDashboardLayout extends BaseModel {
  static table = 'organization_dashboard_layouts'

  @column({ isPrimary: true })
  declare id: number

  /** 组织隔离（红线） */
  @column()
  declare organizationId: number

  /** 作用域：system | personal | shared */
  @column()
  declare scope: OrganizationDashboardLayoutScope

  /** 个人布局的所有者（system/shared 为 null） */
  @column()
  declare ownerActorId: number | null

  /** 布局名称 */
  @column()
  declare name: string | null

  /** 乐观锁版本号 */
  @column()
  declare version: number

  /** 是否为该作用域下的默认布局（SQLite boolean as 0/1） */
  @column()
  declare isDefault: number

  /** 密度：comfortable | compact */
  @column()
  declare density: OrganizationDashboardLayoutDensity

  /** 模块实例 JSON 字符串 */
  @column({
    prepare: (value: OrganizationDashboardLayoutModuleInstance[] | null) =>
      value === null || value === undefined ? '[]' : JSON.stringify(value),
    consume: (value: string) =>
      value ? (JSON.parse(value) as OrganizationDashboardLayoutModuleInstance[]) : [],
    serialize: (value: OrganizationDashboardLayoutModuleInstance[] | null) => value ?? [],
  })
  declare modulesJson: OrganizationDashboardLayoutModuleInstance[]

  /** 低敏元数据 JSON */
  @column({
    prepare: (value: Record<string, unknown> | null) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: string | null) =>
      value ? (JSON.parse(value) as Record<string, unknown>) : null,
    serialize: (value: Record<string, unknown> | null) => value,
  })
  declare metadataJson: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
