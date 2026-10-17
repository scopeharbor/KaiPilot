/**
 * v3-skill-registry-and-lifecycle —— Compiler Skill Registry hooks。
 *
 * 列表/详情/匹配走 TanStack Query；创建/更新/删除/生命周期转移走 mutation。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  compilerSkillsApi,
  type CreateSkillBody,
  type UpdateSkillBody,
  type LifecycleBody,
} from '@/lib/api/compiler-skills'
import type { SkillMatchQuery } from '@aiproj/types'

export const COMPILER_SKILLS_QUERY_KEYS = {
  all: () => ['compiler', 'skills'] as const,
  lists: () => [...COMPILER_SKILLS_QUERY_KEYS.all(), 'list'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...COMPILER_SKILLS_QUERY_KEYS.lists(), filters] as const,
  details: () => [...COMPILER_SKILLS_QUERY_KEYS.all(), 'detail'] as const,
  detail: (id: number) => [...COMPILER_SKILLS_QUERY_KEYS.details(), id] as const,
  match: (query?: SkillMatchQuery) =>
    [...COMPILER_SKILLS_QUERY_KEYS.all(), 'match', query] as const,
}

/** 获取 Skill 列表 */
export function useCompilerSkillsList(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: COMPILER_SKILLS_QUERY_KEYS.list(params),
    queryFn: () => compilerSkillsApi.list(params),
  })
}

/** 获取 Skill 详情 */
export function useCompilerSkill(id: number | null) {
  return useQuery({
    queryKey: COMPILER_SKILLS_QUERY_KEYS.detail(id ?? 0),
    queryFn: () => compilerSkillsApi.getById(id!),
    enabled: id !== null,
  })
}

/** 创建 Skill */
export function useCreateCompilerSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateSkillBody) => compilerSkillsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COMPILER_SKILLS_QUERY_KEYS.lists() })
    },
  })
}

/** 更新 Skill */
export function useUpdateCompilerSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateSkillBody }) =>
      compilerSkillsApi.update(id, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: COMPILER_SKILLS_QUERY_KEYS.lists() })
      qc.invalidateQueries({ queryKey: COMPILER_SKILLS_QUERY_KEYS.detail(vars.id) })
    },
  })
}

/** 删除 Skill */
export function useDeleteCompilerSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => compilerSkillsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COMPILER_SKILLS_QUERY_KEYS.lists() })
    },
  })
}

/** 生命周期转移 */
export function useTransitionCompilerSkillLifecycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: LifecycleBody }) =>
      compilerSkillsApi.lifecycle(id, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: COMPILER_SKILLS_QUERY_KEYS.lists() })
      qc.invalidateQueries({ queryKey: COMPILER_SKILLS_QUERY_KEYS.detail(vars.id) })
    },
  })
}

/** 只读匹配预览 */
export function useCompilerSkillsMatch(query: SkillMatchQuery | null) {
  return useQuery({
    queryKey: COMPILER_SKILLS_QUERY_KEYS.match(query ?? undefined),
    queryFn: () => compilerSkillsApi.match(query!),
    enabled: query !== null,
  })
}

/** 基于内置 Skill 创建副本 */
export function useDuplicateCompilerSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, newSkillKey }: { id: number; newSkillKey: string }) =>
      compilerSkillsApi.duplicate(id, newSkillKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COMPILER_SKILLS_QUERY_KEYS.lists() })
    },
  })
}
