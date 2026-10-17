/**
 * v3-knowledge-memory-operating-layer —— 四个 read port 的默认工厂。
 *
 * 4 个 `@inject()` class 已经满足 D2「核心提供受控扩展点」与「不平行重造
 * Service」。本文件仅做：
 * - 一个轻 factory `createOperatingReadPortRegistry(deps)`：聚合器用，
 *   在 feature flag 开启时一次性构造 4 port。
 * - DI 友好的 DI token 导出（避免裸类名引用）。
 * - static「纯函数等价」no-op 单元测试桩（用于聚合器在 feature off 时短路）。
 *
 * @aiproj/backend
 */

import KnowledgeOperatingReadPort from './knowledge_port.js'
import CopilotMemoryOperatingReadPort from './memory_port.js'
import SkillKnowledgeDraftOperatingReadPort from './skill_draft_port.js'
import RetrievalSignalOperatingReadPort from './observation_port.js'
import type { OperatingReadPortRegistry } from './port.js'

export interface OperatingReadPortDeps {
  readonly knowledge: KnowledgeOperatingReadPort
  readonly memory: CopilotMemoryOperatingReadPort
  readonly skillDraft: SkillKnowledgeDraftOperatingReadPort
  readonly retrieval: RetrievalSignalOperatingReadPort
}

/** 把 4 port 装配成 registry（DI 容器或测试都可调用）。 */
export function createOperatingReadPortRegistry(
  deps: OperatingReadPortDeps,
): OperatingReadPortRegistry {
  return {
    knowledge: deps.knowledge,
    memory: deps.memory,
    skillDraft: deps.skillDraft,
    retrieval: deps.retrieval,
  }
}

/** DI token（字符串字面量，方便 Lucid 容器与单元测试 mock）。 */
export const OPERATING_READ_PORTS = {
  knowledge: 'service:knowledge-memory-operating/knowledge_port',
  memory: 'service:knowledge-memory-operating/memory_port',
  skillDraft: 'service:knowledge-memory-operating/skill_draft_port',
  retrieval: 'service:knowledge-memory-operating/observation_port',
} as const

export {
  KnowledgeOperatingReadPort,
  CopilotMemoryOperatingReadPort,
  SkillKnowledgeDraftOperatingReadPort,
  RetrievalSignalOperatingReadPort,
}
