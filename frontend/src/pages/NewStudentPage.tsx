import React, { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { studentsApi } from '@/api/students'
import {
  applicationsApi,
  confidentialNotesApi,
  contractsApi,
  countriesApi,
  guardiansApi,
  servicesApi,
  usersApi,
} from '@/api/index'
import {
  DegreeLevel,
  ServiceType,
  PipelineStatus,
  PIPELINE_STATUS_LABELS,
  DEGREE_LEVEL_LABELS,
  SERVICE_TYPE_LABELS,
} from '@/types'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { Label } from '@/components/ui/primitives/label'
import { Textarea } from '@/components/ui/primitives/textarea'
import { Checkbox } from '@/components/ui/primitives/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card'
import { ToastAction } from '@/components/ui/primitives/toast'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui'

const STEPS = [
  'Студент',
  'Опекун',
  'Договор',
  'Услуги',
  'Страны',
  'Конфиденц.',
]

interface StudentForm {
  full_name: string
  phone: string
  city: string
  degree_level: DegreeLevel
  intake_year: number
  specialty: string
  gpa: string
  achievements_text: string
  budget_per_year: string
}

interface GuardianForm {
  full_name: string
  phone: string
  email: string
  relation: string
  iin: string
}

interface ContractForm {
  signed_date: string
  amount: string
  currency: string
  pipeline_status: PipelineStatus
  payment_plan: '' | 'full' | 'installments'
  ielts_payment_included: boolean
  notes: string
}

interface ServiceEntry {
  service_type: ServiceType
  included: boolean
  mentor_id: string
}

interface CountryEntry {
  country: string
  is_primary: boolean
}

export const NewStudentPage: React.FC = () => {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  const [studentForm, setStudentForm] = useState<StudentForm>({
    full_name: '',
    phone: '',
    city: '',
    degree_level: 'undergraduate',
    intake_year: new Date().getFullYear() + 1,
    specialty: '',
    gpa: '',
    achievements_text: '',
    budget_per_year: '',
  })

  const [guardianForm, setGuardianForm] = useState<GuardianForm>({
    full_name: '',
    phone: '',
    email: '',
    relation: 'parent',
    iin: '',
  })

  const [contractForm, setContractForm] = useState<ContractForm>({
    signed_date: new Date().toISOString().slice(0, 10),
    amount: '',
    currency: 'USD',
    pipeline_status: 'active_work',
    payment_plan: '',
    ielts_payment_included: false,
    notes: '',
  })

  const serviceTypes: ServiceType[] = [
    'proforientation',
    'ielts_mock',
    'ielts_prep',
    'sat_prep',
    'portfolio_improvement',
    'english_general',
  ]

  const [services, setServices] = useState<ServiceEntry[]>(
    serviceTypes.map((st) => ({ service_type: st, included: false, mentor_id: '' }))
  )

  const [countries, setCountries] = useState<CountryEntry[]>([
    { country: '', is_primary: true },
  ])

  const [confidentialNote, setConfidentialNote] = useState('')
  const createdStudentRef = useRef<{ id: string; full_name: string } | null>(null)

  const { data: mentors = [] } = useQuery({
    queryKey: ['users', 'mentor'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
  })

  const { data: availableCountries = [] } = useQuery({
    queryKey: ['countries'],
    queryFn: countriesApi.list,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const student = await studentsApi.create(studentForm)
      createdStudentRef.current = { id: student.id, full_name: student.full_name }
      const contract = await contractsApi.create({
        student_id: student.id,
        signed_date: contractForm.signed_date || undefined,
        amount: contractForm.amount || undefined,
        currency: contractForm.currency,
        pipeline_status: contractForm.pipeline_status,
        payment_plan: contractForm.payment_plan || undefined,
        ielts_payment_included: contractForm.ielts_payment_included,
        notes: contractForm.notes || undefined,
      })

      const relatedRequests: Promise<unknown>[] = []
      if (guardianForm.full_name.trim() && guardianForm.phone.trim()) {
        relatedRequests.push(
          guardiansApi.create(student.id, {
            full_name: guardianForm.full_name,
            phone: guardianForm.phone,
            email: guardianForm.email || undefined,
            relation: guardianForm.relation,
            iin: guardianForm.iin || undefined,
            is_primary: true,
          })
        )
      }

      for (const country of countries.filter((c) => c.country)) {
        relatedRequests.push(
          applicationsApi.create({
            student_id: student.id,
            contract_id: contract.id,
            country: country.country,
            is_primary: country.is_primary,
            submissions_planned: 5,
            submission_status: 'not_started',
          })
        )
      }

      for (const service of services.filter((s) => s.included)) {
        relatedRequests.push(
          servicesApi.create({
            student_id: student.id,
            contract_id: contract.id,
            service_type: service.service_type,
            included: true,
            status: 'not_started',
            assigned_mentor_id:
              service.mentor_id && service.mentor_id !== 'none'
                ? service.mentor_id
                : undefined,
          })
        )
      }

      if (confidentialNote.trim()) {
        relatedRequests.push(
          confidentialNotesApi.create(student.id, {
            note_text: confidentialNote,
            visible_to_role: 'admin_and_mzk',
          })
        )
      }

      await Promise.all(relatedRequests)
      return student
    },
    onSuccess: (student) => {
      createdStudentRef.current = null
      toast({ title: 'Студент создан', description: student.full_name })
      navigate(`/students/${student.id}`)
    },
    onError: (err) => {
      const created = createdStudentRef.current
      if (created) {
        toast({
          title: 'Студент создан, но часть данных не сохранилась',
          description: `${created.full_name}: проверьте опекуна/услуги/страны на карточке студента — ${getErrorMessage(err)}`,
          variant: 'destructive',
          action: (
            <ToastAction altText="Открыть студента" onClick={() => navigate(`/students/${created.id}`)}>
              Открыть студента
            </ToastAction>
          ),
        })
      } else {
        toast({ title: 'Ошибка', description: getErrorMessage(err, 'Не удалось создать студента'), variant: 'destructive' })
      }
    },
  })

  const validateStep = (): boolean => {
    if (step === 0) {
      return studentForm.full_name.trim().length > 0 && studentForm.phone.trim().length > 0
    }
    if (step === 1 && guardianForm.iin.trim()) {
      return /^\d{12}$/.test(guardianForm.iin.trim())
    }
    return true
  }

  const nextStep = () => {
    if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1))
    else if (step === 1) toast({ title: 'ИИН должен содержать 12 цифр', variant: 'destructive' })
    else toast({ title: 'Заполните обязательные поля', variant: 'destructive' })
  }

  const prevStep = () => setStep((s) => Math.max(s - 1, 0))

  const updateService = (index: number, field: keyof ServiceEntry, value: string | boolean) => {
    setServices((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }

  const addCountry = () => setCountries((prev) => [...prev, { country: '', is_primary: false }])
  const removeCountry = (index: number) => setCountries((prev) => prev.filter((_, i) => i !== index))

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <PageHeader
          eyebrow="Студенты"
          title="Новый студент"
          description="Заполните основные данные и настройте сопровождение студента."
        />

        {/* Progress indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <React.Fragment key={i}>
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-8 h-8 rounded-ctl flex items-center justify-center text-sm font-semibold transition-colors border',
                    i < step
                      ? 'border-p-line text-p-muted'
                      : i === step
                      ? 'bg-black text-white border-black'
                      : 'border-p-line text-p-muted2'
                  )}
                >
                  {i < step ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={cn('text-[10px] uppercase tracking-wide mt-1.5 hidden sm:block', i === step ? 'text-p-text' : 'text-p-muted')}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn('flex-1 h-px -mt-3', i < step ? 'bg-gray-400' : 'bg-p-panel2')} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Шаг {step + 1}: {STEPS[step]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 0: Student basic data */}
          {step === 0 && (
            <>
              <div>
                <Label>ФИО <span className="text-red-500">*</span></Label>
                <Input
                  value={studentForm.full_name}
                  onChange={(e) => setStudentForm({ ...studentForm, full_name: e.target.value })}
                  placeholder="Иванов Иван Иванович"
                />
              </div>
              <div>
                <Label>Телефон <span className="text-red-500">*</span></Label>
                <Input
                  value={studentForm.phone}
                  onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })}
                  placeholder="+7 777 000 00 00"
                />
              </div>
              <div>
                <Label>Город</Label>
                <Input
                  value={studentForm.city}
                  onChange={(e) => setStudentForm({ ...studentForm, city: e.target.value })}
                  placeholder="Алматы"
                />
              </div>
              <div>
                <Label>Уровень образования</Label>
                <Select
                  value={studentForm.degree_level}
                  onValueChange={(v) => setStudentForm({ ...studentForm, degree_level: v as DegreeLevel })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEGREE_LEVEL_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Год поступления</Label>
                <Select
                  value={String(studentForm.intake_year)}
                  onValueChange={(v) => setStudentForm({ ...studentForm, intake_year: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2025">2025</SelectItem>
                    <SelectItem value="2026">2026</SelectItem>
                    <SelectItem value="2027">2027</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Специальность</Label>
                <Input
                  value={studentForm.specialty}
                  onChange={(e) => setStudentForm({ ...studentForm, specialty: e.target.value })}
                />
              </div>
              <div>
                <Label>GPA</Label>
                <Input
                  value={studentForm.gpa}
                  onChange={(e) => setStudentForm({ ...studentForm, gpa: e.target.value })}
                  placeholder="4.5"
                />
              </div>
              <div>
                <Label>Достижения</Label>
                <Textarea
                  value={studentForm.achievements_text}
                  onChange={(e) => setStudentForm({ ...studentForm, achievements_text: e.target.value })}
                />
              </div>
              <div>
                <Label>Бюджет в год</Label>
                <Input
                  value={studentForm.budget_per_year}
                  onChange={(e) => setStudentForm({ ...studentForm, budget_per_year: e.target.value })}
                  placeholder="20000"
                />
              </div>
            </>
          )}

          {/* Step 1: Guardian */}
          {step === 1 && (
            <>
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
                ИИН является конфиденциальным. Он будет зашифрован и доступен только авторизованным лицам.
              </div>
              <div>
                <Label>ФИО опекуна</Label>
                <Input
                  value={guardianForm.full_name}
                  onChange={(e) => setGuardianForm({ ...guardianForm, full_name: e.target.value })}
                />
              </div>
              <div>
                <Label>ИИН</Label>
                <Input
                  value={guardianForm.iin}
                  onChange={(e) => setGuardianForm({ ...guardianForm, iin: e.target.value })}
                  placeholder="000000000000"
                  maxLength={12}
                />
              </div>
              <div>
                <Label>Отношение</Label>
                <Select value={guardianForm.relation} onValueChange={(v) => setGuardianForm({ ...guardianForm, relation: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parent">Родитель</SelectItem>
                    <SelectItem value="guardian">Опекун</SelectItem>
                    <SelectItem value="other">Другое</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Телефон</Label>
                <Input
                  value={guardianForm.phone}
                  onChange={(e) => setGuardianForm({ ...guardianForm, phone: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={guardianForm.email}
                  onChange={(e) => setGuardianForm({ ...guardianForm, email: e.target.value })}
                />
              </div>
            </>
          )}

          {/* Step 2: Contract */}
          {step === 2 && (
            <>
              <div>
                <Label>Дата подписания</Label>
                <Input
                  type="date"
                  value={contractForm.signed_date}
                  onChange={(e) => setContractForm({ ...contractForm, signed_date: e.target.value })}
                />
              </div>
              <div>
                <Label>Сумма</Label>
                <Input
                  value={contractForm.amount}
                  onChange={(e) => setContractForm({ ...contractForm, amount: e.target.value })}
                  placeholder="5000"
                />
              </div>
              <div>
                <Label>Валюта</Label>
                <Select value={contractForm.currency} onValueChange={(v) => setContractForm({ ...contractForm, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="KZT">KZT</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Статус пайплайна</Label>
                <Select value={contractForm.pipeline_status} onValueChange={(v) => setContractForm({ ...contractForm, pipeline_status: v as PipelineStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PIPELINE_STATUS_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>План платежей</Label>
                <Select
                  value={contractForm.payment_plan || 'none'}
                  onValueChange={(v) =>
                    setContractForm({
                      ...contractForm,
                      payment_plan:
                        v === 'none' ? '' : (v as ContractForm['payment_plan']),
                    })
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Не указан" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не указан</SelectItem>
                    <SelectItem value="full">Полная оплата</SelectItem>
                    <SelectItem value="installments">Рассрочка</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={contractForm.ielts_payment_included}
                  onCheckedChange={(v) => setContractForm({ ...contractForm, ielts_payment_included: !!v })}
                />
                <Label>IELTS включён в договор</Label>
              </div>
              <div>
                <Label>Примечания</Label>
                <Textarea
                  value={contractForm.notes}
                  onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })}
                />
              </div>
            </>
          )}

          {/* Step 3: Services */}
          {step === 3 && (
            <div className="space-y-4">
              {services.map((svc, i) => (
                <div key={svc.service_type} className="border border-p-line rounded-panel p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Checkbox
                      checked={svc.included}
                      onCheckedChange={(v) => updateService(i, 'included', !!v)}
                    />
                    <span className="font-medium text-sm">
                      {SERVICE_TYPE_LABELS[svc.service_type]}
                    </span>
                  </div>
                  {svc.included && (
                    <div className="ml-7">
                      <Label className="text-xs">Ментор</Label>
                      <Select
                        value={svc.mentor_id || 'none'}
                        onValueChange={(v) => updateService(i, 'mentor_id', v)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Не назначен" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не назначен</SelectItem>
                          {mentors.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Step 4: Countries */}
          {step === 4 && (
            <div className="space-y-3">
              {countries.map((c, i) => (
                <div key={i} className="flex items-center gap-3 border border-p-line rounded-panel p-3">
                  <div className="flex-1">
                    <Select
                      value={c.country}
                      onValueChange={(v) =>
                        setCountries((prev) =>
                          prev.map((cc, idx) => (idx === i ? { ...cc, country: v } : cc))
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите страну" /></SelectTrigger>
                      <SelectContent>
                        {availableCountries.map((country) => (
                          <SelectItem key={country.id} value={country.country_name}>
                            {country.country_name}
                            {country.vpp_required && ' (VPP)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={c.is_primary}
                      onCheckedChange={(v) =>
                        setCountries((prev) =>
                          prev.map((cc, idx) => (idx === i ? { ...cc, is_primary: !!v } : cc))
                        )
                      }
                    />
                    <Label className="text-xs">Осн.</Label>
                  </div>
                  {i > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => removeCountry(i)}>
                      ✕
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addCountry}>
                + Добавить страну
              </Button>
            </div>
          )}

          {/* Step 5: Confidential notes */}
          {step === 5 && (
            <>
              <div className="bg-orange-50 border border-orange-200 rounded-md p-3 text-sm text-orange-800">
                Конфиденциальные заметки видны только администраторам и менеджерам.
              </div>
              <div>
                <Label>Заметка (опционально)</Label>
                <Textarea
                  value={confidentialNote}
                  onChange={(e) => setConfidentialNote(e.target.value)}
                  placeholder="Особые обстоятельства, важные детали..."
                  rows={5}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6">
        <Button variant="outline" onClick={prevStep} disabled={step === 0}>
          Назад
        </Button>

        <div className="flex items-center gap-3">
          {step < STEPS.length - 1 ? (
            <Button onClick={nextStep}>
              Далее
            </Button>
          ) : (
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Создание...' : 'Создать студента'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
