/**
 * v3-docker-compose-runtime-foundation —— tasks 2.3/2.5
 * 版本锁定与 .env.compose.example 配置覆盖契约静态门禁。
 */
import { describe, expect, it } from 'vitest'
import { checkEnvComposeExample, checkVersionPins } from './compose_static_contract.js'

describe('版本锁定（task 2.3）', () => {
  it('Node LTS / Corepack pnpm / PG / Redis / edge 全部固定，无 latest/Bun', () => {
    const checks = checkVersionPins()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})

describe('配置覆盖契约（task 2.5）', () => {
  it('仅 edge 发布单一宿主端口，其余 network-only，覆盖字典无真实 secret', () => {
    const checks = checkEnvComposeExample()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})
