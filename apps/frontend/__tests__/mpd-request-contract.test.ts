/**
 * v3-legacy-contract-debt-fixes W3 · tasks 3.8 —— mpd 请求契约回归（断言**实际发出的请求**）。
 *
 * 桩点在 `global.fetch` 层（范式：`__tests__/api-client.test.ts:11-40`）：
 * `fetch → apiFetch / apiFetchEnvelope → lib/api/multi-project-dependencies → mpdApi` 整条链路真实执行；
 * **禁止 `vi.mock` 替换 api client 模块**——那正是这批债长期存活的原因（spec「桩点纪律」1）。
 * 伪后端应答形状 = `multi_project_dependencies_controller.ts` 的真实输出
 * （`index`(:79) 返 `{ data, meta }`，`show` / `preview*` / `graph` 返 `{ data: X }`）。
 *
 * 覆盖（tasks 3.8 ①–④；另按 spec「多项目依赖 CRUD 前后端请求契约一致性」2 与「桩点纪律」3 补足）：
 * ① 列表数组参数以重复键序列化（`status=active&status=draft`），不含逗号拼接；
 * ② 归档 / 恢复 / 删除预览请求体是 `{ dependencyId: <number> }`，不再是 `{ id: <string> }`；
 * ③ 创建 / 更新预览请求体键名集合与从后端 validator 抄来的键名常量数组逐一对应（防再次漂移）；
 * ④ 列表结果保住信封：`data` 数组 + `meta.total` 数字；
 * ⑤ 图谱端点数组参数同为重复键、必填上限齐全（spec 2：列表与图谱的数组参数都受约束）；
 * ⑥ 列表错误态（5xx）可与空态区分，不被吞成空态（RL-06）。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mpdApi } from '@/lib/api/multi-project-dependencies'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import type {
  DepCreatePreviewInput,
  DepListFilters,
  DepUpdatePreviewInput,
  MultiProjectDependency,
  MultiProjectDependencyPreview,
  MultiProjectEndpointRef,
  MultiProjectEndpointSummary,
  MultiProjectGraphQuery,
  MultiProjectGraphResponse,
  MultiProjectWriteOperation,
} from '@aiproj/types'

const API_PREFIX = 'http://localhost:3333/api/v1'
const ORG_ID = 1
const BASE = `/organizations/${ORG_ID}/multi-project-dependencies`

// ---------------------------------------------------------------------------
// 后端 validator 键名常量（防再次漂移的锚点）
//
// 抄自 `apps/backend/app/validators/multi_project_dependency.ts`：
//   createMultiProjectDependencyPreviewValidator :73-100
//   updateMultiProjectDependencyPreviewValidator :106-118
// 前端请求体的键名集合必须与之逐一对应——多一个（如历史上的 `evidenceSummary`）、
// 少一个、或换了名字（如 `risk`、`id`、嵌套 `providerEndpoint`）都会让断言变红。
// ---------------------------------------------------------------------------
const CREATE_PREVIEW_VALIDATOR_KEYS = [
  // provider 端点
  'providerEndpointType',
  'providerProjectId',
  'providerMilestoneId',
  'providerTaskId',
  'providerExternalLabel',
  'providerExternalKey',
  // consumer 端点
  'consumerEndpointType',
  'consumerProjectId',
  'consumerMilestoneId',
  'consumerTaskId',
  'consumerExternalLabel',
  'consumerExternalKey',
  // 依赖属性
  'category',
  'type',
  'lagDays',
  'strength',
  'bufferDays',
  'riskLevel',
  'sourceMode',
] as const

const UPDATE_PREVIEW_VALIDATOR_KEYS = [
  'dependencyId',
  'category',
  'type',
  'lagDays',
  'strength',
  'bufferDays',
  'status',
  'riskLevel',
  'ownerUserId',
] as const

// ---------------------------------------------------------------------------
// 伪后端（记录每条实际发出的请求）
// ---------------------------------------------------------------------------

interface RecordedRequest {
  method: string
  /** 去掉 API 前缀与查询串后的路径 */
  path: string
  /** 完整原始 URL（用于「不含逗号拼接」类断言） */
  url: string
  query: URLSearchParams
  /** JSON 解析后的请求体（无 body 时为 null） */
  body: unknown
}

