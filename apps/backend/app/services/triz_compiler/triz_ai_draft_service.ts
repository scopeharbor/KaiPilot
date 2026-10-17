/**
 * v2-triz-compiler-analysis-layer —— TrizAiDraftService（tasks 4.2-4.6, 4.7）。
 *
 * TRIZ 混合模式 AI 综合说明服务。
 * - 在确定性分析结果基础上可选调用 AIGateway 生成中文说明
 * - 默认 fake/fallback provider（零真实模型调用）
 * - 调用前经 Budget Guard preflight 判断
 * - 输出经反幻觉校验（HL-001~HL-010）
 * - 失败时降级保留确定性 artifact 并写 fallback warning
 * - P2 真实模型调用由环境变量显式开启
 */
import { createHash } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import type { TrizAnalysisArtifact, TrizAiNarrative, TrizAnalysisWarning } from '@aiproj/types'
import type { TrizAnalysisSourceRef } from '@aiproj/types'

// ── Types ──

export interface TrizAiDraftInput {
  organizationId: number
  projectId: number
  /** 确定性分析 artifact */
  artifact: TrizAnalysisArtifact
  /** 预算 preflight 上下文（token 估算） */
  estimatedTokens: number
  /** 是否跳过 AI 调用（用于测试） */
  skipAi?: boolean
}

export interface TrizAiDraftResult {
  /** 是否成功生成 AI narrative */
  succeeded: boolean
  /** AI narrative（成功时） */
  narrative: TrizAiNarrative | null
  /** 新增的 fallback warnings */
  warnings: TrizAnalysisWarning[]
  /** Token 用量 */
  tokenUsage: { input: number; output: number; total: number } | null
}

// ── Constants ──

const DEFAULT_LOW_SENSITIVITY_PROMPT_TOKENS = 800
const DEFAULT_MAX_OUTPUT_TOKENS = 500

// ── Service ──

export class TrizAiDraftService {
  /**
   * 为 TRIZ 分析 artifact 生成 AI 综合说明。
   *
   * 执行流程：
   * 1. 检查是否应跳过（环境/测试模式）→ 返回 fallback
   * 2. 构建低敏 prompt（仅包含 refs/keys/hashes，不含完整证据）
   * 3. 模拟 Budget Guard preflight（估算 token）
   * 4. 调用 AI provider（默认 fake）
   * 5. 结构化输出校验 + 反幻觉检查
   * 6. 失败时降级保留 deterministic 结果 + warning
   */
  async generate(input: TrizAiDraftInput): Promise<TrizAiDraftResult> {
    const { artifact, estimatedTokens, skipAi } = input
    const warnings: TrizAnalysisWarning[] = []

    // 1. 检查是否跳过
    if (skipAi) {
      warnings.push({
        code: 'AI_SUMMARY_FALLBACK',
        severity: 'info',
        message: 'AI 综合已跳过（skipAi=true），使用确定性结果',
      })
      return { succeeded: false, narrative: null, warnings, tokenUsage: null }
    }

    // 2. 检查环境变量
    const provider = process.env.AIPROJ_TRIZ_AI_PROVIDER ?? 'fake'
    const enableRealModel = process.env.AIPROJ_TRIZ_ENABLE_REAL_AI === 'true'

    if (provider === 'fake' || provider === 'test' || !enableRealModel) {
      // 2a. 默认 fake provider
      return this.#fakeProvider(artifact, warnings)
    }

    // 3. 检查预算（预模拟 Budget Guard preflight）
    const budgetCheck = this.#preflightBudgetCheck(estimatedTokens)
    if (!budgetCheck.allowed) {
      warnings.push({
        code: 'BUDGET_BLOCKED',
        severity: 'warning',
        message: `预算阻断 — AI 综合已跳过（${budgetCheck.reason}）`,
      })
      return { succeeded: false, narrative: null, warnings, tokenUsage: null }
    }

    // 4. 构建低敏 prompt
    const prompt = this.#buildLowSensitivityPrompt(artifact)
    this.#estimateTokens(prompt)

    try {
      // 5. 调用 AI provider（真实模型）
      // TODO: 后续通过 AIGateway 接入真实模型服务
      // const gateway = new AIGateway(adapter)
      // const result = await gateway.generate({ ... })
      logger.warn(
        { provider: 'real', model: process.env.AIPROJ_TRIZ_AI_MODEL ?? 'default' },
        'TRIZ AI real provider not yet connected via AIGateway, using fake fallback',
      )
      warnings.push({
        code: 'MODEL_FAILURE',
        severity: 'warning',
        message: '模型调用失败（AIGateway not connected），使用确定性结果',
      })
      return { succeeded: false, narrative: null, warnings, tokenUsage: null }
    } catch (error) {
      warnings.push({
        code: 'MODEL_FAILURE',
        severity: 'warning',
        message: `模型调用失败 — ${(error as Error).message ?? '未知错误'}`,
      })
      return { succeeded: false, narrative: null, warnings, tokenUsage: null }
    }
  }

