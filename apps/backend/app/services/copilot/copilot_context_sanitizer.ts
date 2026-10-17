/**
 * v3-copilot-context-packet-and-project-panorama — CopilotContextSanitizer（§8）。
 *
 * 上下文包低敏 sanitizer：禁 prompt、模型输出、证据正文、原始外部载荷、
 * 敏感文件绝对路径、token、secret、Authorization、不可访问实体标题。
 *
 * 设计要点：
 * - 集中化脱敏逻辑，所有 forbidden-content 测试在此执行
 * - 负例覆盖：每类禁止内容至少一个负例样本
 * - 默认测试不调用真实 provider、模型、向量数据库或网络
 *
 * @aiproj/backend
 */
import type {
  CopilotContextAssemblyResult,
  CopilotContextPacket,
  CopilotAssemblySourceMetadata,
  CopilotMethodologyFacet,
  CopilotProjectPanorama,
  CopilotConclusionTraceEntry,
  CopilotUncertaintyEntry,
} from '@aiproj/types'
import { isCopilotFieldSensitive, isCopilotPathSensitive } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 禁止内容模式
// ---------------------------------------------------------------------------

/** 不可访问实体标题模式（不得出现在上下文包中）。 */
const INACCESSIBLE_ENTITY_TITLE_PATTERNS = [
  /inaccessible/i,
  /hidden/i,
  /denied/i,
  /forbidden/i,
  /secret/i,
]

/**
 * 方法论切面内容级敏感模式（§2.5 禁存约束）。
 * 检查字符串值中是否包含 prompt、模型输出、token、secret 的语义内容。
 * 与 isCopilotFieldSensitive（检查字段名）互补——此处检查字段值内容。
 */
