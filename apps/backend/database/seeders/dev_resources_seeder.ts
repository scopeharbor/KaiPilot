import { DateTime } from 'luxon'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { insertReturningId } from '#database/support/insert_returning_id'

export default class DevResourcesSeeder extends BaseSeeder {
  async run() {
    const project = await this.client.from('projects').where('code', 'DEMO').first()
    if (!project) return
    const projectId = project.id

    const existing = await this.client.from('resources').where('project_id', projectId)
    const now = DateTime.now().toSQL({ includeOffset: false })!
    if (existing.length > 0) {
      await this.client.from('resources').where('project_id', projectId).update({
        created_at: now,
        updated_at: now,
      })
      return
    }

    await this.client.transaction(async (trx) => {
      const r1 = await insertReturningId(trx, 'resources', {
        project_id: projectId,
        user_id: null,
        name: '张三',
        email: 'zhangsan@example.com',
        resource_type: 'human',
        role: 'project_manager',
        status: 'active',
        daily_capacity_hours: 8.0,
        skill_tags: JSON.stringify(['项目管理', '全栈开发']),
        work_days: JSON.stringify([1, 2, 3, 4, 5]),
        timezone: 'Asia/Shanghai',
        created_at: now,
        updated_at: now,
      })
      const r2 = await insertReturningId(trx, 'resources', {
        project_id: projectId,
        user_id: null,
        name: '李四',
        email: 'lisi@example.com',
        resource_type: 'human',
        role: 'member',
        status: 'active',
        daily_capacity_hours: 6.0,
        skill_tags: JSON.stringify(['前端开发', 'UI设计']),
        work_days: JSON.stringify([1, 2, 3, 4, 5]),
        timezone: 'Asia/Shanghai',
        created_at: now,
        updated_at: now,
      })
      const r3 = await insertReturningId(trx, 'resources', {
        project_id: projectId,
        user_id: null,
        name: '王五',
        email: 'wangwu@example.com',
        resource_type: 'human',
        role: 'member',
        status: 'active',
        daily_capacity_hours: 8.0,
        skill_tags: JSON.stringify(['后端开发', '数据库']),
        work_days: JSON.stringify([1, 2, 3, 4, 5]),
        timezone: 'Asia/Shanghai',
        created_at: now,
        updated_at: now,
      })
      const r4 = await insertReturningId(trx, 'resources', {
        project_id: projectId,
        user_id: null,
        name: '赵六',
        email: 'zhaoliu@example.com',
        resource_type: 'human',
        role: 'member',
        status: 'active',
        daily_capacity_hours: 8.0,
        skill_tags: JSON.stringify(['测试', '运维']),
        work_days: JSON.stringify([1, 2, 3, 4, 5, 6]),
        timezone: 'Asia/Shanghai',
        created_at: now,
        updated_at: now,
      })

      const resourceIds: number[] = [r1, r2, r3, r4]

      const tasks = await trx.from('tasks').where('project_id', projectId)
      const taskId = tasks[0]?.id
      if (taskId) {
        await trx.table('resource_allocations').multiInsert([
          {
            resource_id: resourceIds[0],
            task_id: taskId,
            allocation_type: 'assigned',
            allocation_percent: 100.0,
            start_date: DateTime.now().toISODate(),
            end_date: DateTime.now().plus({ days: 5 }).toISODate(),
            created_at: now,
            updated_at: now,
          },
          {
            resource_id: resourceIds[1],
            task_id: taskId,
            allocation_type: 'assigned',
            allocation_percent: 50.0,
            start_date: DateTime.now().toISODate(),
            end_date: DateTime.now().plus({ days: 5 }).toISODate(),
            created_at: now,
            updated_at: now,
          },
        ])

        if (tasks[1]) {
          await trx.table('resource_allocations').insert({
            resource_id: resourceIds[2],
            task_id: tasks[1].id,
            allocation_type: 'assigned',
            allocation_percent: 80.0,
            start_date: DateTime.now().toISODate(),
            end_date: DateTime.now().plus({ days: 10 }).toISODate(),
            created_at: now,
            updated_at: now,
          })
        }
      }
    })
  }
}
