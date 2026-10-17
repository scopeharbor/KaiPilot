/**
 * Compiler Foundation —— Test-Only In-Memory Recorder（task 10.3）。
 *
 * 当 foundation persistence 未完成时，用此 recorder 记录
 * deterministic stage 的输入签名、engine version、rule set version、输出摘要、diff 摘要和 validation result。
 * 数据仅存于内存，不写数据库。
 *
 * @aiproj/backend
 */

import type { EngineEvidence } from '@aiproj/compiler-spec'

export interface StageRecord {
  stageId: string
  evidence: EngineEvidence
  timestamp: string
  runId: number
}

export class InMemoryRecorder {
  readonly records: StageRecord[] = []

  /**
   * 记录 deterministic stage 执行证据。
   */
  record(runId: number, evidence: EngineEvidence): void {
    this.records.push({
      stageId: evidence.stageId,
      evidence,
      timestamp: new Date().toISOString(),
      runId,
    })
  }

  /**
   * 按 runId 查询记录。
   */
  getByRunId(runId: number): StageRecord[] {
    return this.records.filter((r) => r.runId === runId)
  }

  /**
   * 按 stageId 查询记录。
   */
  getByStageId(stageId: string): StageRecord[] {
    return this.records.filter((r) => r.stageId === stageId)
  }

  /**
   * 检查特定 stage 是否已被记录。
   */
  hasStage(runId: number, stageId: string): boolean {
    return this.records.some((r) => r.runId === runId && r.stageId === stageId)
  }

  /**
   * 获取总记录数。
   */
  get count(): number {
    return this.records.length
  }

  /**
   * 清空记录。
   */
  clear(): void {
    this.records.length = 0
  }
}
