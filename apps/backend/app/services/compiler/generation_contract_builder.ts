/**
 * GenerationContractBuilder —— 从已验证 Blueprint/PDM 上游产物确定性生成 Contract。
 *
 * Contract 必须由确定性 Compiler 从上游产物生成（零 LLM），
 * 包含预期实体、实体数量、父子/依赖关系、质量门禁、版本、来源引用与内容 hash。
 * LLM Stage 禁止创建、修改或补写 Contract。
 *
 * @aiproj/compiler-spec
 */

import { createHash } from 'node:crypto'
import type { ExpectedEntity, GenerationContract, Relationship } from '@aiproj/compiler-spec'

export interface BlueprintEntity {
  entityId: string
  entityType: ExpectedEntity['entityType']
  label: string
  parentId?: string
  required?: boolean
  children?: BlueprintEntity[]
  dependsOn?: string[]
}

export interface BlueprintInput {
  runId: number
  contractVersion: number
  entities: BlueprintEntity[]
  relationships?: Array<{
    type: Relationship['type']
    sourceEntityId: string
    targetEntityId: string
    description?: string
  }>
}

export class ContractBuilderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContractBuilderError'
  }
}

/**
 * GenerationContractBuilder —— 从 Blueprint/PDM 上游产物确定性生成 Contract。
 *
 * - 只处理结构信息（应该有什么），不生成内容
 * - 通过 BFS 递归提取实体树，自动推导父子关系与数量约束
 * - 计算 content hash 用于版本检测
 * - 每次生成新版本，禁止原地覆盖
 */
export class GenerationContractBuilder {
  /**
   * 从 Blueprint 输入生成 GenerationContract。
   *
   * @param input     Blueprint 输入（实体树 + 关系）
   * @returns         完整的 GenerationContract
   */
  build(input: BlueprintInput): GenerationContract {
    if (input.entities.length === 0) {
      throw new ContractBuilderError('At least one entity is required')
    }

    const expectedEntities: ExpectedEntity[] = []
    const relationships: Relationship[] = []
    const entityCounts = new Map<string, number>()

    // BFS 展开实体树，计算每层数量
    this.#flattenEntities(input.entities, undefined, expectedEntities, entityCounts)

    // 自动推导 parent_child 关系
    for (const entity of input.entities) {
      this.#deriveRelationships(entity, relationships)
    }

    // 添加外部定义的关系
    for (const rel of input.relationships ?? []) {
      relationships.push({
        type: rel.type,
        sourceEntityId: rel.sourceEntityId,
        targetEntityId: rel.targetEntityId,
        cardinality: 'one_to_many',
        description: rel.description ?? '',
      })
    }

    // 构建 Contract 对象（不含 hash）
    const contractData = {
      meta: {
        schemaVersion: '2.0',
        contractVersion: input.contractVersion,
        generatedAt: new Date().toISOString(),
        sourceRunId: input.runId,
      },
      sourceRefs: {
        blueprintHash: this.#computeBlueprintHash(input),
      },
      expectedEntities,
      relationships,
      qualityGates: this.#defaultQualityGates(),
      contentHash: '', // placeholder
    }

    // 计算 content hash
    contractData.contentHash = this.#computeContentHash(contractData)

    return contractData as GenerationContract
  }

  /**
   * 检测 Contract 两个版本间的差异。
   * 用于版本化重编译时记录变更。
   */
  diff(
    previous: GenerationContract,
    current: GenerationContract,
  ): {
    added: string[]
    removed: string[]
    modified: string[]
    changedRelationships: string[]
  } {
    const prevIds = new Set(previous.expectedEntities.map((e) => e.entityId))
    const currIds = new Set(current.expectedEntities.map((e) => e.entityId))

    const added = [...currIds].filter((id) => !prevIds.has(id))
    const removed = [...prevIds].filter((id) => !currIds.has(id))
    const modified: string[] = []

    for (const curr of current.expectedEntities) {
      if (prevIds.has(curr.entityId)) {
        const prev = previous.expectedEntities.find((e) => e.entityId === curr.entityId)
        if (
          prev &&
          (prev.label !== curr.label ||
            prev.minCount !== curr.minCount ||
            prev.maxCount !== curr.maxCount)
        ) {
          modified.push(curr.entityId)
        }
      }
    }

    return { added, removed, modified, changedRelationships: [] }
  }

  /**
   * 校验一个蓝图的实体列表是否可以生成合法 Contract。
   * 不抛出异常，返回错误集合。
   */
  validate(input: BlueprintInput): string[] {
    const errors: string[] = []
    if (input.entities.length === 0) {
      errors.push('At least one entity is required')
    }

    const seenIds = new Set<string>()
    for (const entity of input.entities) {
      if (seenIds.has(entity.entityId)) {
        errors.push(`Duplicate entity ID: ${entity.entityId}`)
      }
      seenIds.add(entity.entityId)

      if (!entity.label || entity.label.trim().length === 0) {
        errors.push(`Entity ${entity.entityId} has no label`)
      }
    }

    return errors
  }

