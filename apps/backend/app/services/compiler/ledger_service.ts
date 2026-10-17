/**
 * v2-project-compiler-foundation —— LedgerService（tasks 5.2）。
 *
 * 追踪编译运行的交付物完成度。
 * 初始化必需交付物列表；Stage 成功后更新状态；
 * 聚合 overall_completeness、blocking_items、warnings。
 */
import type {
  FoundationCompletenessLedger as CompletenessLedger,
  LedgerDeliverable,
  FoundationManifestEntityStatus as ManifestEntityStatus,
} from '@aiproj/compiler-spec'

export interface DeliverableBlueprint {
  id: string
  label: string
  kind: LedgerDeliverable['kind']
  required?: boolean
  blocking?: boolean
}

/**
 * LedgerService —— CompletenessLedger 管理器。
 * Foundation 阶段只做状态追踪与聚合，不调用 LLM 评估。
 */
export class LedgerService {
  #ledger: CompletenessLedger

  constructor(runId: number, blueprints: DeliverableBlueprint[]) {
    const deliverables: LedgerDeliverable[] = blueprints.map((bp) => ({
      id: bp.id,
      label: bp.label,
      kind: bp.kind,
      required: bp.required ?? true,
      status: 'pending',
      blocking: bp.blocking ?? true,
    }))

    this.#ledger = {
      runId,
      schemaVersion: '2.0',
      deliverables,
      overallCompleteness: 0,
      blockingItems: [],
      warnings: [],
      updatedAt: new Date().toISOString(),
    }
    this.#recalculate()
  }

  /** 获取当前 Ledger。 */
  get(): CompletenessLedger {
    return { ...this.#ledger }
  }

  /** Stage 成功后更新 deliverable 状态。 */
  updateDeliverable(
    id: string,
    updates: {
      status?: ManifestEntityStatus
      generatedBy?: string
      verifiedBy?: string
      completenessScore?: number
    },
  ): void {
    const del = this.#ledger.deliverables.find((d) => d.id === id)
    if (!del) return

    if (updates.status !== undefined) del.status = updates.status
    if (updates.generatedBy !== undefined) del.generatedBy = updates.generatedBy
    if (updates.verifiedBy !== undefined) del.verifiedBy = updates.verifiedBy
    if (updates.completenessScore !== undefined) del.completenessScore = updates.completenessScore

    this.#recalculate()
  }

  /** 重新计算聚合指标。 */
  #recalculate(): void {
    const total = this.#ledger.deliverables.length
    if (total === 0) {
      this.#ledger.overallCompleteness = 0
      this.#ledger.blockingItems = []
      this.#ledger.warnings = []
      return
    }

    const completed = this.#ledger.deliverables.filter((d) => d.status === 'completed').length
    const failed = this.#ledger.deliverables.filter((d) => d.status === 'failed').length

    this.#ledger.overallCompleteness = Math.round((completed / total) * 100) / 100

    // 收集阻塞项
    this.#ledger.blockingItems = this.#ledger.deliverables
      .filter((d) => d.blocking && d.status !== 'completed')
      .map((d) => `${d.label} (${d.id})`)

    // 收集警告
    this.#ledger.warnings = []
    if (failed > 0) {
      this.#ledger.warnings.push(`${failed} deliverable(s) failed`)
    }
    if (this.#ledger.blockingItems.length > 0) {
      this.#ledger.warnings.push(`${this.#ledger.blockingItems.length} blocking item(s) remain`)
    }

    this.#ledger.updatedAt = new Date().toISOString()
  }
}
