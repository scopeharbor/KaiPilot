import { Env } from '@adonisjs/core/env'

export function optionalRealtimeInteger(min: number, max: number) {
  return (key: string, value?: string): number | undefined => {
    if (value === undefined || value === '') return undefined

    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new Error(`${key} must be an integer between ${min} and ${max}`)
    }

    return parsed
  }
}

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Database -- SQLite 默认，PostgreSQL opt-in via DB_CONNECTION=pg
  DB_CONNECTION: Env.schema.enum.optional(['sqlite', 'pg'] as const),
  // 单一命名契约：SQLite 方言下为文件路径，PG 方言下为 database 名称；无条件必填。
  DB_DATABASE: Env.schema.string(),

  // PostgreSQL 参数（仅在 DB_CONNECTION=pg 时必需）
  DB_HOST: Env.schema.string.optional(),
  DB_PORT: Env.schema.number.optional(),
  DB_USER: Env.schema.string.optional(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_SSL: Env.schema.boolean.optional(),
  DB_SSL_REJECT_UNAUTHORIZED: Env.schema.boolean.optional(),
  DB_POOL_MIN: Env.schema.number.optional(),
  DB_POOL_MAX: Env.schema.number.optional(),

  // JWT (HS256, access 短时效 + refresh 可撤销)
  JWT_ACCESS_SECRET: Env.schema.string(),
  JWT_ACCESS_TTL: Env.schema.string(),
  JWT_REFRESH_TTL: Env.schema.string(),

  // Limiter（登录失败锁定 SEC-03 / 速率限制 SEC-10）。
  // 默认 memory（单进程内存）；redis 仅在 REDIS_ENABLED=true 时可选，
  // 用于承载跨进程/跨重启的限流状态（v2-redis-minimum-runtime-support D4）。
  // LIMITER_STORE=redis 但 REDIS_ENABLED 未开时，启动阶段由 config/limiter.ts 校验失败。
  LIMITER_STORE: Env.schema.enum(['memory', 'redis'] as const),

  // Redis 运行时最小基础（v2-redis-minimum-runtime-support D1/D3）。
  // 默认关闭：未设置 REDIS_ENABLED 时后端以单节点内存模式运行，零外部依赖。
  // 启用时通过分项环境变量建立单节点连接；host/port 缺失由就绪门禁与连接工厂拦截，
  // 而非 env 解析失败（保持内存降级路径始终可启动）。password/连接串禁止出现在日志/健康/门禁输出。
  REDIS_ENABLED: Env.schema.boolean.optional(),
  REDIS_HOST: Env.schema.string.optional(),
  REDIS_PORT: Env.schema.number.optional(),
  REDIS_PASSWORD: Env.schema.string.optional(),
  REDIS_DB: Env.schema.number.optional(),
  REDIS_TLS: Env.schema.boolean.optional(),
  REDIS_CONNECT_TIMEOUT: Env.schema.number.optional(),
  REDIS_MAX_RETRIES: Env.schema.number.optional(),

  // ai-structured-output-poc（dev-only sandbox；见 .env.example 与 openspec/changes/ai-structured-output-poc）
  // 未提供 OPENAI_API_KEY 时，Adapter 自动降级为 MockAdapter，仅限联调、不得用于 M0 判定。
  AI_M0_PROVIDER: Env.schema.string.optional(),
  AI_M0_MODEL: Env.schema.string.optional(),
  OPENAI_API_KEY: Env.schema.string.optional(),
  OPENAI_BASE_URL: Env.schema.string.optional(),
  // 没有任何 AI 连接、也没有 OPENAI_API_KEY 时，AI 草案 / AI 同事 / 矛盾求解默认提示「请先在设置中
  // 添加 AI 连接」，不再用 Mock 冒充模型。仅联调时设为 true 才放行 Mock；测试环境缺省放行。
  AI_ALLOW_MOCK: Env.schema.boolean.optional(),
  AI_M0_MAX_OUTPUT_TOKENS: Env.schema.number.optional(),
  AI_M0_REQUEST_TIMEOUT_MS: Env.schema.number.optional(),

  // AI 草案生成墙钟预算（services/ai_draft/generation_budget.ts）。慢模型 + 大项目时放宽：
  // 倍率 1–10（默认 1 = 全程 25 分钟 / WBS 阶段 8 分钟 / 单次请求 8 分钟）；请求超时绝对值优先于倍率。
  AI_DRAFT_TIME_BUDGET_SCALE: Env.schema.number.optional(),
  AI_DRAFT_REQUEST_TIMEOUT_MS: Env.schema.number.optional(),
  // 输出长度预算倍率 1–5（默认 1 = WBS 阶段 25 万字符 / 全程 100 万字符）。
  AI_DRAFT_OUTPUT_BUDGET_SCALE: Env.schema.number.optional(),

  // ai-gateway-abstraction / T034 —— AI 模型连接 key 加密(自研双协议 Adapter)。
  // 缺失时回退派生自 APP_KEY 并告警;建议生产设置独立 key。
  AI_CONNECTION_ENCRYPTION_KEY: Env.schema.string.optional(),

  // 两步验证（TOTP）密钥的静态加密 key。缺失时回退派生自 APP_KEY 并告警；
  // 建议生产设置独立 key，使 2FA 密钥泄露的爆炸半径止于 2FA。
  TWO_FACTOR_ENCRYPTION_KEY: Env.schema.string.optional(),
  /** 认证器 App 里显示的签发方名称；缺省「开项 KaiPilot」。改动会让已绑定的条目改名，不影响验证。 */
  TWO_FACTOR_ISSUER: Env.schema.string.optional(),
  /**
   * 登录期绑定策略（enrollment-at-login）：`off` | `optional`（默认）| `required`。
   * `optional`/`required` 会让未绑定认证器的账号在密码通过后先看到扫码绑定界面。
   */
  TWO_FACTOR_LOGIN_ENROLLMENT: Env.schema.enum.optional(['off', 'optional', 'required'] as const),

  // WebSocket / Socket.IO 实时传输底座（单节点，不需要 Redis）
  FRONTEND_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  REALTIME_ENABLED: Env.schema.boolean.optional(),
  REALTIME_PING_INTERVAL_MS: optionalRealtimeInteger(5_000, 120_000),
  REALTIME_PING_TIMEOUT_MS: optionalRealtimeInteger(5_000, 120_000),
  REALTIME_CONNECT_TIMEOUT_MS: optionalRealtimeInteger(5_000, 120_000),
  REALTIME_MAX_CONNECTIONS: optionalRealtimeInteger(1, 10_000),

  // V2 轻量日历/消息集成预连接。全部可选；缺省只让 provider 显示为 not_configured。
  GOOGLE_CLIENT_SECRET_JSON_PATH: Env.schema.string.optional(),
  GOOGLE_OAUTH_CLIENT_JSON_PATH: Env.schema.string.optional(),
  GOOGLE_OAUTH_CLIENT_ID: Env.schema.string.optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: Env.schema.string.optional(),
  GOOGLE_OAUTH_REDIRECT_URI: Env.schema.string.optional({ format: 'url', tld: false }),
  GOOGLE_AUTH_SUCCESS_REDIRECT_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  GOOGLE_AUTH_FAILURE_REDIRECT_URL: Env.schema.string.optional({ format: 'url', tld: false }),
  INTEGRATION_TOKEN_ENCRYPTION_KEY: Env.schema.string.optional(),
  GOOGLE_CALENDAR_CLIENT_JSON_PATH: Env.schema.string.optional(),
  GOOGLE_CALENDAR_CLIENT_ID: Env.schema.string.optional(),
  GOOGLE_CALENDAR_CLIENT_SECRET: Env.schema.string.optional(),
  GOOGLE_CALENDAR_REDIRECT_URI: Env.schema.string.optional({ format: 'url', tld: false }),
  OUTLOOK_CALENDAR_CLIENT_ID: Env.schema.string.optional(),
  OUTLOOK_CALENDAR_CLIENT_SECRET: Env.schema.string.optional(),
  OUTLOOK_CALENDAR_REDIRECT_URI: Env.schema.string.optional({ format: 'url', tld: false }),
  SLACK_CLIENT_ID: Env.schema.string.optional(),
  SLACK_CLIENT_SECRET: Env.schema.string.optional(),
  SLACK_REDIRECT_URI: Env.schema.string.optional({ format: 'url', tld: false }),
  FEISHU_APP_ID: Env.schema.string.optional(),
  FEISHU_APP_SECRET: Env.schema.string.optional(),
  FEISHU_REDIRECT_URI: Env.schema.string.optional({ format: 'url', tld: false }),
  DINGTALK_APP_ID: Env.schema.string.optional(),
  DINGTALK_APP_SECRET: Env.schema.string.optional(),
  DINGTALK_REDIRECT_URI: Env.schema.string.optional({ format: 'url', tld: false }),

  // API v2 特性门禁（v2-5-api-v2-surface）
  // 启用时注册 /api/v2 路由组；关闭时 /api/v2 返回 503 feature-disabled。
  // 默认关闭；测试用例通过 .env.test 显式启用。
  API_V2_ENABLED: Env.schema.boolean.optional(),

  // v2-5-streaming-websocket-service —— Streaming WebSocket Service 特性门禁。
  // 启用时后台长任务（AI Draft、Compiler Stage events、34-stage code generation）
  // 可通过 WebSocket 订阅流式进度。关闭时不阻塞 REST/SSE/status fallback 路径。
  // 本地开发默认启用，测试环境应显式设置。
  STREAMING_WS_ENABLED: Env.schema.boolean.optional(),
  // v2-5-code-repository-auto-linking —— 候选自动关联特性门禁。
  // 默认关闭，启用时监听 GitHub 事件生成候选链接。
  // 关闭时不影响手工外链创建和刷新。
  LINK_CANDIDATE_ENABLED: Env.schema.boolean.optional(),
  STREAMING_WS_HEARTBEAT_INTERVAL_MS: optionalRealtimeInteger(5_000, 120_000),
  STREAMING_WS_HEARTBEAT_TIMEOUT_MS: optionalRealtimeInteger(5_000, 120_000),
  STREAMING_WS_REPLAY_RETENTION_SEC: Env.schema.number.optional(),

  // v2-5-compiler-stage-cache-wiring —— deterministic Compiler Stage 缓存特性门禁（design D6）。
  // 默认启用；设为 false 时 Orchestrator 构造的 Executor 不再包裹缓存，handler 直连，
  // 行为与接线前一致且不写任何 cache summary。缓存只是加速层，store 仍由
  // resolveCacheStore() 按 Redis 可用性解析（memory fallback），本开关不引入外部依赖。
  COMPILER_STAGE_CACHE_ENABLED: Env.schema.boolean.optional(),

  // v2-5-provider-incoming-webhook-foundation —— 入站 webhook 全局 kill switch（design D6）。
  // 默认关闭以贴合「真实接收受授权」红线：未授权环境下接收端点直接拒收并记账。
  // 启用后 per-endpoint `enabled` 才生效；管理 API 始终可访问以便重新启用。
  WEBHOOKS_INGEST_ENABLED: Env.schema.boolean.optional(),

  // v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅写操作 feature-off（design D6）。
  // 默认关闭：未授权环境下 create/update/deactivate/rotate 返回 503 FEATURE_DISABLED；list 仍安全可读。
  OUTGOING_WEBHOOKS_ENABLED: Env.schema.boolean.optional(),
  // 显式 test/dev 允许私网/loopback 目标 URL（生产默认 false，SSRF 防护）。
  OUTGOING_WEBHOOK_DEV_ALLOW_PRIVATE: Env.schema.boolean.optional(),
  // v2-5-outgoing-webhook-delivery-ledger -- 投递写/发送/手动重试总开关（默认关，fixture-first）。
  OUTGOING_WEBHOOK_DELIVERY_ENABLED: Env.schema.boolean.optional(),

  // v2-5-webhook-batched-delivery -- 批量投递配置（design D7）。
  OUTGOING_WEBHOOK_BATCH_ENABLED: Env.schema.boolean.optional(),
  OUTGOING_WEBHOOK_BATCH_WINDOW_SECONDS: Env.schema.number.optional(),
  OUTGOING_WEBHOOK_BATCH_MAX_ENTRIES: Env.schema.number.optional(),
  OUTGOING_WEBHOOK_BATCH_MAX_PAYLOAD_BYTES: Env.schema.number.optional(),

  // v2-5-webhook-templates-and-stats -- 模板应用 feature-off 门控（design D5）。
  // 默认关闭；启用后 template apply 才可写，只读 list/get/prefill 始终可用。
  OUTGOING_WEBHOOK_TEMPLATES_ENABLED: Env.schema.boolean.optional(),
  // 统计 feature-off 门控（design D5）。
  // 默认关闭；启用后返回统计聚合，否则返回 deterministic 不可用态。
  OUTGOING_WEBHOOK_STATS_ENABLED: Env.schema.boolean.optional(),

  // v2-5-webhook-ip-allowlist —— 入站 webhook 来源 IP 允许清单（网络层纵深防御，design D3/D7）。
  // 默认关闭：未设置时中间件 no-op，对现网零影响。开启后按 CIDR 清单收敛来源 IP，
  // 未命中返回 403 WEBHOOK_IP_FORBIDDEN。开启但清单为空 = fail-closed 全拒（暴露误配）。
  // 说明：实际读取在 config/webhook_allowlist.ts 直读 process.env（运行时可切换，
  // 与 WEBHOOKS_INGEST_ENABLED 同理），此处 schema 仅作 boot 校验与文档。
  WEBHOOK_IP_ALLOWLIST_ENABLED: Env.schema.boolean.optional(),
  // 逗号分隔的 CIDR 列表（IPv4/IPv6 皆可），如 "192.30.252.0/22,2606:50c0:8000::/40"。
  // 留空且 ENABLED=true 时判定为误配并全拒。
  WEBHOOK_IP_ALLOWLIST_CIDRS: Env.schema.string.optional(),

  // v2-5-pwa-web-push-notifications —— PWA Web Push 特性门禁（design D3）。
  // 默认关闭：未授权环境下订阅 UI 隐藏、API 拒绝、发送 no-op。
  PWA_WEB_PUSH_ENABLED: Env.schema.boolean.optional(),
  // 实际外发推送开关（默认关闭；fixture 模式下仅记录，不产生真实网络流量）。
  PWA_WEB_PUSH_SEND_ENABLED: Env.schema.boolean.optional(),
  // 发送器模式：fixture（默认）| production（需 VAPID 凭据完整且已授权）。
  PWA_WEB_PUSH_SENDER_MODE: Env.schema.enum.optional(['fixture', 'production'] as const),
  // VAPID 公钥（base64url 编码，用于浏览器 subscribe 调用）。
  PWA_WEB_PUSH_VAPID_PUBLIC_KEY: Env.schema.string.optional(),
  // VAPID 私钥（base64url 编码，用于签名推送请求）。
  PWA_WEB_PUSH_VAPID_PRIVATE_KEY: Env.schema.string.optional(),
  // VAPID 联系人邮箱/URL（推送服务联系信息）。
  PWA_WEB_PUSH_VAPID_SUBJECT: Env.schema.string.optional(),

  // v3-skill-registry-and-lifecycle —— Skill Registry 特性门禁（D9）。
  // 默认关闭；启用后 /api/v1/ai/compiler/skills 端点才可访问。
  COMPILER_SKILL_REGISTRY_ENABLED: Env.schema.boolean.optional(),

  // v3-skill-knowledge-authoring —— Skill 知识包创作特性门禁（D9）。
  // 默认关闭；启用后 /api/v1/ai/compiler/skills/:skillId/knowledge 端点才可访问。
  COMPILER_SKILL_KNOWLEDGE_AUTHORING_ENABLED: Env.schema.boolean.optional(),

  // v3-initial-skill-software-development —— 内置 Skill 种子注入特性门禁（D8）。
  // 默认关闭；启用后 seeder 注入内置 Skill、API 暴露 isBuiltin 标识、前端渲染徽章/筛选/副本入口。
  COMPILER_SKILL_BUILTIN_SEED_ENABLED: Env.schema.boolean.optional(),

  // v3-skill-eval-system —— Skill 评估特性门禁（D10）。
  // 默认关闭；启用后 /api/v1/ai/compiler/skills/:skillId/eval 端点才可访问。
  COMPILER_SKILL_EVAL_ENABLED: Env.schema.boolean.optional(),

  // v3-skill-compiler-integration —— Skill 知识注入 Compiler Stage 特性门禁（D8）。
  // 默认关闭；启用后 Compiler run 在 Intent Parsing 之后接线激活决策，
  // LLM/hybrid Stage 的 Context Packet 会注入 skillKnowledge section。
  COMPILER_SKILL_INJECTION_ENABLED: Env.schema.boolean.optional(),

  // v3-cross-project-allocation —— 跨项目资源调配特性门禁。

  // 默认关闭；启用后相关端点才放行，否则统一返回 RESOURCE_NOT_FOUND。
  CROSS_PROJECT_ALLOCATION_ENABLED: Env.schema.boolean.optional(),
})
