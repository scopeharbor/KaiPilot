/**
 * v3-knowledge-memory-operating-layer —— 运营层 hooks。
 *
 * 严格的 TanStack Query 风格：
 * - query keys 按 (organization, actor, filters, ref) 分层（§5.1）；
 * - flag off → enabled: false，所有调用零发起；
 * - 精准 invalidation：detail / list / operating-side 互相失效；
 * - 永不 mutate（§5.2 envelope + 错误零泄露）。
 *
 * URL state 解析/序列化走 `@aiproj/types` 的 parseOperatingUrlState；
 * 本文件只把 hook input/output 与 URL state 互转。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import {
  knowledgeMemoryOperatingApi,
  type KnowledgeMemoryOperatingListQuery,
} from '@/lib/api/knowledge-memory-operating'
import {
  sanitizeOperatingUrlState,
  serializeOperatingUrlState,
  type KnowledgeMemoryOperatingKind,
  type KnowledgeMemoryOperatingSurface,
  type OperatingUrlState,
} from '@aiproj/types'

/** 前端默认 perPage（与后端 OPERATING_LIST_DEFAULT_PER_PAGE=20 对齐）。 */
const DEFAULT_PER_PAGE = 20

export interface OperatingUrlStateBinding {
  state: OperatingUrlState
  setState: (next: Partial<OperatingUrlState>) => void
  reset: () => void
}

/**
 * 与浏览器 URL query 双向绑定的 operating URL state。
 * 入口/出口严格走 `parseOperatingUrlState`（allowlist + 长度 + 字符集），
 * 与后端 validator 完全一致。
 */
