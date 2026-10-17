/**
 * RBAC 中央模块聚合导出（design D4，sec3 目录约定 `start/rbac`）。
 *
 * 消费方统一从 `#rbac` 导入；细分文件亦可经 `#rbac/permissions` / `#rbac/roles` / `#rbac/routes` 引用。
 */

export * from './permissions.js'
export * from './roles.js'
export * from './routes.js'
