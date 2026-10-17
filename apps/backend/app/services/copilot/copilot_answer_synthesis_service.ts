/**
 * CopilotAnswerSynthesisService —— 三类答案的共享合成纪律。
 *
 * v3-copilot-project-health-answer / Phase 3
 *
 * 合成纪律（三类共用）：
 * - 逐句锚定：每条结论至少锚定一条素材
 * - 校验阶段剔除无锚定结论
 * - 确定性：同一素材快照产出同一结论顺序、分组与锚定关系
 * - 模型不可用时的确定性模板降级
 * - 消费既有 uncertainty 三分，不另造不确定表达
 *
 * 红线：
 * - 答案是「合成」不是「生成」：模型不得引入素材外的事实
 * - 无足够素材时明确说「暂无足够依据」，不编造
 * - 每条结论可追溯到具体来源
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import type {
  CopilotAnswerEntry,
  CopilotAnswerKind,
  CopilotConfidenceBand,
  CopilotSourceRef,
  CopilotUncertaintyEntry,
  CopilotConclusionTraceEntry,
} from '@aiproj/types'
import {
  HEALTH_ANSWER_TEMPLATES,
  PAGE_USAGE_ANSWER_TEMPLATES,
  TERM_ANSWER_TEMPLATES,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 素材条目（统一抽象）。 */
export interface SynthesisMaterialEntry {
  /** 素材 ID。 */
  readonly materialId: string
  /** 素材类型。 */
  readonly materialKind:
    'diagnosis-item' | 'prediction-signal' | 'knowledge-entry' | 'command-metadata'
  /** 素材摘要（低敏）。 */
  readonly summary: string
  /** 严重度（可选）。 */
  readonly severity?: string
  /** 影响分数（可选）。 */
  readonly scoreImpact?: number
  /** 分组。 */
  readonly group: string
  /** 置信度。 */
  readonly confidence: CopilotConfidenceBand
}

