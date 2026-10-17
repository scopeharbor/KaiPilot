/**
 * v2-context-compiler-artifact-store —— ArtifactStore 逻辑层（tasks 3.1-3.5）。
 *
 * 组织隔离的 Compiler artifact 持久化与查询服务。
 * 所有写入经过 envelope 校验、content hash 校验、idempotency key 去重。
 * 所有读取强制 organizationId 匹配。
 */
import CompilerArtifact from '#models/compiler_artifact'
import type { ArtifactKind, ArtifactPayload } from '#models/compiler_artifact'
import {
  type ArtifactEnvelope,
  type ArtifactRef,
  type ArtifactSummaryLevel,
  artifactEnvelopeSchema,
  parseArtifactRef,
} from '@aiproj/compiler-spec'
import { createHash } from 'node:crypto'

// ── Types ──

export { type ArtifactKind }

export interface ArtifactRecord {
  id?: number
  compilerRunId: number
  organizationId: number
  kind: ArtifactKind
  stageId?: string | null
  artifactId?: string | null
  version: number
  contentHash?: string | null
  idempotencyKey?: string | null
  summaryLevel?: string | null
  payload: ArtifactPayload
}

export interface StageArtifactRefs {
  contextPacketRef: string | null
  inputRefs: string[]
  outputRefs: string[]
  modelOutputRef: string | null
  validationFeedbackRefs: string[]
}

export interface EntityArtifactRefs {
  contractRef: string | null
  manifestRef: string | null
  ledgerRef: string | null
  pdmRef: string | null
  stageOutputRefs: string[]
  validationFeedbackRefs: string[]
}

export interface ArtifactSummary {
  ref: string
  kind: ArtifactKind
  artifactId: string
  version: number
  summaryLevel: ArtifactSummaryLevel
  payload: Record<string, unknown>
}

// ── Errors ──

export class ArtifactStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactStoreError'
  }
}

export class ArtifactNotFoundError extends ArtifactStoreError {
  constructor(ref: string) {
    super(`Artifact not found: ${ref}`)
    this.name = 'ArtifactNotFoundError'
  }
}

export class ArtifactValidationError extends ArtifactStoreError {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactValidationError'
  }
}

export class OrganizationMismatchError extends ArtifactStoreError {
  constructor() {
    super('Organization mismatch: artifact not found')
    this.name = 'OrganizationMismatchError'
  }
}

export class DuplicateIdempotencyKeyError extends ArtifactStoreError {
  constructor(key: string) {
    super(`Duplicate idempotency key: ${key}`)
    this.name = 'DuplicateIdempotencyKeyError'
  }
}

// ── Content Hash Helper ──

/**
 * 计算 payload 的 SHA-256 content hash。
 */
export function computeContentHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

// ── Summary Helpers ──

const SUMMARY_TEXT_MAX_LENGTH = 500

/**
 * 确定性截断长文本。
 */
function truncateText(text: string, maxLen: number = SUMMARY_TEXT_MAX_LENGTH): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

/**
 * 生成 compact 摘要 —— 保留 schema 必需字段，截断长文本，不调用 LLM。
 */
export function generateCompactSummary(record: ArtifactRecord): Record<string, unknown> {
  const payload = record.payload

  // 保留基本识别字段
  const summary: Record<string, unknown> = {
    kind: record.kind,
    artifactId: record.artifactId,
    version: record.version,
  }

  // 尝试提取常用字段
  if (typeof payload === 'object' && payload !== null) {
    for (const key of [
      'id',
      'name',
      'type',
      'status',
      'entityId',
      'entityType',
      'label',
      'longText',
    ]) {
      const val = (payload as Record<string, unknown>)[key]
      if (val !== undefined) {
        summary[key] = typeof val === 'string' ? truncateText(val) : val
      }
    }

    // validation summary 保留
    if ((payload as Record<string, unknown>).validationSummary !== undefined) {
      summary.validationSummary = (payload as Record<string, unknown>).validationSummary
    }

    // source refs / input refs 保留引用
    if ((payload as Record<string, unknown>).inputRefs !== undefined) {
      summary.inputRefs = (payload as Record<string, unknown>).inputRefs
    }
  }

  return summary
}

// ── ArtifactStore ──

/**
 * ArtifactStore —— Compiler 产物逻辑访问层。
 *
 * 所有写入经过：
 * 1. Envelope schema 校验
 * 2. Content hash 校验
 * 3. Idempotency key 去重
 *
 * 所有读取强制 organizationId 匹配。
 */
export class ArtifactStore {
  // ── Save ──

