/**
 * v3-skill-knowledge-authoring —— Skill 知识创作 API 客户端。
 *
 * 提供 getDraft / putDraft / preview / commit / aiAssist 前端 API 接口。
 * 消费 @aiproj/types 契约。
 */
import { apiFetch } from '@/lib/api-client'
import type {
  AuthoringDraft,
  AuthoringPreview,
  KnowledgeSection,
  AiAssistHint,
} from '@aiproj/types'

export interface DraftResponse {
  data: AuthoringDraft | null
}

export interface DraftCreatedResponse {
  data: AuthoringDraft
}

export interface PreviewResponse {
  data: AuthoringPreview
}

export interface PutDraftBody {
  sections: KnowledgeSection[]
}

export interface AiAssistBody {
  hint: AiAssistHint
}

export const skillKnowledgeAuthoringApi = {
  /** GET draft */
  getDraft: (skillId: number) =>
    apiFetch<DraftResponse>(`/ai/compiler/skills/${skillId}/knowledge/draft`),

  /** PUT draft (create or update) */
  putDraft: (skillId: number, body: PutDraftBody) =>
    apiFetch<DraftCreatedResponse>(`/ai/compiler/skills/${skillId}/knowledge/draft`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /** POST preview */
  preview: (skillId: number) =>
    apiFetch<PreviewResponse>(`/ai/compiler/skills/${skillId}/knowledge/preview`, {
      method: 'POST',
    }),

  /** POST commit */
  commit: (skillId: number) =>
    apiFetch<DraftCreatedResponse>(`/ai/compiler/skills/${skillId}/knowledge/commit`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** POST ai-assist */
  aiAssist: (skillId: number, body: AiAssistBody) =>
    apiFetch<DraftCreatedResponse>(`/ai/compiler/skills/${skillId}/knowledge/ai-assist`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