const METHODOLOGY_CONTENT_SENSITIVE_PATTERNS = [
  // prompt 内容
  /prompt\s*(injection|content|template)/i,
  /system\s*prompt/i,
  /you\s+are\s+a/i,
  /ignore\s+(previous|all|above)\s+(instructions?|prompts?)/i,
  // 模型输出标记
  /model\s*output/i,
  /assistant\s*response/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[INST\]/i,
  // token/secret 值模式
  /sk[-_]proj[-_][a-zA-Z0-9]{20,}/i,
  /sk[-_][a-zA-Z0-9]{20,}/i,
  /ghp_[a-zA-Z0-9]{20,}/i,
  /gho_[a-zA-Z0-9]{20,}/i,
  /bearer\s+[a-zA-Z0-9._-]{20,}/i,
  /password\s*[=:]\s*\S{8,}/i,
  /BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY/i,
  /apiKey\s*[=:]\s*["']?[a-zA-Z0-9._-]{20,}/i,
]

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CopilotContextSanitizer 服务
// ---------------------------------------------------------------------------

export class CopilotContextSanitizer {
  /**
   * Task 8.1: 上下文包低敏 sanitizer。
   * 检查字段名是否命中敏感模式。
   */
  isFieldSensitive(fieldName: string): boolean {
    return isCopilotFieldSensitive(fieldName)
  }

  /**
   * 检查路径值是否命中敏感路径模式。
   */
  isPathSensitive(filePath: string): boolean {
    return isCopilotPathSensitive(filePath)
  }

  /**
   * 检查是否为不可访问实体标题。
   */
  isInaccessibleEntityTitle(title: string): boolean {
    return INACCESSIBLE_ENTITY_TITLE_PATTERNS.some((p) => p.test(title))
  }

  /**
   * 检查来源元数据是否包含禁止内容。
   */
  checkSourceMetadata(source: CopilotAssemblySourceMetadata): {
    safe: boolean
    violations: string[]
  } {
    const violations: string[] = []

    // 检查 sourceRef 中的敏感内容
    if (this.isFieldSensitive(source.sourceRef)) {
      violations.push(`来源引用包含敏感字段: ${source.sourceRef}`)
    }
    if (this.isPathSensitive(source.sourceRef)) {
      violations.push(`来源引用包含敏感路径: ${source.sourceRef}`)
    }

    // 检查 sourceHash
    if (this.isFieldSensitive(source.sourceHash)) {
      violations.push(`来源 hash 包含敏感内容: ${source.sourceHash}`)
    }

    return { safe: violations.length === 0, violations }
  }

  /**
   * 检查上下文包是否包含禁止内容。
   */
  checkPacket(packet: CopilotContextPacket): { safe: boolean; violations: string[] } {
    const violations: string[] = []

    // 检查来源摘要
    for (const source of packet.sources) {
      const check = this.checkSourceMetadata({
        retrievalKind: 'task' as any,
        sourceRef: source.sourceRef,
        sourceHash: source.sourceHash,
        capturedAt: '',
        hitCount: 0,
        permissionDecision: 'granted',
        packetSourceKind: source.sourceKind,
        matched: true,
      })
      if (!check.safe) violations.push(...check.violations)
    }

    // 检查截断警告
    if (packet.truncation.warning) {
      if (this.isFieldSensitive(packet.truncation.warning)) {
        violations.push('截断警告包含敏感内容')
      }
    }

    return { safe: violations.length === 0, violations }
  }

  /**
   * 检查结论追踪条目是否包含禁止内容。
   */
  checkConclusionTrace(entries: readonly CopilotConclusionTraceEntry[]): {
    safe: boolean
    violations: string[]
  } {
    const violations: string[] = []

    for (const entry of entries) {
      // 检查结论陈述
      if (this.isFieldSensitive(entry.statement)) {
        violations.push(`结论陈述包含敏感内容: ${entry.conclusionId}`)
      }
      if (this.isInaccessibleEntityTitle(entry.statement)) {
        violations.push(`结论陈述包含不可访问实体标题: ${entry.conclusionId}`)
      }

      // 检查来源引用
      for (const ref of entry.sourceRefs) {
        if (this.isFieldSensitive(ref)) {
          violations.push(`结论来源引用包含敏感内容: ${ref}`)
        }
        if (this.isPathSensitive(ref)) {
          violations.push(`结论来源引用包含敏感路径: ${ref}`)
        }
      }
    }

    return { safe: violations.length === 0, violations }
  }

  /**
   * 检查不确定条目是否包含禁止内容。
   */
  checkUncertainty(entries: readonly CopilotUncertaintyEntry[]): {
    safe: boolean
    violations: string[]
  } {
    const violations: string[] = []

    for (const entry of entries) {
      if (this.isFieldSensitive(entry.topic)) {
        violations.push(`不确定主题包含敏感内容: ${entry.uncertaintyId}`)
      }
      if (this.isInaccessibleEntityTitle(entry.topic)) {
        violations.push(`不确定主题包含不可访问实体标题: ${entry.uncertaintyId}`)
      }
    }

    return { safe: violations.length === 0, violations }
  }

  /**
   * 检查方法论切面是否包含禁止内容（§2.5 禁存约束）。
   * 覆盖所有字符串字段：summary、label、activationReason。
   * 检查 prompt 内容、模型输出、token/secret 语义模式。
   */
  checkMethodologyFacet(facet: CopilotMethodologyFacet): { safe: boolean; violations: string[] } {
    const violations: string[] = []

    for (const item of facet.guidanceItems) {
      const stringFields = [
        { name: 'summary', value: item.summary },
        { name: 'label', value: item.label },
        { name: 'activationReason', value: item.activationReason },
      ]

      for (const { name, value } of stringFields) {
        if (this.isFieldSensitive(value)) {
          violations.push(`方法论${name}包含敏感内容: ${item.itemId}`)
        }
        if (this.isPathSensitive(value)) {
          violations.push(`方法论${name}包含敏感路径: ${item.itemId}`)
        }
        // §2.5 内容级检查：prompt/模型输出/token/secret 语义模式
        if (METHODOLOGY_CONTENT_SENSITIVE_PATTERNS.some((p) => p.test(value))) {
          violations.push(`方法论${name}包含禁止内容模式(prompt/token/secret): ${item.itemId}`)
        }
      }
    }

    return { safe: violations.length === 0, violations }
  }

  /**
   * 检查项目全景是否包含禁止内容（正文型字段）。
   */
  checkPanorama(panorama: CopilotProjectPanorama): { safe: boolean; violations: string[] } {
    const violations: string[] = []

    // 全景不应包含任何正文型字段
    // 检查切面是否包含非聚合内容
    const facets = panorama.facets as Record<string, unknown>
    for (const [key, value] of Object.entries(facets)) {
      if (typeof value === 'object' && value !== null) {
        const facet = value as Record<string, unknown>
        for (const [field, fieldValue] of Object.entries(facet)) {
          if (typeof fieldValue === 'string') {
            if (this.isFieldSensitive(field)) {
              violations.push(`全景切面 ${key} 包含敏感字段: ${field}`)
            }
            if (this.isPathSensitive(fieldValue)) {
              violations.push(`全景切面 ${key} 字段 ${field} 包含敏感路径`)
            }
          }
        }
      }
    }

    return { safe: violations.length === 0, violations }
  }

  /**
   * Task 8.2: 完整上下文组装结果 sanitizer。
   * 对组装结果执行全面脱敏检查。
   */
  sanitizeAssemblyResult(result: CopilotContextAssemblyResult): {
    safe: boolean
    violations: string[]
  } {
    const violations: string[] = []

    // 1. 检查上下文包
    const packetCheck = this.checkPacket(result.packet)
    violations.push(...packetCheck.violations)

    // 2. 检查来源元数据
    for (const source of result.sources) {
      const sourceCheck = this.checkSourceMetadata(source)
      violations.push(...sourceCheck.violations)
    }

    // 3. 检查结论追踪
    const conclusionCheck = this.checkConclusionTrace(result.conclusionTrace)
    violations.push(...conclusionCheck.violations)

    // 4. 检查不确定条目
    const uncertaintyCheck = this.checkUncertainty(result.uncertainty)
    violations.push(...uncertaintyCheck.violations)

    // 5. 检查方法论切面
    if (result.methodology) {
      const methodologyCheck = this.checkMethodologyFacet(result.methodology)
      violations.push(...methodologyCheck.violations)
    }

    // 6. 检查全景
    if (result.panorama) {
      const panoramaCheck = this.checkPanorama(result.panorama)
      violations.push(...panoramaCheck.violations)
    }

    return { safe: violations.length === 0, violations }
  }

  /**
   * 清理组装结果中的敏感内容（返回清理后的新对象）。
   * 不修改原始对象。
   */
  cleanAssemblyResult(result: CopilotContextAssemblyResult): {
    cleaned: CopilotContextAssemblyResult
    removedFields: string[]
  } {
    const removedFields: string[] = []

    // 清理来源元数据中的敏感字段
    const cleanedSources = result.sources.map((source) => {
      const cleaned = { ...source }
      if (this.isFieldSensitive(source.sourceRef)) {
        removedFields.push(`sourceRef:${source.sourceRef}`)
        cleaned.sourceRef = '[REDACTED]'
      }
      return cleaned
    })

    // 清理结论追踪
    const cleanedConclusionTrace = result.conclusionTrace.map((entry) => {
      const cleaned = { ...entry }
      if (this.isFieldSensitive(entry.statement)) {
        removedFields.push(`statement:${entry.conclusionId}`)
        cleaned.statement = '[REDACTED]'
      }
      return cleaned
    })

    // 清理不确定条目
    const cleanedUncertainty = result.uncertainty.map((entry) => {
      const cleaned = { ...entry }
      if (this.isFieldSensitive(entry.topic)) {
        removedFields.push(`topic:${entry.uncertaintyId}`)
        cleaned.topic = '[REDACTED]'
      }
      return cleaned
    })

    // 清理方法论切面
    let cleanedMethodology = result.methodology
    if (result.methodology) {
      const cleanedItems = result.methodology.guidanceItems.map((item) => {
        const cleaned = { ...item }
        if (this.isFieldSensitive(item.summary)) {
          removedFields.push(`methodology:${item.itemId}`)
          cleaned.summary = '[REDACTED]'
        }
        return cleaned
      })
      cleanedMethodology = { ...result.methodology, guidanceItems: cleanedItems }
    }

    // 清理全景
    let cleanedPanorama = result.panorama
    if (result.panorama) {
      const cleanedFacets = { ...result.panorama.facets } as Record<string, unknown>
      for (const [key, value] of Object.entries(cleanedFacets)) {
        if (typeof value === 'object' && value !== null) {
          const facet = { ...(value as Record<string, unknown>) }
          for (const [field, fieldValue] of Object.entries(facet)) {
            if (
              typeof fieldValue === 'string' &&
              (this.isFieldSensitive(field) || this.isPathSensitive(fieldValue))
            ) {
              removedFields.push(`panorama.${key}.${field}`)
              facet[field] = '[REDACTED]'
            }
          }
          cleanedFacets[key] = facet
        }
      }
      cleanedPanorama = {
        ...result.panorama,
        facets: cleanedFacets as CopilotProjectPanorama['facets'],
      }
    }

    return {
      cleaned: {
        ...result,
        sources: cleanedSources,
        conclusionTrace: cleanedConclusionTrace,
        uncertainty: cleanedUncertainty,
        methodology: cleanedMethodology,
        panorama: cleanedPanorama,
      },
      removedFields,
    }
  }
}
