import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 将 wbs_nodes.task_id 的全表唯一索引改为「仅限未删除节点」的条件唯一索引。
 *
 * 背景：WBS 节点删除为软删除（deleted_at 非空），旧节点仍保留 task_id。
 * 原全表唯一索引 `wbs_nodes_task_id_unique`（1768790000000 建表时
 * `table.unique(['task_id'])`）会把软删行一并计入唯一约束，导致「删除关联任务的
 * WBS 节点后为同一任务重建节点」在数据库层直接违反唯一约束（先于 service 校验即报错）。
 * 语义上软删节点已从活动树中移除（模型层所有查询均排除 deleted_at），不应再占用
 * task_id 关联；唯一性只在未删除节点之间成立（配合 wbs_tree_service 占用检查
 * 排除软删行）。条件唯一索引 SQLite / PostgreSQL 均支持
 * （先例：custom_views、plugin_storage_namespaces）。
 * PostgreSQL 的 `table.unique(['task_id'])` 会创建同名 UNIQUE CONSTRAINT（及其背后的
 * 索引），不能直接 `DROP INDEX`；SQLite 则只有普通唯一索引。必须按方言先解除旧对象。
 * raw 调用沿用仓库先例排队执行、不 await（await 会在该执行期被重复执行）。
 */
export function wbsTaskUniqueStatements(direction: 'up' | 'down', dialect: string): string[] {
  const isPostgres = dialect === 'postgres' || dialect === 'redshift'

  if (direction === 'up') {
    return [
      ...(isPostgres
        ? ['ALTER TABLE wbs_nodes DROP CONSTRAINT IF EXISTS wbs_nodes_task_id_unique']
        : []),
      'DROP INDEX IF EXISTS wbs_nodes_task_id_unique',
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_wbs_nodes_task_id_active ON wbs_nodes (task_id) WHERE deleted_at IS NULL',
    ]
  }

  return [
    'DROP INDEX IF EXISTS uq_wbs_nodes_task_id_active',
    isPostgres
      ? 'ALTER TABLE wbs_nodes ADD CONSTRAINT wbs_nodes_task_id_unique UNIQUE (task_id)'
      : 'CREATE UNIQUE INDEX IF NOT EXISTS wbs_nodes_task_id_unique ON wbs_nodes (task_id)',
  ]
}

export default class extends BaseSchema {
  async up() {
    for (const statement of wbsTaskUniqueStatements('up', this.db.dialect.name)) {
      this.schema.raw(statement)
    }
  }

  async down() {
    for (const statement of wbsTaskUniqueStatements('down', this.db.dialect.name)) {
      this.schema.raw(statement)
    }
  }
}
