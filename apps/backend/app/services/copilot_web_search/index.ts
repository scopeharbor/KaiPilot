/**
 * v3-copilot-web-search-tool — 外部检索服务 barrel。
 */

export { RetrievalAuthorizationGate } from './authorization_gate.js'
export type { AuthorizationGateInput, AuthorizationGateResult } from './authorization_gate.js'

export { DomainPolicyService } from './domain_policy_service.js'
export type { DomainPolicyCheckInput, DomainPolicyCheckResult } from './domain_policy_service.js'

export { RetrievalBudgetGuard } from './retrieval_budget_guard.js'
export type {
  RetrievalBudgetCheckInput,
  RetrievalBudgetCheckResult,
} from './retrieval_budget_guard.js'

export { RetrievalService } from './retrieval_service.js'
export type {
  RetrievalServiceConfig,
  RetrievalServiceInput,
  RetrievalServiceOutput,
} from './retrieval_service.js'

export {
  buildRetrievalDecisionRecord,
  InMemoryRetrievalDecisionRecorder,
} from './retrieval_ledger_recorder.js'
export type { RetrievalDecisionRecorder } from './retrieval_ledger_recorder.js'

export {
  FixtureSearchProvider,
  FixtureFetchProvider,
  FixtureSummaryProvider,
  FixturePartialFailureFetchProvider,
} from './fixture_provider.js'