interface BackendState {
  /** `index` 返回的 `data`：后端 `depRowToContract` 的真实形状 */
  listItems: MultiProjectDependency[]
  /** 列表端点状态码（200=成功，500=错误态） */
  listStatus?: number
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

const PREVIEW_PATHS: Record<string, MultiProjectWriteOperation> = {
  [`${BASE}/preview-create`]: 'create',
  [`${BASE}/preview-update`]: 'update',
  [`${BASE}/preview-archive`]: 'archive',
  [`${BASE}/preview-restore`]: 'restore',
  [`${BASE}/preview-delete`]: 'delete',
}

function route(state: BackendState, path: string): Response {
  if (path === BASE) {
    if (state.listStatus && state.listStatus !== 200) {
      return jsonResponse(state.listStatus, {
        error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' },
      })
    }
    const total = state.listItems.length
    return jsonResponse(200, {
      data: state.listItems,
      meta: { total, page: 1, perPage: 20, totalPages: total > 0 ? 1 : 0 },
    })
  }
  const previewOperation = PREVIEW_PATHS[path]
  if (previewOperation) {
    return jsonResponse(200, { data: makePreviewContract(previewOperation) })
  }
  if (path === `${BASE}/graph`) {
    return jsonResponse(200, { data: makeGraphResponse() })
  }
  return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '跨项目依赖不存在' } })
}

function installBackend(state: BackendState): RecordedRequest[] {
  const records: RecordedRequest[] = []
  const fetchMock: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const [urlWithoutQuery, rawQuery] = url.split('?')
    const path = (urlWithoutQuery ?? '').replace(API_PREFIX, '')
    records.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      path,
      url,
      query: new URLSearchParams(rawQuery ?? ''),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? null),
    })
    return route(state, path)
  }
  vi.stubGlobal('fetch', fetchMock)
  return records
}

// ---------------------------------------------------------------------------
// 夹具（后端真实形状）
// ---------------------------------------------------------------------------

