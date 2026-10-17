export { extractMemoryCandidates } from './copilot_memory_extractor.js'
export type { SessionMessageFact, MemoryExtractionInput } from './copilot_memory_extractor.js'

export {
  selectMemoriesForInjection,
  buildMemoryFacet,
  detectConflictWithLiveFact,
  assertNoVectorDependency,
} from './copilot_memory_injector.js'

export {
  createAuditEvent,
  canWriteOrganizationMemory,
  canReadUserMemory,
  validateNoReconstructableResidue,
  exportMemoryEntries,
  validateExportSanitized,
} from './copilot_memory_service.js'
export type { MemoryAuditSink, CopilotMemoryServiceConfig } from './copilot_memory_service.js'
