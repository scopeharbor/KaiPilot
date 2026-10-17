import baseConfig from '@aiproj/config/eslint'

export default [
  ...baseConfig,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-irregular-whitespace': 'off',
      'prefer-const': 'off',
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*fixtures*.ts', 'src/**/*fixture*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
]