function makeDependency(overrides: Partial<MultiProjectDependency> = {}): MultiProjectDependency {
  const provider: MultiProjectEndpointRef = {
    endpointType: 'task',
    projectId: 11,
    projectName: '北极星研发',
    milestoneId: null,
    milestoneName: null,
    taskId: 101,
    taskName: '接口联调',
    externalLabel: null,
    externalKey: null,
    redacted: false,
    redactionReason: null,
  }
  return {
    id: 42,
    organizationId: ORG_ID,
    providerEndpoint: provider,
    consumerEndpoint: {
      ...provider,
      endpointType: 'milestone',
      taskId: null,
      taskName: null,
      milestoneId: 201,
      milestoneName: 'M2 验收',
    },
    category: 'deliverable',
    type: 'fs',
    lagDays: 2,
    strength: 'hard',
    bufferDays: 1,
    status: 'active',
    riskLevel: 'high',
    ownerUserId: 7,
    sourceMode: 'manual',
    sourceSuggestionId: null,
    evidenceRefs: [],
    freshnessSignature: 'sig-1',
    freshnessCheckedAt: '2026-09-10T08:00:00.000Z',
    freshnessStatus: 'fresh',
    confirmationHash: 'hash-1',
    idempotencyKey: 'idem-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

function makePreviewContract(operation: MultiProjectWriteOperation): MultiProjectDependencyPreview {
  const provider: MultiProjectEndpointSummary = {
    endpointType: 'task',
    projectId: 11,
    projectName: '北极星研发',
    taskId: 101,
    taskName: '接口联调',
    milestoneId: null,
    milestoneName: null,
    externalLabel: null,
    redacted: false,
    redactionReason: null,
  }
  return {
    previewId: `preview-${operation}-1`,
    operation,
    providerEndpoint: provider,
    consumerEndpoint: {
      ...provider,
      endpointType: 'milestone',
      taskId: null,
      taskName: null,
      milestoneId: 201,
      milestoneName: 'M2 验收',
    },
    permissionFingerprint: 'fp-1',
    diff: {
      operation,
      before: null,
      after: { status: 'archived' },
      changedFields: ['status'],
    },
    duplicateCheck: { isDuplicate: false, existingId: null, message: null },
    cycleCheck: { wouldCreateCycle: false, message: null },
    lifecycleCheck: { isValid: true, message: null },
    selfDependencyCheck: { isSelfDependency: false, message: null },
    freshnessSignature: 'sig-1',
    warningCodes: [],
    confirmationHash: 'hash-1',
    expiresAt: '2026-09-10T12:00:00.000Z',
    idempotencyKey: 'idem-1',
    idempotencyGuidance: '确认前请复核差异',
  }
}

function makeGraphResponse(): MultiProjectGraphResponse {
  return {
    nodes: [],
    edges: [],
    visibleNodeCount: 0,
    redactedNodeCount: 0,
    visibleEdgeCount: 0,
    truncated: false,
    truncationReason: null,
    warningCodes: [],
    freshnessMeta: { checkedAt: '2026-09-10T08:00:00.000Z', staleCount: 0, freshCount: 0 },
  }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

beforeEach(() => {
  useAuthStore.getState().setSession({
    user: { id: 1, email: 'pm@example.com', fullName: '王启明', organizations: [] },
    accessToken: accessTokenWith(['multi-project-dependency:view']),
    refreshToken: 'refresh-1',
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('mpd 列表查询参数', () => {
  test('① 数组参数以重复键序列化，不含逗号拼接', async () => {
    const requests = installBackend({ listItems: [makeDependency()] })
    const filters: DepListFilters = { status: ['active', 'draft'], projectIds: [7, 8], page: 1 }

    await mpdApi.list(ORG_ID, filters)

    const request = requests[0]!
    expect(request.method).toBe('GET')
    expect(request.path).toBe(BASE)
    // 重复键 → 服务端解析为真数组；多值逗号串因 HTTP 层 qs 的 comma:true 侥幸 200，
    // 真正必 422 的是单元素退化成裸值（design §4.3.1）
    expect(request.query.getAll('status')).toEqual(['active', 'draft'])
    expect(request.query.getAll('projectIds')).toEqual(['7', '8'])
    expect(request.url).not.toContain(',')
    expect(request.url).not.toContain('%2C')
  })

  test('① 过滤器使用后端 validator 字段名，不发漂移名（projectScope / risk）', async () => {
    const requests = installBackend({ listItems: [] })
    const filters: DepListFilters = {
      endpointType: 'task',
      riskLevel: 'high',
      freshness: 'fresh',
      sort: '-updatedAt',
    }

    await mpdApi.list(ORG_ID, filters)

    const { query } = requests[0]!
    expect(query.get('endpointType')).toBe('task')
    expect(query.get('riskLevel')).toBe('high')
    expect(query.get('freshness')).toBe('fresh')
    expect(query.get('sort')).toBe('-updatedAt')
    // 历史漂移名（validator :32-49 无此字段）不得回归
    expect(query.has('projectScope')).toBe(false)
    expect(query.has('risk')).toBe(false)
  })

  test('④ 列表结果保住信封：data 数组 + meta.total 数字', async () => {
    installBackend({ listItems: [makeDependency()] })

    const result = await mpdApi.list(ORG_ID, {})

    // 修复前 `apiFetch<DepListResponse>` 会解掉一层信封 → meta 恒 undefined
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(typeof result.meta.total).toBe('number')
    expect(result.meta).toEqual({ total: 1, page: 1, perPage: 20, totalPages: 1 })
  })

  test('④ 空列表仍是 { data: [], meta.total: 0 }，不塌成 undefined', async () => {
    installBackend({ listItems: [] })

    const result = await mpdApi.list(ORG_ID, {})

    expect(result).toBeDefined()
    expect(result.data).toEqual([])
    expect(result.meta.total).toBe(0)
  })

  test('⑥ 5xx 不被吞成空态：错误码与状态码可辨识', async () => {
    installBackend({ listItems: [], listStatus: 500 })

    await expect(mpdApi.list(ORG_ID, {})).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    })
  })
})

describe('mpd 预览请求体', () => {
  test('② 归档 / 恢复 / 删除预览请求体是 { dependencyId: <number> }', async () => {
    const requests = installBackend({ listItems: [] })

    await mpdApi.previewArchive(ORG_ID, '42')
    await mpdApi.previewRestore(ORG_ID, '42')
    await mpdApi.previewDelete(ORG_ID, '42')

    const expectedPaths = [
      `${BASE}/preview-archive`,
      `${BASE}/preview-restore`,
      `${BASE}/preview-delete`,
    ]
    expect(requests.map((r) => r.path)).toEqual(expectedPaths)
    for (const request of requests) {
      expect(request.method).toBe('POST')
      // UI 边界是 string，发到后端必须是 number（validator :124-138 要求 number().positive()）
      expect(request.body).toEqual({ dependencyId: 42 })
      expect(Object.keys(request.body as Record<string, unknown>)).toEqual(['dependencyId'])
      expect(request.body).not.toHaveProperty('id')
    }
  })

  test('③ 创建预览请求体键名集合与后端 validator 逐一对应', async () => {
    const requests = installBackend({ listItems: [] })
    const input: DepCreatePreviewInput = {
      // provider 端点（扁平，不再是 { type, id } 嵌套）
      providerEndpointType: 'task',
      providerProjectId: 11,
      providerMilestoneId: null,
      providerTaskId: 101,
      providerExternalLabel: null,
      providerExternalKey: null,
      // consumer 端点
      consumerEndpointType: 'milestone',
      consumerProjectId: 12,
      consumerMilestoneId: 201,
      consumerTaskId: null,
      consumerExternalLabel: null,
      consumerExternalKey: null,
      // 依赖属性
      category: 'deliverable',
      type: 'fs',
      lagDays: 2,
      strength: 'hard',
      bufferDays: 1,
      riskLevel: 'high',
      sourceMode: 'manual',
    }

    await mpdApi.previewCreate(ORG_ID, input)

    const request = requests[0]!
    expect(request.method).toBe('POST')
    expect(request.path).toBe(`${BASE}/preview-create`)
    const body = request.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([...CREATE_PREVIEW_VALIDATOR_KEYS].sort())
    // 历史漂移形态不得回归：嵌套端点、risk、后端不接收的 evidenceSummary
    expect(body).not.toHaveProperty('providerEndpoint')
    expect(body).not.toHaveProperty('consumerEndpoint')
    expect(body).not.toHaveProperty('risk')
    expect(body).not.toHaveProperty('evidenceSummary')
  })

  test('③ 更新预览请求体键名集合与后端 validator 逐一对应', async () => {
    const requests = installBackend({ listItems: [] })
    const input: DepUpdatePreviewInput = {
      dependencyId: 42,
      category: 'technical',
      type: 'ss',
      lagDays: 3,
      strength: 'soft',
      bufferDays: 0,
      status: 'at_risk',
      riskLevel: 'critical',
      ownerUserId: 7,
    }

    await mpdApi.previewUpdate(ORG_ID, input)

    const request = requests[0]!
    expect(request.method).toBe('POST')
    expect(request.path).toBe(`${BASE}/preview-update`)
    const body = request.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([...UPDATE_PREVIEW_VALIDATOR_KEYS].sort())
    expect(body.dependencyId).toBe(42)
    // 历史漂移形态不得回归：`id: string` / `risk` / `evidenceSummary`
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('risk')
    expect(body).not.toHaveProperty('evidenceSummary')
  })
})

describe('mpd 图谱查询参数', () => {
  test('⑤ 图谱端点数组参数重复键 + 必填上限齐全（validator :55-67）', async () => {
    const requests = installBackend({ listItems: [] })
    const query: MultiProjectGraphQuery = {
      projectIds: [3, 9],
      status: ['active', 'at_risk'],
      maxDepth: 3,
      nodeLimit: 200,
      edgeLimit: 500,
    }

    const result = await mpdApi.graph(ORG_ID, query)

    const request = requests[0]!
    expect(request.method).toBe('GET')
    expect(request.path).toBe(`${BASE}/graph`)
    expect(request.query.getAll('projectIds')).toEqual(['3', '9'])
    expect(request.query.getAll('status')).toEqual(['active', 'at_risk'])
    expect(request.query.get('maxDepth')).toBe('3')
    expect(request.query.get('nodeLimit')).toBe('200')
    expect(request.query.get('edgeLimit')).toBe('500')
    expect(request.url).not.toContain(',')
    // 图谱响应同样走单层解包：结果直接是图谱结构本体
    expect(result.nodes).toEqual([])
    expect(result.truncated).toBe(false)
  })
})
