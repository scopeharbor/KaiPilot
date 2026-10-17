/**
 * v3-plugin-permission-audit-and-observation — Service barrel。
 *
 * 导出所有插件权限决策服务。
 */

// ── Phase 4: Audit Events & Receipt ──
export {
  PLUGIN_PERMISSION_AUDIT_EVENTS,
  mapDecisionToAuditEvent,
  getAuditActionVerb,
  getAuditSeverity,
  PLUGIN_PERMISSION_DECISION_ENTITY_TYPE,
  resolveRequiredRbacPermission,
  type PluginPermissionAuditEvent,
} from './audit_event_mapping.js'

export {
  buildAuditPayload,
  sanitizeAuditPayload,
  buildActorRefHash,
  buildPluginRefHash,
  buildOrganizationScopeHash,
  buildProjectScopeHash,
  buildContributionRefHash,
  computeLatencyBucket,
  assertAuditPayloadLowSensitive,
  assertNoServerOwnedScope,
} from './audit_payload_builder.js'

export {
  appendWithReceipt,
  type AuditReceipt,
  type StrictAuditAppendParams,
} from './strict_audit_append.js'

export {
  recordDecision,
  type RecordDecisionParams,
  type RecordDecisionResult,
  AuditWriteFailedError,
} from './decision_recorder.js'

export {
  recordAuditFailure,
  resetHealthSignal,
  getHealthSignal,
  type PluginPermissionHealthSignal,
} from './health_signal.js'

// ── Phase 5: Core Decision Service ──
export {
  assembleTrustedContext,
  validateTrustedContext,
  type AssembleContextParams,
} from './trusted_context_assembler.js'

export {
  evaluateHostAdminProfile,
  type AdminProfileInput,
  type AdminProfileResult,
} from './admin_profile_evaluator.js'

export {
  evaluateRuntimeProfile,
  type RuntimeProfileInput,
  type RuntimeProfileResult,
} from './runtime_profile_evaluator.js'

export { decide, type DecideParams } from './decision_service.js'

export {
  assertControllerDoesNotBypassDecisionService,
  assertPluginCodeDoesNotWriteLedgerAudit,
  assertObservationDoesNotImportDecisionService,
  assertNoDecisionBypassPaths,
  runAllCallChainGuards,
  type CallChainViolation,
} from './call_chain_guard.js'

// ── Phase 6: Plugin Registry Adapter ──
export {
  adaptRegistryAction,
  type RegistryAction,
  type RegistryAdapterParams,
} from './registry_adapter.js'

// ── Phase 7: Query Service ──
export {
  queryDecisions,
  aggregateDecisions,
  type DecisionQueryFilter,
  type DecisionQueryResult,
  type DecisionEventDTO,
  type DecisionAggregateResult,
} from './decision_query_service.js'

// ── Phase 8: Observation Adapter ──
export { compileObservation } from './observation_adapter.js'

// ── Phase 9: Integrity & Retention ──
export {
  checkDecisionIntegrity,
  type IntegrityFinding,
  type IntegrityCheckResult,
} from './integrity_service.js'

export {
  checkRetentionEligibility,
  cleanupExpiredDecisions,
  isDecisionExpired,
  type RetentionCheckResult,
  type RetentionCleanupResult,
} from './retention_service.js'
