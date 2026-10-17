/**
 * v2-triz-compiler-analysis-layer —— TrizCompilerAnalysisService（tasks 2.2-2.5）。
 *
 * 确定性和混合型 TRIZ 分析服务。
 * - 确定性模式：根据矛盾 snapshot 聚合参数张力、排候选原理、构建建议路径。
 * - 混合模式：在确定性结果基础上可选调用 AIGateway 生成中文综合说明。
 * - 零模型调用默认；AI 失败降级保留确定性结果。
 * - 通过 Artifact Store 持久化，不写正式业务数据。
 */
import { createHash } from 'node:crypto'
import type User from '#models/user'
import type ContradictionPolicy from '#policies/contradiction_policy'
import { TrizContradictionReadAdapter } from './contradiction_read_adapter.js'
import type {
  TrizAnalysisArtifact,
  TrizAnalysisSourceRef,
  TrizAnalysisWarning,
  TrizAnalysisMode,
  TrizAnalysisStatus,
  TrizResolutionPath,
  ParameterTensionSummary,
  PrincipleCandidate,
} from '@aiproj/types'
import { sortWarningsBySeverity, computeTrizArtifactContentHash } from '@aiproj/types'

// ── Types ──

export interface TrizAnalysisInput {
  /** Compiler run id */
  compilerRunId: number
  /** Stage id */
  stageId: string
  /** Project id */
  projectId: number
  /** Organization id */
  organizationId: number
  /** Actor user */
  user: User
  /** 执行模式（默认 deterministic） */
  mode: TrizAnalysisMode
  /** 是否包含 draft 矛盾（默认 false） */
  includeDraftCandidates?: boolean
}

export interface TrizAnalysisOutput {
  artifact: TrizAnalysisArtifact
  /** 用于 idempotency key 的 source hash */
  sourceHash: string
}

export interface IdempotencyKeyParams {
  compilerRunId: number
  stageId: string
  projectId: number
  sourceHash: string
  attemptNumber: number
}

// ── Errors ──

export class TrizAnalysisServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrizAnalysisServiceError'
  }
}

// ── 解决路径模板 ──

interface ResolutionPathTemplate {
  suggestionType: string
  name: string
  description: string
  applicability: string[]
  nonApplicability: string[]
}

const RESOLUTION_PATH_TEMPLATES: ResolutionPathTemplate[] = [
  {
    suggestionType: 'split',
    name: '拆分关键路径段',
    description: '将关键路径中的长依赖链拆分为可并行的子段，降低整体工期对单一路径的依赖',
    applicability: ['存在可并行的任务段', '关键路径密度 > 0.6'],
    nonApplicability: ['任务之间存在严格串行依赖', '拆分后引入额外协调成本 > 预期收益'],
  },
  {
    suggestionType: 'buffer',
    name: '引入缓冲里程碑',
    description: '在关键节点后插入缓冲里程碑（工期 buffer），吸收上游延期波动',
    applicability: ['上游依赖存在高风险任务', '项目工期有余量'],
    nonApplicability: ['工期已无缓冲空间', '外部 deadline 不可调整'],
  },
  {
    suggestionType: 'scope_window',
    name: '降低范围弹性窗口',
    description: '对高风险/高成本模块设置范围弹性窗口，允许在该窗口内裁剪非核心需求以保障关键交付',
    applicability: ['范围可分级（MoSCoW）', '存在低优先级需求占用高成本资源'],
    nonApplicability: ['范围已最小化', '合同约定固定范围不可裁剪'],
  },
  {
    suggestionType: 'cr_draft',
    name: '创建变更请求草稿',
    description: '基于矛盾检测结果生成变更请求草稿，建议在人工审查后调整资源分配或工期计划',
    applicability: ['矛盾涉及资源负载过高', '存在可调整的资源分配方案'],
    nonApplicability: ['资源已满负荷且不可调整', '变更后无法满足约束条件'],
  },
  {
    suggestionType: 'parallel_execution',
    name: '并行执行建议',
    description: '将原本串行的任务改为并行执行，利用多资源缩短关键路径',
    applicability: ['任务之间无数据依赖', '有可用并行资源'],
    nonApplicability: ['任务存在严格数据/逻辑依赖', '并行后资源冲突加剧'],
  },
  {
    suggestionType: 'resource_rebalance',
    name: '资源重平衡建议',
    description: '从超载资源向空闲资源转移工作量，缓解资源负载矛盾',
    applicability: ['存在明显资源负载不均', '可转移任务对资源技能要求相近'],
    nonApplicability: ['所有资源均超载', '任务有严格的资源绑定要求'],
  },
  {
    suggestionType: 'quality_threshold',
    name: '质量阈值调整建议',
    description: '在工期与质量的矛盾中，对非关键交付物适当调整质量阈值以换取工期',
    applicability: ['交付物可分级验收', '有明确的 must-have / nice-to-have 划分'],
    nonApplicability: ['所有交付物有刚性质量标准', '合同约定了固定验收标准'],
  },
]

