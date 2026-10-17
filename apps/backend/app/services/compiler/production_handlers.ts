/**
 * v2-5-compiler-run-executor-wiring —— 生产 handler 注册（tasks 2.3）。
 *
 * 为 CompilerRunOrchestrator 注册 V2 已实现且可生产使用的 handler。
 * 未实现的 stage 必须 fail-fast，禁止 silent skip 或 stub success。
 *
 * design D3：显式、封闭、fail-fast。
 * 当前注册 3 个 production handler：
 * - intent_ingestion（deterministic）
 * - intent_parsing（llm——mock 版本，真实 AIGateway 集成属后续 change）
 * - dag_stub（deterministic）
 *
 * ⚠️ handleIntentParsingMock 当前返回 mock 结果。
 * 真实 AIGateway 集成在 v2-5-ai-draft-live-sse-transport 及其他后续 change 中完成。
 */
import type { CompilerRunOrchestrator, HandlerRegistration } from './compiler_run_orchestrator.js'
import {
  intentIngestionDefinition,
  handleIntentIngestion,
} from './stages/intent_ingestion_stage.js'
import { intentParsingDefinition, handleIntentParsingMock } from './stages/intent_parsing_stage.js'
import { dagStubDefinition, handleDagStub } from './stages/dag_stub_stage.js'

/**
 * 当前可生产使用的 production handlers。
 * 数组顺序不重要——orchestrator 按 stageId 索引。
 */
export const PRODUCTION_HANDLERS: HandlerRegistration[] = [
  {
    definition: intentIngestionDefinition,
    handler: handleIntentIngestion as HandlerRegistration['handler'],
  },
  {
    definition: intentParsingDefinition,
    handler: handleIntentParsingMock as HandlerRegistration['handler'],
  },
  {
    definition: dagStubDefinition,
    handler: handleDagStub as HandlerRegistration['handler'],
  },
]

/**
 * 向 orchestrator 注册所有 production handler。
 *
 * 在 AdonisJS 的 composition root（start/*）中调用一次。
 */
export function registerProductionHandlers(orchestrator: CompilerRunOrchestrator): void {
  orchestrator.registerHandlers(PRODUCTION_HANDLERS)
}

/**
 * 获取 production handler 的 stageId 列表。
 */
export function getProductionStageIds(): string[] {
  return PRODUCTION_HANDLERS.map((r) => r.definition.stageId)
}

export { PRODUCTION_HANDLERS as HANDLERS }
