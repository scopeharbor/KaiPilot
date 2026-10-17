/**
 * v3-service-architecture-expansion — backend service architecture catalog & inventory tests.
 * Task 3.5: catalog loading, required field validation, unregistered folder detection,
 * legacy exception handling, and unsupported infrastructure prerequisite rejection.
 */
import { describe, expect, it } from 'vitest'
import {
  SERVICE_ARCHITECTURE_CATALOG,
  loadServiceArchitectureCatalog,
  findCatalogEntry,
  getRegisteredModuleKeys,
  getLegacyModuleKeys,
} from '../../../app/services/service_architecture/index.js'
import {
  runInventoryCheck,
  isHighRiskFolder,
  scanServiceFolders,
  summarizeInventoryFindings,
} from '../../../app/services/service_architecture/inventory_checker.js'
import {
  generateInventorySection,
  generateCatalogMarkdown,
} from '../../../app/services/service_architecture/inventory_markdown_helper.js'
import {
  validateCatalog,
  validateCatalogEntry,
  INFRASTRUCTURE_PREREQUISITES,
  REJECTED_INFRASTRUCTURE_PREREQUISITES,
  SERVICE_ROLES,
  EVIDENCE_FRESHNESS_STATUSES,
  type ServiceCatalogEntry,
} from '@aiproj/types'

import { resolve } from 'node:path'
// vitest runs from apps/backend; repo root is two levels up.
const REPO_ROOT = resolve(process.cwd(), '..', '..')

