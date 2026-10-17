import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { CanonicalRole, ProjectRoleName, ROLE_PERMISSIONS } from '#rbac'
import { normalizeBoolean } from '#database/support/insert_returning_id'

/**
 * 任务 8.3 — 种子数据可导入 + 幂等 + 角色权限串与 sec11 矩阵一致。
 * 验证 db:seed：测试/系统管理员 + 组织成员角色示例 + 示范项目 + 5 个 sec11 系统角色模板。
 */
test.group('种子数据', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('db:seed 导入完整开发基础数据', async ({ assert }) => {
    await testUtils.db().seed()

    const admin = await db.from('users').where('email', 'admin@aiproj.local').first()
    assert.isOk(admin, '测试管理员用户应存在')

    // 系统管理员（is_super_admin=1）。布尔列 SQLite 回 0/1、PostgreSQL 回 true/false，统一归一后断言
    const superAdmin = await db.from('users').where('email', 'superadmin@aiproj.local').first()
    assert.isOk(superAdmin, '系统管理员用户应存在')
    assert.isTrue(normalizeBoolean(superAdmin.is_super_admin), 'superadmin 应 is_super_admin=1')

    const defaultOrg = await db.from('organizations').where('slug', 'default-org').first()
    assert.isOk(defaultOrg, '默认组织应存在')

    const demoOrg = await db.from('organizations').where('slug', 'demo-org').first()
    assert.isOk(demoOrg, '示范组织应存在')

    // 组织成员角色示例：owner/admin/member/viewer 各一
    const members = await db.from('organization_members').where('organization_id', defaultOrg.id)
    const roles = members.map((m: any) => m.role).sort()
    assert.deepEqual(roles, ['admin', 'member', 'owner', 'viewer'], '四种组织角色示例应齐备')

    const defaultProject = await db
      .from('projects')
      .where('organization_id', defaultOrg.id)
      .where('code', 'DEMO')
      .first()
    assert.isOk(defaultProject, '默认组织演示项目应存在')

    const defaultProjectMembers = await db
      .from('project_members')
      .where('project_id', defaultProject.id)
    assert.equal(defaultProjectMembers.length, 4, '默认演示项目成员应齐备')

    const wbsNodes = await db.from('wbs_nodes').where('project_id', defaultProject.id)
    assert.isAtLeast(wbsNodes.length, 3, '默认演示项目 WBS 节点应恢复')
    assert.isOk(
      wbsNodes.find((node: any) => node.code === '1'),
      '默认演示项目 WBS 根节点应恢复',
    )

    const aiConnection = await db
      .from('ai_connections')
      .where('organization_id', defaultOrg.id)
      .where('display_name', '停用模型测试样例')
      .first()
    assert.isOk(aiConnection, '默认组织 AI 模型连接样例应恢复')
    assert.isFalse(normalizeBoolean(aiConnection.is_active), 'AI 模型连接样例默认停用')

    const demoProject = await db
      .from('projects')
      .where('organization_id', demoOrg.id)
      .where('code', 'DEMO')
      .first()
    assert.isOk(demoProject, '示范项目应存在')

    const projectRoles = await db.from('project_roles').where('project_id', demoProject.id)
    assert.equal(projectRoles.length, 5, '应导入 5 个 sec11 系统角色模板')
    assert.isTrue(
      projectRoles.every((r: any) => normalizeBoolean(r.is_system)),
      '5 个角色均应为系统角色',
    )

    // 角色名对齐 sec11
    const names = projectRoles.map((r: any) => r.name).sort()
    assert.deepEqual(
      names,
      [
        ProjectRoleName.EXTERNAL_COLLABORATOR,
        ProjectRoleName.MEMBER,
        ProjectRoleName.OWNER,
        ProjectRoleName.PROJECT_MANAGER,
        ProjectRoleName.READONLY_OBSERVER,
      ].sort(),
      '角色名应对齐 sec11',
    )

    // 权限串与中央矩阵一致（以 Member 为例）
    const memberRole = projectRoles.find((r: any) => r.name === ProjectRoleName.MEMBER)
    // PostgreSQL 的 json 列回传已解析的值，SQLite 回传文本
    const parsed =
      typeof memberRole.permissions === 'string'
        ? JSON.parse(memberRole.permissions)
        : memberRole.permissions
    assert.deepEqual(
      parsed.sort(),
      [...ROLE_PERMISSIONS[CanonicalRole.MEMBER]].sort(),
      'Member 权限串应与 ROLE_PERMISSIONS 矩阵一致',
    )
  })

  test('幂等：重复 seed 无主键/唯一冲突', async ({ assert }) => {
    await testUtils.db().seed()
    await testUtils.db().seed()

    const admins = await db.from('users').where('email', 'admin@aiproj.local')
    assert.equal(admins.length, 1, 'admin 用户不应重复')

    const demoProject = await db.from('projects').where('code', 'DEMO').first()
    const roles = await db.from('project_roles').where('project_id', demoProject.id)
    assert.equal(roles.length, 5, '重复 seed 不应产生重复角色')

    const defaultOrg = await db.from('organizations').where('slug', 'default-org').first()
    const members = await db.from('organization_members').where('organization_id', defaultOrg.id)
    assert.equal(members.length, 4, '重复 seed 不应产生重复组织成员')

    const defaultProjects = await db
      .from('projects')
      .where('organization_id', defaultOrg.id)
      .where('code', 'DEMO')
    assert.equal(defaultProjects.length, 1, '重复 seed 不应产生重复默认演示项目')

    const aiConnections = await db
      .from('ai_connections')
      .where('organization_id', defaultOrg.id)
      .where('display_name', '停用模型测试样例')
    assert.equal(aiConnections.length, 1, '重复 seed 不应产生重复 AI 连接样例')
  })
})