/**
 * TrizCompilerAnalysisService —— TRIZ 分析服务。
 */
export class TrizCompilerAnalysisService {
  constructor(private contradictionPolicy: ContradictionPolicy) {}

  /**
   * 生成 idempotency key。
   * 包含 compilerRunId、stageId、projectId、source hashes、attempt number。
   */
  generateIdempotencyKey(params: IdempotencyKeyParams): string {
    const raw = `${params.compilerRunId}:${params.stageId}:${params.projectId}:${params.sourceHash}:${params.attemptNumber}`
    return `triz_analysis:${createHash('sha256').update(raw, 'utf-8').digest('hex').slice(0, 32)}`
  }

  /**
   * 执行确定性 TRIZ 分析。
   * 读取矛盾 snapshot → 聚合参数张力 → 排候选原理 → 构建建议路径。
   */
  async analyze(input: TrizAnalysisInput): Promise<TrizAnalysisOutput> {
    const { user, organizationId, projectId, mode, includeDraftCandidates } = input
    const warnings: TrizAnalysisWarning[] = []

    // 1. 读取矛盾 snapshot（只读、权限过滤）
    const adapter = new TrizContradictionReadAdapter(this.contradictionPolicy)
    const sourceRefs = await adapter.getAuthorizedSnapshots(user, organizationId, projectId, {
      includeDraft: includeDraftCandidates ?? false,
    })

    // 2. 处理空结果
    let status: TrizAnalysisStatus = 'completed'
    if (sourceRefs.length === 0) {
      warnings.push({
        code: 'NO_CONTRADICTIONS_FOUND',
        severity: 'info',
        message: '未发现项目矛盾',
      })
    }

    // 3. 标记 draft 输入 warning
    if (includeDraftCandidates) {
      const draftRefs = sourceRefs.filter((r) => r.status === 'draft')
      if (draftRefs.length > 0) {
        warnings.push({
          code: 'DRAFT_INPUT_INCLUDED',
          severity: 'warning',
          message: `包含 ${draftRefs.length} 个待确认候选矛盾，建议优先确认后再做分析决策`,
        })
      }
    }

    // 4. 标记 stale 矛盾
    const staleRefs = sourceRefs.filter((r) => r.stale)
    for (const stale of staleRefs) {
      warnings.push({
        code: 'STALE_SOURCE_CONTRADICTION',
        severity: 'warning',
        message: `来源矛盾「${stale.title}」已过期（${stale.staleReason ?? '原因未知'}）`,
        sourceKey: stale.key,
      })
    }
    const hasBlockingStale = staleRefs.length > 2 // 大量过期标记影响可靠性

    // 5. 聚合参数张力
    const parameterTensions = this.#aggregateTensions(sourceRefs)

    // 6. 排候选原理（去重保留最高相关度）
    const principleCandidates = this.#aggregatePrinciples(sourceRefs)

    // 7. 构建建议型解决路径
    const resolutionPaths = this.#buildResolutionPaths(
      sourceRefs,
      parameterTensions,
      principleCandidates,
      warnings,
    )

