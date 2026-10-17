import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import { insertReturningId } from '#database/support/insert_returning_id'

/**
 * 开发种子：在默认组织下建示例项目 + 任务样例（供手测任务 API）。
 * 仅 development；幂等（按 project.code 与 task (project_id, name) 去重）。
 * 依赖 dev_users_seeder 建立的 default-org + admin@aiproj.local。
 */
export default class extends BaseSeeder {
  static environment = ['development']

  async run() {
    const org = await this.client.from('organizations').where('slug', 'default-org').first()
    if (!org) return
    const owner = await this.client.from('users').where('email', 'admin@aiproj.local').first()
    if (!owner) return

    const now = DateTime.now().toSQL({ includeOffset: false })!

    await this.client.transaction(async (trx) => {
      let project = await trx.from('projects').where('code', 'DEMO').first()
      if (!project) {
        const projectId = await insertReturningId(trx, 'projects', {
          organization_id: org.id,
          name: '演示项目',
          code: 'DEMO',
          status: 'active',
          priority: 'medium',
          currency: 'CNY',
          progress_percent: 0,
          health_status: 'unknown',
          created_by: owner.id,
          created_at: now,
          updated_at: now,
        })
        project = { id: projectId }
      }

      const ensureTask = async (
        name: string,
        overrides: Record<string, unknown> = {},
      ): Promise<number> => {
        const values = {
          project_id: project.id,
          name,
          status: 'not_started',
          priority: 'medium',
          task_type: 'task',
          progress_percent: 0,
          is_critical_path: 0,
          is_on_longest_path: 0,
          created_at: now,
          updated_at: now,
          ...overrides,
        }
        const exists = await trx
          .from('tasks')
          .where('project_id', project.id)
          .where('name', name)
          .whereNull('deleted_at')
          .first()
        if (exists) {
          await trx.from('tasks').where('id', exists.id).update(values)
          return exists.id
        }
        return insertReturningId(trx, 'tasks', values)
      }

      const t1 = await ensureTask('需求分析', { status: 'completed', priority: 'high' })
      await ensureTask('撰写项目章程', { parent_task_id: t1, status: 'in_progress' })
      await ensureTask('架构设计', { status: 'in_progress', priority: 'high' })
      await ensureTask('待评估事项', { status: 'blocked' })
    })
  }
}
