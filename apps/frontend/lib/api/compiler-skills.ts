/**
 * v3-skill-registry-and-lifecycle —— Compiler Skill Registry API 客户端。
 *
 * 提供 Skill 列表/详情/创建/更新/删除/生命周期转移/匹配预览的前端 API 接口。
 */
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type { Skill, SkillMatchQuery, SkillMatchResult } from '@aiproj/types'

export interface SkillListResponse {
  data: Skill[]
  meta: { total: number; page: number; perPage: number; totalPages?: number }
}

export interface SkillDetailResponse {
  data: Skill
}

export interface SkillMatchResponse {
  data: SkillMatchResult[]
}

export interface CreateSkillBody {
  skillKey: string
  name: string
  version: string
  description?: string
  category: { primary: string; secondary?: string; tertiary?: string[] }
  tags?: string[]
  activation?: Record<string, unknown>
  knowledge?: Record<string, unknown>
  provenance?: Record<string, unknown> | null
  basePriority?: number
}

export interface UpdateSkillBody {
  name?: string
  description?: string
  category?: { primary: string; secondary?: string; tertiary?: string[] }
  tags?: string[]
  activation?: Record<string, unknown>
  knowledge?: Record<string, unknown>
  provenance?: Record<string, unknown> | null
  basePriority?: number
}

export interface LifecycleBody {
  status: string
}

export const compilerSkillsApi = {
  /** 列表 */
  list: (params?: Record<string, unknown>) =>
    apiFetchEnvelope<SkillListResponse>(
      `/ai/compiler/skills${params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''}`,
    ),

  /** 详情 */
  getById: (id: number) => apiFetch<SkillDetailResponse>(`/ai/compiler/skills/${id}`),

  /** 创建 */
  create: (body: CreateSkillBody) =>
    apiFetch<SkillDetailResponse>('/ai/compiler/skills', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 更新 */
  update: (id: number, body: UpdateSkillBody) =>
    apiFetch<SkillDetailResponse>(`/ai/compiler/skills/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** 删除 */
  delete: (id: number) =>
    apiFetch<void>(`/ai/compiler/skills/${id}`, {
      method: 'DELETE',
    }),

  /** 生命周期转移 */
  lifecycle: (id: number, body: LifecycleBody) =>
    apiFetch<SkillDetailResponse>(`/ai/compiler/skills/${id}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 匹配预览 */
  match: (query: SkillMatchQuery) =>
    apiFetch<SkillMatchResponse>('/ai/compiler/skills/match', {
      method: 'POST',
      body: JSON.stringify(query),
    }),

  /** 基于内置 Skill 创建副本 */
  duplicate: (id: number, newSkillKey: string) =>
    apiFetch<SkillDetailResponse>(`/ai/compiler/skills/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ newSkillKey }),
    }),
}
