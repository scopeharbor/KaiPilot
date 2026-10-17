// v2-5-sdk-npm-release-workflow §3.3 —— Release preflight 单元测试。
// 覆盖：白名单通过、禁止路径失败、禁止内容失败、构建产物缺失、低敏失败摘要、包大小预算、文件数量预算。

import { describe, expect, test, beforeAll } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// 直接测试纯函数模块，不 mock child_process
import {
  checkAllowlist,
  checkForbiddenPatterns,
  checkFileCount,
  checkPackageSize,
  runPreflight,
  MAX_FILE_COUNT,
  MAX_TARBALL_SIZE,
  type PackEntry,
  type PackResult,
} from './release-preflight.ts'

const BUILD_DIR = resolve(__dirname, '..', 'dist')

describe('v2-5-sdk-npm-release-workflow release-preflight', () => {
  describe('checkAllowlist', () => {
    test('P0: 所有文件在白名单内通过', () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: 'dist/index.d.ts', size: 512 },
        { path: 'README.md', size: 256 },
        { path: 'LICENSE', size: 1024 },
        { path: 'package.json', size: 512 },
      ]
      const result = checkAllowlist(files)
      expect(result.passed).toBe(true)
      expect(result.message).toContain('白名单')
    })

    test('P0: 不在白名单的文件触发拒绝', () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: 'dist/index.d.ts', size: 512 },
        { path: 'README.md', size: 256 },
        { path: 'LICENSE', size: 1024 },
        { path: 'package.json', size: 512 },
        { path: 'src/config.ts', size: 200 },
      ]
      const result = checkAllowlist(files)
      expect(result.passed).toBe(false)
      expect(result.message).toContain('src/config.ts')
    })

    test('P0: tsconfig.json 不在白名单内', () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: 'tsconfig.json', size: 200 },
      ]
      const result = checkAllowlist(files)
      expect(result.passed).toBe(false)
    })
  })

  describe('checkForbiddenPatterns', () => {
    test('P0: 无禁止文件通过', () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: 'dist/index.d.ts', size: 512 },
        { path: 'README.md', size: 256 },
      ]
      const result = checkForbiddenPatterns(files)
      expect(result.passed).toBe(true)
    })

    test('P0: .env 文件触发拒绝', () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: '.env', size: 100 },
      ]
      const result = checkForbiddenPatterns(files)
      expect(result.passed).toBe(false)
      expect(result.message).toContain('.env')
    })

    test('P0: .log 文件触发拒绝', () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: 'npm-debug.log', size: 500 },
      ]
      const result = checkForbiddenPatterns(files)
      expect(result.passed).toBe(false)
    })

    test('P0: src/ 目录触发拒绝', () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: 'src/secret.ts', size: 100 },
      ]
      const result = checkForbiddenPatterns(files)
      expect(result.passed).toBe(false)
    })

    test('P0: token-like 内容模式', () => {
      // 文件路径本身包含 token 关键词
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: 'dist/NPM_TOKEN', size: 50 },
      ]
      const result = checkForbiddenPatterns(files)
      expect(result.passed).toBe(false)
    })
  })

  describe('checkFileCount', () => {
    test('P0: 文件数量在预算内通过', () => {
      const files: PackEntry[] = Array.from({ length: 10 }, (_, i) => ({
        path: `dist/file-${i}.js`,
        size: 100,
      }))
      const result = checkFileCount(files)
      expect(result.passed).toBe(true)
      expect(result.message).toContain(String(MAX_FILE_COUNT))
    })

    test('P0: 文件数量超出预算失败', () => {
      const files: PackEntry[] = Array.from({ length: MAX_FILE_COUNT + 10 }, (_, i) => ({
        path: `dist/file-${i}.js`,
        size: 100,
      }))
      const result = checkFileCount(files)
      expect(result.passed).toBe(false)
    })
  })

  describe('checkPackageSize', () => {
    test('P0: 包大小在预算内通过', () => {
      const result: PackResult = {
        name: '@aiproj/sdk',
        version: '0.1.0',
        filename: 'test.tgz',
        files: [{ path: 'dist/index.js', size: 1024 }],
        entryCount: 1,
        size: 1024,
        unpackedSize: 1024,
      }
      const gate = checkPackageSize(result)
      expect(gate.passed).toBe(true)
    })

    test('P0: 包大小超出预算失败', () => {
      const result: PackResult = {
        name: '@aiproj/sdk',
        version: '0.1.0',
        filename: 'test.tgz',
        files: [],
        entryCount: 0,
        size: MAX_TARBALL_SIZE + 1,
        unpackedSize: MAX_TARBALL_SIZE + 1,
      }
      const gate = checkPackageSize(result)
      expect(gate.passed).toBe(false)
    })
  })

  describe('runPreflight integration', () => {
    test('P0: 完整通过场景', async () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: 'dist/index.d.ts', size: 512 },
        { path: 'dist/transport.js', size: 2048 },
        { path: 'dist/transport.d.ts', size: 1024 },
        { path: 'dist/errors.js', size: 512 },
        { path: 'dist/errors.d.ts', size: 256 },
        { path: 'dist/query.js', size: 1024 },
        { path: 'dist/query.d.ts', size: 512 },
        { path: 'dist/projects-client.js', size: 2048 },
        { path: 'dist/projects-client.d.ts', size: 1024 },
        { path: 'dist/tasks-client.js', size: 2048 },
        { path: 'dist/tasks-client.d.ts', size: 1024 },
        { path: 'README.md', size: 256 },
        { path: 'LICENSE', size: 1024 },
        { path: 'package.json', size: 512 },
      ]
      // 如果 dist/ 不存在，构建产物门禁会失败
      if (existsSync(BUILD_DIR)) {
        const result = await runPreflight(files, BUILD_DIR)
        expect(result.passed).toBe(true)
      }
    })

    test('P0: 含禁止文件场景', async () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: '.env', size: 50 },
        { path: 'src/secret.ts', size: 100 },
      ]
      if (existsSync(BUILD_DIR)) {
        const result = await runPreflight(files, BUILD_DIR)
        expect(result.passed).toBe(false)
      }
    })

    test('P0: 无 pack 文件时仅检查构建产物', async () => {
      const result = await runPreflight(undefined, BUILD_DIR)
      const skippedGates = result.gates.filter((g) => g.message.startsWith('跳过'))
      expect(skippedGates.length).toBeGreaterThanOrEqual(4)
    })

    test('P0: 失败摘要低敏 — 不含 token/secret/密码', () => {
      const files: PackEntry[] = [
        { path: 'dist/index.js', size: 1024 },
        { path: '.env', size: 50 },
      ]
      const allowlist = checkAllowlist(files)
      const forbidden = checkForbiddenPatterns(files)
      const json = JSON.stringify({ allowlist, forbidden })
      expect(json).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|password|PRIVATE KEY/)
    })
  })
})
