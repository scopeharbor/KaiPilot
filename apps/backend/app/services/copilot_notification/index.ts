/**
 * v3-copilot-notification-routing — 投递路由服务出口
 *
 * 统一导出投递路由相关服务，便于外部引用。
 */

export { DeliveryRouter } from './delivery_router.js'
export { BadgeInAppDelivery } from './badge_inapp_delivery.js'
export { PushDelivery } from './push_delivery.js'
export { DeliveryOrchestrator } from './delivery_orchestrator.js'
export { PermissionGuard } from './permission_guard.js'

export type { DeliveryRouterConfig } from './delivery_router.js'
export type { BadgeInAppDeliveryInput } from './badge_inapp_delivery.js'
export type { PushDeliveryConfig, PushDeliveryInput } from './push_delivery.js'
export type { DeliveryOrchestratorConfig, DeliveryInput } from './delivery_orchestrator.js'
export type { PermissionGuardConfig, PermissionCheckResult } from './permission_guard.js'