export function useOperatingUrlState(): OperatingUrlStateBinding {
  const [state, setRaw] = useState<OperatingUrlState>(() => readFromUrl())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPop = () => setRaw(readFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const setState = useCallback((next: Partial<OperatingUrlState>) => {
    setRaw((prev) => {
      const merged: OperatingUrlState = { ...prev, ...next, view: 'operations' }
      writeToUrl(merged)
      return merged
    })
  }, [])

  const reset = useCallback(() => {
    setRaw({ view: 'operations' })
    writeToUrl({ view: 'operations' })
  }, [])

  return { state, setState, reset }
}

function readFromUrl(): OperatingUrlState {
  if (typeof window === 'undefined') return { view: 'operations' }
  // 逐字段清理而不是整条丢弃：一个坏参数不应该把用户其余合法筛选一起清空
  // （spec：移除非法值的同时保留安全筛选上下文）。
  return sanitizeOperatingUrlState(new URLSearchParams(window.location.search)).state
}

function writeToUrl(state: OperatingUrlState): void {
  if (typeof window === 'undefined') return
  const out = serializeOperatingUrlState(state)
  const next = `${window.location.pathname}?${out.toString()}`
  if (window.location.search !== `?${out.toString()}`) {
    window.history.replaceState(null, '', next)
  }
}

/** URL state → API query。 */
export function operatingUrlStateToQuery(
  state: OperatingUrlState,
): KnowledgeMemoryOperatingListQuery {
  return {
    attention: state.attention,
    kind: state.kind,
    scope: state.scope,
    status: state.status,
    sort: state.sort,
    order: state.order,
    page: state.page,
    perPage: state.perPage,
  }
}

export const KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS = {
  all: () => ['knowledgeMemoryOperating'] as const,
  summary: (orgId: number | null) =>
    [...KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.all(), 'summary', orgId ?? 'none'] as const,
  list: (orgId: number | null, query: KnowledgeMemoryOperatingListQuery) =>
    [...KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.all(), 'list', orgId ?? 'none', query] as const,
  detail: (orgId: number | null, kind: KnowledgeMemoryOperatingKind, ref: string) =>
    [...KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.all(), 'detail', orgId ?? 'none', kind, ref] as const,
  surface: (
    orgId: number | null,
    kind: KnowledgeMemoryOperatingKind,
    ref: string,
    surface: KnowledgeMemoryOperatingSurface,
  ) =>
    [
      ...KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.all(),
      'surface',
      orgId ?? 'none',
      kind,
      ref,
      surface,
    ] as const,
}

interface UseOperatingContextInput {
  organizationId: number | null
  /** feature flag off 时禁用所有 hook（§5.2 跨租 cache 隔离、flag-off 零请求）。 */
  enabled?: boolean
}

export function useKnowledgeMemoryOperatingSummary(input: UseOperatingContextInput) {
  const enabled = (input.enabled ?? true) && input.organizationId !== null
  return useQuery({
    queryKey: KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.summary(input.organizationId),
    queryFn: () => knowledgeMemoryOperatingApi.summary(),
    enabled,
    staleTime: 30_000,
  })
}

export function useKnowledgeMemoryOperatingList(
  input: UseOperatingContextInput & { query: KnowledgeMemoryOperatingListQuery },
) {
  const enabled = (input.enabled ?? true) && input.organizationId !== null
  return useQuery({
    queryKey: KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.list(input.organizationId, input.query),
    queryFn: () => knowledgeMemoryOperatingApi.list(input.query),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  })
}

export function useKnowledgeMemoryOperatingDetail(input: {
  organizationId: number | null
  kind: KnowledgeMemoryOperatingKind | null
  ref: string | null
  enabled?: boolean
}) {
  const enabled =
    (input.enabled ?? true) &&
    input.organizationId !== null &&
    input.kind !== null &&
    input.ref !== null
  return useQuery({
    queryKey: KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.detail(
      input.organizationId,
      input.kind ?? 'knowledge_item',
      input.ref ?? '',
    ),
    queryFn: () =>
      knowledgeMemoryOperatingApi.detail(
        input.kind as KnowledgeMemoryOperatingKind,
        input.ref as string,
      ),
    enabled,
    staleTime: 30_000,
  })
}

export function useKnowledgeMemoryOperatingSurface(input: {
  organizationId: number | null
  kind: KnowledgeMemoryOperatingKind | null
  ref: string | null
  surface: KnowledgeMemoryOperatingSurface | null
  enabled?: boolean
}) {
  const enabled =
    (input.enabled ?? true) &&
    input.organizationId !== null &&
    input.kind !== null &&
    input.ref !== null &&
    input.surface !== null
  return useQuery({
    queryKey: KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS.surface(
      input.organizationId,
      input.kind ?? 'knowledge_item',
      input.ref ?? '',
      input.surface ?? 'knowledge_review',
    ),
    queryFn: () =>
      knowledgeMemoryOperatingApi.surface(
        input.kind as KnowledgeMemoryOperatingKind,
        input.ref as string,
        input.surface as KnowledgeMemoryOperatingSurface,
      ),
    enabled,
    staleTime: 60_000,
  })
}

/**
 * 每个 owning surface 在写入成功后应当失效的 **owning 侧** query key 前缀（§6.11）。
 *
 * 只列真正被该 surface 改动的领域缓存——把四个领域一起清掉会让无关面板
 * 无谓重取，也掩盖了「到底是谁改了什么」。
 */
export const OWNING_INVALIDATION_KEYS: Readonly<
  Record<KnowledgeMemoryOperatingSurface, readonly (readonly unknown[])[]>
> = {
  knowledge_review: [['knowledge']],
  copilot_memory_governance: [['copilot-memory']],
  skill_knowledge_authoring: [['compiler-skills'], ['skill-knowledge-draft']],
  // 只读表面：没有任何写入，因此不失效任何 owning 缓存。
  retrieval_observation_detail: [],
}

/**
 * 解析一次成功的 owning mutation 该失效哪些 key（纯函数，便于断言矩阵）。
 *
 * 运营侧只失效 summary / list / 该对象的 detail —— **不**清空整棵
 * `all()` 子树，也不动其它组织的缓存。
 */
export function resolveOperatingInvalidationKeys(input: {
  organizationId: number | null
  surface: KnowledgeMemoryOperatingSurface
  kind: KnowledgeMemoryOperatingKind
  ref: string
}): readonly (readonly unknown[])[] {
  const K = KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS
  return [
    K.summary(input.organizationId),
    [...K.all(), 'list', input.organizationId ?? 'none'],
    K.detail(input.organizationId, input.kind, input.ref),
    K.surface(input.organizationId, input.kind, input.ref, input.surface),
    ...OWNING_INVALIDATION_KEYS[input.surface],
  ]
}

/**
 * 精确失效：**只在 owning 写入成功后**调用。
 *
 * 打开面板、取消、关闭或失败都不得调用——attention 是否消失必须由重新读取
 * 权威状态决定，而不是由「用户点开过」决定（spec 明确禁止后者）。
 */
export function useOperatingInvalidation() {
  const qc = useQueryClient()
  return useCallback(
    (input: {
      organizationId: number | null
      surface: KnowledgeMemoryOperatingSurface
      kind: KnowledgeMemoryOperatingKind
      ref: string
    }) => {
      for (const queryKey of resolveOperatingInvalidationKeys(input)) {
        qc.invalidateQueries({ queryKey })
      }
    },
    [qc],
  )
}

/** 只重取运营侧读模型（用于 lane 局部重试 / 手动刷新，不涉及 owning 缓存）。 */
export function useOperatingRefresh() {
  const qc = useQueryClient()
  return useCallback(
    (organizationId: number | null) => {
      const K = KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS
      qc.invalidateQueries({ queryKey: K.summary(organizationId) })
      qc.invalidateQueries({ queryKey: [...K.all(), 'list', organizationId ?? 'none'] })
    },
    [qc],
  )
}

/** 默认 list query（不含任何 filter，便于直接传给 hook）。 */
export function defaultListQuery(): KnowledgeMemoryOperatingListQuery {
  return {
    sort: 'attentionPriority',
    order: 'desc',
    page: 1,
    perPage: DEFAULT_PER_PAGE,
  }
}

/** 把 list envelope 错误归一化（§5.2 envelope + 错误零泄露）。 */
export function describeOperatingError(err: unknown): {
  code:
    | 'AUTH_REQUIRED'
    | 'PERMISSION_DENIED'
    | 'RESOURCE_NOT_FOUND'
    | 'SURFACE_UNAVAILABLE'
    | 'OPERATING_SERVICE_INTERNAL'
    | 'NETWORK_ERROR'
    | 'UNKNOWN'
  message: string
} {
  if (!err) return { code: 'UNKNOWN', message: 'unknown' }
  if (err instanceof Error) {
    const m = err.message
    if (/401|auth/i.test(m)) return { code: 'AUTH_REQUIRED', message: m }
    if (/403|forbidden/i.test(m)) return { code: 'PERMISSION_DENIED', message: m }
    if (/404|not[-_ ]?found/i.test(m)) return { code: 'RESOURCE_NOT_FOUND', message: m }
    if (/surface/i.test(m)) return { code: 'SURFACE_UNAVAILABLE', message: m }
    if (/network|fetch/i.test(m)) return { code: 'NETWORK_ERROR', message: m }
    return { code: 'OPERATING_SERVICE_INTERNAL', message: m.slice(0, 200) }
  }
  return { code: 'UNKNOWN', message: 'unknown' }
}

export const OPERATING_HOOK_QUERY_KEYS = KNOWLEDGE_MEMORY_OPERATING_QUERY_KEYS
