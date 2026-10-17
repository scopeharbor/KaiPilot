import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    },
  })
}

export default async function globalSetup() {
  runBackendAce(['migration:run'])
  runBackendAce(['db:seed'])
}
