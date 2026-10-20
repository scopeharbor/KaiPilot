// 开项 Kaiplan 共享 ESLint 扁平配置（flat config）。
// 各 app / package 通过 @aiproj/config/eslint 复用，确保全仓规范一致。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 未使用的变量/参数视为错误，确保 CI 阻断。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // ESLint 10 的 recommended 新增本规则；存量代码的防御性初始值（try/catch 前置、
      // 状态流转测试等）大量命中，升级时暂不启用，保持与 ESLint 9 相同的门禁口径。
      'no-useless-assignment': 'off',
    },
  },
)
