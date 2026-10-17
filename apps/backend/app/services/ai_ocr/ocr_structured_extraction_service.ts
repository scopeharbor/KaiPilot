import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import OcrStructuredExtractionProfile from '#models/ocr_structured_extraction_profile'
import OcrStructuredExtractionProfileVersion from '#models/ocr_structured_extraction_profile_version'
import OcrStructuredExtractionRun from '#models/ocr_structured_extraction_run'
import OcrStructuredExtractionFieldCandidate from '#models/ocr_structured_extraction_field_candidate'
import OcrStructuredExtractionTableCandidate from '#models/ocr_structured_extraction_table_candidate'
import OcrStructuredExtractionSnapshot from '#models/ocr_structured_extraction_snapshot'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import AuditService, { AuditEvent } from '#services/audit_service'
import OcrProfilePluginResolver from '#services/ai_ocr/ocr_profile_plugin_resolver'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type {
  OcrExtractionProfileSummary,
  OcrExtractionProfileDetail,
  OcrExtractionProfileVersionSummary,
  CreateOcrExtractionProfileRequest,
  UpdateOcrExtractionProfileRequest,
  OcrExtractionRunSummary,
  OcrExtractionRunDetail,
  CreateOcrExtractionRunRequest,
  ListOcrExtractionRunsFilter,
  OcrFieldCandidate,
  OcrTableCandidate,
  OcrTableRowCandidate,
  OcrTypedFieldValue,
  OcrTypedTableCellValue,
  OcrTypedTextValue,
  OcrTypedDateValue,
  OcrTypedNumberValue,
  OcrTypedEnumValue,
  OcrTypedPersonNameValue,
  OcrTypedProjectRefValue,
  OcrStructuredExtractionPreviewRequest,
  OcrStructuredExtractionPreviewResponse,
  OcrStructuredExtractionSaveRequest,
  OcrStructuredExtractionSnapshotPayload,
  OcrStructuredSnapshotSummary,
  OcrStructuredSnapshotDetail,
  OcrExtractionProvenanceKind,
  OcrExtractionWarning,
  OcrExtractionConfidenceLevel,
  OcrExtractionCandidateStatus,
  OcrStructuredFieldType,
  OcrExtractionProfileSchema,
  OcrExtractionSectionDefinition,
  OcrExtractionFieldDefinition,
  OcrExtractionTableSchema,
  OcrSourceSpanRef,
  OcrProfileProjection,
} from '@aiproj/types'
import {
  computeSourceSpanHash,
  computeFieldCandidateHash,
  computeTableRowHash,
  computeStructuredExtractionInputSignature,
  computeStructuredExtractionPreviewHash,
  computeStructuredExtractionSnapshotHash,
  normalizeStructuredExtractionIdempotencyKey,
  validateOcrExtractionProfileSchema,
  isAcceptedExtractionEligible,
  resolveConfidenceLevel,
  aggregateExtractionWarningSummary,
  resolveStructuredExtractionActions,
  buildStructuredExtractionRedlineSummary,
  isPluginOcrProfileRef,
} from '@aiproj/types'

// ─── 日期中文正则（确定性 parser 用）─────────────────────────────────────

/** 中文完整日期：2024年3月15日 / 2024年03月15日 / 2024年 3 月 15 日 */
const RE_DATE_CN_FULL = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/

/** 中文省略年：3月15日 / 03月15日 */
const RE_DATE_CN_SHORT = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/

/** ISO-like：2024-03-15 / 2024/03/15 / 2024.03.15 */
const RE_DATE_ISO = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/

/** MM/DD 简写 */
const RE_DATE_MMDD = /(\d{1,2})\/(\d{1,2})/

// ─── 私有类型 ──────────────────────────────────────────────────────────

interface SectionChunk {
  label: string
  text: string
}

// ─── 服务实现 ──────────────────────────────────────────────────────────

/**
 * OCR 结构化提取服务（v3-ocr-structured-extraction）。
 *
 * 从已确认的 OCR 文本中按版本化 profile schema 生成字段与表格候选。
 * 所有提取逻辑均为确定性规则引擎——无 AI/模型调用。
 *
 * 红线：
 * - 不下游写入 task / WBS / risk / milestone / resource / report
 * - 不调用真实 OCR provider / AI 模型
 * - 所有查询带 organization_id 隔离
 * - 审计只含哈希与 ref，不含全量文本
 */
