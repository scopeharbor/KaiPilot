// v2-5-typescript-sdk-core —— SDK 公共入口（design D1/D2/D3/D5）。
//
// workspace 私有 `@aiproj/sdk`：纯 TypeScript transport + 可注入 fetch/token，
// 复用 `@aiproj/types` 共享 DTO，覆盖 /api/v1 项目/任务最小 client + escape hatch。
// 不公开 npm 发布、不做完整 API 覆盖、不新增后端 API（见 design Non-Goals）。

import type {
  ApiErrorResponse,
  PaginationMeta,
  PaginatedResponse,
  DataResponse,
  ProjectDto,
  TaskDto,
  CreateProjectInput,
  UpdateProjectInput,
  ListProjectsQuery,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksQuery,
} from '@aiproj/types'
import { createProjectsClient } from './projects-client.js'
import { createTasksClient } from './tasks-client.js'
import { createSdkFullApiClient, type SdkFullApiClient } from './domain-client.js'
import { SDK_ENDPOINT_REGISTRY, SDK_FIXTURE_TEST_IDS } from './endpoint-registry.js'
import { normalizeEndpointRegistry } from './registry-loader.js'
import {
  type AiprojClientConfig,
  type RequestOptions,
  rawRequest,
  requestList,
  requestResource,
  normalizeBaseUrl,
  joinUrl,
} from './transport.js'
import { toQueryString } from './query.js'
import { parseApiError } from './errors.js'

/** escape hatch 仅允许 /api/v1 前缀路径。 */
const API_V1_PREFIX = '/api/v1'
const NORMALIZED_SDK_ENDPOINT_REGISTRY = normalizeEndpointRegistry(SDK_ENDPOINT_REGISTRY)

function assertApiV1Path(path: string): void {
  if (!path.startsWith(API_V1_PREFIX)) {
    throw new Error(
      `@aiproj/sdk: rawRequest escape hatch only permits paths starting with ${API_V1_PREFIX}; got ${JSON.stringify(path)}`,
    )
  }
}

export class AiprojClient {
  readonly config: AiprojClientConfig
  readonly projects: ReturnType<typeof createProjectsClient>
  readonly tasks: ReturnType<typeof createTasksClient>
  readonly api: SdkFullApiClient

  constructor(config: AiprojClientConfig) {
    if (!config.baseUrl) throw new Error('@aiproj/sdk: config.baseUrl is required')
    this.config = config
    // 在构造体内初始化，确保 this.config 已就绪（字段初始化器在构造体前执行）。
    this.projects = createProjectsClient(this.config)
    this.tasks = createTasksClient(this.config)
    this.api = createSdkFullApiClient(this.config, NORMALIZED_SDK_ENDPOINT_REGISTRY)
  }

  /**
   * Escape hatch（design D5）：复用同一 transport/auth/error pipeline，
   * 但仅允许已登记的 `/api/v1` 路径。返回解析后的 envelope（列表或单资源由调用方通过
   * 泛型 T 表达）。失败抛 ApiErrorResponse。
   */
  async rawRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    assertApiV1Path(path)
    const res = await rawRequest(this.config, path, options)
    if (!res.ok) throw await parseApiError(res)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  /** escape hatch 列表请求便捷封装：返回 { data, meta }。 */
  async request<T>(path: string, options: RequestOptions = {}): Promise<PaginatedResponse<T>> {
    assertApiV1Path(path)
    return requestList<T>(this.config, path, options)
  }
}

export type {
  AiprojClientConfig,
  RequestOptions,
  SdkFetch,
  TokenProvider,
  OrganizationContextProvider,
} from './transport.js'
export type {
  ApiErrorResponse,
  PaginationMeta,
  PaginatedResponse,
  DataResponse,
  ProjectDto,
  TaskDto,
  CreateProjectInput,
  UpdateProjectInput,
  ListProjectsQuery,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksQuery,
}

export {
  rawRequest,
  requestList,
  requestResource,
  normalizeBaseUrl,
  joinUrl,
  toQueryString,
  parseApiError,
  createSdkFullApiClient,
  SDK_ENDPOINT_REGISTRY,
  SDK_FIXTURE_TEST_IDS,
  NORMALIZED_SDK_ENDPOINT_REGISTRY,
}

export type {
  SdkEndpointRegistryEntry,
  NormalizedSdkEndpointRegistryEntry,
  SdkCoverageStatus,
  SdkEndpointDomain,
} from './registry-loader.js'
export type {
  SdkEndpointCallOptions,
  SdkEndpointMethod,
  SdkFullApiClient,
  SdkDomainClient,
} from './domain-client.js'
export type {
  SdkLocalEndpointRequest,
  SdkLocalEndpointEnvelope,
  SdkLocalDeferredEndpoint,
} from './sdk-local-types.js'

// v3-multitenant-api §7.5 —— SDK 多租户 bound 助手（不安全 override 预检 / scoped 幂等键 / 低敏 metadata）。
export {
  refuseUnsafeTenantOverride,
  scopedIdempotencyKey,
  readTenantDecisionMetadata,
  type TenantOverrideResult,
} from './multitenant-api.js'
