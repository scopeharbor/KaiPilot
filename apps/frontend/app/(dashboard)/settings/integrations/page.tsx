import type { Metadata } from 'next'
import { IntegrationsAccess } from '@/components/integrations/IntegrationsAccess'

export const metadata: Metadata = {
  title: '集成设置',
  robots: { index: false, follow: false },
}

export default function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams?: { category?: string }
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <IntegrationsAccess focusCategory={searchParams?.category ?? null} />
    </div>
  )
}
