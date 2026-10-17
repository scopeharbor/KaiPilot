import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// v2-5-sdk-npm-release-workflow §2 —— 静态证明 packages/sdk package.json 元数据符合 npm 发布边界：
// private 保持但可审计、无 publish 脚本、无 npm token/publishConfig、files 白名单、正确 exports 和 engines。
// 保留 v2-5-typescript-sdk-core §3.4 的非发布断言并扩展为发布就绪元数据审计。

const pkgPath = resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>

describe('v2-5-sdk-npm-release-workflow package metadata (publish-ready)', () => {
  test('package is private (workspace-only, no unintended publish)', () => {
    expect(pkg.private).toBe(true)
  })

  test('no publish / release script in scripts', () => {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    expect(scripts.publish).toBeUndefined()
    expect(scripts['publish:patch']).toBeUndefined()
    expect(scripts.release).toBeUndefined()
    const scriptValues = Object.values(scripts)
    expect(scriptValues.some((s) => /\bnpm publish\b/.test(s))).toBe(false)
  })

  test('no publishConfig / npm token in package.json', () => {
    expect(pkg.publishConfig).toBeUndefined()
    const json = JSON.stringify(pkg)
    expect(json).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/)
  })

  test('valid npm-safe name and version', () => {
    expect(pkg.name).toBe('@aiproj/sdk')
    expect(typeof pkg.version).toBe('string')
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('has license field', () => {
    expect(pkg.license).toBe('AGPL-3.0-only')
  })

  test('has sideEffects: false', () => {
    expect(pkg.sideEffects).toBe(false)
  })

  test('has node engines >=26', () => {
    const engines = (pkg.engines ?? {}) as Record<string, string>
    expect(engines.node).toMatch(/>=26/)
  })

  test('files allowlist includes dist/ README.md LICENSE package.json only', () => {
    const files = (pkg.files ?? []) as string[]
    expect(files).toContain('dist/')
    expect(files).toContain('README.md')
    expect(files).toContain('LICENSE')
    expect(files).toContain('package.json')
    // 不应包含 src/ 或 tsconfig.json 等内部文件
    expect(files).not.toContain('src/')
    expect(files).not.toContain('tsconfig.json')
  })

  test('exports has types and default entry points', () => {
    const exports_ = (pkg.exports ?? {}) as Record<string, unknown>
    const dot = exports_['.'] as Record<string, string> | undefined
    expect(dot).toBeDefined()
    expect(dot?.types).toBeDefined()
    expect(dot?.default).toBeDefined()
  })

  test('main and types point to dist/ output', () => {
    expect(pkg.main).toMatch(/^\.\/dist\//)
    expect(pkg.types).toMatch(/^\.\/dist\//)
  })

  test('depends on @aiproj/types via workspace:* (not a published dep)', () => {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>
    expect(deps['@aiproj/types']).toBe('workspace:*')
  })
})
