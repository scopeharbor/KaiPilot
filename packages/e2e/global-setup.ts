import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { E2E_SQLITE_DATABASE } from './e2e-database'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const backendDir = resolve(rootDir, 'apps/backend')
const acePath = resolve(backendDir, 'ace.js')

function runBackendAce(args: string[]) {
  execFileSync(process.execPath, [acePath, ...args], {
    cwd: backendDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      // 与 Playwright 启动的后端（database-launcher local-dev → sqliteEnvironment）用同一个 SQLite 文件；
      // 否则这里迁移、种子的是 .env 里的库，后端却跑在另一个空库上，注册与登录全部失败
      DB_CONNECTION: 'sqlite',
      DB_DATABASE: E2E_SQLITE_DATABASE,
    },
  })
}

export default async function globalSetup() {
  runBackendAce(['migration:run'])
  runBackendAce(['db:seed'])
}
