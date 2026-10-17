/**
 * Fixture provider：为 34 阶段候选流水线产出 **provider 原生形状** 的 tool call。
 *
 * 刻意不直接构造已归一化的 `CodeGenerationToolInvocation`——那样会绕过
 * OpenAI / Anthropic 三种归一化函数与工具白名单校验，正是本 change 要消除的
 * 「代码存在但从未被执行」状态。
 *
 * 本 provider 不发起网络请求、不调用模型、不写文件、不起子进程。
 */

import {
  getCodeGenerationStageDefinition,
  type CodeGenerationStageRuntimeFrame,
  type CodeGenerationToolId,
  type CodeGenerationToolInvocation,
  type CodeGenerationToolResult,
} from '@aiproj/types/compiler-code-generation'
import type { ProviderToolCallInput } from './code_generation_stage_runtime.js'

/**
 * 候选运行的产出源。Runner 只依赖这个窄接口，因此测试可以注入越权 / 跨 stage /
 * 带副作用的实现来验证 Runner 的停机行为，而无需在生产代码里留测试钩子。
 */
export interface CodegenCandidateProvider {
  produceRawToolCall(frame: CodeGenerationStageRuntimeFrame): ProviderToolCallInput
  produceToolResult(
    frame: CodeGenerationStageRuntimeFrame,
    invocation: CodeGenerationToolInvocation,
  ): CodeGenerationToolResult
}

/** 确定性偏好序：优先产物类工具，回落到该 stage 的第一个可见工具。 */
const TOOL_PREFERENCE: CodeGenerationToolId[] = [
  'write_candidate_artifact',
  'compose_review_packet',
  'request_human_review',
]

export class CodegenFixtureProvider implements CodegenCandidateProvider {
  /** 只从当前 frame 的可见工具里挑，绝不从 catalog 全集或其他 stage 挑。 */
  selectToolId(frame: CodeGenerationStageRuntimeFrame): CodeGenerationToolId {
    const visible = frame.visibleTools.map((tool) => tool.toolId)
    const preferred = TOOL_PREFERENCE.find((toolId) => visible.includes(toolId))
    const selected = preferred ?? visible[0]
    if (!selected) throw new Error(`stage ${frame.stageId} exposes no visible tool`)
    return selected
  }

  /** 确定性 callId：同一 session 同一 stage 恒定，且天然不与既有 callId 冲突。 */
  buildCallId(frame: CodeGenerationStageRuntimeFrame): string {
    return `${frame.runtimeSessionId}:${frame.stageId}:1`
  }

  produceRawToolCall(frame: CodeGenerationStageRuntimeFrame): ProviderToolCallInput {
    const toolId = this.selectToolId(frame)
    const callId = this.buildCallId(frame)
    // 仅低敏字段；不含 prompt / rawOutput / token / secret / authorization / apiKey
    const args = {
      stageId: frame.stageId,
      artifactRef: candidateArtifactRef(frame),
      note: `fixture candidate for ${frame.stageId}`,
    }

    switch (frame.provider) {
      case 'openai_responses':
        return {
          provider: 'openai_responses',
          item: {
            type: 'function_call',
            call_id: callId,
            name: toolId,
            arguments: JSON.stringify(args),
          },
        }
      case 'openai_chat_compat':
        return {
          provider: 'openai_chat_compat',
          toolCall: {
            id: callId,
            type: 'function',
            function: { name: toolId, arguments: JSON.stringify(args) },
          },
        }
      case 'anthropic_messages':
        return {
          provider: 'anthropic_messages',
          block: { type: 'tool_use', id: callId, name: toolId, input: args },
        }
      default: {
        const exhaustive: never = frame.provider
        throw new Error(`unsupported provider: ${String(exhaustive)}`)
      }
    }
  }

  produceToolResult(
    frame: CodeGenerationStageRuntimeFrame,
    invocation: CodeGenerationToolInvocation,
  ): CodeGenerationToolResult {
    const definition = getCodeGenerationStageDefinition(frame.stageId)
    return {
      runtimeSessionId: frame.runtimeSessionId,
      stageId: frame.stageId,
      callId: invocation.callId,
      toolId: invocation.toolId,
      ok: true,
      // candidate-only：候选产物引用，不是仓库路径，不落盘
      artifactRefs: [candidateArtifactRef(frame)],
      summary: `${frame.stageId} 候选产物已生成（${definition?.artifactKind ?? 'unknown'}），待人工复核`,
      sideEffectKind: 'none',
      metadata: {
        observationRefs: [`codegen-observation://${frame.runtimeSessionId}/${frame.stageId}`],
      },
    }
  }
}

function candidateArtifactRef(frame: CodeGenerationStageRuntimeFrame): string {
  return `codegen-candidate://${frame.runtimeSessionId}/${frame.stageId}`
}

export function createCodegenFixtureProvider(): CodegenFixtureProvider {
  return new CodegenFixtureProvider()
}
