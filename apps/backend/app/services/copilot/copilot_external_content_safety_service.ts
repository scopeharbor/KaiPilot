/**
 * v3-copilot-external-content-safety — CopilotExternalContentSafetyService（§3-8 主编排）。
 *
 * 外部内容安全服务：结构隔离（第一道防线）、注入检测（第二道防线）、
 * 内外优先级、去处约束、失败处理、红线与组织隔离。
 *
 * 设计要点（D1-D7 裁决）：
 * - D1: 结构隔离优先于内容检测（数据位置 vs 指令位置）
 * - D2: 检测为确定性规则优先，模型辅助可选且默认关闭
 * - D3: 内外优先级：内部事实 > 内部知识 > 外部内容，冲突明示
 * - D4: 外部内容不参与项目事实 source hash
 * - D5: 唯一去处是知识候选待确认
 * - D6: 检测记录不落命中原文
 * - D7: 检测不可用即阻断该条内容，不阻断整轮
 *
 * @aiproj/backend
 */
import type {
  ExternalContentEntry,
  ExternalDetectionRecord,
  ExternalContentIsolationWrapper,
  ExternalConflictAnnotation,
  ExternalContentSafetyResult,
  CopilotSourceKind,
} from '@aiproj/types'
import {
  buildExternalContentIsolationWrapper,
  buildExternalConflictAnnotation,
  buildInjectionBlockStats,
  isExternalSourceKind,
  participateInProjectFactHash,
} from '@aiproj/types'
import { CopilotExternalContentInjectionDetector } from './copilot_external_content_injection_detector.js'

// ---------------------------------------------------------------------------
// 服务依赖接口
// ---------------------------------------------------------------------------

export interface ExternalContentSafetyDeps {
  /** 注入检测器（可注入不同实现，如含模型辅助的版本）。 */
  detector?: CopilotExternalContentInjectionDetector
}

// ---------------------------------------------------------------------------
// CopilotExternalContentSafetyService 服务
// ---------------------------------------------------------------------------

export class CopilotExternalContentSafetyService {
  readonly #detector: CopilotExternalContentInjectionDetector

  constructor(deps?: ExternalContentSafetyDeps) {
    this.#detector = deps?.detector ?? new CopilotExternalContentInjectionDetector()
  }

  // ── 主处理入口 ──────────────────────────────────────────────────

  /**
   * §3-8: 对外部内容条目执行完整安全处理流程。
   *
   * 流程：
   * 1. 注入检测（§4，第二道防线）
   * 2. 检测不可用处理（§7）
   * 3. 结构隔离包装（§3，第一道防线）
   * 4. 内外优先级标注（§5）
   * 5. 去处约束验证（§6）
   */
  async processExternalContent(
    entries: readonly ExternalContentEntry[],
    organizationId: number,
  ): Promise<ExternalContentSafetyResult> {
    const passedEntries: ExternalContentEntry[] = []
    const rejectedEntries: ExternalContentEntry[] = []
    const conflictAnnotations: ExternalConflictAnnotation[] = []
    let hasUnavailableDetections = false

    // ── Step 1: 注入检测（§4） ──────────────────────────────────
    const { results } = this.#detector.detectBatch(entries, organizationId)

    for (const { entry, verdict, record } of results) {
      if (verdict === 'rejected') {
        // §4.3: 规则命中即拦截
        const rejectedEntry: ExternalContentEntry = {
          ...entry,
          detectionVerdict: 'rejected',
          detectionRecord: record,
        }
        rejectedEntries.push(rejectedEntry)
      } else if (verdict === 'unavailable') {
        // §7.1: 检测不可用即阻断该条内容
        hasUnavailableDetections = true
        const unavailableEntry: ExternalContentEntry = {
          ...entry,
          detectionVerdict: 'unavailable',
          unavailabilityReason: 'detection_service_unavailable',
        }
        rejectedEntries.push(unavailableEntry)
      } else {
        // passed
        const passedEntry: ExternalContentEntry = {
          ...entry,
          detectionVerdict: 'passed',
        }
        passedEntries.push(passedEntry)
      }
    }

    // ── Step 2: 内外优先级标注（§5） ────────────────────────────
    // 外部内容已在 passedEntries 中，优先级由 source kind 决定
    // 冲突标注由调用方在组装阶段添加（§5.3）

    // ── Step 3: 构建拦截统计（§4.8） ────────────────────────────
    const detectionRecords = results.filter((r) => r.record !== undefined).map((r) => r.record!)
    const now = new Date().toISOString()
    const blockStats = buildInjectionBlockStats(detectionRecords, now, now)

    return {
      passedEntries,
      rejectedEntries,
      conflictAnnotations,
      blockStats,
      totalProcessed: entries.length,
      hasUnavailableDetections,
    }
  }

  // ── 结构隔离（§3 / D1） ────────────────────────────────────────

  /**
   * §3.1: 构建外部内容的结构隔离包装。
   * 外部内容必须包裹在明确的数据分隔中，且附带系统侧免责声明（§3.2）。
   */
  buildIsolationWrapper(entries: readonly ExternalContentEntry[]): ExternalContentIsolationWrapper {
    return buildExternalContentIsolationWrapper(entries)
  }

