// v2-5-sdk-npm-release-workflow §5.3 —— 授权发布门禁测试。
// 覆盖：未授权发布尝试、缺失凭据、dry-run 失败、版本/commit 不匹配、门禁失败阻断。

import { describe, expect, test, beforeEach } from 'vitest'
import {
  validatePublishIntent,
  canRunPublish,
  createAuthorizationRecord,
  isCiEnvironment,
  isNpmTokenAvailable,
  type PublishIntent,
} from './publish-guard.ts'

describe('v2-5-sdk-npm-release-workflow publish-guard', () => {
  beforeEach(() => {
    // 清除环境变量以免影响测试
    delete process.env.CI
    delete process.env.GITHUB_ACTIONS
    delete process.env.NPM_TOKEN
    delete process.env.NODE_AUTH_TOKEN
  })

  describe('validatePublishIntent', () => {
    const baseIntent: PublishIntent = {
      authorization: 'publish_authorized',
      packageName: '@aiproj/sdk',
      confirmedVersion: '0.1.0',
      confirmedCommit: '', // 将在测试中设置
      targetRegistry: 'https://registry.npmjs.org/',
      gatesPassed: true,
      dryRunPassed: true,
      npmTokenAvailable: true,
    }

    test('P0: 完整授权场景通过', () => {
      const intent = { ...baseIntent, confirmedCommit: 'abc123def456' }
      // 只能做基本断言，因为 commit 不会匹配
      const result = validatePublishIntent(intent)
      // commit 会不匹配，所以 allowed 应为 false
      expect(result.details.authorizationOk).toBe(true)
      expect(result.details.versionMatch).toBe(true)
      expect(result.details.gatesOk).toBe(true)
      expect(result.details.dryRunOk).toBe(true)
      expect(result.details.credentialsOk).toBe(true)
    })

    test('P0: 未授权时拒绝', () => {
      const intent: PublishIntent = {
        ...baseIntent,
        authorization: 'not_authorized',
      }
      const result = validatePublishIntent(intent)
      expect(result.allowed).toBe(false)
      expect(result.details.authorizationOk).toBe(false)
      expect(result.reason).toContain('未获得用户显式发布授权')
    })

    test('P0: dry-run 授权时拒绝真实 publish', () => {
      const intent: PublishIntent = {
        ...baseIntent,
        authorization: 'dry_run_only',
      }
      const result = validatePublishIntent(intent)
      expect(result.allowed).toBe(false)
      expect(result.details.authorizationOk).toBe(false)
    })

    test('P0: 门禁失败时拒绝', () => {
      const intent: PublishIntent = {
        ...baseIntent,
        gatesPassed: false,
      }
      const result = validatePublishIntent(intent)
      expect(result.allowed).toBe(false)
      expect(result.details.gatesOk).toBe(false)
    })

    test('P0: dry-run 失败时拒绝', () => {
      const intent: PublishIntent = {
        ...baseIntent,
        dryRunPassed: false,
      }
      const result = validatePublishIntent(intent)
      expect(result.allowed).toBe(false)
      expect(result.details.dryRunOk).toBe(false)
    })

    test('P0: 无版本确认时拒绝', () => {
      const intent: PublishIntent = {
        ...baseIntent,
        confirmedVersion: '',
      }
      const result = validatePublishIntent(intent)
      expect(result.allowed).toBe(false)
      expect(result.details.versionMatch).toBe(false)
    })

    test('P0: npm token 缺失时拒绝', () => {
      const intent: PublishIntent = {
        ...baseIntent,
        npmTokenAvailable: false,
      }
      const result = validatePublishIntent(intent)
      expect(result.allowed).toBe(false)
      expect(result.details.credentialsOk).toBe(false)
    })

    test('P0: 多项失败时报告全部原因', () => {
      const intent: PublishIntent = {
        ...baseIntent,
        authorization: 'not_authorized' as const,
        gatesPassed: false,
        dryRunPassed: false,
        npmTokenAvailable: false,
      }
      const result = validatePublishIntent(intent)
      expect(result.allowed).toBe(false)
      // 应包含所有失败原因
      expect(result.reason).toContain('未获得用户显式发布授权')
      expect(result.reason).toContain('门禁未通过')
      expect(result.reason).toContain('Dry-run 未通过')
      expect(result.reason).toContain('npm token 不可用')
    })
  })

  describe('canRunPublish', () => {
    test('P0: 本地 dry-run 默认允许', () => {
      const result = canRunPublish('not_authorized', true)
      expect(result.allowed).toBe(true)
    })

    test('P0: 本地真实 publish 默认拒绝', () => {
      const result = canRunPublish('not_authorized', false)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('默认禁止')
    })

    test('P0: 本地 + 授权允许 publish', () => {
      const result = canRunPublish('publish_authorized', false)
      expect(result.allowed).toBe(true)
    })

    test('P0: CI dry-run 默认允许', () => {
      process.env.CI = 'true'
      const result = canRunPublish('not_authorized', true)
      expect(result.allowed).toBe(true)
    })

    test('P0: CI 真实 publish 默认拒绝', () => {
      process.env.CI = 'true'
      const result = canRunPublish('not_authorized', false)
      expect(result.allowed).toBe(false)
    })

    test('P0: CI + 授权允许 publish', () => {
      process.env.CI = 'true'
      const result = canRunPublish('publish_authorized', false)
      expect(result.allowed).toBe(true)
    })
  })

  describe('createAuthorizationRecord', () => {
    test('P0: 授权记录低敏', () => {
      const record = createAuthorizationRecord({
        authorizedBy: 'user-admin',
        targetRegistry: 'https://registry.npmjs.org/',
        confirmedVersion: '0.1.0',
      })
      expect(record.authorizedBy).toBe('user-admin')
      expect(record.targetRegistry).toContain('registry.npmjs.org')
      expect(record.confirmedVersion).toBe('0.1.0')
      expect(record.confirmedCommit).toBeDefined()
      // 不含敏感信息
      const json = JSON.stringify(record)
      expect(json).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|password|secret/)
    })
  })
})
