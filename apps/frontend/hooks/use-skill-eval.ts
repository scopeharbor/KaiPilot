/**
 * v3-skill-eval-system —— Skill 评估 TanStack Query hooks。
 *
 * 分层 query keys：quality / benchmark / reports / effect-metrics / ai-assist。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { skillEvalApi } from '@/lib/api/skill-eval'

// ── Query Keys ──────────────────────────────────────────────────────────

export const skillEvalKeys = {
  all: ['skill-eval'] as const,
  quality: (skillId: number) => [...skillEvalKeys.all, 'quality', skillId] as const,
  benchmark: (skillId: number) => [...skillEvalKeys.all, 'benchmark', skillId] as const,
  reports: (skillId: number, page: number) =>
    [...skillEvalKeys.all, 'reports', skillId, page] as const,
  report: (skillId: number, reportId: number) =>
    [...skillEvalKeys.all, 'reports', skillId, reportId] as const,
  effectMetrics: (skillId: number) => [...skillEvalKeys.all, 'effect-metrics', skillId] as const,
  aiAssist: (skillId: number) => [...skillEvalKeys.all, 'ai-assist', skillId] as const,
}

// ── Hooks ──────────────────────────────────────────────────────────────

export function useSkillEvalQuality(skillId: number) {
  return useQuery({
    queryKey: skillEvalKeys.quality(skillId),
    queryFn: () => skillEvalApi.runQuality(skillId),
    enabled: skillId > 0,
  })
}

export function useSkillEvalBenchmark(skillId: number) {
  return useQuery({
    queryKey: skillEvalKeys.benchmark(skillId),
    queryFn: () => skillEvalApi.runBenchmark(skillId),
    enabled: skillId > 0,
  })
}

export function useSkillEvalReports(skillId: number, page = 1) {
  return useQuery({
    queryKey: skillEvalKeys.reports(skillId, page),
    queryFn: () => skillEvalApi.listReports(skillId, page),
    enabled: skillId > 0,
  })
}

export function useSkillEvalReport(skillId: number, reportId: number) {
  return useQuery({
    queryKey: skillEvalKeys.report(skillId, reportId),
    queryFn: () => skillEvalApi.getReport(skillId, reportId),
    enabled: skillId > 0 && reportId > 0,
  })
}

export function useSkillEffectMetrics(skillId: number) {
  return useQuery({
    queryKey: skillEvalKeys.effectMetrics(skillId),
    queryFn: () => skillEvalApi.getEffectMetrics(skillId),
    enabled: skillId > 0,
  })
}

export function useSkillEvalAiAssist(skillId: number) {
  return useQuery({
    queryKey: skillEvalKeys.aiAssist(skillId),
    queryFn: () => skillEvalApi.aiAssist(skillId),
    enabled: skillId > 0,
  })
}

export function useRunSkillEvalQuality() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (skillId: number) => skillEvalApi.runQuality(skillId),
    onSettled: (_data, _error, skillId) => {
      queryClient.invalidateQueries({ queryKey: skillEvalKeys.reports(skillId, 1) })
    },
  })
}

export function useRunSkillEvalBenchmark() {
  useQueryClient()
  return useMutation({
    mutationFn: ({
      skillId,
      benchmarkSource,
    }: {
      skillId: number
      benchmarkSource?: 'L3' | 'fixture'
    }) => skillEvalApi.runBenchmark(skillId, { benchmarkSource }),
  })
}

export function useSkillEvalAiAssistMutation() {
  return useMutation({
    mutationFn: (skillId: number) => skillEvalApi.aiAssist(skillId),
  })
}
