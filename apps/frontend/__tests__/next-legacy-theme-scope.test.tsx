import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NextLegacyThemeScope } from '@/components/ui/NextLegacyThemeScope'
import { Combobox } from '@/components/ui/Combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/Dialog'

describe('embedded task panel portal themes', () => {
  it('keeps searchable task options in the workspace theme after portaling to body', () => {
    render(
      <NextLegacyThemeScope>
        <Combobox aria-label="前置任务" options={[{ value: '1', label: '验收任务' }]} />
      </NextLegacyThemeScope>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: '前置任务' }))
    const popup = screen.getByRole('dialog')
    expect(popup).toHaveAttribute('data-next-track')
    expect(popup).toHaveAttribute('data-next-legacy-ui')
    expect(screen.getByRole('option', { name: '验收任务' })).toBeVisible()
  })

  it('preserves the theme through an external-link dialog and a nested select portal', () => {
    render(
      <NextLegacyThemeScope>
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>添加外部链接</DialogTitle>
            <Select open defaultValue="github">
              <SelectTrigger aria-label="供应商">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="github">GitHub</SelectItem>
              </SelectContent>
            </Select>
          </DialogContent>
        </Dialog>
      </NextLegacyThemeScope>,
    )
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('data-next-legacy-ui')
    expect(screen.getByRole('listbox')).toHaveAttribute('data-next-track')
    expect(screen.getByRole('listbox')).toHaveAttribute('data-next-legacy-ui')
  })

  it('leaves standalone legacy controls on the legacy theme', () => {
    render(<Combobox aria-label="旧版前置任务" options={[]} />)
    fireEvent.click(screen.getByRole('combobox', { name: '旧版前置任务' }))
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-next-track')
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-next-legacy-ui')
  })
})