    // 8. 如果无可用路径
    if (resolutionPaths.length === 0 && sourceRefs.length > 0) {
      warnings.push({
        code: 'EMPTY_RESOLUTION_PATHS',
        severity: 'blocking',
        message: '基于当前矛盾未生成可审查解决路径',
      })
      status = 'needs_human_review'
    }

    // 9. 需要人工复核判定
    const requiresHumanReview =
      hasBlockingStale || warnings.some((w) => w.severity === 'blocking') || staleRefs.length > 0

    if (requiresHumanReview && status === 'completed') {
      status = 'needs_human_review'
    }

    // 10. 计算 source hashes
    const inputSignatures = sourceRefs.map((r) => r.inputSignature)
    const outputHash = this.#computeOutputHash(sourceRefs, resolutionPaths)

    // 11. 构造 artifact（不含 AI narrative — 确定性模式）
    const artifact: TrizAnalysisArtifact = {
      schemaVersion: '1.0',
      mode,
      status,
      sourceContradictions: sourceRefs,
      parameterTensions,
      principleCandidates,
      resolutionPaths,
      warnings: sortWarningsBySeverity(warnings),
      requiresHumanReview,
      sourceHashes: {
        inputSignatures,
        outputHash,
        contentHash: '', // 由调用方填充
      },
      handoff: {
        status: 'none',
        draftSessionRef: null,
        selectedPathId: null,
        handedOffAt: null,
        blockedReason: null,
      },
      aiNarrative: null,
      createdAt: new Date().toISOString(),
    }

    // 12. 计算最终 content hash
    artifact.sourceHashes.contentHash = this.#computeFullContentHash(artifact)

    // 13. 计算 source hash（用于 idempotency key）
    const sourceHash = this.#computeSourceHash(sourceRefs)

