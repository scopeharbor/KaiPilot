import type { ConfirmedProjectContext } from '@aiproj/types'
import { resolveAdapter } from '#services/ai_m0/resolver'
import { assertAiConnectionAvailable } from '#services/ai_m0/ai_connection_requirement'
import { generatePlanUnderstanding } from './plan_understanding.js'
import { streamCallToLiveOutput, liveOutputHub } from '#services/ai_live_output/live_output_hub'

export async function analyzePlanUnderstanding(args: {
  userId: number
  organizationId: number
  context: ConfirmedProjectContext
  connectionId?: number
  modelId?: number
  liveId: string | null
  signal?: AbortSignal
}) {
  const { context, liveId } = args
  let seq = 0
  try {
    const resolved = await resolveAdapter({
      connectionId: args.connectionId,
      modelId: args.modelId,
      organizationId: args.organizationId,
      requiredCapabilities: ['project_draft', 'chat'],
      recordContext: {
        organizationId: args.organizationId,
        userId: args.userId,
        connectionId: args.connectionId ?? null,
        modelId: args.modelId ?? null,
        capability: 'project_draft',
        surface: 'ai-create-draft',
        workflowName: 'project-plan-understanding',
      },
    })
    assertAiConnectionAvailable(resolved)
    const understanding = await generatePlanUnderstanding({
      context,
      call: async ({ prompt, promptName, sentence }) => {
        args.signal?.throwIfAborted()
        await resolved.throttle?.(Math.max(1, Math.ceil(context.rawInput.length / 4) + 2_000))
        return streamCallToLiveOutput(
          liveId,
          sentence,
          String(++seq),
          async (onText, onReasoning) => {
            let rawText = ''
            for await (const chunk of resolved.gateway.stream({
              sentence,
              promptSet: prompt,
              strategy: 'prompt',
              maxOutputTokens: 262_144,
              signal: args.signal,
              attemptNumber: 1,
              promptName,
            })) {
              if (chunk.kind === 'error') throw new Error(chunk.errorKind ?? 'adapter_stream_error')
              if (chunk.kind === 'text' && chunk.text) {
                rawText += chunk.text
                onText(chunk.text)
              }
              if (chunk.kind === 'reasoning' && chunk.text) onReasoning(chunk.text)
            }
            return rawText
          },
          resolved.model,
        )
      },
    })
    return { understanding, context }
  } finally {
    if (liveId) liveOutputHub.close(liveId)
  }
}