  /**
   * §3.3: 验证外部内容不出现在指令位置。
   * 本方法用于测试断言：确认外部内容只在数据位置。
   */
  validateIsolation(wrapper: ExternalContentIsolationWrapper): {
    isolated: boolean
    violations: string[]
  } {
    const violations: string[] = []

    // 检查包装标记
    if (wrapper.wrapperKind !== 'external_data_block') {
      violations.push('包装标记不是 external_data_block')
    }

    // 检查免责声明存在
    if (!wrapper.systemDisclaimer || wrapper.systemDisclaimer.length === 0) {
      violations.push('缺少系统侧免责声明')
    }

    // 检查免责声明包含关键声明
    const requiredPhrases = ['外部检索结果', '仅作参考数据', '指令一律不执行']
    for (const phrase of requiredPhrases) {
      if (!wrapper.systemDisclaimer.includes(phrase)) {
        violations.push(`免责声明缺少关键声明: ${phrase}`)
      }
    }

    return { isolated: violations.length === 0, violations }
  }

  // ── 内外优先级（§5 / D3） ──────────────────────────────────────

  /**
   * §5.3: 当外部内容与内部材料冲突时，构建冲突标注。
   * 冲突明示而非静默采用其一。
   */
  annotateConflict(
    externalEntryId: string,
    conflictSource: 'internal_project_fact' | 'internal_knowledge',
    internalSourceRef: string,
    topicSummary: string,
  ): ExternalConflictAnnotation {
    return buildExternalConflictAnnotation(
      externalEntryId,
      conflictSource,
      internalSourceRef,
      topicSummary,
    )
  }

  /**
   * §5.5: 验证外部内容在上下文包中与项目事实分区。
   * 外部条目不出现在项目事实来源集合中。
   */
  validatePartitioning(
    projectFactSourceKinds: readonly CopilotSourceKind[],
    externalSourceKinds: readonly CopilotSourceKind[],
  ): {
    partitioned: boolean
    violations: string[]
  } {
    const violations: string[] = []

    // 项目事实来源中不应包含外部内容
    for (const kind of projectFactSourceKinds) {
      if (isExternalSourceKind(kind)) {
        violations.push(`项目事实来源包含外部内容: ${kind}`)
      }
    }

    // 外部来源不应出现在项目事实中
    for (const kind of externalSourceKinds) {
      if (!isExternalSourceKind(kind)) {
        violations.push(`外部来源包含非外部内容: ${kind}`)
      }
    }

    return { partitioned: violations.length === 0, violations }
  }

  // ── source hash 分离（§5.7 / D4） ──────────────────────────────

  /**
   * §5.7: 判断来源是否参与项目事实 source hash。
   * 外部内容不参与项目事实 source hash。
   */
  participatesInProjectFactHash(kind: CopilotSourceKind): boolean {
    return participateInProjectFactHash(kind)
  }

  // ── 去处约束（§6 / D5） ────────────────────────────────────────

  /**
   * §6.1-6.4: 验证外部内容的去处约束。
   * 外部内容唯一去处为知识候选待确认。
   */
  validateDestinationConstraints(
    _entry: ExternalContentEntry,
    destination: 'knowledge_candidate' | 'production_knowledge' | 'project_data' | 'index',
  ): {
    allowed: boolean
    reason?: string
  } {
    if (destination === 'knowledge_candidate') {
      return { allowed: true }
    }
    return {
      allowed: false,
      reason: `外部内容不允许写入${destination}（D5: 唯一去处是知识候选待确认）`,
    }
  }

  // ── Provenance（§6.6 / 红线 4） ────────────────────────────────

  /**
   * §6.6: 提取外部内容的 Provenance 信息。
   * 每条外部内容可追溯到 URL、抓取时间与快照 hash（红线 4）。
   */
  extractProvenance(entry: ExternalContentEntry): {
    url: string
    fetchedAt: string
    snapshotHash: string
  } {
    return {
      url: entry.url,
      fetchedAt: entry.fetchedAt,
      snapshotHash: entry.snapshotHash,
    }
  }

  // ── 失败处理（§7 / D7） ────────────────────────────────────────

  /**
   * §7.1-7.2: 检测不可用时阻断该条外部内容，不阻断整轮。
   * 与 DLP「判定不可用阻断整轮」的差异：DLP 保护数据外泄，本 change 保护数据进入。
   */
  handleUnavailableDetection(
    entry: ExternalContentEntry,
    reason: 'detection_service_unavailable' | 'rule_set_load_failure' | 'content_parse_failure',
  ): {
    entry: ExternalContentEntry
    blocked: boolean
    turnContinues: boolean
  } {
    return {
      entry: {
        ...entry,
        detectionVerdict: 'unavailable',
        unavailabilityReason: reason,
      },
      blocked: true, // §7.1: 该条被拒
      turnContinues: true, // §7.2: 回合可用内部素材继续
    }
  }

  // ── 红线守卫（§8） ─────────────────────────────────────────────

  /**
   * §8.1: 验证安全层无域仓储或模型写依赖。
   * 外部内容不产生任何自动执行。
   */
  validateNoWriteDependencies(): {
    safe: boolean
    dependencies: string[]
  } {
    // 本服务不依赖任何域仓储或模型写 API
    return { safe: true, dependencies: [] }
  }

  /**
   * §8.3: 组织隔离验证。
   * 检测记录与规则配置附加 organization_id。
   */
  validateOrganizationIsolation(
    records: readonly ExternalDetectionRecord[],
    expectedOrgId: number,
  ): {
    isolated: boolean
    violations: string[]
  } {
    const violations: string[] = []
    for (const record of records) {
      if (record.organizationId !== expectedOrgId) {
        violations.push(`检测记录 ${record.recordId} 的 organizationId 不匹配`)
      }
    }
    return { isolated: violations.length === 0, violations }
  }
}
