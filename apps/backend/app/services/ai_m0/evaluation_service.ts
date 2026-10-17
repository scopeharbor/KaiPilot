import AiConnection from '#models/ai_connection'
import CryptoService from '#services/crypto_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import {
  type AiM0EvaluationMode,
  type AiM0EvaluationOutcome,
  type AiM0Strategy,
} from '@aiproj/types'
import { buildAdapter } from './adapter_factory.ts'
import { AIGateway } from './gateway.ts'
import { MockAdapter } from './mock_adapter.ts'
import { AI_M0_INPUT_CASES, hashInputCases } from './inputs.ts'
import { resolveStrategy } from '../ai_connection_service.ts'
import { draftJsonSchemaForStrategy } from './schema.ts'
import { judgeOutcome } from './judge.ts'

export interface ExecuteEvaluationInput {
  stepId: string
  inputId: string
  requestedStrategy: AiM0Strategy
  repetition: number
  mode: AiM0EvaluationMode
  connectionId?: number | null
}

@inject()
export default class AiM0EvaluationService {
  constructor(private crypto: CryptoService) {}

  async execute(
    organizationId: number,
    input: ExecuteEvaluationInput,
  ): Promise<AiM0EvaluationOutcome> {
    const inputCase = AI_M0_INPUT_CASES.find((item) => item.id === input.inputId)
    if (!inputCase) throw new ValidationException('评测输入不存在')

    let gateway: AIGateway
    let effectiveStrategy = input.requestedStrategy
    let connectionId: string | null = null

    if (input.mode === 'dry_run') {
      gateway = new AIGateway(new MockAdapter())
    } else {
      if (!input.connectionId) throw new ValidationException('真实评测必须选择 AI 连接')
      const connection = await AiConnection.query()
        .where('id', input.connectionId)
        .where('organization_id', organizationId)
        .first()
      if (!connection) throw new ResourceNotFoundException('AI 连接不存在')
      if (!connection.isActive) throw new ValidationException('AI 连接已停用')
      if (!connection.apiKeyEncrypted) throw new ValidationException('AI 连接尚未设置 API key')
      if (!connection.lastTestedAt) throw new ValidationException('请先测试 AI 连接')

      effectiveStrategy = resolveStrategy(input.requestedStrategy, connection.capabilities)
      const adapter = buildAdapter(connection.protocol, {
        apiKey: this.crypto.decrypt(connection.apiKeyEncrypted),
        model: connection.model,
        baseURL: connection.baseUrl,
        providerName:
          connection.protocol === 'openai_compatible'
            ? 'openai-compatible'
            : 'anthropic-compatible',
      })
      gateway = new AIGateway(adapter)
      connectionId = String(connection.id)
    }

    const result = await gateway.generate({
      sentence: inputCase.sentence,
      strategy: effectiveStrategy,
      temperature: 0,
      jsonSchema: draftJsonSchemaForStrategy(effectiveStrategy),
    })
    const judged = judgeOutcome({
      rawText: result.rawText,
      triggeredErrorsFromAdapter: result.triggeredErrors,
      expectedRequiredInferredFields: inputCase.expectedRequiredInferredFields,
    })
    const evidenceEligible =
      input.mode === 'real' &&
      result.usingRealAdapter &&
      effectiveStrategy === input.requestedStrategy &&
      judged.markerCoverage === 1

    return {
      stepId: input.stepId,
      inputId: input.inputId,
      inputSetHash: hashInputCases(),
      repetition: input.repetition,
      strategy: effectiveStrategy,
      requestedStrategy: input.requestedStrategy,
      effectiveStrategy,
      mode: input.mode,
      bucket: judged.bucket,
      firstTokenMs: result.firstTokenMs,
      totalMs: result.totalMs,
      retries: 0,
      triggeredErrors: judged.triggeredErrors,
      markerCoverage: judged.markerCoverage,
      outputTokens: result.outputTokens,
      provider: gateway.provider,
      model: gateway.model,
      connectionId,
      usingRealAdapter: result.usingRealAdapter,
      evidenceEligible,
      missingMarkerFields: judged.missingMarkerFields,
      appliedFixes: judged.appliedFixes,
      measuredAt: new Date().toISOString(),
    }
  }
}
