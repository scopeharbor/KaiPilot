import { indexEntities } from '@adonisjs/core'
import { defineConfig } from '@adonisjs/core/app'
import { generateRegistry } from '@tuyau/core/hooks'

export default defineConfig({
  /*
  |--------------------------------------------------------------------------
  | Experimental flags
  |--------------------------------------------------------------------------
  |
  | The following features will be enabled by default in the next major release
  | of AdonisJS. You can opt into them today to avoid any breaking changes
  | during upgrade.
  |
  */
  experimental: {},

  /*
  |--------------------------------------------------------------------------
  | Commands
  |--------------------------------------------------------------------------
  |
  | List of ace commands to register from packages. The application commands
  | will be scanned automatically from the "./commands" directory.
  |
  */
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@adonisjs/session/commands'),
    // 应用自有命令显式登记，绕开 FsLoader 的 jsonschema 校验（生产镜像报 Invalid URL，见该文件注释）
    () => import('#start/commands/main'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Service providers
  |--------------------------------------------------------------------------
  |
  | List of service providers to import and register when booting the
  | application
  |
  */
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    {
      file: () => import('@adonisjs/core/providers/repl_provider'),
      environment: ['repl', 'test'],
    },
    () => import('@adonisjs/core/providers/vinejs_provider'),
    () => import('@adonisjs/session/session_provider'),
    () => import('@adonisjs/shield/shield_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/cors/cors_provider'),
    () => import('@adonisjs/auth/auth_provider'),
    () => import('@adonisjs/redis/redis_provider'),
    () => import('@adonisjs/limiter/limiter_provider'),
    () => import('#providers/api_provider'),
    () => import('#providers/socketio_provider'),
    () => import('#providers/redis_runtime_provider'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Preloads
  |--------------------------------------------------------------------------
  |
  | List of modules to import before starting the application.
  |
  */
  preloads: [
    () => import('#start/routes'),
    () => import('#start/kernel'),
    () => import('#start/validator'),
    () => import('#start/limiter'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Tests
  |--------------------------------------------------------------------------
  |
  | List of test suites to organize tests by their type. Feel free to remove
  | and add additional suites.
  |
  */
  tests: {
    suites: [
      {
        // Japa 单元套件只跑依赖 AdonisJS 运行时的 `.spec.ts`。纯逻辑 V2 编译器/streaming 测试
        // （deterministic / validation / repair / draft_layer / codegen 等）`import ... from 'vitest'`，
        // 若被 Japa 加载会在启动阶段崩溃，故由 Vitest 单独运行，并在 `tests/bootstrap.ts`
        // 的 `exclude` 中排除（Japa 用 node:fs/promises 的 glob，`files` 数组不支持 `!` 取反，
        // 排除必须走顶层 `exclude` 配置）。
        files: ['tests/unit/**/*.spec.{ts,js}'],
        name: 'unit',
        timeout: 10000,
      },
      {
        files: ['tests/functional/**/*.spec.{ts,js}'],
        name: 'functional',
        timeout: 30000,
      },
    ],
    // forceExit=false 时 japa 跑完不主动退出，要等所有 handle 自然关闭。本套件有
    // 常驻 handle（Socket.IO/限流定时器等）永远不关，进程于是滞留成僵尸并继续占着
    // `test.sqlite` 的文件句柄——下一次 `node ace test` 在清库阶段就撞
    // `EBUSY: resource busy or locked, unlink test.sqlite` 而整体起不来，
    // 且僵尸会逐次累积。改为 true：测试结束即退出，句柄随进程释放。
    forceExit: true,
  },

  /*
  |--------------------------------------------------------------------------
  | Metafiles
  |--------------------------------------------------------------------------
  |
  | A collection of files you want to copy to the build folder when creating
  | the production build.
  |
  */
  metaFiles: [],

  hooks: {
    init: [
      indexEntities({
        transformers: { enabled: true },
      }),
      generateRegistry(),
    ],
  },
})
