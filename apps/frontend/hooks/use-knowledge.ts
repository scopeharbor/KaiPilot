/**
 * v3-four-layer-knowledge-system —— 知识库 hooks。
 *
 * 列表/详情/检索走 TanStack Query；创建/更新/确认/转移走 mutation。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { knowledgeApi } from '@/lib/api/knowledge'
import type { CreateKnowledgeRequest } from '@aiproj/types'

export const KNOWLEDGE_QUERY_KEYS = {
  all: () => ['knowledge'] as const,
  lists: () => [...KNOWLEDGE_QUERY_KEYS.all(), 'list'] as const,
  list: (params?: Record<string, unknown>) =>
    [...KNOWLEDGE_QUERY_KEYS.lists(), params ?? {}] as const,
  details: () => [...KNOWLEDGE_QUERY_KEYS.all(), 'detail'] as const,
  detail: (id: number) => [...KNOWLEDGE_QUERY_KEYS.details(), id] as const,
}

/** 获取知识列表/检索 */
export function useKnowledgeList(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: KNOWLEDGE_QUERY_KEYS.list(params),
    queryFn: () => knowledgeApi.list(params),
  })
}

/** 获取知识详情 */
export function useKnowledgeDetail(id: number | null) {
  return useQuery({
    queryKey: KNOWLEDGE_QUERY_KEYS.detail(id ?? 0),
    queryFn: () => knowledgeApi.getById(id!),
    enabled: id !== null,
  })
}

/** 创建知识记录 */
export function useCreateKnowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateKnowledgeRequest) => knowledgeApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KNOWLEDGE_QUERY_KEYS.lists() })
    },
  })
}

/** 更新知识记录 */
export function useUpdateKnowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<CreateKnowledgeRequest> }) =>
      knowledgeApi.update(id, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KNOWLEDGE_QUERY_KEYS.lists() })
      qc.invalidateQueries({ queryKey: KNOWLEDGE_QUERY_KEYS.detail(vars.id) })
    },
  })
}

/** 人工确认转正 */
export function useConfirmKnowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => knowledgeApi.confirm(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: KNOWLEDGE_QUERY_KEYS.lists() })
      qc.invalidateQueries({ queryKey: KNOWLEDGE_QUERY_KEYS.detail(id) })
    },
  })
}

/** 生命周期转移 */
export function useTransitionKnowledgeLifecycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      knowledgeApi.transitionLifecycle(id, { status }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KNOWLEDGE_QUERY_KEYS.lists() })
      qc.invalidateQueries({ queryKey: KNOWLEDGE_QUERY_KEYS.detail(vars.id) })
    },
  })
}

/** AI 结构化 */
export function useStructureKnowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { rawText: string; domain?: string }) => knowledgeApi.structure(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KNOWLEDGE_QUERY_KEYS.lists() })
    },
  })
}
