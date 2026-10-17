import type User from '#models/user'
import { ValidationException } from '#exceptions/api_exception'
import { recallLastTeamText } from '#services/ai_draft/planning_memory'
import { liveOutputGateway } from '#services/ai_live_output/live_output_hub'
import { abortableGateway } from '#services/ai_analysis/abortable_gateway'
import type AuditService from '#services/audit_service'
import { AuditEvent } from '#services/audit_service'
import type ClarificationService from '#services/ai_intent/clarification_service'
import AgentQuestionService from '#services/ai_intent/agent_question_service'
import AgentQuestionPlanTokenService from '#services/ai_intent/agent_question_plan_token_service'
import QuestionPlanChecker from '#services/ai_intent/question_plan_checker'
import AdaptiveClarificationService from '#services/ai_intent/adaptive_clarification_service'
import AdaptiveClarificationTokenService from '#services/ai_intent/adaptive_clarification_token_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import { assertAiConnectionAvailable } from '#services/ai_m0/ai_connection_requirement'
import type ContradictionPolicy from '#policies/contradiction_policy'
import { TrizClarificationSourceAdapter } from '#services/triz_clarification/triz_clarification_source_adapter'
import { TrizCandidateGenerator } from '#services/triz_clarification/triz_candidate_generator'
import { TrizClarificationMerger } from '#services/triz_clarification/triz_clarification_merger'
import type { TrizClarificationAnswer } from '@aiproj/types'
import type { analyzeProjectIntentValidator } from '#validators/ai_intent_validator'
import type { trizClarificationAnswersValidator } from '#validators/triz_clarification_validator'

interface IntentAnalysisInput {
  user: User
  organizationId: number
  input: Awaited<ReturnType<typeof analyzeProjectIntentValidator.validate>>
  trizAnswers?: Awaited<
    ReturnType<typeof trizClarificationAnswersValidator.validate>
  >['trizAnswers']
  projectId: number
  requestId: string | null
  liveId: string | null
  signal?: AbortSignal
}

/** 与 HTTP 生命周期分离，后台调用不持有 HttpContext。 */
export default class IntentAnalysisService {
  private readonly agentQuestions = new AgentQuestionService()
  private readonly agentPlanTokens = new AgentQuestionPlanTokenService()
  private readonly questionPlanChecker = new QuestionPlanChecker()
  private readonly adaptiveClarification = new AdaptiveClarificationService()
  private readonly adaptiveTokens = new AdaptiveClarificationTokenService()

  constructor(
    private readonly clarification: ClarificationService,
    private readonly audit: AuditService,
    private readonly contradictionPolicy: ContradictionPolicy,
  ) {}

  async analyze(args: IntentAnalysisInput) {
    let consumed = false
    try {
      return await this.analyzeInternal(args, () => {
        consumed = true
      })
    } catch (error) {
      // 失败没有发布新会话，允许用原回答重试；成功的令牌仍防重放。
      if (consumed && args.input.adaptiveSessionToken)
        this.adaptiveTokens.releaseFailedMutation(args.input.adaptiveSessionToken)
      throw error
    }
  }

  private consumeMutation(
    token: string,
    scope: { organizationId: number; userId: number; rawInput: string },
    markConsumed: () => void,
  ) {
    const session = this.adaptiveTokens.consumeForMutation(token, scope)
    markConsumed()
    return session
  }

