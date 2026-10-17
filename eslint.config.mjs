// 根 ESLint 扁平配置：复用共享包 @aiproj/config。
// 各 workspace（frontend/backend）的源码由各自的 lint 脚本处理，根配置仅覆盖根级文件。
import config from '@aiproj/config/eslint'

export default [
  ...config,
  {
    ignores: [
      'apps/**/*',
      'packages/**/*',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },
  {
    // 个人版导出工具（Node 脚本）
    files: ['scripts/edition/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
]
