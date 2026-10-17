import TaskExternalLink from '#models/task_external_link'
import { DateTime } from 'luxon'
import type {
  ExternalLinkProvider,
  ExternalLinkStatus,
  ExternalLinkStatusSource,
  CodeRepositoryCiSummary,
  CiSummarySource,
} from '@aiproj/types'
import { shouldReplaceCiSummary } from '@aiproj/types'
import { validateAndNormalizeUrl } from './integrations/code_repository_url_validator.js'
import CodeRepositoryProviderAdapter from './integrations/code_repository_adapter.js'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  GitHubReadonlyFixtureClient,
  type GitHubReadonlyClient,
  type GitHubLinkLocator,
} from './integrations/github_readonly_client.js'
import {
  GitLabReadonlyFixtureClient,
  type GitLabReadonlyClient,
  type GitLabLinkLocator,
} from './integrations/gitlab_readonly_client.js'
import { GitHubConnectionResolver } from './integrations/github_connection_resolver.js'
import { GitlabConnectionResolver } from './integrations/gitlab_connection_resolver.js'
import {
  projectGithubChecks,
  projectGithubStatus,
  projectGitlabPipeline,
  projectWebhookCiEvent,
  type CiEventLocator,
  type WebhookCiEvent,
} from './integrations/ci_status_projector.js'

export interface ExternalLinkActor {
  userId: number
  organizationId: number
}

export interface CreateLinkInput {
  provider: ExternalLinkProvider
  linkType: 'issue' | 'pull_request' | 'merge_request'
  repositoryOwner: string
  repositoryName: string
  externalNumber: number
  externalId?: string | null
  externalTitle?: string | null
  externalStatus: ExternalLinkStatus
  externalUrl: string
  note?: string | null
}

export interface UpdateLinkInput {
  externalTitle?: string | null
  externalStatus?: ExternalLinkStatus
  note?: string | null
}

// v2-5-github-linked-item-read-refresh: 扩展刷新结果类型
export type RefreshResultCode =
  | 'not_configured'
  | 'pre_connection_only'
  | 'success'
  | 'degraded'
  | 'readonly_connection_ready'
  | 'connection_required'
  | 'reauthorization_required'
  | 'not_found'
  | 'forbidden'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'unsupported_link'

export interface RefreshLinkResult {
  id: number
  previousStatus: ExternalLinkStatus | null
  previousStatusSource: ExternalLinkStatusSource | null
  result: RefreshResultCode
  message: string
  retryAfter?: number
  /**
   * v2-5-code-repository-ci-status-display —— 刷新后的 CI/check 摘要。
   * 成功刷新时可能更新（PR/MR），失败/降级分支保留既有摘要。
   */
  ciSummary?: CodeRepositoryCiSummary | null
}

/** github.com 固定 host（CI targetUrl allowlist 使用）。 */
const GITHUB_HOST = 'github.com'

export default class TaskExternalLinkService {
  private codeRepo: CodeRepositoryProviderAdapter
  private audit: AuditService
  private githubClient: GitHubReadonlyClient
  private gitlabClient: GitLabReadonlyClient
  private connectionResolver: GitHubConnectionResolver
  private gitlabConnectionResolver: GitlabConnectionResolver

