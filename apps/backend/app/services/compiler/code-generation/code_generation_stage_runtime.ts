/**
 * Stage-local runtime envelope for compiler code generation.
 *
 * This service is intentionally deterministic. It prepares the exact tools and
 * context visible to one stage, then validates provider tool calls/results
 * before any future executor is allowed to use them.
 */

import {
  CODE_GENERATION_STAGE_CATALOG,
  buildCodeGenerationContextPacket,
  buildCodeGenerationRuntimeFrame,
  normalizeAnthropicToolInvocation,
  normalizeOpenAIChatToolInvocation,
  normalizeOpenAIResponsesToolInvocation,
  validateCodeGenerationRuntimeFrame,
  validateCodeGenerationToolInvocation,
  validateCodeGenerationToolResult,
  type CodeCandidateBundleValidation,
  type CodeGenerationStageContextPacket,
  type CodeGenerationStageId,
  type CodeGenerationStageRuntimeFrame,
  type CodeGenerationToolInvocation,
  type CodeGenerationToolProvider,
  type CodeGenerationToolResult,
} from '@aiproj/types/compiler-code-generation'

export interface CodeGenerationRuntimeContextInput {
  summary?: string
  artifactRefs?: string[]
  evidenceRefs?: string[]
  tokenBudget?: number
  data?: Record<string, unknown>
}

export interface CodeGenerationRuntimeFrameInput {
  stageId: CodeGenerationStageId
  provider: CodeGenerationToolProvider
  runtimeSessionId: string
  context?: CodeGenerationRuntimeContextInput
}

export type ProviderToolCallInput =
  | {
      provider: 'openai_responses'
      item: Parameters<typeof normalizeOpenAIResponsesToolInvocation>[0]['item']
    }
  | {
      provider: 'openai_chat_compat'
      toolCall: Parameters<typeof normalizeOpenAIChatToolInvocation>[0]['toolCall']
    }
  | {
      provider: 'anthropic_messages'
      block: Parameters<typeof normalizeAnthropicToolInvocation>[0]['block']
    }

export interface CodeGenerationInvocationNormalizationResult {
  invocation?: CodeGenerationToolInvocation
  validation: CodeCandidateBundleValidation
}

export interface CodeGenerationRuntimeFrameSummary {
  runtimeSessionId: string
  provider: CodeGenerationToolProvider
  stageId: CodeGenerationStageId
  order: number
  phase: CodeGenerationStageRuntimeFrame['phase']
  contextScope: CodeGenerationStageContextPacket['scope']
  visibleToolIds: string[]
  parallelToolCalls: false
  requiresHumanReview: boolean
}

export class CodeGenerationStageRuntime {
  buildFrame(input: CodeGenerationRuntimeFrameInput): CodeGenerationStageRuntimeFrame {
    const contextPacket = buildCodeGenerationContextPacket({
      stageId: input.stageId,
      summary: input.context?.summary,
      artifactRefs: input.context?.artifactRefs,
      evidenceRefs: input.context?.evidenceRefs,
      tokenBudget: input.context?.tokenBudget,
      data: input.context?.data,
    })
    return buildCodeGenerationRuntimeFrame({
      stageId: input.stageId,
      provider: input.provider,
      runtimeSessionId: input.runtimeSessionId,
      contextPacket,
    })
  }

  buildAllFrames(params: {
    provider: CodeGenerationToolProvider
    runtimeSessionIdPrefix: string
  }): CodeGenerationStageRuntimeFrame[] {
    return CODE_GENERATION_STAGE_CATALOG.map((stageDef) =>
      this.buildFrame({
        stageId: stageDef.id,
        provider: params.provider,
        runtimeSessionId: `${params.runtimeSessionIdPrefix}:${stageDef.id}`,
      }),
    )
  }

  validateFrame(frame: CodeGenerationStageRuntimeFrame): CodeCandidateBundleValidation {
    return validateCodeGenerationRuntimeFrame(frame)
  }

  normalizeInvocation(
    frame: CodeGenerationStageRuntimeFrame,
    raw: ProviderToolCallInput,
    seenCallIds: readonly string[] = [],
  ): CodeGenerationInvocationNormalizationResult {
    if (raw.provider !== frame.provider) {
      return {
        validation: {
          ok: false,
          reasonCodes: ['CODEGEN_TOOL_CALL_INVALID'],
          violations: [`provider ${raw.provider} does not match active frame ${frame.provider}`],
        },
      }
    }

    try {
      const invocation =
        raw.provider === 'openai_responses'
          ? normalizeOpenAIResponsesToolInvocation({
              runtimeSessionId: frame.runtimeSessionId,
              stageId: frame.stageId,
              item: raw.item,
            })
          : raw.provider === 'openai_chat_compat'
            ? normalizeOpenAIChatToolInvocation({
                runtimeSessionId: frame.runtimeSessionId,
                stageId: frame.stageId,
                toolCall: raw.toolCall,
              })
            : normalizeAnthropicToolInvocation({
                runtimeSessionId: frame.runtimeSessionId,
                stageId: frame.stageId,
                block: raw.block,
              })
      return {
        invocation,
        validation: validateCodeGenerationToolInvocation(frame, invocation, seenCallIds),
      }
    } catch (error) {
      return {
        validation: {
          ok: false,
          reasonCodes: ['CODEGEN_TOOL_CALL_INVALID'],
          violations: [error instanceof Error ? error.message : 'invalid provider tool call'],
        },
      }
    }
  }

  validateResult(
    frame: CodeGenerationStageRuntimeFrame,
    invocation: CodeGenerationToolInvocation,
    result: CodeGenerationToolResult,
  ): CodeCandidateBundleValidation {
    return validateCodeGenerationToolResult(frame, invocation, result)
  }

  summarizeFrame(frame: CodeGenerationStageRuntimeFrame): CodeGenerationRuntimeFrameSummary {
    return {
      runtimeSessionId: frame.runtimeSessionId,
      provider: frame.provider,
      stageId: frame.stageId,
      order: frame.order,
      phase: frame.phase,
      contextScope: frame.contextPacket.scope,
      visibleToolIds: frame.visibleTools.map((tool) => tool.toolId),
      parallelToolCalls: frame.providerTools.parallelToolCalls,
      requiresHumanReview: frame.requiresHumanReview,
    }
  }
}

export function createCodeGenerationStageRuntime(): CodeGenerationStageRuntime {
  return new CodeGenerationStageRuntime()
}
