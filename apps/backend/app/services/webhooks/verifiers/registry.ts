/**
 * v2-5-provider-incoming-webhook-foundation —— verifier 注册表（design D2）。
 *
 * 按 provider 名解析签名 verifier。新增 provider = 注册一个 verifier，不改核心管线。
 * `fixture` verifier 仅供测试。
 */
import GithubWebhookVerifier from './github_verifier.js'
import FixtureWebhookVerifier from './fixture_verifier.js'
import type { WebhookProviderVerifier } from './interfaces.js'

const REGISTRY: Record<string, WebhookProviderVerifier> = {
  github: new GithubWebhookVerifier(),
  fixture: new FixtureWebhookVerifier(),
}

export function getWebhookVerifier(provider: string): WebhookProviderVerifier | null {
  return REGISTRY[provider] ?? null
}

export function isSupportedWebhookProvider(provider: string): boolean {
  return provider in REGISTRY
}
