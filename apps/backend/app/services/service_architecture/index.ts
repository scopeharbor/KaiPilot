/**
 * v3-service-architecture-expansion — service architecture module barrel.
 */
export {
  SERVICE_ARCHITECTURE_CATALOG,
  loadServiceArchitectureCatalog,
  findCatalogEntry,
  getRegisteredModuleKeys,
  getLegacyModuleKeys,
  INFRASTRUCTURE_PREREQUISITES,
} from './catalog.js'
export {
  scanServiceFolders,
  isHighRiskFolder,
  runInventoryCheck,
  summarizeInventoryFindings,
  checkHighRiskFile,
  HIGH_RISK_FOLDER_PATTERNS,
  LOW_RISK_FOLDER_NAMES,
  type ServiceFolderInfo,
  type ServiceArchitectureFinding,
  type ServiceCatalogEntry,
} from './inventory_checker.js'
export {
  generateCatalogMarkdown,
  generateFindingsMarkdown,
  generateInventorySection,
} from './inventory_markdown_helper.js'
export {
  checkControllerBoundary,
  checkServiceBoundary,
  checkValidatorPolicyBoundary,
  checkAdapterProviderBoundary,
  checkAuditLedgerBoundary,
  applyAllowlist,
  validateAllowlistEntries,
  checkAllBoundaries,
  type BoundaryCheckResult,
  type BoundaryCheckOptions,
} from './boundary_checker.js'
export {
  validateOrchestrationFlowBackend,
  checkProviderCallPreflight,
  checkFormalWriteConfirmation,
  checkOrchestratorDelegation,
  isSafeForDefaultMode,
  checkDefaultProviderUsesFixtures,
  getAuthorizationRequiredActions,
  validateAuthorizedRealSmokeRecord,
} from './orchestration_rules.js'
