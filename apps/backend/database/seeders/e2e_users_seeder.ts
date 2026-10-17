import { BaseSeeder } from '@adonisjs/lucid/seeders'
import hash from '@adonisjs/core/services/hash'
import { PROJECT_ROLE_TEMPLATES } from '#services/project_role_templates'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import { insertReturningId } from '#database/support/insert_returning_id'

export default class extends BaseSeeder {
  static environment = ['development']

  async run() {
    const now = DateTime.now().toSQL({ includeOffset: false })!
    const password = await hash.make('Passw0rd!')

    await this.client.transaction(async (trx) => {
      let user = await trx.from('users').where('email', 'admin@test.local').first()
      if (user) {
        await trx
          .from('users')
          .where('id', user.id)
          .update({
            full_name: 'E2E Admin',
            password,
            is_active: 1,
            is_super_admin: 0,
            role_version: user.role_version ?? 0,
            updated_at: now,
          })
      } else {
        const userId = await insertReturningId(trx, 'users', {
          full_name: 'E2E Admin',
          email: 'admin@test.local',
          password,
          auth_provider: 'local',
          is_active: 1,
          is_super_admin: 0,
          role_version: 0,
          created_at: now,
          updated_at: now,
        })
        user = { id: userId }
      }

      const org = await trx.from('organizations').where('slug', 'default-org').first()
      if (!org) return

      const organizationMember = await trx
        .from('organization_members')
        .where('organization_id', org.id)
        .where('user_id', user.id)
        .first()
      if (organizationMember) {
        await trx.from('organization_members').where('id', organizationMember.id).update({
          role: 'owner',
          updated_at: now,
        })
      } else {
        await trx.table('organization_members').insert({
          organization_id: org.id,
          user_id: user.id,
          role: 'owner',
          created_at: now,
          updated_at: now,
        })
      }

      const project = await trx
        .from('projects')
        .where('organization_id', org.id)
        .where('code', 'DEMO')
        .first()
      if (!project) return

      await trx.from('projects').where('id', project.id).update({
        status: 'active',
        deleted_at: null,
        created_at: now,
        updated_at: now,
      })

      for (const template of PROJECT_ROLE_TEMPLATES) {
        const role = await trx
          .from('project_roles')
          .where('project_id', project.id)
          .where('name', template.name)
          .first()
        if (role) continue

        await trx.table('project_roles').insert({
          project_id: project.id,
          name: template.name,
          description: template.description,
          permissions: JSON.stringify(template.permissions),
          is_system: 1,
          created_at: now,
          updated_at: now,
        })
      }

      const managerRole = await trx
        .from('project_roles')
        .where('project_id', project.id)
        .where('name', ProjectRoleName.PROJECT_MANAGER)
        .first()
      if (!managerRole) return

      const projectMember = await trx
        .from('project_members')
        .where('project_id', project.id)
        .where('user_id', user.id)
        .first()
      if (projectMember) {
        await trx.from('project_members').where('id', projectMember.id).update({
          project_role_id: managerRole.id,
          is_active: 1,
          updated_at: now,
        })
      } else {
        await trx.table('project_members').insert({
          project_id: project.id,
          user_id: user.id,
          project_role_id: managerRole.id,
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
      }
    })
  }
}
