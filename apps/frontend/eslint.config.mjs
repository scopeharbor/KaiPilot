// 开项 KaiPilot 前端 ESLint 配置：继承共享扁平配置。
import sharedConfig from '@aiproj/config/eslint'

export default [
  ...sharedConfig,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.next/**',
      '.next-alt/**',
      '.next-build/**',
      'out/**',
      '.turbo/**',
      'coverage/**',
    ],
  },
]
