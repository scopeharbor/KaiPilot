import { BaseSeeder } from '@adonisjs/lucid/seeders'
import hash from '@adonisjs/core/services/hash'
import { PROJECT_ROLE_TEMPLATES } from '#services/project_role_templates'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import {
  insertReturningId,
  normalizeBoolean,
  normalizeId,
} from '#database/support/insert_returning_id'

/**
 * 开发种子（design D10，任务 8.2）：
 * - 测试管理员 admin@aiproj.local + 默认组织 + organization_members(owner)；
 * - 系统管理员 superadmin@aiproj.local（is_super_admin=1，跨组织放行）；
 * - 组织成员角色示例：admin / member / viewer 各一（挂默认组织）。
 * 仅 dev / test 环境运行；幂等（按 email / (org,user) 检查，重复执行无冲突）。
 */
export default class extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const now = DateTime.now().toSQL({ includeOffset: false })!
    const password = await hash.make('password123')

    await this.client.transaction(async (trx) => {
      const ensureUser = async (
        email: string,
        fullName: string,
        isSuperAdmin = 0,
      ): Promise<number> => {
        const existing = await trx.from('users').where('email', email).first()
        if (existing) {
          const patch: Record<string, unknown> = {}
          if (existing.full_name !== fullName) patch.full_name = fullName
          if (!normalizeBoolean(existing.is_active)) patch.is_active = 1
          if (normalizeBoolean(existing.is_super_admin) !== normalizeBoolean(isSuperAdmin)) {
            patch.is_super_admin = isSuperAdmin
          }
          if (existing.role_version === null || existing.role_version === undefined) {
            patch.role_version = 0
          }
          if (Object.keys(patch).length > 0) {
            patch.updated_at = now
            await trx.from('users').where('id', existing.id).update(patch)
          }
          return existing.id
        }
        return insertReturningId(trx, 'users', {
          full_name: fullName,
          email,
          password,
          auth_provider: 'local',
          is_active: 1,
          is_super_admin: isSuperAdmin,
          role_version: 0,
          created_at: now,
          updated_at: now,
        })
      }

      const ownerId = await ensureUser('admin@aiproj.local', '测试管理员')
      await ensureUser('superadmin@aiproj.local', '系统管理员', 1)
      const adminId = await ensureUser('org-admin@aiproj.local', '组织管理员示例')
      const memberId = await ensureUser('org-member@aiproj.local', '组织成员示例')
      const viewerId = await ensureUser('org-viewer@aiproj.local', '组织访客示例')

      // 默认组织：dev/admin/e2e 测试用「完整权限管理员组织」——
      // 私有 SaaS 的 plan_tier 用 enterprise（套餐权益门控下，free 组织不授 SSO/KMS/DLP/合规等
      // 企业权限，会让依赖这些能力的既有测试与手册验证失效）。
      // 开源个人版没有企业能力，演示组织保持 free（v3-personal-edition-open-source-export 3.7）。
      let defaultPlanTier: string = 'free'
      let org = await trx.from('organizations').where('slug', 'default-org').first()
      if (!org) {
        const organizationId = await insertReturningId(trx, 'organizations', {
          owner_id: ownerId,
          name: '我的默认组织',
          slug: 'default-org',
          plan_tier: defaultPlanTier,
          max_projects: 10,
          max_members: 20,
          created_at: now,
          updated_at: now,
        })
        org = { id: organizationId }
      } else if (org.plan_tier !== defaultPlanTier) {
        // 幂等补齐：既有 dev DB 组织也按测试语义升档，避免套餐门控后管理员失权。
        await trx.from('organizations').where('id', org.id).update({
          plan_tier: defaultPlanTier,
          updated_at: now,
        })
        org.plan_tier = defaultPlanTier
      }

      // organization_members 角色示例（幂等：按 (org, user) 检查）
      const ensureMember = async (userId: number, role: string) => {
        const exists = await trx
          .from('organization_members')
          .where('organization_id', org.id)
          .where('user_id', userId)
          .first()
        if (exists) return
        await trx.table('organization_members').insert({
          organization_id: org.id,
          user_id: userId,
          role,
          created_at: now,
          updated_at: now,
        })
      }

      await ensureMember(ownerId, 'owner')
      await ensureMember(adminId, 'admin')
      await ensureMember(memberId, 'member')
      await ensureMember(viewerId, 'viewer')

      let project = await trx
        .from('projects')
        .where('organization_id', org.id)
        .where('code', 'DEMO')
        .first()
      if (!project) {
        const projectId = await insertReturningId(trx, 'projects', {
          organization_id: org.id,
          name: '演示项目',
          code: 'DEMO',
          description: '用于本机开发验证的项目管理演示资料。',
          status: 'active',
          priority: 'medium',
          start_date: '2026-07-01',
          end_date: '2026-08-15',
          currency: 'CNY',
          progress_percent: 25,
          health_status: 'green',
          created_by: ownerId,
          updated_by: ownerId,
          created_at: now,
          updated_at: now,
        })
        project = { id: projectId }
      }

      const roleIds = new Map<string, number>()
      for (const role of PROJECT_ROLE_TEMPLATES) {
        const existing = await trx
          .from('project_roles')
          .where('project_id', project.id)
          .where('name', role.name)
          .first()
        if (existing) {
          roleIds.set(role.name, existing.id)
          continue
        }
        const roleId = await insertReturningId(trx, 'project_roles', {
          project_id: project.id,
          name: role.name,
          description: role.description,
          permissions: JSON.stringify(role.permissions),
          is_system: 1,
          created_at: now,
          updated_at: now,
        })
        roleIds.set(role.name, roleId)
      }

      const ensureProjectMember = async (userId: number, roleName: string) => {
        const exists = await trx
          .from('project_members')
          .where('project_id', project.id)
          .where('user_id', userId)
          .first()
        const projectRoleId = roleIds.get(roleName) ?? null
        if (exists) {
          const patch: Record<string, unknown> = {}
          if (normalizeId(exists.project_role_id) !== normalizeId(projectRoleId)) {
            patch.project_role_id = projectRoleId
          }
          if (!normalizeBoolean(exists.is_active)) patch.is_active = 1
          if (Object.keys(patch).length > 0) {
            patch.updated_at = now
            await trx.from('project_members').where('id', exists.id).update(patch)
          }
          return
        }
        await trx.table('project_members').insert({
          project_id: project.id,
          user_id: userId,
          project_role_id: projectRoleId,
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
      }

      await ensureProjectMember(ownerId, ProjectRoleName.PROJECT_MANAGER)
      await ensureProjectMember(adminId, ProjectRoleName.PROJECT_MANAGER)
      await ensureProjectMember(memberId, ProjectRoleName.MEMBER)
      await ensureProjectMember(viewerId, ProjectRoleName.READONLY_OBSERVER)

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
          start_date: '2026-07-01',
          end_date: '2026-07-05',
          duration_days: 5,
          progress_percent: 0,
          is_critical_path: 0,
          is_on_longest_path: 0,
          assignee_id: memberId,
          reviewer_id: adminId,
          created_at: now,
          updated_at: now,
          ...overrides,
        }
        const existing = await trx
          .from('tasks')
          .where('project_id', project.id)
          .where('name', name)
          .whereNull('deleted_at')
          .first()
        if (existing) {
          await trx.from('tasks').where('id', existing.id).update(values)
          return existing.id
        }
        return insertReturningId(trx, 'tasks', values)
      }

      const charterTaskId = await ensureTask('项目章程确认', {
        status: 'completed',
        priority: 'high',
        start_date: '2026-07-01',
        end_date: '2026-07-03',
        duration_days: 3,
        progress_percent: 100,
        assignee_id: adminId,
      })
      const wbsTaskId = await ensureTask('WBS 分解与排期', {
        status: 'in_progress',
        priority: 'high',
        start_date: '2026-07-06',
        end_date: '2026-07-12',
        duration_days: 5,
        progress_percent: 45,
      })
      const ganttTaskId = await ensureTask('甘特图基线评审', {
        status: 'not_started',
        start_date: '2026-07-13',
        end_date: '2026-07-20',
        duration_days: 6,
      })
      await ensureTask('风险登记册初始化', {
        status: 'blocked',
        priority: 'medium',
        start_date: '2026-07-21',
        end_date: '2026-07-25',
        duration_days: 5,
      })

      const ensureResource = async (
        name: string,
        email: string,
        userId: number | null,
        role: string,
      ): Promise<number> => {
        const existing = await trx
          .from('resources')
          .where('project_id', project.id)
          .where('email', email)
          .first()
        if (existing) return existing.id
        return insertReturningId(trx, 'resources', {
          project_id: project.id,
          user_id: userId,
          name,
          email,
          resource_type: 'human',
          role,
          status: 'active',
          daily_capacity_hours: 8,
          skill_tags: JSON.stringify(['项目管理', '协作']),
          work_days: JSON.stringify([1, 2, 3, 4, 5]),
          timezone: 'Asia/Shanghai',
          created_at: now,
          updated_at: now,
        })
      }

      const adminResourceId = await ensureResource(
        '组织管理员示例',
        'org-admin@aiproj.local',
        adminId,
        'project_manager',
      )
      const memberResourceId = await ensureResource(
        '组织成员示例',
        'org-member@aiproj.local',
        memberId,
        'member',
      )

      const ensureAllocation = async (resourceId: number, taskId: number, percent: number) => {
        const existing = await trx
          .from('resource_allocations')
          .where('resource_id', resourceId)
          .where('task_id', taskId)
          .first()
        if (existing) return
        await trx.table('resource_allocations').insert({
          resource_id: resourceId,
          task_id: taskId,
          allocation_type: 'assigned',
          allocation_percent: percent,
          start_date: '2026-07-06',
          end_date: '2026-07-20',
          created_at: now,
          updated_at: now,
        })
      }

      await ensureAllocation(adminResourceId, charterTaskId, 50)
      await ensureAllocation(memberResourceId, wbsTaskId, 100)

      const ensureWbsNode = async (
        code: string,
        name: string,
        depth: number,
        parentId: number | null,
        displayOrder: number,
        taskId: number | null,
      ): Promise<number> => {
        const existing = await trx
          .from('wbs_nodes')
          .where('project_id', project.id)
          .where('code', code)
          .whereNull('deleted_at')
          .first()
        if (existing) return existing.id
        return insertReturningId(trx, 'wbs_nodes', {
          project_id: project.id,
          parent_id: parentId,
          path: null,
          code,
          name,
          depth,
          is_leaf: 1,
          collapsed: 0,
          task_id: taskId,
          display_order: displayOrder,
          created_at: now,
          updated_at: now,
        })
      }

      const rootId = await ensureWbsNode('1', '演示项目', 0, null, 0, null)
      const planningId = await ensureWbsNode('1.1', '启动与计划', 1, rootId, 0, null)
      const executionId = await ensureWbsNode('1.2', '执行与控制', 1, rootId, 1, null)
      await ensureWbsNode('1.1.1', '项目章程确认', 2, planningId, 0, charterTaskId)
      await ensureWbsNode('1.1.2', 'WBS 分解与排期', 2, planningId, 1, wbsTaskId)
      await ensureWbsNode('1.2.1', '甘特图基线评审', 2, executionId, 0, ganttTaskId)

      const wbsNodes = await trx
        .from('wbs_nodes')
        .where('project_id', project.id)
        .whereNull('deleted_at')
        .orderBy('depth', 'asc')
        .orderBy('display_order', 'asc')
        .orderBy('id', 'asc')
      const children = new Map<number | null, any[]>()
      for (const node of wbsNodes) {
        const key = node.parent_id === null ? null : Number(node.parent_id)
        const group = children.get(key) ?? []
        group.push(node)
        children.set(key, group)
      }
      const refreshWbs = async (
        parentId: number | null,
        parentPath: string,
        parentCode: string | null,
        depth: number,
      ) => {
        const group = children.get(parentId) ?? []
        for (const [index, node] of group.entries()) {
          const code = parentCode ? `${parentCode}.${index + 1}` : String(index + 1)
          const path = `${parentPath}${node.id}/`
          const isLeaf = (children.get(node.id) ?? []).length === 0 ? 1 : 0
          await trx.from('wbs_nodes').where('id', node.id).update({
            path,
            code,
            depth,
            display_order: index,
            is_leaf: isLeaf,
            updated_at: now,
          })
          await refreshWbs(node.id, path, code, depth + 1)
        }
      }
      await refreshWbs(null, '/', null, 0)
      await trx.from('projects').where('id', project.id).update({
        wbs_root_id: rootId,
        updated_at: now,
      })

      const aiConnection = await trx
        .from('ai_connections')
        .where('organization_id', org.id)
        .where('display_name', '停用模型测试样例')
        .first()
      if (!aiConnection) {
        await trx.table('ai_connections').insert({
          organization_id: org.id,
          display_name: '停用模型测试样例',
          protocol: 'openai_compatible',
          base_url: 'https://api.openai.com/v1',
          api_key_encrypted: null,
          model: 'gpt-5.4-mini',
          capabilities: JSON.stringify({
            supportsStrictSchema: true,
            supportsToolCalling: true,
            supportsStreamingToolCall: true,
          }),
          sync_state: 'disabled',
          is_active: 0,
          last_tested_at: null,
          created_at: now,
          updated_at: now,
        })
      }
      const storedAiConnection = await trx
        .from('ai_connections')
        .where('organization_id', org.id)
        .where('display_name', '停用模型测试样例')
        .first()
      if (storedAiConnection) {
        const aiConnectionModel = await trx
          .from('ai_connection_models')
          .where('connection_id', storedAiConnection.id)
          .where('model_name', 'gpt-5.4-mini')
          .first()
        if (!aiConnectionModel) {
          await trx.table('ai_connection_models').insert({
            connection_id: storedAiConnection.id,
            organization_id: org.id,
            model_name: 'gpt-5.4-mini',
            capabilities: JSON.stringify(['chat', 'project_draft']),
            rpm_limit: null,
            tpm_limit: null,
            is_active: 0,
            last_tested_at: null,
            created_at: now,
            updated_at: now,
          })
        }
      }
    })
  }
}
