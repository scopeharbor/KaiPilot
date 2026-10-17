/**
 * @aiproj/backend —— Validation Module 接口定义。
 *
 * ValidationEvidenceWriter 接口：验证/评估证据写入 Manifest/Ledger 或 artifact 存储。
 * 在 foundation persistence 完成前使用 InMemoryEvidenceWriter 过渡。
 */

// ── Evidence Types ──

export type EvidenceType =
  | 'hard_validation_complete'
  | 'soft_evaluation_complete'
  | 'v_gate_decision'
  | 'soft_evaluation_skipped'
  | 'soft_evaluation_degraded'
  | 'budget_exceeded'
  | 'repair_suggestion_generated'

export interface EvidenceEntry {
  evidenceId: string
  stageId: string
  evidenceType: EvidenceType
  inputSignature: Record<string, unknown>
  rulesetVersion: string
  registryVersion: string
  outputSummary: Record<string, unknown>
  costSummary: { tokensUsed: number; callsMade: number; latencyMs: number }
  skippedReason?: string
  degradedReason?: string
  repairSuggestionIds?: string[]
  generatedAt: string
}

// ── EvidenceWriter Interface ──

/**
 * 验证证据写入接口。
 *
 * 在 foundation persistence 完成前，使用 InMemoryEvidenceWriter 过渡。
 * 后续对接 foundation Manifest/Ledger/artifact writer。
 */
export interface ValidationEvidenceWriter {
  /**
   * 写入一条验证/评估证据。
   * @returns 证据 ID（用于后续引用）。
   */
  write(entry: EvidenceEntry): Promise<string>

  /**
   * 批量写入验证/评估证据。
   * @returns 证据 ID 列表。
   */
  writeBatch(entries: EvidenceEntry[]): Promise<string[]>

  /**
   * 按 stageId 读取证据。
   */
  getByStageId(stageId: string): Promise<EvidenceEntry[]>

  /**
   * 按 evidenceId 读取证据。
   */
  getById(evidenceId: string): Promise<EvidenceEntry | null>
}

// ── InMemoryEvidenceWriter ──

/**
 * 测试用的内存证据写入器。
 * foundation persistence 完成前过渡使用。
 */
export class InMemoryEvidenceWriter implements ValidationEvidenceWriter {
  readonly #store: Map<string, EvidenceEntry> = new Map()

  async write(entry: EvidenceEntry): Promise<string> {
    this.#store.set(entry.evidenceId, entry)
    return entry.evidenceId
  }

  async writeBatch(entries: EvidenceEntry[]): Promise<string[]> {
    const ids: string[] = []
    for (const e of entries) {
      this.#store.set(e.evidenceId, e)
      ids.push(e.evidenceId)
    }
    return ids
  }

  async getByStageId(stageId: string): Promise<EvidenceEntry[]> {
    return Array.from(this.#store.values()).filter((e) => e.stageId === stageId)
  }

  async getById(evidenceId: string): Promise<EvidenceEntry | null> {
    return this.#store.get(evidenceId) ?? null
  }

  /** 获取所有存储的证据（测试用）。 */
  getAll(): EvidenceEntry[] {
    return Array.from(this.#store.values())
  }

  /** 清空存储（测试用）。 */
  clear(): void {
    this.#store.clear()
  }
}
