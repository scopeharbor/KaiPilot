/**
 * v3-docker-compose-runtime-foundation —— Docker/Compose 静态契约共享断言库。
 *
 * 单一事实来源：本文件的 check 函数同时被
 *   - vitest 静态门禁 spec（apps/backend/tests/unit/docker_compose/*.spec.ts）
 *   - 根级 CLI 门禁 `pnpm check:docker-compose`（scripts/check-docker-compose.ts）
 * 消费，保证「测试所见 = 门禁所查」不漂移。
 *
 * 全部是纯静态文件解析（fs + YAML），**不依赖 Docker CLI/daemon**；
 * 目标机 runtime smoke 由 scripts/docker-runtime-gate.ts 单独承担（缺 Docker 返回 blocked）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface GateCheck {
  id: string
  ok: boolean
  /** 低敏说明：只含文件路径/键名/模式，绝不包含 secret 值 */
  detail: string
}

const pass = (id: string, detail: string): GateCheck => ({ id, ok: true, detail })
const fail = (id: string, detail: string): GateCheck => ({ id, ok: false, detail })

/** 仓库根（本文件位于 apps/backend/tests/unit/docker_compose/）。 */
export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

export function readRepoFile(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8')
}

function repoFileExists(rel: string): boolean {
  return existsSync(join(REPO_ROOT, rel))
}

// ---------------------------------------------------------------------------
// .dockerignore 匹配器（gitignore 语义子集：注释/空行、`!` 否定、basename 或
// 锚定路径、`*`/`?`/`**`，last-match-wins）
// ---------------------------------------------------------------------------

interface IgnoreRule {
  negated: boolean
  regex: RegExp
  /** 模式含 `/`（去掉前导后）→ 锚定仓库根；否则按 basename/任意层级匹配 */
  anchored: boolean
}

function ignorePatternToRegex(pattern: string): RegExp {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` 可匹配零层目录；其余 `**` 匹配任意字符
        if (pattern[i + 2] === '/') {
          out += '(?:[^\\0]*?/)?'
          i += 3
        } else {
          out += '[^\\0]*?'
          i += 2
        }
      } else {
        out += '[^/]*'
        i += 1
      }
    } else if (ch === '?') {
      out += '[^/]'
      i += 1
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`
      i += 1
    } else {
      out += ch
      i += 1
    }
  }
  return new RegExp(out)
}

function parseDockerignore(source: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    let pattern = line
    let negated = false
    if (pattern.startsWith('!')) {
      negated = true
      pattern = pattern.slice(1)
    }
    // 目录语义：尾斜杠只影响意图，匹配上按前缀处理
    if (pattern.endsWith('/')) pattern = pattern.slice(0, -1)
    const anchored = pattern.includes('/')
    const cleaned = pattern.replace(/^\//, '')
    const body = ignorePatternToRegex(cleaned)
    const regex = anchored
      ? new RegExp(`^${body.source}(?:/[^\\0]*)?$`)
      : new RegExp(`(?:^|/)${body.source}(?:/[^\\0]*)?$`)
    rules.push({ negated, regex, anchored })
  }
  return rules
}

/** 判断仓库相对路径（正斜杠）是否被 .dockerignore 排除。 */
export function isDockerignored(rules: IgnoreRule[], relPath: string): boolean {
  let ignored = false
  for (const rule of rules) {
    if (rule.regex.test(relPath)) ignored = !rule.negated
  }
  return ignored
}

// ---------------------------------------------------------------------------
// Compose 类型与解析
// ---------------------------------------------------------------------------

export interface ComposeSecretRef {
  source: string
  target?: string
  uid?: string
  gid?: string
  mode?: number
}

export interface ComposeService {
  image?: string
  build?: { context?: string; dockerfile?: string } | string
  command?: string[] | string
  user?: string
  restart?: string
  ports?: Array<string | { published?: string | number; target?: string | number }>
  environment?: Record<string, string | number | boolean | null> | string[]
  volumes?: Array<string | { type?: string; source?: string; target?: string; read_only?: boolean }>
  secrets?: Array<string | ComposeSecretRef>
  depends_on?: Record<string, { condition?: string }> | string[]
  healthcheck?: { test?: string | string[]; [k: string]: unknown }
  networks?: string[] | Record<string, unknown>
}

export interface ComposeDoc {
  services: Record<string, ComposeService>
  volumes?: Record<string, unknown>
  secrets?: Record<string, { file?: string } | null>
  networks?: Record<string, unknown>
}

export function loadCompose(rel: string): ComposeDoc {
  return parseYaml(readRepoFile(rel)) as ComposeDoc
}

export function serviceEnv(service: ComposeService): Record<string, string> {
  const env = service.environment ?? {}
  if (Array.isArray(env)) {
    const out: Record<string, string> = {}
    for (const entry of env) {
      const idx = entry.indexOf('=')
      if (idx > 0) out[entry.slice(0, idx)] = entry.slice(idx + 1)
      else out[entry] = ''
    }
    return out
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) out[k] = v === null || v === undefined ? '' : String(v)
  return out
}

export function serviceVolumeStrings(service: ComposeService): string[] {
  return (service.volumes ?? []).map((v) =>
    typeof v === 'string' ? v : `${v.source}:${v.target}${v.read_only ? ':ro' : ''}`,
  )
}

export function healthcheckTestString(service: ComposeService): string {
  const test = service.healthcheck?.test
  if (!test) return ''
  return Array.isArray(test) ? test.join(' ') : String(test)
}

export function dependsOnConditions(service: ComposeService): Record<string, string> {
  const deps = service.depends_on ?? {}
  if (Array.isArray(deps)) {
    const out: Record<string, string> = {}
    for (const d of deps) out[d] = 'service_started'
    return out
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(deps)) out[k] = v?.condition ?? 'service_started'
  return out
}

function check(id: string, condition: boolean, okDetail: string, failDetail: string): GateCheck {
  return condition ? pass(id, okDetail) : fail(id, failDetail)
}

