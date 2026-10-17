import PmoAiPriorityRecommendation from '#models/pmo_ai_priority_recommendation'
import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import ProjectSignal from '#models/project_signal'
import { INBOX_SOURCE_KINDS } from '@aiproj/types'
import type { InboxExpiryReasonKind, InboxSourceKind, InboxSourceRef } from '@aiproj/types'
import { DateTime } from 'luxon'
import { HealthDiagnosisDraftInboxAdapter } from './adapters/health_diagnosis_draft_adapter.js'
import { PmoPriorityRecommendationInboxAdapter } from './adapters/pmo_priority_recommendation_adapter.js'
import {
  ProjectSignalInboxAdapter,
  projectSignalContentHash,
} from './adapters/project_signal_adapter.js'
import type { InboxSourceAdapter, InboxSourceEntry } from './inbox_aggregator.js'
import type { InboxSourceFreshnessChecker } from './inbox_expiry.js'

/**
 * 收件箱三个注入缝的**生产侧接线**。
 *
 * 背景：`InboxAggregator` / `InboxExpiryChecker` / `InboxStateService` 把来源适配器、
 * 新鲜度检查器与采纳路由设计成可注入接口，单测用假实现覆盖得很完整，生产侧却长期
 * 没有任何具体实现——三个构造参数既无默认值又没 `@inject()`，容器按 `Function.length`
 * 判定直接抛 `Cannot inject`，把控制器四个端点全部拖成 500。
 *
 * 现状：**五个来源全部接入真实数据**——
 * - `pmo_priority_recommendation` ← PMO AI 优先级推荐表
 * - `health_diagnosis_draft` ← 项目健康诊断（ai_ready 草案的诊断项）
 * - `smart_recommendation` / `progress_risk_prediction` / `risk_ai_suggestion`
 *   ← 被动雷达 `project_signals` 的四类硬信号，按 `rule_registry` 的对应关系切分
 */

/**
 * 尚无可回源数据的来源占位。
 *
 * 当前五个来源都已接入，此类只作为**将来新增来源种类时的兜底**：
 * 新种类若还没有适配器，会在聚合里被声明为缺席，而不是悄悄消失。
 * 与「查询失败」区分开：这里是结构性没有数据源，不是临时故障。
 */
export class UnwiredInboxSourceAdapter implements InboxSourceAdapter {
  constructor(readonly sourceKind: InboxSourceKind) {}

  async isAvailable(): Promise<boolean> {
    return false
  }

  /** 不可用来源不会被聚合层调用；返回空数组保证调用顺序变化时也不会拖挂聚合。 */
  async listForInbox(): Promise<InboxSourceEntry[]> {
    return []
  }
}

/** 已接入的来源。其余 `INBOX_SOURCE_KINDS` 自动补占位适配器。 */
const WIRED_ADAPTER_FACTORIES: Partial<Record<InboxSourceKind, () => InboxSourceAdapter>> = {
  pmo_priority_recommendation: () => new PmoPriorityRecommendationInboxAdapter(),
  health_diagnosis_draft: () => new HealthDiagnosisDraftInboxAdapter(),
  smart_recommendation: () => new ProjectSignalInboxAdapter('smart_recommendation'),
  progress_risk_prediction: () => new ProjectSignalInboxAdapter('progress_risk_prediction'),
  risk_ai_suggestion: () => new ProjectSignalInboxAdapter('risk_ai_suggestion'),
}

/** 由 `project_signals` 供数的来源，新鲜度走同一条回源比对。 */
const SIGNAL_BACKED_SOURCES = new Set<InboxSourceKind>([
  'smart_recommendation',
  'progress_risk_prediction',
  'risk_ai_suggestion',
])

/**
 * 按共享契约枚举全部五个来源建适配器：已接入的用真实实现，未接入的用占位。
 *
 * 刻意遍历 `INBOX_SOURCE_KINDS` 而不是手写数组——将来新增来源种类时，
 * 这里会自动多出一个「声明不可用」的占位，而不是悄悄从聚合里消失。
 */
export function createDefaultInboxSourceAdapters(): InboxSourceAdapter[] {
  return INBOX_SOURCE_KINDS.map(
    (sourceKind) =>
      WIRED_ADAPTER_FACTORIES[sourceKind]?.() ?? new UnwiredInboxSourceAdapter(sourceKind),
  )
}

/** 新鲜度判定结果（与 `InboxSourceFreshnessChecker` 契约一致）。 */
interface FreshnessVerdict {
  fresh: boolean
  currentHash: string | null
  reason: InboxExpiryReasonKind | null
  detail: string | null
}

/**
 * 生产侧新鲜度检查器。
 *
 * 五个来源都做真实回源比对：来源内容哈希与条目记录的 `sourceHash` 不一致，
 * 或来源侧条目已被处理 / 已过期 / 已不存在，即判过期并写明原因。
 */
