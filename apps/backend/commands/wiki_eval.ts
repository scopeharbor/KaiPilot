/**
 * 记忆维基评测（ace wiki:eval --org=ID --file=问答集.json）——v3-llm-wiki-eval-gate。
 *
 * 以组织所有者身份运行确定性评测（问答集 + 计划回测 + 切换门禁），打印结论与原因。不调用任何模型。
 */
import { readFile } from 'node:fs/promises'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class WikiEval extends BaseCommand {
  static commandName = 'wiki:eval'
  static description = '运行记忆维基评测（问答集 + 计划回测 + 切换门禁，确定性、不调用模型）'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: '组织 ID', required: true })
  declare org: number

  @flags.string({ description: '问答集 JSON 文件路径', required: true })
  declare file: string

  async run() {
    const { parseWikiEvalQuestions, WIKI_EVAL_GATE_LABELS } = await import('@aiproj/types')
    const { default: Organization } = await import('#models/organization')
    const { default: User } = await import('#models/user')
    const { default: WikiEvalService } =
      await import('#services/wiki_memory/eval/wiki_eval_service')

    const parsed = parseWikiEvalQuestions(JSON.parse(await readFile(this.file, 'utf8')))
    if (!parsed.ok) {
      this.logger.error(`问答集不合规：${parsed.reason}`)
      this.exitCode = 1
      return
    }
    const org = await Organization.find(this.org)
    const owner = org?.ownerId ? await User.find(org.ownerId) : null
    if (!org || !owner) {
      this.logger.error(`组织 ${this.org} 不存在或没有所有者账号`)
      this.exitCode = 1
      return
    }
    const service = await this.app.container.make(WikiEvalService)
    const report = await service.run({ user: owner, organizationId: org.id }, parsed.questions)
    this.logger.info(
      `评测 #${report.id}：${WIKI_EVAL_GATE_LABELS[report.status]}；问答正确率 旧检索 ${Math.round(report.qa.legacy.correctRate * 100)}% / 维基 ${Math.round(report.qa.wiki.correctRate * 100)}%（维基泄露 ${report.qa.wiki.leaks}）；` +
        `回测 ${report.backtest.projects} 个项目 MAPE 现场计算 ${Math.round(report.backtest.methods.legacy.mape * 100)}% / 维基 ${Math.round(report.backtest.methods.wiki.mape * 100)}%`,
    )
    for (const reason of report.reasons) this.logger.info(`- ${reason}`)
  }
}