/** 去掉注释行，避免说明文字触发内容模式误报（Dockerfile/compose/nginx 均为 `#` 注释）。 */
function stripHashComments(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

// ---------------------------------------------------------------------------
// task 2.1/2.2 — .dockerignore
// ---------------------------------------------------------------------------

export function checkDockerIgnore(): GateCheck[] {
  const checks: GateCheck[] = []
  const rel = '.dockerignore'
  if (!repoFileExists(rel)) return [fail('dockerignore.exists', '.dockerignore 不存在')]
  const source = readRepoFile(rel)
  const rules = parseDockerignore(source)
  checks.push(pass('dockerignore.exists', '.dockerignore 存在且可解析'))

  const requiredPatterns = [
    '.git',
    '**/.env',
    '**/.env.*',
    '**/node_modules',
    '**/*.sqlite',
    'apps/backend/storage/uploads',
    'apps/backend/storage/secrets',
    'deploy/secrets',
    '**/*.log',
    '**/coverage',
    '**/test-results',
    'apps/backend/build',
    '**/.next',
    '**/.turbo',
  ]
  for (const p of requiredPatterns) {
    checks.push(
      check(
        `dockerignore.excludes.${p}`,
        source.split(/\r?\n/).some((l) => l.trim() === p || l.trim() === `${p}/`),
        `排除模式存在：${p}`,
        `缺少排除模式：${p}`,
      ),
    )
  }
  for (const p of ['!**/.env.example', '!.env.compose.example']) {
    checks.push(
      check(
        `dockerignore.keeps.${p}`,
        source.split(/\r?\n/).some((l) => l.trim() === p),
        `放行模式存在：${p}`,
        `缺少放行模式：${p}`,
      ),
    )
  }

  const mustKeep = [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    'apps/backend/package.json',
    'apps/backend/app/services/file_storage.ts',
    'apps/backend/Dockerfile',
    'apps/backend/docker/docker-entrypoint.sh',
    'apps/frontend/package.json',
    'apps/frontend/public/branding/app-icon-192.png',
    'apps/frontend/next.config.mjs',
    'packages/types/src/index.ts',
    'packages/compiler-spec/src/index.ts',
    'edge/default.conf',
    '.env.compose.example',
    'apps/backend/.env.example',
  ]
  for (const p of mustKeep) {
    checks.push(
      check(
        `dockerignore.keep.${p}`,
        !isDockerignored(rules, p),
        `构建上下文保留：${p}`,
        `构建上下文误排除：${p}`,
      ),
    )
  }

  const mustExclude = [
    '.git/HEAD',
    '.env',
    '.env.compose',
    'apps/backend/.env',
    'apps/backend/.env.test',
    'apps/frontend/.env.local',
    'apps/backend/database.sqlite',
    'apps/backend/test.sqlite',
    'node_modules/tsx/package.json',
    'apps/backend/node_modules/pg/package.json',
    'apps/backend/storage/uploads/projects/1/a.pdf',
    'apps/backend/storage/secrets/google-oauth-client.local.json',
    'deploy/secrets/google-oauth-client.json',
    'backend-dev.out.log',
    'apps/backend/build/bin/server.js',
    'apps/backend/.adonisjs/server/controllers.js',
    'apps/frontend/.next/server.js',
    'apps/backend/coverage/lcov.info',
    'packages/e2e/test-results/x.png',
  ]
  for (const p of mustExclude) {
    checks.push(
      check(
        `dockerignore.exclude.${p}`,
        isDockerignored(rules, p),
        `敏感/大体积路径在构建上下文外：${p}`,
        `敏感/大体积路径未被排除：${p}`,
      ),
    )
  }
  return checks
}

// ---------------------------------------------------------------------------
// 版本锁定（Node 26.10.0 / Corepack 0.36.0 / pnpm 12.8.1 / PG / Redis / edge）
// ---------------------------------------------------------------------------

const PINNED = {
  node: 'node:26.10.0-bookworm-slim',
  corepack: 'corepack@0.36.0',
  pnpm: 'pnpm@12.8.1',
  postgres: 'postgres:18.6-alpine',
  redis: 'redis:8.10-alpine',
  edge: 'nginxinc/nginx-unprivileged:1.31-alpine',
} as const

export function checkVersionPins(): GateCheck[] {
  const checks: GateCheck[] = []
  const dockerfiles = ['apps/backend/Dockerfile', 'apps/frontend/Dockerfile']
  for (const file of dockerfiles) {
    const src = readRepoFile(file)
    const code = stripHashComments(src)
    checks.push(
      check(
        `pin.node.${file}`,
        src.includes(`ARG NODE_IMAGE=${PINNED.node}`),
        `${file} 锁定 ${PINNED.node}`,
        `${file} 未锁定 ${PINNED.node}`,
      ),
    )
    checks.push(
      check(
        `pin.corepack.${file}`,
        src.includes(`npm install --global ${PINNED.corepack}`),
        `${file} 固定 ${PINNED.corepack}`,
        `${file} 未固定 ${PINNED.corepack}`,
      ),
    )
    checks.push(
      check(
        `pin.pnpm.${file}`,
        src.includes(`corepack prepare ${PINNED.pnpm} --activate`),
        `${file} Corepack 固定 ${PINNED.pnpm}`,
        `${file} 未固定 ${PINNED.pnpm}`,
      ),
    )
    checks.push(
      check(
        `pin.no-latest.${file}`,
        !/FROM\s+\S+:(latest)\b/i.test(code) &&
          !/FROM\s+(node|postgres|redis|nginx)\s*$/im.test(code),
        `${file} 无 latest/裸标签`,
        `${file} 出现 latest 或未打标签的 FROM`,
      ),
    )
    checks.push(
      check(`pin.no-bun.${file}`, !/\bbun\b/i.test(code), `${file} 不使用 Bun`, `${file} 出现 bun`),
    )
  }
  const rootPkg = JSON.parse(readRepoFile('package.json')) as { packageManager?: string }
  checks.push(
    check(
      'pin.pnpm.packageManager',
      rootPkg.packageManager === PINNED.pnpm,
      `根 packageManager=${PINNED.pnpm}`,
      `根 packageManager=${rootPkg.packageManager}`,
    ),
  )
  for (const composeFile of ['compose.yaml', 'compose.sqlite.yaml']) {
    const doc = loadCompose(composeFile)
    const images = Object.values(doc.services)
      .map((s) => s.image)
      .filter((v): v is string => typeof v === 'string')
    checks.push(
      check(
        `pin.images.${composeFile}`,
        images.length > 0 && images.every((img) => !img.endsWith(':latest') && img.includes(':')),
        `${composeFile} 全部镜像固定标签：${images.join(', ')}`,
        `${composeFile} 存在 latest 或无标签镜像：${images.join(', ')}`,
      ),
    )
  }
  const defaultCompose = loadCompose('compose.yaml')
  checks.push(
    check(
      'pin.postgres.image',
      defaultCompose.services['postgres']?.image === PINNED.postgres,
      `PostgreSQL=${PINNED.postgres}`,
      `PostgreSQL 镜像=${defaultCompose.services['postgres']?.image}`,
    ),
  )
  checks.push(
    check(
      'pin.redis.image',
      defaultCompose.services['redis']?.image === PINNED.redis,
      `Redis=${PINNED.redis}`,
      `Redis 镜像=${defaultCompose.services['redis']?.image}`,
    ),
  )
  checks.push(
    check(
      'pin.edge.image',
      defaultCompose.services['edge']?.image === PINNED.edge,
      `edge=${PINNED.edge}`,
      `edge 镜像=${defaultCompose.services['edge']?.image}`,
    ),
  )
  return checks
}

// ---------------------------------------------------------------------------
// task 2.4/2.5 — .env.compose.example 与配置覆盖契约
// ---------------------------------------------------------------------------

/** 受控文件中禁止出现「真实 secret」的启发式模式（键名+长随机值且未注释）。 */
const REAL_SECRET_PATTERN =
  /^[^#\s].*\b(SECRET|PASSWORD|APP_KEY)\s*[=:]\s*["']?[A-Za-z0-9+/=_-]{16,}/m

export function checkEnvComposeExample(): GateCheck[] {
  const checks: GateCheck[] = []
  const rel = '.env.compose.example'
  if (!repoFileExists(rel)) return [fail('envcompose.exists', '.env.compose.example 不存在')]
  const src = readRepoFile(rel)
  checks.push(pass('envcompose.exists', '.env.compose.example 存在'))

  const keys = [
    'AIPROJ_BIND_ADDRESS',
    'AIPROJ_HTTP_PORT',
    'AIPROJ_PUBLIC_ORIGIN',
    'AIPROJ_GOOGLE_OAUTH_ORIGIN',
    'AIPROJ_APP_KEY',
    'AIPROJ_JWT_ACCESS_SECRET',
    'AIPROJ_POSTGRES_PASSWORD',
    'AIPROJ_POSTGRES_DB',
    'AIPROJ_POSTGRES_USER',
    'AIPROJ_REDIS_DB',
  ]
  for (const key of keys) {
    const mentioned = src.includes(key)
    checks.push(
      check(`envcompose.key.${key}`, mentioned, `覆盖字典包含 ${key}`, `覆盖字典缺少 ${key}`),
    )
    // 所有真实赋值行必须保持注释（默认启动不要求复制/编辑）
    const hasActiveAssignment = src
      .split(/\r?\n/)
      .some((l) => new RegExp(`^${key}=`).test(l.trimStart()))
    checks.push(
      check(
        `envcompose.commented.${key}`,
        mentioned && !hasActiveAssignment,
        `${key} 仅以注释示例存在`,
        `${key} 存在未注释的默认赋值`,
      ),
    )
  }
  checks.push(
    check(
      'envcompose.storage.documented',
      /storage/i.test(src) && /volume/i.test(src),
      'storage 段说明 named volume 持久化契约',
      'storage 段缺失',
    ),
  )
  checks.push(
    check(
      'envcompose.no-real-secret',
      !REAL_SECRET_PATTERN.test(src),
      '.env.compose.example 无真实 secret pattern',
      '.env.compose.example 出现疑似真实 secret 的未注释赋值',
    ),
  )

  // 单一公开端口与 network-only 契约（默认栈）
  const doc = loadCompose('compose.yaml')
  for (const [name, service] of Object.entries(doc.services)) {
    const hasPorts = Array.isArray(service.ports) && service.ports.length > 0
    if (name === 'edge') {
      checks.push(
        check(
          'envcompose.edge.single-port',
          hasPorts && service.ports!.length === 1,
          'edge 恰好发布 1 个宿主端口',
          `edge ports=${JSON.stringify(service.ports)}`,
        ),
      )
      const portSpec = String(
        typeof service.ports?.[0] === 'object'
          ? `${service.ports[0].published}:${service.ports[0].target}`
          : service.ports?.[0],
      )
      checks.push(
        check(
          'envcompose.edge.port-env',
          portSpec.includes('${AIPROJ_BIND_ADDRESS') && portSpec.includes('${AIPROJ_HTTP_PORT'),
          `edge 端口经 env 覆盖：${portSpec}`,
          `edge 端口未走 env 覆盖：${portSpec}`,
        ),
      )
    } else {
      checks.push(
        check(
          `envcompose.network-only.${name}`,
          !hasPorts,
          `${name} network-only（无宿主端口）`,
          `${name} 意外发布宿主端口`,
        ),
      )
    }
  }
  // 默认启动不得依赖 env_file / required 文件
  for (const composeFile of ['compose.yaml', 'compose.sqlite.yaml']) {
    const src2 = readRepoFile(composeFile)
    checks.push(
      check(
        `envcompose.no-required-envfile.${composeFile}`,
        !/env_file\s*:/m.test(src2),
        `${composeFile} 不依赖 env_file`,
        `${composeFile} 声明了 env_file`,
      ),
    )
  }
  return checks
}

// ---------------------------------------------------------------------------
// task 3.x — backend 镜像
// ---------------------------------------------------------------------------

export function checkBackendDockerfile(): GateCheck[] {
  const checks: GateCheck[] = []
  const file = 'apps/backend/Dockerfile'
  if (!repoFileExists(file)) return [fail('backenddf.exists', 'backend Dockerfile 不存在')]
  const src = readRepoFile(file)
  checks.push(pass('backenddf.exists', 'backend Dockerfile 存在'))

  const fromCount = (src.match(/^FROM /gm) ?? []).length
  checks.push(
    check(
      'backenddf.multi-stage',
      fromCount >= 4,
      `多阶段构建（${fromCount} 个 stage）`,
      `stage 数=${fromCount}`,
    ),
  )
  checks.push(
    check(
      'backenddf.frozen-install',
      src.includes('--frozen-lockfile'),
      '按 pnpm-lock.yaml frozen install',
      '缺少 --frozen-lockfile',
    ),
  )
  checks.push(
    check(
      'backenddf.prod-deps-stage',
      /pnpm install --frozen-lockfile --prod/.test(src),
      '独立 --prod 生产依赖层',
      '缺少 --prod 生产依赖层',
    ),
  )
  checks.push(
    check(
      'backenddf.targeted-build',
      src.includes('pnpm --filter @aiproj/backend build'),
      '定向 Adonis build',
      '缺少定向 build',
    ),
  )
  // .adonisjs 索引由 `node ace build` 的 init hook 生成；Lucid schema.ts 与
  // schema_rules.ts 则按官方 deterministic CI workflow 纳入版本控制。production
  // image build 不得另跑 codegen、创建 scratch DB 或重放 migrations。
  checks.push(
    check(
      'backenddf.schema-generation',
      (() => {
        const buildIdx = src.indexOf('pnpm --filter @aiproj/backend build')
        return (
          buildIdx !== -1 &&
          !src.includes('pnpm run codegen:indexes') &&
          !src.includes('node ace schema:generate') &&
          !src.includes('DB_DATABASE=/tmp/aiproj-schemagen.sqlite') &&
          repoFileExists('apps/backend/database/schema.ts') &&
          repoFileExists('apps/backend/database/schema_rules.ts')
        )
      })(),
      'tracked Lucid schema artifacts → Adonis build；build hook 生成 indexes，不重放 migrations',
      'Lucid schema artifacts 未纳入构建上下文，或 image build 仍显式 codegen/scratch schema generation',
    ),
  )
  // 构建期 heap 提升（GCP 实测默认约 2GB OOM，4096MB 通过）；禁止全局 ENV 影响 runtime。
  checks.push(
    check(
      'backenddf.build-heap',
      /RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @aiproj\/backend build/.test(src) &&
        !/^ENV NODE_OPTIONS/m.test(src),
      'build-only NODE_OPTIONS=--max-old-space-size=4096，无全局 ENV 泄漏到 runtime',
      'build 缺少 4096MB heap 前缀，或 NODE_OPTIONS 被设为全局 ENV',
    ),
  )
  checks.push(
    check(
      'backenddf.no-host-node-modules',
      !/^COPY\s+(\.\/)?node_modules/m.test(src) && !/^COPY\s+\.\s/m.test(src),
      '不复制宿主 node_modules、不做 `COPY . .` 宽拷贝',
      '发现宿主 node_modules 或宽拷贝',
    ),
  )
  checks.push(
    check(
      'backenddf.non-root',
      /^USER 10001:10001$/m.test(src),
      '固定非 root UID/GID 10001',
      '缺少 USER 10001:10001',
    ),
  )
  checks.push(
    check('backenddf.workdir', /^WORKDIR \/app$/m.test(src), 'WORKDIR=/app', '缺少 WORKDIR /app'),
  )
  checks.push(
    check(
      'backenddf.entrypoint',
      src.includes('ENTRYPOINT ["/app/docker/docker-entrypoint.sh"]') &&
        src.includes('CMD ["serve"]'),
      'ENTRYPOINT=docker-entrypoint.sh，默认 CMD=serve',
      'ENTRYPOINT/CMD 不符',
    ),
  )
  checks.push(
    check(
      'backenddf.expose',
      /^EXPOSE 3333$/m.test(src),
      'EXPOSE 3333（容器内）',
      '缺少 EXPOSE 3333',
    ),
  )
  checks.push(
    check(
      'backenddf.glibc-baseline',
      src.includes('bookworm-slim') && !/alpine/i.test(stripHashComments(src)),
      'Debian slim/glibc 基线',
      '未使用 Debian slim/glibc 基线',
    ),
  )

  // --- 3.2 显式 TS ESM loader runtime dependency ---
  const pkg = JSON.parse(readRepoFile('apps/backend/package.json')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  checks.push(
    check(
      'backenddf.tsx-runtime-dep',
      typeof pkg.dependencies?.['tsx'] === 'string',
      'tsx 是 backend 显式 runtime dependency',
      'tsx 不在 backend dependencies',
    ),
  )
  for (const ws of ['@aiproj/types', '@aiproj/compiler-spec']) {
    checks.push(
      check(
        `backenddf.ws-dep.${ws}`,
        typeof pkg.dependencies?.[ws] === 'string' && pkg.devDependencies?.[ws] === undefined,
        `${ws} 在 dependencies（runtime 必需）`,
        `${ws} 未声明为 runtime dependency`,
      ),
    )
  }
  checks.push(
    check(
      'backenddf.workspace-ts-copied',
      /^COPY packages\/types /m.test(src) && /^COPY packages\/compiler-spec /m.test(src),
      'runner 复制 workspace TS 源（.ts exports 契约）',
      'runner 未复制 workspace TS 源',
    ),
  )

  // --- 3.3/3.4 入口脚本 ---
  const entry = readRepoFile('apps/backend/docker/docker-entrypoint.sh')
  for (const action of ['init-config', 'migrate', 'serve']) {
    checks.push(
      check(
        `backenddf.entry.${action}`,
        entry.includes(`${action})`) ||
          entry.includes(`${action} |`) ||
          new RegExp(`"${action}"`).test(entry),
        `入口支持 ${action}`,
        `入口缺少 ${action}`,
      ),
    )
  }
  checks.push(
    check(
      'backenddf.entry.atomic-create',
      entry.includes('mv -n') && entry.includes('umask 077') && entry.includes('[ -s "$target" ]'),
      'init 原子 create-if-absent（存在即跳过+noclobber 兜底）',
      'init 缺少原子 create-if-absent',
    ),
  )
  checks.push(
    check(
      'backenddf.entry.fingerprint-only',
      entry.includes('sha256sum') && entry.includes('cut -c1-12'),
      'init 只输出键名/状态/sha256 前 12 位指纹',
      'init 缺少指纹输出契约',
    ),
  )
  const secretEchoPattern =
    /(echo|log)\b[^\n]*(\$\{?APP_KEY\}?|\$\{?JWT_ACCESS_SECRET\}?|\$\{?DB_PASSWORD\}?|\$\{?AIPROJ_[A-Z_]*(KEY|SECRET|PASSWORD)[A-Z_]*\}?|\$\(cat[^\n]*\)')/m
  checks.push(
    check(
      'backenddf.entry.no-secret-print',
      !secretEchoPattern.test(entry) &&
        !/\b(echo|printf)\b[^\n]*\$[A-Z_]*(KEY|SECRET|PASSWORD)/m.test(entry),
      '入口脚本不把 secret 正文写入日志',
      '入口脚本存在疑似 secret 打印',
    ),
  )
  checks.push(
    check(
      'backenddf.entry.non-root-guard',
      entry.includes('assert_non_root') && /id -u/.test(entry),
      'migrate/serve 拒绝以 root 长期运行',
      '缺少非 root 守护',
    ),
  )
  checks.push(
    check(
      'backenddf.entry.min-chown',
      entry.includes('chown 0:') &&
        entry.includes('0440') &&
        entry.includes('/app/data') &&
        entry.includes('/app/storage'),
      'init 只为 runtime-secret/SQLite/storage volume 设置最小 UID/GID 权限',
      'init 权限收敛不完整',
    ),
  )
  checks.push(
    check(
      'backenddf.entry.tsx-loader',
      entry.includes('--import') &&
        entry.includes('tsx') &&
        entry.includes('bin/console.js') &&
        entry.includes('bin/server.js'),
      'migrate/serve 以 tsx loader 执行已编译入口',
      '入口缺少 tsx loader 调用',
    ),
  )
  checks.push(
    check(
      'backenddf.entry.migrate-cmd',
      entry.includes('migration:run --force'),
      'migrate 执行 build 产物中的 migration:run --force',
      'migrate 命令不符',
    ),
  )
  const health = readRepoFile('apps/backend/docker/healthcheck.mjs')
  checks.push(
    check(
      'backenddf.healthcheck-ready',
      health.includes('/api/v1/health/ready') && health.includes('fetch('),
      'backend 容器内探针请求 /api/v1/health/ready（Node 自带 fetch）',
      'backend 探针不符合契约',
    ),
  )
  return checks
}

// ---------------------------------------------------------------------------
// task 4.x — frontend 镜像
// ---------------------------------------------------------------------------

export function checkFrontendDockerfile(): GateCheck[] {
  const checks: GateCheck[] = []
  const cfg = readRepoFile('apps/frontend/next.config.mjs')
  checks.push(
    check(
      'frontend.standalone',
      /NEXT_STANDALONE\s*===\s*'1'\s*\?\s*'standalone'/.test(cfg),
      'Next standalone output 已启用（容器构建经 NEXT_STANDALONE=1 门控）',
      'next.config.mjs 未启用 standalone',
    ),
  )
  checks.push(
    check(
      'frontend.tracing-root',
      /outputFileTracingRoot:\s*join\(appDir,\s*'\.\.\/\.\.\/'/.test(cfg),
      'monorepo file tracing root 指向仓库根',
      '缺少 outputFileTracingRoot',
    ),
  )
  checks.push(
    check(
      'frontend.webpack-preserved',
      cfg.includes('extensionAlias') && cfg.includes("transpilePackages: ['@aiproj/types']"),
      '既有 webpack alias 与 shared package transpilation 保留',
      'webpack alias/transpilePackages 被破坏',
    ),
  )

  const file = 'apps/frontend/Dockerfile'
  if (!repoFileExists(file))
    return [...checks, fail('frontenddf.exists', 'frontend Dockerfile 不存在')]
  const src = readRepoFile(file)
  checks.push(pass('frontenddf.exists', 'frontend Dockerfile 存在'))
  const frontendManifest = JSON.parse(readRepoFile('apps/frontend/package.json')) as {
    scripts?: Record<string, string>
  }
  const postinstallCommand = frontendManifest.scripts?.postinstall ?? ''
  const postinstallTarget = /^node\s+(\S+)$/.exec(postinstallCommand)?.[1]?.replace(/^\.\//, '')
  const postinstallPath = postinstallTarget ? `apps/frontend/${postinstallTarget}` : ''
  const postinstallCopy = postinstallPath ? `COPY ${postinstallPath} ${postinstallPath}` : ''
  const postinstallCopyIndex = postinstallCopy ? src.indexOf(postinstallCopy) : -1
  const filteredInstallIndex = src.indexOf(
    'RUN pnpm install --frozen-lockfile --filter @aiproj/frontend...',
  )
  checks.push(
    check(
      'frontenddf.postinstall-input',
      Boolean(postinstallPath) &&
        repoFileExists(postinstallPath) &&
        postinstallCopyIndex >= 0 &&
        filteredInstallIndex >= 0 &&
        postinstallCopyIndex < filteredInstallIndex,
      'frontend postinstall 脚本在 filtered frozen install 前进入依赖层',
      'frontend postinstall 脚本缺失、未精确 COPY，或 COPY 晚于 filtered frozen install',
    ),
  )
  checks.push(
    check(
      'frontenddf.frozen-install',
      src.includes('--frozen-lockfile'),
      '按 frozen lock 构建',
      '缺少 --frozen-lockfile',
    ),
  )
  checks.push(
    check(
      'frontenddf.relative-api-url',
      /^ENV NEXT_PUBLIC_API_URL=\/api\/v1$/m.test(src),
      'NEXT_PUBLIC_API_URL 固定为相对同源 /api/v1',
      'NEXT_PUBLIC_API_URL 未固定为 /api/v1',
    ),
  )
  checks.push(
    check(
      'frontenddf.standalone-copy',
      src.includes('.next/standalone') && src.includes('.next/static') && src.includes('/public'),
      '只复制 standalone server、static 与 public 运行产物',
      'standalone 复制不完整',
    ),
  )
  checks.push(
    check(
      'frontenddf.standalone-env',
      /^ENV NEXT_STANDALONE=1$/m.test(src),
      '容器构建期启用 standalone 输出（NEXT_STANDALONE=1）',
      '缺少 ENV NEXT_STANDALONE=1',
    ),
  )
  checks.push(
    check(
      'frontenddf.non-root',
      /^USER 10001:10001$/m.test(src),
      '固定非 root UID/GID 10001',
      '缺少 USER 10001:10001',
    ),
  )
  checks.push(
    check(
      'frontenddf.hostname',
      /^ENV HOSTNAME=0\.0\.0\.0$/m.test(src),
      'HOSTNAME=0.0.0.0',
      '缺少 HOSTNAME=0.0.0.0',
    ),
  )
  checks.push(
    check(
      'frontenddf.cmd-standalone',
      src.includes('CMD ["node", "apps/frontend/server.js"]'),
      '以 standalone server.js 启动',
      'CMD 不符',
    ),
  )
  const health = readRepoFile('apps/frontend/docker/healthcheck.mjs')
  checks.push(
    check(
      'frontenddf.healthcheck-node',
      health.includes('127.0.0.1') && health.includes('fetch('),
      'frontend 容器内 Node-based 探针请求根页面',
      'frontend 探针不符合契约',
    ),
  )
  // 禁止把内部 DNS/绝对 API 地址烘焙给浏览器；「源代码」链接（AGPL 第 13 条）指向公开仓库，
  // 本来就是给浏览器的外部地址，个人版发布时会带默认值，不在此列
  checks.push(
    check(
      'frontenddf.no-internal-dns-baked',
      !/http:\/\/backend/.test(src) && !/NEXT_PUBLIC_(?!AIPROJ_SOURCE_URL=)\S*=http/m.test(src),
      '前端构建不烘焙 backend 内部 DNS 或绝对 API URL',
      '前端构建烘焙了内部/绝对地址',
    ),
  )
  return checks
}

// ---------------------------------------------------------------------------
// task 5.x — edge 与跨主机可移植性
// ---------------------------------------------------------------------------

export function checkEdgeConfig(): GateCheck[] {
  const checks: GateCheck[] = []
  const rel = 'edge/default.conf'
  if (!repoFileExists(rel)) return [fail('edge.exists', 'edge/default.conf 不存在')]
  const src = readRepoFile(rel)
  checks.push(pass('edge.exists', 'edge/default.conf 存在'))

  checks.push(
    check(
      'edge.listen-unprivileged',
      /^[ \t]*listen 8080;/m.test(src) && !/listen 80;/m.test(src.replace(/8080/g, '')),
      '容器内监听 8080（非特权）',
      'edge 未以非特权端口监听',
    ),
  )
  checks.push(
    check(
      'edge.api-route',
      /location \/api\/v1\/ \{[^}]*proxy_pass http:\/\/backend:3333;/s.test(src),
      '/api/v1/* 转发内部 backend:3333',
      '/api/v1 转发缺失',
    ),
  )
  checks.push(
    check(
      'edge.ws-route',
      /location \/socket\.io\/ \{[^}]*proxy_pass http:\/\/backend:3333;/s.test(src) &&
        /proxy_set_header Upgrade \$http_upgrade;/.test(src) &&
        /\$aiproj_connection_upgrade/.test(src) &&
        /map \$http_upgrade/.test(src),
      'Socket.IO/WebSocket upgrade 转发内部 backend',
      'WebSocket upgrade 配置缺失',
    ),
  )
  checks.push(
    check(
      'edge.ui-route',
      /location \/ \{[^}]*proxy_pass http:\/\/frontend:3000;/s.test(src),
      '其余请求转发内部 frontend:3000',
      'UI 转发缺失',
    ),
  )
  checks.push(
    check(
      'edge.headers-host',
      /proxy_set_header Host \$host;/.test(src) && /proxy_redirect off;/.test(src),
      'Host 透传 + proxy_redirect off（内部 DNS 不进浏览器响应）',
      'Host/redirect 契约缺失',
    ),
  )
  checks.push(
    check(
      'edge.timeouts-bodysize',
      /client_max_body_size 25m;/.test(src) && /proxy_read_timeout 3600s;/.test(src),
      'body size 上限与 SSE/WS 长超时已配置',
      '超时/body size 配置缺失',
    ),
  )
  checks.push(
    check(
      'edge.sse-buffering-off',
      /location \/api\/v1\/ \{[^}]*proxy_buffering off;/s.test(src),
      'API 路径关闭代理缓冲（SSE 流式）',
      'SSE 未关闭代理缓冲',
    ),
  )
  const apiLocation = /location \/api\/v1\/ \{([^}]*)\}/s.exec(src)?.[1] ?? ''
  const apiProxyBufferSize = Number(/proxy_buffer_size (\d+)k;/.exec(apiLocation)?.[1] ?? 0)
  const apiProxyBuffers = /proxy_buffers (\d+) (\d+)k;/.exec(apiLocation)
  const apiProxyBuffersCount = Number(apiProxyBuffers?.[1] ?? 0)
  const apiProxyBuffersSize = Number(apiProxyBuffers?.[2] ?? 0)
  const apiProxyBusyBuffersSize = Number(
    /proxy_busy_buffers_size (\d+)k;/.exec(apiLocation)?.[1] ?? 0,
  )
  checks.push(
    check(
      'edge.api-response-header-buffer',
      apiProxyBufferSize >= 32,
      'API 上游响应头缓冲至少 32K（容纳 Google OAuth 成功跳转会话头）',
      'API proxy_buffer_size 小于 32K，Google OAuth 成功跳转可能被判 invalid 并返回 502',
    ),
  )
  const minimumBusyBuffer = Math.max(apiProxyBufferSize, apiProxyBuffersSize)
  const maximumBusyBuffer = (apiProxyBuffersCount - 1) * apiProxyBuffersSize
  checks.push(
    check(
      'edge.api-response-buffer-consistency',
      apiProxyBuffersCount >= 4 &&
        apiProxyBuffersSize >= 32 &&
        apiProxyBusyBuffersSize >= minimumBusyBuffer &&
        apiProxyBusyBuffersSize < maximumBusyBuffer,
      'API proxy buffer 三项满足 Nginx 启动约束',
      'API proxy_buffer_size/proxy_buffers/proxy_busy_buffers_size 组合会令 Nginx 配置校验失败',
    ),
  )
  return checks
}

export function checkPortability(): GateCheck[] {
  const checks: GateCheck[] = []
  // 部署差异只允许经环境变量/env file：部署文件不得含构建机 IP/域名/localhost backend 绝对 URL
  const deployFiles = [
    'compose.yaml',
    'compose.sqlite.yaml',
    'edge/default.conf',
    'apps/backend/Dockerfile',
    'apps/frontend/Dockerfile',
  ]
  const ipv4Literal = /\b(?!0\.0\.0\.0)(?!127\.0\.0\.1)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
  for (const file of deployFiles) {
    const src = readRepoFile(file)
    checks.push(
      check(
        `portability.no-ip.${file}`,
        !ipv4Literal.test(src),
        `${file} 无构建机/目标机 IP 字面量`,
        `${file} 含 IPv4 字面量`,
      ),
    )
    checks.push(
      check(
        `portability.no-localhost-backend.${file}`,
        !/https?:\/\/localhost:3333\/api\/v1/.test(
          src.replace(/APP_URL: \$\{AIPROJ_PUBLIC_ORIGIN:-http:\/\/localhost:3333\}/, ''),
        ) ||
          file === 'compose.yaml' ||
          file === 'compose.sqlite.yaml',
        `${file} 无烘焙给浏览器的 localhost backend 绝对 URL`,
        `${file} 含 localhost backend 绝对 URL`,
      ),
    )
  }
  // 前端产物固定相对同源
  const feDf = readRepoFile('apps/frontend/Dockerfile')
  checks.push(
    check(
      'portability.frontend-relative-only',
      /^ENV NEXT_PUBLIC_API_URL=\/api\/v1$/m.test(feDf) && !/NEXT_PUBLIC_API_URL=http/.test(feDf),
      'frontend 只以相对 /api/v1 构建',
      'frontend 存在绝对 API URL 构建',
    ),
  )
  // 前端源码侧：Realtime 相对基址推导当前 origin（design D4）
  const rt = readRepoFile('apps/frontend/lib/realtime/client.ts')
  checks.push(
    check(
      'portability.realtime-origin-derivation',
      rt.includes('window.location.origin') && rt.includes('getWsUrl'),
      'Realtime 对相对基址解析为当前浏览器 origin',
      'Realtime 缺少当前-origin 推导',
    ),
  )
  return checks
}

// ---------------------------------------------------------------------------
// task 6.6 — 默认 PG 栈静态测试
// ---------------------------------------------------------------------------

export function checkDefaultCompose(): GateCheck[] {
  const checks: GateCheck[] = []
  const doc = loadCompose('compose.yaml')
  const names = Object.keys(doc.services).sort()
  const expected = ['backend', 'edge', 'frontend', 'init-config', 'migrate', 'postgres', 'redis']
  checks.push(
    check(
      'default.services',
      JSON.stringify(names) === JSON.stringify(expected),
      `七服务集合：${names.join(', ')}`,
      `服务集合=${names.join(', ')}`,
    ),
  )

  // 依赖 DAG（阻断假成功）
  const dag: Array<[string, Record<string, string>]> = [
    ['postgres', { 'init-config': 'service_completed_successfully' }],
    [
      'migrate',
      {
        postgres: 'service_healthy',
        'init-config': 'service_completed_successfully',
        redis: 'service_healthy',
      },
    ],
    ['backend', { migrate: 'service_completed_successfully', redis: 'service_healthy' }],
    ['frontend', { backend: 'service_healthy' }],
    ['edge', { backend: 'service_healthy', frontend: 'service_healthy' }],
  ]
  for (const [svc, want] of dag) {
    const got = dependsOnConditions(doc.services[svc] ?? {})
    const match =
      Object.keys(want).length === Object.keys(got).length &&
      Object.entries(want).every(([k, v]) => got[k] === v)
    checks.push(
      check(
        `default.dag.${svc}`,
        match,
        `${svc} 依赖 ${JSON.stringify(want)}`,
        `${svc} 依赖实为 ${JSON.stringify(got)}`,
      ),
    )
  }

  // healthchecks
  const healthExpect: Array<[string, RegExp]> = [
    ['postgres', /pg_isready/],
    ['redis', /redis-cli.*ping/],
    ['backend', /healthcheck\.mjs/],
    ['frontend', /healthcheck\.mjs/],
    ['edge', /health\/live/],
  ]
  for (const [svc, re] of healthExpect) {
    const test = healthcheckTestString(doc.services[svc] ?? {})
    checks.push(
      check(
        `default.health.${svc}`,
        re.test(test),
        `${svc} healthcheck=${test.slice(0, 60)}…`,
        `${svc} healthcheck 缺失或不符：${test}`,
      ),
    )
  }

  // init/migrate 命令
  const cmdOf = (s: ComposeService) =>
    Array.isArray(s.command) ? s.command.join(' ') : String(s.command ?? '')
  checks.push(
    check(
      'default.cmd.init',
      cmdOf(doc.services['init-config'] ?? {}) === 'init-config' &&
        doc.services['init-config']?.user === '0:0',
      'init-config 一次性 job（root，仅本 job）',
      `init-config command/user=${cmdOf(doc.services['init-config'] ?? {})} ${doc.services['init-config']?.user}`,
    ),
  )
  checks.push(
    check(
      'default.cmd.migrate',
      cmdOf(doc.services['migrate'] ?? {}) === 'migrate' &&
        doc.services['migrate']?.user === '10001:10001',
      'migrate 一次性 job（非 root）',
      'migrate command/user 不符',
    ),
  )
  checks.push(
    check(
      'default.cmd.serve',
      cmdOf(doc.services['backend'] ?? {}) === 'serve' &&
        doc.services['backend']?.user === '10001:10001',
      'backend serve（非 root）',
      'backend command/user 不符',
    ),
  )

  // secret files 契约
  const pg = doc.services['postgres'] ?? {}
  const pgEnv = serviceEnv(pg)
  checks.push(
    check(
      'default.pg.password-file',
      typeof pgEnv['POSTGRES_PASSWORD_FILE'] === 'string' &&
        pgEnv['POSTGRES_PASSWORD'] === undefined,
      'PostgreSQL 使用 password-file（无明文密码变量）',
      'PostgreSQL 未使用 password-file',
    ),
  )
  const secretsMounts = ['init-config', 'postgres', 'migrate', 'backend'].map(
    (svc) =>
      [
        svc,
        serviceVolumeStrings(doc.services[svc] ?? {}).some((v) =>
          v.startsWith('runtime-secrets:/run/aiproj-secrets'),
        ),
      ] as const,
  )
  for (const [svc, mounted] of secretsMounts) {
    checks.push(
      check(
        `default.secrets.mount.${svc}`,
        mounted,
        `${svc} 挂载 runtime-secret volume`,
        `${svc} 未挂载 runtime-secret volume`,
      ),
    )
  }
  checks.push(
    check(
      'default.secrets.app-readonly',
      serviceVolumeStrings(doc.services['backend'] ?? {}).some(
        (v) => v === 'runtime-secrets:/run/aiproj-secrets:ro',
      ) &&
        serviceVolumeStrings(doc.services['migrate'] ?? {}).some(
          (v) => v === 'runtime-secrets:/run/aiproj-secrets:ro',
        ),
      'backend/migrate 只读挂载 secrets',
      'backend/migrate secrets 非只读',
    ),
  )

  // DB/Redis 变量
  for (const svc of ['migrate', 'backend']) {
    const env = serviceEnv(doc.services[svc] ?? {})
    const expect: Record<string, string> = {
      DB_CONNECTION: 'pg',
      DB_HOST: 'postgres',
      DB_PORT: '5432',
      DB_DATABASE: '${AIPROJ_POSTGRES_DB:-aiproj}',
      REDIS_ENABLED: 'true',
      REDIS_HOST: 'redis',
      LIMITER_STORE: 'redis',
    }
    for (const [k, v] of Object.entries(expect)) {
      checks.push(
        check(`default.env.${svc}.${k}`, env[k] === v, `${svc} ${k}=${v}`, `${svc} ${k}=${env[k]}`),
      )
    }
    checks.push(
      check(
        `default.env.${svc}.no-db-password-literal`,
        env['DB_PASSWORD'] === undefined,
        `${svc} 无明文 DB_PASSWORD（经 secret file export）`,
        `${svc} 含明文 DB_PASSWORD`,
      ),
    )
    checks.push(
      check(
        `default.env.${svc}.no-legacy-db-pg-database`,
        env['DB_PG_DATABASE'] === undefined,
        `${svc} 不再暴露过时的 DB_PG_DATABASE（单一 DB_DATABASE 契约）`,
        `${svc} 仍含 DB_PG_DATABASE=${env['DB_PG_DATABASE']}`,
      ),
    )
  }
  // 三方库名一致：postgres.POSTGRES_DB === migrate.DB_DATABASE === backend.DB_DATABASE
  // （Compose 插值未求值，三方同一 ${AIPROJ_POSTGRES_DB:-aiproj} 字面量即渲染后同值）
  {
    const migrateEnv = serviceEnv(doc.services['migrate'] ?? {})
    const backendEnv = serviceEnv(doc.services['backend'] ?? {})
    const trio = [pgEnv['POSTGRES_DB'], migrateEnv['DB_DATABASE'], backendEnv['DB_DATABASE']]
    checks.push(
      check(
        'default.env.db-name-trio',
        typeof trio[0] === 'string' && trio[0] === trio[1] && trio[1] === trio[2],
        `POSTGRES_DB=migrate.DB_DATABASE=backend.DB_DATABASE（${trio[0]}）`,
        `库名三方不一致：POSTGRES_DB=${trio[0]} migrate=${trio[1]} backend=${trio[2]}`,
      ),
    )
  }

  // volumes / network / restart
  const volumes = Object.keys(doc.volumes ?? {}).sort()
  checks.push(
    check(
      'default.volumes',
      JSON.stringify(volumes) ===
        JSON.stringify(['pgdata', 'redis-data', 'runtime-secrets', 'storage']),
      `volumes：${volumes.join(', ')}`,
      `volumes=${volumes.join(', ')}`,
    ),
  )
  checks.push(
    check(
      'default.volume.pgdata',
      serviceVolumeStrings(pg).some((v) => v.startsWith('pgdata:/var/lib/postgresql/data')),
      'PG data volume 持久化',
      'PG data volume 缺失',
    ),
  )
  checks.push(
    check(
      'default.volume.redis',
      serviceVolumeStrings(doc.services['redis'] ?? {}).some((v) =>
        v.startsWith('redis-data:/data'),
      ),
      'Redis AOF data volume 持久化',
      'Redis data volume 缺失',
    ),
  )
  checks.push(
    check(
      'default.volume.storage',
      serviceVolumeStrings(doc.services['backend'] ?? {}).some((v) =>
        v.startsWith('storage:/app/storage'),
      ),
      'storage volume（uploads/正式资料）挂载 backend',
      'storage volume 缺失',
    ),
  )
  checks.push(
    check(
      'default.volume.redis-aof',
      (Array.isArray(doc.services['redis']?.command)
        ? doc.services['redis'].command.join(' ')
        : ''
      ).includes('--appendonly yes'),
      'Redis AOF 开启',
      'Redis AOF 未开启',
    ),
  )
  const networks = Object.keys(doc.networks ?? {})
  checks.push(
    check(
      'default.network',
      networks.includes('aiproj'),
      `隔离 network：${networks.join(', ')}`,
      '缺少隔离 network',
    ),
  )
  for (const svc of ['postgres', 'redis', 'backend', 'frontend', 'edge']) {
    checks.push(
      check(
        `default.restart.${svc}`,
        doc.services[svc]?.restart === 'unless-stopped',
        `${svc} restart=unless-stopped`,
        `${svc} restart=${doc.services[svc]?.restart}`,
      ),
    )
  }
  for (const svc of ['init-config', 'migrate']) {
    checks.push(
      check(
        `default.restart.${svc}`,
        doc.services[svc]?.restart === 'no',
        `${svc} restart=no（一次性）`,
        `${svc} restart 不符`,
      ),
    )
  }
  return checks
}

// ---------------------------------------------------------------------------
// task 7.4 — SQLite 栈静态测试
// ---------------------------------------------------------------------------

export function checkSqliteCompose(): GateCheck[] {
  const checks: GateCheck[] = []
  const doc = loadCompose('compose.sqlite.yaml')
  const names = Object.keys(doc.services).sort()
  checks.push(
    check(
      'sqlite.services',
      JSON.stringify(names) ===
        JSON.stringify(['backend', 'edge', 'frontend', 'init-config', 'migrate', 'redis']),
      `六服务集合（无 postgres）：${names.join(', ')}`,
      `服务集合=${names.join(', ')}`,
    ),
  )
  // 零 PostgreSQL：以解析后的 Compose 结构为准（注释不含约束效力）
  const allServices = Object.values(doc.services)
  const allEnvKeys = allServices.flatMap((s) => Object.keys(serviceEnv(s)))
  const allVolumeKeys = Object.keys(doc.volumes ?? {})
  const anyPg =
    names.includes('postgres') ||
    allVolumeKeys.some((v) => /pgdata/i.test(v)) ||
    allEnvKeys.some((k) => /^POSTGRES_/.test(k) || k === 'DB_HOST' || k === 'DB_PG_DATABASE') ||
    allServices.some((s) => typeof s.image === 'string' && /postgres/i.test(s.image))
  checks.push(
    check(
      'sqlite.zero-pg',
      !anyPg,
      '零 PG service/dependency/host/env/volume',
      'SQLite 栈仍引用 PostgreSQL',
    ),
  )
  for (const svc of ['migrate', 'backend']) {
    const env = serviceEnv(doc.services[svc] ?? {})
    checks.push(
      check(
        `sqlite.env.${svc}.connection`,
        env['DB_CONNECTION'] === 'sqlite' && env['DB_DATABASE'] === '/app/data/database.sqlite',
        `${svc} DB_CONNECTION=sqlite DB_DATABASE=/app/data/database.sqlite`,
        `${svc} DB env=${env['DB_CONNECTION']} ${env['DB_DATABASE']}`,
      ),
    )
    checks.push(
      check(
        `sqlite.volume.${svc}.data`,
        serviceVolumeStrings(doc.services[svc] ?? {}).some((v) =>
          v.startsWith('sqlite-data:/app/data'),
        ),
        `${svc} 挂载 sqlite-data volume`,
        `${svc} 未挂载 sqlite-data volume`,
      ),
    )
  }
  const dag: Array<[string, Record<string, string>]> = [
    ['migrate', { 'init-config': 'service_completed_successfully', redis: 'service_healthy' }],
    ['backend', { migrate: 'service_completed_successfully', redis: 'service_healthy' }],
    ['frontend', { backend: 'service_healthy' }],
    ['edge', { backend: 'service_healthy', frontend: 'service_healthy' }],
  ]
  for (const [svc, want] of dag) {
    const got = dependsOnConditions(doc.services[svc] ?? {})
    const match =
      Object.keys(want).length === Object.keys(got).length &&
      Object.entries(want).every(([k, v]) => got[k] === v)
    checks.push(
      check(
        `sqlite.dag.${svc}`,
        match,
        `${svc} 依赖闸门正确`,
        `${svc} 依赖实为 ${JSON.stringify(got)}`,
      ),
    )
  }
  checks.push(
    check(
      'sqlite.init.skip-pg',
      serviceEnv(doc.services['init-config'] ?? {})['AIPROJ_INIT_POSTGRES'] === 'false',
      'init-config 不生成 PG password',
      'init-config 未关闭 PG secret',
    ),
  )
  const volumes = Object.keys(doc.volumes ?? {}).sort()
  checks.push(
    check(
      'sqlite.volumes',
      JSON.stringify(volumes) ===
        JSON.stringify(['redis-data', 'runtime-secrets', 'sqlite-data', 'storage']),
      `volumes：${volumes.join(', ')}`,
      `volumes=${volumes.join(', ')}`,
    ),
  )
  return checks
}

// ---------------------------------------------------------------------------
// task 7.5 — 两栈共同不变量比较（防重复定义漂移）
// ---------------------------------------------------------------------------

export function checkComposeParity(): GateCheck[] {
  const checks: GateCheck[] = []
  const a = loadCompose('compose.yaml')
  const b = loadCompose('compose.sqlite.yaml')

  for (const svc of ['backend', 'migrate']) {
    const buildA = a.services[svc]?.build
    const buildB = b.services[svc]?.build
    const dfA = typeof buildA === 'object' ? buildA?.dockerfile : undefined
    const dfB = typeof buildB === 'object' ? buildB?.dockerfile : undefined
    checks.push(
      check(
        `parity.backend-image.${svc}`,
        dfA === 'apps/backend/Dockerfile' &&
          dfB === dfA &&
          a.services[svc]?.image === b.services[svc]?.image,
        `${svc} 共用 backend Dockerfile 与镜像名`,
        `${svc} 镜像定义漂移：${dfA} vs ${dfB}`,
      ),
    )
  }
  const feA = a.services['frontend']?.build
  const feB = b.services['frontend']?.build
  checks.push(
    check(
      'parity.frontend-image',
      typeof feA === 'object' &&
        typeof feB === 'object' &&
        feA.dockerfile === 'apps/frontend/Dockerfile' &&
        feB.dockerfile === feA.dockerfile &&
        a.services['frontend']?.image === b.services['frontend']?.image,
      'frontend 共用 Dockerfile 与镜像名',
      'frontend 镜像定义漂移',
    ),
  )

  const edgeA = JSON.stringify({
    ports: a.services['edge']?.ports,
    volumes: a.services['edge']?.volumes,
    image: a.services['edge']?.image,
  })
  const edgeB = JSON.stringify({
    ports: b.services['edge']?.ports,
    volumes: b.services['edge']?.volumes,
    image: b.services['edge']?.image,
  })
  checks.push(
    check('parity.edge', edgeA === edgeB, 'edge 服务两栈一致（单一公开端口）', 'edge 服务漂移'),
  )

  for (const svc of ['backend', 'migrate']) {
    checks.push(
      check(
        `parity.non-root.${svc}`,
        a.services[svc]?.user === '10001:10001' && b.services[svc]?.user === '10001:10001',
        `${svc} 两栈均非 root`,
        `${svc} user 漂移`,
      ),
    )
    checks.push(
      check(
        `parity.secrets-ro.${svc}`,
        serviceVolumeStrings(a.services[svc] ?? {}).includes(
          'runtime-secrets:/run/aiproj-secrets:ro',
        ) &&
          serviceVolumeStrings(b.services[svc] ?? {}).includes(
            'runtime-secrets:/run/aiproj-secrets:ro',
          ),
        `${svc} 两栈均只读挂载 secrets`,
        `${svc} secrets 挂载漂移`,
      ),
    )
  }
  for (const svc of ['backend', 'frontend', 'edge', 'redis']) {
    const hA = healthcheckTestString(a.services[svc] ?? {})
    const hB = healthcheckTestString(b.services[svc] ?? {})
    checks.push(
      check(
        `parity.health.${svc}`,
        hA === hB && hA.length > 0,
        `${svc} 两栈 healthcheck 一致`,
        `${svc} healthcheck 漂移`,
      ),
    )
  }
  const redisA = JSON.stringify({
    image: a.services['redis']?.image,
    command: a.services['redis']?.command,
  })
  const redisB = JSON.stringify({
    image: b.services['redis']?.image,
    command: b.services['redis']?.command,
  })
  checks.push(
    check(
      'parity.redis',
      redisA === redisB,
      'Redis 两栈一致（固定 major + AOF）',
      'Redis 定义漂移',
    ),
  )

  // 数据库 volume 不误共享
  const volA = Object.keys(a.volumes ?? {})
  const volB = Object.keys(b.volumes ?? {})
  checks.push(
    check(
      'parity.db-volume-separation',
      volA.includes('pgdata') &&
        !volA.includes('sqlite-data') &&
        volB.includes('sqlite-data') &&
        !volB.includes('pgdata'),
      'PG 栈 pgdata 与 SQLite 栈 sqlite-data 严格分离',
      '数据库 volume 存在误共享风险',
    ),
  )

  // 敏感信息不变量：两个文件的 Compose 解析结果不得含 secret 正文形态。
  // `*_FILE` 键是容器 secret 文件契约（值为路径，非正文），显式豁免。
  for (const [label, doc] of [
    ['compose.yaml', a],
    ['compose.sqlite.yaml', b],
  ] as const) {
    for (const [svc, service] of Object.entries(doc.services)) {
      const env = serviceEnv(service)
      const suspicious = Object.entries(env).filter(
        ([k, v]) =>
          /(SECRET|PASSWORD|APP_KEY)/.test(k) &&
          !k.endsWith('_FILE') &&
          v !== '' &&
          !v.startsWith('${AIPROJ_'),
      )
      checks.push(
        check(
          `parity.no-secret-literal.${label}.${svc}`,
          suspicious.length === 0,
          `${label} ${svc} 环境变量无 secret 字面值`,
          `${label} ${svc} 存在疑似 secret 字面值键：${suspicious.map(([k]) => k).join(',')}`,
        ),
      )
    }
  }
  return checks
}

// ---------------------------------------------------------------------------
// task 10.8 — 文档一致性
// ---------------------------------------------------------------------------

export function checkDocsConsistency(): GateCheck[] {
  const checks: GateCheck[] = []
  const entryDocs = [
    'AGENTS.md',
    'CLAUDE.md',
    'docs/README.md',
    '.env.example',
    'apps/backend/.env.example',
    'docs/v2-v3/planning/v3-development-baseline.md',
    'docs/v2-v3/planning/v3-release-map.md',
  ]
  // 「容器化持续延期」类绝对化措辞：存在时必须同时提及已授权的本 change
  const banPattern =
    /(不引入[^。\n]*Docker|禁止[^。\n]*Docker|Docker[^。\n]*(先不做|持续延期)|容器化[^。\n]*(先不做|持续延期))/
  for (const file of entryDocs) {
    const src = readRepoFile(file)
    const hasBan = banPattern.test(src)
    const hasAuthorization = src.includes('v3-docker-compose-runtime-foundation')
    checks.push(
      check(
        `docs.no-contradiction.${file}`,
        !hasBan || hasAuthorization,
        `${file} 无「绝对禁止 Docker」与授权状态矛盾`,
        `${file} 含容器化绝对延期措辞但未提及本 change 授权`,
      ),
    )
  }
  // 运行手册不得越级宣称（肯定式宣称才命中；non-goals 中的否定式排除说明允许存在）
  const runbook = 'docs/v2-v3/runbook/docker-compose-target-host.md'
  if (repoFileExists(runbook)) {
    const src = readRepoFile(runbook)
    const overclaims = [
      /(已实现|提供|支持|内置)[^。\n]{0,12}(高可用|\bHA\b)/,
      /(已实现|提供|支持|内置)[^。\n]{0,12}Kubernetes/i,
      /(已实现|提供|支持|内置)[^。\n]{0,12}自动 TLS/,
      /完整公网生产(部署|方案)/,
      /V3 GA(已|达成|完成)/,
    ]
    const hits = overclaims.filter((re) => re.test(src))
    checks.push(
      check(
        'docs.runbook.no-overclaim',
        hits.length === 0,
        'runbook 不越级宣称 HA/完整公网生产部署/V3 GA',
        `runbook 越级宣称：${hits.map((r) => r.source).join(', ')}`,
      ),
    )
    checks.push(
      check(
        'docs.runbook.exists',
        src.includes('docker compose up -d --build') && src.includes('compose.sqlite.yaml'),
        'runbook 含默认与 SQLite 单命令入口',
        'runbook 缺少单命令入口说明',
      ),
    )
  } else {
    checks.push(fail('docs.runbook.exists', `${runbook} 不存在`))
  }
  return checks
}

// ---------------------------------------------------------------------------
// v3-docker-google-oauth-runtime-wiring —— Google OAuth 接线静态合同
// ---------------------------------------------------------------------------

export function checkGoogleOAuthWiring(): GateCheck[] {
  const checks: GateCheck[] = []

  // --- override 文件存在且只替换 top-level secret source ---
  const overrideRel = 'compose.oauth.yaml'
  if (!repoFileExists(overrideRel)) {
    return [fail('oauth.override.exists', `${overrideRel} 不存在`)]
  }
  const overrideSource = readRepoFile(overrideRel)
  const overrideDoc = loadCompose(overrideRel)
  checks.push(pass('oauth.override.exists', `${overrideRel} 存在且可解析`))

  const overrideServices = Object.keys(overrideDoc.services ?? {})
  checks.push(
    check(
      'oauth.override.no-service-mutation',
      overrideServices.length === 0,
      'override 不修改任何 service，只替换 top-level secret source',
      `override 意外修改 service：${overrideServices.join(',')}`,
    ),
  )

  const overrideSecretFile = overrideDoc.secrets?.['google-oauth-client']?.file ?? ''
  checks.push(
    check(
      'oauth.override.secret-source-required',
      /^\$\{AIPROJ_GOOGLE_OAUTH_SECRET_FILE:/.test(overrideSecretFile),
      'override 只用 ${AIPROJ_GOOGLE_OAUTH_SECRET_FILE:?…} 替换 secret source',
      'override secret source 不是 AIPROJ_GOOGLE_OAUTH_SECRET_FILE 强制插值',
    ),
  )
  checks.push(
    check(
      'oauth.override.single-secret',
      Object.keys(overrideDoc.secrets ?? {}).length === 1,
      'override 只定义 google-oauth-client secret',
      'override 定义了额外 secret，可能扩大凭据面',
    ),
  )

  // override 原始文本不得含任何非注释的 client_id/client_secret/private_key 字面量
  const stripped = stripHashComments(overrideSource)
  const secretShapeHits = /(client_secret|client_id|private_key)\s*[:=]/.exec(stripped)
  checks.push(
    check(
      'oauth.override.no-secret-literal',
      secretShapeHits === null,
      'override 不携带任何凭据字段字面量（只引用 host 文件变量）',
      `override 含凭据字段：${secretShapeHits?.[0] ?? ''}`,
    ),
  )

  // --- 部署默认值：私人部署的正式域名与默认 secret source。
  // 开源个人版导出时，清单替换规则把这三行改成本机地址与「未配置即停用」的占位凭据
  // （edition/personal.manifest.json）；集中在这里，替换规则只需要改这几行。
  const DEPLOY_DEFAULT_ORIGIN = 'http://localhost'
  const DEPLOY_SECRET_SOURCE =
    '${AIPROJ_GOOGLE_OAUTH_SECRET_FILE:-./fixtures/google-oauth/unconfigured.json}'
  const DEPLOY_CLIENT_JSON_PATH =
    '${AIPROJ_GOOGLE_OAUTH_SECRET_FILE:+/run/secrets/google-oauth-client.json}'

  // --- 主 compose 两栈：默认 secret + backend 公开回调 env + backend-only ---
  const expectedEnv: Record<string, string> = {
    APP_URL: `\${AIPROJ_PUBLIC_ORIGIN:-${DEPLOY_DEFAULT_ORIGIN}}`,
    FRONTEND_URL: `\${AIPROJ_PUBLIC_ORIGIN:-${DEPLOY_DEFAULT_ORIGIN}}`,
    GOOGLE_OAUTH_CLIENT_JSON_PATH: DEPLOY_CLIENT_JSON_PATH,
    GOOGLE_OAUTH_REDIRECT_URI: `\${AIPROJ_GOOGLE_OAUTH_ORIGIN:-${DEPLOY_DEFAULT_ORIGIN}}/api/v1/auth/google/callback`,
    GOOGLE_AUTH_SUCCESS_REDIRECT_URL: `\${AIPROJ_GOOGLE_OAUTH_ORIGIN:-${DEPLOY_DEFAULT_ORIGIN}}/auth/google/callback`,
    GOOGLE_AUTH_FAILURE_REDIRECT_URL: `\${AIPROJ_GOOGLE_OAUTH_ORIGIN:-${DEPLOY_DEFAULT_ORIGIN}}/login`,
  }
  for (const rel of ['compose.yaml', 'compose.sqlite.yaml'] as const) {
    if (!repoFileExists(rel)) {
      checks.push(fail(`oauth.main.exists.${rel}`, `${rel} 不存在`))
      continue
    }
    const doc = loadCompose(rel)
    const backendEnv = serviceEnv(doc.services['backend'] ?? {})
    const declaredSecretFile = doc.secrets?.['google-oauth-client']?.file
    checks.push(
      check(
        `oauth.main.secret-source.${rel}`,
        declaredSecretFile === DEPLOY_SECRET_SOURCE,
        `${rel} 默认 secret source 符合部署默认值`,
        `${rel} 默认 secret source 缺失或漂移`,
      ),
    )
    for (const [key, expected] of Object.entries(expectedEnv)) {
      checks.push(
        check(
          `oauth.main.backend-env.${rel}.${key}`,
          backendEnv[key] === expected,
          `${rel} backend ${key} 契约正确`,
          `${rel} backend ${key} 缺失或漂移：${backendEnv[key] ?? '(缺失)'}`,
        ),
      )
    }
    for (const [svc, service] of Object.entries(doc.services)) {
      const googleKeys = Object.keys(serviceEnv(service)).filter((k) => k.startsWith('GOOGLE_'))
      const secretRefs = service.secrets ?? []
      const oauthRefs = secretRefs.filter((ref) =>
        typeof ref === 'string'
          ? ref === 'google-oauth-client'
          : ref.source === 'google-oauth-client',
      )
      checks.push(
        check(
          `oauth.main.env-backend-only.${rel}.${svc}`,
          svc === 'backend' || googleKeys.length === 0,
          `${rel} ${svc} 不含 GOOGLE_* env`,
          `${rel} ${svc} 意外含 GOOGLE_*：${googleKeys.join(',')}`,
        ),
      )
      checks.push(
        check(
          `oauth.main.secret-backend-only.${rel}.${svc}`,
          svc === 'backend' ? oauthRefs.length === 1 : oauthRefs.length === 0,
          `${rel} ${svc} Google OAuth secret 可见性正确`,
          `${rel} ${svc} Google OAuth secret 可见性错误`,
        ),
      )
      if (svc === 'backend') {
        const ref = oauthRefs[0]
        checks.push(
          check(
            `oauth.main.secret-target.${rel}`,
            typeof ref === 'object' && ref.target === 'google-oauth-client.json',
            `${rel} backend secret target 固定为 /run/secrets/google-oauth-client.json`,
            `${rel} backend secret target 缺失或漂移`,
          ),
        )
      }
    }
  }

  // --- 两栈 parity：OAuth env 完全一致 ---
  const pgBackend = serviceEnv(loadCompose('compose.yaml').services['backend'] ?? {})
  const sqliteBackend = serviceEnv(loadCompose('compose.sqlite.yaml').services['backend'] ?? {})
  const oauthKeys = Object.keys(expectedEnv)
  checks.push(
    check(
      'oauth.parity.backend-env',
      oauthKeys.every((k) => pgBackend[k] === sqliteBackend[k] && pgBackend[k] !== undefined),
      '两栈 backend OAuth env 完全一致（PG/SQLite parity）',
      '两栈 backend OAuth env 漂移',
    ),
  )
  checks.push(
    check(
      'oauth.parity.override-shared',
      /^\$\{AIPROJ_GOOGLE_OAUTH_SECRET_FILE:/.test(overrideSecretFile),
      '两栈共用同一 compose.oauth.yaml secret-source override',
      'override 未定义强制 host secret source',
    ),
  )

  // --- .env.compose.example：host 示例与绝不填真值 ---
  const exampleRel = '.env.compose.example'
  const exampleSource = repoFileExists(exampleRel) ? readRepoFile(exampleRel) : ''
  checks.push(
    check(
      'oauth.compose-example.exists',
      repoFileExists(exampleRel),
      '.env.compose.example 存在',
      '.env.compose.example 缺失',
    ),
  )
  checks.push(
    check(
      'oauth.compose-example.host-examples',
      exampleSource.includes('C:/secure/google-oauth-client.json') &&
        exampleSource.includes('/etc/aiproj/google-oauth-client.json') &&
        exampleSource.includes('AIPROJ_GOOGLE_OAUTH_SECRET_FILE'),
      '.env.compose.example 给出 Windows/Linux host 路径示例',
      '缺少 Windows/Linux host 示例或变量说明',
    ),
  )
  checks.push(
    check(
      'oauth.compose-example.no-real-value',
      !/^\s*AIPROJ_GOOGLE_OAUTH_SECRET_FILE\s*=\s*([^\s#])/m.test(exampleSource),
      'AIPROJ_GOOGLE_OAUTH_SECRET_FILE 仅为注释示例，无未注释真实值',
      '.env.compose.example 含未注释的真实 secret 路径值',
    ),
  )

  // --- 镜像层零泄密：Dockerfile 不得 COPY 任何 google oauth JSON / storage/secrets ---
  const backendDf = 'apps/backend/Dockerfile'
  if (repoFileExists(backendDf)) {
    const dfSource = readRepoFile(backendDf)
    const dfStripped = stripHashComments(dfSource)
    checks.push(
      check(
        'oauth.image.no-copy-secret',
        !/COPY\s+[^\n]*(google-oauth|client_secret|storage\/secrets)/.test(dfStripped) &&
          !/ADD\s+[^\n]*(google-oauth|client_secret|storage\/secrets)/.test(dfStripped),
        'Dockerfile 不 COPY/ADD 任何 OAuth JSON 或 storage/secrets 路径',
        'Dockerfile 出现 OAuth secret 拷贝指令',
      ),
    )
  }

  return checks
}

// ---------------------------------------------------------------------------
// 汇总入口（供 CLI 门禁与 vitest spec 共用）
// ---------------------------------------------------------------------------

export interface StaticGateSection {
  section: string
  checks: GateCheck[]
}

export function runAllStaticChecks(): StaticGateSection[] {
  return [
    { section: 'dockerignore', checks: checkDockerIgnore() },
    { section: 'version-pins', checks: checkVersionPins() },
    { section: 'env-compose-example', checks: checkEnvComposeExample() },
    { section: 'backend-dockerfile', checks: checkBackendDockerfile() },
    { section: 'frontend-dockerfile', checks: checkFrontendDockerfile() },
    { section: 'edge-config', checks: checkEdgeConfig() },
    { section: 'portability', checks: checkPortability() },
    { section: 'default-compose', checks: checkDefaultCompose() },
    { section: 'sqlite-compose', checks: checkSqliteCompose() },
    { section: 'compose-parity', checks: checkComposeParity() },
    { section: 'google-oauth-wiring', checks: checkGoogleOAuthWiring() },
    { section: 'docs-consistency', checks: checkDocsConsistency() },
  ]
}

export function summarizeStatic(sections: StaticGateSection[]): { total: number; failed: number } {
  let total = 0
  let failed = 0
  for (const s of sections) {
    for (const c of s.checks) {
      total += 1
      if (!c.ok) failed += 1
    }
  }
  return { total, failed }
}
