// v2-5-sdk-npm-release-workflow §6.3 —— Release evidence 单元测试。
// 覆盖：证据脱敏、token-like 输出处理、省略 secret 字段、可复现证据摘要。

import { describe, expect, test } from 'vitest'
import {
  redactSensitiveOutput,
  containsSensitiveData,
  generateReleaseEvidence,
} from './release-evidence.ts'

describe('v2-5-sdk-npm-release-workflow release-evidence', () => {
  describe('redactSensitiveOutput', () => {
    test('P0: 普通文本不变', () => {
      expect(redactSensitiveOutput('hello world')).toBe('hello world')
    })

    test('P0: npm_token 被脱敏', () => {
      const input = 'npm_token=npm_abc123def456'
      const result = redactSensitiveOutput(input)
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('npm_abc123def456')
    })

    test('P0: NODE_AUTH_TOKEN 被脱敏', () => {
      const input = 'NODE_AUTH_TOKEN = "ghp_xxxxxxxxxxxx"'
      const result = redactSensitiveOutput(input)
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('ghp_xxxxxxxxxxxx')
    })

    test('P0: Authorization header 被脱敏', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9'
      const result = redactSensitiveOutput(input)
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('Bearer eyJhbGciOiJIUzI1NiJ9')
    })

    test('P0: 私钥被脱敏', () => {
      const input = '-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----'
      const result = redactSensitiveOutput(input)
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('ABC123')
    })
  })

  describe('containsSensitiveData', () => {
    test('P0: 普通文本返回 false', () => {
      expect(containsSensitiveData('plain text')).toBe(false)
    })

    test('P0: 含 token 返回 true', () => {
      expect(containsSensitiveData('npm_token=secret')).toBe(true)
    })
  })

  describe('generateReleaseEvidence', () => {
    const mockGates = [
      { name: '构建产物', passed: true, message: '构建产物存在' },
      { name: '文件白名单', passed: true, message: '全部文件在白名单内' },
      { name: '禁止模式', passed: false, message: '发现 .env 文件' },
    ]

    test('P0: 证据含包名/版本/commit', () => {
      const evidence = generateReleaseEvidence({
        packageName: '@aiproj/sdk',
        packageVersion: '0.1.0',
        gateResults: mockGates,
        dryRunStatus: 'passed',
        authorizationState: 'not_authorized',
      })
      expect(evidence.packageName).toBe('@aiproj/sdk')
      expect(evidence.packageVersion).toBe('0.1.0')
      expect(evidence.commitSha).toBeTruthy()
      expect(evidence.gateSummary.total).toBe(3)
      expect(evidence.gateSummary.passed).toBe(2)
      expect(evidence.gateSummary.failed).toBe(1)
    })

    test('P0: 证据不含敏感字段', () => {
      const evidence = generateReleaseEvidence({
        packageName: '@aiproj/sdk',
        packageVersion: '0.1.0',
        gateResults: mockGates,
        dryRunStatus: 'passed',
        authorizationState: 'not_authorized',
      })
      const json = JSON.stringify(evidence)
      expect(json).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|password|PRIVATE KEY/)
    })

    test('P0: tarball 摘要可选', () => {
      const evidence = generateReleaseEvidence({
        packageName: '@aiproj/sdk',
        packageVersion: '0.1.0',
        gateResults: mockGates,
        tarballSummary: { fileName: 'aiproj-sdk-0.1.0.tgz', fileCount: 16, sizeBytes: 15000 },
        dryRunStatus: 'passed',
        authorizationState: 'not_authorized',
      })
      expect(evidence.tarballSummary).toBeDefined()
      expect(evidence.tarballSummary!.fileName).toBe('aiproj-sdk-0.1.0.tgz')
      expect(evidence.tarballSummary!.sizeBytes).toBe(15000)
    })

    test('P0: 无 tarball 时摘要为 undefined', () => {
      const evidence = generateReleaseEvidence({
        packageName: '@aiproj/sdk',
        packageVersion: '0.1.0',
        gateResults: mockGates,
        dryRunStatus: 'not_run',
        authorizationState: 'not_authorized',
      })
      expect(evidence.tarballSummary).toBeUndefined()
    })

    test('P0: 授权记录可选', () => {
      const evidence = generateReleaseEvidence({
        packageName: '@aiproj/sdk',
        packageVersion: '0.1.0',
        gateResults: mockGates,
        dryRunStatus: 'passed',
        authorizationState: 'authorized',
        authorizationRecord: {
          authorizedBy: 'admin',
          authorizedAt: new Date().toISOString(),
          targetRegistry: 'https://registry.npmjs.org/',
          confirmedVersion: '0.1.0',
          confirmedCommit: 'abc123',
        },
      })
      expect(evidence.authorizationRecord).toBeDefined()
      expect(evidence.authorizationRecord!.authorizedBy).toBe('admin')
      expect(evidence.authorizationRecord!.targetRegistry).toContain('registry.npmjs.org')
    })

    test('P0: 门禁失败时 message 不含 token', () => {
      const evidence = generateReleaseEvidence({
        packageName: '@aiproj/sdk',
        packageVersion: '0.1.0',
        gateResults: [
          { name: '构建产物', passed: true, message: '构建产物存在' },
          { name: '禁止模式', passed: false, message: 'npm_token=npm_secret_in_message' },
        ],
        dryRunStatus: 'failed',
        authorizationState: 'not_authorized',
      })
      const json = JSON.stringify(evidence)
      expect(json).not.toMatch(/npm_secret_in_message/)
    })
  })
})
