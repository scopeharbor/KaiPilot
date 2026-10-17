import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 向现有 OCR 结果表添加保留生命周期元数据列。
 *
 * 此迁移向以下表添加可空列（非破坏性——不会修改现有数据或移除任何列）：
 *   - ocr_document_jobs: 生命周期状态、保留资格时间戳、purge/redact 时间戳、tombstone 引用
 *   - ocr_document_pages: 生命周期状态、保留资格时间戳、purge/redact 时间戳、tombstone 引用
 *   - ocr_document_candidates: 生命周期状态、保留资格时间戳、purge/redact 时间戳、tombstone 引用
 *   - ocr_review_accepted_extractions: 生命周期状态、保留资格时间戳、purge/redact 时间戳、tombstone 引用
 *
 * 所有列均可空，以安全回填——现有记录保持原样直到回填迁移运行。
 *
 * v3-ocr-result-persistence-and-retention §3.2
 */
export default class extends BaseSchema {
  async up() {
    // ── ocr_document_jobs ──
    this.schema.alterTable('ocr_document_jobs', (table) => {
      table.string('retention_lifecycle', 30).nullable()
      table.string('retention_sensitivity', 30).nullable()
      table.timestamp('retention_eligible_at').nullable()
      table.timestamp('purged_at').nullable()
      table.timestamp('redacted_at').nullable()
      table.bigInteger('tombstone_id').unsigned().nullable()
      table.string('retention_policy_hash', 64).nullable()
      table.index(
        ['organization_id', 'retention_lifecycle', 'retention_eligible_at'],
        'idx_ocdj_org_lifecycle_eligible',
      )
      table.index(['retention_lifecycle'], 'idx_ocdj_retention_lifecycle')
    })

    // ── ocr_document_pages ──
    this.schema.alterTable('ocr_document_pages', (table) => {
      table.string('retention_lifecycle', 30).nullable()
      table.string('retention_sensitivity', 30).nullable()
      table.timestamp('retention_eligible_at').nullable()
      table.timestamp('purged_at').nullable()
      table.timestamp('redacted_at').nullable()
      table.bigInteger('tombstone_id').unsigned().nullable()
      table.string('retention_policy_hash', 64).nullable()
      table.index(['job_id', 'retention_lifecycle'], 'idx_ocdp_job_lifecycle')
      table.index(['retention_lifecycle', 'retention_eligible_at'], 'idx_ocdp_lifecycle_eligible')
    })

    // ── ocr_document_candidates ──
    this.schema.alterTable('ocr_document_candidates', (table) => {
      table.string('retention_lifecycle', 30).nullable()
      table.string('retention_sensitivity', 30).nullable()
      table.timestamp('retention_eligible_at').nullable()
      table.timestamp('purged_at').nullable()
      table.timestamp('redacted_at').nullable()
      table.bigInteger('tombstone_id').unsigned().nullable()
      table.string('retention_policy_hash', 64).nullable()
      table.index(['job_id', 'retention_lifecycle'], 'idx_ocdc_job_lifecycle')
      table.index(['retention_lifecycle', 'retention_eligible_at'], 'idx_ocdc_lifecycle_eligible')
    })

    // ── ocr_review_accepted_extractions ──
    this.schema.alterTable('ocr_review_accepted_extractions', (table) => {
      table.string('retention_lifecycle', 30).nullable()
      table.string('retention_sensitivity', 30).nullable()
      table.timestamp('retention_eligible_at').nullable()
      table.timestamp('purged_at').nullable()
      table.timestamp('redacted_at').nullable()
      table.bigInteger('tombstone_id').unsigned().nullable()
      table.string('retention_policy_hash', 64).nullable()
      table.index(
        ['organization_id', 'project_id', 'retention_lifecycle'],
        'idx_ocrae_org_project_lifecycle',
      )
      table.index(['retention_lifecycle', 'retention_eligible_at'], 'idx_ocrae_lifecycle_eligible')
    })
  }

  async down() {
    // 回滚不会删除数据——只删除列。
    // 生产环境应通过新的迁移安全地处理回滚，而非使用此 down 方法。
    this.schema.alterTable('ocr_document_jobs', (table) => {
      table.dropIndex(
        ['organization_id', 'retention_lifecycle', 'retention_eligible_at'],
        'idx_ocdj_org_lifecycle_eligible',
      )
      table.dropIndex(['retention_lifecycle'], 'idx_ocdj_retention_lifecycle')
      table.dropColumn('retention_lifecycle')
      table.dropColumn('retention_sensitivity')
      table.dropColumn('retention_eligible_at')
      table.dropColumn('purged_at')
      table.dropColumn('redacted_at')
      table.dropColumn('tombstone_id')
      table.dropColumn('retention_policy_hash')
    })

    this.schema.alterTable('ocr_document_pages', (table) => {
      table.dropIndex(['job_id', 'retention_lifecycle'], 'idx_ocdp_job_lifecycle')
      table.dropIndex(
        ['retention_lifecycle', 'retention_eligible_at'],
        'idx_ocdp_lifecycle_eligible',
      )
      table.dropColumn('retention_lifecycle')
      table.dropColumn('retention_sensitivity')
      table.dropColumn('retention_eligible_at')
      table.dropColumn('purged_at')
      table.dropColumn('redacted_at')
      table.dropColumn('tombstone_id')
      table.dropColumn('retention_policy_hash')
    })

    this.schema.alterTable('ocr_document_candidates', (table) => {
      table.dropIndex(['job_id', 'retention_lifecycle'], 'idx_ocdc_job_lifecycle')
      table.dropIndex(
        ['retention_lifecycle', 'retention_eligible_at'],
        'idx_ocdc_lifecycle_eligible',
      )
      table.dropColumn('retention_lifecycle')
      table.dropColumn('retention_sensitivity')
      table.dropColumn('retention_eligible_at')
      table.dropColumn('purged_at')
      table.dropColumn('redacted_at')
      table.dropColumn('tombstone_id')
      table.dropColumn('retention_policy_hash')
    })

    this.schema.alterTable('ocr_review_accepted_extractions', (table) => {
      table.dropIndex(
        ['organization_id', 'project_id', 'retention_lifecycle'],
        'idx_ocrae_org_project_lifecycle',
      )
      table.dropIndex(
        ['retention_lifecycle', 'retention_eligible_at'],
        'idx_ocrae_lifecycle_eligible',
      )
      table.dropColumn('retention_lifecycle')
      table.dropColumn('retention_sensitivity')
      table.dropColumn('retention_eligible_at')
      table.dropColumn('purged_at')
      table.dropColumn('redacted_at')
      table.dropColumn('tombstone_id')
      table.dropColumn('retention_policy_hash')
    })
  }
}
