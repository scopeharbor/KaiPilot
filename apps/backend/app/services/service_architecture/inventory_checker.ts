/**
 * v3-service-architecture-expansion — local inventory checker.
 *
 * Detects unregistered high-risk service folders/files in apps/backend/app/services/
 * and produces low-sensitive findings with file paths and reason codes.
 *
 * Uses direct source listing (fs) as the authoritative source because codebase-memory
 * graph evidence is known to be incomplete for recent V3 backend files.
 * See observation-and-inventory.md §1.2.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  detectUnregisteredServiceFolders,
  makeLowSensitiveFindingSummary,
  EVIDENCE_FRESHNESS_STATUSES,
  BOUNDARY_CHECK_CATEGORIES,
  ARCHITECTURE_REASON_CODES,
  FINDING_SEVERITIES,
  type ServiceArchitectureFinding,
  type ServiceCatalogEntry,
} from '@aiproj/types'
import { SERVICE_ARCHITECTURE_CATALOG } from './catalog.js'

/** High-risk folder-name patterns that should be registered or have a legacy exception. */
export const HIGH_RISK_FOLDER_PATTERNS: readonly RegExp[] = [
  /adapter/i,
  /provider/i,
  /ledger/i,
  /audit/i,
  /orchestrat/i,
  /sso/i,
  /scim/i,
  /kms/i,
  /compliance/i,
  /dlp/i,
  /security/i,
  /webhook/i,
  /ai_draft/i,
  /ai_ocr/i,
  /compiler/i,
  /multitenant/i,
  /bi_/i,
  /report_v/i,
  /triz_/i,
  /knowledge/i,
  /realtime/i,
  /streaming/i,
]

/** Low-risk folder names that do not need registration. */
export const LOW_RISK_FOLDER_NAMES: ReadonlySet<string> = new Set([
  'cache',
  'calendar',
  'dialect',
  'redis',
  'renderer',
  'search',
  'timeline',
  'transport-health',
  'diagram_spec_generators',
  'mermaid_converters',
  'candidates',
  'change_impact',
  'draft_layer',
  'file_v2',
  'health_diagnosis',
  'integrations',
  'pmo_recommendation',
  'prediction',
  'recommendation',
  'report_aggregators',
  'report_exporters',
])

export interface ServiceFolderInfo {
  folderName: string
  fileCount: number
  highRisk: boolean
  relativePath: string
}

/**
 * Scan the services directory and return folder info.
 * Uses direct fs listing (source fallback) — not codebase-memory graph.
 */
export function scanServiceFolders(repoRoot: string): ServiceFolderInfo[] {
  const servicesDir = join(repoRoot, 'apps', 'backend', 'app', 'services')
  let entries: string[]
  try {
    entries = readdirSync(servicesDir)
  } catch {
    return []
  }
  const folders: ServiceFolderInfo[] = []
  for (const name of entries) {
    const fullPath = join(servicesDir, name)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    let fileCount = 0
    try {
      fileCount = readdirSync(fullPath).filter((f) => f.endsWith('.ts')).length
    } catch {
      fileCount = 0
    }
    const highRisk = isHighRiskFolder(name)
    folders.push({
      folderName: name,
      fileCount,
      highRisk,
      relativePath: relative(repoRoot, fullPath).split(sep).join('/'),
    })
  }
  return folders
}

/**
 * Determine if a folder name matches high-risk patterns.
 */
export function isHighRiskFolder(folderName: string): boolean {
  if (LOW_RISK_FOLDER_NAMES.has(folderName)) return false
  return HIGH_RISK_FOLDER_PATTERNS.some((p) => p.test(folderName))
}

/**
 * Run the inventory check against the current catalog and filesystem.
 * Returns low-sensitive findings only — no sensitive payload fields.
 */
export function runInventoryCheck(repoRoot: string): {
  findings: ServiceArchitectureFinding[]
  scannedFolders: ServiceFolderInfo[]
  registeredCount: number
  legacyCount: number
} {
  const scannedFolders = scanServiceFolders(repoRoot)
  const entries: ServiceCatalogEntry[] = SERVICE_ARCHITECTURE_CATALOG.map((e) => ({ ...e }))
  const findings = detectUnregisteredServiceFolders({
    serviceFolders: scannedFolders.map((f) => ({
      folderName: f.folderName,
      fileCount: f.fileCount,
      highRisk: f.highRisk,
    })),
    registeredEntries: entries,
  })

  // Add file-path info to findings (low-sensitive: only relative path, no content).
  for (const finding of findings) {
    const folder = scannedFolders.find((f) => f.folderName === finding.moduleKey)
    if (folder) {
      finding.filePath = folder.relativePath
    }
  }

  const registeredCount = entries.filter((e) => e.role !== 'legacy-service').length
  const legacyCount = entries.filter((e) => e.role === 'legacy-service').length

  return { findings, scannedFolders, registeredCount, legacyCount }
}

/**
 * Produce a low-sensitive summary of inventory findings (for display/logging).
 * Strips all sensitive payload fields.
 */
export function summarizeInventoryFindings(
  findings: ServiceArchitectureFinding[],
): ReturnType<typeof makeLowSensitiveFindingSummary> {
  return makeLowSensitiveFindingSummary(findings)
}

/**
 * Check if a specific file path contains high-risk patterns that should be
 * registered. Reads file content and checks for adapter/provider/ledger/audit
 * indicators. Returns a low-sensitive finding if the file is unregistered.
 */
export function checkHighRiskFile(
  filePath: string,
  relativePath: string,
  registeredModuleKeys: string[],
): ServiceArchitectureFinding | null {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  const hasAdapterPattern = /class\s+\w*Adapter\b|implements\s+\w*Adapter\b/.test(content)
  const hasProviderPattern = /class\s+\w*Provider\b|implements\s+\w*Provider\b/.test(content)
  const hasLedgerPattern = /class\s+\w*Ledger\w*|ledger_writer|ledgerWriter/.test(content)
  const hasAuditPattern = /class\s+\w*Audit\w*|audit_service|auditService/.test(content)

  if (!hasAdapterPattern && !hasProviderPattern && !hasLedgerPattern && !hasAuditPattern) {
    return null
  }

  const pathParts = relativePath.split('/')
  const folderName = pathParts[pathParts.length - 2] ?? ''
  const isRegistered = registeredModuleKeys.some((key) => {
    return (
      key.includes(folderName.replace(/_/g, '-')) || folderName.includes(key.replace(/-/g, '_'))
    )
  })

  if (isRegistered) return null

  const reasonCode = hasAdapterPattern
    ? ARCHITECTURE_REASON_CODES.ADAPTER_AUTHORITY_SMELL
    : hasProviderPattern
      ? ARCHITECTURE_REASON_CODES.MISSING_LEDGER_DECLARATION
      : hasLedgerPattern
        ? ARCHITECTURE_REASON_CODES.MISSING_LEDGER_DECLARATION
        : ARCHITECTURE_REASON_CODES.SENSITIVE_AUDIT_PAYLOAD

  return {
    moduleKey: folderName || 'unknown',
    filePath: relativePath,
    category: BOUNDARY_CHECK_CATEGORIES.SERVICE,
    reasonCode,
    severity: FINDING_SEVERITIES.LOW,
    message: `unregistered high-risk file pattern in ${relativePath}`,
    evidenceFreshness: EVIDENCE_FRESHNESS_STATUSES.NEEDS_SOURCE_VERIFICATION,
  }
}

// Re-export types for convenience.
export type { ServiceArchitectureFinding, ServiceCatalogEntry }
