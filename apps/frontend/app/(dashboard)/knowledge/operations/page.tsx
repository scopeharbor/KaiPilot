'use client'

/**
 * v3-knowledge-memory-operating-layer —— 运营层别名路由。
 *
 * 规范要求的入口是 `/knowledge?view=operations`；本路由是等价别名，
 * 渲染同一个 `KnowledgeOperationsView`，因此两条入口不会出现行为漂移。
 */
import { KnowledgeOperationsView } from '@/components/knowledge/operating/KnowledgeOperationsView'

export default function KnowledgeOperationsAliasPage() {
  return <KnowledgeOperationsView />
}
