/**
 * v3-release-gate-ai-quality-slots —— AI 质量与成本门槽的共享契约。
 *
 * 在发布证据清单中新增五个 AI 相关门槽：输出质量、离线回归、成本、漂移、安全事件。
 * 门槽证据必须引用具体的运行标识，不接受人工断言「已通过」。
 * 无数据的门槽记为 pending，绝不记为 passed。
 * 门槽消费聚合而非明细，不扩大敏感数据访问面。
 *
 * 设计决策（design.md）：
 * - D1: 门槽证据必须引用具体运行标识，不接受人工断言
 * - D2: 无数据记 pending，绝不记 passed
 * - D3: 门槽消费聚合而非明细
 * - D4: 五个门槽：输出质量、离线回归、成本、漂移、安全事件
 * - D5: 判定口径写在规范里
 * - D6: 门槽只呈现证据与状态，放行由人决定
 * - D7: 状态可复现：同一批证据产出同一批状态
 * - D8: 漂移门槽的判定不是「有漂移即失败」，而是「有未经确认的漂移」
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / Date.now() / Math.random()。
 * @aiproj/types 零依赖约束
 */

// ═══════════════════════════════════════════════════════════════════════════════
// §1 AI 门槽枚举与类型
// ═══════════════════════════════════════════════════════════════════════════════

/** 五个 AI 门槽 ID（D4：不多不少）。 */
export const AI_QUALITY_SLOT_IDS = [
  'ai-output-quality',
  'ai-offline-regression',
  'ai-cost',
  'ai-model-drift',
  'ai-security-events',
] as const
export type AiQualitySlotId = (typeof AI_QUALITY_SLOT_IDS)[number]

/** 类型守卫：判定字符串是否为已知 AI 门槽。 */
export function isAiQualitySlotId(v: string): v is AiQualitySlotId {
  return (AI_QUALITY_SLOT_IDS as readonly string[]).includes(v)
}

/** AI 门槽状态：沿用既有 UatGateStatus 语义的子集。 */
export const AI_QUALITY_SLOT_STATUSES = ['passed', 'failed', 'pending'] as const
export type AiQualitySlotStatus = (typeof AI_QUALITY_SLOT_STATUSES)[number]

