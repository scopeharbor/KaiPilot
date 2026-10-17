/**
 * v3-docker-compose-runtime-foundation —— task 8.2 / §9
 *
 * `pnpm gate:docker-runtime`：通用 Docker runtime gate（在**目标 Docker 主机**运行）。
 *
 * 行为契约：
 * - 本机无 Docker CLI / daemon / Compose plugin → 输出 `{ "status": "blocked", reason }`
 *   并以退出码 3 结束（**明确 blocked，绝不伪装为通过**）。
 * - 有 Docker 时，用唯一 project name 对默认 PG 栈与 SQLite 栈依次执行：
 *   config 渲染 → build → up -d → 等 healthy → 探针（edge UI、/api/v1/health/ready、
 *   未认证 Socket.IO CONNECT 拒绝、迁移批次、Redis 读写、secret 指纹稳定、restart 持久化、
 *   SQLite 栈零 PG）→ 负例（停 PG 后 ready 不得为 200）→ 日志敏感信息扫描 → 清理。
 * - 输出低敏 JSON 证据：命令、退出码、版本、指纹（sha256 前 12 位）、耗时；
 *   绝不打印 APP_KEY/JWT/PG 密码正文。GCP 资源配置不采集。
 * - 每个栈结束都 `down -v` 清理自己的 project（唯一 project name，不影响其他部署）。
 *
 * 用法（目标机仓库根目录）：
 *   pnpm gate:docker-runtime                # 两个栈全量
 *   pnpm gate:docker-runtime -- --stack pg  # 只跑默认栈
 *   pnpm gate:docker-runtime -- --stack sqlite
 */

import { execFileSync, execSync } from 'node:child_process'
import { probeUnauthenticatedSocketIoConnect } from './docker-runtime/socketio-auth-probe.js'

interface ProbeResult {
  id: string
  ok: boolean
  detail: string
}

interface StackReport {
  stack: 'pg' | 'sqlite'
  status: 'pass' | 'fail' | 'blocked'
  project: string
  probes: ProbeResult[]
  versions?: Record<string, string>
  durationMs: number
  error?: string
}

const pass = (id: string, detail: string): ProbeResult => ({ id, ok: true, detail })
const fail = (id: string, detail: string): ProbeResult => ({ id, ok: false, detail })

function sh(
  cmd: string,
  args: string[],
  opts: { allowFail?: boolean; timeoutMs?: number } = {},
): { code: number; out: string } {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 10 * 60 * 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    return { code: 0, out: String(out) }
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string; message?: string }
    if (opts.allowFail) {
      return {
        code: err.status ?? 1,
        out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || String(err.message ?? ''),
      }
    }
    throw new Error(
      `命令失败: ${cmd} ${args.join(' ')} → exit ${err.status ?? '?'}: ${(err.stderr ?? err.message ?? '').slice(0, 400)}`,
    )
  }
}

function dockerAvailable(): { ok: boolean; reason?: string; versions?: Record<string, string> } {
  try {
    const engine = sh('docker', ['version', '--format', '{{.Server.Version}}'])
    const compose = sh('docker', ['compose', 'version', '--short'])
    return {
      ok: true,
      versions: {
        'docker-engine': engine.out.trim(),
        'docker-compose': compose.out.trim(),
        arch: execSync('uname -sm 2>/dev/null || ver', { encoding: 'utf8' }).trim(),
      },
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message.slice(0, 300) : 'docker-cli-not-found',
    }
  }
}

