import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Kanban uses an ordering axis independent from WBS and Gantt.
 *
 * Ranks are intentionally sparse so most drag operations only update one row.
 * The backfill is deterministic inside every project/status lane.
 */
export default class extends BaseSchema {
  protected tableName = 'tasks'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.bigInteger('kanban_rank').nullable()
      table.index(['project_id', 'status', 'kanban_rank'])
    })

    this.defer(async (db) => {
      await db.rawQuery(`
        WITH ranked AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY project_id, status
              ORDER BY created_at ASC, id ASC
            ) * 1024 AS next_rank
          FROM tasks
        )
        UPDATE tasks
        SET kanban_rank = (
          SELECT ranked.next_rank
          FROM ranked
          WHERE ranked.id = tasks.id
        )
      `)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['project_id', 'status', 'kanban_rank'])
      table.dropColumn('kanban_rank')
    })
  }
}
