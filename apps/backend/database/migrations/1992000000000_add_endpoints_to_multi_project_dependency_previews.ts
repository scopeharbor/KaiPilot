import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * multi_project_dependency_previews 增加 `endpoints` 列 —— 修复 confirm 写入路径的占位实现。
 *
 * 缺陷背景：`MultiProjectDependencyService.confirm` 原先把端点字段写死
 * （`providerProjectId: 1 / providerTaskId: 101`，consumer 侧 2/201），
 * 源码注释自陈 "Placeholder — actual values would come from preview context"。
 * 根因是预览只把解析后的端点放进返回值，**没有落库**，确认时无从取回，
 * 于是无视用户输入写入固定假 id，再因这些 id 不存在撞外键约束。
 *
 * 向后兼容：nullable JSON。既有历史预览行为 null —— confirm 侧对 null 显式拒绝
 * （要求重新预览），而不是退回写假数据。零数据迁移、零回填。
 *
 * 有界：仅存 provider/consumer 两个端点的标识字段（endpointType / projectId /
 * milestoneId / taskId / externalLabel / externalKey），不含名称、权限或证据，
 * 与预览本身的低敏语义一致。
 */
export default class extends BaseSchema {
  protected tableName = 'multi_project_dependency_previews'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('endpoints').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('endpoints')
    })
  }
}
