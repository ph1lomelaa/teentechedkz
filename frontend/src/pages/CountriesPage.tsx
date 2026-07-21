import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Edit2, Plus } from 'lucide-react'
import { countriesApi } from '@/api/index'
import { useAuth } from '@/contexts/AuthContext'
import { Country } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'

function CountryModal({
  country,
  open,
  onClose,
}: {
  country?: Country
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const isEdit = !!country
  const [form, setForm] = useState({
    country_name: country?.country_name ?? '',
    vpp_required: country?.vpp_required ?? false,
    submission_deadline_notes: country?.submission_deadline_notes ?? '',
    notes: country?.notes ?? '',
  })

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit && country) {
        return countriesApi.update(country.id, form)
      }
      return countriesApi.create(form)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['countries'] })
      toast({ title: isEdit ? 'Страна обновлена' : 'Страна добавлена' })
      onClose()
    },
    onError: () => {
      toast({ title: 'Ошибка', variant: 'destructive' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать страну' : 'Добавить страну'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название страны</Label>
            <Input
              value={form.country_name}
              onChange={(e) => setForm({ ...form, country_name: e.target.value })}
              placeholder="Великобритания"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.vpp_required}
              onCheckedChange={(v) => setForm({ ...form, vpp_required: !!v })}
            />
            <Label>Требуется VPP / УП</Label>
          </div>
          <div>
            <Label>Дедлайн подач</Label>
            <Input
              value={form.submission_deadline_notes}
              onChange={(e) => setForm({ ...form, submission_deadline_notes: e.target.value })}
              placeholder="Ноябрь–Январь"
            />
          </div>
          <div>
            <Label>Примечания</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.country_name || mutation.isPending}>
            {mutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const CountriesPage: React.FC = () => {
  const { hasRole } = useAuth()
  const isAdmin = hasRole('admin')
  const [editCountry, setEditCountry] = useState<Country | undefined>()
  const [addOpen, setAddOpen] = useState(false)

  const { data: countries = [], isLoading } = useQuery({
    queryKey: ['countries'],
    queryFn: countriesApi.list,
  })

  return (
    <div>
      <CrmPageHeader
        eyebrow="Справочник"
        title="Страны"
        description="Требования, дедлайны и примечания по направлениям поступления."
        action={isAdmin ? (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить
          </Button>
        ) : undefined}
      />

      <div className="border-y border-gray-200">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 hover:bg-transparent">
              <TableHead>Страна</TableHead>
              <TableHead>УП нужно?</TableHead>
              <TableHead>Дедлайн</TableHead>
              <TableHead>Примечания</TableHead>
              {isAdmin && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : countries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  Страны не добавлены
                </TableCell>
              </TableRow>
            ) : (
              countries.map((country) => (
                <TableRow key={country.id} className="border-gray-100 hover:bg-gray-50">
                  <TableCell className="font-medium text-gray-900">{country.country_name}</TableCell>
                  <TableCell>
                    {country.vpp_required ? (
                      <span className="px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 text-[11px] rounded-[2px] font-medium uppercase tracking-wide">
                        Нужно
                      </span>
                    ) : (
                      <span className="text-gray-500 text-xs">Нет</span>
                    )}
                  </TableCell>
                  <TableCell className="text-gray-600">
                    {country.submission_deadline_notes ?? '—'}
                  </TableCell>
                  <TableCell className="text-gray-600 text-sm max-w-xs truncate">
                    {country.notes ?? '—'}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditCountry(country)}
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {addOpen && (
        <CountryModal open={addOpen} onClose={() => setAddOpen(false)} />
      )}
      {editCountry && (
        <CountryModal
          country={editCountry}
          open={!!editCountry}
          onClose={() => setEditCountry(undefined)}
        />
      )}
    </div>
  )
}
