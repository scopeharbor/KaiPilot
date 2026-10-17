/**
 * v3-copilot-agent-as-assignee —— 为 tasks 表新增 assignee_type 列。
 *
 * assignee_type: 'user'（默认，真人）| 'agent'（AI Copilot）。
 * 复用既有 tasks 表，新增一列区分负责人类型。
 *
 * 方言兼容：不使用 `.after()`（SQLite 不支持列定位），列顺序由建表顺序决定。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class AddAssigneeTypeToTasks extends BaseSchema {
  protected tableName = 'tasks'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('assignee_type', 10).notNullable().defaultTo('user')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('assignee_type')
    })
  }
}
