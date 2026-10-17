import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-ai-smart-recommendations — project_recommendation_events table.
 * Tracks state transitions, AI explanation references, conversion references,
 * and low-sensitivity audit associations for recommendations.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('project_recommendation_events', (table) => {
      table.bigIncrements('id')

      table.bigInteger('recommendation_id').unsigned().notNullable()
      table.bigInteger('organization_id').unsigned().notNullable()
      table.bigInteger('project_id').unsigned().notNullable()

      // Event type
      table.string('event_type', 30).notNullable()
      table.check(
        "event_type IN ('generated', 'merged', 'accepted', 'dismissed', 'snoozed', 'converted', 'expired', 'ai_explanation', 'status_changed')",
      )

      // Before/after status
      table.string('from_status', 20).nullable()
      table.string('to_status', 20).nullable()

      // Actor
      table.bigInteger('actor_id').unsigned().notNullable()

      // Metadata (JSON)
      table.json('metadata').nullable()

      // Low-sensitivity summary
      table.text('summary').nullable()

      // Audit
      table.timestamp('created_at', { useTz: false }).notNullable()

      // Indexes
      table.index(['recommendation_id'], 'idx_pree_rec')
      table.index(['organization_id'], 'idx_pree_org')
      table.index(['project_id'], 'idx_pree_project')
      table.index(['event_type'], 'idx_pree_type')
      table.index(['actor_id'], 'idx_pree_actor')
      table.index(['created_at'], 'idx_pree_created_at')
    })
  }

  async down() {
    this.schema.dropTable('project_recommendation_events')
  }
}
