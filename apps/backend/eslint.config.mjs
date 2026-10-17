// 开项 OpenXiang 后端 ESLint 配置。
// 使用 AdonisJS 官方 flat config；共享配置由根级 @aiproj/config 在 CI/根 lint 时统一兜底。
import { configApp } from '@adonisjs/eslint-config'

const base = configApp({
  // migration:run 自动生成、已 gitignore 的 schema 文件（顶部标注 DO NOT EDIT），
  // 每次迁移都会重生成，交由 Prettier（printWidth 100）负责，ESLint 不接管。
  ignores: ['database/schema.ts', 'database/schema_rules.ts'],
})

export default [
  ...base,
  {
    rules: {
      // `x == null` / `x != null` 是同时匹配 null 与 undefined 的既定惯用法，全仓广泛使用。
      // 用 `null: 'ignore'`（ESLint 官方推荐档位）保留该惯用法，其余比较仍强制严格等。
      // 若改为 `!==`/`===` 会丢失 undefined 分支语义，属引入缺陷。
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
]
