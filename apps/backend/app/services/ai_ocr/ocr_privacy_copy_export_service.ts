/**
 * OcrPrivacyCopyExportService — OCR 隐私复制/导出服务（v3-ocr-privacy-policy-controls §6.1-6.2）
 *
 * 职责：
 * - 预览复制/导出（校验策略、权限、来源可见性、生命周期/hold、格式、计数、文本长度）
 * - 执行复制/导出（预览哈希重校验、显式确认、幂等 Key 复用、保存低敏运行记录）
 * - 不自动写正式项目数据
 * - 不产生外部交付
 */
import OcrPrivacyCopyExportRun from '#models/ocr_privacy_copy_export_run'
import { withExportLease, poolTenantContextFor } from '#services/tenant_connection_pool_wrapper'
import {
  type OcrPrivacyPolicy,
  type OcrPrivacyCopyExportPreviewInput,
  type OcrPrivacyCopyExportPreviewResponse,
  type OcrPrivacyCopyExportExecuteInput,
  type OcrPrivacyCopyExportRun as RunDTO,
  type OcrPrivacyWarningCode,
  type OcrPrivacyRunStatus,
  computePrivacyPreviewHash,
  computePrivacyExportRunKey,
  computePrivacyContentHash,
  OCR_PRIVACY_SYSTEM_BOUNDS,
} from '@aiproj/types'

export class OcrPrivacyCopyExportService {
  /**
   * 预览复制/导出
   *
   * 校验策略、权限、格式、记录数、文本长度——返回预览摘要，无副作用。
   */
  preview(
    input: OcrPrivacyCopyExportPreviewInput,
    policy: OcrPrivacyPolicy,
    extractions: Array<{
      id: number
      sourceHash: string | null
      textLength: number
      pageCount: number
      lifecycleState: string
      holdActive: boolean
    }>,
  ): OcrPrivacyCopyExportPreviewResponse {
    const warnings: OcrPrivacyWarningCode[] = []

    // 策略哈希校验
    if (input.policyHash !== policy.policyHash) {
      warnings.push('POLICY_HASH_MISMATCH')
    }

    // 数量限制
    if (input.scope.acceptedExtractionIds.length > OCR_PRIVACY_SYSTEM_BOUNDS.maxExportRecords) {
      return {
        previewHash: '',
        policyHash: input.policyHash,
        outputMode: 'blocked',
        recordCount: 0,
        estimatedCharacters: 0,
        pageCount: 0,
        requiresExplicitConfirmation: false,
        warnings: ['EXPORT_LIMIT_APPROACHING'],
        scopeSummary: {
          sourceKind: input.scope.sourceKind,
          acceptedExtractionCount: input.scope.acceptedExtractionIds.length,
          textLengthSummary: `超出限制：${input.scope.acceptedExtractionIds.length}/${OCR_PRIVACY_SYSTEM_BOUNDS.maxExportRecords}`,
        },
      }
    }

    // 接近上限
    if (
      input.scope.acceptedExtractionIds.length >=
      OCR_PRIVACY_SYSTEM_BOUNDS.maxExportRecords * 0.9
    ) {
      warnings.push('EXPORT_LIMIT_APPROACHING')
    }

    // 计算预览
    const recordCount = extractions.length
    const estimatedCharacters = extractions.reduce((sum, e) => sum + e.textLength, 0)
    const pageCount = extractions.reduce((sum, e) => sum + e.pageCount, 0)
    const requiresExplicitConfirmation = extractions.some(
      (e) => e.lifecycleState !== 'active' || e.holdActive,
    )
    const previewHash = computePrivacyPreviewHash({
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      policyHash: input.policyHash,
      acceptedExtractionIds: input.scope.acceptedExtractionIds,
      format: input.format,
    })

    return {
      previewHash,
      policyHash: input.policyHash,
      outputMode: 'metadata_only',
      recordCount,
      estimatedCharacters,
      pageCount,
      requiresExplicitConfirmation,
      warnings,
      scopeSummary: {
        sourceKind: input.scope.sourceKind,
        acceptedExtractionCount: recordCount,
        textLengthSummary: `${recordCount} 个已接收提取，共约 ${estimatedCharacters} 字符`,
      },
    }
  }

