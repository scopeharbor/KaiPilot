import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-copilot-agent-workflow-orchestration —— 为 compiler_runs 新增 run_type 列。
 *
 * run_type 区分普通编译 run（'compiler'，默认）与 Copilot 多步骤编排 run（'copilot_orchestration'）。
 * 不新建表：复用既有 compiler_runs 表（design D2）。
 *
 * 写法注意：`this.schema.*` 是**延迟执行**的——builder 先被收集，由迁移器在 up() 返回后统一执行。
 * 对它 `await` 会让语句**立即执行一次**，随后迁移器再把收集到的同一个 builder 执行一次，
 * 于是 ALTER 跑两遍、第二遍撞 `duplicate column name: run_type`，整条迁移链在这里断掉。
 * 全仓另外 227 个迁移都不 await `this.schema.*`，这里保持一致。
 */
export default class extends BaseSchema {
  protected tableName = 'compiler_runs'

  async up() {
    // hasColumn 是即时查询（不走延迟队列），可以直接 await 做幂等守卫
    const hasRunType = await this.schema.hasColumn(this.tableName, 'run_type')
    if (!hasRunType) {
      this.schema.alterTable(this.tableName, (table) => {
        table.string('run_type', 50).notNullable().defaultTo('compiler')
      })
    }
  }

  async down() {
    const hasRunType = await this.schema.hasColumn(this.tableName, 'run_type')
    if (hasRunType) {
      this.schema.alterTable(this.tableName, (table) => {
        table.dropColumn('run_type')
      })
    }
  }
}
