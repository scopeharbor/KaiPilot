/**
 * 记忆维基睡眠整理（ace wiki:consolidate [--org=ID]）——v3-llm-wiki-lint-consolidation。
 *
 * 供部署方用外部定时任务调用（仓库不内置调度器，建议每晚一次）：对已开启记忆维基的组织，以组织所有者身份
 * 依次运行全部空间的确定性体检、计划档案刷新、流程实况刷新与最近结项项目的复盘刷新。不调用任何模型。
 */
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class WikiConsolidate extends BaseCommand {
  static commandName = 'wiki:consolidate'
  static description =
    '睡眠整理：已开启记忆维基的组织的确定性体检、计划档案与流程实况刷新（不调用模型）'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: '只处理指定组织' })
  declare org: number | undefined

  async run() {
    const { default: Organization } = await import('#models/organization')
    const { default: User } = await import('#models/user')
    const { default: WikiConsolidationService } =
      await import('#services/wiki_memory/lint/wiki_consolidation_service')
    const { isWikiEnabledInSettings } = await import('#services/wiki_memory/wiki_settings_service')
    const service = await this.app.container.make(WikiConsolidationService)

    const orgs = await Organization.query().if(this.org !== undefined, (q) =>
      q.where('id', this.org!),
    )
    let done = 0
    for (const org of orgs) {
      if (!isWikiEnabledInSettings(org.settings)) continue
      const owner = org.ownerId ? await User.find(org.ownerId) : null
      if (!owner) {
        this.logger.warning(`组织 ${org.id}：没有所有者账号，跳过`)
        continue
      }
      try {
        const s = await service.consolidate({ user: owner, organizationId: org.id })
        done++
        this.logger.info(
          `组织 ${org.id}：体检 ${s.spacesLinted} 个空间（失败 ${s.spacesFailed}），清理断链 ${s.fixedBrokenLinks}，` +
            `关闭主张 ${s.closedClaims}，墓碑兜底 ${s.retractedClaims}，矛盾已解决 ${s.resolvedContradictions}；` +
            `计划档案${s.dossier ? '已刷新' : '跳过'}，流程实况${s.process ? '已刷新' : '跳过'}，` +
            `复盘新建 ${s.retrospectives?.created ?? 0}、更新 ${s.retrospectives?.updated ?? 0}`,
        )
      } catch (error) {
        this.logger.warning(
          `组织 ${org.id}：跳过（${error instanceof Error ? error.message : '未知错误'}）`,
        )
      }
    }
    this.logger.info(`完成：整理 ${done} 个组织的记忆维基`)
  }
}
