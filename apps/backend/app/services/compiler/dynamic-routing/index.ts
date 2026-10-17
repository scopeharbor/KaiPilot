/**
 * @aiproj/backend —— Compiler Dynamic Routing 出口。
 */

export { RoutingRuleRegistry } from './routing_rule_registry.js'
export { RoutingPlanner } from './routing_planner.js'
export type { PlannerContext, PlannerDependency } from './routing_planner.js'
export {
  recordRoutingDecision,
  getRoutingDecision,
  hasRoutingDecision,
  recordDriftDiagnostic,
  getDriftDiagnostics,
  resetRoutingStore,
  serializeDecisionSummary,
} from './routing_decision_service.js'
export type {
  RoutingDecision,
  RoutingRule,
  RouteDriftDiagnostic,
} from '@aiproj/types/compiler-dynamic-routing'
