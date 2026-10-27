/**
 * 记忆维基功能测试公用装配：双组织、多角色、项目成员、开关、正文构造。
 */
import { DateTime } from 'luxon'
import type Organization from '#models/organization'
import type Project from '#models/project'
import Risk from '#models/risk'
import Task from '#models/task'
import type User from '#models/user'
import { ProjectRoleName } from '#start/rbac/roles'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  orgBearer,
} from '../auth/_helpers.js'

export const API = '/api/v1/wiki'

export interface WikiWorld {
  org: Organization
  otherOrg: Organization
  admin: User
  member: User
  viewer: User
  pm: User
  outsider: User
  project: Project
  task: Task
  risk: Risk
  auth: Record<'admin' | 'member' | 'viewer' | 'pm' | 'outsider', string>
}

export async function enableWiki(org: Organization) {
  org.settings = { ...(org.settings ?? {}), wikiMemoryEnabled: true }
  await org.save()
}

/** 组织 A：管理员 / 普通成员 / 只读观察者 / 项目经理（成员 + 项目 PM）；组织 B：外部用户。 */
export async function buildWorld(): Promise<WikiWorld> {
  const admin = await createUser()
  const org = await createOrganization(admin)
  const member = await createUser()
  const viewer = await createUser()
  const pm = await createUser()
  await addOrgMember(org, member, 'member')
  await addOrgMember(org, viewer, 'viewer')
  await addOrgMember(org, pm, 'member')
  const { project } = await createProjectWithMember(org, admin, pm, ProjectRoleName.PROJECT_MANAGER)

  const outsider = await createUser()
  const otherOrg = await createOrganization(outsider)
  await enableWiki(org)
  await enableWiki(otherOrg)

  const task = await Task.create({
    projectId: project.id,
    name: '支付联调',
    status: 'not_started',
    taskType: 'task',
    priority: 'medium',
  } as never)
  const risk = await Risk.create({
    organizationId: org.id,
    projectId: project.id,
    title: '第三方证书延误',
    description: '证书申请周期不确定',
    category: 'technical',
    probability: 3,
    impact: 4,
    score: 12,
    status: 'identified',
    identifiedAt: DateTime.now(),
    createdBy: admin.id,
  } as never)

  return {
    org,
    otherOrg,
    admin,
    member,
    viewer,
    pm,
    outsider,
    project,
    task,
    risk,
    auth: {
      admin: await orgBearer(admin, org.id),
      member: await orgBearer(member, org.id),
      viewer: await orgBearer(viewer, org.id),
      pm: await orgBearer(pm, org.id),
      outsider: await orgBearer(outsider, otherOrg.id),
    },
  }
}

export function pageBody(opts: {
  title: string
  type?: string
  summary?: string
  lines?: string[]
  extraFrontmatter?: string[]
}): string {
  return [
    '---',
    `type: ${opts.type ?? 'concept'}`,
    `title: ${opts.title}`,
    `summary: ${opts.summary ?? `${opts.title}的说明`}`,
    ...(opts.extraFrontmatter ?? []),
    '---',
    '## 内容',
    ...(opts.lines ?? ['- 暂无主张。']),
  ].join('\n')
}

export async function resolveSpace(
  client: any,
  bearer: string,
  scopeKind: string,
  scopeRefId?: number,
) {
  return client
    .post(`${API}/spaces/resolve`)
    .header('authorization', bearer)
    .json(scopeRefId === undefined ? { scopeKind } : { scopeKind, scopeRefId })
}

export async function createPage(
  client: any,
  bearer: string,
  spaceId: number,
  slug: string,
  body: string,
) {
  return client
    .post(`${API}/spaces/${spaceId}/pages`)
    .header('authorization', bearer)
    .json({ slug, body })
}

/** 等待请求并断言状态码（避免 `(await x).assertStatus()` 写法）。 */
export async function expectStatus(request: Promise<any> | any, status: number) {
  const res = await request
  res.assertStatus(status)
  return res
}

/** 等待请求并取 body().data。 */
export async function dataOf(request: Promise<any> | any) {
  const res = await request
  return res.body().data
}
