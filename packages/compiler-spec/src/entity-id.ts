/**
 * v2-project-compiler-foundation —— Entity ID 类型与工具（design D10）。
 *
 * 规则：`<prefix><slug(name)[:30]>_<sha256(projectId + ":" + slug)[:8]>`
 * 同项目同名实体产生稳定 ID；改名产生新 ID；仅属性变更 ID 不变。
 */

import { createHash } from 'node:crypto'

/** PDM 中的实体类型。 */
export type EntityType =
  | 'workstream'
  | 'work_package'
  | 'task_l1'
  | 'task_l2'
  | 'milestone'
  | 'risk'
  | 'resource'
  | 'stakeholder'

/** Entity ID 前缀表（单字符前缀，人类可读）。 */
export const ENTITY_ID_PREFIX: Record<EntityType, string> = {
  workstream: 'W',
  work_package: 'P',
  task_l1: 'T1',
  task_l2: 'T2',
  milestone: 'M',
  risk: 'R',
  resource: 'RS',
  stakeholder: 'SH',
} as const

/**
 * 简单 slug 化：转小写 → 非字母数字替换为 `_` → 合并连续 `_` → 修剪首尾 `_`。
 */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * 生成 PDM 实体 ID。
 *
 * @param type    实体类型
 * @param name    实体名称（slug 后取前 30 字符）
 * @param projectId 项目标识（用于同项目稳定）
 * @returns 形如 `Wdesign_1a2b3c4d` 的实体 ID
 */
export function generateEntityId(type: EntityType, name: string, projectId: string): string {
  const prefix = ENTITY_ID_PREFIX[type]
  const nameSlug = slug(name).slice(0, 30)
  const hashInput = `${projectId}:${slug(name)}`
  const hash = createHash('sha256').update(hashInput, 'utf-8').digest('hex').slice(0, 8)
  return `${prefix}${nameSlug}_${hash}`
}

/**
 * 判断实体 ID 是否属于某类型。
 */
export function isEntityIdForType(id: string, type: EntityType): boolean {
  const prefix = ENTITY_ID_PREFIX[type]
  return id.startsWith(prefix) && id.includes('_')
}
