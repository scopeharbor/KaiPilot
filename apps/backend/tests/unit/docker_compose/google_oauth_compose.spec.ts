/**
 * v3-docker-google-oauth-runtime-wiring —— tasks 1.1/2.1/2.2
 * Google OAuth 接线静态合同（两栈公开回调 env + backend-only Compose secret +
 * 默认 tracked source/自定义 override + host 示例 + 镜像与输出零泄密）。
 */
import { describe, expect, it } from 'vitest'
import { checkGoogleOAuthWiring } from './compose_static_contract.js'

describe('Google OAuth Compose 接线（task 1.1/2.1/2.2）', () => {
  it('override/mount/backend-only env/parity/host 示例/镜像零泄密 全部通过', () => {
    const checks = checkGoogleOAuthWiring()
    const failed = checks.filter((c) => !c.ok)
    expect(
      failed.map((c) => `${c.id}: ${c.detail}`),
      `${checks.filter((c) => c.ok).length}/${checks.length} 通过`,
    ).toEqual([])
  })
})