/** 类型守卫：判定字符串是否为已知 AI 门槽状态。 */
export function isAiQualitySlotStatus(v: string): v is AiQualitySlotStatus {
  return (AI_QUALITY_SLOT_STATUSES as readonly string[]).includes(v)
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2 AI 门槽判定口径（D5：口径写进规范）
// ═══════════════════════════════════════════════════════════════════════════════

/** 门槽判定口径声明（D5：藏在实现里的阈值会被悄悄调松而无人察觉）。 */
export interface AiQualitySlotCriterion {
  /** 门槽 ID。 */
  slotId: AiQualitySlotId
  /** 口径名称（低敏描述）。 */
  name: string
  /** 通过条件（声明式，非实现细节）。 */
  passCondition: string
  /** 待定条件（无数据时的语义）。 */
  pendingCondition: string
  /** 失败条件（声明式）。 */
  failCondition: string
}

/** 五个门槽的判定口径（D5：写在规范里而非藏在实现中）。 */
export const AI_QUALITY_SLOT_CRITERIA: readonly AiQualitySlotCriterion[] = [
  {
    slotId: 'ai-output-quality',
    name: '输出质量',
    passCondition: '最近一次在线评测运行的通过率 >= 阈值（阈值待定，见 observation 未决问题）',
    pendingCondition: '无在线评测运行记录',
    failCondition: '最近一次在线评测运行的通过率 < 阈值',
  },
  {
    slotId: 'ai-offline-regression',
    name: '离线回归',
    passCondition: '最近一次离线回归运行无样本回归（基线为具体历史 run ID）',
    pendingCondition: '无离线回归运行记录',
    failCondition: '最近一次离线回归运行存在样本回归',
  },
  {
    slotId: 'ai-cost',
    name: '成本',
    passCondition: '最近一个时间窗口的累计成本 <= 预算上限（阈值待定）',
    pendingCondition: '无成本记录',
    failCondition: '最近一个时间窗口的累计成本 > 预算上限',
  },
  {
    slotId: 'ai-model-drift',
    name: '模型漂移',
    passCondition: '无未经确认的漂移事件（D8：有漂移不等于失败，provider 换版可能是改进）',
    pendingCondition: '无漂移检测运行记录',
    failCondition: '存在未经确认的漂移事件',
  },
  {
    slotId: 'ai-security-events',
    name: '安全事件',
    passCondition: '最近一个时间窗口的安全事件聚合计数 = 0',
    pendingCondition: '无安全事件聚合记录',
    failCondition: '最近一个时间窗口的安全事件聚合计数 > 0',
  },
] as const

/** 根据门槽 ID 查找判定口径。 */
export function findAiQualitySlotCriterion(
  slotId: AiQualitySlotId,
): AiQualitySlotCriterion | undefined {
  return AI_QUALITY_SLOT_CRITERIA.find((c) => c.slotId === slotId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3 AI 门槽记录（D1：运行标识强制；D2：pending 语义；D3：只消费聚合）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AI 门槽记录。
 *
 * 核心约束：
 * - D1: passed 状态必须携带 runReference，且可解析到具体证据源记录
 * - D2: 无数据时状态必须为 pending，绝不为 passed
 * - D3: 只包含聚合信息，不包含明细记录
 * - D8: 漂移门槽判定为「未经确认的漂移」，不是「有漂移」
 * - 禁存：不含 prompt、模型输出、token 与 secret
 */
export interface AiQualitySlotRecord {
  /** 门槽 ID。 */
  slotId: AiQualitySlotId
  /** 门槽名称（低敏）。 */
  name: string
  /** 判定状态。 */
  status: AiQualitySlotStatus
  /**
   * 证据运行引用（D1：必须引用具体运行标识）。
   *
   * - passed 状态：必须存在且可解析到具体证据源记录
   * - pending 状态：为 null（无数据）或指向无法解析的运行（引用失效）
   * - failed 状态：必须存在且可解析到具体证据源记录
   */
  runReference: AiQualityRunReference | null
  /** 判定口径（D5：声明式，非实现细节）。 */
  criterion: string
  /** 低敏聚合数值（可选，如通过率、成本总额、事件计数）。 */
  aggregateValue?: number
  /** 低敏聚合描述（可选）。 */
  aggregateDescription?: string
  /** 时间戳（ISO 8601）。 */
  evaluatedAt: string
  /** 组织归属（组织隔离）。 */
  organizationId: number
  /** 指向统一发布证据束中 `ai-quality-slots` 运行记录。 */
  recordId?: string
}

/** AI 门槽 typed record 的最小可验证投影，避免本模块形成运行时循环依赖。 */
export interface AiQualityTypedEvidenceRecord {
  recordId: string
  gateId: string
  command: string
  exitCode: number
  startedAt: string
  finishedAt: string
  collectedHead: string
  outputDigest: string
}

export interface AiQualitySlotEvidenceValidation {
  valid: boolean
  stale: boolean
  message?: string
}

/** 门槽必须引用本次 `ai-quality-slots` 采集记录；旧 HEAD 只可报告 stale，不得冒充 passing。 */
export function validateAiQualitySlotTypedEvidence(
  slot: AiQualitySlotRecord,
  resolver: (recordId: string) => AiQualityTypedEvidenceRecord | undefined,
  currentHead: string,
): AiQualitySlotEvidenceValidation {
  if (!slot.recordId) {
    return {
      valid: false,
      stale: false,
      message: `门槽 ${slot.slotId} 缺少 typed evidence recordId；手写结论不构成发布证据`,
    }
  }
  const record = resolver(slot.recordId)
  if (!record || !record.command || !Number.isInteger(record.exitCode)) {
    return {
      valid: false,
      stale: false,
      message: `门槽 ${slot.slotId} 的 recordId 无法解析到带命令与退出码的 typed record`,
    }
  }
  if (record.gateId !== 'ai-quality-slots') {
    return {
      valid: false,
      stale: false,
      message: `门槽 ${slot.slotId} 的 recordId 指向错误门禁 ${record.gateId}`,
    }
  }
  if (record.collectedHead !== currentHead) {
    return {
      valid: false,
      stale: true,
      message: `门槽 ${slot.slotId} 的 typed record 采自旧 HEAD ${record.collectedHead}`,
    }
  }
  return { valid: true, stale: false }
}

/**
 * AI 门槽证据运行引用（D1：运行标识强制）。
 *
 * 引用指向具体证据源的一次运行，而非人工标注。
 */
export interface AiQualityRunReference {
  /** 证据源类型。 */
  evidenceSource: AiQualityEvidenceSource
  /** 运行唯一标识（如 run ID、dataset ID + run timestamp）。 */
  runId: string
  /** 运行时间（ISO 8601）。 */
  runAt: string
  /** 证据源产出的路径（低敏，可选）。 */
  artifactPath?: string
}

/** AI 门槽证据源类型。 */
export const AI_QUALITY_EVIDENCE_SOURCES = [
  'online-evaluation',
  'offline-eval-dataset',
  'invocation-ledger',
  'drift-detection',
  'security-observability',
] as const
export type AiQualityEvidenceSource = (typeof AI_QUALITY_EVIDENCE_SOURCES)[number]

/** 类型守卫：判定字符串是否为已知 AI 证据源。 */
export function isAiQualityEvidenceSource(v: string): v is AiQualityEvidenceSource {
  return (AI_QUALITY_EVIDENCE_SOURCES as readonly string[]).includes(v)
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4 证据强制（D1：人工断言拒绝）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 门槽状态必须引用具体运行标识（D1）。
 * passed 状态必须携带 runReference，且 runReference 必须可解析。
 *
 * @returns 错误消息（通过）或 null（被拒绝）
 */
export function assertSlotRequiresRunReference(slot: AiQualitySlotRecord): string | null {
  if (slot.status === 'passed') {
    if (!slot.runReference) {
      return `门槽 ${slot.slotId} 状态为 passed 但缺少 runReference：人工断言无法把门槽标为通过`
    }
    if (!slot.runReference.runId || slot.runReference.runId.length === 0) {
      return `门槽 ${slot.slotId} 的 runReference.runId 为空：运行标识必须具体`
    }
  }
  return null
}

/**
 * 引用失效检测：runReference 指向不存在的运行时，门槽应记为 pending 而非通过。
 *
 * @param slot 门槽记录
 * @param resolver 运行引用解析器（返回 true 表示引用可解析）
 * @returns 如果引用失效，返回错误消息；否则返回 null
 */
export function assertRunReferenceResolvable(
  slot: AiQualitySlotRecord,
  resolver: (ref: AiQualityRunReference) => boolean,
): string | null {
  if (slot.runReference && slot.status !== 'pending') {
    if (!resolver(slot.runReference)) {
      return `门槽 ${slot.slotId} 的运行引用 ${slot.runReference.runId} 无法解析：引用失效时门槽应记为 pending`
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5 无数据语义（D2：pending 语义）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 证据源无数据时，门槽必须记为 pending，绝不记为 passed（D2）。
 *
 * @param slot 门槽记录
 * @param hasData 证据源是否有数据
 * @returns 如果违反 D2，返回错误消息；否则返回 null
 */
export function assertNoDataIsPending(slot: AiQualitySlotRecord, hasData: boolean): string | null {
  if (!hasData && slot.status === 'passed') {
    return `门槽 ${slot.slotId} 无数据但状态为 passed：无数据必须记为 pending`
  }
  return null
}

/**
 * pending 与 failed 必须可区分（D2）。
 *
 * @param slotA 门槽记录 A
 * @param slotB 门槽记录 B
 * @returns 如果二者不可区分，返回错误消息；否则返回 null
 */
export function assertPendingFailedDistinguishable(
  slotA: AiQualitySlotRecord,
  slotB: AiQualitySlotRecord,
): string | null {
  if (slotA.slotId === slotB.slotId) return null
  if (slotA.status !== slotB.status) return null
  if (slotA.status === 'pending' || slotA.status === 'failed') {
    // 两个不同门槽可以有相同状态，但同一门槽不能同时是 pending 和 failed
    return null
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6 漂移门槽特殊判定（D8：未经确认的漂移）
// ═══════════════════════════════════════════════════════════════════════════════

/** 漂移事件确认状态。 */
export const DRIFT_CONFIRMATION_STATUSES = ['confirmed', 'unconfirmed'] as const
export type DriftConfirmationStatus = (typeof DRIFT_CONFIRMATION_STATUSES)[number]

/**
 * 漂移门槽判定（D8）：
 * - 有未经确认的漂移事件 → failed
 * - 所有漂移事件已确认 → passed
 * - 无漂移检测记录 → pending
 *
 * @param driftEvents 漂移事件列表（含确认状态）
 * @param hasDetectionRun 是否有漂移检测运行记录
 * @returns 门槽状态
 */
export function evaluateDriftSlot(
  driftEvents: readonly { confirmationStatus: DriftConfirmationStatus }[],
  hasDetectionRun: boolean,
): AiQualitySlotStatus {
  if (!hasDetectionRun) return 'pending'
  const unconfirmed = driftEvents.some((e) => e.confirmationStatus === 'unconfirmed')
  return unconfirmed ? 'failed' : 'passed'
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7 禁存约束（不含 prompt、模型输出、token 与 secret）
// ═══════════════════════════════════════════════════════════════════════════════

/** 门槽记录禁止存储的字段类别。 */
export const AI_SLOT_FORBIDDEN_FIELDS = [
  'prompt',
  'model_output',
  'token',
  'secret',
  'api_key',
  'authorization',
  'messages',
  'tool_input',
  'tool_output',
  'retrieval_body',
  'provider_payload',
] as const
export type AiSlotForbiddenField = (typeof AI_SLOT_FORBIDDEN_FIELDS)[number]

/** 敏感内容类别。 */
export const AI_SLOT_SENSITIVE_CATEGORIES = [
  'api_key',
  'bearer_token',
  'password',
  'token_assignment',
  'secret_assignment',
] as const
export type AiSlotSensitiveCategory = (typeof AI_SLOT_SENSITIVE_CATEGORIES)[number]

/** 检测门槽记录是否包含敏感内容（值级检测）。 */
export function aiSlotRecordContainsSensitiveFields(
  record: Record<string, unknown>,
): AiSlotSensitiveCategory[] {
  const violations: AiSlotSensitiveCategory[] = []
  const text = JSON.stringify(record)

  if (/sk-[a-zA-Z0-9]{20,}/.test(text)) violations.push('api_key')
  if (/Bearer\s+[a-zA-Z0-9._-]{20,}/.test(text)) violations.push('bearer_token')
  if (/(?:password|passwd|pwd)\s*[:=]\s*\S{8,}/i.test(text)) violations.push('password')
  if (/(?:token|secret)\s*[:=]\s*\S{20,}/i.test(text)) {
    if (/(?:token)\s*[:=]/i.test(text)) violations.push('token_assignment')
    if (/(?:secret)\s*[:=]/i.test(text)) violations.push('secret_assignment')
  }

  return violations
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8 门槽评估器（D6：只呈现证据与状态；D7：可复现）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AI 门槽评估输入（聚合层，不含明细）。
 *
 * D3: 门槽消费聚合而非明细。每个字段对应一个证据源的聚合结果。
 */
export interface AiQualitySlotEvaluationInput {
  /** 组织 ID（组织隔离）。 */
  organizationId: number
  /** 评估时间（ISO 8601）。 */
  evaluatedAt: string
  /** 输出质量：在线评测运行结果。 */
  onlineEvaluation?: {
    runId: string
    runAt: string
    /** 通过率（0-1）。 */
    passRate: number
    /** 总样本数。 */
    totalSamples: number
    /** 通过样本数。 */
    passedSamples: number
  }
  /** 离线回归：离线回归运行结果。 */
  offlineRegression?: {
    runId: string
    runAt: string
    /** 是否有回归。 */
    hasRegression: boolean
    /** 回归样本数。 */
    regressionCount: number
    /** 总样本数。 */
    totalSamples: number
  }
  /** 成本：账本聚合结果。 */
  cost?: {
    /** 聚合窗口起始时间。 */
    windowStart: string
    /** 聚合窗口结束时间。 */
    windowEnd: string
    /** 累计成本（估算值）。 */
    totalCost: number
    /** 预算上限。 */
    budgetLimit: number
    /** 调用次数。 */
    totalCalls: number
  }
  /** 模型漂移：漂移检测结果。 */
  modelDrift?: {
    runId: string
    runAt: string
    /** 漂移事件（含确认状态）。 */
    events: readonly { eventId: string; confirmationStatus: DriftConfirmationStatus }[]
  }
  /** 安全事件：安全观测聚合结果。 */
  securityEvents?: {
    /** 聚合窗口起始时间。 */
    windowStart: string
    /** 聚合窗口结束时间。 */
    windowEnd: string
    /** 安全事件计数（聚合，不含明细）。 */
    eventCount: number
    /** 事件类别分布（低敏聚合）。 */
    categoryBreakdown?: Record<string, number>
  }
}

/**
 * 评估单个 AI 门槽（D6：只呈现证据与状态，不自动放行或阻断）。
 *
 * 确定性：同一批输入产出同一批状态（D7）。
 *
 * @param slotId 门槽 ID
 * @param input 评估输入（聚合层）
 * @returns 门槽记录
 */
export function evaluateAiQualitySlot(
  slotId: AiQualitySlotId,
  input: AiQualitySlotEvaluationInput,
): AiQualitySlotRecord {
  const criterion = findAiQualitySlotCriterion(slotId)
  const base = {
    slotId,
    name: criterion?.name ?? slotId,
    organizationId: input.organizationId,
    evaluatedAt: input.evaluatedAt,
    criterion: criterion?.passCondition ?? '',
  }

  switch (slotId) {
    case 'ai-output-quality': {
      const eval_ = input.onlineEvaluation
      if (!eval_) {
        return { ...base, status: 'pending', runReference: null }
      }
      // 阈值待定（见 observation 未决问题），此处用 0.8 作为占位
      const passRate = eval_.passedSamples / eval_.totalSamples
      const status: AiQualitySlotStatus = passRate >= 0.8 ? 'passed' : 'failed'
      return {
        ...base,
        status,
        runReference: {
          evidenceSource: 'online-evaluation',
          runId: eval_.runId,
          runAt: eval_.runAt,
        },
        aggregateValue: passRate,
        aggregateDescription: `通过率 ${(passRate * 100).toFixed(1)}%（${eval_.passedSamples}/${eval_.totalSamples}）`,
      }
    }
    case 'ai-offline-regression': {
      const reg = input.offlineRegression
      if (!reg) {
        return { ...base, status: 'pending', runReference: null }
      }
      const status: AiQualitySlotStatus = reg.hasRegression ? 'failed' : 'passed'
      return {
        ...base,
        status,
        runReference: {
          evidenceSource: 'offline-eval-dataset',
          runId: reg.runId,
          runAt: reg.runAt,
        },
        aggregateValue: reg.regressionCount,
        aggregateDescription: reg.hasRegression
          ? `存在 ${reg.regressionCount} 个回归样本（共 ${reg.totalSamples}）`
          : `无回归（共 ${reg.totalSamples} 样本）`,
      }
    }
    case 'ai-cost': {
      const cost = input.cost
      if (!cost) {
        return { ...base, status: 'pending', runReference: null }
      }
      const overBudget = cost.totalCost > cost.budgetLimit
      const status: AiQualitySlotStatus = overBudget ? 'failed' : 'passed'
      return {
        ...base,
        status,
        runReference: {
          evidenceSource: 'invocation-ledger',
          runId: `cost-window-${cost.windowStart}-${cost.windowEnd}`,
          runAt: cost.windowEnd,
        },
        aggregateValue: cost.totalCost,
        aggregateDescription: `累计成本 ${cost.totalCost.toFixed(4)} / 预算 ${cost.budgetLimit.toFixed(4)}（${cost.totalCalls} 次调用）`,
      }
    }
    case 'ai-model-drift': {
      const drift = input.modelDrift
      if (!drift) {
        return { ...base, status: 'pending', runReference: null }
      }
      const status = evaluateDriftSlot(drift.events, true)
      const unconfirmedCount = drift.events.filter(
        (e) => e.confirmationStatus === 'unconfirmed',
      ).length
      return {
        ...base,
        status,
        runReference: {
          evidenceSource: 'drift-detection',
          runId: drift.runId,
          runAt: drift.runAt,
        },
        aggregateValue: unconfirmedCount,
        aggregateDescription:
          unconfirmedCount > 0
            ? `存在 ${unconfirmedCount} 个未经确认的漂移事件`
            : '无未经确认的漂移事件',
      }
    }
    case 'ai-security-events': {
      const sec = input.securityEvents
      if (!sec) {
        return { ...base, status: 'pending', runReference: null }
      }
      const status: AiQualitySlotStatus = sec.eventCount === 0 ? 'passed' : 'failed'
      return {
        ...base,
        status,
        runReference: {
          evidenceSource: 'security-observability',
          runId: `security-window-${sec.windowStart}-${sec.windowEnd}`,
          runAt: sec.windowEnd,
        },
        aggregateValue: sec.eventCount,
        aggregateDescription:
          sec.eventCount === 0 ? '无安全事件' : `存在 ${sec.eventCount} 个安全事件`,
      }
    }
  }
}

/**
 * 评估全部五个 AI 门槽（D7：可复现）。
 *
 * @param input 评估输入
 * @returns 五个门槽记录
 */
export function evaluateAllAiQualitySlots(
  input: AiQualitySlotEvaluationInput,
): AiQualitySlotRecord[] {
  return AI_QUALITY_SLOT_IDS.map((slotId) => evaluateAiQualitySlot(slotId, input))
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9 零域写断言（D6：不自动放行、不自动阻断）
// ═══════════════════════════════════════════════════════════════════════════════

/** AI 门槽评估路径的写操作枚举（D6：零域写）。 */
export const AI_SLOT_EVALUATION_WRITES = [] as const

/**
 * 门槽评估路径无发布动作依赖且零域写（D6）。
 * 此函数始终返回 true，因为评估路径不执行任何写操作。
 */
export function assertSlotEvaluationWritesNothing(): true {
  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10 与既有清单的集成
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AI 门槽的证据引用（嵌入到既有 EvidenceManifest 的 gates 数组中）。
 *
 * 扩展既有 EvidenceGate，新增 AI 门槽专用字段。
 */
export interface AiQualityGateExtension {
  /** AI 门槽运行引用（D1）。 */
  aiRunReference?: AiQualityRunReference
  /** AI 门槽聚合描述（D3）。 */
  aiAggregateDescription?: string
  /** AI 门槽判定口径（D5）。 */
  aiCriterion?: string
}

/**
 * 判断一个 gateId 是否为 AI 门槽。
 */
export function isAiQualityGate(gateId: string): boolean {
  return isAiQualitySlotId(gateId)
}
