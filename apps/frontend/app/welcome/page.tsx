import type { Metadata } from 'next'
import { KaiPilotWelcome } from '@/components/landing/KaiPilotWelcome'

export const metadata: Metadata = {
  title: '开项 KaiPilot · 一句话启动项目',
  description:
    '开源、可自托管的 AI 项目管理平台：一句话生成项目章程、WBS、排期与验收标准，人工审查确认后才成为正式项目。',
}

/** 产品介绍页（个人版）：顶栏与首屏提供「登录控制台」和 GitHub 仓库入口。 */
export default function WelcomePage() {
  return <KaiPilotWelcome />
}