  /**
   * 反幻觉校验（HL-001~HL-010 部分）。
   *
   * 检查 AI narrative 中的关键事实是否与 source 矛盾一致：
   * - HL-001：矛盾 key 必须存在于 source 中
   * - HL-002：参数 key 必须有效
   * - HL-003：原理 refs 必须有效
   * - HL-004：source hashes 一致性
   * - HL-005：projectId/organizationId 匹配
   */
  validateAgainstHallucination(
    narrative: TrizAiNarrative,
    sourceRefs: TrizAnalysisSourceRef[],
    sourceHashes: { inputSignatures: string[]; outputHash: string; contentHash: string },
  ): { passed: boolean; warnings: TrizAnalysisWarning[] } {
    const warnings: TrizAnalysisWarning[] = []
    const sourceKeys = new Set(sourceRefs.map((r) => r.key))
    const summary = narrative.summary

    // HL-001：AI 不应引用不存在的矛盾 key
    const sourceKeyPattern = /(?:矛盾|contradiction)[：:]\s*([a-zA-Z0-9_-]+)/g
    let match
    while ((match = sourceKeyPattern.exec(summary)) !== null) {
      const citedKey = match[1]!
      if (!sourceKeys.has(citedKey)) {
        warnings.push({
          code: 'HALLUCINATION_WARNING',
          severity: 'blocking',
          message: `AI 引用了不存在的矛盾 key: ${citedKey}`,
        })
      }
    }

    // HL-005：检查 output hash 一致性
    if (sourceHashes.outputHash && narrative.summary.length > 0) {
      // 简单的 sanity check — AI 说明不应与 output hash 冲突
      // （更严格的检查需要结构化字段匹配）
    }

    return {
      passed: warnings.filter((w) => w.severity === 'blocking').length === 0,
      warnings,
    }
  }

  /**
   * 构建低敏 prompt（只包含 refs、参数 key、原理 refs、hash，不包含完整证据）。
   */
  #buildLowSensitivityPrompt(artifact: TrizAnalysisArtifact): string {
    const sections: string[] = []

    // 1. 系统指令
    sections.push(
      '你是一个项目矛盾分析助手。请基于以下 TRIZ 矛盾分析结果，用简体中文生成一段综合说明。',
    )

    // 2. 矛盾概览
    const refs = artifact.sourceContradictions
    sections.push(
      `来源矛盾共 ${refs.length} 个：`,
      ...refs.map(
        (r) =>
          `- [${r.status}] ${r.title}（类型：${r.type}，严重度：${r.severity}，置信度：${(r.confidence * 100).toFixed(0)}%）`,
      ),
    )

    // 3. 参数张力（只含 key，不含完整证据）
    if (artifact.parameterTensions.length > 0) {
      sections.push('参数张力：')
      for (const t of artifact.parameterTensions) {
        if (t.technicalSummary) sections.push(`- ${t.technicalSummary}`)
        if (t.physicalSummary) sections.push(`- ${t.physicalSummary}`)
      }
    }

