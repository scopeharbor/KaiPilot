export type DatabaseMode = 'auto' | 'supabase' | 'local'

export interface DatabaseCandidate {
  id: 'direct' | 'session-pooler'
  label: string
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: boolean
  rejectUnauthorized: boolean
}

export function parseEnvFile(source: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(separator + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const [key, value] of Object.entries(values)) {
      const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name) => {
        return values[name] ?? process.env[name] ?? token
      })
      if (expanded !== value) {
        values[key] = expanded
        changed = true
      }
    }
    if (!changed) break
  }
  return values
}

export function parseDatabaseMode(value: string | undefined): DatabaseMode {
  const normalized = (value ?? 'auto').trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'supabase' || normalized === 'local') {
    return normalized
  }
  throw new Error(`AIPROJ_DATABASE_MODE=${normalized} 无效；只允许 auto、supabase 或 local`)
}

function asPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return fallback
  return parsed
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return value.trim().toLowerCase() === 'true'
}

export function buildSupabaseCandidates(env: NodeJS.ProcessEnv): DatabaseCandidate[] {
  const password = env.SUPABASE_DB_PASSWORD || env.DB_PASSWORD || ''
  const database = env.SUPABASE_DB_NAME || 'postgres'
  const ssl = asBoolean(env.DB_SSL, true)
  const rejectUnauthorized = asBoolean(env.DB_SSL_REJECT_UNAUTHORIZED, false)
  const candidates: DatabaseCandidate[] = []

  if (env.SUPABASE_DB_DIRECT_HOST && env.SUPABASE_DB_DIRECT_USER && password) {
    candidates.push({
      id: 'direct',
      label: 'Supabase direct',
      host: env.SUPABASE_DB_DIRECT_HOST,
      port: asPort(env.SUPABASE_DB_DIRECT_PORT, 5432),
      user: env.SUPABASE_DB_DIRECT_USER,
      password,
      database,
      ssl,
      rejectUnauthorized,
    })
  }

  if (env.SUPABASE_DB_POOLER_HOST && env.SUPABASE_DB_POOLER_USER && password) {
    candidates.push({
      id: 'session-pooler',
      label: 'Supabase session pooler',
      host: env.SUPABASE_DB_POOLER_HOST,
      port: asPort(env.SUPABASE_DB_POOLER_PORT, 5432),
      user: env.SUPABASE_DB_POOLER_USER,
      password,
      database,
      ssl,
      rejectUnauthorized,
    })
  }

  return candidates
}

export async function selectSupabaseCandidate(
  candidates: DatabaseCandidate[],
  probe: (candidate: DatabaseCandidate) => Promise<boolean>,
): Promise<DatabaseCandidate | null> {
  for (const candidate of candidates) {
    if (await probe(candidate)) return candidate
  }
  return null
}

export function pgEnvironment(
  base: NodeJS.ProcessEnv,
  candidate: DatabaseCandidate,
): NodeJS.ProcessEnv {
  return {
    ...base,
    DB_CONNECTION: 'pg',
    DB_HOST: candidate.host,
    DB_PORT: String(candidate.port),
    DB_USER: candidate.user,
    DB_PASSWORD: candidate.password,
    DB_DATABASE: candidate.database,
    DB_SSL: String(candidate.ssl),
    DB_SSL_REJECT_UNAUTHORIZED: String(candidate.rejectUnauthorized),
  }
}

export function sqliteEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    DB_CONNECTION: 'sqlite',
    DB_DATABASE: base.AIPROJ_SQLITE_DATABASE || 'database.sqlite',
  }
}
