import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ocr_review_accepted_extractions 表：V3 OCR 审查确认流——已接受提取记录。
 *
 * 每条记录代表一次用户显式确认的 OCR 提取文本。
 * 组织+项目双隔离 + append-only + supersede 语义。
 * source_hash + candidate_hash + selected_text_hash 保证确定性可追踪。
 * 与上游 OCR job/candidate 通过 source_ref + candidate_ref 关联。
 * 不存储完整候选文本、prompt、raw provider 错误。
 *
 * v3-ocr-review-confirmation-flow §3.2
 */
export default class extends BaseSchema {
  protected tableName = 'ocr_review_accepted_extractions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织/项目/操作人归属
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .bigInteger('reviewer_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 来源引用（上游文件/附件/作业/候选的引用，不存储原始文本）
      table.string('source_kind', 20).notNullable().defaultTo('attachment')
      table.check("source_kind IN ('attachment','document','unknown')")
      table.bigInteger('source_id').unsigned().nullable()
      table.bigInteger('job_id').unsigned().nullable()
      table.bigInteger('candidate_id').unsigned().nullable()

      // 确定性哈希
      table.string('source_hash', 64).notNullable()
      table.string('candidate_hash', 64).notNullable()
      table.string('selected_text_hash', 64).notNullable()

      // 选中的文本（用户确认后的持久化，仅权限用户可访问）
      table.text('selected_text', 'longtext').notNullable()

      // 页面引用 JSON
      table.json('page_refs_json').notNullable().defaultTo('[]')

      // 审查备注
      table.text('review_note', 'longtext').nullable()

      // 状态：current / superseded
      table.string('status', 20).notNullable().defaultTo('current')
      table.check("status IN ('current','superseded')")

      // 超集链：被哪个新记录替换
      table.bigInteger('superseded_by_id').unsigned().nullable()

      // 确认哈希（用于幂等和追踪）
      table.string('confirmation_hash', 64).nullable()

      // 时间戳
      table.timestamp('confirmed_at').notNullable()
      table.timestamp('superseded_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id', 'project_id', 'status'], 'idx_ocrae_org_project_status')
      table.index(
        ['organization_id', 'project_id', 'source_kind', 'source_id'],
        'idx_ocrae_org_project_source',
      )
      table.index(
        ['organization_id', 'project_id', 'source_hash'],
        'idx_ocrae_org_project_source_hash',
      )
      table.index(
        ['organization_id', 'project_id', 'candidate_hash'],
        'idx_ocrae_org_project_candidate_hash',
      )
      table.index(
        ['organization_id', 'project_id', 'selected_text_hash'],
        'idx_ocrae_org_project_sel_hash',
      )
      table.index(
        ['organization_id', 'project_id', 'reviewer_id'],
        'idx_ocrae_org_project_reviewer',
      )
      table.index(
        ['organization_id', 'project_id', 'confirmed_at'],
        'idx_ocrae_org_project_confirmed',
      )
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