export class InboxSourceFreshnessCheckerImpl implements InboxSourceFreshnessChecker {
  async checkFreshness(sourceRef: InboxSourceRef): Promise<FreshnessVerdict> {
    if (SIGNAL_BACKED_SOURCES.has(sourceRef.sourceKind)) {
      return this.checkProjectSignal(sourceRef)
    }
    switch (sourceRef.sourceKind) {
      case 'pmo_priority_recommendation':
        return this.checkPmoRecommendation(sourceRef)
      case 'health_diagnosis_draft':
        return this.checkHealthDiagnosis(sourceRef)
      default:
        // 兜底：将来新增来源种类但还没接新鲜度校验时，按不过期处理。
        // 取不到当前哈希却判过期，等于用「查不到」销毁用户的收件箱状态。
        return {
          fresh: true,
          currentHash: null,
          reason: null,
          detail: `${sourceRef.sourceKind} 来源尚未接入新鲜度校验，按不过期处理`,
        }
    }
  }

  private async checkPmoRecommendation(sourceRef: InboxSourceRef): Promise<FreshnessVerdict> {
    const id = Number(sourceRef.sourceId)
    if (!Number.isSafeInteger(id)) {
      return this.unresolvable(sourceRef, '来源 ID 不可解析')
    }
    const row = await PmoAiPriorityRecommendation.find(id)
    if (!row) {
      return this.unresolvable(sourceRef, '来源条目已不存在')
    }
    // 来源侧已处理掉的推荐不该继续占着收件箱。
    if (row.status !== 'new' && row.status !== 'reviewing') {
      return {
        fresh: false,
        currentHash: row.inputSignature,
        reason: 'other_changed',
        detail: `来源侧推荐已处理（status=${row.status}）`,
      }
    }
    if (row.inputSignature !== sourceRef.sourceHash) {
      return {
        fresh: false,
        currentHash: row.inputSignature,
        reason: 'data_refreshed',
        detail: '来源输入签名已变更，推荐已重算',
      }
    }
    return { fresh: true, currentHash: row.inputSignature, reason: null, detail: null }
  }

  private async checkHealthDiagnosis(sourceRef: InboxSourceRef): Promise<FreshnessVerdict> {
    // 适配器写入的 sourceId 形如 `${diagnosisId}:${itemId}`。
    const diagnosisId = Number(sourceRef.sourceId.split(':')[0])
    if (!Number.isSafeInteger(diagnosisId)) {
      return this.unresolvable(sourceRef, '来源 ID 不可解析')
    }
    const diagnosis = await ProjectHealthDiagnosis.find(diagnosisId)
    if (!diagnosis) {
      return this.unresolvable(sourceRef, '来源诊断已不存在')
    }
    if (diagnosis.status !== 'ai_ready') {
      return {
        fresh: false,
        currentHash: diagnosis.outputHash,
        reason: 'other_changed',
        detail: `来源诊断已流转（status=${diagnosis.status}）`,
      }
    }
    const currentHash = diagnosis.outputHash ?? diagnosis.inputSignature
    if (currentHash !== sourceRef.sourceHash) {
      return {
        fresh: false,
        currentHash,
        reason: 'data_refreshed',
        detail: '诊断已重新生成，产出哈希已变更',
      }
    }
    return { fresh: true, currentHash, reason: null, detail: null }
  }

  private async checkProjectSignal(sourceRef: InboxSourceRef): Promise<FreshnessVerdict> {
    const id = Number(sourceRef.sourceId)
    if (!Number.isSafeInteger(id)) {
      return this.unresolvable(sourceRef, '来源 ID 不可解析')
    }
    const signal = await ProjectSignal.find(id)
    if (!signal || signal.deletedAt) {
      return this.unresolvable(sourceRef, '来源信号已不存在')
    }
    if (signal.status !== 'open') {
      return {
        fresh: false,
        currentHash: projectSignalContentHash(signal),
        reason: 'other_changed',
        detail: `来源信号已流转（status=${signal.status}）`,
      }
    }
    // 信号自带有效期：过期的信号不该继续以「待处理」的形态留在收件箱里。
    if (signal.expiresAt <= DateTime.now()) {
      return {
        fresh: false,
        currentHash: projectSignalContentHash(signal),
        reason: 'data_refreshed',
        detail: '来源信号已过观测有效期',
      }
    }
    const currentHash = projectSignalContentHash(signal)
    if (currentHash !== sourceRef.sourceHash) {
      return {
        fresh: false,
        currentHash,
        reason: 'data_refreshed',
        detail: '信号严重度或证据已变更，结论需重新评估',
      }
    }
    return { fresh: true, currentHash, reason: null, detail: null }
  }

  /** 来源侧查不到对应记录：判过期，原因写清楚，不静默留着一条指向空的引用。 */
  private unresolvable(sourceRef: InboxSourceRef, detail: string): FreshnessVerdict {
    return {
      fresh: false,
      currentHash: null,
      reason: 'other_changed',
      detail: `${sourceRef.sourceKind}: ${detail}`,
    }
  }
}
