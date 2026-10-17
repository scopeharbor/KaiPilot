import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import User from '#models/user'
import {
  buildRequirementBrief,
  requirementTextForPrompt,
} from '#services/ai_intent/requirement_brief_service'
import {
  isLiveOutputId,
  liveOutputGateway,
  liveOutputHub,
  liveOutputOwner,
} from '#services/ai_live_output/live_output_hub'
import AiIntentPolicy from '#policies/ai_intent_policy'
import AuditService from '#services/audit_service'
import ClarificationService from '#services/ai_intent/clarification_service'
import AdaptiveClarificationService from '#services/ai_intent/adaptive_clarification_service'
import AdaptiveClarificationTokenService from '#services/ai_intent/adaptive_clarification_token_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import {
  AiConnectionRequiredException,
  assertAiConnectionAvailable,
} from '#services/ai_m0/ai_connection_requirement'
import RequirementAttachmentService, {
  AttachmentError,
  type OcrCandidate,
} from '#services/ai_intent/requirement_attachment_service'
import {
  analyzeProjectIntentValidator,
  requirementAttachmentValidator,
  requirementBriefValidator,
  explainClarificationQuestionValidator,
} from '#validators/ai_intent_validator'
import { trizClarificationAnswersValidator } from '#validators/triz_clarification_validator'
import IntentAnalysisService from '#services/ai_intent/intent_analysis_service'
import { analysisJobs } from '#services/ai_analysis/lucid_analysis_job_repository'
import {
  analysisJobRequestValidator,
  analysisJobIdValidator,
} from '#validators/analysis_job_validator'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

// TRIZ clarification imports
import ContradictionPolicy from '#policies/contradiction_policy'
import type { AiModelCapability } from '@aiproj/types'

@inject()
export default class AiProjectIntentsController {
  constructor(
    clarification: ClarificationService,
    private readonly policy: AiIntentPolicy,
    audit: AuditService,
    contradictionPolicy: ContradictionPolicy,
  ) {
    this.analysisWork = new IntentAnalysisService(clarification, audit, contradictionPolicy)
  }

  private readonly adaptiveClarification = new AdaptiveClarificationService()
  private readonly adaptiveTokens = new AdaptiveClarificationTokenService()

  async analyze(ctx: HttpContext) {
    // 实时输出旁路：请求带了频道编号就把本次模型调用逐块推给订阅方（GET /ai/live-output/:id）。
    const liveId = this.claimLiveOutput(ctx)
    try {
      return await this.analyzeWithLiveOutput(ctx, liveId)
    } finally {
      if (liveId) liveOutputHub.close(liveId)
    }
  }

  private claimLiveOutput(ctx: HttpContext): string | null {
    const id = ctx.request.input('liveOutputId')
    const organizationId = Number(ctx.tenant?.organizationId)
    const user = ctx.auth.user as User | undefined
    if (!isLiveOutputId(id) || !organizationId || !user) return null
    return liveOutputHub.claim(id, liveOutputOwner(organizationId, user.id)) ? id : null
  }

  private readonly analysisWork: IntentAnalysisService

