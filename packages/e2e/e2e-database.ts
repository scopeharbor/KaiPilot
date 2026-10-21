/**
 * 端到端测试专用的 SQLite 文件（相对 apps/backend）。
 * global-setup 的迁移、种子与 Playwright 启动的后端都用它，两边必须一致。
 */
export const E2E_SQLITE_DATABASE = 'tmp/e2e.sqlite'
