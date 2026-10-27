/**
 * v3-llm-wiki-lint-consolidation —— 睡眠整理（design D5）。
 *
 * 以组织所有者身份依次运行：全部活动空间的确定性体检 → 计划档案刷新 → 流程实况刷新 →
 * 最近结项项目的复盘页刷新（v3-llm-wiki-retrospective-lessons）。
 * 只调用确定性服务，不创建模型端口；单步失败只计数、不中断其余步骤。审计只含计数。
 */
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import type { WikiDossierRefreshSummary } from '@aiproj/types'
import WikiSpace from '#models/wiki_space'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { WikiActor } from '../wiki_access_service.js'
import WikiLintService from '../wiki_lint_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiPlanningDossierService from '../dossier/wiki_planning_dossier_service.js'
import WikiProcessRealityService from '../process/wiki_process_reality_service.js'
import WikiRetrospectiveService from '../retrospective/wiki_retrospective_service.js'

export interface WikiConsolidationSummary {
  spacesLinted: number
  spacesFailed: number
  fixedBrokenLinks: number
  closedClaims: number
  retractedClaims: number
  resolvedContradictions: number
  dossier: WikiDossierRefreshSummary | null
  process: WikiDossierRefreshSummary | null
  retrospectives: WikiDossierRefreshSummary | null
}

@inject()
export default class WikiConsolidationService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly lint: WikiLintService,
    private readonly dossier: WikiPlanningDossierService,
    private readonly processReality: WikiProcessRealityService,
    private readonly retrospective: WikiRetrospectiveService,
    private readonly audit: AuditService,
  ) {}

  async consolidate(owner: WikiActor): Promise<WikiConsolidationSummary> {
    await this.settings.assertEnabled(owner.organizationId)
    const summary: WikiConsolidationSummary = {
      spacesLinted: 0,
      spacesFailed: 0,
      fixedBrokenLinks: 0,
      closedClaims: 0,
      retractedClaims: 0,
      resolvedContradictions: 0,
      dossier: null,
      process: null,
      retrospectives: null,
    }
    const spaces = await WikiSpace.query()
      .where('organization_id', owner.organizationId)
      .orderBy('id', 'asc')
    for (const space of spaces) {
      try {
        const s = await this.lint.run(space, null)
        summary.spacesLinted++
        summary.fixedBrokenLinks += s.fixedBrokenLinks
        summary.closedClaims += s.closedClaims
        summary.retractedClaims += s.retractedClaims
        summary.resolvedContradictions += s.resolvedContradictions
      } catch (error) {
        summary.spacesFailed++
        logger.warn(
          { organizationId: owner.organizationId, spaceId: space.id, err: (error as Error).name },
          'wiki consolidation lint skipped',
        )
      }
    }
    summary.dossier = await this.step('dossier', owner, () => this.dossier.refresh(owner))
    summary.process = await this.step('process', owner, () => this.processReality.refresh(owner))
    summary.retrospectives = await this.step('retrospective', owner, () =>
      this.retrospective.refreshRecent(owner),
    )

    await this.audit.log({
      event: AuditEvent.WIKI_CONSOLIDATED,
      userId: owner.user.id,
      organizationId: owner.organizationId,
      entityType: 'organization',
      entityId: owner.organizationId,
      metadata: {
        spacesLinted: summary.spacesLinted,
        spacesFailed: summary.spacesFailed,
        fixedBrokenLinks: summary.fixedBrokenLinks,
        closedClaims: summary.closedClaims,
        retractedClaims: summary.retractedClaims,
        resolvedContradictions: summary.resolvedContradictions,
        dossierOk: summary.dossier !== null,
        processOk: summary.process !== null,
        retrospectivesCreated: summary.retrospectives?.created ?? 0,
        retrospectivesUpdated: summary.retrospectives?.updated ?? 0,
      },
    })
    return summary
  }

  private async step(
    name: string,
    owner: WikiActor,
    fn: () => Promise<WikiDossierRefreshSummary>,
  ): Promise<WikiDossierRefreshSummary | null> {
    try {
      return await fn()
    } catch (error) {
      logger.warn(
        { organizationId: owner.organizationId, step: name, err: (error as Error).name },
        'wiki consolidation step skipped',
      )
      return null
    }
  }
}
