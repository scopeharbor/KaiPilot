// v2-5-typescript-sdk-core —— 项目 client（design D5）。
//
// 仅实现 parity-verified /api/v1 project 路由：
//   GET    /projects            list
//   POST   /projects            create
//   GET    /projects/:id        get
//   PATCH  /projects/:id        update
//   DELETE /projects/:id        archiveOrDelete（archive 路由亦提供，见 restore/archive）
//   POST   /projects/:id/archive
//   POST   /projects/:id/restore
// 不新增路由；路径来自 docs/v1/api/.endpoints-baseline.json parity gate。

import type {
  CreateProjectInput,
  ListProjectsQuery,
  ProjectDto,
  UpdateProjectInput,
} from '@aiproj/types'
import type { AiprojClientConfig } from './transport.js'
import { requestList, requestResource } from './transport.js'
import { toQueryString } from './query.js'

function projectListQuery(params: ListProjectsQuery = {}): string {
  return toQueryString({
    status: params.status,
    priority: params.priority,
    search: params.search,
    sort: params.sort,
    page: params.page,
    perPage: params.perPage,
    includeArchived: params.includeArchived,
  })
}

export function createProjectsClient(config: AiprojClientConfig) {
  return {
    /** GET /projects —— 列表（分页）。 */
    list(params: ListProjectsQuery = {}) {
      return requestList<ProjectDto>(config, '/projects', { query: projectListQuery(params) })
    },
    /** GET /projects/:id —— 详情。 */
    get(id: number) {
      return requestResource<ProjectDto>(config, `/projects/${id}`)
    },
    /** POST /projects —— 创建。 */
    create(input: CreateProjectInput) {
      return requestResource<ProjectDto>(config, '/projects', { method: 'POST', body: input })
    },
    /** PATCH /projects/:id —— 部分更新。 */
    update(id: number, input: UpdateProjectInput) {
      return requestResource<ProjectDto>(config, `/projects/${id}`, {
        method: 'PATCH',
        body: input,
      })
    },
    /** POST /projects/:id/archive —— 归档。 */
    archive(id: number) {
      return requestResource<ProjectDto>(config, `/projects/${id}/archive`, { method: 'POST' })
    },
    /** POST /projects/:id/restore —— 恢复。 */
    restore(id: number) {
      return requestResource<ProjectDto>(config, `/projects/${id}/restore`, { method: 'POST' })
    },
    /** DELETE /projects/:id —— 删除（204 → undefined）。 */
    archiveOrDelete(id: number, opts: { force?: boolean } = {}) {
      const query = toQueryString({ force: opts.force })
      return requestResource<void>(config, `/projects/${id}`, { method: 'DELETE', query })
    },
  }
}

export type ProjectsClient = ReturnType<typeof createProjectsClient>