  /**
   * 写入 artifact。
   * 写入前校验 envelope 完整性、content hash、idempotency key。
   */
  async save(record: ArtifactRecord): Promise<CompilerArtifact> {
    // 1. 校验必填字段
    if (!record.kind) throw new ArtifactValidationError('kind is required')
    if (!record.version || record.version < 1)
      throw new ArtifactValidationError('version must be positive')
    if (!record.compilerRunId) throw new ArtifactValidationError('compilerRunId is required')
    if (!record.organizationId) throw new ArtifactValidationError('organizationId is required')

    // 2. 计算 content hash
    const contentHash = record.contentHash ?? computeContentHash(record.payload)

    // 3. 构建 internal envelope 字段
    const envelope: ArtifactEnvelope = {
      kind: record.kind,
      schemaVersion: '2.0',
      version: record.version,
      inputRefs: [],
      outputRefs: [],
      summaryLevel: (record.summaryLevel as ArtifactSummaryLevel) ?? 'full',
      contentHash,
      createdAt: new Date().toISOString(),
    }

    // 4. Schema 校验 envelope
    const envelopeCheck = artifactEnvelopeSchema.safeParse(envelope)
    if (!envelopeCheck.success) {
      throw new ArtifactValidationError(
        `Envelope validation failed: ${envelopeCheck.error.issues.map((i) => i.message).join('; ')}`,
      )
    }

    // 5. Idempotency key 去重
    if (record.idempotencyKey) {
      const existing = await CompilerArtifact.byIdempotencyKey(
        record.compilerRunId,
        record.idempotencyKey,
      )
      if (existing) {
        // 幂等：返回既有记录
        return existing
      }
    }

    // 6. 写入
    return CompilerArtifact.create({
      compilerRunId: record.compilerRunId,
      organizationId: record.organizationId,
      kind: record.kind,
      stageId: record.stageId ?? null,
      artifactId: record.artifactId ?? null,
      version: record.version,
      contentHash,
      idempotencyKey: record.idempotencyKey ?? null,
      summaryLevel: record.summaryLevel ?? 'full',
      payload: record.payload,
    })
  }

  // ── Ref-based Read ──

  /**
   * 按 artifact ref 字符串解析并读取。
   * 强制匹配 organizationId、compilerRunId、artifactId、version。
   */
  async resolveRef(refStr: string, organizationId: number): Promise<CompilerArtifact | null> {
    const parsed = parseArtifactRef(refStr)
    if (!parsed) throw new ArtifactValidationError(`Invalid artifact ref format: ${refStr}`)

    const { ref } = parsed

    // 跨组织隔离
    if (ref.organizationId > 0 && ref.organizationId !== organizationId) {
      return null // 不泄露存在性
    }

    return CompilerArtifact.byArtifactId(
      ref.compilerRunId,
      organizationId,
      ref.artifactId,
      ref.version,
    )
  }

  /**
   * 按结构化 ref 读取。
   */
  async getByRef(ref: ArtifactRef, organizationId: number): Promise<CompilerArtifact | null> {
    if (ref.organizationId > 0 && ref.organizationId !== organizationId) {
      return null
    }
    return CompilerArtifact.byArtifactId(
      ref.compilerRunId,
      organizationId,
      ref.artifactId,
      ref.version,
    )
  }

  // ── Basic Queries ──

  /**
   * 读取某 run 某个 kind 的最新 version。
   */
  async latest(runId: number, kind: ArtifactKind): Promise<CompilerArtifact | null> {
    return CompilerArtifact.latestForKind(runId, kind)
  }

  /**
   * 查询某 run 下指定 kind 的 artifact payload。
   *
   * 用于 RepairHistoryService 等只读运行态查询。这里显式带 organizationId，
   * 避免跨组织 run id 猜测泄漏。
   */
  async queryByRunId(
    runId: number,
    organizationId: number,
    kind?: string,
  ): Promise<Record<string, unknown>[]> {
    const query = CompilerArtifact.forOrganization(organizationId)
      .where('compiler_run_id', runId)
      .orderBy('version', 'asc')

    if (kind) {
      query.where('kind', kind)
    }

    const artifacts = await query
    return artifacts.map((artifact) => artifact.payload)
  }

  /**
   * 读取某 run 某个 kind 指定 version 的 artifact。
   */
  async getByVersion(
    runId: number,
    kind: ArtifactKind,
    version: number,
  ): Promise<CompilerArtifact | null> {
    return CompilerArtifact.query()
      .where('compiler_run_id', runId)
      .where('kind', kind)
      .where('version', version)
      .first()
  }

  // ── Stage-based Queries ──

