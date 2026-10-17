/**
 * v3-skill-knowledge-authoring —— Skill 知识创作 hooks。
 *
 * 草稿读/写/preview/commit/aiAssist 走 TanStack Query 与 mutation。
 * 分层 query keys，mutation 完成后失效相关查询。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  skillKnowledgeAuthoringApi,
  type PutDraftBody,
  type AiAssistBody,
} from '@/lib/api/skill-knowledge-authoring'

export const SKILL_KNOWLEDGE_AUTHORING_KEYS = {
  all: () => ['compiler', 'skills', 'knowledge'] as const,
  draft: (skillId: number) => [...SKILL_KNOWLEDGE_AUTHORING_KEYS.all(), 'draft', skillId] as const,
  preview: (skillId: number) =>
    [...SKILL_KNOWLEDGE_AUTHORING_KEYS.all(), 'preview', skillId] as const,
}

/** 获取当前 pending 草稿 */
export function useKnowledgeDraft(skillId: number | null) {
  return useQuery({
    queryKey: SKILL_KNOWLEDGE_AUTHORING_KEYS.draft(skillId ?? 0),
    queryFn: () => skillKnowledgeAuthoringApi.getDraft(skillId!),
    enabled: skillId !== null,
  })
}

/** 获取 preview（按需查询，通常手动触发） */
export function useKnowledgePreview(skillId: number | null) {
  return useQuery({
    queryKey: SKILL_KNOWLEDGE_AUTHORING_KEYS.preview(skillId ?? 0),
    queryFn: () => skillKnowledgeAuthoringApi.preview(skillId!),
    enabled: false, // 手动触发
  })
}

/** 创建/更新草稿 */
export function usePutKnowledgeDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ skillId, body }: { skillId: number; body: PutDraftBody }) =>
      skillKnowledgeAuthoringApi.putDraft(skillId, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: SKILL_KNOWLEDGE_AUTHORING_KEYS.draft(variables.skillId),
      })
      qc.invalidateQueries({
        queryKey: SKILL_KNOWLEDGE_AUTHORING_KEYS.preview(variables.skillId),
      })
    },
  })
}

/** commit 草稿 */
export function useCommitKnowledgeDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skillId: number) => skillKnowledgeAuthoringApi.commit(skillId),
    onSuccess: (_data, skillId) => {
      qc.invalidateQueries({
        queryKey: SKILL_KNOWLEDGE_AUTHORING_KEYS.draft(skillId),
      })
    },
  })
}

/** AI 辅助生成 advisory 草稿 */
export function useAiAssistKnowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ skillId, body }: { skillId: number; body: AiAssistBody }) =>
      skillKnowledgeAuthoringApi.aiAssist(skillId, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: SKILL_KNOWLEDGE_AUTHORING_KEYS.draft(variables.skillId),
      })
    },
  })
}
