'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { HelpNavigationTree, type HelpTreeItem } from './HelpNavigationTree'

/** 移动端文档目录抽屉（design E：移动端 drawer）。 */
export function HelpMobileNav({ items, currentId }: { items: HelpTreeItem[]; currentId?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" aria-label="打开文档目录" className="lg:hidden">
          <Menu className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>帮助文档</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <HelpNavigationTree items={items} currentId={currentId} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
