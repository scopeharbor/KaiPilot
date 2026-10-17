/*
|--------------------------------------------------------------------------
| HTTP kernel file
|--------------------------------------------------------------------------
|
| The HTTP kernel file is used to register the middleware with the server
| or the router.
|
*/

import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

/**
 * The error handler is used to convert an exception
 * to a HTTP response.
 */
server.errorHandler(() => import('#exceptions/handler'))

/**
 * The server middleware stack runs middleware on all the HTTP
 * requests, even if there is no route registered for the
 * request URL.
 */
server.use([
  () => import('#middleware/force_json_response_middleware'),
  () => import('#middleware/container_bindings_middleware'),
  () => import('@adonisjs/cors/cors_middleware'),
])

/**
 * The router middleware stack runs middleware on all the HTTP
 * requests with a registered route.
 */
router.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
  () => import('@adonisjs/session/session_middleware'),
  () => import('@adonisjs/shield/shield_middleware'),
  () => import('@adonisjs/auth/initialize_auth_middleware'),
  () => import('#middleware/silent_auth_middleware'),
  () => import('#middleware/tenant_middleware'),
  () => import('#middleware/rbac_middleware'),
  () => import('#middleware/tenant_api_boundary_middleware'),
  () => import('#middleware/audit_context_middleware'),
])

/**
 * Named middleware collection must be explicitly assigned to
 * the routes or the routes group.
 */
export const middleware = router.named({
  auth: () => import('#middleware/auth_middleware'),
  apiV2Gate: () => import('#middleware/api_v2_gate_middleware'),
  webhookIpAllowlist: () => import('#middleware/webhook_ip_allowlist_middleware'),
  skillEvalFeatureGuard: () => import('#middleware/skill_eval_feature_guard'),
  crossProjectAllocationFeatureGuard: () =>
    import('#middleware/cross_project_allocation_feature_guard'),
  mpdCrudFeatureGuard: () => import('#middleware/multi_project_dependency_feature_guard'),
})
