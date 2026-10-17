// v2-5-typescript-sdk-core —— 任务 client（design D5）。
//
// 仅实现 parity-verified /api/v1 project/task 路由：
//   GET    /projects/:projectId/tasks             listForProject
//   POST   /projects/:projectId/tasks             create
//   GET    /projects/:projectId/tasks/:taskId     get
//   PATCH  /projects/:projectId/tasks/:taskId     update
//   DELETE /projects/:projectId/tasks/:taskId     delete
// 路径来自 docs/v1/api/.endpoints-baseline.json parity gate；不新增路由。

import type { CreateTaskInput, ListTasksQuery, TaskDto, UpdateTaskInput } from '@aiproj/types'
import type { AiprojClientConfig } from './transport.js'
import { requestList, requestResource } from './transport.js'
import { toQueryString } from './query.js'

function taskListQuery(params: ListTasksQuery = {}): string {
  return toQueryString({
    status: params.status,
    priority: params.priority,
    assigneeId: params.assigneeId,
    search: params.search,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    sort: params.sort,
    page: params.page,
    perPage: params.perPage,
  })
}

export function createTasksClient(config: AiprojClientConfig) {
  return {
    /** GET /projects/:projectId/tasks —— 项目内任务列表（分页/过滤/排序）。 */
    listForProject(projectId: number, params: ListTasksQuery = {}) {
      return requestList<TaskDto>(config, `/projects/${projectId}/tasks`, {
        query: taskListQuery(params),
      })
    },
    /** GET /projects/:projectId/tasks/:taskId —— 任务详情。 */
    get(projectId: number, taskId: number) {
      return requestResource<TaskDto>(config, `/projects/${projectId}/tasks/${taskId}`)
    },
    /** POST /projects/:projectId/tasks —— 创建任务（projectId 取自路由）。 */
    create(projectId: number, input: CreateTaskInput) {
      return requestResource<TaskDto>(config, `/projects/${projectId}/tasks`, {
        method: 'POST',
        body: input,
      })
    },
    /** PATCH /projects/:projectId/tasks/:taskId —— 部分更新。 */
    update(projectId: number, taskId: number, input: UpdateTaskInput) {
      return requestResource<TaskDto>(config, `/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: input,
      })
    },
    /** DELETE /projects/:projectId/tasks/:taskId —— 删除（204 → undefined）。 */
    delete(projectId: number, taskId: number) {
      return requestResource<void>(config, `/projects/${projectId}/tasks/${taskId}`, {
        method: 'DELETE',
      })
    },
  }
}

export type TasksClient = ReturnType<typeof createTasksClient>
