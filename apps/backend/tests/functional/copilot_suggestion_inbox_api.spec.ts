// 收件箱端到端：真实信号 → 刷新聚合 → 查询带回源正文 → 已读 → 采纳生成草案会话。
//
// 此前收件箱在浏览器里不可用（前端裸 fetch 不带令牌），且查询只返回引用元数据、
// 看不到建议内容。本 spec 锁定修复后的完整链路与权限边界：
// - 刷新把 open 信号聚合进收件箱；查询返回 `content`（标题 / 读数摘要），不写回表；
// - mark_read → adopt 成功并返回草案会话 id，状态落库；
// - 无 `resource:view` 的只读观察者看得到条目但正文为 null（fail-closed）；
// - 跨组织查询看不到条目。
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import ProjectSignal from '#models/project_signal'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const API_PREFIX = '/api/v1'
const INBOX = `${API_PREFIX}/copilot-suggestion-inbox`

async function login(client: any, user: any): Promise<string> {
  const res = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

function authed(client: any, token: string, orgId: number) {
  return {
    get: (url: string) =>
      client
        .get(url)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(orgId)),
    post: (url: string) =>
      client
        .post(url)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(orgId)),
  }
}

async function seedResourceOverloadSignal(
  organizationId: number,
  projectId: number,
  userId: number,
) {
  return ProjectSignal.create({
    organizationId,
    projectId,
    signalType: 'resource_overload',
    confidenceTier: 'low',
    tierReasons: {},
    severity: 'warning',
    evidence: {
      metric: 'resource_overload_ratio',
      window: {
        from: '2026-09-01',
        to: '2026-09-07',
        previousFrom: '2026-08-25',
        previousTo: '2026-08-31',
        days: 7,
      },
      readings: { overloadRatioPercent: 50, overloadedResourceCount: 2 },
      thresholds: { ratioPercent: 25 },
      coveredCycles: 2,
      hitConditions: [],
      compositeTypes: ['resource_overload'],
      entityRefs: {},
      truncated: false,
    },
    idempotencyKey: `inbox-e2e-${Math.random()}`.padEnd(64, '0').slice(0, 64),
    observationWindow: '2026-09-01..2026-09-07',
    // 用相对当前时间的有效期：写死日期会随日历腐烂，适配器只取未过期信号。
    expiresAt: DateTime.now().plus({ days: 14 }),
    status: 'open',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: userId,
    deletedAt: null,
  })
}

test.group('Copilot 建议收件箱 API 端到端', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('inbox-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    await seedResourceOverloadSignal(Number(org.id), Number(project.id), Number(owner.id))
    return { owner, org, project, token }
  }

  test('刷新聚合信号，查询带回源正文；已读后采纳生成草案会话', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const refresh = await api.post(`${INBOX}/refresh`).json({ projectId: Number(project.id) })
    refresh.assertStatus(200)
    assert.equal(refresh.body().data.created, 1)
    assert.deepEqual(refresh.body().data.missingSources, [])

    const list = await api.get(`${INBOX}?projectId=${project.id}&perPage=100`)
    list.assertStatus(200)
    const entries = list.body().data.entries
    assert.lengthOf(entries, 1)
    const [entry] = entries
    assert.equal(entry.state, 'unread')
    assert.equal(entry.sourceRefs[0].sourceKind, 'smart_recommendation')
    assert.equal(entry.content.title, '资源负载过载（观测窗 2026-09-01..2026-09-07）')
    assert.include(entry.content.summary, 'overloadRatioPercent=50')
    assert.include(entry.content.summary, '阈值 ratioPercent=25')

    const unread = await api.get(`${INBOX}/unread-count?projectId=${project.id}`)
    unread.assertStatus(200)
    assert.equal(unread.body().data.unreadCount, 1)

    // 未读直接采纳被状态机拒绝
    const early = await api.post(`${INBOX}/${entry.id}/action`).json({ action: 'adopt' })
    early.assertStatus(400)

    const read = await api.post(`${INBOX}/${entry.id}/action`).json({ action: 'mark_read' })
    read.assertStatus(200)
    assert.equal(read.body().data.newState, 'read')

    const adopt = await api.post(`${INBOX}/${entry.id}/action`).json({ action: 'adopt' })
    adopt.assertStatus(200)
    assert.equal(adopt.body().data.newState, 'adopted')
    assert.isString(adopt.body().data.previewSessionId)

    const after = await api.get(`${INBOX}?projectId=${project.id}`)
    assert.equal(after.body().data.entries[0].state, 'adopted')

    // 再次刷新不复活终态条目
    const again = await api.post(`${INBOX}/refresh`).json({ projectId: Number(project.id) })
    again.assertStatus(200)
    assert.equal(again.body().data.created, 0)
  })

  test('无 resource:view 的观察者看得到条目但正文为 null', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    await authed(client, token, Number(org.id))
      .post(`${INBOX}/refresh`)
      .json({ projectId: Number(project.id) })
      .then((res: any) => res.assertStatus(200))

    const viewer = await createUser({ email: uniqueEmail('inbox-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    const role = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: '只读观察者',
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: role.id,
      isActive: true,
    })
    const viewerToken = await login(client, viewer)

    const list = await authed(client, viewerToken, Number(org.id)).get(
      `${INBOX}?projectId=${project.id}`,
    )
    list.assertStatus(200)
    const entries = list.body().data.entries
    assert.lengthOf(entries, 1)
    assert.isNull(entries[0].content)
    assert.notInclude(list.text(), 'overloadRatioPercent')
  })

  test('跨组织查询看不到条目', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    await authed(client, token, Number(org.id))
      .post(`${INBOX}/refresh`)
      .json({ projectId: Number(project.id) })
      .then((res: any) => res.assertStatus(200))

    const outsider = await createUser({ email: uniqueEmail('inbox-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const outsiderToken = await login(client, outsider)
    const list = await authed(client, outsiderToken, Number(outsiderOrg.id)).get(INBOX)
    list.assertStatus(200)
    assert.lengthOf(list.body().data.entries, 0)
  })
})
