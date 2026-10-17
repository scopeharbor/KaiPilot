/**
 * v2-5-code-repository-auto-linking —— 候选链接特性门禁配置。
 *
 * 默认关闭候选生成。关闭时不注册事件消费副作用，
 * 且现有手工外链创建和刷新完整可用。
 */

import env from '#start/env'

/**
 * 候选自动链接是否启用。
 * 默认 false（关闭），必须显式启用。
 * 关闭时：
 * - 不注册事件消费者
 * - 已存在的候选仍可查看和操作
 * - 手工外链创建和刷新不受影响
 */
export function isLinkCandidateEnabled(): boolean {
  return env.get('LINK_CANDIDATE_ENABLED', false)
}

/**
 * 前置依赖是否就绪（incoming foundation + GitHub OAuth）。
 * 候选生成需要 incoming foundation 和 GitHub 连接底座，
 * 但查看已存在的候选和手工外链不依赖此检查。
 */
export function isLinkCandidateDependencyReady(): boolean {
  // 只检查 candidate feature flag —— 前置 incoming foundation 由
  // 未来的事件消费者负责检查（D6: 全局/端点 kill switch）
  return isLinkCandidateEnabled()
}