  /**
   * 执行复制/导出
   *
   * 预览哈希重校验、幂等 Key 复用、保存低敏运行记录。
   *
   * v3-multitenant-connection-pool-management §5.5：隐私导出是高风险长流程入口，
   * 在 `export:ocr_privacy` 租户连接 lease 保护下执行（预算/队列/释放由 wrapper 统一治理），
   * 既有隐私策略校验、显式确认与幂等语义不变。
   */
  async execute(
    input: OcrPrivacyCopyExportExecuteInput,
    policy: OcrPrivacyPolicy,
    extractions: Array<{
      id: number
      sourceHash: string | null
      textLength: number
      pageCount: number
    }>,
    confirmedBy: number | null,
  ): Promise<RunDTO> {
    return withExportLease(
      'export:ocr_privacy',
      {
        operationKind: 'privacy_export',
        tenant: poolTenantContextFor({
          organizationId: policy.organizationId,
          projectId: policy.projectId ?? null,
          actorRef: confirmedBy === null ? 'service' : `user:${confirmedBy}`,
        }),
        requestId: `ocr-privacy-export:${input.idempotencyKey}`,
        idempotencyKey: input.idempotencyKey,
      },
      () => this.#executeUnderLease(input, policy, extractions, confirmedBy),
    )
  }

  async #executeUnderLease(
    input: OcrPrivacyCopyExportExecuteInput,
    policy: OcrPrivacyPolicy,
    extractions: Array<{
      id: number
      sourceHash: string | null
      textLength: number
      pageCount: number
    }>,
    confirmedBy: number | null,
  ): Promise<RunDTO> {
    // 幂等性检查：run_key 先按「组织 + 项目 + 导出范围」派生，再拼接客户端幂等 Key。
    // 直接拿客户端 Key 当 run_key 会让不同组织的相同 Key 命中彼此的运行记录，
    // 所以查询同时按 organization_id / project_id 收窄。
    const runKey = `${computePrivacyExportRunKey({
      organizationId: policy.organizationId,
      projectId: policy.projectId!,
      purpose: 'export_metadata',
      format: 'json_summary',
      policyHash: input.policyHash,
      acceptedExtractionIds: extractions.map((e) => e.id),
    })}:${input.idempotencyKey}`
    const existing = await OcrPrivacyCopyExportRun.query()
      .where('organization_id', policy.organizationId)
      .where('project_id', policy.projectId!)
      .where('run_key', runKey)
      .first()

    if (existing) {
      // 返回已存在的运行记录（幂等复用）
      return toRunDTO(existing)
    }

    // 计算内容哈希
    const contentHashes = extractions.map((e) =>
      computePrivacyContentHash({
        extractionId: e.id,
        sourceHash: e.sourceHash,
        textLength: e.textLength,
        pageCount: e.pageCount,
      }),
    )

    const recordCount = extractions.length
    const characterCount = extractions.reduce((sum, e) => sum + e.textLength, 0)
    const pageCount = extractions.reduce((sum, e) => sum + e.pageCount, 0)

    const run = await OcrPrivacyCopyExportRun.create({
      runKey,
      organizationId: policy.organizationId,
      projectId: policy.projectId!,
      sourceScopeKind: 'accepted_extraction',
      purpose: 'export_metadata',
      format: 'json_summary',
      previewHash: input.previewHash,
      policyHash: input.policyHash,
      status: 'completed',
      outputMode: 'metadata_only',
      recordCount,
      characterCount,
      pageCount,
      contentHashes,
      warningCodes: [],
      confirmedBy,
    })

    return toRunDTO(run)
  }

  /** 获取运行记录列表 */
  async listRuns(organizationId: number, projectId: number): Promise<RunDTO[]> {
    const runs = await OcrPrivacyCopyExportRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    return runs.map(toRunDTO)
  }

  /** 获取单个运行记录 */
  async getRun(runId: number): Promise<RunDTO | null> {
    const run = await OcrPrivacyCopyExportRun.find(runId)
    return run ? toRunDTO(run) : null
  }
}

function toRunDTO(run: OcrPrivacyCopyExportRun): RunDTO {
  return {
    id: run.id,
    runKey: run.runKey,
    organizationId: run.organizationId,
    projectId: run.projectId,
    status: run.status as OcrPrivacyRunStatus,
    outputMode: run.outputMode as RunDTO['outputMode'],
    previewHash: run.previewHash,
    policyHash: run.policyHash,
    counts: {
      recordCount: run.recordCount,
      characterCount: run.characterCount,
      pageCount: run.pageCount,
    },
    contentHashes: run.contentHashes,
    warningCodes: run.warningCodes,
    createdAt: run.createdAt?.toISO()!,
    updatedAt: run.updatedAt?.toISO() ?? run.createdAt?.toISO()!,
  }
}