/** 合成结果（中间类型）。 */
export interface SynthesisResult {
  /** 结论条目集合（已校验锚定）。 */
  readonly entries: readonly CopilotAnswerEntry[]
  /** 是否为模型不可用时的确定性模板降级。 */
  readonly isFallback: boolean
  /** 降级原因（仅 isFallback=true 时有值）。 */
  readonly fallbackReason?: string
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export default class CopilotAnswerSynthesisService {
  // -----------------------------------------------------------------------
  // 主合成入口
  // -----------------------------------------------------------------------

  /**
   * 合成答案：从素材生成结论条目集合。
   *
   * @param answerKind 答案类型
   * @param materials 素材条目集合
   * @param uncertainty 不确定三分条目（来自上下文装配）
   * @param conclusionTrace 结论回溯条目（来自上下文装配）
   * @param modelAvailable 模型是否可用
   * @returns 合成结果
   */
  synthesize(
    answerKind: CopilotAnswerKind,
    materials: readonly SynthesisMaterialEntry[],
    uncertainty: readonly CopilotUncertaintyEntry[],
    _conclusionTrace: readonly CopilotConclusionTraceEntry[],
    modelAvailable: boolean = true,
  ): SynthesisResult {
    // Step 1: 如果素材为空，返回「暂无足够依据」
    if (materials.length === 0) {
      return this.buildInsufficientResult(answerKind, uncertainty)
    }

    // Step 2: 按分组排序素材（确定性）
    const sortedMaterials = this.sortMaterialsDeterministically(materials)

    // Step 3: 从素材生成候选结论
    const candidateEntries = this.generateCandidateEntries(answerKind, sortedMaterials)

    // Step 4: 校验锚定（剔除无锚定结论）
    const anchoredEntries = this.validateAnchoring(candidateEntries, sortedMaterials)

    // Step 5: 消费 uncertainty 三分
    const entriesWithUncertainty = this.consumeUncertainty(anchoredEntries, uncertainty)

    // Step 6: 如果模型不可用，使用确定性模板降级
    if (!modelAvailable) {
      return this.buildFallbackResult(answerKind, sortedMaterials, entriesWithUncertainty)
    }

    return {
      entries: entriesWithUncertainty,
      isFallback: false,
    }
  }

  // -----------------------------------------------------------------------
  // 确定性排序
  // -----------------------------------------------------------------------

  /**
   * 按分组排序素材（确定性）。
   * 同一分组内按 materialId 排序（字母序）。
   */
  private sortMaterialsDeterministically(
    materials: readonly SynthesisMaterialEntry[],
  ): readonly SynthesisMaterialEntry[] {
    return [...materials].sort((a, b) => {
      // 先按分组排序
      const groupCompare = a.group.localeCompare(b.group)
      if (groupCompare !== 0) return groupCompare

      // 同一分组内按 materialId 排序
      return a.materialId.localeCompare(b.materialId)
    })
  }

  // -----------------------------------------------------------------------
  // 候选结论生成
  // -----------------------------------------------------------------------

  /**
   * 从素材生成候选结论条目。
   */
  private generateCandidateEntries(
    answerKind: CopilotAnswerKind,
    materials: readonly SynthesisMaterialEntry[],
  ): readonly CopilotAnswerEntry[] {
    const entries: CopilotAnswerEntry[] = []

    // 按分组聚合素材
    const groupedMaterials = new Map<string, SynthesisMaterialEntry[]>()
    for (const material of materials) {
      const group = groupedMaterials.get(material.group) ?? []
      group.push(material)
      groupedMaterials.set(material.group, group)
    }

    // 为每个分组生成结论
    let entryIndex = 0
    for (const [group, groupMaterials] of groupedMaterials) {
      // 按严重度/影响排序（确定性破平局）
      const sortedGroupMaterials = [...groupMaterials].sort((a, b) => {
        const sevCompare = this.compareSeverity(b.severity, a.severity)
        if (sevCompare !== 0) return sevCompare
        return (b.scoreImpact ?? 0) - (a.scoreImpact ?? 0)
      })

      // 生成分组结论
      const statement = this.generateGroupStatement(answerKind, group, sortedGroupMaterials)
      const sourceRefs = sortedGroupMaterials.map((m) => ({
        sourceKind: m.materialKind as CopilotSourceRef['sourceKind'],
        sourceId: m.materialId,
        summary: m.summary,
      }))

      entries.push({
        entryId: `entry-${entryIndex++}`,
        statement,
        sourceRefs,
        confidence: this.deriveGroupConfidence(sortedGroupMaterials),
        group,
      })
    }

    return entries
  }

  // -----------------------------------------------------------------------
  // 锚定校验
  // -----------------------------------------------------------------------

  /**
   * 校验锚定：每条结论至少锚定一条素材。
   * 无锚定的结论被剔除。
   */
  private validateAnchoring(
    entries: readonly CopilotAnswerEntry[],
    _materials: readonly SynthesisMaterialEntry[],
  ): readonly CopilotAnswerEntry[] {
    return entries.filter((entry) => entry.sourceRefs.length > 0)
  }

  // -----------------------------------------------------------------------
  // 消费 uncertainty 三分
  // -----------------------------------------------------------------------

  /**
   * 消费既有 uncertainty 三分，不另造不确定表达。
   */
  private consumeUncertainty(
    entries: readonly CopilotAnswerEntry[],
    uncertainty: readonly CopilotUncertaintyEntry[],
  ): readonly CopilotAnswerEntry[] {
    // uncertainty 条目不直接生成结论，但影响置信度
    // 如果有 no-match 不确定性，降低整体置信度
    const hasNoMatch = uncertainty.some((u) => u.kind === 'no-match')
    const hasNotAccessible = uncertainty.some((u) => u.kind === 'not-accessible')

    if (hasNoMatch || hasNotAccessible) {
      // 降低置信度
      return entries.map((entry) => ({
        ...entry,
        confidence: this.lowerConfidence(entry.confidence),
      }))
    }

    return entries
  }

  // -----------------------------------------------------------------------
  // 确定性模板降级
  // -----------------------------------------------------------------------

  /**
   * 模型不可用时的确定性模板降级。
   */
  private buildFallbackResult(
    answerKind: CopilotAnswerKind,
    materials: readonly SynthesisMaterialEntry[],
    entries: readonly CopilotAnswerEntry[],
  ): SynthesisResult {
    const templates = this.getTemplates(answerKind)
    const fallbackEntries: CopilotAnswerEntry[] = []

    // 使用模板生成降级结论
    let entryIndex = 0
    for (const template of templates) {
      // 查找匹配分组的素材
      const groupMaterials = materials.filter((m) => m.group === template.group)
      if (groupMaterials.length === 0) continue

      // 用模板生成结论（确定性）
      const statement = this.applyTemplate(template.template, groupMaterials)
      const sourceRefs = groupMaterials.map((m) => ({
        sourceKind: m.materialKind as CopilotSourceRef['sourceKind'],
        sourceId: m.materialId,
        summary: m.summary,
      }))

      fallbackEntries.push({
        entryId: `fallback-${entryIndex++}`,
        statement,
        sourceRefs,
        confidence: template.confidence,
        group: template.group,
      })
    }

    // 如果模板没有覆盖任何分组，使用原始条目
    const finalEntries = fallbackEntries.length > 0 ? fallbackEntries : entries

    return {
      entries: finalEntries,
      isFallback: true,
      fallbackReason: '模型服务不可用，使用确定性模板降级',
    }
  }

  // -----------------------------------------------------------------------
  // 「暂无足够依据」结果
  // -----------------------------------------------------------------------

  /**
   * 构建「暂无足够依据」结果。
   */
  private buildInsufficientResult(
    _answerKind: CopilotAnswerKind,
    _uncertainty: readonly CopilotUncertaintyEntry[],
  ): SynthesisResult {
    // 返回空条目集合（由调用方包装为 CopilotAnswerInsufficient）
    return {
      entries: [],
      isFallback: false,
    }
  }

  // -----------------------------------------------------------------------
  // 辅助方法
  // -----------------------------------------------------------------------

  /**
   * 严重度比较（确定性）。
   */
  private compareSeverity(a: string | undefined, b: string | undefined): number {
    const order = { critical: 4, high: 3, medium: 2, low: 1, ok: 0 }
    const scoreA = order[a as keyof typeof order] ?? 0
    const scoreB = order[b as keyof typeof order] ?? 0
    return scoreA - scoreB
  }

  /**
   * 生成分组结论陈述。
   */
  private generateGroupStatement(
    _answerKind: CopilotAnswerKind,
    group: string,
    materials: readonly SynthesisMaterialEntry[],
  ): string {
    // 简单的确定性模板（后续可由模型优化）
    const count = materials.length
    const groupLabel = this.getGroupLabel(group)

    if (count === 1) {
      return `${groupLabel}：${materials[0].summary}`
    }

    return `${groupLabel}：共 ${count} 项，${materials[0].summary}等`
  }

  /**
   * 获取分组标签。
   */
  private getGroupLabel(group: string): string {
    const labels: Record<string, string> = {
      overall: '整体健康状况',
      progress: '进度维度',
      critical_path: '关键路径',
      milestone: '里程碑',
      resource: '资源',
      risk: '风险',
      capabilities: '页面功能',
      term: '术语解释',
    }
    return labels[group] ?? group
  }

  /**
   * 推导分组置信度。
   */
  private deriveGroupConfidence(
    materials: readonly SynthesisMaterialEntry[],
  ): CopilotConfidenceBand {
    const confidences = materials.map((m) => m.confidence)
    if (confidences.every((c) => c === 'high')) return 'high'
    if (confidences.some((c) => c === 'low')) return 'low'
    if (confidences.some((c) => c === 'fallback')) return 'fallback'
    return 'medium'
  }

  /**
   * 降低置信度。
   */
  private lowerConfidence(confidence: CopilotConfidenceBand): CopilotConfidenceBand {
    const levels: CopilotConfidenceBand[] = ['high', 'medium', 'low', 'fallback']
    const index = levels.indexOf(confidence)
    return levels[Math.min(index + 1, levels.length - 1)]
  }

  /**
   * 获取模板。
   */
  private getTemplates(answerKind: CopilotAnswerKind) {
    switch (answerKind) {
      case 'health':
        return HEALTH_ANSWER_TEMPLATES
      case 'page-usage':
        return PAGE_USAGE_ANSWER_TEMPLATES
      case 'term-explanation':
        return TERM_ANSWER_TEMPLATES
    }
  }

  /**
   * 应用模板。
   */
  private applyTemplate(template: string, materials: readonly SynthesisMaterialEntry[]): string {
    // 简单的模板替换（后续可由模型优化）
    let result = template
    for (const material of materials) {
      // 替换占位符
      result = result.replace(/\{[^}]+\}/, material.summary)
    }
    return result
  }

  /**
   * 推导缺失原因。
   */
  public deriveInsufficientReason(
    _answerKind: CopilotAnswerKind,
    uncertainty: readonly CopilotUncertaintyEntry[],
  ): string {
    if (uncertainty.length === 0) {
      return '素材不足'
    }

    const kinds = uncertainty.map((u) => u.kind)
    if (kinds.includes('not-accessible')) {
      return '当前账号能力范围内无法获取该信息'
    }
    if (kinds.includes('no-match')) {
      return '未检索到与该问题匹配的项目信息'
    }
    return '素材不足'
  }
}