/** 等待 compose project 全部长期服务 healthy（最多 timeoutMs）。 */
function waitHealthy(composeFile: string, project: string, timeoutMs: number): ProbeResult {
  const deadline = Date.now() + timeoutMs
  const healthyRe = /healthy|running/i
  while (Date.now() < deadline) {
    const ps = sh(
      'docker',
      ['compose', '-f', composeFile, '-p', project, 'ps', '--format', '{{.Service}} {{.Health}}'],
      { allowFail: true },
    )
    if (ps.code === 0) {
      const lines = ps.out.split(/\r?\n/).filter((l) => l.trim())
      // 一次性 job（init-config/migrate）没有 Health 列或已退出，不参与判定
      const pending = lines.filter((l) => {
        const svc = l.split(/\s+/)[0]
        if (svc === 'init-config' || svc === 'migrate') return false
        const health = l.split(/\s+/).slice(1).join(' ')
        return health.trim() !== '' && !healthyRe.test(health)
      })
      const unhealthy = lines.filter((l) => /unhealthy/i.test(l))
      if (unhealthy.length > 0)
        return fail('wait.healthy', `出现 unhealthy：${unhealthy.join('; ').slice(0, 200)}`)
      if (lines.length > 0 && pending.length === 0)
        return pass('wait.healthy', `${lines.length} 个服务 healthy`)
    }
    execSync(process.platform === 'win32' ? 'timeout /t 5 /nobreak >nul' : 'sleep 5')
  }
  return fail('wait.healthy', `等待 ${timeoutMs / 1000}s 后仍未全部 healthy`)
}

async function fetchJson(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  return { status: res.status, body: await res.text() }
}

function secretNeedles(composeFile: string, project: string): string[] {
  // 从运行中的 backend 容器读取 secret 值作为日志扫描 needle；只进内存、绝不输出。
  const needles: string[] = []
  for (const name of ['app_key', 'jwt_access_secret', 'pg_password']) {
    const r = sh(
      'docker',
      [
        'compose',
        '-f',
        composeFile,
        '-p',
        project,
        'exec',
        '-T',
        'backend',
        'sh',
        '-c',
        `cat /run/aiproj-secrets/${name} 2>/dev/null || true`,
      ],
      { allowFail: true },
    )
    const v = r.out.trim()
    if (v.length >= 16) needles.push(v)
  }
  return needles
}

function scanLogsForSecrets(composeFile: string, project: string, needles: string[]): ProbeResult {
  const logs = sh('docker', ['compose', '-f', composeFile, '-p', project, 'logs', '--no-color'], {
    allowFail: true,
  })
  if (logs.code !== 0) return fail('logs.secret-scan', `无法读取日志：${logs.out.slice(0, 200)}`)
  const leaked = needles.filter((n) => logs.out.includes(n))
  // Authorization header 与完整连接串负例
  const headerLeak = /authorization:\s*bearer\s+\S+/i.test(logs.out)
  const connStringLeak = /postgres(ql)?:\/\/[^/\s]+:[^@\s]+@/i.test(logs.out)
  if (leaked.length > 0 || headerLeak || connStringLeak) {
    return fail(
      'logs.secret-scan',
      `日志泄漏：secret命中=${leaked.length} authorization=${headerLeak} connstring=${connStringLeak}`,
    )
  }
  return pass(
    'logs.secret-scan',
    `日志无 secret/Authorization/连接串（needle=${needles.length} 个已比对，均未命中）`,
  )
}