  private async prepareAnalysis(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId || !(await this.policy.analyze(user, organizationId))) {
      throw new PermissionDeniedException('无权使用 AI 项目意图分析')
    }
    const input = await ctx.request.validateUsing(analyzeProjectIntentValidator)
    const trizInput = await ctx.request
      .validateUsing(trizClarificationAnswersValidator)
      .catch(() => ({ trizAnswers: undefined }))
    return {
      user,
      organizationId,
      input,
      trizAnswers: trizInput?.trizAnswers,
      projectId: Number(ctx.request.param('projectId') ?? ctx.request.input('projectId')),
      requestId: ctx.request.id() ?? null,
    }
  }

  private async analyzeWithLiveOutput(ctx: HttpContext, liveId: string | null) {
    const args = await this.prepareAnalysis(ctx)
    return ctx.response.ok({ data: await this.analysisWork.analyze({ ...args, liveId }) })
  }

  /** 返回 202，模型在 HTTP 请求之外执行；重复提交找回同一任务。 */
  async analyzeJob(ctx: HttpContext) {
    const args = await this.prepareAnalysis(ctx)
    const { requestKey } = await ctx.request.validateUsing(analysisJobRequestValidator)
    const liveId = this.claimLiveOutput(ctx)
    const job = await analysisJobs.submit({
      owner: { organizationId: args.organizationId, userId: args.user.id },
      requestKey,
      kind: 'intent',
      input: {
        input: args.input,
        trizAnswers: args.trizAnswers,
        projectId: args.projectId || null,
      },
      liveOutputId: liveId,
      run: async (signal) => {
        try {
          return await this.analysisWork.analyze({ ...args, liveId, signal })
        } finally {
          if (liveId) liveOutputHub.close(liveId)
        }
      },
    })
    if (liveId && job.liveOutputId !== liveId) liveOutputHub.close(liveId)
    return ctx.response.accepted({ data: job })
  }

  async showAnalysisJob(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId || !(await this.policy.analyze(user, organizationId))) {
      throw new PermissionDeniedException('无权读取 AI 分析任务')
    }
    const { jobId } = await ctx.request.validateUsing(analysisJobIdValidator, {
      data: { jobId: ctx.params.id },
    })
    return ctx.response.ok({
      data: await analysisJobs.show({ organizationId, userId: user.id }, jobId),
    })
  }

  /**
   * POST /api/v1/ai/project-intents/brief —— 长需求整理（超过 8,000 字时前端先调用，结果给用户确认）。
   * 只读：不写 ledger、不落库；带 liveOutputId 时实时推送整理过程。
   */
  async brief(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId) throw new PermissionDeniedException('缺少组织上下文')
    if (!(await this.policy.analyze(user, organizationId))) {
      throw new PermissionDeniedException('无权使用 AI 项目意图分析')
    }
    const input = await ctx.request.validateUsing(requirementBriefValidator)
    const liveId = this.claimLiveOutput(ctx)
    try {
      const resolved = await resolveAdapter({
        connectionId: input.connectionId,
        modelId: input.modelId,
        organizationId,
        requiredCapabilities: ['chat'],
        estimatedTokens: Math.round(input.rawInput.length * 1.5),
        recordContext: {
          organizationId,
          userId: user.id,
          connectionId: input.connectionId ?? null,
          modelId: input.modelId ?? null,
          capability: 'chat',
          surface: 'ai-create-requirement-brief',
          workflowName: 'ai-project-requirement-brief',
          source: 'user',
        },
      })
      assertAiConnectionAvailable(resolved)
      const brief = await buildRequirementBrief({
        rawInput: input.rawInput,
        gateway: liveOutputGateway(resolved.gateway, liveId),
      })
      return ctx.response.ok({ data: { brief, rawLength: input.rawInput.length } })
    } catch (error) {
      if (error instanceof AiConnectionRequiredException) throw error
      ctx.logger.warn({ err: error }, '需求整理失败')
      return ctx.response.status(502).send({
        error: {
          code: 'AI_SERVICE_ERROR',
          message: error instanceof Error ? error.message : '需求整理失败，请稍后重试',
        },
      })
    } finally {
      if (liveId) liveOutputHub.close(liveId)
    }
  }

  /**
   * 需求附件读成文字（Word / PDF / 文本 / 图片）。只返回文字给前端放进输入框，不落库；
   * 图片与扫描件按「OCR 模型 → 当前模型（若能看图）→ 组织里能看图的模型」的顺序识别。
   */
  async attachment(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId) throw new PermissionDeniedException('缺少组织上下文')
    if (!(await this.policy.analyze(user, organizationId))) {
      throw new PermissionDeniedException('无权使用 AI 项目意图分析')
    }
    const input = await ctx.request.validateUsing(requirementAttachmentValidator)
    const bytes = new Uint8Array(Buffer.from(input.dataBase64, 'base64'))
    const ocrCandidates = async (): Promise<OcrCandidate[]> => {
      const recordContext = {
        organizationId,
        userId: user.id,
        capability: 'ocr',
        surface: 'ai-create-requirement-attachment',
        workflowName: 'ai-project-requirement-attachment',
        source: 'user' as const,
      }
      const seeing: AiModelCapability[] = ['vision', 'document_understanding']
      const attempts: Array<Parameters<typeof resolveAdapter>[0]> = [
        { organizationId, requiredCapabilities: ['ocr'], recordContext },
        ...(input.connectionId
          ? [
              {
                organizationId,
                connectionId: input.connectionId,
                modelId: input.modelId,
                requiredCapabilities: seeing,
                recordContext,
              },
            ]
          : []),
        { organizationId, requiredCapabilities: seeing, recordContext },
      ]
      const seen = new Set<string>()
      const candidates: OcrCandidate[] = []
      for (const attempt of attempts) {
        const resolved = await resolveAdapter(attempt).catch(() => null)
        if (!resolved || resolved.unavailable || resolved.source !== 'user') continue
        const key = `${resolved.connectionId}:${resolved.modelId}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({
          model: resolved.model,
          recognize: async (imageDataUrl) => {
            const result = await resolved.gateway.ocrPreview({
              imageDataUrl,
              promptHint: '这是一份项目需求材料，请完整转写其中的文字。',
              signal: AbortSignal.timeout(90_000),
            })
            if (!result.ok || !result.extractedText) {
              throw new Error(result.errorMessage ?? '识别失败')
            }
            return result.extractedText
          },
        })
      }
      return candidates
    }
    try {
      const data = await new RequirementAttachmentService().extract({
        fileName: input.fileName,
        bytes,
        ocrCandidates,
      })
      return ctx.response.ok({ data })
    } catch (error) {
      if (error instanceof AttachmentError) {
        return ctx.response.status(error.code === 'READ_FAILED' ? 502 : 422).send({
          error: { code: `ATTACHMENT_${error.code}`, message: error.message },
        })
      }
      throw error
    }
  }

  /**
   * 「我不了解这道题」的流式解释（SSE）。
   *
   * 只读：用 consume（非 mutation）校验会话令牌，不推进澄清、不写 ledger、不落库，
   * 因此用户在这里问什么都不会被记成答案。审计只记低敏元数据。
   */
  async explain(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId) throw new PermissionDeniedException('缺少组织上下文')
    if (!(await this.policy.analyze(user, organizationId))) {
      throw new PermissionDeniedException('无权使用 AI 项目意图分析')
    }

    const input = await ctx.request.validateUsing(explainClarificationQuestionValidator)
    const session = this.adaptiveTokens.consume(input.adaptiveSessionToken, {
      organizationId,
      userId: user.id,
      rawInput: input.rawInput,
    })
    const conversation = session.conversation
    if (!conversation) throw new ValidationException('当前会话没有待解释的问题')
    const need = session.understanding.informationNeeds.find(
      (item) => item.id === conversation.activeNeedId,
    )
    if (!need) throw new ValidationException('当前问题与理解版本不一致，请重新载入')

    const resolved = await resolveAdapter({
      connectionId: input.connectionId,
      modelId: input.modelId,
      organizationId,
      requiredCapabilities: ['chat'],
      estimatedTokens: 1_400,
      recordContext: {
        organizationId,
        userId: user.id,
        connectionId: input.connectionId ?? null,
        modelId: input.modelId ?? null,
        capability: 'chat',
        surface: 'ai-create-question-explainer',
        workflowName: 'ai-project-question-explainer',
        source: 'user',
      },
    })
    assertAiConnectionAvailable(resolved)

    const raw = ctx.response.response
    const origin = ctx.request.header('origin')
    if (origin) {
      raw.setHeader('Access-Control-Allow-Origin', origin)
      raw.setHeader('Access-Control-Allow-Credentials', 'true')
      raw.setHeader('Vary', 'Origin')
    }
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache, no-transform')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('X-Accel-Buffering', 'no')
    raw.flushHeaders?.()

    const write = (event: string, payload: Record<string, unknown>) => {
      if (raw.destroyed || raw.writableEnded) return
      raw.write(`event: ${event}\n`)
      raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      const flush = (raw as typeof raw & { flush?: () => void }).flush
      if (typeof flush === 'function') flush.call(raw)
    }

    const abort = new AbortController()
    raw.on('close', () => abort.abort())
    try {
      for await (const delta of this.adaptiveClarification.explainQuestion({
        gateway: resolved.gateway,
        need,
        question: conversation.activeQuestion,
        rawInput: requirementTextForPrompt(input.rawInput, input.requirementBrief),
        ledger: session.ledger,
        history: input.history ?? [],
        userQuestion: input.question ?? '',
        signal: abort.signal,
      })) {
        if (raw.destroyed || raw.writableEnded) break
        write('explain.delta', { text: delta })
      }
      write('explain.done', {})
    } catch (error) {
      write('explain.failed', {
        errorCode: 'AI_SERVICE_ERROR',
        message: error instanceof Error ? error.message : '解释失败，请稍后重试',
      })
    } finally {
      if (!raw.writableEnded) raw.end()
    }
  }
}
