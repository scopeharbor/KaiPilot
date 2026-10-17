/**
 * v2-5-compiler-run-executor-wiring —— Orchestrator 工厂。
 *
 * 提供创建已预注册 production handler 的 CompilerRunOrchestrator 实例的能力。
 * 用于不通过容器注入的场景（如 controller 直接使用）。
 */
import { StageRegistry } from './stage_registry.js'
import { ArtifactStore } from './artifact_store.js'
import { StageEventLogger } from './stage_event_logger.js'
import { CompilerRunOrchestrator } from './compiler_run_orchestrator.js'
import { registerProductionHandlers } from './production_handlers.js'

/**
 * 创建一个已注册 production handler 的 Orchestrator 单例。
 */
let instance: CompilerRunOrchestrator | null = null

export function createOrchestrator(): CompilerRunOrchestrator {
  if (!instance) {
    const registry = new StageRegistry()
    const artifactStore = new ArtifactStore()
    const stageEventLogger = new StageEventLogger()
    instance = new CompilerRunOrchestrator(registry, artifactStore, stageEventLogger)
    registerProductionHandlers(instance)
  }
  return instance
}

/**
 * 重置单例（主要用于测试）。
 */
export function resetOrchestrator(): void {
  instance = null
}
