/**
 * AI 连接解析的组织作用域（v3-personal-edition-open-source-export §D5）。
 *
 * 是否允许回退到「平台统一 AI 配置」组织，由版本扩展点 `platformAi` 决定：
 * - 私有部署（SaaS）：企业 provider 注册平台实现，free 组织按 `platform_ai_scope` 的规则
 *   决定自己的连接是否参与、可否回退平台统一配置；
 * - 个人版：没有平台实现，组织只用自己的连接（部署者可另配 `OPENAI_API_KEY` 作实例级默认）。
 */
import { editionHooks } from '#services/edition/edition_registry'
import type { AiConnectionScope } from '#services/edition/ports'

export type { AiConnectionScope }

/** 个人版语义：自己的连接参与，没有平台回退。 */
export const OWN_CONNECTIONS_ONLY: AiConnectionScope = Object.freeze({
  ownAllowed: true,
  platformOrganizationId: null,
})

export async function resolveAiConnectionScope(organizationId: number): Promise<AiConnectionScope> {
  const platformAi = editionHooks().platformAi
  if (!platformAi) return { ...OWN_CONNECTIONS_ONLY }
  return platformAi.resolveScope(organizationId)
}

/** 按解析优先级排列的候选组织：自己的（若允许）在前，平台统一配置在后。 */
export function candidateOrganizationIds(
  organizationId: number,
  scope: AiConnectionScope,
): number[] {
  const ids: number[] = []
  if (scope.ownAllowed) ids.push(organizationId)
  if (scope.platformOrganizationId !== null && !ids.includes(scope.platformOrganizationId)) {
    ids.push(scope.platformOrganizationId)
  }
  return ids
}
