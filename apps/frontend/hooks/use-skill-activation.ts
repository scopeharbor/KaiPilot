/**
 * v3-skill-compiler-integration —— Skill 激活与注入前端 hooks。
 */
import { useQuery } from '@tanstack/react-query'
import {
  fetchCompilerSkillActivation,
  fetchCompilerSkillInjections,
  type SkillActivationSummaryDto,
  type SkillKnowledgeInjectionDto,
} from '@/lib/api/skill-compiler-integration'

export function useSkillActivation(
  projectId: number | undefined,
  runId: number | undefined,
  enabled: boolean = true,
) {
  return useQuery<SkillActivationSummaryDto | null>({
    queryKey: ['compiler', 'skill-activation', projectId, runId],
    queryFn: () => (projectId && runId ? fetchCompilerSkillActivation(projectId, runId) : null),
    enabled: enabled && projectId != null && runId != null,
    staleTime: 60_000, // 1 min
  })
}

export function useSkillInjections(
  projectId: number | undefined,
  runId: number | undefined,
  enabled: boolean = true,
) {
  return useQuery<SkillKnowledgeInjectionDto[]>({
    queryKey: ['compiler', 'skill-injections', projectId, runId],
    queryFn: () => (projectId && runId ? fetchCompilerSkillInjections(projectId, runId) : []),
    enabled: enabled && projectId != null && runId != null,
    staleTime: 60_000,
  })
}