@inject()
export default class OcrStructuredExtractionService {
  constructor(
    private ctx: HttpContext,
    private audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════
  //  Profile Management
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 列出 profile——builtin 对所有组织可见，project/org 只匹配当前组织。
   */
  async listProfiles(
    organizationId: number,
    projectId: number | null,
    filters?: {
      scope?: string
      status?: string
      search?: string
      sort?: string
      page?: number
      perPage?: number
    },
  ): Promise<{
    data: OcrExtractionProfileSummary[]
    meta: { total: number; page: number; perPage: number }
  }> {
    const page = filters?.page ?? 1
    const perPage = Math.min(filters?.perPage ?? 20, 100)

    let query = OcrStructuredExtractionProfile.query().where((builder) => {
      builder.where('scope', 'builtin').orWhere('organization_id', organizationId)
      if (projectId !== null) {
        builder.orWhere((sub) => {
          sub.where('organization_id', organizationId).where('project_id', projectId)
        })
      }
    })

    if (filters?.scope) {
      query = query.where('scope', filters.scope)
    }
    if (filters?.status) {
      query = query.where('status', filters.status)
    }
    if (filters?.search) {
      const term = `%${filters.search}%`
      query = query.where((b) => {
        b.whereILike('name', term).orWhereILike('description', term)
      })
    }

    // 排序
    const sortField = filters?.sort?.replace(/^[+-]/, '') ?? 'created_at'
    const sortDir = filters?.sort?.startsWith('-') ? 'desc' : 'asc'
    query = query.orderBy(sortField, sortDir)

    const totalQuery = query.clone()
    const totalResult = await totalQuery.count('* as total')
    const total = Number(totalResult[0].$extras?.total ?? 0)

    const profiles = await query.offset((page - 1) * perPage).limit(perPage)

    const pluginProfiles =
      filters?.scope && filters.scope !== 'plugin'
        ? []
        : await new OcrProfilePluginResolver().listEnabledPluginProfiles(organizationId)
    const projectedPluginProfiles: OcrExtractionProfileSummary[] = pluginProfiles.map(
      (profile) => ({
        profileId: null,
        profileRef: profile.profileRef,
        profileSource: 'plugin',
        profilePayloadDigest: profile.pluginRef?.payloadDigest,
        pluginVersion: profile.version,
        schemaSnapshot: profile.schemaSnapshot,
        reviewSnapshot: profile.reviewSnapshot,
        name: profile.name,
        scope: 'organization',
        status: 'active',
        schemaKey: profile.profileRef,
        currentVersion: Number(profile.version.split('.')[0] ?? 1),
        totalRuns: 0,
        description: profile.description ?? null,
        organizationId,
        projectId: null,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      }),
    )

    return {
      data: [...profiles.map((p) => this.toProfileSummary(p)), ...projectedPluginProfiles],
      meta: { total: total + projectedPluginProfiles.length, page, perPage },
    }
  }

  /**
   * 获取 profile 详情——含当前 active 版本的 schema 定义。
   * `trx`：调用方在事务内时传入（better-sqlite3 单连接池下，事务内裸查询会
   * KnexTimeout「pool is probably full」）。
   */
  async getProfileDetail(
    profileId: number,
    organizationId: number,
    trx?: TransactionClientContract,
  ): Promise<OcrExtractionProfileDetail> {
    const profile = await OcrStructuredExtractionProfile.query(trx ? { client: trx } : undefined)
      .where('id', profileId)
      .where((b) => {
        b.where('organization_id', organizationId).orWhere('scope', 'builtin')
      })
      .first()

    if (!profile) {
      throw new ResourceNotFoundException('提取 Profile 不存在')
    }

    // 加载当前版本的 schema
    const version = await OcrStructuredExtractionProfileVersion.query(
      trx ? { client: trx } : undefined,
    )
      .where('profile_id', profileId)
      .where('version', profile.currentVersion)
      .first()

    // 加载所有版本列表
    const versions = await OcrStructuredExtractionProfileVersion.query(
      trx ? { client: trx } : undefined,
    )
      .where('profile_id', profileId)
      .orderBy('version', 'desc')

    const schemaDefinition: OcrExtractionProfileSchema = version?.schemaDefinitionJson ?? {
      schemaKey: profile.schemaKey,
      version: 1,
      label: profile.name,
      description: profile.description ?? '',
      sections: [],
      tables: [],
      validationRules: {
        maxFieldsPerRun: 500,
        maxTableRowsPerRun: 10000,
        maxTotalCandidates: 1000,
        forbidExternalUrls: true,
        forbidArbitraryCode: true,
        forbidDownstreamWrites: true,
      },
      redactionHints: { fields: [], patterns: [] },
    }

    const versionHistory: OcrExtractionProfileVersionSummary[] = versions.map((v) => ({
      versionId: v.id,
      version: v.version,
      status: v.status,
      createdAt: v.createdAt.toISO()!,
      createdBy: v.createdBy,
    }))

    return {
      ...this.toProfileSummary(profile),
      schemaDefinition,
      versionHistory,
    }
  }

  /**
   * 创建 profile——验证 schema，创建 profile + version 1。
   */
  async createProfile(
    // schemaDefinition 来自未收窄的用户 payload（vine 只保证是对象），
    // 由 validateOcrExtractionProfileSchema 做结构与安全校验后再收窄
    input: Omit<CreateOcrExtractionProfileRequest, 'schemaDefinition'> & {
      schemaDefinition: unknown
    },
    organizationId: number,
    actorId: number,
  ): Promise<OcrExtractionProfileDetail> {
    // 验证 schema
    const validation = validateOcrExtractionProfileSchema(input.schemaDefinition)
    if (!validation.valid) {
      throw new ValidationException(`Profile schema 验证失败：${validation.errors.join('；')}`)
    }
    const schemaDefinition = input.schemaDefinition as OcrExtractionProfileSchema

    // project 作用域必须有 projectId
    if (input.scope === 'project' && !input.projectId) {
      throw new ValidationException('项目作用域 Profile 必须提供 projectId')
    }

    return db.transaction(async (trx) => {
      const profile = new OcrStructuredExtractionProfile()
      profile.organizationId = organizationId
      profile.projectId = input.projectId ?? null
      profile.name = input.name
      profile.scope = input.scope
      profile.status = 'draft'
      profile.schemaKey = schemaDefinition.schemaKey
      profile.currentVersion = 1
      profile.totalRuns = 0
      profile.description = input.description ?? null
      profile.createdBy = actorId
      await profile.useTransaction(trx).save()

      // 创建 version 1
      const version = new OcrStructuredExtractionProfileVersion()
      version.profileId = profile.id
      version.version = 1
      version.status = 'draft'
      version.schemaDefinitionJson = schemaDefinition
      version.createdBy = actorId
      await version.useTransaction(trx).save()

      await this.audit.log({
        client: trx,
        event: AuditEvent.OCR_STRUCTURED_PROFILE_CREATED,
        userId: actorId,
        organizationId,
        entityType: 'ocr_structured_extraction_profile',
        entityId: Number(profile.id),
        metadata: {
          action: 'OCR_STRUCTURED_PROFILE_CREATED',
          schemaKey: profile.schemaKey,
          scope: profile.scope,
        },
        requestId: this.ctx.auditContext?.requestId ?? null,
      })

      // 重新查询以获取完整详情
      const created = await OcrStructuredExtractionProfile.query({ client: trx })
        .where('id', profile.id)
        .first()!

      return {
        ...this.toProfileSummary(created!),
        schemaDefinition,
        versionHistory: [
          {
            versionId: version.id,
            version: 1,
            status: 'draft',
            createdAt: version.createdAt.toISO()!,
            createdBy: actorId,
          },
        ],
      }
    })
  }

  /**
   * 更新 profile——若 schema 变更则创建新版本；可更新状态。
   */
  async updateProfile(
    profileId: number,
    // 同 createProfile：schemaDefinition 先校验后收窄
    input: Omit<UpdateOcrExtractionProfileRequest, 'schemaDefinition'> & {
      schemaDefinition?: unknown
    },
    organizationId: number,
    actorId: number,
  ): Promise<OcrExtractionProfileDetail> {
    const profile = await OcrStructuredExtractionProfile.query()
      .where('id', profileId)
      .where('organization_id', organizationId)
      .first()

    if (!profile) {
      throw new ResourceNotFoundException('提取 Profile 不存在')
    }

    return db.transaction(async (trx) => {
      let versionIncremented = false

      if (input.name !== undefined) {
        profile.name = input.name
      }
      if (input.description !== undefined) {
        profile.description = input.description
      }
      if (input.status !== undefined) {
        profile.status = input.status
      }

      // schema 变更 → 创建新版本
      if (input.schemaDefinition) {
        const validation = validateOcrExtractionProfileSchema(input.schemaDefinition)
        if (!validation.valid) {
          throw new ValidationException(`Profile schema 验证失败：${validation.errors.join('；')}`)
        }
        const nextSchema = input.schemaDefinition as OcrExtractionProfileSchema
        profile.currentVersion += 1
        profile.schemaKey = nextSchema.schemaKey
        versionIncremented = true

        const version = new OcrStructuredExtractionProfileVersion()
        version.profileId = profile.id
        version.version = profile.currentVersion
        version.status = input.status ?? profile.status
        version.schemaDefinitionJson = nextSchema
        version.createdBy = actorId
        await version.useTransaction(trx).save()
      }

      await profile.useTransaction(trx).save()

      await this.audit.log({
        client: trx,
        event: AuditEvent.OCR_STRUCTURED_PROFILE_UPDATED,
        userId: actorId,
        organizationId,
        entityType: 'ocr_structured_extraction_profile',
        entityId: Number(profile.id),
        metadata: {
          action: 'OCR_STRUCTURED_PROFILE_UPDATED',
          changedFields: Object.keys(input),
          versionIncremented,
        },
        requestId: this.ctx.auditContext?.requestId ?? null,
      })

      // 重新加载以获取完整详情（事务内：getProfileDetail 的查询必须走同一连接）
      return await this.getProfileDetail(profileId, organizationId, trx)
    })
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Run Management
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 创建提取运行——验证 accepted extraction 新鲜度，计算输入签名与幂等键。
   */
  async createRun(
    input: CreateOcrExtractionRunRequest,
    organizationId: number,
    projectId: number,
    actorId: number,
  ): Promise<OcrExtractionRunSummary> {
    if ((input.profileId === undefined) === (input.profileRef === undefined)) {
      throw new ValidationException('profileId 与 profileRef 必须且只能提供一个', {
        code: 'PROFILE_REFERENCE_INVALID',
      })
    }
    // 1. 加载 accepted extraction 并验证
    const extraction = await OcrReviewAcceptedExtraction.query()
      .where('id', input.extractionId)
      .where('organization_id', organizationId)
      .first()

    if (!extraction) {
      throw new ResourceNotFoundException('已接受提取记录不存在')
    }

    const eligible = isAcceptedExtractionEligible({
      status: extraction.status ?? 'current',
      isExpired: false, // retention 服务负责该判断，此处简化
      isPurged: extraction.purgedAt !== null,
      isHeld: false, // retention 服务负责该判断，此处简化
    })

    if (!eligible) {
      throw new ValidationException('已接受提取记录不是 current 状态，无法创建结构化提取运行', {
        code: 'EXTRACTION_NOT_ELIGIBLE',
      })
    }

    // 2. 加载 host profile 或解析 enabled plugin profile。插件内容只进入
    // 不可变 run snapshot，不物化为第二套 profile registry row。
    let profileId: number | null = null
    let profileVersionId: number | null = null
    let profileName: string
    let profileVersionNumber: number
    let profileRef: string | null = null
    let profileSource: 'builtin' | 'organization' | 'plugin' = 'builtin'
    let profilePayloadDigest: string | null = null
    let profileSnapshot: OcrProfileProjection | null = null
    let schema: OcrExtractionProfileSchema

    if (input.profileRef !== undefined) {
      if (!isPluginOcrProfileRef(input.profileRef)) {
        throw new ValidationException('非法插件 Profile 引用', {
          code: 'PROFILE_REFERENCE_INVALID',
        })
      }
      const resolved = await new OcrProfilePluginResolver().resolve(
        organizationId,
        input.profileRef,
      )
      if (!resolved) throw new ResourceNotFoundException('提取 Profile 不存在')
      profileRef = resolved.profileRef
      profileName = resolved.name
      profileVersionNumber = Number(resolved.version.split('.')[0] ?? 1)
      profileSource = 'plugin'
      profilePayloadDigest = resolved.pluginRef?.payloadDigest ?? null
      profileSnapshot = resolved
      schema = this.pluginProjectionToSchema(resolved)
    } else {
      const profile = await OcrStructuredExtractionProfile.query()
        .where('id', input.profileId!)
        .where((b) => {
          b.where('organization_id', organizationId).orWhere('scope', 'builtin')
        })
        .first()
      if (!profile) throw new ResourceNotFoundException('提取 Profile 不存在')
      if (profile.status === 'archived') {
        throw new ValidationException('已归档的 Profile 不可创建新运行', {
          code: 'PROFILE_ARCHIVED',
        })
      }
      const profileVersion = await OcrStructuredExtractionProfileVersion.query()
        .where('profile_id', profile.id)
        .where('version', profile.currentVersion)
        .first()
      if (!profileVersion) throw new ResourceNotFoundException('Profile 版本不存在')
      profileId = profile.id
      profileVersionId = profileVersion.id
      profileName = profile.name
      profileVersionNumber = profile.currentVersion
      profileSource = profile.scope === 'builtin' ? 'builtin' : 'organization'
      schema = profileVersion.schemaDefinitionJson
    }

    // 3. 计算输入签名与幂等键
    const inputSignature = computeStructuredExtractionInputSignature(
      extraction.id,
      extraction.sourceHash,
      profileRef ?? profileId!,
      profileSnapshot?.version ?? profileVersionNumber,
      input.options,
    )

    const rawIdempotencyKey =
      input.idempotencyKey ??
      `se_ext_${extraction.id}_${profileRef ?? profileId}_${profileSnapshot?.version ?? profileVersionNumber}`
    const idempotencyKey = normalizeStructuredExtractionIdempotencyKey(rawIdempotencyKey)

    // 4. 检查是否已有相同签名的运行（幂等性）
    const existingRun = await OcrStructuredExtractionRun.query()
      .where('organization_id', organizationId)
      .where('input_signature', inputSignature)
      .orderBy('created_at', 'desc')
      .first()

    if (existingRun) {
      return this.toRunSummary(existingRun)
    }

    // 5. 创建运行
    const run = new OcrStructuredExtractionRun()
    run.organizationId = organizationId
    run.projectId = projectId
    run.extractionId = extraction.id
    run.profileId = profileId
    run.profileVersionId = profileVersionId
    run.profileRef = profileRef
    run.profileSource = profileSource
    run.profilePayloadDigest = profilePayloadDigest
    run.profileSnapshotJson = profileSnapshot
    run.profileName = profileName
    run.profileVersion = profileVersionNumber
    run.status = 'pending'
    run.provenance = 'deterministic'
    run.sourceHash = extraction.sourceHash
    run.inputSignature = inputSignature
    run.idempotencyKey = idempotencyKey
    run.totalFieldCandidates = 0
    run.totalTableCandidates = 0
    run.warningCount = 0
    run.errorCount = 0
    run.warningSummaryJson = null
    run.createdBy = actorId
    await run.save()

    await this.audit.log({
      event: AuditEvent.OCR_STRUCTURED_RUN_CREATED,
      userId: actorId,
      organizationId,
      entityType: 'ocr_structured_extraction_run',
      entityId: Number(run.id),
      metadata: {
        action: 'OCR_STRUCTURED_RUN_CREATED',
        extractionId: extraction.id,
        profileId,
        profileRef,
        profileVersion: profileSnapshot?.version ?? profileVersionNumber,
        profilePayloadDigest,
        inputSignature,
      },
      requestId: this.ctx.auditContext?.requestId ?? null,
    })

    // 6. 触发确定性处理
    return await this.processRun(
      run.id,
      extraction.selectedText,
      schema,
      organizationId,
      projectId,
      actorId,
      input.options,
    )
  }

  /**
   * 确定性结构化提取引擎——将已确认 OCR 文本按 profile schema 解析为字段与表格候选。
   */
  async processRun(
    runId: number,
    acceptedText: string,
    profileSchema: OcrExtractionProfileSchema,
    organizationId: number,
    _projectId: number,
    actorId: number,
    options?: { maxFieldCandidates?: number; maxTableRows?: number },
  ): Promise<OcrExtractionRunSummary> {
    const run = await OcrStructuredExtractionRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .first()

    if (!run) {
      throw new ResourceNotFoundException('提取运行不存在')
    }

    try {
      run.status = 'processing'
      await run.save()

      const allFieldWarnings: OcrExtractionWarning[] = []
      const allTableWarnings: OcrExtractionWarning[] = []
      const fieldCandidatesToSave: Array<{
        runId: number
        sectionKey: string
        fieldKey: string
        fieldType: OcrStructuredFieldType
        raw: string
        valueJson: OcrTypedFieldValue | null
        confidence: OcrExtractionConfidenceLevel
        confidenceScore: number
        spanPageIndex: number | null
        spanCharStart: number | null
        spanCharEnd: number | null
        sourceSpanHash: string
        candidateHash: string
        warningsJson: OcrExtractionWarning[]
        provenance: OcrExtractionProvenanceKind
        status: OcrExtractionCandidateStatus
      }> = []
      const tableCandidatesToSave: Array<{
        runId: number
        tableKey: string
        columnCount: number
        rowsJson: OcrTableRowCandidate[]
        maxRows: number
        confidence: OcrExtractionConfidenceLevel
        confidenceScore: number
        warningsJson: OcrExtractionWarning[]
        provenance: OcrExtractionProvenanceKind
        status: OcrExtractionCandidateStatus
      }> = []

      // 规范化文本
      const normalizedText = acceptedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      // 1. 拆分章节
      const sections = this.splitSections(normalizedText, profileSchema.sections)

      // 2. 提取字段
      const allFieldDefs: Array<{ def: OcrExtractionFieldDefinition; sectionKey: string }> = []
      for (const sec of profileSchema.sections) {
        for (const field of sec.fields) {
          allFieldDefs.push({ def: field, sectionKey: sec.key })
        }
      }

      for (const { def, sectionKey } of allFieldDefs) {
        const sectionChunk = sections.find((s) => s.label === sectionKey)
        const searchText = sectionChunk ? sectionChunk.text : normalizedText

        const { extracted, warnings, score } = this.extractField(def, searchText)

        if (extracted !== null || def.required) {
          const raw = extracted?.raw ?? ''
          const spanRef = extracted?.spanRef ?? null
          const sourceSpanHash = spanRef
            ? computeSourceSpanHash(
                normalizedText,
                spanRef.pageIndex,
                spanRef.charStart,
                spanRef.charEnd,
              )
            : computeSourceSpanHash(normalizedText, 0, 0, 0)

          const candidateHash = computeFieldCandidateHash(def.key, sectionKey, raw, spanRef)

          const confidenceLevel = resolveConfidenceLevel(score)
          const fieldWarnings: OcrExtractionWarning[] = []

          if (!extracted && def.required) {
            fieldWarnings.push({
              code: 'MISSING_REQUIRED_FIELD',
              message: `必填字段 "${def.label}" 未找到`,
              fieldKey: def.key,
              severity: 'error',
            })
            allFieldWarnings.push(...fieldWarnings)
          }

          fieldWarnings.push(...warnings)
          allFieldWarnings.push(...warnings)

          fieldCandidatesToSave.push({
            runId,
            sectionKey,
            fieldKey: def.key,
            fieldType: def.fieldType,
            raw,
            valueJson: extracted?.value ?? null,
            confidence: confidenceLevel,
            confidenceScore: score,
            spanPageIndex: spanRef?.pageIndex ?? null,
            spanCharStart: spanRef?.charStart ?? null,
            spanCharEnd: spanRef?.charEnd ?? null,
            sourceSpanHash,
            candidateHash,
            warningsJson: fieldWarnings,
            provenance: 'deterministic',
            status: 'generated',
          })
        }
      }

      // 3. 提取表格
      for (const tableSchema of profileSchema.tables) {
        const { rows, warnings, score } = this.extractTable(tableSchema, normalizedText)

        allTableWarnings.push(...warnings)

        const rowsWithHash = rows.map((row) => {
          const rawCells = row.cells.map((c) => c.raw)
          const rowHash = computeTableRowHash(tableSchema.key, row.rowIndex, rawCells)
          return {
            ...row,
            sourceSpanHash: rowHash,
            candidateHash: rowHash,
          }
        })

        tableCandidatesToSave.push({
          runId,
          tableKey: tableSchema.key,
          columnCount: tableSchema.columns.length,
          rowsJson: rowsWithHash,
          maxRows: tableSchema.maxRows,
          confidence: resolveConfidenceLevel(score),
          confidenceScore: score,
          warningsJson: warnings,
          provenance: 'deterministic',
          status: 'generated',
        })
      }

      // 4. 应用 options 限制
      const maxFields = options?.maxFieldCandidates ?? profileSchema.validationRules.maxFieldsPerRun
      const maxTableRows = options?.maxTableRows ?? profileSchema.validationRules.maxTableRowsPerRun
      const limitedFieldCandidates = fieldCandidatesToSave.slice(0, maxFields)
      const limitedTableCandidates = tableCandidatesToSave.map((tc) => ({
        ...tc,
        rowsJson: tc.rowsJson.slice(0, maxTableRows),
      }))

      // 5. 批量写入候选
      return db.transaction(async (trx) => {
        // 删除旧候选（幂等性：同一 run 重新处理）
        await OcrStructuredExtractionFieldCandidate.query({ client: trx })
          .where('run_id', runId)
          .delete()
        await OcrStructuredExtractionTableCandidate.query({ client: trx })
          .where('run_id', runId)
          .delete()

        for (const fc of limitedFieldCandidates) {
          const candidate = new OcrStructuredExtractionFieldCandidate()
          candidate.runId = fc.runId
          candidate.sectionKey = fc.sectionKey
          candidate.fieldKey = fc.fieldKey
          candidate.fieldType = fc.fieldType
          candidate.raw = fc.raw
          candidate.valueJson = fc.valueJson
          candidate.confidence = fc.confidence
          candidate.confidenceScore = fc.confidenceScore
          candidate.spanPageIndex = fc.spanPageIndex
          candidate.spanCharStart = fc.spanCharStart
          candidate.spanCharEnd = fc.spanCharEnd
          candidate.sourceSpanHash = fc.sourceSpanHash
          candidate.candidateHash = fc.candidateHash
          candidate.warningsJson = fc.warningsJson
          candidate.provenance = fc.provenance
          candidate.status = fc.status
          await candidate.useTransaction(trx).save()
        }

        for (const tc of limitedTableCandidates) {
          const candidate = new OcrStructuredExtractionTableCandidate()
          candidate.runId = tc.runId
          candidate.tableKey = tc.tableKey
          candidate.columnCount = tc.columnCount
          candidate.rowsJson = tc.rowsJson
          candidate.maxRows = tc.maxRows
          candidate.confidence = tc.confidence
          candidate.confidenceScore = tc.confidenceScore
          candidate.warningsJson = tc.warningsJson
          candidate.provenance = tc.provenance
          candidate.status = tc.status
          await candidate.useTransaction(trx).save()
        }

        const hasErrors =
          allFieldWarnings.some((w) => w.severity === 'error') ||
          allTableWarnings.some((w) => w.severity === 'error')

        const warningSummary = aggregateExtractionWarningSummary({
          fieldWarnings: allFieldWarnings,
          tableWarnings: allTableWarnings,
        })

        run.status = hasErrors ? 'completed_with_warnings' : 'completed'
        run.totalFieldCandidates = limitedFieldCandidates.length
        run.totalTableCandidates = limitedTableCandidates.length
        run.warningCount = warningSummary.totalWarnings
        run.errorCount = warningSummary.totalErrors
        run.warningSummaryJson = warningSummary
        // Lucid dateTime 列要求 luxon DateTime（db.raw('CURRENT_TIMESTAMP') 会被拒绝）
        run.completedAt = DateTime.now()
        await run.useTransaction(trx).save()

        // 更新 profile totalRuns
        if (run.profileId !== null) {
          await OcrStructuredExtractionProfile.query({ client: trx })
            .where('id', run.profileId)
            .increment('total_runs', 1)
        }

        await this.audit.log({
          client: trx,
          event:
            run.status === 'completed'
              ? (AuditEvent.PROJECT_UPDATED as any)
              : (AuditEvent.PROJECT_UPDATED as any),
          userId: actorId,
          organizationId,
          entityType: 'ocr_structured_extraction_run',
          entityId: Number(run.id),
          metadata: {
            action:
              run.status === 'completed'
                ? 'OCR_STRUCTURED_RUN_COMPLETED'
                : 'OCR_STRUCTURED_RUN_COMPLETED',
            runStatus: run.status,
            fieldCount: run.totalFieldCandidates,
            tableCount: run.totalTableCandidates,
            warningCount: run.warningCount,
            errorCount: run.errorCount,
          },
          requestId: this.ctx.auditContext?.requestId ?? null,
        })

        return this.toRunSummary(run)
      })
    } catch (error) {
      // 标记失败
      run.status = 'failed'
      await run.save()

      await this.audit.log({
        event: AuditEvent.OCR_STRUCTURED_RUN_FAILED,
        userId: actorId,
        organizationId,
        entityType: 'ocr_structured_extraction_run',
        entityId: Number(run.id),
        metadata: {
          action: 'OCR_STRUCTURED_RUN_FAILED',
          error: error instanceof Error ? error.message : String(error),
        },
        requestId: this.ctx.auditContext?.requestId ?? null,
      })

      throw error
    }
  }

  /**
   * 获取运行详情——包含所有字段和表格候选。
   * `projectId` 必传：路由是项目级的，跨项目访问（同组织内）必须 404 掩盖（F26）。
   */
  async getRunDetail(
    runId: number,
    organizationId: number,
    projectId: number,
  ): Promise<OcrExtractionRunDetail> {
    const run = await OcrStructuredExtractionRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!run) {
      throw new ResourceNotFoundException('提取运行不存在')
    }

    const extraction = await OcrReviewAcceptedExtraction.query()
      .where('id', run.extractionId)
      .where('organization_id', organizationId)
      .first()

    const [fieldCandidates, tableCandidates] = await Promise.all([
      OcrStructuredExtractionFieldCandidate.query()
        .where('run_id', runId)
        .where('status', 'generated'),
      OcrStructuredExtractionTableCandidate.query()
        .where('run_id', runId)
        .where('status', 'generated'),
    ])

    return this.toRunDetail(run, fieldCandidates, tableCandidates, extraction)
  }

  /**
   * 列出运行——分页，含允许的动作。
   */
  async listRuns(
    organizationId: number,
    projectId: number,
    filters: ListOcrExtractionRunsFilter,
  ): Promise<{
    data: OcrExtractionRunSummary[]
    // 列表统一信封约定（AGENTS.md §4）：meta 必须含 totalPages
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = filters.page ?? 1
    const perPage = Math.min(filters.perPage ?? 20, 100)

    let query = OcrStructuredExtractionRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (filters.extractionId !== undefined) {
      query = query.where('extraction_id', filters.extractionId)
    }
    if (filters.profileId !== undefined) {
      query = query.where('profile_id', filters.profileId)
    }
    if (filters.status) {
      query = query.where('status', filters.status)
    }
    if (filters.provenance) {
      query = query.where('provenance', filters.provenance)
    }

    const sortField = filters.sort?.replace(/^[+-]/, '') ?? 'created_at'
    const sortDir = filters.sort?.startsWith('-') ? 'desc' : 'asc'
    query = query.orderBy(sortField, sortDir)

    const totalQuery = query.clone()
    const totalResult = await totalQuery.count('* as total')
    const total = Number(totalResult[0].$extras?.total ?? 0)

    const runs = await query.offset((page - 1) * perPage).limit(perPage)

    return {
      data: runs.map((r) => this.toRunSummary(r)),
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Confirmation / Preview / Save
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 确认预览——验证 source freshness 和 profile version，返回 preview payload。
   */
  async previewConfirmation(
    input: OcrStructuredExtractionPreviewRequest,
    organizationId: number,
    actorId: number,
  ): Promise<OcrStructuredExtractionPreviewResponse> {
    const run = await OcrStructuredExtractionRun.query()
      .where('id', input.runId)
      .where('organization_id', organizationId)
      .first()

    if (!run) {
      throw new ResourceNotFoundException('提取运行不存在')
    }

    if (run.status !== 'completed' && run.status !== 'completed_with_warnings') {
      throw new ValidationException('运行尚未完成，无法预览确认', { code: 'RUN_NOT_COMPLETE' })
    }

    // 加载候选
    const [fieldCandidates, tableCandidates] = await Promise.all([
      OcrStructuredExtractionFieldCandidate.query()
        .where('run_id', input.runId)
        .whereIn('id', input.selectedFieldCandidateIds)
        .where('status', 'generated'),
      OcrStructuredExtractionTableCandidate.query()
        .where('run_id', input.runId)
        .whereIn('id', input.selectedTableCandidateIds)
        .where('status', 'generated'),
    ])

    // 验证 source freshness
    const extraction = await OcrReviewAcceptedExtraction.query()
      .where('id', run.extractionId)
      .where('organization_id', organizationId)
      .first()

    if (!extraction) {
      throw new ResourceNotFoundException('源已接受提取记录不存在')
    }

    if (extraction.sourceHash !== run.sourceHash) {
      throw new ValidationException('源文件已变更，无法预览确认', { code: 'STALE_SOURCE' })
    }

    // 验证 profile version 未变
    const profile =
      run.profileId === null
        ? null
        : await OcrStructuredExtractionProfile.query().where('id', run.profileId).first()

    if (profile && profile.currentVersion !== run.profileVersion) {
      const staleWarnings: OcrExtractionWarning[] = [
        {
          code: 'PROFILE_VERSION_MISMATCH',
          message: `Profile 版本已变更为 v${profile.currentVersion}（运行使用 v${run.profileVersion}）`,
          severity: 'warn',
        },
      ]

      return {
        previewHash: '',
        runId: input.runId,
        sourceHash: run.sourceHash,
        profileId: run.profileId,
        ...(run.profileRef ? { profileRef: run.profileRef } : {}),
        profileSource: run.profileSource,
        profileVersion: run.profileVersion,
        selectedFields: [],
        selectedTables: [],
        snapshot: {
          extractionId: run.extractionId,
          sourceHash: run.sourceHash,
          profileId: run.profileId,
          ...(run.profileRef ? { profileRef: run.profileRef } : {}),
          profileSource: run.profileSource,
          ...(run.profileSnapshotJson?.version
            ? { pluginVersion: run.profileSnapshotJson.version }
            : {}),
          ...(run.profilePayloadDigest ? { profilePayloadDigest: run.profilePayloadDigest } : {}),
          profileVersion: run.profileVersion,
          fieldValues: {},
          tableValues: {},
          sourceSpanHashes: [],
          candidateHashes: [],
        },
        redlineSummary: buildStructuredExtractionRedlineSummary(),
        staleWarnings,
        requiresExplicitConfirmation: true,
      }
    }

    // 构建快照 payload
    const fieldValues: Record<string, OcrTypedFieldValue | null> = {}
    const tableValues: Record<string, OcrTableRowCandidate[]> = {}
    const sourceSpanHashes: string[] = []
    const candidateHashes: string[] = []

    const selectedFields: OcrFieldCandidate[] = []
    const selectedTables: OcrTableCandidate[] = []

    for (const fc of fieldCandidates) {
      fieldValues[fc.fieldKey] = fc.valueJson
      sourceSpanHashes.push(fc.sourceSpanHash)
      candidateHashes.push(fc.candidateHash)
      selectedFields.push(this.toFieldCandidateDTO(fc))
    }

    for (const tc of tableCandidates) {
      // 筛选行
      const selectedRowKeys = input.selectedTableRowKeys?.[tc.tableKey]
      let rows = tc.rowsJson ?? []
      if (selectedRowKeys && selectedRowKeys.length > 0) {
        rows = rows.filter((r) => selectedRowKeys.includes(r.rowKey))
      }
      tableValues[tc.tableKey] = rows
      candidateHashes.push(...rows.map((r) => r.candidateHash))
      selectedTables.push({
        ...this.toTableCandidateDTO(tc),
        rows,
      })
    }

    const selectedFieldHashes = selectedFields.map((f) => f.candidateHash)
    const selectedTableHashes = selectedTables.flatMap((t) => t.rows.map((r) => r.candidateHash))

    const previewHash = computeStructuredExtractionPreviewHash(
      run.sourceHash,
      run.profileRef ?? run.profileId ?? 0,
      run.profileVersion,
      selectedFieldHashes,
      selectedTableHashes,
    )

    const snapshot: OcrStructuredExtractionSnapshotPayload = {
      extractionId: run.extractionId,
      sourceHash: run.sourceHash,
      profileId: run.profileId,
      ...(run.profileRef ? { profileRef: run.profileRef } : {}),
      profileSource: run.profileSource,
      ...(run.profilePayloadDigest ? { profilePayloadDigest: run.profilePayloadDigest } : {}),
      ...(run.profileSnapshotJson?.version
        ? { pluginVersion: run.profileSnapshotJson.version }
        : {}),
      profileVersion: run.profileVersion,
      fieldValues,
      tableValues,
      sourceSpanHashes,
      candidateHashes,
    }

    const staleWarnings: OcrExtractionWarning[] = []

    await this.audit.log({
      event: AuditEvent.OCR_STRUCTURED_PREVIEW,
      userId: actorId,
      organizationId,
      entityType: 'ocr_structured_extraction_run',
      entityId: Number(run.id),
      metadata: {
        action: 'OCR_STRUCTURED_PREVIEW',
        previewHash,
        fieldCount: selectedFields.length,
        tableCount: selectedTables.length,
      },
      requestId: this.ctx.auditContext?.requestId ?? null,
    })

    return {
      previewHash,
      runId: input.runId,
      sourceHash: run.sourceHash,
      profileId: run.profileId,
      ...(run.profileRef ? { profileRef: run.profileRef } : {}),
      profileSource: run.profileSource,
      ...(run.profileSnapshotJson?.version
        ? { pluginVersion: run.profileSnapshotJson.version }
        : {}),
      profileVersion: run.profileVersion,
      selectedFields,
      selectedTables,
      snapshot,
      redlineSummary: buildStructuredExtractionRedlineSummary(),
      staleWarnings,
      requiresExplicitConfirmation: true,
    }
  }

  private pluginProjectionToSchema(profile: OcrProfileProjection): OcrExtractionProfileSchema {
    return {
      schemaKey: profile.profileRef,
      version: Number(profile.version.split('.')[0] ?? 1),
      label: profile.name,
      description: profile.description ?? '',
      sections: [
        {
          key: 'plugin_fields',
          label: profile.name,
          optional: false,
          repeatable: false,
          fields: profile.schemaSnapshot.fields.map((field) => ({
            key: field.key,
            label: field.label,
            fieldType:
              field.type === 'string' ? 'text' : field.type === 'boolean' ? 'enum' : field.type,
            required: field.required === true,
            ...(field.type === 'boolean' ? { enumValues: ['true', 'false'] } : {}),
          })),
        },
      ],
      tables: [],
      validationRules: {
        maxFieldsPerRun: 200,
        maxTableRowsPerRun: 1000,
        maxTotalCandidates: 2000,
        forbidExternalUrls: true,
        forbidArbitraryCode: true,
        forbidDownstreamWrites: true,
      },
      redactionHints: { fields: [], patterns: [] },
    }
  }

  /**
   * 保存确认——验证 previewHash，创建或超集快照。
   */
  async saveConfirmation(
    input: OcrStructuredExtractionSaveRequest,
    organizationId: number,
    projectId: number,
    actorId: number,
  ): Promise<OcrStructuredSnapshotSummary> {
    // 重新运行 preview 逻辑以获取各哈希
    const previewInput: OcrStructuredExtractionPreviewRequest = {
      runId: input.runId,
      selectedFieldCandidateIds: input.selectedFieldCandidateIds,
      selectedTableCandidateIds: input.selectedTableCandidateIds,
      selectedTableRowKeys: input.selectedTableRowKeys,
      reviewNote: input.reviewNote,
    }

    const preview = await this.previewConfirmation(previewInput, organizationId, actorId)

    // 验证 previewHash
    if (input.previewHash !== preview.previewHash) {
      throw new ValidationException('预览哈希不匹配，请重新预览后再确认', {
        code: 'PREVIEW_HASH_MISMATCH',
      })
    }

    // 如果有 stale warnings（profile version mismatch），拒绝
    if (preview.staleWarnings.length > 0) {
      const blocking = preview.staleWarnings.filter((w) => w.severity === 'warn')
      if (blocking.length > 0) {
        throw new ValidationException('Profile 版本已变更，请使用最新版本的 Profile 重新提取', {
          code: 'PROFILE_VERSION_MISMATCH',
        })
      }
    }

    if (!preview.snapshot) {
      throw new ValidationException('无可保存的快照数据')
    }

    const snapshotPayload = preview.snapshot

    // 计算快照哈希
    const fieldHashes = Object.entries(snapshotPayload.fieldValues).map(
      ([key, val]) => `${key}:${val ? JSON.stringify(val) : 'null'}`,
    )
    const tableHashes = Object.entries(snapshotPayload.tableValues).map(
      ([key, rows]) => `${key}:${rows.length}`,
    )
    const snapshotHash = computeStructuredExtractionSnapshotHash(
      snapshotPayload.extractionId,
      snapshotPayload.sourceHash,
      snapshotPayload.profileRef ?? snapshotPayload.profileId ?? 0,
      snapshotPayload.profileVersion,
      fieldHashes,
      tableHashes,
    )

    return db.transaction(async (trx) => {
      // 超集同 source 的 previous current 快照
      const previousCurrent = await OcrStructuredExtractionSnapshot.query({ client: trx })
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('extraction_id', snapshotPayload.extractionId)
        .where('status', 'current')
        .first()

      if (previousCurrent) {
        previousCurrent.status = 'superseded'
        previousCurrent.supersededAt = DateTime.now()
        await previousCurrent.useTransaction(trx).save()
      }

      const snapshot = new OcrStructuredExtractionSnapshot()
      snapshot.organizationId = organizationId
      snapshot.projectId = projectId
      snapshot.extractionId = snapshotPayload.extractionId
      snapshot.profileId = snapshotPayload.profileId
      snapshot.profileRef = snapshotPayload.profileRef ?? null
      snapshot.profileSource = snapshotPayload.profileSource ?? 'builtin'
      snapshot.profilePayloadDigest = snapshotPayload.profilePayloadDigest ?? null
      snapshot.pluginVersion = snapshotPayload.pluginVersion ?? null
      snapshot.profileVersion = snapshotPayload.profileVersion
      snapshot.sourceHash = snapshotPayload.sourceHash
      snapshot.snapshotHash = snapshotHash
      snapshot.fieldValuesJson = snapshotPayload.fieldValues
      snapshot.tableValuesJson = snapshotPayload.tableValues
      snapshot.sourceSpanHashesJson = snapshotPayload.sourceSpanHashes
      snapshot.candidateHashesJson = snapshotPayload.candidateHashes
      snapshot.previewHash = input.previewHash
      snapshot.reviewerId = actorId
      snapshot.reviewNote = input.reviewNote ?? null
      snapshot.status = 'current'
      snapshot.supersededById = null
      snapshot.fieldCount = Object.keys(snapshotPayload.fieldValues).length
      snapshot.tableCount = Object.keys(snapshotPayload.tableValues).length
      snapshot.confirmedAt = DateTime.now()
      await snapshot.useTransaction(trx).save()

      // 如果超集了前一个，回写 supersededById
      if (previousCurrent) {
        previousCurrent.supersededById = snapshot.id
        await previousCurrent.useTransaction(trx).save()
      }

      await this.audit.log({
        client: trx,
        event: AuditEvent.OCR_STRUCTURED_SAVED,
        userId: actorId,
        organizationId,
        entityType: 'ocr_structured_extraction_snapshot',
        entityId: Number(snapshot.id),
        metadata: {
          action: 'OCR_STRUCTURED_SAVED',
          snapshotHash,
          fieldCount: snapshot.fieldCount,
          tableCount: snapshot.tableCount,
          supersededById: previousCurrent?.id ?? null,
        },
        requestId: this.ctx.auditContext?.requestId ?? null,
      })

      return this.toSnapshotSummary(snapshot)
    })
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Snapshots
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 列出快照——分页，按组织隔离。
   */
  async listSnapshots(
    organizationId: number,
    projectId: number,
    filters?: {
      extractionId?: number
      profileId?: number
      status?: string
      sort?: string
      page?: number
      perPage?: number
    },
  ): Promise<{
    data: OcrStructuredSnapshotSummary[]
    meta: { total: number; page: number; perPage: number }
  }> {
    const page = filters?.page ?? 1
    const perPage = Math.min(filters?.perPage ?? 20, 100)

    let query = OcrStructuredExtractionSnapshot.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (filters?.extractionId !== undefined) {
      query = query.where('extraction_id', filters.extractionId)
    }
    if (filters?.profileId !== undefined) {
      query = query.where('profile_id', filters.profileId)
    }
    if (filters?.status) {
      query = query.where('status', filters.status)
    }

    const sortField = filters?.sort?.replace(/^[+-]/, '') ?? 'confirmed_at'
    const sortDir = filters?.sort?.startsWith('-') ? 'desc' : 'asc'
    query = query.orderBy(sortField, sortDir)

    const totalQuery = query.clone()
    const totalResult = await totalQuery.count('* as total')
    const total = Number(totalResult[0].$extras?.total ?? 0)

    const snapshots = await query.offset((page - 1) * perPage).limit(perPage)

    return {
      data: snapshots.map((s) => this.toSnapshotSummary(s)),
      meta: { total, page, perPage },
    }
  }

  /**
   * 获取快照详情。
   */
  async getSnapshotDetail(
    snapshotId: number,
    organizationId: number,
  ): Promise<OcrStructuredSnapshotDetail> {
    const snapshot = await OcrStructuredExtractionSnapshot.query()
      .where('id', snapshotId)
      .where('organization_id', organizationId)
      .first()

    if (!snapshot) {
      throw new ResourceNotFoundException('结构化提取快照不存在')
    }

    return this.toSnapshotDetail(snapshot)
  }

  // ══════════════════════════════════════════════════════════════════════
  //  DTO Converters
  // ══════════════════════════════════════════════════════════════════════

  toProfileSummary(profile: OcrStructuredExtractionProfile): OcrExtractionProfileSummary {
    return {
      profileId: profile.id,
      name: profile.name,
      scope: profile.scope,
      status: profile.status,
      schemaKey: profile.schemaKey,
      currentVersion: profile.currentVersion,
      totalRuns: profile.totalRuns,
      description: profile.description,
      organizationId: profile.organizationId,
      projectId: profile.projectId,
      createdAt: profile.createdAt.toISO()!,
      updatedAt: profile.updatedAt?.toISO() ?? profile.createdAt.toISO()!,
    }
  }

  toRunSummary(run: OcrStructuredExtractionRun): OcrExtractionRunSummary {
    const isComplete = run.status === 'completed' || run.status === 'completed_with_warnings'
    const hasCandidates = run.totalFieldCandidates > 0 || run.totalTableCandidates > 0

    const allowedActions = resolveStructuredExtractionActions({
      canView: true,
      canManage: true,
      canRun: true,
      canConfirm: true,
      isStale: false,
      isComplete,
      hasCandidates,
      hasConfirmedSnapshots: false,
    })

    return {
      runId: run.id,
      extractionId: run.extractionId,
      profileId: run.profileId,
      ...(run.profileRef ? { profileRef: run.profileRef } : {}),
      profileSource: run.profileSource,
      ...(run.profilePayloadDigest ? { profilePayloadDigest: run.profilePayloadDigest } : {}),
      ...(run.profileSnapshotJson?.version
        ? { pluginVersion: run.profileSnapshotJson.version }
        : {}),
      profileName: run.profileName,
      profileVersion: run.profileVersion,
      status: run.status,
      totalFieldCandidates: run.totalFieldCandidates,
      totalTableCandidates: run.totalTableCandidates,
      warningCount: run.warningCount,
      errorCount: run.errorCount,
      provenance: run.provenance,
      createdBy: run.createdBy,
      createdAt: run.createdAt.toISO()!,
      completedAt: run.completedAt?.toISO() ?? null,
      allowedActions,
    }
  }

  toRunDetail(
    run: OcrStructuredExtractionRun,
    fieldCandidates: OcrStructuredExtractionFieldCandidate[],
    tableCandidates: OcrStructuredExtractionTableCandidate[],
    extraction?: OcrReviewAcceptedExtraction | null,
  ): OcrExtractionRunDetail {
    const summary = this.toRunSummary(run)

    const extractionSummary = extraction
      ? {
          extractionId: extraction.id,
          sourceHash: extraction.sourceHash,
          candidateHash: extraction.candidateHash ?? '',
          selectedTextHash: extraction.selectedTextHash,
          pageRefs: extraction.pageRefsJson ?? [],
          sourceKind: extraction.sourceKind,
          sourceName: null as string | null,
          confirmedAt: extraction.confirmedAt.toISO()!,
          status: extraction.status as 'current' | 'superseded',
        }
      : {
          extractionId: run.extractionId,
          sourceHash: run.sourceHash,
          candidateHash: '',
          selectedTextHash: '',
          pageRefs: [] as number[],
          sourceKind: 'attachment' as const,
          sourceName: null,
          confirmedAt: run.createdAt.toISO()!,
          status: 'current' as const,
        }

    const fieldDTOs = fieldCandidates.map((fc) => this.toFieldCandidateDTO(fc))
    const tableDTOs = tableCandidates.map((tc) => this.toTableCandidateDTO(tc))

    const allWarnings: OcrExtractionWarning[] = [
      ...fieldCandidates.flatMap((fc) => fc.warningsJson ?? []),
      ...tableCandidates.flatMap((tc) => tc.warningsJson ?? []),
    ]

    return {
      ...summary,
      extractionSummary,
      inputSignature: run.inputSignature,
      idempotencyKey: run.idempotencyKey,
      sourceHash: run.sourceHash,
      fieldCandidates: fieldDTOs,
      tableCandidates: tableDTOs,
      warningSummary:
        run.warningSummaryJson ??
        aggregateExtractionWarningSummary({
          fieldWarnings: allWarnings.filter((w) => w.fieldKey !== undefined),
          tableWarnings: allWarnings.filter((w) => w.tableKey !== undefined),
        }),
    }
  }

  toFieldCandidateDTO(fc: OcrStructuredExtractionFieldCandidate): OcrFieldCandidate {
    const spanRef: OcrSourceSpanRef | null =
      fc.spanPageIndex !== null && fc.spanCharStart !== null && fc.spanCharEnd !== null
        ? { pageIndex: fc.spanPageIndex, charStart: fc.spanCharStart, charEnd: fc.spanCharEnd }
        : null

    return {
      candidateId: fc.id,
      runId: fc.runId,
      sectionKey: fc.sectionKey,
      fieldKey: fc.fieldKey,
      fieldType: fc.fieldType,
      raw: fc.raw,
      value: fc.valueJson,
      confidence: fc.confidence,
      confidenceScore: fc.confidenceScore,
      spanRef,
      sourceSpanHash: fc.sourceSpanHash,
      candidateHash: fc.candidateHash,
      warnings: fc.warningsJson ?? [],
      provenance: fc.provenance,
      status: fc.status,
      createdAt: fc.createdAt.toISO()!,
    }
  }

  toTableCandidateDTO(tc: OcrStructuredExtractionTableCandidate): OcrTableCandidate {
    return {
      candidateId: tc.id,
      runId: tc.runId,
      tableKey: tc.tableKey,
      columnCount: tc.columnCount,
      rows: tc.rowsJson ?? [],
      maxRows: tc.maxRows,
      confidence: tc.confidence,
      confidenceScore: tc.confidenceScore,
      warnings: tc.warningsJson ?? [],
      provenance: tc.provenance,
      status: tc.status,
      createdAt: tc.createdAt.toISO()!,
    }
  }

  toSnapshotSummary(s: OcrStructuredExtractionSnapshot): OcrStructuredSnapshotSummary {
    return {
      snapshotId: s.id,
      extractionId: s.extractionId,
      profileId: s.profileId,
      ...(s.profileRef ? { profileRef: s.profileRef } : {}),
      profileSource: s.profileSource,
      ...(s.profilePayloadDigest ? { profilePayloadDigest: s.profilePayloadDigest } : {}),
      ...(s.pluginVersion ? { pluginVersion: s.pluginVersion } : {}),
      profileName: '', // 由调用方填充，此处只需要结构一致
      profileVersion: s.profileVersion,
      sourceHash: s.sourceHash,
      snapshotHash: s.snapshotHash,
      fieldCount: s.fieldCount,
      tableCount: s.tableCount,
      reviewerId: s.reviewerId,
      reviewNote: s.reviewNote,
      status: s.status,
      supersededById: s.supersededById,
      confirmedAt: s.confirmedAt.toISO()!,
      supersededAt: s.supersededAt?.toISO() ?? null,
    }
  }

  toSnapshotDetail(s: OcrStructuredExtractionSnapshot): OcrStructuredSnapshotDetail {
    return {
      ...this.toSnapshotSummary(s),
      fieldValues: s.fieldValuesJson ?? {},
      tableValues: s.tableValuesJson ?? {},
      sourceSpanHashes: s.sourceSpanHashesJson ?? [],
      candidateHashes: s.candidateHashesJson ?? [],
      previewHash: s.previewHash,
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  确定性 Parser
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 将文本拆分为章节 chunk。
   * 识别常见中文标题模式与 Markdown 标题。
   */
  private splitSections(
    text: string,
    sectionDefs: OcrExtractionSectionDefinition[],
  ): SectionChunk[] {
    const lines = text.split('\n')
    const chunks: SectionChunk[] = []

    // 构建标题正则
    const headerPatterns = [
      /^第[一二三四五六七八九十百千]+[章节部分篇]/,
      /^[#]{1,3}\s+/,
      /^[A-Z一-鿿][^.]*[:：]$/,
      /^\*\*[^*]+\*\*[:：]?$/,
    ]

    // 首先按 markdown 标题拆分
    let currentSectionLabel = '__default__'
    let currentSectionLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        currentSectionLines.push('')
        continue
      }

      const isHeader = headerPatterns.some((pat) => pat.test(trimmed))
      if (isHeader) {
        // 保存前一个 section
        if (currentSectionLines.length > 0 || currentSectionLabel !== '__default__') {
          chunks.push({
            label: currentSectionLabel,
            text: currentSectionLines.join('\n'),
          })
        }

        // 清理标题文本（去掉标记符号）
        let cleanLabel = trimmed
          .replace(/^[#]{1,3}\s+/, '')
          .replace(/^\*\*/, '')
          .replace(/\*\*[:：]?$/, '')
          .replace(/[:：]$/, '')
          .trim()

        // 尝试匹配 section defs
        const matched = sectionDefs.find(
          (s) => s.label.includes(cleanLabel) || cleanLabel.includes(s.label),
        )
        currentSectionLabel = matched ? matched.key : cleanLabel
        currentSectionLines = []
      } else {
        currentSectionLines.push(line)
      }
    }

    // 保存最后一个 section
    if (currentSectionLines.length > 0 || currentSectionLabel !== '__default__') {
      chunks.push({
        label: currentSectionLabel,
        text: currentSectionLines.join('\n'),
      })
    }

    // 如果没有找到任何标题，整个文本作为默认 section
    if (chunks.length === 0) {
      chunks.push({ label: '__default__', text })
    }

    return chunks
  }

  /**
   * 从文本中提取单个字段的值。
   */
  private extractField(
    def: OcrExtractionFieldDefinition,
    text: string,
  ): {
    extracted: { raw: string; value: OcrTypedFieldValue; spanRef: OcrSourceSpanRef | null } | null
    warnings: OcrExtractionWarning[]
    score: number
  } {
    const warnings: OcrExtractionWarning[] = []
    const escapedLabel = def.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let match: RegExpMatchArray | null = null
    let matchType: 'exact' | 'fuzzy' = 'exact'

    // 匹配模式，按优先级
    const patterns: Array<{ regex: RegExp; type: 'exact' | 'fuzzy' }> = [
      // 完整标签：字段名：值 / 字段名: 值
      { regex: new RegExp(`${escapedLabel}\\s*[:：]\\s*(.+)`, 'im'), type: 'exact' },
      // **字段名**：值
      { regex: new RegExp(`\\*\\*${escapedLabel}\\*\\*\\s*[:：]?\\s*(.+)`, 'im'), type: 'exact' },
      // 字段名\t值
      { regex: new RegExp(`${escapedLabel}\\t(.+)`, 'im'), type: 'exact' },
    ]

    for (const { regex, type } of patterns) {
      const m = text.match(regex)
      if (m) {
        match = m
        matchType = type
        break
      }
    }

    // 模糊匹配：只包含字段名关键词
    if (!match) {
      const keywords = def.label.split(/\s+/).filter((k) => k.length >= 2)
      for (const kw of keywords) {
        const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const m = text.match(new RegExp(`${escapedKw}\\s*[:：]?\\s*(.+)`, 'im'))
        if (m) {
          match = m
          matchType = 'fuzzy'
          warnings.push({
            code: 'AMBIGUOUS_LABEL',
            message: `字段 "${def.label}" 通过模糊匹配找到关键字 "${kw}"`,
            fieldKey: def.key,
            severity: 'info',
          })
          break
        }
      }
    }

    if (!match || !match[1] || match[1].trim().length === 0) {
      return { extracted: null, warnings, score: 0.0 }
    }

    const rawValue = match[1].trim()
    const trimmedValue = rawValue.replace(/\s+/g, ' ').trim()

    // 计算源跨度
    const charStart = match.index! + match[0].indexOf(rawValue)
    const charEnd = charStart + rawValue.length
    const spanRef: OcrSourceSpanRef = { pageIndex: 0, charStart, charEnd }

    // 类型强制转换
    const coerced = this.coerceValue(trimmedValue, rawValue, def, warnings)

    // 计算置信度
    let score = matchType === 'exact' ? 0.95 : 0.65

    if (coerced.warnings.length > 0) {
      score = Math.max(score - coerced.warnings.length * 0.15, 0.1)
    }

    warnings.push(...coerced.warnings)

    return {
      extracted: {
        raw: rawValue,
        value: coerced.value,
        spanRef,
      },
      warnings,
      score: Math.round(score * 100) / 100,
    }
  }

  /**
   * 将原始文本值强制转换为类型化值。
   */
  private coerceValue(
    trimmed: string,
    raw: string,
    def: OcrExtractionFieldDefinition,
    _warnings: OcrExtractionWarning[],
  ): { value: OcrTypedFieldValue; warnings: OcrExtractionWarning[] } {
    const localWarnings: OcrExtractionWarning[] = []
    const fieldKey = def.key

    switch (def.fieldType) {
      case 'date':
        return this.coerceDate(trimmed, raw, fieldKey, localWarnings)

      case 'number':
        return this.coerceNumber(trimmed, fieldKey, localWarnings)

      case 'enum':
        return this.coerceEnum(trimmed, def.enumValues ?? [], fieldKey, localWarnings)

      case 'person_name':
        return this.coercePersonName(trimmed, fieldKey, localWarnings)

      case 'project_ref':
        return this.coerceProjectRef(trimmed, fieldKey, localWarnings)

      case 'text':
      default:
        return {
          value: { kind: 'text', raw, normalized: trimmed } as OcrTypedTextValue,
          warnings: localWarnings,
        }
    }
  }

  private coerceDate(
    trimmed: string,
    raw: string,
    fieldKey: string,
    warnings: OcrExtractionWarning[],
  ): { value: OcrTypedFieldValue; warnings: OcrExtractionWarning[] } {
    // YYYY年M月D日
    let m = trimmed.match(RE_DATE_CN_FULL)
    if (m) {
      const year = Number.parseInt(m[1], 10)
      const month = Number.parseInt(m[2], 10)
      const day = Number.parseInt(m[3], 10)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return {
          value: {
            kind: 'date',
            raw,
            normalized: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            parsed: { year, month, day },
          } as OcrTypedDateValue,
          warnings,
        }
      }
    }

    // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
    m = trimmed.match(RE_DATE_ISO)
    if (m) {
      const year = Number.parseInt(m[1], 10)
      const month = Number.parseInt(m[2], 10)
      const day = Number.parseInt(m[3], 10)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return {
          value: {
            kind: 'date',
            raw,
            normalized: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            parsed: { year, month, day },
          } as OcrTypedDateValue,
          warnings,
        }
      }
    }

    // M月D日（省略年，使用当前年）
    m = trimmed.match(RE_DATE_CN_SHORT)
    if (m) {
      const month = Number.parseInt(m[1], 10)
      const day = Number.parseInt(m[2], 10)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const currentYear = new Date().getFullYear()
        warnings.push({
          code: 'AMBIGUOUS_DATE',
          message: `日期 "${trimmed}" 缺少年份，已使用当前年份 ${currentYear}`,
          fieldKey,
          severity: 'warn',
        })
        return {
          value: {
            kind: 'date',
            raw,
            normalized: `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            parsed: { year: currentYear, month, day },
          } as OcrTypedDateValue,
          warnings,
        }
      }
    }

    // MM/DD
    m = trimmed.match(RE_DATE_MMDD)
    if (m) {
      const month = Number.parseInt(m[1], 10)
      const day = Number.parseInt(m[2], 10)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const currentYear = new Date().getFullYear()
        warnings.push({
          code: 'AMBIGUOUS_DATE',
          message: `日期 "${trimmed}" 缺少年份且月日顺序不确定，已假定为 MM/DD 格式`,
          fieldKey,
          severity: 'warn',
        })
        return {
          value: {
            kind: 'date',
            raw,
            normalized: `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            parsed: { year: currentYear, month, day },
          } as OcrTypedDateValue,
          warnings,
        }
      }
    }

    // 无法解析——返回原始文本
    warnings.push({
      code: 'VALUE_COERCION_FAILED',
      message: `无法将 "${trimmed}" 解析为日期`,
      fieldKey,
      severity: 'warn',
    })
    return {
      value: {
        kind: 'date',
        raw,
        normalized: trimmed,
        parsed: null,
      } as OcrTypedDateValue,
      warnings,
    }
  }

  private coerceNumber(
    trimmed: string,
    fieldKey: string,
    warnings: OcrExtractionWarning[],
  ): { value: OcrTypedFieldValue; warnings: OcrExtractionWarning[] } {
    // 移除中文数字修饰符
    const cleaned = trimmed
      .replace(/[,，]/g, '') // 千位分隔符
      .replace(/[约近大约超过]/g, '') // 修饰词
      .replace(/[%％]/g, '') // 百分号
      .trim()

    const num = Number.parseFloat(cleaned)
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      return {
        value: { kind: 'number', raw: trimmed, normalized: num } as OcrTypedNumberValue,
        warnings,
      }
    }

    // 中文数字转换
    const cnNumMap: Record<string, number> = {
      零: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
    }
    let cnResult: number | null = null

    if (/^[零一二两三四五六七八九十]+$/.test(trimmed)) {
      const chars = [...trimmed]
      if (chars.length === 1 && cnNumMap[chars[0]] !== undefined) {
        cnResult = cnNumMap[chars[0]]
      } else if (chars.includes('十')) {
        const tenIdx = chars.indexOf('十')
        const tens = chars.slice(0, tenIdx).map((c) => cnNumMap[c] ?? 0)
        const ones = chars.slice(tenIdx + 1).map((c) => cnNumMap[c] ?? 0)
        cnResult = (tens.length > 0 ? (tens[0] || 1) * 10 : 10) + (ones[0] ?? 0)
      }
    }

    if (cnResult !== null) {
      return {
        value: { kind: 'number', raw: trimmed, normalized: cnResult } as OcrTypedNumberValue,
        warnings,
      }
    }

    warnings.push({
      code: 'VALUE_COERCION_FAILED',
      message: `无法将 "${trimmed}" 解析为数字`,
      fieldKey,
      severity: 'warn',
    })
    return {
      value: { kind: 'number', raw: trimmed, normalized: null } as OcrTypedNumberValue,
      warnings,
    }
  }

  private coerceEnum(
    trimmed: string,
    enumValues: string[],
    fieldKey: string,
    warnings: OcrExtractionWarning[],
  ): { value: OcrTypedFieldValue; warnings: OcrExtractionWarning[] } {
    // 精确匹配
    for (const ev of enumValues) {
      if (trimmed === ev || trimmed.includes(ev)) {
        return {
          value: {
            kind: 'enum',
            raw: trimmed,
            normalized: ev,
            matchedValue: ev,
          } as OcrTypedEnumValue,
          warnings,
        }
      }
    }

    // 模糊匹配（包含关系）
    for (const ev of enumValues) {
      if (ev.includes(trimmed)) {
        warnings.push({
          code: 'LOW_CONFIDENCE_MATCH',
          message: `枚举值 "${trimmed}" 部分匹配 "${ev}"`,
          fieldKey,
          severity: 'warn',
        })
        return {
          value: {
            kind: 'enum',
            raw: trimmed,
            normalized: ev,
            matchedValue: ev,
          } as OcrTypedEnumValue,
          warnings,
        }
      }
    }

    // 不匹配——返回原始文本
    warnings.push({
      code: 'VALUE_COERCION_FAILED',
      message: `"${trimmed}" 不匹配任何枚举值：[${enumValues.join(', ')}]`,
      fieldKey,
      severity: 'warn',
    })
    return {
      value: {
        kind: 'enum',
        raw: trimmed,
        normalized: trimmed,
        matchedValue: null,
      } as OcrTypedEnumValue,
      warnings,
    }
  }

  private coercePersonName(
    trimmed: string,
    _fieldKey: string,
    _warnings: OcrExtractionWarning[],
  ): { value: OcrTypedFieldValue; warnings: OcrExtractionWarning[] } {
    // 简单启发式：2-4 个汉字
    const isChineseName = /^[一-鿿]{2,4}$/.test(trimmed)
    return {
      value: {
        kind: 'person_name',
        raw: trimmed,
        normalized: trimmed,
        matchType: isChineseName ? 'exact' : 'none',
      } as OcrTypedPersonNameValue,
      warnings: _warnings,
    }
  }

  private coerceProjectRef(
    trimmed: string,
    _fieldKey: string,
    _warnings: OcrExtractionWarning[],
  ): { value: OcrTypedFieldValue; warnings: OcrExtractionWarning[] } {
    return {
      value: {
        kind: 'project_ref',
        raw: trimmed,
        normalized: trimmed,
        matchedProjectId: null,
        matchType: 'none',
      } as OcrTypedProjectRefValue,
      warnings: _warnings,
    }
  }

  // ─── 表格提取 ──────────────────────────────────────────────────────

  /**
   * 从文本中检测并提取表格数据。
   */
  private extractTable(
    tableSchema: OcrExtractionTableSchema,
    text: string,
  ): {
    rows: OcrTableRowCandidate[]
    warnings: OcrExtractionWarning[]
    score: number
  } {
    const warnings: OcrExtractionWarning[] = []
    let rows: OcrTableRowCandidate[] = []

    // 1. 尝试检测 Markdown 表格
    rows = this.extractMarkdownTable(tableSchema, text, warnings)

    // 2. 尝试检测空白对齐表格
    if (rows.length === 0) {
      rows = this.extractWhitespaceTable(tableSchema, text, warnings)
    }

    // 3. 尝试检测编号列表作为表格行
    if (rows.length === 0) {
      rows = this.extractNumberedListAsTable(tableSchema, text, warnings)
    }

    // 限制最大行数
    if (rows.length > tableSchema.maxRows) {
      rows = rows.slice(0, tableSchema.maxRows)
      warnings.push({
        code: 'TABLE_BOUNDARY_UNCLEAR',
        message: `表格行数 ${rows.length} 超过限制 ${tableSchema.maxRows}，已截断`,
        tableKey: tableSchema.key,
        severity: 'warn',
      })
    }

    // 计算整体置信度
    let score = 0.0
    if (rows.length > 0) {
      const avgConfidence = rows.reduce((sum, r) => sum + r.confidenceScore, 0) / rows.length
      score = avgConfidence
    }

    return { rows, warnings, score: Math.round(score * 100) / 100 }
  }

  /**
   * 检测 Markdown 表格（| col1 | col2 | ... |）。
   */
  private extractMarkdownTable(
    tableSchema: OcrExtractionTableSchema,
    text: string,
    warnings: OcrExtractionWarning[],
  ): OcrTableRowCandidate[] {
    const lines = text.split('\n')
    const rows: OcrTableRowCandidate[] = []

    let inTable = false
    let headerColumns: string[] = []
    let colMapping: number[] = [] // schema column index -> markdown column index

    for (const rawLine of lines) {
      const line = rawLine.trim()

      // 检测表格行：| ... | ... |
      if (/^\|.+\|$/.test(line)) {
        const cells = line
          .split('|')
          .map((c) => c.trim())
          .filter((c) => c.length > 0)

        if (!inTable) {
          // 这是表头行
          inTable = true
          headerColumns = cells
          // 匹配 schema 列
          colMapping = this.matchTableColumns(tableSchema.columns, headerColumns)
          continue
        }

        // 跳过分隔行（| --- | --- |）
        if (cells.every((c) => /^[-:]+$/.test(c))) {
          continue
        }

        // 数据行
        if (cells.length > 0 && colMapping.length > 0) {
          rows.push(this.buildTableRow(tableSchema, colMapping, cells, rows.length, warnings))
        }
      } else if (inTable && line === '') {
        // 空行结束表格
        break
      }
    }

    return rows
  }

  /**
   * 检测空白对齐的表格列（2+ 空格分隔）。
   */
  private extractWhitespaceTable(
    tableSchema: OcrExtractionTableSchema,
    text: string,
    warnings: OcrExtractionWarning[],
  ): OcrTableRowCandidate[] {
    const lines = text.split('\n')
    const rows: OcrTableRowCandidate[] = []
    let headerColumns: string[] = []
    let colMapping: number[] = []
    let inTable = false

    for (const line of lines) {
      // 检测至少 2 个连续空格分隔的列
      const cells = line
        .split(/\s{2,}/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0)

      if (cells.length >= 2) {
        if (!inTable) {
          inTable = true
          headerColumns = cells
          colMapping = this.matchTableColumns(tableSchema.columns, headerColumns)
          continue
        }

        // 检查是否仍在表格中（至少匹配 schema 列）
        if (colMapping.length > 0 && cells.length >= colMapping.length) {
          rows.push(this.buildTableRow(tableSchema, colMapping, cells, rows.length, warnings))
          continue
        }
      } else if (inTable) {
        // 非表格行——结束
        break
      }
    }

    if (!inTable) {
      warnings.push({
        code: 'MISSING_TABLE_HEADER',
        message: `未在文本中找到表格 "${tableSchema.label}" 的列分隔符`,
        tableKey: tableSchema.key,
        severity: 'info',
      })
    }

    return rows
  }

  /**
   * 将编号列表当作表格行（1. val1, val2; 2. val1, val2; ...）。
   */
  private extractNumberedListAsTable(
    tableSchema: OcrExtractionTableSchema,
    text: string,
    warnings: OcrExtractionWarning[],
  ): OcrTableRowCandidate[] {
    const rows: OcrTableRowCandidate[] = []
    const lines = text.split('\n')
    const listPattern = /^(\d+)[.)）]\s+(.+)/

    for (const line of lines) {
      const m = line.trim().match(listPattern)
      if (!m) continue

      const content = m[2]
      // 尝试按逗号/分号/制表符拆分
      const cells = content
        .split(/[;；,，\t]/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0)

      if (cells.length >= 2) {
        rows.push(
          this.buildTableRow(
            tableSchema,
            cells.map((_, idx) => idx),
            cells,
            rows.length,
            warnings,
          ),
        )
      }
    }

    return rows
  }

  /**
   * 匹配 schema 列定义与检测到的表头。
   * 返回 schema_column_index -> detected_column_index 的映射。
   */
  private matchTableColumns(
    schemaColumns: OcrExtractionTableSchema['columns'],
    headerCells: string[],
  ): number[] {
    const mapping: number[] = []
    for (const col of schemaColumns) {
      // 精确匹配
      let matchIdx = headerCells.findIndex((h) => h.trim() === col.label || h.trim() === col.key)
      // 模糊匹配（包含关系）
      if (matchIdx === -1) {
        matchIdx = headerCells.findIndex(
          (h) => h.trim().includes(col.label) || col.label.includes(h.trim()),
        )
      }
      mapping.push(matchIdx) // -1 表示未匹配
    }
    return mapping
  }

  /**
   * 根据列映射构建单行表格候选。
   */
  private buildTableRow(
    tableSchema: OcrExtractionTableSchema,
    colMapping: number[],
    cells: string[],
    rowIndex: number,
    warnings: OcrExtractionWarning[],
  ): OcrTableRowCandidate {
    const rowCells: OcrTypedTableCellValue[] = []
    const spanRefs: OcrSourceSpanRef[] = []
    const rowWarnings: OcrExtractionWarning[] = []

    for (let ci = 0; ci < tableSchema.columns.length; ci++) {
      const col = tableSchema.columns[ci]
      const cellIdx = colMapping[ci]
      const raw = cellIdx >= 0 && cellIdx < cells.length ? cells[cellIdx].trim() : ''

      let value: OcrTypedFieldValue

      switch (col.fieldType) {
        case 'date':
          value = this.coerceDate(raw, raw, `${tableSchema.key}.${col.key}`, rowWarnings).value
          break
        case 'number':
          value = this.coerceNumber(raw, `${tableSchema.key}.${col.key}`, rowWarnings).value
          break
        case 'enum':
          value = this.coerceEnum(
            raw,
            col.enumValues ?? [],
            `${tableSchema.key}.${col.key}`,
            rowWarnings,
          ).value
          break
        case 'person_name':
          value = {
            kind: 'person_name',
            raw,
            normalized: raw,
            matchType: /^[一-鿿]{2,4}$/.test(raw) ? 'exact' : 'none',
          } as OcrTypedPersonNameValue
          break
        case 'text':
        default:
          value = { kind: 'text', raw, normalized: raw } as OcrTypedTextValue
          break
      }

      // 源跨度（估算）
      const spanRef: OcrSourceSpanRef | null =
        raw.length > 0 ? { pageIndex: 0, charStart: 0, charEnd: raw.length } : null

      if (spanRef) spanRefs.push(spanRef)

      rowCells.push({
        fieldKey: col.key,
        fieldType: col.fieldType,
        raw,
        value,
        spanRef,
      })
    }

    const avgCellScore =
      rowCells.length > 0
        ? rowCells.reduce((sum, c) => {
            if (!c.raw || c.raw.length === 0) return sum + 0.1
            return sum + 0.9
          }, 0) / rowCells.length
        : 0.3

    warnings.push(...rowWarnings)

    return {
      rowKey: `row_${rowIndex}`,
      rowIndex,
      cells: rowCells,
      spanRefs,
      sourceSpanHash: '', // 稍后在上层填充
      candidateHash: '', // 稍后在上层填充
      confidence: resolveConfidenceLevel(avgCellScore),
      confidenceScore: Math.round(avgCellScore * 100) / 100,
      warnings: rowWarnings,
      provenance: 'deterministic',
      status: 'generated',
    }
  }
}
