/**
 * v3-skill-knowledge-authoring —— KnowledgeSourceProvider 抽象接口 + Fixture 实现（D6）。
 *
 * 抽象知识源查询接口，四层底座未落地时用 fixture provider 提供确定性引用。
 * 底座 apply 后提供 FourLayerKnowledgeSourceProvider 接线，不阻塞本 change。
 */
import type { KnowledgeSourceRef } from '@aiproj/types'

/** 知识源查询参数。 */
export interface KnowledgeSourceQuery {
  /** 四层底座 layer（L1/L2/L3/L4）。 */
  layer?: string
  /** 领域标签。 */
  domain?: string
  /** 用途。 */
  purpose?: string
  /** 项目复杂度。 */
  complexity?: number
}

/**
 * 知识源提供者抽象接口。
 *
 * 实现方负责从四层底座（或其他知识源）查询匹配的知识条目引用。
 */
export interface KnowledgeSourceProvider {
  query(params: KnowledgeSourceQuery): Promise<KnowledgeSourceRef[]>
}

/**
 * Fixture 知识源提供者 —— 确定性、未联网、零外部依赖。
 *
 * 相同查询参数返回相同结果（确定性），供默认注入。
 */
export class FixtureKnowledgeSourceProvider implements KnowledgeSourceProvider {
  async query(params: KnowledgeSourceQuery): Promise<KnowledgeSourceRef[]> {
    const domain = params.domain ?? 'general'
    const layer = params.layer ?? 'L2'

    // 确定性 fixture：每个查询返回固定的引用集
    return [
      {
        layer,
        sourceId: `fixture-${domain}-001`,
        section: 'summary',
        manual: false,
      },
      {
        manual: true,
      },
    ]
  }
}
