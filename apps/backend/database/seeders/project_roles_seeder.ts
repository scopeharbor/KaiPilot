import { BaseSeeder } from '@adonisjs/lucid/seeders'
import hash from '@adonisjs/core/services/hash'
import { PROJECT_ROLE_TEMPLATES } from '#services/project_role_templates'
import { DateTime } from 'luxon'
import { insertReturningId } from '#database/support/insert_returning_id'

/**
 * 开发种子：sec11 项目级系统角色模板（design D3/D10，任务 8.1）。
 *
 * 模板取自 PROJECT_ROLE_TEMPLATES 单一事实来源，避免与 RBAC 注册表漂移。
 * project_roles 需 project_id 外键，故按依赖顺序原生插入：user → organization → project → 角色。
 * 仅 dev / test 环境运行；幂等（按 (project_id, name) 检查）。
 */

export default class extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const now = DateTime.now().toSQL({ includeOffset: false })!

    await this.client.transaction(async (trx) => {
      // 复用或创建所有者用户
      let owner = await trx.from('users').where('email', 'admin@aiproj.local').first()
      if (!owner) {
        const password = await hash.make('password123')
        const ownerId = await insertReturningId(trx, 'users', {
          full_name: '测试管理员',
          email: 'admin@aiproj.local',
          password,
          auth_provider: 'local',
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
        owner = { id: ownerId }
      }

      // 示范组织
      let org = await trx.from('organizations').where('slug', 'demo-org').first()
      if (!org) {
        const organizationId = await insertReturningId(trx, 'organizations', {
          owner_id: owner.id,
          name: '示范组织',
          slug: 'demo-org',
          plan_tier: 'free',
          created_at: now,
          updated_at: now,
        })
        org = { id: organizationId }
      }

      // 示范项目
      let project = await trx
        .from('projects')
        .where('organization_id', org.id)
        .where('code', 'DEMO')
        .first()
      if (!project) {
        const projectId = await insertReturningId(trx, 'projects', {
          organization_id: org.id,
          name: '示范项目',
          code: 'DEMO',
          created_by: owner.id,
          created_at: now,
          updated_at: now,
        })
        project = { id: projectId }
      }

      // sec11 系统角色模板（幂等：按 (project_id, name) 检查）
      for (const role of PROJECT_ROLE_TEMPLATES) {
        const exists = await trx
          .from('project_roles')
          .where('project_id', project.id)
          .where('name', role.name)
          .first()
        if (exists) continue

        await trx.table('project_roles').insert({
          project_id: project.id,
          name: role.name,
          description: role.description,
          // 原生插入需手动序列化 JSON（无模型 consume 钩子）
          permissions: JSON.stringify(role.permissions),
          is_system: 1,
          created_at: now,
          updated_at: now,
        })
      }
    })
  }
}