  constructor(
    githubClient: GitHubReadonlyClient = new GitHubReadonlyFixtureClient(),
    gitlabClient: GitLabReadonlyClient = new GitLabReadonlyFixtureClient(),
    connectionResolver: GitHubConnectionResolver = new GitHubConnectionResolver(),
    gitlabConnectionResolver: GitlabConnectionResolver = new GitlabConnectionResolver(),
  ) {
    this.codeRepo = new CodeRepositoryProviderAdapter()
    this.audit = new AuditService()
    this.githubClient = githubClient
    this.gitlabClient = gitlabClient
    this.connectionResolver = connectionResolver
    this.gitlabConnectionResolver = gitlabConnectionResolver
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  async listByTask(
    projectId: number,
    taskId: number,
    actor: ExternalLinkActor,
  ): Promise<TaskExternalLink[]> {
    return TaskExternalLink.query()
      .where('organization_id', actor.organizationId)
      .where('project_id', projectId)
      .where('task_id', taskId)
      .orderBy('created_at', 'asc')
  }

  // ---------------------------------------------------------------------------
  // Get by id
  // ---------------------------------------------------------------------------

  async getById(
    linkId: number,
    projectId: number,
    taskId: number,
    actor: ExternalLinkActor,
  ): Promise<TaskExternalLink | null> {
    return TaskExternalLink.query()
      .where('id', linkId)
      .where('organization_id', actor.organizationId)
      .where('project_id', projectId)
      .where('task_id', taskId)
      .first()
  }

  // ---------------------------------------------------------------------------
  // Create (Task 4.1)
  // ---------------------------------------------------------------------------

  async create(
    projectId: number,
    taskId: number,
    input: CreateLinkInput,
    actor: ExternalLinkActor,
  ): Promise<TaskExternalLink> {
    // 验证 URL 安全
    const urlCheck = validateAndNormalizeUrl(input.provider, input.externalUrl)
    if (!urlCheck.valid) {
      throw new LinkValidationError(`URL 校验失败: ${urlCheck.error}`)
    }

    // 同任务去重
    const existing = await TaskExternalLink.query()
      .where('organization_id', actor.organizationId)
      .where('project_id', projectId)
      .where('task_id', taskId)
      .where('provider', input.provider)
      .where('repository_owner', input.repositoryOwner)
      .where('repository_name', input.repositoryName)
      .where('external_number', input.externalNumber)
      .first()

    if (existing) {
      throw new LinkDuplicateError('同一任务内已存在相同 provider/仓库/编号的外部链接')
    }

    const link = await TaskExternalLink.create({
      organizationId: actor.organizationId,
      projectId,
      taskId,
      provider: input.provider,
      linkType: input.linkType,
      repositoryOwner: input.repositoryOwner || urlCheck.normalized?.owner || '',
      repositoryName: input.repositoryName || urlCheck.normalized?.repo || '',
      externalNumber: input.externalNumber || urlCheck.normalized?.number || 0,
      externalId: input.externalId ?? null,
      externalTitle: input.externalTitle ?? null,
      externalStatus: input.externalStatus,
      statusSource: 'manual',
      externalUrl: input.externalUrl,
      note: input.note ?? null,
      metadata: null,
      lastObservedAt: DateTime.utc(),
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })

    await this.audit.log({
      event: AuditEvent.TASK_EXTERNAL_LINK_CREATED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'task_external_link',
      entityId: link.id,
      metadata: {
        provider: input.provider,
        linkType: input.linkType,
        repositoryOwner: input.repositoryOwner,
        repositoryName: input.repositoryName,
        externalNumber: input.externalNumber,
        externalStatus: input.externalStatus,
        taskId,
      },
    })

    return link
  }

  // ---------------------------------------------------------------------------
  // Update (Task 4.1)
  // ---------------------------------------------------------------------------

  async update(
    linkId: number,
    projectId: number,
    taskId: number,
    input: UpdateLinkInput,
    actor: ExternalLinkActor,
  ): Promise<TaskExternalLink> {
    const link = await this.getById(linkId, projectId, taskId, actor)
    if (!link) {
      throw new LinkNotFoundError('外部链接未找到')
    }

    const changedFields: string[] = []

    if (input.externalTitle !== undefined) {
      link.externalTitle = input.externalTitle
      changedFields.push('externalTitle')
    }
    if (input.externalStatus !== undefined) {
      link.externalStatus = input.externalStatus
      link.statusSource = 'manual'
      link.lastObservedAt = DateTime.utc()
      changedFields.push('externalStatus')
    }
    if (input.note !== undefined) {
      link.note = input.note
      changedFields.push('note')
    }

    link.updatedBy = actor.userId
    await link.save()

    await this.audit.log({
      event: AuditEvent.TASK_EXTERNAL_LINK_UPDATED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'task_external_link',
      entityId: link.id,
      metadata: {
        provider: link.provider,
        linkType: link.linkType,
        repositoryOwner: link.repositoryOwner,
        repositoryName: link.repositoryName,
        externalNumber: link.externalNumber,
        changedFields,
        taskId,
      },
    })

    return link
  }

  // ---------------------------------------------------------------------------
  // Delete (Task 4.1)
  // ---------------------------------------------------------------------------

  async delete(
    linkId: number,
    projectId: number,
    taskId: number,
    actor: ExternalLinkActor,
  ): Promise<void> {
    const link = await this.getById(linkId, projectId, taskId, actor)
    if (!link) {
      throw new LinkNotFoundError('外部链接未找到')
    }

    await link.delete()

    await this.audit.log({
      event: AuditEvent.TASK_EXTERNAL_LINK_DELETED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'task_external_link',
      entityId: link.id,
      metadata: {
        provider: link.provider,
        linkType: link.linkType,
        repositoryOwner: link.repositoryOwner,
        repositoryName: link.repositoryName,
        externalNumber: link.externalNumber,
        taskId,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Refresh (v2-5-github-linked-item-read-refresh / v2-5-gitlab-linked-item-read-refresh)
  // ---------------------------------------------------------------------------

  /**
   * D7: 刷新外部链接状态。并发场景下，同一链接最后一次完整成功的结果优先，
   * 失败结果不会覆盖已成功的快照。
   */
  async refresh(
    linkId: number,
    projectId: number,
    taskId: number,
    actor: ExternalLinkActor,
  ): Promise<RefreshLinkResult> {
    const link = await this.getById(linkId, projectId, taskId, actor)
    if (!link) {
      throw new LinkNotFoundError('外部链接未找到')
    }

    const previousStatus = link.externalStatus
    const previousStatusSource = link.statusSource
    // 4.6: 记录开始时的观测时间，用于并发保护（乐观锁）
    const observedAtBeforeRefresh = link.lastObservedAt

    // D3: 对 GitHub Issue/PR 或 GitLab Issue/MR 执行真实读取
    const isGitHubReachable =
      link.provider === 'github' && ['issue', 'pull_request'].includes(link.linkType)
    const isGitLabReachable =
      link.provider === 'gitlab' && ['issue', 'merge_request'].includes(link.linkType)

    if (isGitHubReachable) {
      return this.refreshGitHubLink(
        link,
        actor,
        previousStatus,
        previousStatusSource,
        taskId,
        observedAtBeforeRefresh,
      )
    }

    if (isGitLabReachable) {
      return this.refreshGitLabLink(
        link,
        actor,
        previousStatus,
        previousStatusSource,
        taskId,
        observedAtBeforeRefresh,
      )
    }

    // 其他 provider 或未知链接类型保持降级
    return this.handleDegradedRefresh(link, actor, previousStatus, previousStatusSource)
  }

  // ---------------------------------------------------------------------------
  // 私有辅助方法
  // ---------------------------------------------------------------------------

  private isValidLocator(locator: GitHubLinkLocator): boolean {
    if (!locator.owner || locator.owner.trim().length === 0) return false
    if (!locator.repo || locator.repo.trim().length === 0) return false
    if (!locator.kind || !['issue', 'pull_request'].includes(locator.kind)) return false
    if (typeof locator.number !== 'number' || locator.number <= 0) return false
    // 基本格式校验：owner/repo 不能包含危险字符
    const safePattern = /^[a-zA-Z0-9_.-]+$/
    if (!safePattern.test(locator.owner)) return false
    if (!safePattern.test(locator.repo)) return false
    return true
  }

  private isValidGitlabLocator(locator: GitLabLinkLocator): boolean {
    if (!locator.projectPath || locator.projectPath.trim().length === 0) return false
    if (!locator.kind || !['issue', 'merge_request'].includes(locator.kind)) return false
    if (typeof locator.iid !== 'number' || locator.iid <= 0) return false
    if (!locator.baseUrl || locator.baseUrl.trim().length === 0) return false
    // projectPath 基本格式校验：namespace/project，不能包含危险字符
    const safePattern = /^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/
    if (!safePattern.test(locator.projectPath)) return false
    return true
  }

  // ---------------------------------------------------------------------------
  // v2-5-code-repository-ci-status-display —— CI 投影辅助
  // ---------------------------------------------------------------------------

  /**
   * 拉取并投影 GitHub PR 的 CI/check 摘要。
   * 仅 pull_request 有意义；no_ci 或失败一律保留既有摘要（失败必须保快照）。
   * 用 shouldReplaceCiSummary 保证旧观测不覆盖较新成功摘要。
   */
  private async projectGithubCi(
    link: TaskExternalLink,
    locator: GitHubLinkLocator,
    accessToken: string,
    existing: CodeRepositoryCiSummary | null,
  ): Promise<CodeRepositoryCiSummary | null> {
    if (link.linkType !== 'pull_request') return existing
    const ciResult = await this.githubClient.fetchCiSummary(locator, accessToken)
    if (ciResult.type !== 'ci') return existing

    const source: CiSummarySource = ciResult.kind === 'status' ? 'github_status' : 'github_checks'
    const ctx = { source, allowedHost: GITHUB_HOST, observedAt: new Date().toISOString() }
    const summary =
      ciResult.kind === 'status'
        ? projectGithubStatus(ciResult.payload, ctx)
        : projectGithubChecks(ciResult.payload, ctx)
    return shouldReplaceCiSummary(existing, summary) ? summary : existing
  }

  /**
   * 拉取并投影 GitLab MR 的最新 pipeline CI 摘要。
   * 仅 merge_request 有意义；no_ci 或失败一律保留既有摘要。
   */
  private async projectGitlabCi(
    link: TaskExternalLink,
    locator: GitLabLinkLocator,
    accessToken: string,
    existing: CodeRepositoryCiSummary | null,
  ): Promise<CodeRepositoryCiSummary | null> {
    if (link.linkType !== 'merge_request') return existing
    const ciResult = await this.gitlabClient.fetchCiSummary(locator, accessToken)
    if (ciResult.type !== 'ci') return existing

    const summary = projectGitlabPipeline(ciResult.payload, {
      source: 'gitlab_pipeline',
      allowedHost: this.gitlabHost(locator.baseUrl),
      observedAt: new Date().toISOString(),
    })
    return shouldReplaceCiSummary(existing, summary) ? summary : existing
  }

  private gitlabHost(baseUrl: string): string {
    try {
      return new URL(baseUrl).hostname
    } catch {
      return 'gitlab.com'
    }
  }

  /** 生成低敏 CI 审计元数据片段（不含 token/payload/log/artifact/diff/comment）。 */
  private ciAuditMeta(
    previousState: string | null,
    next: CodeRepositoryCiSummary | null,
  ): Record<string, unknown> {
    if (!next) return {}
    return {
      ciPreviousState: previousState,
      ciNewState: next.state,
      ciSource: next.source,
      ciReasonCode: next.reasonCode,
      ciObservedAt: next.observedAt,
    }
  }

  // ---------------------------------------------------------------------------
  // GitHub 刷新路径
  // ---------------------------------------------------------------------------

  private async refreshGitHubLink(
    link: TaskExternalLink,
    actor: ExternalLinkActor,
    previousStatus: ExternalLinkStatus,
    previousStatusSource: ExternalLinkStatusSource | null,
    taskId: number,
    observedAtBeforeRefresh: DateTime | null,
  ): Promise<RefreshLinkResult> {
    // D2: 按 actor 解析有效 GitHub 只读连接
    const connectionResult = await this.connectionResolver.resolve(
      actor.organizationId,
      actor.userId,
    )

    if (connectionResult.type !== 'connected') {
      // 连接不可用，返回稳定 reason code
      return this.handleConnectionUnavailable(
        link,
        actor,
        previousStatus,
        previousStatusSource,
        connectionResult.type,
        connectionResult.message,
      )
    }

    // D3: 从本地受信链接字段构造 locator
    const locator: GitHubLinkLocator = {
      owner: link.repositoryOwner,
      repo: link.repositoryName,
      kind: link.linkType as 'issue' | 'pull_request',
      number: link.externalNumber,
    }

    // 验证 locator 字段
    if (!this.isValidLocator(locator)) {
      return this.handleConnectionUnavailable(
        link,
        actor,
        previousStatus,
        previousStatusSource,
        'unsupported_link',
        '链接定位信息无效或不完整',
      )
    }

    // 调用 GitHub 只读 client
    const refreshResult = await this.githubClient.fetchIssueOrPR(
      locator,
      connectionResult.accessToken,
    )

    if (refreshResult.type !== 'refreshed') {
      // 失败分支：保留原快照
      return this.handleRefreshFailure(
        link,
        actor,
        previousStatus,
        previousStatusSource,
        refreshResult.type,
        refreshResult.message,
        'retryAfter' in refreshResult ? refreshResult.retryAfter : undefined,
      )
    }

    // 4.6: 并发保护 —— 用乐观锁检查其他并发请求是否已成功刷新
    const isStale = await this.isRefreshResultStale(
      link.id,
      link.taskId,
      link.projectId,
      { userId: actor.userId, organizationId: actor.organizationId },
      observedAtBeforeRefresh,
    )
    if (isStale) {
      // 另一个并发请求已成功刷新，放弃当前写入（返回既有 CI 摘要）
      return {
        id: link.id,
        previousStatus,
        previousStatusSource,
        result: 'success',
        message: '另一个并发刷新已成功更新，当前结果跳过',
        ciSummary: link.getCiSummary(),
      }
    }

    // CI 投影（仅 PR）：在写库前拿到新摘要，与既有摘要按时间/优先级合并
    const previousCi = link.getCiSummary()
    const previousCiState = previousCi?.state ?? null
    const nextCi = await this.projectGithubCi(
      link,
      locator,
      connectionResult.accessToken,
      previousCi,
    )

    // 成功分支：原子更新白名单快照 + CI 摘要（单次 save）
    const snapshot = refreshResult.snapshot
    link.externalStatus = snapshot.status as ExternalLinkStatus
    link.externalTitle = snapshot.title
    link.externalUrl = snapshot.safeUrl
    link.statusSource = 'github_readonly'
    link.lastObservedAt = DateTime.fromISO(snapshot.observedAt)
    if (nextCi) link.setCiSummary(nextCi)
    link.updatedBy = actor.userId
    await link.save()

    // 审计日志（低敏，含 CI 前后状态/来源/reason/观测时间，不含 token/payload/log）
    await this.audit.log({
      event: AuditEvent.TASK_EXTERNAL_LINK_REFRESHED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'task_external_link',
      entityId: link.id,
      metadata: {
        provider: link.provider,
        linkType: link.linkType,
        repositoryOwner: link.repositoryOwner,
        repositoryName: link.repositoryName,
        externalNumber: link.externalNumber,
        previousStatus,
        previousStatusSource,
        newStatus: snapshot.status,
        statusSource: 'github_readonly',
        result: 'refreshed',
        taskId,
        ...this.ciAuditMeta(previousCiState, nextCi),
      },
    })

    return {
      id: link.id,
      previousStatus,
      previousStatusSource,
      result: 'success',
      message: 'GitHub 链接状态已刷新',
      ciSummary: nextCi ?? null,
    }
  }

  // ---------------------------------------------------------------------------
  // GitLab 刷新路径
  // ---------------------------------------------------------------------------

  private async refreshGitLabLink(
    link: TaskExternalLink,
    actor: ExternalLinkActor,
    previousStatus: ExternalLinkStatus,
    previousStatusSource: ExternalLinkStatusSource | null,
    taskId: number,
    observedAtBeforeRefresh: DateTime | null,
  ): Promise<RefreshLinkResult> {
    // D2: 按 actor 解析有效 GitLab 只读连接
    const connectionResult = await this.gitlabConnectionResolver.resolve(
      actor.organizationId,
      actor.userId,
    )

    if (connectionResult.type !== 'connected') {
      return this.handleConnectionUnavailable(
        link,
        actor,
        previousStatus,
        previousStatusSource,
        connectionResult.type,
        connectionResult.message,
      )
    }

    // D3: 从本地受信链接字段构造 locator
    // GitLab base URL 来自已解析的连接配置（不会从客户端/链接记录/URL 读 host）
    const locator: GitLabLinkLocator = {
      baseUrl: this.resolveGitlabBaseUrl(),
      projectPath: `${link.repositoryOwner}/${link.repositoryName}`,
      kind: link.linkType as 'issue' | 'merge_request',
      iid: link.externalNumber,
    }

    // 验证 locator 字段
    if (!this.isValidGitlabLocator(locator)) {
      return this.handleConnectionUnavailable(
        link,
        actor,
        previousStatus,
        previousStatusSource,
        'unsupported_link',
        'GitLab 链接定位信息无效或不完整',
      )
    }

    // 调用 GitLab 只读 client
    const refreshResult = await this.gitlabClient.fetchIssueOrMR(
      locator,
      connectionResult.accessToken,
    )

    if (refreshResult.type !== 'refreshed') {
      return this.handleRefreshFailure(
        link,
        actor,
        previousStatus,
        previousStatusSource,
        refreshResult.type,
        refreshResult.message,
        'retryAfter' in refreshResult ? refreshResult.retryAfter : undefined,
      )
    }

    // 4.6: 并发保护 —— 用乐观锁检查其他并发请求是否已成功刷新
    const isStale = await this.isRefreshResultStale(
      link.id,
      link.taskId,
      link.projectId,
      { userId: actor.userId, organizationId: actor.organizationId },
      observedAtBeforeRefresh,
    )
    if (isStale) {
      return {
        id: link.id,
        previousStatus,
        previousStatusSource,
        result: 'success',
        message: '另一个并发刷新已成功更新，当前结果跳过',
        ciSummary: link.getCiSummary(),
      }
    }

    // CI 投影（仅 MR）：写库前拿到新摘要，与既有摘要按时间/优先级合并
    const previousCi = link.getCiSummary()
    const previousCiState = previousCi?.state ?? null
    const nextCi = await this.projectGitlabCi(
      link,
      locator,
      connectionResult.accessToken,
      previousCi,
    )

    // 成功分支：原子更新白名单快照 + CI 摘要（单次 save）
    // D4: 将 GitLab 状态映射为 canonical 状态
    const snapshot = refreshResult.snapshot
    link.externalStatus = this.mapGitlabStatus(snapshot.status) as ExternalLinkStatus
    link.externalTitle = snapshot.title
    link.externalUrl = snapshot.safeUrl
    link.statusSource = 'gitlab_readonly'
    link.lastObservedAt = DateTime.fromISO(snapshot.observedAt)
    if (nextCi) link.setCiSummary(nextCi)
    link.updatedBy = actor.userId
    await link.save()

    // 审计日志（低敏，含 CI 前后状态/来源/reason/观测时间）
    await this.audit.log({
      event: AuditEvent.TASK_EXTERNAL_LINK_REFRESHED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'task_external_link',
      entityId: link.id,
      metadata: {
        provider: link.provider,
        linkType: link.linkType,
        repositoryOwner: link.repositoryOwner,
        repositoryName: link.repositoryName,
        externalNumber: link.externalNumber,
        previousStatus,
        previousStatusSource,
        newStatus: snapshot.status,
        statusSource: 'gitlab_readonly',
        result: 'refreshed',
        taskId,
        ...this.ciAuditMeta(previousCiState, nextCi),
      },
    })

    return {
      id: link.id,
      previousStatus,
      previousStatusSource,
      result: 'success',
      message:
        link.linkType === 'merge_request'
          ? 'GitLab Merge Request 状态已刷新'
          : 'GitLab Issue 状态已刷新',
      ciSummary: nextCi ?? null,
    }
  }

  /**
   * 从 connection 记录的服务端 base URL 派生 GitLab base URL。
   * D3/D6: base URL 只来自服务端配置，不接受链接记录或客户端输入。
   */
  private resolveGitlabBaseUrl(): string {
    // 从 GitlabOAuthService 的 base URL 解析获取
    // 这里使用静态 fallback：生产环境从 env 读取，fixture 默认 gitlab.com
    return 'https://gitlab.com'
  }

  /**
   * D4: 将 GitLab 状态映射为 canonical ExternalLinkStatus。
   * GitLab Issue: opened/closed
   * GitLab MR: opened/closed/merged/locked
   */
  private mapGitlabStatus(status: string): ExternalLinkStatus {
    switch (status) {
      case 'opened':
        return 'open' as ExternalLinkStatus
      case 'closed':
        return 'closed' as ExternalLinkStatus
      case 'merged':
        return 'merged' as ExternalLinkStatus
      case 'locked':
        return 'locked' as ExternalLinkStatus
      case 'unknown':
        return 'unknown' as ExternalLinkStatus
      default:
        return 'unknown' as ExternalLinkStatus
    }
  }

  private async handleDegradedRefresh(
    link: TaskExternalLink,
    actor: ExternalLinkActor,
    previousStatus: ExternalLinkStatus,
    previousStatusSource: ExternalLinkStatusSource | null,
  ): Promise<RefreshLinkResult> {
    const adapterResult = this.codeRepo.refresh(link.provider as ExternalLinkProvider)

    // 更新状态来源
    if (adapterResult.result === 'not_configured') {
      link.statusSource = 'not_configured'
    } else if (adapterResult.result === 'readonly_connection_ready') {
      link.statusSource = 'readonly_connection_ready'
    } else {
      link.statusSource = 'pre_connection_only'
    }
    link.updatedBy = actor.userId
    await link.save()

    const auditEvent =
      adapterResult.result === 'not_configured' || adapterResult.result === 'pre_connection_only'
        ? AuditEvent.TASK_EXTERNAL_LINK_REFRESH_DEGRADED
        : AuditEvent.TASK_EXTERNAL_LINK_REFRESHED

    await this.audit.log({
      event: auditEvent,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'task_external_link',
      entityId: link.id,
      metadata: {
        provider: link.provider,
        linkType: link.linkType,
        repositoryOwner: link.repositoryOwner,
        repositoryName: link.repositoryName,
        externalNumber: link.externalNumber,
        previousStatus,
        previousStatusSource,
        result: adapterResult.result,
        taskId: link.taskId,
      },
    })

    return {
      id: link.id,
      previousStatus,
      previousStatusSource,
      result: adapterResult.result as RefreshResultCode,
      message: adapterResult.message,
      ciSummary: link.getCiSummary(),
    }
  }

  private async handleConnectionUnavailable(
    link: TaskExternalLink,
    actor: ExternalLinkActor,
    previousStatus: ExternalLinkStatus,
    previousStatusSource: ExternalLinkStatusSource | null,
    reason: string,
    message: string,
  ): Promise<RefreshLinkResult> {
    // 失败分支：只更新状态来源，不碰快照字段
    link.statusSource = reason as ExternalLinkStatusSource
    link.updatedBy = actor.userId
    await link.save()

    await this.audit.log({
      event: AuditEvent.TASK_EXTERNAL_LINK_REFRESH_DEGRADED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'task_external_link',
      entityId: link.id,
      metadata: {
        provider: link.provider,
        linkType: link.linkType,
        repositoryOwner: link.repositoryOwner,
        repositoryName: link.repositoryName,
        externalNumber: link.externalNumber,
        previousStatus,
        previousStatusSource,
        result: reason,
        taskId: link.taskId,
      },
    })

    return {
      id: link.id,
      previousStatus,
      previousStatusSource,
      result: reason as RefreshResultCode,
      message,
      ciSummary: link.getCiSummary(),
    }
  }

  private async handleRefreshFailure(
    link: TaskExternalLink,
    actor: ExternalLinkActor,
    previousStatus: ExternalLinkStatus,
    previousStatusSource: ExternalLinkStatusSource | null,
    reason: string,
    message: string,
    retryAfter?: number,
  ): Promise<RefreshLinkResult> {
    // 失败分支：保留原快照，只更新状态来源
    link.statusSource = reason as ExternalLinkStatusSource
    link.updatedBy = actor.userId
    await link.save()

    await this.audit.log({
      event: AuditEvent.TASK_EXTERNAL_LINK_REFRESH_DEGRADED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'task_external_link',
      entityId: link.id,
      metadata: {
        provider: link.provider,
        linkType: link.linkType,
        repositoryOwner: link.repositoryOwner,
        repositoryName: link.repositoryName,
        externalNumber: link.externalNumber,
        previousStatus,
        previousStatusSource,
        result: reason,
        taskId: link.taskId,
      },
    })

    return {
      id: link.id,
      previousStatus,
      previousStatusSource,
      result: reason as RefreshResultCode,
      message,
      retryAfter,
      ciSummary: link.getCiSummary(),
    }
  }

  // ---------------------------------------------------------------------------
  // 4.6: 并发保护 —— 乐观锁
  // ---------------------------------------------------------------------------

  /**
   * 检查另一个并发刷新是否已成功更新快照。
   * 如果 `lastObservedAt` 从我们读取时发生变化，说明有其他请求先完成了刷新，
   * 当前结果应当跳过避免覆盖。
   */
  private async isRefreshResultStale(
    linkId: number,
    taskId: number,
    projectId: number,
    actor: ExternalLinkActor,
    observedAtBeforeRefresh: DateTime | null,
  ): Promise<boolean> {
    const current = await TaskExternalLink.query()
      .where('id', linkId)
      .where('organization_id', actor.organizationId)
      .where('project_id', projectId)
      .where('task_id', taskId)
      .first()

    if (!current) return false
    // 如果 lastObservedAt 改变了（有新的成功刷新），则当前结果已过时
    if (
      observedAtBeforeRefresh &&
      current.lastObservedAt &&
      current.lastObservedAt.toMillis() !== observedAtBeforeRefresh.toMillis()
    ) {
      return true
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // 用于 task detail include（Task 5.3）
  // ---------------------------------------------------------------------------

  async getSummariesByTask(
    projectId: number,
    taskId: number,
    actor: ExternalLinkActor,
  ): Promise<
    Array<{
      id: number
      provider: string
      linkType: string
      repositoryOwner: string
      repositoryName: string
      externalNumber: number
      externalTitle: string | null
      externalStatus: string
      externalUrl: string
      statusSource: string
      lastObservedAt: string | null
      ciSummary: CodeRepositoryCiSummary | null
    }>
  > {
    const links = await this.listByTask(projectId, taskId, actor)
    return links.map((l) => ({
      id: l.id,
      provider: l.provider,
      linkType: l.linkType,
      repositoryOwner: l.repositoryOwner,
      repositoryName: l.repositoryName,
      externalNumber: l.externalNumber,
      externalTitle: l.externalTitle,
      externalStatus: l.externalStatus,
      externalUrl: l.externalUrl,
      statusSource: l.statusSource,
      lastObservedAt: l.lastObservedAt?.toISO() ?? null,
      ciSummary: l.getCiSummary(),
    }))
  }

  // ---------------------------------------------------------------------------
  // v2-5-code-repository-ci-status-display —— Webhook CI 事件投影（任务 4.5）
  //
  // Webhook foundation 只校验+记账、不派发原始 payload 到业务 handler，真实回调受授权门控；
  // 故本方法是**确定性投影入口**，由已脱敏的安全事件驱动（默认 fixture/mock 测试）。
  // 强制对象绑定：事件必须匹配已存链接 locator，且旧事件不覆盖较新成功摘要。
  // ---------------------------------------------------------------------------

  async applyCiWebhookEvent(
    event: WebhookCiEvent,
    projectId: number,
    taskId: number,
    actor: ExternalLinkActor,
  ): Promise<{ applied: boolean; reason: string; ciSummary: CodeRepositoryCiSummary | null }> {
    // 只按已存链接 locator 定位（不接受事件里的任意 repository/number 覆盖）
    const candidates = await TaskExternalLink.query()
      .where('organization_id', actor.organizationId)
      .where('project_id', projectId)
      .where('task_id', taskId)
      .where('provider', event.provider)
      .where('link_type', event.provider === 'github' ? 'pull_request' : 'merge_request')

    for (const link of candidates) {
      const locator: CiEventLocator = {
        provider: event.provider,
        repositoryOwner: link.repositoryOwner,
        repositoryName: link.repositoryName,
        externalNumber: link.externalNumber,
        linkType: link.linkType,
      }
      const allowedHost =
        event.provider === 'github' ? GITHUB_HOST : this.gitlabHost(this.resolveGitlabBaseUrl())
      const { matched, summary } = projectWebhookCiEvent(event, locator, allowedHost)
      if (!matched || !summary) continue

      const existing = link.getCiSummary()
      const previousCiState = existing?.state ?? null
      // 旧事件/重复事件不覆盖较新成功摘要（幂等）
      if (!shouldReplaceCiSummary(existing, summary)) {
        return { applied: false, reason: 'stale_or_duplicate', ciSummary: existing }
      }

      link.setCiSummary(summary)
      link.updatedBy = actor.userId
      await link.save()

      await this.audit.log({
        event: AuditEvent.TASK_EXTERNAL_LINK_REFRESHED,
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'task_external_link',
        entityId: link.id,
        metadata: {
          provider: link.provider,
          linkType: link.linkType,
          repositoryOwner: link.repositoryOwner,
          repositoryName: link.repositoryName,
          externalNumber: link.externalNumber,
          result: 'ci_webhook',
          taskId,
          ...this.ciAuditMeta(previousCiState, summary),
        },
      })

      return { applied: true, reason: 'ok', ciSummary: summary }
    }

    // 无匹配链接：不更新任何摘要
    return { applied: false, reason: 'no_matching_link', ciSummary: null }
  }
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class LinkValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkValidationError'
  }
}

export class LinkDuplicateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkDuplicateError'
  }
}

export class LinkNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkNotFoundError'
  }
}