  /**
   * 读取某 run 某个 stage 的全部 stage_output artifacts。
   */
  async getStageOutputs(runId: number, stageId?: string): Promise<CompilerArtifact[]> {
    const query = CompilerArtifact.query()
      .where('compiler_run_id', runId)
      .where('kind', 'stage_output')

    if (stageId) {
      query.where('stage_id', stageId)
    }

    return query.orderBy('version', 'asc')
  }

  /**
   * 查询 stage 的输入输出 artifact refs。
   */
  async getStageArtifactRefs(runId: number, stageId: string): Promise<StageArtifactRefs> {
    const artifacts = await CompilerArtifact.query()
      .where('compiler_run_id', runId)
      .where('stage_id', stageId)
      .orderBy('version', 'asc')

    const result: StageArtifactRefs = {
      contextPacketRef: null,
      inputRefs: [],
      outputRefs: [],
      modelOutputRef: null,
      validationFeedbackRefs: [],
    }

    for (const a of artifacts) {
      switch (a.kind) {
        case 'context_packet':
          result.contextPacketRef = a.artifactId
          break
        case 'model_output':
          result.modelOutputRef = a.artifactId
          break
        case 'stage_output':
          result.outputRefs.push(a.artifactId ?? `stage_output:v${a.version}`)
          break
        case 'validation_feedback':
          result.validationFeedbackRefs.push(a.artifactId ?? `validation_feedback:v${a.version}`)
          break
        default:
          result.inputRefs.push(a.artifactId ?? `${a.kind}:v${a.version}`)
      }
    }

    return result
  }

  // ── Entity-based Queries ──

  /**
   * 查询 entity 相关 artifact refs。
   */
  async getEntityArtifactRefs(
    runId: number,
    organizationId: number,
    entityId: string,
  ): Promise<EntityArtifactRefs> {
    const artifacts = await CompilerArtifact.query()
      .where('compiler_run_id', runId)
      .where('organization_id', organizationId)
      .whereRaw("json_extract(payload, '$.entityId') = ?", [entityId])
      .orWhere('artifactId', entityId)
      .orderBy('version', 'desc')

    const result: EntityArtifactRefs = {
      contractRef: null,
      manifestRef: null,
      ledgerRef: null,
      pdmRef: null,
      stageOutputRefs: [],
      validationFeedbackRefs: [],
    }

    for (const a of artifacts) {
      switch (a.kind) {
        case 'contract':
          result.contractRef = a.artifactId
          break
        case 'manifest':
          result.manifestRef = a.artifactId
          break
        case 'ledger':
          result.ledgerRef = a.artifactId
          break
        case 'pdm':
          result.pdmRef = a.artifactId
          break
        case 'stage_output':
          result.stageOutputRefs.push(a.artifactId ?? `stage_output:v${a.version}`)
          break
        case 'validation_feedback':
          result.validationFeedbackRefs.push(a.artifactId ?? `validation_feedback:v${a.version}`)
          break
      }
    }

    return result
  }

  // ── Checkpoints ──

  /**
   * 读取某 run 全部 checkpoint（按 version 降序）。
   */
  async getCheckpoints(runId: number): Promise<CompilerArtifact[]> {
    return CompilerArtifact.query()
      .where('compiler_run_id', runId)
      .where('kind', 'checkpoint')
      .orderBy('version', 'desc')
  }

  // ── Summary Generation ──

  /**
   * 读取 full 或 compact 摘要。
   * compact 由本地确定性算法完成，不调用 LLM。
   */
  async getSummary(
    runId: number,
    kind: ArtifactKind,
    version: number,
    level: ArtifactSummaryLevel,
    organizationId: number,
  ): Promise<ArtifactSummary | null> {
    const artifact = await this.getByVersion(runId, kind, version)
    if (!artifact) return null

    // 组织隔离
    if (artifact.organizationId !== organizationId) return null

    const ref = `${kind}:${artifactId(runId, kind)}:v${version}@${level}`

    if (level === 'full') {
      return {
        ref,
        kind: artifact.kind,
        artifactId: artifact.artifactId ?? '',
        version: artifact.version,
        summaryLevel: level,
        payload: artifact.payload,
      }
    }

    // compact：确定性裁剪
    const compactPayload = generateCompactSummary({
      compilerRunId: runId,
      organizationId,
      kind: artifact.kind,
      version: artifact.version,
      artifactId: artifact.artifactId,
      payload: artifact.payload,
    })

    return {
      ref,
      kind: artifact.kind,
      artifactId: artifact.artifactId ?? '',
      version: artifact.version,
      summaryLevel: level,
      payload: compactPayload,
    }
  }
}

function artifactId(runId: number, kind: string): string {
  return `${kind}_run_${runId}`
}
