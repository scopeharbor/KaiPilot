import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * AI 连接的工具调用方式（AI 同事自然语言操作等场景）。
 * prompt_json / openai_chat_tools / openai_responses_tools / anthropic_tool_use，
 * 缺省 prompt_json（与既有行为一致，存量连接零影响）。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('ai_connections', (table) => {
      table.string('tool_calling_mode', 40).notNullable().defaultTo('prompt_json')
    })
  }

  async down() {
    this.schema.alterTable('ai_connections', (table) => {
      table.dropColumn('tool_calling_mode')
    })
  }
}