  private async analyzeInternal(
    {
      user,
      organizationId,
      input,
      trizAnswers,
      projectId,
      requestId,
      liveId,
      signal,
    }: IntentAnalysisInput,
    markConsumed: () => void,
  ) {
    // 自适应会话的 questionPlanRevision 是「轮次:账本版本」，由已签名的会话令牌保证一致，
    // 不能拿固定问卷的规则去校验（否则新版剧场每一步都报 QUESTION_PLAN_STALE）。
    if (
      input.questionPlanRevision &&
      !input.agentQuestionPlanToken &&
      !input.adaptiveSessionToken
    ) {
      this.clarification.assertQuestionPlanRevision(
        input.rawInput,
        input.answers ?? {},
        input.questionPlanRevision,
      )
    }

    // 2. Generate TRIZ clarification candidates if contradiction:view permission exists
    let trizCandidates: import('@aiproj/types').TrizClarificationCandidate[] = []
    let trizGenerated = false
    if (projectId) {
      try {
        const sourceAdapter = new TrizClarificationSourceAdapter(this.contradictionPolicy)
        const generator = new TrizCandidateGenerator()

        const sourceRefs = await sourceAdapter.getAuthorizedSnapshots(
          user,
          organizationId,
          projectId,
        )
        if (sourceRefs.length > 0) {
          trizCandidates = generator.generateCandidates(sourceRefs, null) // analysis hint optional
          trizGenerated = true
        }
      } catch {
        // TRIZ generation failure should not block ordinary clarification
        trizCandidates = []
      }
    }

    // 3. Merge TRIZ cards with ordinary cards
    const merger = new TrizClarificationMerger(this.clarification)
    let result = merger.analyze(
      input.rawInput,
      input.answers,
      trizCandidates,
      trizAnswers as TrizClarificationAnswer[] | undefined,
    )

    // 4. Model-driven sessions are selected explicitly by the user's configured model.
    // Legacy requests without a model stay readable through the fixed-field compatibility path.
    let adaptiveHandled = false
    const adaptiveClarificationEnabled = process.env.AI_ADAPTIVE_CLARIFICATION_ENABLED !== 'false'
    const replayingLegacySession =
      !input.adaptiveSessionToken && Object.keys(input.answers ?? {}).length > 0
    if (
      adaptiveClarificationEnabled &&
      !replayingLegacySession &&
      (input.connectionId || input.modelId || input.adaptiveSessionToken)
    ) {
      const resolved = await resolveAdapter({
        connectionId: input.connectionId,
        modelId: input.modelId,
        organizationId,
        requiredCapabilities: ['chat'],
        estimatedTokens: 2_800,
        recordContext: {
          organizationId,
          userId: user.id,
          connectionId: input.connectionId ?? null,
          modelId: input.modelId ?? null,
          capability: 'chat',
          surface: 'ai-create-adaptive-clarification',
          workflowName: 'ai-project-adaptive-clarification',
          source: 'user',
        },
      })
      assertAiConnectionAvailable(resolved)
      const previous = input.adaptiveSessionToken
        ? input.adaptiveResponse?.text || input.requestPreliminaryDraft || input.retryGuardedSession
          ? this.consumeMutation(
              input.adaptiveSessionToken,
              {
                organizationId,
                userId: user.id,
                rawInput: input.rawInput,
              },
              markConsumed,
            )
          : this.adaptiveTokens.consume(input.adaptiveSessionToken, {
              organizationId,
              userId: user.id,
              rawInput: input.rawInput,
            })
        : null
      // 跨生成记忆：上次起草时给出的团队，追问团队时作为「沿用上次」选项（读取失败不影响追问）。
      const lastTeam = await recallLastTeamText(organizationId, user.id).catch(() => null)
      let adaptiveSession = previous
        ? input.adaptiveResponse?.text
          ? await this.adaptiveClarification.continue({
              gateway: liveOutputGateway(abortableGateway(resolved.gateway, signal), liveId),
              rawInput: input.rawInput,
              session: previous,
              responseText: input.adaptiveResponse.text,
              lastTeam,
              requirementBrief: input.requirementBrief ?? null,
            })
          : // 守卫态是个死胡同：continue() 会因 status !== 'clarifying' 原样返回。
            // 显式重试走 retryGuarded，用现有 ledger 重跑理解，答案不丢。
            input.retryGuardedSession
            ? await this.adaptiveClarification.retryGuarded({
                gateway: liveOutputGateway(abortableGateway(resolved.gateway, signal), liveId),
                rawInput: input.rawInput,
                session: previous,
                lastTeam,
                requirementBrief: input.requirementBrief ?? null,
              })
            : previous
        : await this.adaptiveClarification.start({
            gateway: liveOutputGateway(abortableGateway(resolved.gateway, signal), liveId),
            rawInput: input.rawInput,
            lastTeam,
            requirementBrief: input.requirementBrief ?? null,
          })
      if (input.requestPreliminaryDraft) {
        adaptiveSession = this.adaptiveClarification.requestPreliminaryDraft(adaptiveSession)
      }
      signal?.throwIfAborted()
      const adaptiveSessionToken = this.adaptiveTokens.issue({
        organizationId,
        userId: user.id,
        rawInput: input.rawInput,
        session: adaptiveSession,
      })
      const isReady = adaptiveSession.status === 'ready'
      result = {
        ...result,
        cards: [],
        branch: isReady ? 'ready' : 'clarify',
        phase: isReady ? 'ready' : 'agent',
        activeCard: null,
        remainingCount: adaptiveSession.conversation?.remainingEstimate ?? 0,
        // 用会话自己算出来的已确认数：ledger.entries 里含 superseded 历史版本，
        // 直接数长度会比界面上「已确认 N 项」多，两个数字对不上。
        completedCount:
          adaptiveSession.conversation?.completedCount ??
          adaptiveSession.ledger.entries.filter((entry) => entry.status !== 'superseded').length,
        totalCount:
          (adaptiveSession.conversation?.completedCount ??
            adaptiveSession.ledger.entries.filter((entry) => entry.status !== 'superseded')
              .length) + (adaptiveSession.conversation?.remainingEstimate ?? 0),
        summary: adaptiveSession.conversation?.remainingBreakdown ?? {
          critical: 0,
          recommended: 0,
          optional: 0,
        },
        questionPlanRevision: `${adaptiveSession.round}:${adaptiveSession.ledger.revision}`,
        agentQuestionPlanToken: null,
        adaptiveSession,
        adaptiveSessionToken,
        confirmedContext: {
          ...result.confirmedContext,
          unresolvedCriticalFields: [],
          adaptiveUnderstanding: adaptiveSession.understanding,
          adaptiveLedger: adaptiveSession.ledger,
          knownUnknowns: adaptiveSession.knownUnknowns,
        },
      }
      adaptiveHandled = true
    }

    // 4a. Consume a previously issued, server-signed Agent batch. Each answer advances the
    // same batch and revision; retries/refreshes replay it without a second provider call.
    if (!adaptiveHandled && input.agentQuestionPlanToken) {
      if (result.branch !== 'ready') {
        throw new ValidationException(
          'QUESTION_PLAN_STALE：固定或条件答案已变化，请重新载入当前问题',
        )
      }
      const consumed = this.agentPlanTokens.consume(input.agentQuestionPlanToken, {
        organizationId,
        userId: user.id,
        rawInput: input.rawInput,
        answers: input.answers ?? {},
        questionPlanRevision: input.questionPlanRevision,
      })
      if (consumed.cards.length > 0) {
        const coverage = this.questionPlanChecker.check({
          cards: consumed.cards,
          requiredIds: consumed.cards.map((card) => card.cardId),
          answeredFields: Object.keys(
            input.answers ?? {},
          ) as import('@aiproj/types').ClarificationField[],
          selectedPackIds: consumed.selectedPackIds,
          packRequiredIds: {},
        })
        if (!coverage.valid) {
          throw new ValidationException(`Agent 问题计划校验失败：${coverage.reasonCodes.join(',')}`)
        }
        result = {
          ...result,
          cards: consumed.cards,
          branch: 'clarify',
          phase: 'agent',
          activeCard: consumed.cards[0] ?? null,
          remainingCount: consumed.cards.length,
          completedCount: consumed.baseAnswerCount + consumed.answeredAgentCount,
          totalCount: consumed.baseAnswerCount + consumed.totalAgentCount,
          questionPlanRevision: consumed.questionPlanRevision,
          agentQuestionPlanToken: input.agentQuestionPlanToken,
          coverage,
          summary: { critical: 0, recommended: consumed.cards.length, optional: 0 },
        }
      } else {
        result = {
          ...result,
          questionPlanRevision: consumed.questionPlanRevision,
          agentQuestionPlanToken: null,
        }
      }
    }

    // 4b. Fixed core and triggered packs are complete: make at most one provider call to
    // issue a bounded batch of up to five questions. The signed snapshot is consumed above.
    if (!adaptiveHandled && result.branch === 'ready' && !input.agentQuestionPlanToken) {
      try {
        const resolved = await resolveAdapter({
          connectionId: input.connectionId,
          modelId: input.modelId,
          organizationId,
          requiredCapabilities: ['chat'],
          estimatedTokens: 1_600,
          recordContext: {
            organizationId,
            userId: user.id,
            connectionId: input.connectionId ?? null,
            modelId: input.modelId ?? null,
            capability: 'chat',
            surface: 'ai-create-agent-clarification',
            workflowName: 'ai-project-agent-clarification',
            source: 'user',
          },
        })
        const plan = await this.agentQuestions.propose({
          gateway: abortableGateway(resolved.gateway, signal),
          context: result.confirmedContext,
          answers: input.answers ?? {},
          selectedPackIds: result.coverage?.selectedPackIds ?? [],
        })
        if (plan.cards.length > 0) {
          const issued = this.agentPlanTokens.issue({
            organizationId,
            userId: user.id,
            rawInput: input.rawInput,
            answers: input.answers ?? {},
            selectedPackIds: result.coverage?.selectedPackIds ?? [],
            cards: plan.cards,
          })
          result = {
            ...result,
            cards: plan.cards,
            branch: 'clarify',
            phase: 'agent',
            activeCard: plan.cards[0] ?? null,
            remainingCount: plan.cards.length,
            completedCount: Object.keys(input.answers ?? {}).length,
            totalCount: Object.keys(input.answers ?? {}).length + plan.cards.length,
            questionPlanRevision: issued.questionPlanRevision,
            agentQuestionPlanToken: issued.token,
            coverage: plan.coverage,
            summary: {
              critical: 0,
              recommended: plan.cards.length,
              optional: 0,
            },
          }
        }
      } catch {
        // Agent follow-up is advisory. Core/conditional coverage remains authoritative and ready.
      }
    }

    // 5. Audit
    await this.audit.log({
      event: AuditEvent.AI_INTENT_ANALYZED,
      userId: user.id,
      organizationId,
      requestId,
      entityType: 'ai_project_intent',
      metadata: {
        projectType: result.parsedIntent.projectType,
        entityCount: result.parsedIntent.entities.length,
        clarificationCounts: result.summary,
        branch: result.branch,
        phase: result.phase,
        remainingCount: result.remainingCount,
        questionPlanValid: result.coverage?.valid ?? false,
        questionPlanReasonCodes: result.coverage?.reasonCodes ?? [],
        selectedPackCount: result.coverage?.selectedPackIds.length ?? 0,
        agentQuestionCount: result.phase === 'agent' ? result.cards.length : 0,
        adaptiveRound: result.adaptiveSession?.round ?? null,
        adaptiveStatus: result.adaptiveSession?.status ?? null,
        schemaVersion: result.parsedIntent.schemaVersion,
        trizGenerated,
        trizCardCount: trizCandidates.length,
      },
    })

    if (trizGenerated && trizCandidates.length > 0) {
      await this.audit.log({
        event: AuditEvent.TRIZ_CLARIFICATION_GENERATED,
        userId: user.id,
        organizationId,
        projectId,
        requestId,
        entityType: 'triz_clarification',
        metadata: {
          cardCount: trizCandidates.length,
          sourceRefCount: trizCandidates.reduce((sum, c) => sum + c.sourceRefs.length, 0),
        },
      })
    }

    if (trizAnswers && trizAnswers.length > 0) {
      const answerAction = trizAnswers.some((a: any) => a.action === 'answer')
        ? AuditEvent.TRIZ_CLARIFICATION_ANSWERED
        : trizAnswers.some((a: any) => a.action === 'adopt_default')
          ? AuditEvent.TRIZ_CLARIFICATION_DEFAULT_ADOPTED
          : AuditEvent.TRIZ_CLARIFICATION_SKIPPED
      await this.audit.log({
        event: answerAction,
        userId: user.id,
        organizationId,
        projectId,
        requestId,
        entityType: 'triz_clarification',
        metadata: {
          answerCount: trizAnswers.length,
          staleCount: 0, // simplified; full stale detection in service
        },
      })
    }

    // 长需求的整理稿随确认上下文带到项目理解与生成（原文仍完整保存在 rawInput）。
    if (input.requirementBrief && result.confirmedContext) {
      result = {
        ...result,
        confirmedContext: { ...result.confirmedContext, requirementBrief: input.requirementBrief },
      }
    }
    return result
  }
}
