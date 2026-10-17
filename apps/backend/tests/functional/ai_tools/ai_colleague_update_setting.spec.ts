// AI 同事：用自然语言改设置（两阶段确认 + 审计）——真实 SQLite。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { ConflictException, PermissionDeniedException } from '#exceptions/api_exception'
import AuditLog from '#models/audit_log'
import Project from '#models/project'
import type User from '#models/user'
import AiToolsExecutorService from '#services/ai_tools/ai_tools_executor_service'
import { createUpdateSettingTool } from '#services/ai_tools/handlers/index'
import { normalizePlannedActions } from '#services/ai_colleague/action_planner_service'
import SettingsCatalogService from '#services/settings_catalog/settings_catalog_service'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function setup(label: string) {
  const me = await createUser({ email: uniqueEmail(label), fullName: '赵经理' })
  const org = await createOrganization(me)
  const { project } = await createProjectWithMember(org, me, me, ProjectRoleName.PROJECT_MANAGER)
  return { me, org, project }
}

function ctx(user: User, organizationId: number, projectId?: number) {
  return { user, organizationId, requestId: 'setting-test', projectId: projectId ?? null }
}

test.group('AI 同事：改设置', (group) => {
  useAuthDatabase(group)

  test('预览零写入、给出改前改后；确认后落库并记审计（经执行器全链路）', async ({ assert }) => {
    const { me, org, project } = await setup('setting-ok')
    const executor = await app.container.make(AiToolsExecutorService)
    const parameters = { key: 'project.name', value: '新官网改版', projectId: project.id }
    const before = project.name
    const preview = await executor.execute({
      toolName: 'update_setting',
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'setting-ok',
    })
    assert.equal(preview.meta.status, 'PREVIEW_REQUIRED')
    assert.deepInclude(preview.data as object, {
      key: 'project.name',
      beforeText: before,
      afterText: '新官网改版',
      noop: false,
    })
    assert.notProperty(preview.data as object, 'previewToken')
    const untouched = await Project.findOrFail(project.id)
    assert.equal(untouched.name, before)

    const committed = await executor.confirm({
      toolName: 'update_setting',
      previewToken: String(preview.previewToken),
      parameters,
      user: me,
      organizationId: org.id,
      requestId: 'setting-ok',
    })
    assert.isTrue(committed.meta.committed)
    const renamed = await Project.findOrFail(project.id)
    assert.equal(renamed.name, '新官网改版')

    const audits = await AuditLog.query().where('organization_id', org.id)
    const audit = audits.find((row) => row.metadata?.event === 'AI_SETTING_CHANGED')!
    assert.exists(audit)
    assert.deepInclude(audit.metadata ?? {}, {
      key: 'project.name',
      source: 'ai-colleague',
      confirmedByUser: true,
    })
  })

  test('个人设置：休假新增与曆法；预览后被改过 → 409 不写入', async ({ assert }) => {
    const { me, org } = await setup('setting-personal')
    const tool = createUpdateSettingTool()
    const leave = { startDate: '2030-02-01', endDate: '2030-02-03', note: '春节' }
    const preview = await tool.handler(ctx(me, org.id), { key: 'personal.leave.add', value: leave })
    assert.equal(preview.status, 'PREVIEW_REQUIRED')
    assert.include(String((preview.data as { afterText: string }).afterText), '2030-02-01')
    const done = await tool.handler(ctx(me, org.id), {
      key: 'personal.leave.add',
      value: leave,
      previewToken: preview.previewToken!,
    })
    assert.equal(done.status, 'SUCCESS')

    const systems = await tool.handler(ctx(me, org.id), {
      key: 'calendar.systems.personal',
      value: ['lunar', 'jieqi'],
    })
    // 预览后别处又改了一次 → 旧令牌作废
    const catalog = await app.container.make(SettingsCatalogService)
    const other = await catalog.preview(ctx(me, org.id), 'calendar.systems.personal', ['solar'])
    await catalog.apply(ctx(me, org.id), 'calendar.systems.personal', ['solar'], other.previewToken)
    await assert.rejects(
      () =>
        tool.handler(ctx(me, org.id), {
          key: 'calendar.systems.personal',
          value: ['lunar', 'jieqi'],
          previewToken: systems.previewToken!,
        }),
      ConflictException as never,
    )
  })

  test('组织设置需要组织管理权限；模型看不到真实姓名', async ({ assert }) => {
    const { org } = await setup('setting-org')
    const member = await createUser({ email: uniqueEmail('setting-member'), fullName: '王小明' })
    const { default: OrganizationMember } = await import('#models/organization_member')
    await OrganizationMember.create({ organizationId: org.id, userId: member.id, role: 'member' })
    const tool = createUpdateSettingTool()
    await assert.rejects(
      () => tool.handler(ctx(member, org.id), { key: 'organization.name', value: '别的名字' }),
      PermissionDeniedException as never,
    )

    const catalog = await app.container.make(SettingsCatalogService)
    const rows = await catalog.listForPlanner(ctx(member, org.id))
    assert.notInclude(JSON.stringify(rows), '王小明')
    assert.isFalse(rows.find((row) => row.key === 'organization.name')!.writable)
    assert.isTrue(rows.find((row) => row.key === 'personal.leave.add')!.writable)
    // 不在项目里：项目设置不出现
    assert.isUndefined(rows.find((row) => row.key === 'project.name'))
  })

  test('操作理解：key 只认目录里的、可写的；项目设置要有项目', ({ assert }) => {
    const settings = [
      {
        key: 'personal.leave.add',
        label: '我的休假（新增一段）',
        layer: 'personal' as const,
        current: '没有休假',
        valueHint: '',
        writable: true,
      },
      {
        key: 'organization.name',
        label: '组织名称',
        layer: 'organization' as const,
        current: '测试组织',
        valueHint: '',
        writable: false,
      },
      {
        key: 'project.name',
        label: '项目名称',
        layer: 'project' as const,
        current: '官网',
        valueHint: '',
        writable: true,
      },
    ]
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          {
            action: 'change_setting',
            key: 'personal.leave.add',
            value: { startDate: '2030-02-01', endDate: '2030-02-03' },
          },
          { action: 'change_setting', key: 'organization.name', value: '新名字' },
          { action: 'change_setting', key: 'user.password', value: 'x' },
          { action: 'change_setting', key: 'project.name', value: '新官网' },
        ],
      },
      { projectId: null, tasks: [], settings },
    )
    assert.deepEqual(
      plan.actions.map((action) => [action.toolName, action.parameters]),
      [
        [
          'update_setting',
          {
            key: 'personal.leave.add',
            value: { startDate: '2030-02-01', endDate: '2030-02-03' },
          },
        ],
      ],
    )
    assert.include(plan.actions[0]!.summary, '改前改后')
    assert.lengthOf(plan.rejected, 3)

    const inProject = normalizePlannedActions(
      {
        isAction: true,
        actions: [{ action: 'change_setting', key: 'project.name', value: '新官网' }],
      },
      { projectId: 9, tasks: [], settings },
    )
    assert.deepEqual(inProject.actions[0]!.parameters, {
      key: 'project.name',
      value: '新官网',
      projectId: 9,
    })
  })
})