  /**
   * 深度校验 Contract 是否与 Manifest 一致。
   * Contract 中的每个 expected entity 必须在 Manifest 中有对应实体。
   */
  validateContractAgainstManifest(
    contract: GenerationContract,
    manifestEntityIds: string[],
  ): { missing: string[]; extra: string[] } {
    const contractIds = new Set(contract.expectedEntities.map((e) => e.entityId))
    const manifestIds = new Set(manifestEntityIds)

    const missing = [...contractIds].filter((id) => !manifestIds.has(id))
    const extra = [...manifestIds].filter((id) => !contractIds.has(id))

    return { missing, extra }
  }

  // ── Private Helpers ──

  /** BFS 展开实体树。 */
  #flattenEntities(
    entities: BlueprintEntity[],
    parentId: string | undefined,
    result: ExpectedEntity[],
    counts: Map<string, number>,
  ): void {
    for (const entity of entities) {
      const type = entity.entityType
      const count = (counts.get(type) ?? 0) + 1
      counts.set(type, count)

      result.push({
        entityType: type,
        entityId: entity.entityId,
        label: entity.label,
        minCount: entity.required !== false ? 1 : 0,
        maxCount: 1,
        parentRef: parentId,
        required: entity.required !== false,
      })

      if (entity.children && entity.children.length > 0) {
        this.#flattenEntities(entity.children, entity.entityId, result, counts)
      }
    }
  }

  /** 递归推导父子关系。 */
  #deriveRelationships(entity: BlueprintEntity, relationships: Relationship[]): void {
    if (entity.children) {
      for (const child of entity.children) {
        relationships.push({
          type: 'parent_child',
          sourceEntityId: entity.entityId,
          targetEntityId: child.entityId,
          cardinality: 'one_to_many',
          description: `${entity.label} → ${child.label}`,
        })

        if (child.dependsOn) {
          for (const dep of child.dependsOn) {
            relationships.push({
              type: 'dependency',
              sourceEntityId: child.entityId,
              targetEntityId: dep,
              cardinality: 'one_to_one',
              description: `${child.label} 依赖 ${dep}`,
            })
          }
        }

        this.#deriveRelationships(child, relationships)
      }
    }

    if (entity.dependsOn) {
      for (const dep of entity.dependsOn) {
        relationships.push({
          type: 'dependency',
          sourceEntityId: entity.entityId,
          targetEntityId: dep,
          cardinality: 'one_to_one',
          description: `${entity.label} 依赖 ${dep}`,
        })
      }
    }
  }

  /** 默认质量门禁。 */
  #defaultQualityGates() {
    return [
      {
        gateId: 'schema_validation',
        gateType: 'schema_validation' as const,
        description: '实体必须通过 zod schema 校验',
        required: true,
        config: {},
      },
      {
        gateId: 'contract_match',
        gateType: 'contract_validation' as const,
        description: '生成输出必须与 Contract 实体定义一致',
        required: true,
        config: {},
      },
      {
        gateId: 'reference_integrity',
        gateType: 'reference_integrity' as const,
        description: '实体间引用关系必须完整',
        required: true,
        config: {},
      },
    ]
  }

  /** 计算 Blueprint 输入的 hash（用于 source ref）。 */
  #computeBlueprintHash(input: BlueprintInput): string {
    const serialized = JSON.stringify({
      entities: input.entities.map((e) => ({ id: e.entityId, type: e.entityType, label: e.label })),
      relationships: input.relationships,
    })
    return createHash('sha256').update(serialized, 'utf-8').digest('hex')
  }

  /** 计算 Contract 内容的 hash。 */
  #computeContentHash(contract: {
    meta: { contractVersion: number }
    expectedEntities: { entityType: string; entityId: string; minCount: number; maxCount: number }[]
    relationships: { type: string; sourceEntityId: string; targetEntityId: string }[]
    qualityGates: { gateId: string }[]
    sourceRefs: { blueprintHash: string }
  }): string {
    // 只用稳定字段（排除 generatedAt 时间戳抖动）
    const stable = {
      v: contract.meta.contractVersion,
      e: contract.expectedEntities
        .map((e) => `${e.entityType}:${e.entityId}:${e.minCount}:${e.maxCount}`)
        .sort(),
      r: contract.relationships
        .map((r) => `${r.type}:${r.sourceEntityId}:${r.targetEntityId}`)
        .sort(),
      g: contract.qualityGates.map((g) => g.gateId).sort(),
      s: contract.sourceRefs.blueprintHash,
    }
    const serialized = JSON.stringify(stable)
    return createHash('sha256').update(serialized, 'utf-8').digest('hex')
  }
}
