/**
 * v2-traceability-source-attribution —— 溯源索引表（task 2.3）。
 *
 * 为 source_attributions 和 traceability_links 添加组织隔离、
 * compilerRun、draftSession、project/entity、sourceAttributionId
 * 和幂等查询所需索引。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // ── source_attributions 索引 ──
    this.schema.alterTable('source_attributions', (table) => {
      table.index(['organization_id'], 'idx_sa_org')
      table.index(['organization_id', 'compiler_run_id'], 'idx_sa_org_run')
      table.index(['organization_id', 'draft_session_id'], 'idx_sa_org_session')
      table.index(['organization_id', 'entity_id'], 'idx_sa_org_entity')
      table.index(['organization_id', 'compiler_run_id', 'stage_id'], 'idx_sa_org_run_stage')
      table.index(['content_hash'], 'idx_sa_content_hash')
    })

    // ── traceability_links 索引 ──
    this.schema.alterTable('traceability_links', (table) => {
      table.index(['organization_id'], 'idx_tl_org')
      table.index(['organization_id', 'project_id'], 'idx_tl_org_project')
      table.index(
        ['organization_id', 'source_entity_type', 'source_entity_id'],
        'idx_tl_org_source',
      )
      table.index(
        ['organization_id', 'target_entity_type', 'target_entity_id'],
        'idx_tl_org_target',
      )
      table.index(['source_attribution_id'], 'idx_tl_attribution')
      table.index(['relation_type'], 'idx_tl_relation_type')
      table.index(['deleted_at'], 'idx_tl_deleted')
    })
  }

  async down() {
    this.schema.alterTable('source_attributions', (table) => {
      table.dropIndex(['organization_id'], 'idx_sa_org')
      table.dropIndex(['organization_id', 'compiler_run_id'], 'idx_sa_org_run')
      table.dropIndex(['organization_id', 'draft_session_id'], 'idx_sa_org_session')
      table.dropIndex(['organization_id', 'entity_id'], 'idx_sa_org_entity')
      table.dropIndex(['organization_id', 'compiler_run_id', 'stage_id'], 'idx_sa_org_run_stage')
      table.dropIndex(['content_hash'], 'idx_sa_content_hash')
    })
    this.schema.alterTable('traceability_links', (table) => {
      table.dropIndex(['organization_id'], 'idx_tl_org')
      table.dropIndex(['organization_id', 'project_id'], 'idx_tl_org_project')
      table.dropIndex(
        ['organization_id', 'source_entity_type', 'source_entity_id'],
        'idx_tl_org_source',
      )
      table.dropIndex(
        ['organization_id', 'target_entity_type', 'target_entity_id'],
        'idx_tl_org_target',
      )
      table.dropIndex(['source_attribution_id'], 'idx_tl_attribution')
      table.dropIndex(['relation_type'], 'idx_tl_relation_type')
      table.dropIndex(['deleted_at'], 'idx_tl_deleted')
    })
  }
}