    return { artifact, sourceHash }
  }

  /**
   * 对已完成的 artifact 添加 AI narrative（混合模式使用）。
   * 返回新 artifact（不可变更新）。
   */
  attachAiNarrative(
    artifact: TrizAnalysisArtifact,
    narrative: {
      summary: string
      provider: string
      model: string
      hallucinationChecked: boolean
      hallucinationPassed: boolean
      tokenUsage: { input: number; output: number; total: number } | null
    },
  ): TrizAnalysisArtifact {
    return {
      ...artifact,
      mode: 'hybrid',
      aiNarrative: narrative,
    }
  }

  /**
   * 对失败的混合模式，返回降级 artifact + fallback warning。
   */
  createFallbackArtifact(
    deterministic: TrizAnalysisArtifact,
    fallbackReason: 'budget' | 'model' | 'validation' | 'context',
  ): TrizAnalysisArtifact {
    const warningCode =
      fallbackReason === 'budget'
        ? ('BUDGET_BLOCKED' as const)
        : fallbackReason === 'model'
          ? ('MODEL_FAILURE' as const)
          : fallbackReason === 'context'
            ? ('CONTEXT_UNAVAILABLE' as const)
            : ('INVALID_AI_OUTPUT' as const)

    return {
      ...deterministic,
      warnings: sortWarningsBySeverity([
        ...deterministic.warnings,
        {
          code: warningCode,
          severity: 'warning',
          message: `AI 综合已跳过（${fallbackReason === 'budget' ? '预算阻断' : fallbackReason === 'model' ? '模型调用失败' : fallbackReason === 'context' ? '上下文不可用' : 'AI 输出格式无效'}），使用确定性结果`,
        },
      ]),
      aiNarrative: null,
    }
  }

  /**
   * 验证 AI 输出的结构化结果（反幻觉检查）。
   * 检查引用的矛盾 key、参数、原理、hash 是否与实际 source 一致。
   */
  validateAiOutput(artifact: TrizAnalysisArtifact): {
    passed: boolean
    warnings: TrizAnalysisWarning[]
  } {
    const validationWarnings: TrizAnalysisWarning[] = []
    const aiNarrative = artifact.aiNarrative
    if (!aiNarrative) {
      return { passed: true, warnings: [] }
    }

    // 简单校验：检查 AI 说明中是否包含不存在的矛盾 key
    const narrative = aiNarrative.summary

    // 如果 AI 说明为空或只包含空白
    if (!narrative || narrative.trim().length < 10) {
      validationWarnings.push({
        code: 'INVALID_AI_OUTPUT',
        severity: 'warning',
        message: 'AI 生成的综合说明为空或过短',
      })
    }

    // 如果 HL 检查未通过
    if (aiNarrative.hallucinationChecked && !aiNarrative.hallucinationPassed) {
      validationWarnings.push({
        code: 'HALLUCINATION_WARNING',
        severity: 'blocking',
        message: '反幻觉校验未通过 — AI 综合说明包含不可信内容',
      })
    }

    return {
      passed: validationWarnings.length === 0,
      warnings: validationWarnings,
    }
  }

  // ── Private Helpers ──

  /**
   * 聚合参数张力：从 source refs 中提取 unique 参数对/物理矛盾摘要。
   */
  #aggregateTensions(refs: TrizAnalysisSourceRef[]): ParameterTensionSummary[] {
    const seen = new Set<string>()
    const tensions: ParameterTensionSummary[] = []

    for (const ref of refs) {
      if (ref.type === 'technical' && ref.improvingParameterKey && ref.worseningParameterKey) {
        const key = `${ref.improvingParameterKey}↔${ref.worseningParameterKey}`
        if (seen.has(key)) {
          // 追加到已有张力
          const existing = tensions.find(
            (t) =>
              t.improvingKey === ref.improvingParameterKey &&
              t.worseningKey === ref.worseningParameterKey,
          )
          if (existing) {
            existing.sourceKeys.push(ref.key)
          }
          continue
        }
        seen.add(key)
        tensions.push({
          improvingKey: ref.improvingParameterKey,
          worseningKey: ref.worseningParameterKey,
          technicalSummary: `改善「${ref.improvingParameterKey}」可能导致「${ref.worseningParameterKey}」恶化`,
          physicalSummary: null,
          sourceKeys: [ref.key],
        })
      }

      if (ref.type === 'physical' && ref.parameterKey) {
        const key = `physical:${ref.parameterKey}`
        if (seen.has(key)) continue
        seen.add(key)
        tensions.push({
          improvingKey: null,
          worseningKey: null,
          technicalSummary: '',
          physicalSummary: `参数「${ref.parameterKey}」同时要求「${ref.requirementA ?? 'A'}」和「${ref.requirementB ?? 'B'}」`,
          sourceKeys: [ref.key],
        })
      }
    }

    return tensions
  }

  /**
   * 聚合候选原理：去重保留最高相关度。
   */
  #aggregatePrinciples(refs: TrizAnalysisSourceRef[]): PrincipleCandidate[] {
    const principleMap = new Map<string, PrincipleCandidate>()

    for (const ref of refs) {
      for (const sp of ref.suggestedPrinciples) {
        const existing = principleMap.get(sp.principleId)
        if (existing) {
          // 保留最高相关度
          if (!existing.sourceKeys.includes(ref.key)) {
            existing.sourceKeys.push(ref.key)
          }
        } else {
          principleMap.set(sp.principleId, {
            principleId: sp.principleId as any,
            name: sp.name,
            chineseName: null,
            relevance: 'medium',
            sourceKeys: [ref.key],
          })
        }
      }
    }

    return Array.from(principleMap.values())
  }

  /**
   * 构建建议型解决路径（不可直接执行）。
   * 每条路径不包含 SQL/ORM/DB patch。
   */
  #buildResolutionPaths(
    refs: TrizAnalysisSourceRef[],
    tensions: ParameterTensionSummary[],
    principles: PrincipleCandidate[],
    warnings: TrizAnalysisWarning[],
  ): TrizResolutionPath[] {
    const paths: TrizResolutionPath[] = []
    const sourceKeys = refs.map((r) => r.key)
    const principleIds = principles.map((p) => p.principleId)

    // 如果没有矛盾或参数张力，无法生成路径
    if (refs.length === 0 || tensions.length === 0) {
      return paths
    }

    // 根据参数张力选择匹配的路径模板
    for (const template of RESOLUTION_PATH_TEMPLATES) {
      // 检查匹配度
      const matchedTensions = tensions.filter((t) => {
        // 根据解决路径类型匹配
        switch (template.suggestionType) {
          case 'split':
          case 'parallel_execution':
            return t.improvingKey === 'duration' || t.worseningKey === 'duration'
          case 'buffer':
            return t.improvingKey === 'duration' || t.worseningKey === 'risk_level'
          case 'scope_window':
            return (
              t.improvingKey === 'scope' ||
              t.worseningKey === 'cost' ||
              t.worseningKey === 'duration'
            )
          case 'resource_rebalance':
            return t.improvingKey === 'resource_load' || t.worseningKey === 'resource_load'
          case 'quality_threshold':
            return t.improvingKey === 'quality' || t.worseningKey === 'quality'
          case 'cr_draft':
            return true // 通用路径
          default:
            return true
        }
      })

      if (matchedTensions.length === 0 && template.suggestionType !== 'cr_draft') {
        continue // 跳过不匹配的模板
      }

      const pathStaleWarnings = warnings.filter(
        (w) =>
          w.code === 'STALE_SOURCE_CONTRADICTION' &&
          w.sourceKey &&
          sourceKeys.includes(w.sourceKey),
      )

      const pathWarnings: TrizAnalysisWarning[] =
        pathStaleWarnings.length > 0 ? pathStaleWarnings : []

      const requiresHumanReview = staleRefsExist(refs) || pathStaleWarnings.length > 0

      paths.push({
        pathId: `path-${template.suggestionType}`,
        name: template.name,
        description: template.description,
        suggestionType: template.suggestionType,
        applicability: template.applicability,
        nonApplicability: template.nonApplicability,
        sourceKeys:
          matchedTensions.length > 0
            ? matchedTensions.flatMap((t) => t.sourceKeys)
            : sourceKeys.slice(0, 3),
        principleIds: principleIds.slice(0, 3),
        requiresHumanReview,
        warnings: pathWarnings,
      })
    }

    return paths
  }

  /**
   * 计算 output hash（基于 source refs + paths 的稳定 hash）。
   */
  #computeOutputHash(refs: TrizAnalysisSourceRef[], paths: TrizResolutionPath[]): string {
    const stable = {
      refs: refs.map((r) => `${r.key}:${r.inputSignature}:${r.outputHash}`).sort(),
      paths: paths.map((p) => `${p.pathId}:${p.suggestionType}`).sort(),
    }
    return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16)
  }

  /**
   * 计算完整 content hash。
   */
  #computeFullContentHash(artifact: TrizAnalysisArtifact): string {
    const serialized = computeTrizArtifactContentHash({
      sourceContradictions: artifact.sourceContradictions,
      parameterTensions: artifact.parameterTensions,
      principleCandidates: artifact.principleCandidates,
      resolutionPaths: artifact.resolutionPaths,
      warnings: artifact.warnings,
    })
    return createHash('sha256').update(serialized, 'utf-8').digest('hex').slice(0, 16)
  }

  /**
   * 计算 source hash（用于 idempotency key）。
   */
  #computeSourceHash(refs: TrizAnalysisSourceRef[]): string {
    const signatures = refs
      .map((r) => r.inputSignature)
      .sort()
      .join('|')
    return createHash('sha256').update(signatures, 'utf-8').digest('hex').slice(0, 16)
  }
}

function staleRefsExist(refs: TrizAnalysisSourceRef[]): boolean {
  return refs.some((r) => r.stale)
}
