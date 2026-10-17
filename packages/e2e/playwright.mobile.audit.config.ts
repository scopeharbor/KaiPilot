import { defineConfig } from '@playwright/test'
import mobile from './playwright.mobile.config'

export default defineConfig({
  ...mobile,
  testMatch: 'mobile-all-pages.spec.ts',
  timeout: 600_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/mobile-audit/report.json' }]],
  outputDir: './test-results/mobile-audit',
  projects: mobile.projects?.filter((project) =>
    ['phone-320', 'phone-390', 'phone-landscape'].includes(project.name!),
  ),
})
