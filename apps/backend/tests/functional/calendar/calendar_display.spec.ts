// 日历曆法显示设定：个人 > 项目 > 组织 > 系统默认；各层写入按权限；清除即继承上层。
import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  orgBearer,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('日历曆法显示设定（三层）', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('cal-owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('cal-member') })
    await addOrgMember(org, member, 'member')
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const ownerAuth = await orgBearer(owner, org.id)
    const memberAuth = await orgBearer(member, org.id)
    return { owner, org, member, project, ownerAuth, memberAuth }
  }

  test('未设定 → 系统默认：公历为主', async ({ client, assert }) => {
    const { ownerAuth } = await setup()
    const res = await client
      .get('/api/v1/settings/calendar-display')
      .header('Authorization', ownerAuth)
    res.assertStatus(200)
    const data = res.body().data
    assert.equal(data.source, 'default')
    assert.equal(data.primary, 'solar')
    assert.deepEqual(data.systems, ['solar', 'lunar', 'jieqi', 'festival', 'holiday'])
    assert.isTrue(data.editable.personal)
    assert.isTrue(data.editable.organization)
  })

  test('优先序：个人 > 项目 > 组织；清除个人后回到项目', async ({ client, assert }) => {
    const { ownerAuth, project } = await setup()
    const put = (body: Record<string, unknown>) =>
      client.put('/api/v1/settings/calendar-display').header('Authorization', ownerAuth).json(body)

    const r1 = await put({ layer: 'organization', systems: ['lunar', 'solar'] })
    r1.assertStatus(200)
    const r2 = await put({
      layer: 'project',
      projectId: project.id,
      systems: ['hijri', 'solar', 'phase'],
    })
    r2.assertStatus(200)
    const personal = await put({
      layer: 'personal',
      projectId: project.id,
      // 只能当标注的排第一：主曆取下一个可当主曆的
      systems: ['jieqi', 'tibetan', 'solar'],
    })
    personal.assertStatus(200)
    assert.equal(personal.body().data.source, 'personal')
    assert.equal(personal.body().data.primary, 'tibetan')

    const cleared = await put({ layer: 'personal', projectId: project.id, systems: null })
    assert.equal(cleared.body().data.source, 'project')
    assert.equal(cleared.body().data.primary, 'hijri')

    // 不带项目：项目层不参与，落到组织
    const orgOnly = await client
      .get('/api/v1/settings/calendar-display')
      .header('Authorization', ownerAuth)
    assert.equal(orgOnly.body().data.source, 'organization')
    assert.equal(orgOnly.body().data.primary, 'lunar')
  })

  test('权限：普通成员可改个人，不能改组织与无权项目；非法曆法 422', async ({ client, assert }) => {
    const { memberAuth, project } = await setup()
    const put = (body: Record<string, unknown>) =>
      client.put('/api/v1/settings/calendar-display').header('Authorization', memberAuth).json(body)

    const r3 = await put({ layer: 'personal', systems: ['solar', 'hijri'] })
    r3.assertStatus(200)
    const r4 = await put({ layer: 'organization', systems: ['lunar'] })
    r4.assertStatus(403)
    const projectRes = await put({ layer: 'project', projectId: project.id, systems: ['lunar'] })
    assert.oneOf(projectRes.status(), [403, 404])
    const r5 = await put({ layer: 'personal', systems: ['mayan'] })
    r5.assertStatus(422)

    const res = await client
      .get('/api/v1/settings/calendar-display')
      .header('Authorization', memberAuth)
    assert.equal(res.body().data.source, 'personal')
    assert.isFalse(res.body().data.editable.organization)
  })
})