describe('Service Architecture Catalog', () => {
  describe('catalog loading', () => {
    it('loads a non-empty catalog', () => {
      const catalog = loadServiceArchitectureCatalog()
      expect(catalog.length).toBeGreaterThan(0)
    })

    it('SERVICE_ARCHITECTURE_CATALOG is a readonly array of entries', () => {
      expect(Array.isArray(SERVICE_ARCHITECTURE_CATALOG)).toBe(true)
      expect(SERVICE_ARCHITECTURE_CATALOG.length).toBeGreaterThan(20)
    })

    it('every entry has a stable module key and path scope', () => {
      for (const entry of SERVICE_ARCHITECTURE_CATALOG) {
        expect(entry.moduleKey.length).toBeGreaterThan(0)
        expect(entry.pathScope.length).toBeGreaterThan(0)
        expect(entry.role).toBeDefined()
        expect(entry.ownerDomain.length).toBeGreaterThan(0)
        expect(entry.dependencyPolicy).toBeDefined()
        expect(entry.tenantMode).toBeDefined()
        expect(entry.sideEffectClass).toBeDefined()
        expect(entry.externalActionClass).toBeDefined()
        expect(entry.auditLedgerExpectation).toBeDefined()
        expect(entry.evidenceFreshness).toBeDefined()
      }
    })

    it('findCatalogEntry returns entry by key', () => {
      const entry = findCatalogEntry('ai-draft')
      expect(entry).toBeDefined()
      expect(entry!.moduleKey).toBe('ai-draft')
      expect(entry!.role).toBe(SERVICE_ROLES.ORCHESTRATOR_SERVICE)
    })

    it('findCatalogEntry returns undefined for unknown key', () => {
      expect(findCatalogEntry('nonexistent')).toBeUndefined()
    })
  })

  describe('required field validation', () => {
    it('every catalog entry passes validation', () => {
      const catalog = loadServiceArchitectureCatalog()
      const result = validateCatalog(catalog)
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('every entry individually passes validation', () => {
      for (const entry of SERVICE_ARCHITECTURE_CATALOG) {
        const result = validateCatalogEntry(entry)
        expect(result.ok).toBe(true)
        expect(result.errors).toHaveLength(0)
      }
    })

    it('rejects entry with missing moduleKey', () => {
      const bad: ServiceCatalogEntry = {
        ...SERVICE_ARCHITECTURE_CATALOG[0],
        moduleKey: '',
      }
      const result = validateCatalogEntry(bad)
      expect(result.ok).toBe(false)
    })
  })

  describe('legacy exception handling', () => {
    it('getRegisteredModuleKeys excludes legacy entries', () => {
      const registered = getRegisteredModuleKeys()
      const legacy = getLegacyModuleKeys()
      expect(registered.length).toBeGreaterThan(0)
      expect(legacy.length).toBeGreaterThan(0)
      // No overlap
      for (const lk of legacy) {
        expect(registered).not.toContain(lk)
      }
    })

    it('legacy entries have legacy-service role', () => {
      const legacy = SERVICE_ARCHITECTURE_CATALOG.filter(
        (e) => e.role === SERVICE_ROLES.LEGACY_SERVICE,
      )
      expect(legacy.length).toBeGreaterThan(0)
      for (const e of legacy) {
        expect(e.auditLedgerExpectation).toBe('deferred')
        expect(e.fixtureFirstTestStatus).toBe(false)
      }
    })
  })

  describe('unsupported infrastructure prerequisite rejection', () => {
    it('no catalog entry declares a rejected prerequisite', () => {
      for (const entry of SERVICE_ARCHITECTURE_CATALOG) {
        const infra = entry.infrastructurePrerequisite ?? INFRASTRUCTURE_PREREQUISITES.NONE
        expect(REJECTED_INFRASTRUCTURE_PREREQUISITES).not.toContain(infra)
      }
    })

    it('all entries default to none prerequisite', () => {
      for (const entry of SERVICE_ARCHITECTURE_CATALOG) {
        const infra = entry.infrastructurePrerequisite ?? INFRASTRUCTURE_PREREQUISITES.NONE
        expect(infra).toBe('none')
      }
    })

    it('rejects an entry with microservice-split prerequisite', () => {
      const bad: ServiceCatalogEntry = {
        ...SERVICE_ARCHITECTURE_CATALOG[0],
        moduleKey: 'test-microservice',
        infrastructurePrerequisite: INFRASTRUCTURE_PREREQUISITES.MICROSERVICE_SPLIT,
      }
      const result = validateCatalogEntry(bad)
      expect(result.ok).toBe(false)
      expect(
        result.errors.some((e) => e.reasonCode === 'rejected-infrastructure-prerequisite'),
      ).toBe(true)
    })
  })

  describe('high-risk service area coverage', () => {
    it('registers AI draft/OCR areas', () => {
      expect(findCatalogEntry('ai-draft')).toBeDefined()
      expect(findCatalogEntry('ai-ocr')).toBeDefined()
      expect(findCatalogEntry('ai-intent')).toBeDefined()
      expect(findCatalogEntry('ai-m0')).toBeDefined()
    })

    it('registers Compiler area', () => {
      expect(findCatalogEntry('compiler')).toBeDefined()
    })

    it('registers multitenant console area', () => {
      expect(findCatalogEntry('multitenant-console')).toBeDefined()
    })

    it('registers SSO SAML2 and OIDC areas', () => {
      expect(findCatalogEntry('sso-saml2')).toBeDefined()
      expect(findCatalogEntry('sso-oidc')).toBeDefined()
    })

    it('registers SCIM area', () => {
      expect(findCatalogEntry('scim')).toBeDefined()
    })

    it('registers KMS/DLP/compliance areas', () => {
      expect(findCatalogEntry('kms')).toBeDefined()
      expect(findCatalogEntry('compliance')).toBeDefined()
      expect(findCatalogEntry('security')).toBeDefined()
    })

    it('registers BI/reporting areas', () => {
      expect(findCatalogEntry('bi-aggregation')).toBeDefined()
      expect(findCatalogEntry('report-v2')).toBeDefined()
    })

    it('registers TRIZ areas', () => {
      expect(findCatalogEntry('triz-clarification')).toBeDefined()
      expect(findCatalogEntry('triz-compiler')).toBeDefined()
    })

    it('registers webhooks/realtime/streaming areas', () => {
      expect(findCatalogEntry('webhooks')).toBeDefined()
      expect(findCatalogEntry('realtime')).toBeDefined()
      expect(findCatalogEntry('streaming')).toBeDefined()
    })

    it('registers adapters as authority-free boundary', () => {
      const adapters = findCatalogEntry('adapters')
      expect(adapters).toBeDefined()
      expect(adapters!.role).toBe(SERVICE_ROLES.ADAPTER_SERVICE)
      expect(adapters!.tenantMode).toBe('tenant-derived')
    })
  })
})

describe('Inventory Checker', () => {
  describe('isHighRiskFolder', () => {
    it('flags high-risk folder names', () => {
      expect(isHighRiskFolder('ai_draft')).toBe(true)
      expect(isHighRiskFolder('sso')).toBe(true)
      expect(isHighRiskFolder('kms')).toBe(true)
      expect(isHighRiskFolder('scim')).toBe(true)
      expect(isHighRiskFolder('compiler')).toBe(true)
    })

    it('does not flag low-risk folder names', () => {
      expect(isHighRiskFolder('cache')).toBe(false)
      expect(isHighRiskFolder('dialect')).toBe(false)
      expect(isHighRiskFolder('search')).toBe(false)
    })
  })

  describe('scanServiceFolders', () => {
    it('scans the services directory and returns folder info', () => {
      const folders = scanServiceFolders(REPO_ROOT)
      expect(folders.length).toBeGreaterThan(30)
      // Should include known high-risk folders
      const names = folders.map((f) => f.folderName)
      expect(names).toContain('ai_draft')
      expect(names).toContain('compiler')
    })

    it('every folder has fileCount and relativePath', () => {
      const folders = scanServiceFolders(REPO_ROOT)
      for (const f of folders) {
        expect(f.fileCount).toBeGreaterThanOrEqual(0)
        expect(f.relativePath.length).toBeGreaterThan(0)
      }
    })
  })

  describe('runInventoryCheck', () => {
    it('returns findings, scannedFolders, and counts', () => {
      const result = runInventoryCheck(REPO_ROOT)
      expect(result.scannedFolders.length).toBeGreaterThan(0)
      expect(result.registeredCount).toBeGreaterThan(0)
      expect(result.legacyCount).toBeGreaterThan(0)
      expect(Array.isArray(result.findings)).toBe(true)
    })

    it('findings are low-sensitive (no sensitive payload in message)', () => {
      const result = runInventoryCheck(REPO_ROOT)
      const summaries = summarizeInventoryFindings(result.findings)
      for (const s of summaries) {
        // Messages should not contain sensitive keywords
        expect(s.message).not.toMatch(/prompt|api_key|authorization|token|password/i)
      }
    })

    it('does not flag registered folders as unregistered', () => {
      const result = runInventoryCheck(REPO_ROOT)
      const registeredKeys = getRegisteredModuleKeys()
      const unregisteredFindings = result.findings.filter(
        (f) => f.reasonCode === 'unregistered-service-folder',
      )
      for (const f of unregisteredFindings) {
        // The folder name should not match any registered key
        const folderNameNormalized = f.moduleKey.replace(/_/g, '-')
        expect(registeredKeys).not.toContain(folderNameNormalized)
      }
    })
  })
})

describe('Inventory Markdown Helper', () => {
  it('generateCatalogMarkdown produces a markdown table', () => {
    const md = generateCatalogMarkdown()
    expect(md).toContain('| Module Key |')
    expect(md).toContain('|------------|')
    expect(md).toContain('ai-draft')
  })

  it('generateInventorySection produces a full section', () => {
    const section = generateInventorySection([])
    expect(section).toContain('## Service Architecture Catalog (Generated)')
    expect(section).toContain('### Registered Entries')
    expect(section).toContain('### Legacy / Deferred Entries')
    expect(section).toContain('### Architecture Findings')
  })

  it('generateInventorySection includes findings in markdown', () => {
    const findings = [
      {
        moduleKey: 'test-finding',
        category: 'service' as const,
        reasonCode: 'unregistered-service-folder' as const,
        severity: 'medium' as const,
        message: 'test finding message',
        evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.FRESH,
      },
    ]
    const section = generateInventorySection(findings)
    expect(section).toContain('test-finding')
    expect(section).toContain('test finding message')
  })
})
