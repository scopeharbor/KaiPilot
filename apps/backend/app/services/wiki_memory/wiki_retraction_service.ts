/**
 * v3-llm-wiki-memory-foundation —— 撤回与墓碑（design D6）。
 *
 * 撤回：主张置 retracted、关闭有效期；写入以规范化陈述哈希为指纹的墓碑；
 * 为含该主张的页面生成删除该主张的知识修订提议（仍需人审发布）。
 * 之后任何修订若含同指纹主张即被拒绝，直到审阅者解除墓碑。
 *
 * v3-llm-wiki-lint-consolidation：级联到墓碑生效范围内（本空间；组织空间另含本组织项目 / 部门空间）的所有同指纹有效主张，
 * 每个受影响页面一条删除提议（最多 WIKI_RETRACTION_CASCADE_MAX_PAGES 页）。
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import { removeWikiClaim, type WikiRetractionDto } from '@aiproj/types'
import WikiClaim from '#models/wiki_claim'
import WikiPage from '#models/wiki_page'
import WikiRetraction from '#models/wiki_retraction'
import WikiRevision from '#models/wiki_revision'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from './wiki_access_service.js'
import WikiRevisionService from './wiki_revision_service.js'
import WikiSpace from '#models/wiki_space'
import WikiSpaceService from './wiki_space_service.js'
import { WikiConflictError, WikiError, WikiNotFoundError, WikiPermissionError } from './errors.js'

/** 一次撤回最多为这么多页面生成删除提议；其余只置撤回（下次体检兜底）。 */
export const WIKI_RETRACTION_CASCADE_MAX_PAGES = 50

export interface WikiCascadeResult {
  /** 置为撤回的主张数（含被撤回的那条）。 */
  claims: number
  /** 生成了删除提议的页面数。 */
  pages: number
  /** 写入校验失败或超过页数上限、未生成提议的页面数。 */
  pagesSkipped: number
  /** 页面 id → 删除提议 id。 */
  proposalByPage: Map<number, number>
}

@inject()
export default class WikiRetractionService {
  constructor(
    private readonly access: WikiAccessService,
    private readonly spaces: WikiSpaceService,
    private readonly revisions: WikiRevisionService,
    private readonly audit: AuditService,
  ) {}

  async retract(
    actor: WikiActor,
    claimId: number,
    reason: string,
  ): Promise<{
    retraction: WikiRetraction
    proposalId: number | null
    cascadedClaims: number
    cascadedPages: number
  }> {
    const claim = await WikiClaim.query()
      .where('organization_id', actor.organizationId)
      .where('id', claimId)
      .first()
    if (!claim) throw new WikiNotFoundError()
    const page = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('id', claim.pageId)
      .firstOrFail()
    const space = await this.spaces.getReadable(actor, page.spaceId)
    if (!(await this.access.canReadPage(actor, space, page))) throw new WikiNotFoundError()
    if (!(await this.access.canReviewSpace(actor, space))) {
      throw new WikiPermissionError('只有本空间的审阅者可以撤回主张')
    }
    if (claim.status !== 'active') throw new WikiConflictError('该主张已不是有效状态')

    let retraction = await WikiRetraction.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('claim_fingerprint', claim.fingerprint)
      .first()
    retraction ??= await WikiRetraction.create({
      organizationId: actor.organizationId,
      spaceId: space.id,
      claimFingerprint: claim.fingerprint,
      reason: reason.slice(0, 500),
      retractedBy: actor.user.id,
    })

    const cascade = await this.cascade(
      space,
      claim.fingerprint,
      `撤回主张「${claim.claimKey}」后的级联修订`,
    )
    const proposalId = cascade.proposalByPage.get(page.id) ?? null

    await this.revisions.appendLog(
      null,
      space,
      'retract',
      `撤回「${page.title}」的主张 ${claim.claimKey}`,
      'human',
      actor.user.id,
      page.id,
    )
    await this.audit.log({
      event: AuditEvent.WIKI_CLAIM_RETRACTED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_claim',
      entityId: claim.id,
      metadata: {
        pageId: page.id,
        retractionId: retraction.id,
        proposalId,
        cascadedClaims: cascade.claims,
        cascadedPages: cascade.pages,
        cascadeSkippedPages: cascade.pagesSkipped,
      },
    })
    return {
      retraction,
      proposalId,
      cascadedClaims: cascade.claims,
      cascadedPages: cascade.pages,
    }
  }

