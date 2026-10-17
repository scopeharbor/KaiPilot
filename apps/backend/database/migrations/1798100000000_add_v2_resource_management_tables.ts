import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-resource-management-full — resource capacity, availability and requirements.
 *
 * Keeps V1 resource/list/load APIs compatible by adding nullable/defaulted fields
 * and introducing V2 planning tables beside the existing allocation model.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('resources', (table) => {
      table.integer('capacity_version').unsigned().notNullable().defaultTo(1)
      table
        .string('capacity_calendar_policy', 40)
        .notNullable()
        .defaultTo('project_working_calendar')
      table.json('role_tags').notNullable().defaultTo('[]')
      table.json('capacity_profile').nullable()
      table.index(['project_id', 'status', 'role'], 'idx_resources_project_status_role')
      table.index(['project_id', 'capacity_version'], 'idx_resources_project_capacity_version')
    })

    this.schema.alterTable('resource_allocations', (table) => {
      table.index(['resource_id', 'task_id'], 'idx_ra_resource_task')
      table.index(['task_id', 'start_date', 'end_date'], 'idx_ra_task_window')
    })

    this.schema.createTable('resource_capacity_versions', (table) => {
      table.bigIncrements('id')
      table.bigInteger('organization_id').unsigned().notNullable().index()
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .bigInteger('resource_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE')
      table.integer('version').unsigned().notNullable().defaultTo(1)
      table.decimal('base_daily_capacity_hours', 5, 2).notNullable().defaultTo(8.0)
      table.string('calendar_policy', 40).notNullable().defaultTo('project_working_calendar')
      table.json('work_days').nullable()
      table.json('skill_tags').nullable()
      table.json('role_tags').notNullable().defaultTo('[]')
      table.string('status', 20).notNullable().defaultTo('active')
      table.date('effective_from').nullable()
      table.date('effective_to').nullable()
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.bigInteger('audit_log_id').unsigned().nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      table.unique(['resource_id', 'version'], 'uq_resource_capacity_version')
      table.index(['organization_id', 'project_id'], 'idx_rcv_org_project')
      table.index(['project_id', 'resource_id'], 'idx_rcv_project_resource')
      table.index(['project_id', 'effective_from', 'effective_to'], 'idx_rcv_project_window')
      table.check('version >= 1')
      table.check('base_daily_capacity_hours >= 0')
      table.check("calendar_policy IN ('project_working_calendar','resource_work_days')")
      table.check("status IN ('active','inactive')")
    })

    this.schema.createTable('resource_availability_exceptions', (table) => {
      table.bigIncrements('id')
      table.bigInteger('organization_id').unsigned().notNullable().index()
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .bigInteger('resource_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resources')
        .onDelete('CASCADE')
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()
      table.decimal('capacity_override_hours', 5, 2).notNullable()
      table.string('reason', 255).notNullable()
      table.string('status', 20).notNullable().defaultTo('planned')
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.bigInteger('audit_log_id').unsigned().nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      table.index(['organization_id', 'project_id'], 'idx_rae_org_project')
      table.index(
        ['project_id', 'resource_id', 'start_date', 'end_date'],
        'idx_rae_resource_window',
      )
      table.index(['project_id', 'status'], 'idx_rae_project_status')
      table.check('end_date >= start_date')
      table.check('capacity_override_hours >= 0')
      table.check("status IN ('planned','confirmed','cancelled')")
    })

    this.schema.createTable('task_resource_requirements', (table) => {
      table.bigIncrements('id')
      table.bigInteger('organization_id').unsigned().notNullable().index()
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .bigInteger('task_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('tasks')
        .onDelete('CASCADE')
      table.string('role', 80).notNullable()
      table.json('skill_tags').nullable()
      table.decimal('allocation_percent', 5, 2).nullable()
      table.decimal('estimated_person_days', 8, 2).nullable()
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()
      table.string('priority', 20).notNullable().defaultTo('medium')
      table.string('status', 20).notNullable().defaultTo('open')
      table.string('source_kind', 30).notNullable().defaultTo('manual')
      table.string('source_ref', 120).nullable()
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.bigInteger('audit_log_id').unsigned().nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      table.index(['organization_id', 'project_id'], 'idx_trr_org_project')
      table.index(['project_id', 'task_id'], 'idx_trr_project_task')
      table.index(['project_id', 'role'], 'idx_trr_project_role')
      table.index(['project_id', 'start_date', 'end_date'], 'idx_trr_project_window')
      table.index(['project_id', 'status', 'priority'], 'idx_trr_project_status_priority')
      table.check('end_date >= start_date')
      table.check('(allocation_percent IS NULL OR allocation_percent > 0)')
      table.check('(estimated_person_days IS NULL OR estimated_person_days > 0)')
      table.check('(allocation_percent IS NOT NULL OR estimated_person_days IS NOT NULL)')
      table.check("priority IN ('low','medium','high','critical')")
      table.check("status IN ('open','matched','fulfilled','cancelled')")
      table.check("source_kind IN ('manual','compiler','ai_candidate','rule_suggestion')")
    })

    this.schema.raw(`
      INSERT INTO resource_capacity_versions (
        organization_id,
        project_id,
        resource_id,
        version,
        base_daily_capacity_hours,
        calendar_policy,
        work_days,
        skill_tags,
        role_tags,
        status,
        created_at,
        updated_at
      )
      SELECT
        projects.organization_id,
        resources.project_id,
        resources.id,
        COALESCE(resources.capacity_version, 1),
        COALESCE(resources.daily_capacity_hours, 8.0),
        COALESCE(resources.capacity_calendar_policy, 'project_working_calendar'),
        resources.work_days,
        resources.skill_tags,
        COALESCE(resources.role_tags, '[]'),
        resources.status,
        CURRENT_TIMESTAMP,
        NULL
      FROM resources
      INNER JOIN projects ON projects.id = resources.project_id
      WHERE resources.deleted_at IS NULL
    `)
  }

  async down() {
    this.schema.dropTable('task_resource_requirements')
    this.schema.dropTable('resource_availability_exceptions')
    this.schema.dropTable('resource_capacity_versions')

    this.schema.alterTable('resource_allocations', (table) => {
      table.dropIndex(['resource_id', 'task_id'], 'idx_ra_resource_task')
      table.dropIndex(['task_id', 'start_date', 'end_date'], 'idx_ra_task_window')
    })

    this.schema.alterTable('resources', (table) => {
      table.dropIndex(['project_id', 'status', 'role'], 'idx_resources_project_status_role')
      table.dropIndex(['project_id', 'capacity_version'], 'idx_resources_project_capacity_version')
      table.dropColumn('capacity_profile')
      table.dropColumn('role_tags')
      table.dropColumn('capacity_calendar_policy')
      table.dropColumn('capacity_version')
    })
  }
}