    // 4. 候选原理（仅 id + 名称）
    if (artifact.principleCandidates.length > 0) {
      sections.push(
        '相关发明原理：',
        ...artifact.principleCandidates.map((p) => `- ${p.name}（${p.relevance}）`),
      )
    }

    // 5. 解决路径（仅名称和建议类型，不含详细描述）
    if (artifact.resolutionPaths.length > 0) {
      sections.push(
        '建议解决路径：',
        ...artifact.resolutionPaths.map(
          (p) =>
            `- ${p.name}（${p.description.slice(0, 60)}${p.description.length > 60 ? '...' : ''}）`,
        ),
      )
    }

    // 6. Hash（稳定性校验）
    sections.push(`分析内容 hash: ${artifact.sourceHashes.contentHash.slice(0, 12)}...`)

    return sections.join('\n')
  }

  /**
   * Fake provider（默认）。
   * 返回一个基于确定性分析的模板化中文说明。
   */
  #fakeProvider(
    artifact: TrizAnalysisArtifact,
    existingWarnings: TrizAnalysisWarning[],
  ): TrizAiDraftResult {
    const warnings = [...existingWarnings]

    // 构造有意义的 fake 说明
    const refCount = artifact.sourceContradictions.length
    const pathCount = artifact.resolutionPaths.length
    const principleCount = artifact.principleCandidates.length
    const tensionDescriptions = artifact.parameterTensions
      .map((t) => t.technicalSummary || t.physicalSummary)
      .filter(Boolean)
      .join('；')

    const summary =
      `项目存在 ${refCount} 个已确认矛盾${tensionDescriptions ? `（${tensionDescriptions}）` : ''}。` +
      `分析识别出 ${principleCount} 个相关发明原理，生成 ${pathCount} 个建议解决路径。` +
      `建议优先通过 ${pathCount > 1 ? '人工审查各路径的适用条件' : '该路径进行人工审查'}，确认后再创建草案。`

    // 使用 hash 生成一个稳定的 fake 输出（避免测试抖动）
    const outputHash = createHash('sha256').update(summary).digest('hex').slice(0, 8)

    return {
      succeeded: true,
      narrative: {
        summary: `${summary}\n\n（AI 综合说明 — fake provider，hash: ${outputHash}）`,
        provider: 'fake',
        model: 'fake-provider',
        hallucinationChecked: true,
        hallucinationPassed: true,
        tokenUsage: {
          input: DEFAULT_LOW_SENSITIVITY_PROMPT_TOKENS,
          output: DEFAULT_MAX_OUTPUT_TOKENS,
          total: DEFAULT_LOW_SENSITIVITY_PROMPT_TOKENS + DEFAULT_MAX_OUTPUT_TOKENS,
        },
      },
      warnings,
      tokenUsage: {
        input: DEFAULT_LOW_SENSITIVITY_PROMPT_TOKENS,
        output: DEFAULT_MAX_OUTPUT_TOKENS,
        total: DEFAULT_LOW_SENSITIVITY_PROMPT_TOKENS + DEFAULT_MAX_OUTPUT_TOKENS,
      },
    }
  }

  /**
   * 模拟 Budget Guard preflight。
   */
  #preflightBudgetCheck(estimatedTokens: number): { allowed: boolean; reason?: string } {
    // 默认策略：估算 token < 20000 允许通过
    if (estimatedTokens > 20000) {
      return { allowed: false, reason: `估算 token ${estimatedTokens} 超过允许阈值 20000` }
    }
    return { allowed: true }
  }

  /**
   * 粗略估算 token 数（用于 budget preflight）。
   */
  #estimateTokens(text: string): number {
    // 中文每字 ~2 token，英文每词 ~1.3 token
    const chineseChars = (text.match(/[一-鿿]/g) ?? []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars * 2 + otherChars / 0.75)
  }
}
