// v3-triz-contradiction-copilot W4 任务 4.2 —— 矛盾矩阵参数对只读投影（知识包查询端点底座）。
//
// 职责（tasks 4.2 + spec「矛盾矩阵交互网格件」第 2/4 条）：
// - 把 W1 的确定性检索 `searchByParameterPair(improving, worsening)` 投影为**只读** DTO：
//   参数对的中文名与 PM 释义、命中映射（场景 / 推荐原则编号 / 原则释义 / 解法要点 / 来源章节）；
// - 未收录的参数对返回**中性空结果**（`matched=false` + 中文中性提示），MUST NOT 报错、
//   MUST NOT 显示为错误（spec：空单元 MUST 中性提示）；
// - 编号越界 / 非整数同样走中性空结果（HTTP 层另有 422 入参校验，两处口径一致）。
//
// 边界：纯读、零写、零模型调用、零权限判定（权限由 Controller 的 Policy 承担），
// 不复制知识包全文（只投影命中的原则条目）。

import {
  getKnowledgePackMetadata,
  searchByParameterPair,
  type TrizKnowledgePackMetadata,
  type TrizParameterPairMapping,
} from './triz_knowledge_search_service.js'

/** 空单元的中性提示文案（spec：MUST NOT 显示为错误）。 */
export const TRIZ_GALLERY_MATRIX_EMPTY_HINT = '该组合暂无收录的推荐原则'

export interface TrizGalleryMatrixParameterRef {
  number: number
  displayName: string
  nameZh: string
  nameEn: string
  category: string
  pmMeaning: string
}

export interface TrizGalleryMatrixPrincipleRef {
  number: number
  displayName: string
  nameZh: string
  nameEn: string
  nameRu: string
  definition: string
  pmInterpretation: string
}

export interface TrizGalleryMatrixMapping {
  kind: TrizParameterPairMapping['kind']
  id: string
  title: string
  scenario: string
  principleNumbers: number[]
  recommendations: string[]
  /** 来源章节标注（RL-10 Provenance） */
  source: string
}

export interface TrizGalleryMatrixPrinciplesResult {
  improving: TrizGalleryMatrixParameterRef | null
  worsening: TrizGalleryMatrixParameterRef | null
  /** 是否命中至少一条映射 */
  matched: boolean
  /** 是否为空单元（中性提示同时给出，前端无需自行判断） */
  empty: boolean
  /** 中性提示（命中时为 null） */
  hint: string | null
  mappings: TrizGalleryMatrixMapping[]
  /** 命中映射涉及的推荐原则去重集合（按编号升序）；空单元为空数组 */
  principles: TrizGalleryMatrixPrincipleRef[]
  knowledgePack: TrizKnowledgePackMetadata
}

/**
 * 参数对 → 推荐原则投影（纯函数；同一输入恒等输出）。
 * 编号不在 1–39 或非整数时不抛错，返回中性空结果。
 */
export function projectMatrixPrinciples(
  improvingNumber: number,
  worseningNumber: number,
): TrizGalleryMatrixPrinciplesResult {
  const result = searchByParameterPair(improvingNumber, worseningNumber)

  const mappings: TrizGalleryMatrixMapping[] = result.mappings.map((mapping) => ({
    kind: mapping.kind,
    id: mapping.id,
    title: mapping.title,
    scenario: mapping.scenario,
    principleNumbers: [...mapping.principleNumbers],
    recommendations: [...mapping.recommendations],
    source: mapping.source,
  }))

  const byNumber = new Map<number, TrizGalleryMatrixPrincipleRef>()
  for (const mapping of result.mappings) {
    for (const principle of mapping.principles) {
      byNumber.set(principle.number, {
        number: principle.number,
        displayName: principle.displayName,
        nameZh: principle.nameZh,
        nameEn: principle.nameEn,
        nameRu: principle.nameRu,
        definition: principle.definition,
        pmInterpretation: principle.pmInterpretation,
      })
    }
  }

  return {
    improving: result.improving ? toParameterRef(result.improving) : null,
    worsening: result.worsening ? toParameterRef(result.worsening) : null,
    matched: result.matched,
    empty: !result.matched,
    hint: result.matched ? null : TRIZ_GALLERY_MATRIX_EMPTY_HINT,
    mappings,
    principles: [...byNumber.values()].sort((a, b) => a.number - b.number),
    knowledgePack: getKnowledgePackMetadata(),
  }
}

function toParameterRef(parameter: {
  number: number
  displayName: string
  nameZh: string
  nameEn: string
  category: string
  pmMeaning: string
}): TrizGalleryMatrixParameterRef {
  return {
    number: parameter.number,
    displayName: parameter.displayName,
    nameZh: parameter.nameZh,
    nameEn: parameter.nameEn,
    category: parameter.category,
    pmMeaning: parameter.pmMeaning,
  }
}
