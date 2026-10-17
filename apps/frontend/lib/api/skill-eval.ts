/**
 * v3-skill-eval-system —— Skill 评估 API 客户端。
 *
 * 提供质量评估、评测运行、报告列表/详情、效果指标、AI 辅助评估的前端 API 接口。
 */
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type { QualityReport, BenchmarkReport, AiAssistAdvisory } from '@aiproj/types'

const BASE = '/ai/compiler/skills'

export interface ListReportsResponse {
  data: Array<{
    id: number
    skillId: number
    score: number
    dimensionScores: unknown
    issues: unknown
    aiAdvisory: unknown | null
    suggestedTransition: string | null
    referenceTime: string
    createdAt: string
  }>
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const skillEvalApi = {
  /**
   * POST /api/v1/ai/compiler/skills/:skillId/eval/quality
   */
  async runQuality(skillId: number): Promise<QualityReport> {
    const res = await apiFetch<{ data: QualityReport }>(`${BASE}/${skillId}/eval/quality`, {
      method: 'POST',
    })
    return res.data
  },

  /**
   * POST /api/v1/ai/compiler/skills/:skillId/eval/benchmark
   */
  async runBenchmark(
    skillId: number,
    opts?: { benchmarkSource?: 'L3' | 'fixture' },
  ): Promise<BenchmarkReport> {
    const res = await apiFetch<{ data: BenchmarkReport }>(`${BASE}/${skillId}/eval/benchmark`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    })
    return res.data
  },

  /**
   * GET /api/v1/ai/compiler/skills/:skillId/eval/reports
   */
  async listReports(skillId: number, page = 1, perPage = 50): Promise<ListReportsResponse> {
    return apiFetchEnvelope<ListReportsResponse>(
      `${BASE}/${skillId}/eval/reports?page=${page}&perPage=${perPage}`,
    )
  },

  /**
   * GET /api/v1/ai/compiler/skills/:skillId/eval/reports/:id
   */
  async getReport(skillId: number, reportId: number) {
    const res = await apiFetch<{ data: unknown }>(`${BASE}/${skillId}/eval/reports/${reportId}`)
    return res.data
  },

  /**
   * GET /api/v1/ai/compiler/skills/:skillId/eval/effect-metrics
   */
  async getEffectMetrics(skillId: number) {
    const res = await apiFetch<{ data: { activationCount: number; avgScore: number | null } }>(
      `${BASE}/${skillId}/eval/effect-metrics`,
    )
    return res.data
  },

  /**
   * POST /api/v1/ai/compiler/skills/:skillId/eval/ai-assist
   */
  async aiAssist(skillId: number): Promise<AiAssistAdvisory> {
    const res = await apiFetch<{ data: AiAssistAdvisory }>(`${BASE}/${skillId}/eval/ai-assist`, {
      method: 'POST',
    })
    return res.data
  },
}
