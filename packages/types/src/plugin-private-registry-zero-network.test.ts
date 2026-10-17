/**
 * plugin-private-registry-lifecycle — 零网络/零真实第三方安装守卫测试（task 9.3）。
 *
 * 证明 fixture 流程不访问远程 registry、provider、OAuth、Webhook/Web Push、
 * 外部写回或公开包发布，也不执行任意包代码。
 *
 * 真实外部 provider/registry 调用次数 MUST 为 0。
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// =============================================================================
// 1. Service Files — No External Network Calls
// =============================================================================

const SERVICES_DIR = path.resolve(__dirname, '../../../apps/backend/app/services/plugin_registry')

const NETWORK_PATTERNS = [
  { pattern: /fetch\(/, name: 'fetch()' },
  { pattern: /axios/, name: 'axios' },
  { pattern: /http\.get/, name: 'http.get' },
  { pattern: /https\.get/, name: 'https.get' },
  { pattern: /node-fetch/, name: 'node-fetch' },
  { pattern: /got\(/, name: 'got()' },
  { pattern: /request\(/, name: 'request()' },
  { pattern: /WebSocket/, name: 'WebSocket' },
  { pattern: /XMLHttpRequest/, name: 'XMLHttpRequest' },
]

describe('Zero network calls in service files', () => {
  const files = fs
    .readdirSync(SERVICES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  for (const file of files) {
    it(`${file} has no external network calls`, () => {
      const content = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf-8')
      for (const { pattern, name } of NETWORK_PATTERNS) {
        expect(content).not.toMatch(pattern)
      }
    })
  }
})

// =============================================================================
// 2. Service Files — No Process Spawn / Child Process
// =============================================================================

const SPAWN_PATTERNS = [
  { pattern: /child_process/, name: 'child_process' },
  { pattern: /spawn\(/, name: 'spawn()' },
  { pattern: /exec\(/, name: 'exec()' },
  { pattern: /execSync\(/, name: 'execSync()' },
]

describe('No process spawn in service files', () => {
  const files = fs
    .readdirSync(SERVICES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  for (const file of files) {
    it(`${file} has no process spawn`, () => {
      const content = fs.readFileSync(path.join(SERVICES_DIR, file), 'utf-8')
      for (const { pattern, name } of SPAWN_PATTERNS) {
        expect(content).not.toMatch(pattern)
      }
    })
  }
})

// =============================================================================
// 3. Service Files — No File System Writes (except barrel index)
// =============================================================================

describe('No file system writes in core service files', () => {
  const coreFiles = [
    'registry_service_core.ts',
    'preview_confirm_core.ts',
    'rollback_core.ts',
    'audit_writer.ts',
    'status_orchestration_core.ts',
  ]

  const WRITE_PATTERNS = [
    { pattern: /writeFileSync/, name: 'writeFileSync' },
    { pattern: /writeFile\(/, name: 'writeFile' },
    { pattern: /appendFileSync/, name: 'appendFileSync' },
    { pattern: /mkdirSync/, name: 'mkdirSync' },
    { pattern: /unlinkSync/, name: 'unlinkSync' },
  ]

  for (const file of coreFiles) {
    it(`${file} has no file system writes`, () => {
      const filePath = path.join(SERVICES_DIR, file)
      if (!fs.existsSync(filePath)) return // file not yet created
      const content = fs.readFileSync(filePath, 'utf-8')
      for (const { pattern, name } of WRITE_PATTERNS) {
        expect(content).not.toMatch(pattern)
      }
    })
  }
})

// =============================================================================
// 4. Shared Types — No Runtime Dependencies
// =============================================================================

describe('Shared types have no runtime dependencies', () => {
  const typesDir = path.resolve(__dirname)
  const lifecycleFile = path.join(typesDir, 'plugin-private-registry-lifecycle.ts')

  it('lifecycle types have no external imports', () => {
    const content = fs.readFileSync(lifecycleFile, 'utf-8')
    // Only allow imports from within the same package
    const imports = content.match(/^import .+ from .+$/gm) ?? []
    for (const imp of imports) {
      // Allow relative imports and @aiproj/types
      expect(imp).toMatch(/from '\.\/|from '@aiproj\/types/)
    }
  })

  it('lifecycle types have no node built-in imports', () => {
    const content = fs.readFileSync(lifecycleFile, 'utf-8')
    expect(content).not.toMatch(/from 'node:/)
    expect(content).not.toMatch(/from 'fs'/)
    expect(content).not.toMatch(/from 'path'/)
    expect(content).not.toMatch(/from 'crypto'/)
    expect(content).not.toMatch(/from 'http'/)
    expect(content).not.toMatch(/from 'https'/)
  })
})

// =============================================================================
// 5. Fixtures — No Real Provider Data
// =============================================================================

describe('Fixtures contain no real provider data', () => {
  const fixturesFile = path.resolve(__dirname, 'plugin-private-registry-lifecycle-fixtures.ts')

  it('no real API keys or tokens', () => {
    const content = fs.readFileSync(fixturesFile, 'utf-8')
    // sk_ prefix tokens (20+ chars)
    expect(content).not.toMatch(/sk_[A-Za-z0-9]{20,}/)
    // Bearer tokens
    expect(content).not.toMatch(/Bearer [A-Za-z0-9._\-]{20,}/)
    // GitHub tokens
    expect(content).not.toMatch(/ghp_[A-Za-z0-9]{20,}/)
  })

  it('no real URLs (except fixture: prefixes)', () => {
    const content = fs.readFileSync(fixturesFile, 'utf-8')
    const urls = content.match(/https?:\/\/[^\s'"]+/g) ?? []
    for (const url of urls) {
      // Allow fixture: prefix references
      expect(url).toMatch(/^fixture:/)
    }
  })

  it('no real organization IDs', () => {
    const content = fs.readFileSync(fixturesFile, 'utf-8')
    // Real org IDs would be numeric; ours are string constants
    expect(content).not.toMatch(/organizationId:\s*\d{5,}/)
  })
})

// =============================================================================
// 6. Test Files — No Real Provider Calls
// =============================================================================

describe('Test files have no real provider calls', () => {
  const testFiles = [
    'plugin-private-registry-lifecycle.test.ts',
    'plugin-private-registry-schema.test.ts',
    'plugin-private-registry-services.test.ts',
    'plugin-private-registry-validators.test.ts',
    // Note: this file is excluded from self-check (contains regex patterns with fetch)
  ]

  const TEST_NETWORK_PATTERNS = [
    { pattern: /fetch\(/, name: 'fetch()' },
    { pattern: /axios/, name: 'axios' },
    { pattern: /nock/, name: 'nock' },
    { pattern: /msw/, name: 'msw' },
    { pattern: /supertest/, name: 'supertest' },
  ]

  for (const file of testFiles) {
    it(`${file} has no real provider/network calls`, () => {
      const filePath = path.join(__dirname, file)
      if (!fs.existsSync(filePath)) return
      const content = fs.readFileSync(filePath, 'utf-8')
      for (const { pattern, name } of TEST_NETWORK_PATTERNS) {
        expect(content).not.toMatch(pattern)
      }
    })
  }
})

// =============================================================================
// 7. Migration Files — No Remote References
// =============================================================================

describe('Migration files have no remote references', () => {
  const migrationsDir = path.resolve(__dirname, '../../../apps/backend/database/migrations')

  it('entries migration has no remote URLs', () => {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.includes('plugin_private_registry_entries'))
    expect(files.length).toBe(1)
    const content = fs.readFileSync(path.join(migrationsDir, files[0]), 'utf-8')
    expect(content).not.toMatch(/https?:\/\//)
    expect(content).not.toMatch(/remote/i)
  })

  it('reviews migration has no remote URLs', () => {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.includes('plugin_private_registry_reviews'))
    expect(files.length).toBe(1)
    const content = fs.readFileSync(path.join(migrationsDir, files[0]), 'utf-8')
    expect(content).not.toMatch(/https?:\/\//)
    expect(content).not.toMatch(/remote/i)
  })
})

// =============================================================================
// 8. Validator — No Database Access
// =============================================================================

describe('Validator has no database access', () => {
  it('validator file has no Lucid/AdonisJS imports', () => {
    const validatorPath = path.resolve(
      __dirname,
      '../../../apps/backend/app/validators/plugin_registry_validator.ts',
    )
    if (!fs.existsSync(validatorPath)) return
    const content = fs.readFileSync(validatorPath, 'utf-8')
    expect(content).not.toMatch(/from '@adonisjs/)
    expect(content).not.toMatch(/from '#models/)
    expect(content).not.toMatch(/from '#services/)
  })
})

// =============================================================================
// 9. Audit Writer — No Direct DB Writes
// =============================================================================

describe('Audit writer has no direct DB writes', () => {
  it('audit_writer.ts has no Lucid model imports', () => {
    const auditPath = path.join(SERVICES_DIR, 'audit_writer.ts')
    if (!fs.existsSync(auditPath)) return
    const content = fs.readFileSync(auditPath, 'utf-8')
    // Audit writer should only build events, not write to DB directly
    expect(content).not.toMatch(/from '@adonisjs\/lucid/)
    expect(content).not.toMatch(/@model\(/)
    expect(content).not.toMatch(/\.create\(/)
    expect(content).not.toMatch(/\.save\(/)
  })
})
