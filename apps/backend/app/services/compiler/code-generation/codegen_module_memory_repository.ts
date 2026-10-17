/**
 * 34 阶段代码生成模块记忆的持久化端口实现。
 *
 * 契约接口 `CodeGenerationModuleMemoryPort` 与契约类型
 * `CodeGenerationModuleMemoryRecord` 都不带 organizationId——为了不改动已归档
 * 契约签名，租户上下文在**构造期绑定**，`list` / `save` 内部无条件附加过滤。
 * 因此一个适配器实例只服务一个 run 的一个组织，不得跨 run 复用。
 */

import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  getCodeGenerationStageDefinition,
  type CodeGenerationContextScope,
  type CodeGenerationModuleMemoryRecord,
  type CodeGenerationStageId,
  type CodeGenerationToolId,
} from '@aiproj/types/compiler-code-generation'
import CompilerCodegenStageRecord from '#models/compiler_codegen_stage_record'
import type { CodeGenerationModuleMemoryPort } from './code_generation_module_flow.js'

/** Runner 在完成某个 stage 前登记的 frame 证据，写入时一并落库。 */
export interface CodegenStageEvidence {
  contextScope: CodeGenerationContextScope
  visibleToolIds: CodeGenerationToolId[]
  reasonCode: string
}

export interface DbCodeGenerationModuleMemoryOptions {
  runId: number
  organizationId: number
  /** 传入事务客户端后，读写都在同一事务内，停机回滚才能连带撤销 stage 记录。 */
  client?: TransactionClientContract
}

export class DbCodeGenerationModuleMemory implements CodeGenerationModuleMemoryPort {
  readonly #runId: number
  readonly #organizationId: number
  readonly #client?: TransactionClientContract
  readonly #evidence = new Map<CodeGenerationStageId, CodegenStageEvidence>()

  constructor(options: DbCodeGenerationModuleMemoryOptions) {
    this.#runId = options.runId
    this.#organizationId = options.organizationId
    this.#client = options.client
  }

  /**
   * 登记下一次 save 要落库的 frame 证据。未登记时回落到 catalog 定义，
   * 因为 frame 本身即由 catalog 派生，两者等价。
   */
  registerStageEvidence(stageId: CodeGenerationStageId, evidence: CodegenStageEvidence): void {
    this.#evidence.set(stageId, evidence)
  }

  async list(runtimeSessionId: string): Promise<CodeGenerationModuleMemoryRecord[]> {
    const rows = await this.#query()
      .where('run_id', this.#runId)
      .where('organization_id', this.#organizationId)
      .where('runtime_session_id', runtimeSessionId)
      .orderBy('stage_order', 'asc')

    return rows.map((row) => toMemoryRecord(row))
  }

  async save(record: CodeGenerationModuleMemoryRecord): Promise<CodeGenerationModuleMemoryRecord> {
    const existing = await this.#query()
      .where('run_id', this.#runId)
      .where('organization_id', this.#organizationId)
      .where('stage_id', record.stageId)
      .first()

    // 幂等：与 InMemoryCodeGenerationModuleMemory 语义一致，重复完成返回既有记录
    if (existing) return toMemoryRecord(existing)

    const definition = getCodeGenerationStageDefinition(record.stageId)
    if (!definition) throw new Error(`Unknown code generation stage: ${record.stageId}`)

    const evidence = this.#evidence.get(record.stageId)
    const row = new CompilerCodegenStageRecord()
    if (this.#client) row.useTransaction(this.#client)
    row.merge({
      runId: this.#runId,
      organizationId: this.#organizationId,
      runtimeSessionId: record.runtimeSessionId,
      stageId: record.stageId,
      stageOrder: definition.order,
      status: record.status,
      contractVersion: record.contractVersion,
      contextScope: evidence?.contextScope ?? definition.contextScope,
      reasonCode: evidence?.reasonCode ?? 'CODEGEN_PLAN_READY',
      artifactRefsJson: record.artifactRefs,
      observationRefsJson: record.observationRefs,
      toolCallIdsJson: record.toolCallIds,
      visibleToolIdsJson: evidence?.visibleToolIds ?? definition.allowedTools,
      summary: record.summary,
      completedAt: DateTime.fromISO(record.completedAt),
    })
    await row.save()

    return toMemoryRecord(row)
  }

  #query() {
    return this.#client
      ? CompilerCodegenStageRecord.query({ client: this.#client })
      : CompilerCodegenStageRecord.query()
  }
}

function toMemoryRecord(row: CompilerCodegenStageRecord): CodeGenerationModuleMemoryRecord {
  return {
    contractVersion: row.contractVersion as CodeGenerationModuleMemoryRecord['contractVersion'],
    runtimeSessionId: row.runtimeSessionId,
    stageId: row.stageId,
    status: 'completed',
    artifactRefs: [...row.artifactRefsJson],
    observationRefs: [...row.observationRefsJson],
    toolCallIds: [...row.toolCallIdsJson],
    summary: row.summary,
    completedAt: row.completedAt.toISO() ?? new Date(0).toISOString(),
  }
}