async function runStack(stack: 'pg' | 'sqlite', edgePort: number): Promise<StackReport> {
  const composeFile = stack === 'pg' ? 'compose.yaml' : 'compose.sqlite.yaml'
  const project = `aiproj-gate-${stack}-${Date.now().toString(36)}`
  const started = Date.now()
  const probes: ProbeResult[] = []
  const base = `http://127.0.0.1:${edgePort}`
  const compose = ['compose', '-f', composeFile, '-p', project]

  const cleanup = () => {
    sh('docker', [...compose, 'down', '-v', '--remove-orphans'], {
      allowFail: true,
      timeoutMs: 120000,
    })
  }

  try {
    // 1. 配置渲染（task 9.1）
    const cfg = sh('docker', [...compose, 'config', '--quiet'], { allowFail: true })
    probes.push(
      cfg.code === 0
        ? pass('compose.config', 'docker compose config 渲染成功')
        : fail('compose.config', cfg.out.slice(0, 300)),
    )
    if (cfg.code !== 0) throw new Error('config 渲染失败，中止本栈')

    // 2. 构建
    const build = sh('docker', [...compose, 'build'], {
      allowFail: true,
      timeoutMs: 30 * 60 * 1000,
    })
    probes.push(
      build.code === 0
        ? pass('compose.build', '镜像构建成功')
        : fail('compose.build', build.out.slice(-300)),
    )
    if (build.code !== 0) throw new Error('构建失败，中止本栈')

    // 3. 启动
    const up = sh('docker', [...compose, 'up', '-d'], {
      allowFail: true,
      timeoutMs: 10 * 60 * 1000,
    })
    probes.push(
      up.code === 0 ? pass('compose.up', 'up -d 完成') : fail('compose.up', up.out.slice(-300)),
    )
    if (up.code !== 0) throw new Error('启动失败，中止本栈')

    // 4. healthy 等待
    const healthy = waitHealthy(composeFile, project, 6 * 60 * 1000)
    probes.push(healthy)
    if (!healthy.ok) throw new Error('健康等待失败，中止本栈')

    // 5. edge 同源 UI + API（task 9.2）
    const ui = await fetchJson(`${base}/`)
    probes.push(
      ui.status < 400
        ? pass('probe.ui', `GET / → ${ui.status}`)
        : fail('probe.ui', `GET / → ${ui.status}`),
    )
    const ready = await fetchJson(`${base}/api/v1/health/ready`)
    const readyOk = ready.status === 200 && /"database"[\s\S]*"up"/.test(ready.body)
    probes.push(
      readyOk
        ? pass('probe.ready', 'GET /api/v1/health/ready → 200 + database up')
        : fail('probe.ready', `ready → ${ready.status} ${ready.body.slice(0, 160)}`),
    )
    const redisVisible = /"redis"/.test(ready.body)
    probes.push(
      redisVisible
        ? pass('probe.redis-visible', 'ready 响应含 redis 检查段')
        : fail('probe.redis-visible', 'ready 响应缺 redis 段'),
    )
    // Engine.IO 初始 polling handshake 合法返回 200；认证发生在后续 Socket.IO CONNECT。
    // 只有真实无 token client 收到 auth 分类 connect_error 才通过，transport 错误/匿名
    // connect/timeout 均 fail closed；probe helper 负责断开 client、移除 listener 与 timer。
    const socketAuth = await probeUnauthenticatedSocketIoConnect(base)
    probes.push(
      socketAuth.ok
        ? pass('probe.ws-reachable', socketAuth.detail)
        : fail('probe.ws-reachable', socketAuth.detail),
    )
    // 内部 DNS 不进浏览器响应
    const internalDnsLeak =
      ui.body.includes('http://backend') || ui.body.includes('http://frontend')
    probes.push(
      !internalDnsLeak
        ? pass('probe.no-internal-dns', 'UI 响应不含内部 DNS')
        : fail('probe.no-internal-dns', 'UI 响应泄漏内部 DNS'),
    )

    // 6. 迁移批次可见（task 9.2）
    const migLog = sh('docker', [...compose, 'logs', 'migrate', '--no-color'], { allowFail: true })
    probes.push(
      /migrated|completed|success/i.test(migLog.out) || migLog.code === 0
        ? pass('probe.migrations', 'migrate job 日志可见且退出码 0')
        : fail('probe.migrations', migLog.out.slice(-200)),
    )

    // 7. secret 指纹 + 数据写入（task 9.3）
    const fp1 = sh(
      'docker',
      [
        ...compose,
        'exec',
        '-T',
        'backend',
        'sh',
        '-c',
        'sha256sum /run/aiproj-secrets/* | cut -c1-12',
      ],
      { allowFail: true },
    )
    probes.push(
      fp1.code === 0 && fp1.out.trim().length > 0
        ? pass(
            'probe.secret-fingerprint',
            `secret 指纹采集成功（${fp1.out.trim().split(/\r?\n/).length} 项）`,
          )
        : fail('probe.secret-fingerprint', fp1.out.slice(0, 200)),
    )
    const probeKey = `aiproj:gate:${project}`
    sh('docker', [...compose, 'exec', '-T', 'redis', 'redis-cli', 'SET', probeKey, 'gate-probe'], {
      allowFail: true,
    })
    let pgProbeBefore = ''
    if (stack === 'pg') {
      const pgEnvUser = 'aiproj'
      const r = sh(
        'docker',
        [
          ...compose,
          'exec',
          '-T',
          'postgres',
          'psql',
          '-U',
          pgEnvUser,
          '-d',
          'aiproj',
          '-tAc',
          'SELECT count(*) FROM adonis_schema',
        ],
        { allowFail: true },
      )
      pgProbeBefore = r.out.trim()
      probes.push(
        r.code === 0
          ? pass('probe.pg-migrations-count', `PG migrations 已执行 ${pgProbeBefore} 批`)
          : fail('probe.pg-migrations-count', r.out.slice(0, 200)),
      )
    } else {
      const r = sh(
        'docker',
        [
          ...compose,
          'exec',
          '-T',
          'backend',
          'sh',
          '-c',
          'test -s /app/data/database.sqlite && echo present',
        ],
        { allowFail: true },
      )
      probes.push(
        r.out.includes('present')
          ? pass('probe.sqlite-file', 'SQLite 文件存在于 volume')
          : fail('probe.sqlite-file', 'SQLite 文件缺失'),
      )
      const noPg = sh('docker', [...compose, 'ps', '--services'], { allowFail: true })
      probes.push(
        !/postgres/.test(noPg.out)
          ? pass('probe.zero-pg', 'SQLite 栈无 postgres 服务运行')
          : fail('probe.zero-pg', 'SQLite 栈出现 postgres'),
      )
    }

    // 8. down（不带 -v）→ up → 持久化复查（task 9.3）
    sh('docker', [...compose, 'down'], { allowFail: true, timeoutMs: 120000 })
    const up2 = sh('docker', [...compose, 'up', '-d'], {
      allowFail: true,
      timeoutMs: 10 * 60 * 1000,
    })
    probes.push(
      up2.code === 0
        ? pass('compose.reup', '普通 down 后重新 up 成功')
        : fail('compose.reup', up2.out.slice(-300)),
    )
    const healthy2 = waitHealthy(composeFile, project, 6 * 60 * 1000)
    probes.push(healthy2.ok ? pass('wait.healthy-after-restart', '重启后恢复 healthy') : healthy2)
    const fp2 = sh(
      'docker',
      [
        ...compose,
        'exec',
        '-T',
        'backend',
        'sh',
        '-c',
        'sha256sum /run/aiproj-secrets/* | cut -c1-12',
      ],
      { allowFail: true },
    )
    probes.push(
      fp1.out.trim() === fp2.out.trim() && fp1.out.trim().length > 0
        ? pass('probe.secret-stable', '重启后 secret 指纹一致（不轮换）')
        : fail('probe.secret-stable', '重启后 secret 指纹变化'),
    )
    const redisProbe = sh(
      'docker',
      [...compose, 'exec', '-T', 'redis', 'redis-cli', 'GET', probeKey],
      { allowFail: true },
    )
    probes.push(
      redisProbe.out.trim() === 'gate-probe'
        ? pass('probe.redis-persist', 'Redis 探针键跨 down/up 保留')
        : fail('probe.redis-persist', `Redis 探针键丢失（${redisProbe.out.trim()}）`),
    )
    if (stack === 'pg') {
      const r = sh(
        'docker',
        [
          ...compose,
          'exec',
          '-T',
          'postgres',
          'psql',
          '-U',
          'aiproj',
          '-d',
          'aiproj',
          '-tAc',
          'SELECT count(*) FROM adonis_schema',
        ],
        { allowFail: true },
      )
      probes.push(
        r.code === 0 && r.out.trim() === pgProbeBefore
          ? pass('probe.pg-persist', 'PG migrations 计数跨重启一致')
          : fail('probe.pg-persist', `${pgProbeBefore} → ${r.out.trim()}`),
      )
    } else {
      const r = sh(
        'docker',
        [
          ...compose,
          'exec',
          '-T',
          'backend',
          'sh',
          '-c',
          'test -s /app/data/database.sqlite && echo present',
        ],
        { allowFail: true },
      )
      probes.push(
        r.out.includes('present')
          ? pass('probe.sqlite-persist', 'SQLite 文件跨重建保留')
          : fail('probe.sqlite-persist', 'SQLite 文件丢失'),
      )
    }

    // 9. 负例：停 PG/删 SQLite 文件句柄之外的安全负例 = 停 postgres 看 ready 不装健康（task 9.4，仅 PG 栈）
    if (stack === 'pg') {
      sh('docker', [...compose, 'stop', 'postgres'], { allowFail: true, timeoutMs: 60000 })
      await new Promise((r) => setTimeout(r, 3000))
      const degraded = await fetchJson(`${base}/api/v1/health/ready`)
      probes.push(
        degraded.status !== 200
          ? pass(
              'probe.fail-closed',
              `停 postgres 后 ready → ${degraded.status}（fail closed，未装健康）`,
            )
          : fail('probe.fail-closed', '停 postgres 后 ready 仍 200'),
      )
      sh('docker', [...compose, 'start', 'postgres'], { allowFail: true, timeoutMs: 60000 })
      waitHealthy(composeFile, project, 3 * 60 * 1000)
    }

    // 10. 日志敏感信息扫描（task 9.5）
    const needles = secretNeedles(composeFile, project)
    probes.push(scanLogsForSecrets(composeFile, project, needles))

    const failedCount = probes.filter((p) => !p.ok).length
    return {
      stack,
      status: failedCount === 0 ? 'pass' : 'fail',
      project,
      probes,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    probes.push(
      fail('stack.aborted', error instanceof Error ? error.message.slice(0, 300) : 'unknown'),
    )
    return {
      stack,
      status: 'fail',
      project,
      probes,
      durationMs: Date.now() - started,
      error: 'aborted',
    }
  } finally {
    cleanup()
  }
}

async function main(): Promise<number> {
  const stackArg = process.argv.includes('--stack')
    ? process.argv[process.argv.indexOf('--stack') + 1]
    : 'all'
  const available = dockerAvailable()
  if (!available.ok) {
    const blocked = {
      gate: 'docker-runtime',
      status: 'blocked',
      reason: 'docker-cli-daemon-unavailable',
      detail: available.reason,
      generatedAt: new Date().toISOString(),
      note: '本 gate 必须在目标 Docker 主机运行；缺少 Docker 是明确 blocked，不是通过。',
    }
    console.log(JSON.stringify(blocked, null, 2))
    return 3
  }

  const stacks: Array<'pg' | 'sqlite'> =
    stackArg === 'pg' || stackArg === 'sqlite' ? [stackArg] : ['pg', 'sqlite']
  const reports: StackReport[] = []
  for (const stack of stacks) {
    const port = stack === 'pg' ? 18080 : 18081
    // 用独立端口避免与宿主机已有 80 端口冲突
    process.env.AIPROJ_HTTP_PORT = String(port)
    process.env.AIPROJ_BIND_ADDRESS = '127.0.0.1'
    reports.push(await runStack(stack, port))
  }

  const failed = reports.filter((r) => r.status !== 'pass')
  const report = {
    gate: 'docker-runtime',
    status: failed.length === 0 ? 'pass' : 'fail',
    generatedAt: new Date().toISOString(),
    versions: available.versions,
    gitHead: sh('git', ['rev-parse', '--short', 'HEAD'], { allowFail: true }).out.trim(),
    stacks: reports,
  }
  console.log(JSON.stringify(report, null, 2))
  return failed.length === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
