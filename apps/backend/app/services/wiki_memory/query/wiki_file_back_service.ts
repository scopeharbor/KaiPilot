/**
 * v3-llm-wiki-query-navigation —— 归档回答：把 AI 同事的回答存成 `answer` 页的待审提议。
 *
 * 正文由系统确定性生成（去掉伪造的主张标记与维基链接）；作者记为 AI、提交者记为 authorUserId；
 * 始终停在待审（即使提交者是审阅者也不调用发布），由审阅者在审阅队列确认后才生效。
 */
import { inject } from '@adonisjs/core'
import {
  WIKI_ANSWER_QUESTION_MAX,
  WIKI_ANSWER_TEXT_MAX,
  buildWikiAnswerPage,
  fnv1a32Hex,
  sanitizeMemoryContent,
  sanitizeWikiAnswerText,
  truncateWikiSummary,
  type WikiRevisionDto,
} from '@aiproj/types'
import WikiPage from '#models/wiki_page'
import AuditService, { AuditEvent } from '#services/audit_service'
import WikiAccessService, { type WikiActor } from '../wiki_access_service.js'
import { revisionDto } from '../wiki_read_service.js'
import WikiRevisionService from '../wiki_revision_service.js'
import WikiSettingsService from '../wiki_settings_service.js'
import WikiSpaceService from '../wiki_space_service.js'
import { WikiConflictError, WikiPermissionError, WikiValidationError } from '../errors.js'

export interface WikiFileBackInput {
  projectId: number | null
  title: string
  question: string
  answer: string
}

@inject()
export default class WikiFileBackService {
  constructor(
    private readonly settings: WikiSettingsService,
    private readonly spaces: WikiSpaceService,
    private readonly access: WikiAccessService,
    private readonly revisions: WikiRevisionService,
    private readonly audit: AuditService,
  ) {}

  async fileBack(
    actor: WikiActor,
    input: WikiFileBackInput,
  ): Promise<{ pageId: number; spaceId: number; revision: WikiRevisionDto }> {
    await this.settings.assertEnabled(actor.organizationId)
    const question = sanitizeWikiAnswerText(input.question)
    const answer = sanitizeWikiAnswerText(input.answer)
    if (!question || !answer) throw new WikiValidationError('问题和回答都不能为空')
    if (Array.from(question).length > WIKI_ANSWER_QUESTION_MAX)
      throw new WikiValidationError(`问题不能超过 ${WIKI_ANSWER_QUESTION_MAX} 字`)
    if (Array.from(answer).length > WIKI_ANSWER_TEXT_MAX)
      throw new WikiValidationError(`回答不能超过 ${WIKI_ANSWER_TEXT_MAX} 字`)
    for (const text of [input.title, question, answer]) {
      if (!sanitizeMemoryContent(text).ok)
        throw new WikiValidationError('内容包含不能存进维基的信息（如凭据或个人敏感信息）')
    }

    const space =
      input.projectId === null
        ? await this.spaces.resolve(actor, 'organization', actor.organizationId)
        : await this.spaces.resolve(actor, 'project', input.projectId)
    if (!(await this.access.canProposeInSpace(actor, space)))
      throw new WikiPermissionError('没有在本空间提交修订的权限')

    const slug = `answer-${fnv1a32Hex(`${question}\n${answer}`)}`
    const exists = await WikiPage.query()
      .where('organization_id', actor.organizationId)
      .where('space_id', space.id)
      .where('slug', slug)
      .first()
    if (exists) throw new WikiConflictError('这条回答已经存进维基了', 'WIKI_ANSWER_EXISTS')

    const title = truncateWikiSummary(input.title.trim() || question, 80)
    const body = buildWikiAnswerPage({ title, question, answer })
    const page = await WikiPage.create({
      organizationId: actor.organizationId,
      spaceId: space.id,
      slug,
      pageType: 'answer',
      title,
      summaryLine: truncateWikiSummary(question),
      status: 'active',
      ownerUserId: actor.user.id,
      publishedRevisionId: null,
      sensitivity: 'normal',
      staleAfterDays: null,
      sharedWithProjectIds: null,
      lastPublishedAt: null,
      createdBy: actor.user.id,
    })
    try {
      const revision = await this.revisions.proposeRevision({
        page,
        space,
        body,
        authorKind: 'ai',
        authorUserId: actor.user.id,
        baseRevisionId: null,
        changeSummary: '归档 AI 同事的回答',
      })
      await this.revisions.appendLog(
        null,
        space,
        'file_back',
        `${title}（待审）`,
        'human',
        actor.user.id,
        page.id,
      )
      await this.audit.log({
        event: AuditEvent.WIKI_ANSWER_FILED,
        userId: actor.user.id,
        organizationId: actor.organizationId,
        entityType: 'wiki_page',
        entityId: page.id,
        metadata: { spaceId: space.id, revisionId: revision.id },
      })
      return { pageId: page.id, spaceId: space.id, revision: revisionDto(revision) }
    } catch (error) {
      await page.delete()
      throw error
    }
  }
}
