import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-llm-wiki-memory-foundation —— 记忆维基底座 10 张表。
 *
 * 全部 tenant-owned：organization_id 非空 + organizations 外键 + 组织首列索引，
 * 唯一键全部以 organization_id 开头（登记于 database_isolation_catalog）。
 * 修订与审核记录只追加；主张双时态（valid_* 何时为真 / recorded_at、superseded_at 何时记录）。
 * 规约层（wiki_schemas）随 M2 编入流程建立，本期不建表。
 */
export default class extends BaseSchema {
  async up() {
    const org = (table: { bigInteger: (c: string) => any }) =>
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

    this.schema.createTable('wiki_spaces', (table) => {
      table.bigIncrements('id')
      org(table)
      table.string('scope_kind', 16).notNullable()
      table.check("scope_kind IN ('organization','department','project','user')")
      table.bigInteger('scope_ref_id').notNullable()
      table.string('title', 200).notNullable()
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.unique(['organization_id', 'scope_kind', 'scope_ref_id'])
    })

    this.schema.createTable('wiki_pages', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('space_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_spaces')
        .onDelete('CASCADE')
      table.string('slug', 128).notNullable()
      table.string('page_type', 32).notNullable()
      table.string('title', 200).notNullable()
      table.string('summary_line', 200).notNullable().defaultTo('')
      table.string('status', 16).notNullable().defaultTo('active')
      table.check("status IN ('active','archived')")
      table
        .bigInteger('owner_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // 不设外键：修订表反向引用页面，避免环形外键；一致性由 WikiRevisionService.publish 唯一入口保证
      table.bigInteger('published_revision_id').unsigned().nullable()
      table.string('sensitivity', 16).notNullable().defaultTo('normal')
      table.check("sensitivity IN ('normal','restricted')")
      table.integer('stale_after_days').nullable()
      // 个人空间逐页授权：可读的项目（项目经理只读），仅本人可改
      table.text('shared_with_project_ids_json').nullable()
      table.timestamp('last_published_at', { useTz: true }).nullable()
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.unique(['organization_id', 'space_id', 'slug'])
    })

    this.schema.createTable('wiki_revisions', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('page_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_pages')
        .onDelete('CASCADE')
      table.bigInteger('base_revision_id').unsigned().nullable()
      table.text('body_markdown').notNullable()
      table.string('author_kind', 16).notNullable()
      table.check("author_kind IN ('system','ai','human')")
      table
        .bigInteger('author_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('edit_class', 16).notNullable()
      table.check("edit_class IN ('bookkeeping','knowledge')")
      table.string('status', 16).notNullable()
      table.check("status IN ('proposed','published','rejected','superseded')")
      table.string('change_summary', 500).notNullable().defaultTo('')
      table.string('content_hash', 64).notNullable()
      table
        .bigInteger('reviewed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('reviewed_at', { useTz: true }).nullable()
      table.string('reject_reason', 500).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.index(['organization_id', 'page_id', 'status'])
    })

    this.schema.createTable('wiki_claims', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('page_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_pages')
        .onDelete('CASCADE')
      table
        .bigInteger('revision_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_revisions')
        .onDelete('CASCADE')
      table.string('claim_key', 64).notNullable()
      table.text('statement').notNullable()
      table.string('fingerprint', 64).notNullable()
      table.string('claim_kind', 16).notNullable()
      table.check("claim_kind IN ('derived','inference','preference','rule','decision')")
      table.string('status', 16).notNullable()
      table.check("status IN ('active','superseded','retracted')")
      table.timestamp('valid_from', { useTz: true }).nullable()
      table.timestamp('valid_to', { useTz: true }).nullable()
      table.timestamp('recorded_at', { useTz: true }).notNullable()
      table.timestamp('superseded_at', { useTz: true }).nullable()
      table.bigInteger('supersedes_claim_id').unsigned().nullable()
      table.integer('evidence_count').notNullable()
      table.string('invalid_reason', 32).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['organization_id', 'page_id', 'status'])
    })

    this.schema.createTable('wiki_claim_sources', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('claim_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_claims')
        .onDelete('CASCADE')
      table.string('source_kind', 32).notNullable()
      table.string('source_id', 128).notNullable()
      table.string('source_version', 64).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['organization_id', 'claim_id'])
      table.index(['organization_id', 'source_kind', 'source_id'])
    })

    this.schema.createTable('wiki_links', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('from_page_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_pages')
        .onDelete('CASCADE')
      table
        .bigInteger('to_page_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_pages')
        .onDelete('CASCADE')
      table.string('link_kind', 16).notNullable().defaultTo('mentions')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.unique(['organization_id', 'from_page_id', 'to_page_id', 'link_kind'], {
        indexName: 'wiki_links_org_from_to_kind_unique',
      })
      table.index(['organization_id', 'to_page_id'])
    })

    this.schema.createTable('wiki_log_entries', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('space_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_spaces')
        .onDelete('CASCADE')
      table.string('op', 16).notNullable()
      table.string('line', 600).notNullable()
      table.string('actor_kind', 16).notNullable()
      table
        .bigInteger('actor_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.bigInteger('ref_page_id').unsigned().nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['organization_id', 'space_id', 'id'])
    })

    this.schema.createTable('wiki_lint_findings', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('space_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_spaces')
        .onDelete('CASCADE')
      table
        .bigInteger('page_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('wiki_pages')
        .onDelete('CASCADE')
      table.string('finding_kind', 32).notNullable()
      table.string('status', 16).notNullable()
      table.check("status IN ('open','fixed','dismissed')")
      table.string('dedupe_key', 200).notNullable()
      table.text('detail_json').notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.unique(['organization_id', 'space_id', 'dedupe_key'])
    })

    this.schema.createTable('wiki_retractions', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('space_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_spaces')
        .onDelete('CASCADE')
      table.string('claim_fingerprint', 64).notNullable()
      table.string('reason', 500).notNullable().defaultTo('')
      table
        .bigInteger('retracted_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.unique(['organization_id', 'space_id', 'claim_fingerprint'], {
        indexName: 'wiki_retractions_org_space_fingerprint_unique',
      })
    })

    this.schema.createTable('wiki_search_entries', (table) => {
      table.bigIncrements('id')
      org(table)
      table
        .bigInteger('space_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_spaces')
        .onDelete('CASCADE')
      table
        .bigInteger('page_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_pages')
        .onDelete('CASCADE')
      table.string('title', 200).notNullable()
      table.string('summary_line', 200).notNullable()
      table.text('headings_text').notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.unique(['organization_id', 'page_id'])
      table.index(['organization_id', 'space_id'])
    })
  }

  async down() {
    for (const t of [
      'wiki_search_entries',
      'wiki_retractions',
      'wiki_lint_findings',
      'wiki_log_entries',
      'wiki_links',
      'wiki_claim_sources',
      'wiki_claims',
      'wiki_revisions',
      'wiki_pages',
      'wiki_spaces',
    ]) {
      this.schema.dropTableIfExists(t)
    }
  }
}