  /** 墓碑生效范围：本空间；组织空间另含本组织的项目与部门空间（与写入时的墓碑检查一致，个人空间不在内）。 */
  private async governedSpaceIds(space: WikiSpace): Promise<number[]> {
    if (space.scopeKind !== 'organization') return [space.id]
    const children = await WikiSpace.query()
      .where('organization_id', space.organizationId)
      .whereIn('scope_kind', ['project', 'department'])
      .select('id')
    return [space.id, ...children.map((c) => c.id)]
  }

  /**
   * 把墓碑生效范围内同指纹的有效主张置为撤回，并为每个受影响页面生成删除这些主张的待审提议（系统作者，知识修改）。
   * 也供体检兜底调用（仍有效但命中墓碑的历史主张）。
   */
  async cascade(
    space: WikiSpace,
    fingerprint: string,
    changeSummary: string,
    now = DateTime.now(),
  ): Promise<WikiCascadeResult> {
    const spaceIds = await this.governedSpaceIds(space)
    const claims = await WikiClaim.query()
      .where('organization_id', space.organizationId)
      .where('fingerprint', fingerprint)
      .where('status', 'active')
      .whereIn(
        'page_id',
        WikiPage.query()
          .where('organization_id', space.organizationId)
          .whereIn('space_id', spaceIds)
          .where('status', 'active')
          .select('id'),
      )
      .orderBy('page_id', 'asc')
    const result: WikiCascadeResult = {
      claims: 0,
      pages: 0,
      pagesSkipped: 0,
      proposalByPage: new Map(),
    }
    const keysByPage = new Map<number, string[]>()
    for (const c of claims) {
      c.status = 'retracted'
      c.supersededAt = now
      c.validTo = c.validTo && c.validTo < now ? c.validTo : now
      await c.save()
      result.claims++
      keysByPage.set(c.pageId, [...(keysByPage.get(c.pageId) ?? []), c.claimKey])
    }
    let handled = 0
    for (const [pageId, keys] of keysByPage) {
      if (handled >= WIKI_RETRACTION_CASCADE_MAX_PAGES) {
        result.pagesSkipped++
        continue
      }
      handled++
      const page = await WikiPage.query()
        .where('organization_id', space.organizationId)
        .where('id', pageId)
        .first()
      const current = page?.publishedRevisionId
        ? await WikiRevision.find(page.publishedRevisionId)
        : null
      if (!page || !current) continue
      const next = keys.reduce((body, key) => removeWikiClaim(body, key), current.bodyMarkdown)
      if (next === current.bodyMarkdown) continue
      const pageSpace =
        page.spaceId === space.id
          ? space
          : await WikiSpace.query()
              .where('organization_id', space.organizationId)
              .where('id', page.spaceId)
              .firstOrFail()
      try {
        const proposal = await this.revisions.proposeRevision({
          page,
          space: pageSpace,
          body: next,
          authorKind: 'system',
          authorUserId: null,
          baseRevisionId: current.id,
          changeSummary,
        })
        result.proposalByPage.set(page.id, proposal.id)
        result.pages++
      } catch (error) {
        // 页面另含其他被撤回的说法等写入校验失败：只计数，不中断其余页面
        if (!(error instanceof WikiError)) throw error
        result.pagesSkipped++
      }
    }
    return result
  }

  async list(actor: WikiActor, spaceId: number): Promise<WikiRetractionDto[]> {
    const space = await this.spaces.getReadable(actor, spaceId)
    if (!(await this.access.canReviewSpace(actor, space))) throw new WikiPermissionError()
    const rows = await WikiRetraction.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .orderBy('id', 'desc')
    return rows.map((r) => ({
      id: r.id,
      claimFingerprint: r.claimFingerprint,
      reason: r.reason,
      createdAt: r.createdAt.toUTC().toISO()!,
    }))
  }

  async lift(actor: WikiActor, retractionId: number): Promise<void> {
    const retraction = await WikiRetraction.query()
      .where('organization_id', actor.organizationId)
      .where('id', retractionId)
      .first()
    if (!retraction) throw new WikiNotFoundError()
    const space = await this.spaces.getReadable(actor, retraction.spaceId)
    if (!(await this.access.canReviewSpace(actor, space))) throw new WikiPermissionError()
    await retraction.delete()
    await this.revisions.appendLog(
      null,
      space,
      'unretract',
      '解除一条撤回记录',
      'human',
      actor.user.id,
      null,
    )
    await this.audit.log({
      event: AuditEvent.WIKI_RETRACTION_LIFTED,
      userId: actor.user.id,
      organizationId: actor.organizationId,
      entityType: 'wiki_retraction',
      entityId: retraction.id,
      metadata: { spaceId: space.id },
    })
  }
}
