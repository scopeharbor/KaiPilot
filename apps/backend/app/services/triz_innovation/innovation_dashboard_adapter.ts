/**
 * v3-triz-innovation-workbench —— Dashboard 只读摘要适配器。
 *
 * 只读取工作台 scheme 表和授权来源摘要；不触发 comparison、narrative、handoff、Compiler run 或 AIGateway。
 */
import type User from '#models/user'
import TrizInnovationScheme from '#models/triz_innovation_scheme'
import TrizInnovationPolicy from '#policies/triz_innovation_policy'
import InnovationSourceService from '#services/triz_innovation/innovation_source_service'
import { inject } from '@adonisjs/core'
import type { InnovationDashboardSummaryResponse } from '@aiproj/types'

@inject()
export default class InnovationDashboardAdapter {
  constructor(
    private policy: TrizInnovationPolicy,
    private sources: InnovationSourceService,
  ) {}

  async getSummary(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<InnovationDashboardSummaryResponse['data']> {
    if (!(await this.policy.view(user, organizationId, projectId))) {
      return { summary: null, hasViewPermission: false }
    }

    const schemes = await TrizInnovationScheme.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    const openSchemes = schemes.filter((scheme) => scheme.status === 'open')
    const warnings = schemes.flatMap((scheme) =>
      (scheme.payload.options ?? []).flatMap((option) => option.warnings ?? []),
    )
    const staleMarker = schemes.some(
      (scheme) =>
        scheme.handoffStatus === 'stale' ||
        (scheme.payload.options ?? []).some((option) =>
          option.sourceRefs.some((source) => source.stale),
        ),
    )
    const reviewedAt =
      schemes
        .map((scheme) => scheme.reviewedAt?.toISO() ?? scheme.payload.reviewedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null

    return {
      summary: {
        openSchemeCount: openSchemes.length,
        pendingHandoffCount: schemes.filter(
          (scheme) => scheme.handoffStatus === 'candidate_created',
        ).length,
        warningCount: warnings.length,
        highestSeverity: await this.sources.highestSeverity(user, organizationId, projectId),
        latestReviewedAt: reviewedAt,
        staleMarker,
      },
      hasViewPermission: true,
    }
  }
}
