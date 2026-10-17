/**
 * v3-skill-compiler-integration —— Skill Compiler 注入前端 API 客户端。
 *
 * 读取 run 的激活决策 artifact 与 Stage 注入摘要。
 */
import { apiFetch } from '@/lib/api-client'

export interface SkillActivationSummaryDto {
  activationDecisionRef: string
  evidenceDigest: string
  activatedSkillKeys: string[]
  advisorySkillKeys: string[]
  activatedSkills: Array<{
    skillKey: string
    name: string
    version: string
    activationMode: string
    reason: string
  }>
}

export interface SkillKnowledgeInjectionDto {
  stageId: string
  includedEntryCount: number
  cutReason?: string
  activatedSkillKeys: string[]
}

export interface CompilerSkillActivationResponse {
  data: SkillActivationSummaryDto
}

export interface CompilerSkillInjectionResponse {
  data: SkillKnowledgeInjectionDto[]
}

/**
 * 获取 Compiler run 的 Skill 激活决策摘要。
 */
export async function fetchCompilerSkillActivation(
  projectId: number,
  runId: number,
): Promise<SkillActivationSummaryDto | null> {
  try {
    const res = await apiFetch<CompilerSkillActivationResponse>(
      `/projects/${projectId}/compiler/runs/${runId}/skill-activation`,
    )
    return res.data ?? null
  } catch {
    return null
  }
}

/**
 * 获取 Compiler run 的 Stage 级 Skill 知识注入摘要。
 */
export async function fetchCompilerSkillInjections(
  projectId: number,
  runId: number,
): Promise<SkillKnowledgeInjectionDto[]> {
  try {
    const res = await apiFetch<CompilerSkillInjectionResponse>(
      `/projects/${projectId}/compiler/runs/${runId}/skill-injections`,
    )
    return res.data ?? []
  } catch {
    return []
  }
}
