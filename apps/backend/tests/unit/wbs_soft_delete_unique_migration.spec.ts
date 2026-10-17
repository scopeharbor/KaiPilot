import { describe, expect, it } from 'vitest'
import { wbsTaskUniqueStatements } from '../../database/migrations/1994000000000_make_wbs_task_id_unique_ignore_soft_deleted.js'

describe('WBS soft-delete unique migration SQL', () => {
  it('PostgreSQL 先删除 UNIQUE CONSTRAINT，再建立活动行条件索引', () => {
    expect(wbsTaskUniqueStatements('up', 'postgres')).toEqual([
      'ALTER TABLE wbs_nodes DROP CONSTRAINT IF EXISTS wbs_nodes_task_id_unique',
      'DROP INDEX IF EXISTS wbs_nodes_task_id_unique',
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_wbs_nodes_task_id_active ON wbs_nodes (task_id) WHERE deleted_at IS NULL',
    ])
  })

  it('SQLite 不执行不支持的 DROP CONSTRAINT', () => {
    const statements = wbsTaskUniqueStatements('up', 'sqlite3')
    expect(statements).toHaveLength(2)
    expect(statements.join('\n')).not.toContain('DROP CONSTRAINT')
  })

  it('回滚时按方言恢复原唯一对象', () => {
    expect(wbsTaskUniqueStatements('down', 'postgres')[1]).toBe(
      'ALTER TABLE wbs_nodes ADD CONSTRAINT wbs_nodes_task_id_unique UNIQUE (task_id)',
    )
    expect(wbsTaskUniqueStatements('down', 'better-sqlite3')[1]).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS wbs_nodes_task_id_unique ON wbs_nodes (task_id)',
    )
  })
})
