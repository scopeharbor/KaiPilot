import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ai-draft v3 hardening —— 阶段 checkpoint 持久化列。
 * 只保存低敏元数据与已验证阶段产物（无 prompt/rawText/token/rawInput）。
 * 重试时据此从失败阶段继续，避免重新生成已通过的章程/WBS。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('ai_project_drafts', (table) => {
      table.json('generation_checkpoint').nullable()
    })
  }

  async down() {
    this.schema.alterTable('ai_project_drafts', (table) => {
      table.dropColumn('generation_checkpoint')
    })
  }
}
