// v2-5-typescript-sdk-core §6.2 —— compile-only consumer fixture。
//
// 从 workspace 导入 @aiproj/sdk 与 @aiproj/types，练习 project/task 方法 typings，
// 证明 SDK 公共 surface 类型自洽、对消费者可编译。本文件不发起任何真实请求：
// 仅做类型层面的方法签名/返回类型/错误类型核对。tsconfig include 覆盖本文件（非 *.test.ts），
// 故 `pnpm --filter @aiproj/sdk typecheck` 会编译它；vitest glob 不匹配，不作为测试运行。

import { AiprojClient, toQueryString } from '@aiproj/sdk'
import type {
  ApiErrorResponse,
  ApiListEnvelope,
  ApiNotificationDto,
  IdentityUserDto,
  OrganizationDto,
  ProjectDto,
  TaskDto,
  CreateProjectInput,
  CreateTaskInput,
} from '@aiproj/types'

export function buildConsumerClient(): AiprojClient {
  return new AiprojClient({
    baseUrl: 'http://localhost:3333/api/v1',
    tokenProvider: () => 'token',
    organizationContextProvider: () => 1,
  })
}

// 以下调用全部在类型层面校验方法签名与返回类型；运行时不会执行（buildConsumerClient 仅构造）。
export async function exerciseProjectTypings(
  client: AiprojClient,
  input: CreateProjectInput,
): Promise<ProjectDto | undefined> {
  const page = await client.projects.list({ page: 1, perPage: 20 })
  const listMeta: number = page.meta.total
  const listData: ProjectDto[] = page.data
  void listMeta
  void listData
  const got: ProjectDto | undefined = await client.projects.get(1)
  const created: ProjectDto | undefined = await client.projects.create(input)
  const updated: ProjectDto | undefined = await client.projects.update(1, { name: 'x' })
  const archived: ProjectDto | undefined = await client.projects.archive(1)
  const restored: ProjectDto | undefined = await client.projects.restore(1)
  const deleted: void = await client.projects.archiveOrDelete(1)
  void [got, created, updated, archived, restored, deleted]
  return got
}

export async function exerciseTaskTypings(
  client: AiprojClient,
  input: CreateTaskInput,
): Promise<TaskDto | undefined> {
  const page = await client.tasks.listForProject(2, { status: 'in_progress', sort: '+name' })
  const tasks: TaskDto[] = page.data
  void tasks
  const got: TaskDto | undefined = await client.tasks.get(2, 10)
  const created: TaskDto | undefined = await client.tasks.create(2, input)
  const updated: TaskDto | undefined = await client.tasks.update(2, 10, { progressPercent: 50 })
  const deleted: void = await client.tasks.delete(2, 10)
  void [created, updated, deleted]
  return got
}

export async function exerciseErrorTypings(client: AiprojClient): Promise<ApiErrorResponse | null> {
  try {
    await client.rawRequest('/api/v1/projects')
  } catch (e) {
    const err = e as ApiErrorResponse
    const code: string = err.code
    const status: number = err.status
    void [code, status]
    return err
  }
  return null
}

export function exerciseQueryTypings(): string {
  // toQueryString 导出且类型自洽
  return toQueryString({ page: 1, include: ['a', 'b'] })
}

export async function exerciseFullApiTypings(client: AiprojClient): Promise<void> {
  const me = await client.api.identity.authMe!<IdentityUserDto>()
  const orgs = await client.api.organization.organizationsIndex!<OrganizationDto>()
  const reports = await client.api['collaboration-reporting'].projectsReportsIndex!<
    ApiListEnvelope<{ id: number }>
  >({ path: { projectId: 1 }, query: { page: 1 } })
  const notifications = await client.api['collaboration-reporting'].notificationsIndex!<
    ApiListEnvelope<ApiNotificationDto>
  >({ query: { page: 1 } })
  const compiler = await client.api['ai-compiler-integration'].compilerRunsShow!({
    path: { id: 1 },
  })
  void [me, orgs, reports, notifications, compiler]
}
