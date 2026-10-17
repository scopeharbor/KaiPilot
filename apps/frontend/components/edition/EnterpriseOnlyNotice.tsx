import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * 「此功能属于企业版」说明（v3-personal-edition-open-source-export §D12）。
 *
 * 个人版导出时企业与平台页面被真正删除，用户经书签、历史记录或直链访问时由根
 * `not-found` 渲染本说明。纯展示组件：不发起任何数据请求。
 *
 * 「智项企业版」是固定词，登记在版本清单的品牌白名单里，导出时不替换为个人版品牌。
 */
export function EnterpriseOnlyNotice({ homeHref = '/' }: { homeHref?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6" data-edition-notice>
      <EmptyState
        icon={Building2}
        title="此功能属于智项企业版，个人版未提供"
        description="当前部署是个人版，不包含这项企业或平台运营能力。"
        action={
          <Link
            href={homeHref}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            返回首页
          </Link>
        }
      />
    </main>
  )
}
