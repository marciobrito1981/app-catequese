import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Church,
  CircleHelp,
  Clock3,
  Eye,
  FileCheck2,
  FileText,
  Heart,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { AttendancePanel, MeetingAgenda, MeetingsManagement, NotificationsBanner, TransferClassControl } from './MeetingsPanels'
import {
  calculateAge,
  digits,
  formatDateTime,
  isValidCpf,
  maskCep,
  maskCpf,
  maskDate,
  maskPhone,
  parseBrazilianDate,
  privacyNotice,
  weekdays,
} from './lib/registration'
import type {
  AuthenticatedProfile,
  CatechistRecord,
  Profile,
  ProfileAddress,
  RegistrationRow,
  Schedule,
  UserRole,
} from './lib/types'

type Screen = 'login' | 'registration' | 'dashboard' | 'catequizando-registration' | 'profile'
type Feedback = { kind: 'success' | 'error' | 'info'; text: string }

const underageMessage = 'Para se inscrever na catequese de adultos você precisa ter 18 anos ou mais, sua inscrição, será analisada com carinho!'

const initialForm = {
  fullName: '',
  birthDate: '',
  cpf: '',
  sex: '',
  maritalStatus: '',
  postalCode: '',
  street: '',
  streetNumber: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  email: '',
  phone: '',
  referralSource: '',
  referralOther: '',
  registrationReason: '',
  reasonOther: '',
  sacraments: [] as string[],
  baptismDate: '',
  baptismParish: '',
  baptismCity: '',
  baptismState: '',
  eucharistParish: '',
  eucharistCity: '',
  eucharistState: '',
  scheduleIds: [] as string[],
  privacyAcknowledged: false,
}

type FormValues = typeof initialForm
type RegistrationPreference = {
  weekday: number
  starts_at: string
  ends_at: string
  classes: { name: string } | null
}
type AdminSchedule = {
  id: string
  class_id: string
  weekday: number
  starts_at: string
  ends_at: string
  active: boolean
  available: boolean
  classes: { name: string } | null
}

const defaultProvisionalPassword = '12345678'

const roles: Record<UserRole, string> = {
  coordenador: 'Coordenador',
  catequista: 'Catequista',
  catequizando: 'Catequizando',
}

type UserDirectoryProfile = Profile & { full_name: string; active?: boolean }

async function loadAuthenticatedProfile(
  client: NonNullable<typeof supabase>,
  user: User,
): Promise<AuthenticatedProfile> {
  const { data: roleProfile, error: roleError } = await client
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single()
  if (roleError) throw roleError

  let detail: {
    full_name: string
    phone: string | null
    cpf?: string | null
    birth_date?: string | null
    address?: ProfileAddress | null
  } | null = null
  if (roleProfile.role === 'catequista') {
    const { data, error } = await client
      .from('t_catequista')
      .select('full_name, phone, cpf')
      .eq('id', user.id)
      .maybeSingle()
    if (error) throw error
    detail = data
  } else if (roleProfile.role === 'catequizando') {
    const { data, error } = await client
      .from('t_catequizando')
      .select('full_name, phone, cpf, birth_date, postal_code, street, street_number, complement, neighborhood, city, state')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    const row = data?.[0]
    detail = row
      ? {
        full_name: row.full_name,
        phone: row.phone,
        cpf: row.cpf,
        birth_date: row.birth_date,
        address: {
          postal_code: row.postal_code,
          street: row.street,
          street_number: row.street_number,
          complement: row.complement,
          neighborhood: row.neighborhood,
          city: row.city,
          state: row.state,
        },
      }
      : null
  }

  const metadataName = typeof user.user_metadata.full_name === 'string'
    ? user.user_metadata.full_name
    : ''
  const metadataPhone = typeof user.user_metadata.phone === 'string'
    ? user.user_metadata.phone
    : null
  const { data: mustChangePassword, error: passwordStatusError } = await client.rpc(
    'is_initial_password_change_required',
  )
  if (passwordStatusError) throw passwordStatusError
  return {
    ...roleProfile,
    full_name: detail?.full_name || metadataName || user.email?.split('@')[0] || 'Usuário',
    phone: detail?.phone ?? metadataPhone,
    email: user.email ?? '',
    cpf: detail?.cpf ?? null,
    birth_date: detail?.birth_date ?? null,
    address: detail?.address ?? null,
    mustChangePassword,
  }
}

async function functionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    const body = await context.json().catch(() => null) as { error?: string } | null
    if (body?.error) return body.error
  }
  return fallback
}

function isConfigurationMissing() {
  return !supabase
}

function ErrorBanner({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null
  const Icon = feedback.kind === 'success' ? CheckCircle2 : CircleHelp
  return (
    <div className={`feedback feedback-${feedback.kind}`} role="status" aria-live="polite">
      <Icon size={18} aria-hidden="true" />
      <span>{feedback.text}</span>
    </div>
  )
}

function Field({
  label,
  required,
  children,
  className = '',
  hint,
}: {
  label: string
  required?: boolean
  children: ReactNode
  className?: string
  hint?: string
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">
        {label}
        {required && <span className="required-mark" aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

function SectionHeading({
  number,
  icon,
  title,
  description,
}: {
  number: string
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="section-heading">
      <span className="section-number">{number}</span>
      <span className="section-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('login')
  const [profile, setProfile] = useState<AuthenticatedProfile | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    let active = true
    const client = supabase
    const loadProfile = async (userId: string, email = '') => {
      const { data: sessionData, error: sessionError } = await client.auth.getSession()
      if (sessionError || !sessionData.session || sessionData.session.user.id !== userId) {
        if (!active) return
        setProfile(null)
        setScreen('login')
        return
      }
      try {
        const loadedProfile = await loadAuthenticatedProfile(client, {
          ...sessionData.session.user,
          email: sessionData.session.user.email ?? email,
        })
        if (!active) return
        setProfile(loadedProfile)
        setScreen((current) => (current === 'login' ? 'dashboard' : current))
      } catch {
        if (!active) return
        setProfile(null)
        setScreen('login')
      }
    }

    client.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) {
        void loadProfile(data.session.user.id, data.session.user.email ?? '').finally(() => {
          if (active) setAuthLoading(false)
        })
      } else {
        setAuthLoading(false)
      }
    })

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session) {
        window.setTimeout(() => {
          void loadProfile(session.user.id, session.user.email ?? '')
        }, 0)
      } else {
        setProfile(null)
        setScreen('login')
      }
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    const client = supabase
    if (!client) return false
    const { error } = await client.auth.signOut()
    if (error) return false
    setProfile(null)
    setScreen('login')
    return true
  }

  if (authLoading) {
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" size={30} />
        <span>Preparando seu espaço...</span>
      </main>
    )
  }

  if (profile?.mustChangePassword) {
    return (
      <FirstAccessPasswordPage
        onComplete={() => {
          setProfile({ ...profile, mustChangePassword: false })
          setScreen('dashboard')
        }}
        onSignOut={signOut}
      />
    )
  }

  if (screen === 'registration') {
    return <RegistrationPage onBack={() => setScreen('login')} />
  }

  if (screen === 'catequizando-registration' && profile?.role === 'coordenador') {
    return (
      <RegistrationPage
        onBack={() => setScreen('dashboard')}
        internal
      />
    )
  }

  if (screen === 'profile' && profile) {
    return <ProfilePage profile={profile} onBack={() => setScreen('dashboard')} onProfileUpdated={setProfile} />
  }

  if (screen === 'dashboard' && profile) {
    return (
      <Dashboard
        profile={profile}
        onNavigateToProfile={() => setScreen('profile')}
        onSignOut={signOut}
        mobileMenuOpen={mobileMenuOpen}
        onToggleMenu={() => setMobileMenuOpen((open) => !open)}
        onCloseMenu={() => setMobileMenuOpen(false)}
      />
    )
  }

  return (
    <LoginPage
      onRegister={() => setScreen('registration')}
      onLogin={(signedInProfile) => {
        setProfile(signedInProfile)
        setScreen('dashboard')
      }}
    />
  )
}

function LoginPage({
  onRegister,
  onLogin,
}: {
  onRegister: () => void
  onLogin: (profile: AuthenticatedProfile) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)
    if (!supabase) {
      setFeedback({ kind: 'error', text: 'Configure o Supabase no arquivo .env para entrar.' })
      return
    }
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      setFeedback({
        kind: 'error',
        text: 'Não foi possível entrar. Confira seu e-mail e sua senha e tente novamente.',
      })
      setLoading(false)
      return
    }
    let userProfile: AuthenticatedProfile
    try {
      userProfile = await loadAuthenticatedProfile(supabase, data.user)
    } catch {
      setFeedback({
        kind: 'error',
        text: 'Seu perfil ainda não está disponível. Peça ajuda à secretaria paroquial.',
      })
      setLoading(false)
      return
    }
    onLogin(userProfile)
    setLoading(false)
  }

  const handlePasswordReset = async () => {
    setFeedback(null)
    if (!supabase) {
      setFeedback({ kind: 'error', text: 'Configure o Supabase para recuperar sua senha.' })
      return
    }
    if (!email.trim()) {
      setFeedback({ kind: 'info', text: 'Informe seu e-mail para receber o link de recuperação.' })
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    setFeedback(
      error
        ? { kind: 'error', text: 'Não foi possível enviar as instruções agora. Tente novamente mais tarde.' }
        : { kind: 'success', text: 'Se houver uma conta com este e-mail, enviaremos as instruções de recuperação.' },
    )
  }

  return (
    <main className="auth-page">
      <section className="welcome-panel">
        <div className="welcome-top">
          <div className="brand-lockup">
            <span className="brand-symbol"><Church size={24} strokeWidth={1.6} /></span>
            <span>PARÓQUIA SÃO JOSÉ - CAMPINAS/SP</span>
          </div>
          <span className="version-pill">ESPAÇO DA CATEQUESE ADULTOS</span>
        </div>
        <div className="welcome-copy">
          <span className="eyebrow"><span /> UM CAMINHO DE FÉ E ENCONTRO</span>
          <h1>Catequese<br />de <em>Adultos.</em></h1>
          <p>Um espaço para caminhar na fé, descobrir a beleza dos sacramentos e crescer em comunidade.</p>
          <div className="scripture">
            <span className="scripture-mark">“</span>
            <p>Ide e fazei discípulos<br />de todos os povos.</p>
            <span className="scripture-ref">MATEUS 28,19</span>
          </div>
        </div>
        <div className="welcome-footer">
          <span><Heart size={14} /> Fé que acolhe. Comunidade que transforma.</span>
        </div>
        <div className="decorative-cross" aria-hidden="true">✳</div>
      </section>

      <section className="login-panel">
        <div className="login-content">
          <div className="mobile-brand">
            <Church size={23} />
            <span>PARÓQUIA SÃO JOSÉ</span>
          </div>
          <div className="login-heading">
            <span className="eyebrow">SEJA BEM-VINDO(A)</span>
            <h2>Entre na sua conta</h2>
            <p>Acesse seu espaço de catequese com segurança.</p>
          </div>
          <ErrorBanner feedback={feedback} />
          <form className="login-form" onSubmit={(event) => void handleLogin(event)}>
            <Field label="E-mail" required>
              <span className="input-icon"><Mail size={17} /></span>
              <input
                type="email"
                autoComplete="email"
                placeholder="seuemail@exemplo.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            <Field label="Senha" required>
              <span className="input-icon"><LockKeyhole size={17} /></span>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Digite sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            <button type="button" className="text-button forgot-link" onClick={() => void handlePasswordReset()}>
              Esqueceu sua senha?
            </button>
            <button type="submit" className="button button-primary button-wide" disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={18} /> : <>Entrar <ArrowRight size={17} /></>}
            </button>
          </form>
          <div className="login-divider"><span>AINDA NÃO FAZ PARTE?</span></div>
          <button type="button" className="button button-outline button-wide" onClick={onRegister}>
            Fazer inscrição na catequese <ArrowRight size={17} />
          </button>
          <div className="login-reassurance"><ShieldCheck size={16} /> Seus dados são tratados com cuidado e confidencialidade.</div>
        </div>
        <footer className="login-footer">
          <span>© 2026 Paróquia São José</span>
          <span>Feito com <Heart size={12} fill="currentColor" /> para a comunidade</span>
        </footer>
      </section>
    </main>
  )
}

function RegistrationPage({
  onBack,
  internal = false,
}: {
  onBack: () => void
  internal?: boolean
}) {
  const [values, setValues] = useState<FormValues>(initialForm)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [certificate, setCertificate] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    setSchedulesLoading(true)
    const loadFormData = async () => {
      const { data, error } = await client
        .from('class_schedules')
        .select('id, weekday, starts_at, ends_at, classes(name)')
        .eq('active', true)
        .eq('available', true)
        .order('weekday')
        .order('starts_at')
      if (!active) return
      if (error) {
        setFeedback({ kind: 'error', text: 'Não foi possível carregar os dias disponíveis. Tente novamente mais tarde.' })
      } else {
        setSchedules((data ?? []) as Schedule[])
      }
      setSchedulesLoading(false)
    }
    void loadFormData()
    return () => {
      active = false
    }
  }, [])

  const age = useMemo(() => calculateAge(values.birthDate), [values.birthDate])
  const hasBaptism = values.sacraments.includes('batismo')
  const hasEucharist = values.sacraments.includes('primeira_eucaristia')
  const marriedInChurch = values.maritalStatus === 'casado_igreja'
  const formSectionOffset = marriedInChurch ? 1 : 0

  const update = <Key extends keyof FormValues>(key: Key, value: FormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const availableWeekdays = useMemo(() => {
    const byDay = new Map<number, { ids: string[]; times: string[] }>()
    schedules.forEach((schedule) => {
      const entry = byDay.get(schedule.weekday) ?? { ids: [], times: [] }
      const time = `${schedule.starts_at.slice(0, 5)} às ${schedule.ends_at.slice(0, 5)}`
      entry.ids.push(schedule.id)
      if (!entry.times.includes(time)) entry.times.push(time)
      byDay.set(schedule.weekday, entry)
    })
    return [...byDay.entries()].sort((a, b) => a[0] - b[0])
  }, [schedules])

  const toggleWeekday = (ids: string[]) => {
    setValues((current) => {
      const all = ids.every((id) => current.scheduleIds.includes(id))
      const rest = current.scheduleIds.filter((id) => !ids.includes(id))
      return { ...current, scheduleIds: all ? rest : [...rest, ...ids] }
    })
  }

  const toggleOption = (key: 'sacraments' | 'scheduleIds', option: string) => {
    const selected = values[key]
    let next: string[]
    if (key === 'sacraments' && option === 'nenhum') {
      next = selected.includes(option) ? [] : ['nenhum']
    } else {
      next = selected.filter((item) => item !== 'nenhum')
      next = next.includes(option) ? next.filter((item) => item !== option) : [...next, option]
    }
    update(key, next)
    if (key === 'sacraments' && !next.includes('batismo')) {
      setValues((current) => ({
        ...current,
        sacraments: next,
        baptismDate: '',
        baptismParish: '',
        baptismCity: '',
        baptismState: '',
        ...(!next.includes('primeira_eucaristia')
          ? { eucharistParish: '', eucharistCity: '' }
          : {}),
      }))
    } else if (key === 'sacraments' && !next.includes('primeira_eucaristia')) {
      setValues((current) => ({
        ...current,
        sacraments: next,
        eucharistParish: '',
        eucharistCity: '',
        eucharistState: '',
      }))
    }
  }

  const lookupPostalCode = async () => {
    const postalCode = digits(values.postalCode)
    if (postalCode.length !== 8) return
    try {
      const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`)
      if (!response.ok) throw new Error('Não foi possível consultar o CEP.')
      const address = (await response.json()) as {
        erro?: boolean
        logradouro?: string
        bairro?: string
        localidade?: string
        uf?: string
      }
      if (address.erro) {
        setFeedback({ kind: 'error', text: 'CEP não encontrado. Confira os números e tente novamente.' })
        return
      }
      setValues((current) => ({
        ...current,
        street: address.logradouro ?? '',
        neighborhood: address.bairro ?? '',
        city: address.localidade ?? '',
        state: address.uf ?? '',
      }))
      setFeedback(null)
    } catch {
      setFeedback({ kind: 'error', text: 'Não foi possível consultar o CEP. Preencha o endereço manualmente.' })
    }
  }

  const handleCertificate = (file: File | undefined) => {
    setFeedback(null)
    if (!file) {
      setCertificate(null)
      return
    }
    const allowed = ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024) {
      setFeedback({ kind: 'error', text: 'Anexe um PDF, JPG ou PNG de até 10 MB.' })
      setCertificate(null)
      return
    }
    setCertificate(file)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)
    if (!supabase) {
      setFeedback({ kind: 'error', text: 'A inscrição não foi enviada. Configure o Supabase antes de receber inscrições.' })
      return
    }
    if (!isValidCpf(values.cpf)) {
      setFeedback({ kind: 'error', text: 'Confira o CPF informado.' })
      return
    }
    const birthDate = parseBrazilianDate(values.birthDate)
    if (!birthDate || !age) {
      setFeedback({ kind: 'error', text: 'Informe uma data de nascimento válida.' })
      return
    }
    if (Number(age) < 18) {
      window.alert(underageMessage)
    }
    const baptismDate = values.baptismDate ? parseBrazilianDate(values.baptismDate) : null
    if (values.baptismDate && !baptismDate) {
      setFeedback({ kind: 'error', text: 'Confira a data de batismo informada.' })
      return
    }
    if (certificate && !marriedInChurch) {
      setFeedback({ kind: 'error', text: 'O comprovante de matrimônio só pode ser anexado para casamento na Igreja.' })
      return
    }

    setLoading(true)
    let certificatePath: string | null = null
    if (certificate) {
      const { data: token, error: tokenError } = await supabase.rpc('create_registration_upload_token')
      if (tokenError || !token) {
        setFeedback({ kind: 'error', text: tokenError?.message ?? 'Não foi possível preparar o envio do comprovante.' })
        setLoading(false)
        return
      }
      const extension = certificate.name.split('.').pop()?.toLowerCase()
      if (!extension || !['pdf', 'jpg', 'jpeg', 'png'].includes(extension)) {
        setFeedback({ kind: 'error', text: 'O formato do nome do arquivo não é válido.' })
        setLoading(false)
        return
      }
      certificatePath = `${token}/certificate.${extension}`
      const { error: uploadError } = await supabase.storage
        .from('marriage-certificates')
        .upload(certificatePath, certificate, { contentType: certificate.type, upsert: false })
      if (uploadError) {
        setFeedback({ kind: 'error', text: 'Não foi possível armazenar o comprovante. Confira sua conexão e tente novamente.' })
        setLoading(false)
        return
      }
    }

    const payload = {
      full_name: values.fullName.trim(),
      birth_date: birthDate,
      cpf: digits(values.cpf),
      sex: values.sex,
      marital_status: values.maritalStatus,
      postal_code: digits(values.postalCode),
      street: values.street.trim(),
      street_number: values.streetNumber.trim(),
      complement: values.complement.trim(),
      neighborhood: values.neighborhood.trim(),
      city: values.city.trim(),
      state: values.state.toUpperCase(),
      email: values.email.trim(),
      phone: digits(values.phone),
      referral_source: values.referralSource,
      referral_other: values.referralOther,
      registration_reason: values.registrationReason,
      reason_other: values.reasonOther,
      sacraments: values.sacraments,
      baptism_date: baptismDate,
      baptism_parish: values.baptismParish,
      baptism_city: values.baptismCity,
      baptism_state: values.baptismState.toUpperCase(),
      eucharist_parish: values.eucharistParish,
      eucharist_city: values.eucharistCity,
      eucharist_state: values.eucharistState.toUpperCase(),
      schedule_ids: values.scheduleIds,
      privacy_acknowledged: values.privacyAcknowledged,
      marriage_certificate_path: certificatePath,
    }
    const result = internal
      ? await supabase.rpc('create_catequizando_registration', { p_payload: payload })
      : await supabase.rpc('submit_public_registration', { p_payload: payload })
    setLoading(false)
    if (result.error) {
      setFeedback({ kind: 'error', text: 'Não foi possível concluir a inscrição. Revise os dados e tente novamente; se o problema persistir, procure a secretaria paroquial.' })
      return
    }
    setSubmitted(true)
    setFeedback({
      kind: 'success',
      text: internal
        ? 'Cadastro de catequizando concluído.'
        : 'Sua inscrição foi recebida para análise. A escolha de horários é uma preferência, não confirma matrícula em turma.',
    })
  }

  if (submitted) {
    return (
      <main className="registration-page">
        <header className="form-topbar">
          <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> Voltar ao início</button>
          <Brand />
          <span className="topbar-spacer" />
        </header>
        <section className="success-card">
          <span className="success-icon"><Check size={34} /></span>
          <span className="eyebrow">INSCRIÇÃO RECEBIDA</span>
          <h1>Que bom ter você<br />neste caminho.</h1>
          <p>{feedback?.text}</p>
          <div className="success-next-step">
            <CalendarDays size={20} />
            <span>A equipe paroquial analisará suas informações e entrará em contato pelo e-mail ou telefone informado.</span>
          </div>
          <button className="button button-primary" onClick={onBack}>Voltar ao início <ArrowRight size={17} /></button>
        </section>
        <footer className="form-footer">PARÓQUIA SÃO JOSÉ <span>·</span> CATEQUESE DE ADULTOS</footer>
      </main>
    )
  }

  return (
    <main className="registration-page">
      <header className="form-topbar">
        <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> Voltar</button>
        <Brand />
        <span className="secure-label"><ShieldCheck size={15} /> INSCRIÇÃO SEGURA</span>
      </header>
      <section className="form-intro">
        <span className="eyebrow"><span /> UM NOVO PASSO NA SUA CAMINHADA</span>
        <h1>{internal ? <>Cadastro de<br /><em>catequizando</em></> : <>Inscrição na Catequese<br /><em>de Adultos</em></>}</h1>
        <p>{internal ? 'Preencha os mesmos dados da inscrição para incluir o catequizando no sistema paroquial.' : 'Preencha seus dados com carinho. Eles nos ajudam a acolher você e preparar esse caminho juntos.'}</p>
        <div className="required-note"><span className="required-mark">*</span> Campos obrigatórios</div>
      </section>

      <form className="registration-form" onSubmit={(event) => void submit(event)}>
        <section className="form-section">
          <SectionHeading number="01" icon={<UserRound size={20} />} title="Seus dados" description="Vamos começar conhecendo um pouco sobre você." />
          <div className="form-grid">
            <Field label="Nome completo" required className="span-2">
              <input autoComplete="name" value={values.fullName} onChange={(event) => update('fullName', event.target.value)} placeholder="Como podemos chamar você?" required maxLength={150} />
            </Field>
            <Field label="Data de nascimento" required>
              <input inputMode="numeric" placeholder="DD/MM/AAAA" value={values.birthDate}               onChange={(event) => update('birthDate', maskDate(event.target.value))} required maxLength={10} />
            </Field>
            <Field label="Idade atual" hint="Calculada automaticamente">
              <input value={age ? `${age} anos` : ''} readOnly placeholder="Preencha sua data de nascimento" className="readonly-input" aria-label="Idade atual calculada automaticamente" />
            </Field>
            <Field label="CPF" required>
              <input inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={values.cpf} onChange={(event) => update('cpf', maskCpf(event.target.value))} required maxLength={14} />
            </Field>
            <Field label="Sexo">
              <select value={values.sex} onChange={(event) => update('sex', event.target.value)}>
                <option value="">Selecione, se desejar</option>
                <option value="feminino">Feminino</option>
                <option value="masculino">Masculino</option>
              </select>
            </Field>
            <Field label="Estado civil" required>
              <select value={values.maritalStatus} onChange={(event) => update('maritalStatus', event.target.value)} required>
                <option value="">Selecione</option>
                <option value="solteiro">Solteiro(a)</option>
                <option value="casado_igreja">Casado(a) na Igreja</option>
                <option value="casado_civil">Casado(a) no civil</option>
                <option value="divorciado">Divorciado(a)</option>
                <option value="viuvo">Viúvo(a)</option>
                <option value="outro">Outro</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="form-section">
          <SectionHeading number="02" icon={<MapPin size={20} />} title="Onde encontrar você" description="Seu endereço e seus contatos para nossa equipe." />
          <div className="form-grid">
            <Field label="CEP" required className="cep-field">
              <input
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="00000-000"
                value={values.postalCode}
                onChange={(event) => update('postalCode', maskCep(event.target.value))}
                onBlur={() => void lookupPostalCode()}
                required
                maxLength={9}
              />
              <span className="inline-hint">O endereço será preenchido automaticamente</span>
            </Field>
            <Field label="Logradouro" required className="span-2">
              <input autoComplete="street-address" value={values.street} onChange={(event) => update('street', event.target.value)} placeholder="Rua, avenida..." required maxLength={160} />
            </Field>
            <Field label="Número" required>
              <input value={values.streetNumber} onChange={(event) => update('streetNumber', event.target.value)} placeholder="Nº" required maxLength={20} />
            </Field>
            <Field label="Complemento">
              <input value={values.complement} onChange={(event) => update('complement', event.target.value)} placeholder="Apto, bloco..." maxLength={100} />
            </Field>
            <Field label="Bairro" required>
              <input autoComplete="address-level3" value={values.neighborhood} onChange={(event) => update('neighborhood', event.target.value)} required maxLength={100} />
            </Field>
            <Field label="Cidade" required>
              <input autoComplete="address-level2" value={values.city} onChange={(event) => update('city', event.target.value)} required maxLength={100} />
            </Field>
            <Field label="Estado (UF)" required>
              <input autoComplete="address-level1" value={values.state} onChange={(event) => update('state', event.target.value.toUpperCase().slice(0, 2))} placeholder="SP" required maxLength={2} />
            </Field>
            <Field label="E-mail" required>
              <input type="email" autoComplete="email" value={values.email} onChange={(event) => update('email', event.target.value)} placeholder="seuemail@exemplo.com" required maxLength={254} />
            </Field>
            <Field label="Celular com DDD" required>
              <input type="tel" inputMode="tel" autoComplete="tel-national" value={values.phone} onChange={(event) => update('phone', maskPhone(event.target.value))} placeholder="(11) 99999-9999" required maxLength={16} />
            </Field>
          </div>
        </section>

        {marriedInChurch && (
          <section className="form-section conditional-section">
            <SectionHeading number="03" icon={<FileCheck2 size={20} />} title="Comprovante de matrimônio" description="Se desejar, anexe o documento para conferência pela equipe autorizada." />
            <div className="upload-box">
              <FileText size={22} />
              <div>
                <strong>{certificate?.name ?? 'Anexe o comprovante de matrimônio'}</strong>
                <span>PDF, JPG ou PNG · até 10 MB · documento privado</span>
              </div>
              <label className="button button-small button-outline">
                Escolher arquivo
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => handleCertificate(event.target.files?.[0])} />
              </label>
            </div>
          </section>
        )}

        <section className="form-section">
          <SectionHeading number={String(3 + formSectionOffset).padStart(2, '0')} icon={<Heart size={20} />} title="Sua história" description="Conte como chegou até aqui e o que busca neste caminho." />
          <div className="form-grid">
            <Field label="Como soube da catequese de adultos?" required className="span-2">
              <select value={values.referralSource} onChange={(event) => update('referralSource', event.target.value)} required>
                <option value="">Selecione uma opção</option>
                <option value="amigos_familiares">Indicação de amigos/familiares</option>
                <option value="missas">Durante as missas</option>
                <option value="catequese_infantil">Através da catequese infantil</option>
                <option value="outro">Outro</option>
              </select>
            </Field>
            {values.referralSource === 'outro' && (
              <Field label="Como ficou sabendo?" required className="span-2">
                <input value={values.referralOther} onChange={(event) => update('referralOther', event.target.value)} required maxLength={200} />
              </Field>
            )}
            <Field label="Motivo para se inscrever" required className="span-2">
              <select value={values.registrationReason} onChange={(event) => update('registrationReason', event.target.value)} required>
                <option value="">Selecione uma opção</option>
                <option value="preparacao_casamento">Preparação para o casamento</option>
                <option value="receber_sacramentos">Gostaria de receber os sacramentos que ainda não tenho</option>
                <option value="ouvinte">Tenho todos os sacramentos, mas gostaria de ser ouvinte</option>
                <option value="acompanhar_filho">Acompanhar meu(minha) filho(a) na catequese</option>
                <option value="outro">Outro</option>
              </select>
            </Field>
            {values.registrationReason === 'outro' && (
              <Field label="Conte um pouco mais" required className="span-2">
                <input value={values.reasonOther} onChange={(event) => update('reasonOther', event.target.value)} required maxLength={300} />
              </Field>
            )}
          </div>
        </section>

        <section className="form-section">
          <SectionHeading number={String(4 + formSectionOffset).padStart(2, '0')} icon={<CalendarDays size={20} />} title="Dias e horários" description="Marque os dias da semana que funcionam para você." />
          <div className="options-grid schedule-options">
            {schedulesLoading && <div className="inline-loading"><LoaderCircle className="spin" size={17} /> Carregando horários disponíveis...</div>}
            {!schedulesLoading && schedules.length === 0 && (
              <p className="empty-options">{isConfigurationMissing() ? 'Os horários aparecerão aqui quando o sistema for conectado.' : 'No momento não há horários disponíveis. Você poderá concluir sua inscrição sem selecionar uma preferência.'}</p>
            )}
            {availableWeekdays.map(([weekday, { ids, times }]) => {
              const checked = ids.every((id) => values.scheduleIds.includes(id))
              return (
                <label className={`select-card ${checked ? 'selected' : ''}`} key={weekday}>
                  <input type="checkbox" checked={checked} onChange={() => toggleWeekday(ids)} />
                  <span className="check-box"><Check size={13} /></span>
                  <span><strong>{weekdays[weekday]}</strong><small>{times.join(' · ')}</small></span>
                </label>
              )
            })}
          </div>
        </section>

        <section className="form-section">
          <SectionHeading number={String(5 + formSectionOffset).padStart(2, '0')} icon={<BookOpen size={20} />} title="Sacramentos" description="Selecione os sacramentos que você já recebeu." />
          <div className="options-grid sacrament-options">
            {[
              ['nenhum', 'Nenhum'],
              ['batismo', 'Batismo'],
              ['primeira_eucaristia', '1ª Eucaristia'],
              ['crisma', 'Crisma'],
            ].map(([value, label]) => (
              <label className={`select-card compact ${values.sacraments.includes(value) ? 'selected' : ''}`} key={value}>
                <input type="checkbox" checked={values.sacraments.includes(value)} onChange={() => toggleOption('sacraments', value)} />
                <span className="check-box"><Check size={13} /></span>
                <strong>{label}</strong>
              </label>
            ))}
          </div>
          {hasBaptism && (
            <div className="conditional-fields">
              <div className="conditional-caption"><span /> Dados do batismo <small>Preencha o que souber</small></div>
              <div className="form-grid">
                <Field label="Paróquia ou igreja">
                  <input value={values.baptismParish} onChange={(event) => update('baptismParish', event.target.value)} maxLength={150} />
                </Field>
                <Field label="Cidade">
                  <input value={values.baptismCity} onChange={(event) => update('baptismCity', event.target.value)} maxLength={100} />
                </Field>
                <Field label="Estado (UF)">
                  <input value={values.baptismState} onChange={(event) => update('baptismState', event.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
                </Field>
              </div>
            </div>
          )}
          {hasEucharist && (
            <div className="conditional-fields">
              <div className="conditional-caption"><span /> Dados da 1ª Eucaristia <small>Preencha se souber</small></div>
              <div className="form-grid">
                <Field label="Paróquia ou igreja">
                  <input value={values.eucharistParish} onChange={(event) => update('eucharistParish', event.target.value)} maxLength={150} />
                </Field>
                <Field label="Cidade">
                  <input value={values.eucharistCity} onChange={(event) => update('eucharistCity', event.target.value)} maxLength={100} />
                </Field>
                <Field label="Estado (UF)">
                  <input value={values.eucharistState} onChange={(event) => update('eucharistState', event.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
                </Field>
              </div>
            </div>
          )}
        </section>

        <section className="privacy-section">
          <div className="privacy-heading"><ShieldCheck size={20} /><strong>Aviso de privacidade</strong></div>
          <p>{privacyNotice}</p>
          <label className="privacy-consent">
            <input type="checkbox" checked={values.privacyAcknowledged} onChange={(event) => update('privacyAcknowledged', event.target.checked)}             required />            <span className="check-box"><Check size={13} /></span>
            <span>Li e estou ciente do aviso de privacidade acima. <b>*</b></span>
          </label>
          <span className="privacy-caption">A data e a hora desta confirmação serão registradas com sua inscrição.</span>
        </section>
        <ErrorBanner feedback={feedback} />
        <div className="form-submit">
          <button type="submit" className="button button-primary" disabled={loading || schedulesLoading}>
            {loading ? <><LoaderCircle className="spin" size={18} /> Salvando...</> : <>{internal ? 'Cadastrar catequizando' : 'Enviar inscrição'} <ArrowRight size={17} /></>}
          </button>
          <span><LockKeyhole size={14} /> Seus dados são enviados por conexão segura.</span>
        </div>
      </form>
      <footer className="form-footer">PARÓQUIA SÃO JOSÉ <span>·</span> CATEQUESE DE ADULTOS</footer>
    </main>
  )
}

function Brand() {
  return (
    <div className="topbar-brand">
      <span className="brand-symbol"><Church size={19} strokeWidth={1.7} /></span>
      <span>PARÓQUIA SÃO JOSÉ</span>
    </div>
  )
}

function FirstAccessPasswordPage({
  onComplete,
  onSignOut,
}: {
  onComplete: () => void
  onSignOut: () => Promise<boolean>
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)
    if (!supabase) {
      setFeedback({ kind: 'error', text: 'Não foi possível conectar ao serviço de autenticação.' })
      return
    }
    if (password.length < 8) {
      setFeedback({ kind: 'error', text: 'A nova senha deve ter pelo menos 8 caracteres.' })
      return
    }
    if (password !== confirmation) {
      setFeedback({ kind: 'error', text: 'A confirmação da senha não corresponde.' })
      return
    }

    setLoading(true)
    const { error } = await supabase.functions.invoke('complete-first-access-password', {
      body: { new_password: password },
    })
    setLoading(false)
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível alterar a senha. Confira os requisitos e tente novamente.' })
      return
    }
    onComplete()
  }

  const leaveSession = async () => {
    if (!await onSignOut()) {
      setFeedback({ kind: 'error', text: 'Não foi possível encerrar a sessão. Tente novamente.' })
    }
  }

  return (
    <main className="profile-page">
      <header className="form-topbar">
        <span className="topbar-spacer" />
        <Brand />
        <button className="text-button" type="button" onClick={() => void leaveSession()}>Sair</button>
      </header>
      <div className="profile-content">
        <div className="form-intro profile-intro">
          <span className="eyebrow"><span /> PRIMEIRO ACESSO</span>
          <h1>Troque sua <em>senha</em></h1>
          <p>Por segurança, defina uma nova senha pessoal antes de continuar.</p>
        </div>
        <form className="profile-form" onSubmit={(event) => void changePassword(event)}>
          <section className="form-section">
            <SectionHeading
              number="01"
              icon={<LockKeyhole size={20} />}
              title="Nova senha"
              description="Use uma senha pessoal com pelo menos 8 caracteres."
            />
            <div className="form-grid">
              <Field label="Nova senha" required>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </Field>
              <Field label="Confirmar nova senha" required>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  minLength={8}
                  required
                />
              </Field>
            </div>
          </section>
          <ErrorBanner feedback={feedback} />
          <div className="profile-actions">
            <button type="submit" className="button button-primary" disabled={loading}>
              {loading ? <><LoaderCircle className="spin" size={17} /> Atualizando...</> : <>Salvar nova senha <Check size={16} /></>}
            </button>
          </div>
        </form>
      </div>
      <footer className="form-footer">PARÓQUIA SÃO JOSÉ <span>·</span> CATEQUESE DE ADULTOS</footer>
    </main>
  ) 
}

function ProfilePage({
  profile,
  onBack,
  onProfileUpdated,
}: {
  profile: AuthenticatedProfile
  onBack: () => void
  onProfileUpdated: (profile: AuthenticatedProfile | null) => void
}) {
  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [email, setEmail] = useState(profile.email)
  const [address, setAddress] = useState({
    postalCode: maskCep(profile.address?.postal_code ?? ''),
    street: profile.address?.street ?? '',
    streetNumber: profile.address?.street_number ?? '',
    complement: profile.address?.complement ?? '',
    neighborhood: profile.address?.neighborhood ?? '',
    city: profile.address?.city ?? '',
    state: profile.address?.state ?? '',
  }) 
  const [editing, setEditing] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
 
  const resetForm = () => {
    setFullName(profile.full_name)
    setPhone(profile.phone ?? '')
    setEmail(profile.email)
    setAddress({
      postalCode: maskCep(profile.address?.postal_code ?? ''),
      street: profile.address?.street ?? '',
      streetNumber: profile.address?.street_number ?? '',
      complement: profile.address?.complement ?? '',
      neighborhood: profile.address?.neighborhood ?? '',
      city: profile.address?.city ?? '',
      state: profile.address?.state ?? '',
    })
    setNewPassword('')
    setConfirmPassword('')
  } 

  const cancelEditing = () => {
    resetForm()
    setFeedback(null)
    setEditing(false)
  }

  const updateAddress = (key: keyof typeof address, value: string) =>
    setAddress((current) => ({ ...current, [key]: value }))

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)
    if (!supabase) {
      setFeedback({ kind: 'error', text: 'Configure o Supabase para atualizar seu perfil.' })
      return
    }
    if (!fullName.trim()) {
      setFeedback({ kind: 'error', text: 'Informe seu nome completo.' })
      return
    }
    if (!/^\d{10,11}$/.test(digits(phone))) {
      setFeedback({ kind: 'error', text: 'Informe um telefone válido com DDD.' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFeedback({ kind: 'error', text: 'Informe um e-mail válido.' })
      return
    }
    if (profile.address) {
      if (
        digits(address.postalCode).length !== 8 ||
        !address.street.trim() ||
        !address.streetNumber.trim() ||
        !address.neighborhood.trim() ||
        !address.city.trim() ||
        !/^[A-Za-z]{2}$/.test(address.state.trim())
      ) {
        setFeedback({ kind: 'error', text: 'Preencha o endereço completo: CEP, rua, número, bairro, cidade e UF.' })
        return
      }
    }
    if (newPassword && newPassword.length < 8) {
      setFeedback({ kind: 'error', text: 'A nova senha deve ter pelo menos 8 caracteres.' })
      return
    }
    if (newPassword && newPassword !== confirmPassword) {
      setFeedback({ kind: 'error', text: 'A confirmação da senha não corresponde.' })
      return
    }
    setLoading(true)
    const updatedAddress: ProfileAddress | null = profile.address
      ? {
        postal_code: digits(address.postalCode),
        street: address.street.trim(),
        street_number: address.streetNumber.trim(),
        complement: address.complement.trim() || null,
        neighborhood: address.neighborhood.trim(),
        city: address.city.trim(),
        state: address.state.trim().toUpperCase(),
      }
      : null
    const { error: profileError } = await supabase.rpc('update_own_profile', {
      p_full_name: fullName.trim(),
      p_phone: digits(phone),
      p_address: updatedAddress,
    })
    if (profileError) {
      setLoading(false)
      setFeedback({ kind: 'error', text: 'Não foi possível atualizar seus dados. Revise as informações e tente novamente.' })
      return
    }
    const updatedName = fullName.trim()
    const updatedPhone = digits(phone)
    const { error: metadataError } = await supabase.auth.updateUser({
      data: { full_name: updatedName, phone: updatedPhone },
    })
    if (metadataError) {
      // Os metadados do Auth são apenas um fallback; o cadastro já foi atualizado.
      console.warn('Falha ao sincronizar metadados do Auth:', metadataError.message)
    }

    let updatedEmail = profile.email
    let emailNeedsConfirmation = false
    if (email.trim().toLowerCase() !== profile.email.toLowerCase()) {
      const { data, error } = await supabase.auth.updateUser({ email: email.trim().toLowerCase() })
      if (error) {
        setLoading(false)
        onProfileUpdated({ ...profile, full_name: updatedName, phone: updatedPhone, address: updatedAddress })
        setFeedback({ kind: 'error', text: 'Os demais dados foram salvos, mas não foi possível solicitar a alteração do e-mail.' })
        return
      }
      updatedEmail = data.user.email ?? profile.email
      emailNeedsConfirmation = true
    }

    if (newPassword) {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setLoading(false)
        onProfileUpdated({ ...profile, full_name: updatedName, phone: updatedPhone, email: updatedEmail, address: updatedAddress })
        setFeedback({
          kind: 'error',
          text: 'Os dados foram salvos, mas não foi possível atualizar a senha.',
        })
        return
      }
    }

    const updatedProfile = {
      ...profile,
      full_name: updatedName,
      phone: updatedPhone,
      email: updatedEmail,
      address: updatedAddress,
    }
    onProfileUpdated(updatedProfile)
    setEmail(updatedEmail)
    setNewPassword('')
    setConfirmPassword('')
    setLoading(false)
    setEditing(false)
    setFeedback({
      kind: 'success',
      text: emailNeedsConfirmation
        ? 'Perfil atualizado. Confirme a alteração do e-mail pelo link enviado à caixa de entrada.'
        : 'Seus dados pessoais foram atualizados.',
    })
  }

  return (
    <main className="profile-page">
      <header className="form-topbar">
        <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> Voltar</button>
        <Brand />
        <span className="topbar-spacer" />
      </header>
      <div className="profile-content">
        <div className="form-intro profile-intro">
          <span className="eyebrow"><span /> SEUS DADOS E ACESSO</span>
          <h1>Meu <em>perfil</em></h1>
          <p>Atualize seus dados pessoais e mantenha sua senha protegida.</p>
        </div>
        <form className="profile-form" onSubmit={(event) => void saveProfile(event)}>
          <fieldset className="profile-fieldset" disabled={!editing || loading}>
            <section className="form-section">
              <SectionHeading number="01" icon={<UserRound size={20} />} title="Dados pessoais" description="Seus dados ajudam a equipe paroquial a manter contato." />
              <div className="form-grid">
                <Field label="Nome completo" required className="span-2">
                  <input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={150} />
                </Field>
                {profile.cpf && (
                  <Field label="CPF" hint="Somente consulta">
                    <input value={maskCpf(profile.cpf)} readOnly disabled />
                  </Field>
                )}
                {profile.birth_date && (
                  <Field label="Data de nascimento" hint="Somente consulta">
                    <input value={profile.birth_date.split('-').reverse().join('/')} readOnly disabled />
                  </Field>
                )}
                <Field label="Telefone celular" required hint="Com DDD">
                  <input type="tel" inputMode="tel" autoComplete="tel-national" value={maskPhone(phone)} onChange={(event) => setPhone(maskPhone(event.target.value))} placeholder="(11) 99999-9999" maxLength={16} required />
                </Field>
                <Field label="E-mail" required hint="A alteração será confirmada por e-mail">
                  <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
                </Field>
              </div>
            </section>
            {profile.address && (
              <section className="form-section">
                <SectionHeading number="02" icon={<MapPin size={20} />} title="Endereço" description="Mantenha seu endereço completo atualizado." />
                <div className="form-grid">
                  <Field label="CEP" required>
                    <input inputMode="numeric" autoComplete="postal-code" value={address.postalCode} onChange={(event) => updateAddress('postalCode', maskCep(event.target.value))} placeholder="00000-000" maxLength={9} required />
                  </Field>
                  <Field label="Rua" required className="span-2">
                    <input autoComplete="address-line1" value={address.street} onChange={(event) => updateAddress('street', event.target.value)} required maxLength={150} />
                  </Field>
                  <Field label="Número" required>
                    <input value={address.streetNumber} onChange={(event) => updateAddress('streetNumber', event.target.value)} required maxLength={20} />
                  </Field>
                  <Field label="Complemento">
                    <input autoComplete="address-line2" value={address.complement} onChange={(event) => updateAddress('complement', event.target.value)} maxLength={100} />
                  </Field>
                  <Field label="Bairro" required>
                    <input value={address.neighborhood} onChange={(event) => updateAddress('neighborhood', event.target.value)} required maxLength={100} />
                  </Field>
                  <Field label="Cidade" required>
                    <input autoComplete="address-level2" value={address.city} onChange={(event) => updateAddress('city', event.target.value)} required maxLength={100} />
                  </Field>
                  <Field label="UF" required>
                    <input autoComplete="address-level1" value={address.state} onChange={(event) => updateAddress('state', event.target.value.toUpperCase())} required maxLength={2} />
                  </Field>
                </div>
              </section>
            )}
            {editing && (
              <section className="form-section">
                <SectionHeading number={profile.address ? '03' : '02'} icon={<LockKeyhole size={20} />} title="Alterar senha" description="Deixe os campos em branco se não quiser alterar sua senha." />
                <div className="form-grid">
                  <Field label="Nova senha" hint="Mínimo de 8 caracteres">
                    <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} />
                  </Field>
                  <Field label="Confirmar nova senha">
                    <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} />
                  </Field>
                </div>
              </section>
            )}
          </fieldset>
          <ErrorBanner feedback={feedback} />
          <div className="profile-actions">
            {editing ? (
              <>
                <button key="save" type="submit" className="button button-primary" disabled={loading}>
                  {loading ? <><LoaderCircle className="spin" size={17} /> Salvando...</> : <>Salvar alterações <Check size={16} /></>}
                </button>
                <button key="cancel" type="button" className="button button-outline" onClick={cancelEditing} disabled={loading}>Cancelar</button>
              </>
            ) : (
              <button key="edit" type="button" className="button button-primary" onClick={(event) => { event.preventDefault(); setFeedback(null); setEditing(true) }}>
                Editar perfil <Pencil size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
      <footer className="form-footer">PARÓQUIA SÃO JOSÉ <span>·</span> CATEQUESE DE ADULTOS</footer>
    </main>
  )
}

const sexLabels: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  outro: 'Outro',
  prefiro_nao_informar: 'Prefiro não informar',
}
const maritalStatusLabels: Record<string, string> = {
  solteiro: 'Solteiro(a)',
  casado_igreja: 'Casado(a) na Igreja',
  casado_civil: 'Casado(a) no civil',
  divorciado: 'Divorciado(a)',
  viuvo: 'Viúvo(a)',
  outro: 'Outro',
}
const referralSourceLabels: Record<string, string> = {
  amigos_familiares: 'Indicação de amigos/familiares',
  missas: 'Durante as missas',
  catequese_infantil: 'Através da catequese infantil',
  outro: 'Outro',
}
const registrationReasonLabels: Record<string, string> = {
  preparacao_casamento: 'Preparação para o casamento',
  receber_sacramentos: 'Gostaria de receber os sacramentos que ainda não tenho',
  ouvinte: 'Tenho todos os sacramentos, mas gostaria de ser ouvinte',
  acompanhar_filho: 'Acompanhar meu(minha) filho(a) na catequese',
  outro: 'Outro',
}
const sacramentLabels: Record<string, string> = {
  nenhum: 'Nenhum',
  batismo: 'Batismo',
  primeira_eucaristia: '1ª Eucaristia',
  crisma: 'Crisma',
}

function RegistrationSummary({
  registration,
  classLabel,
}: {
  registration: RegistrationRow
  classLabel: string | undefined
}) {
  const age = registration.birth_date
    ? Number(calculateAge(registration.birth_date.slice(0, 10).split('-').reverse().join('/')))
    : null
  const underage = age !== null && !Number.isNaN(age) && age < 18
  return (
    <div className="application-person">
      <span className="application-avatar">{registration.full_name.slice(0, 1).toUpperCase()}</span>
      <div className="application-info">
        <strong className="application-name">
          {registration.full_name || 'Nome não informado'}
          {underage && <span className="underage-badge" title="Inscrição de menor de 18 anos">Menor de 18 anos ({age} anos)</span>}
        </strong>
        <div className="application-contact-details">
          <div><small>Telefone</small><strong>{registration.phone ? maskPhone(registration.phone) : 'Não informado'}</strong></div>
          <div><small>E-mail</small><strong>{registration.email || 'Não informado'}</strong></div>
          <div><small>Turma</small><strong>{classLabel ?? 'Sem turma'}</strong></div>
        </div>
      </div>
    </div>
  )
}

function RegistrationDetailsModal({
  registration,
  classLabel,
  preferences,
  onClose,
}: {
  registration: RegistrationRow
  classLabel: string | undefined
  preferences: RegistrationPreference[]
  onClose: () => void
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const date = (value: string | null) => value ? value.split('-').reverse().join('/') : null
  const fields: { section: string; items: [string, string | null | undefined][] }[] = [
    {
      section: 'Dados pessoais',
      items: [
        ['Nome completo', registration.full_name],
        ['CPF', maskCpf(registration.cpf)],
        ['Data de nascimento', date(registration.birth_date)],
        ['Sexo', registration.sex ? sexLabels[registration.sex] ?? registration.sex : null],
        ['Estado civil', maritalStatusLabels[registration.marital_status] ?? registration.marital_status],
        ['Telefone', registration.phone ? maskPhone(registration.phone) : null],
        ['E-mail', registration.email],
      ],
    },
    {
      section: 'Endereço',
      items: [
        ['CEP', maskCep(registration.postal_code)],
        ['Rua', registration.street],
        ['Número', registration.street_number],
        ['Complemento', registration.complement],
        ['Bairro', registration.neighborhood],
        ['Cidade', registration.city],
        ['UF', registration.state],
      ],
    },
    {
      section: 'Inscrição',
      items: [
        ['Como conheceu a catequese', referralSourceLabels[registration.referral_source] ?? registration.referral_source],
        ['Outra forma de conhecimento', registration.referral_other],
        ['Motivo da inscrição', registrationReasonLabels[registration.registration_reason] ?? registration.registration_reason],
        ['Outro motivo', registration.reason_other],
        ['Turma', classLabel ?? 'Sem turma'],
        ['Preferências de horário', preferences.length
          ? preferences.map((preference) =>
            `${weekdays[preference.weekday]} ${preference.starts_at.slice(0, 5)}–${preference.ends_at.slice(0, 5)} · ${preference.classes?.name ?? 'Turma'}`,
          ).join('; ')
          : 'Sem preferência de horário'],
        ['Data da inscrição', formatDateTime(registration.created_at)],
        ['Ciência do aviso de privacidade', formatDateTime(registration.privacy_acknowledged_at)],
        ['Usuário do sistema', registration.user_id ? 'Criado' : 'Não criado'],
      ],
    },
    {
      section: 'Sacramentos',
      items: [
        ['Sacramentos recebidos', registration.sacraments.map((item) => sacramentLabels[item] ?? item).join(', ')],
        ['Data do batismo', date(registration.baptism_date)],
        ['Paróquia do batismo', registration.baptism_parish],
        ['Cidade do batismo', registration.baptism_city],
        ['UF do batismo', registration.baptism_state],
        ['Paróquia da 1ª Eucaristia', registration.eucharist_parish],
        ['Cidade da 1ª Eucaristia', registration.eucharist_city],
        ['Comprovante de matrimônio', registration.marriage_certificate_path ? 'Anexado' : 'Sem anexo'],
      ],
    },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="registration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registration-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="registration-modal-header">
          <div>
            <span className="eyebrow">CADASTRO COMPLETO · SOMENTE LEITURA</span>
            <h2 id="registration-modal-title">{registration.full_name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        <div className="registration-modal-body">
          {fields.map((group) => (
            <section key={group.section}>
              <h3>{group.section}</h3>
              <dl>
                {group.items.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value || 'Não informado'}</dd></div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <footer className="registration-modal-footer">
          <button type="button" className="button button-primary" onClick={onClose}>Fechar</button>
        </footer>
      </div>
    </div>
  )
}

function Dashboard({
  profile,
  onSignOut,
  mobileMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onNavigateToProfile,
}: {
  profile: AuthenticatedProfile
  onSignOut: () => Promise<boolean>
  mobileMenuOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
  onNavigateToProfile: () => void
}) {
  const [applications, setApplications] = useState<RegistrationRow[]>([])
  const [preferences, setPreferences] = useState<Record<string, RegistrationPreference[]>>({})
  const [catechists, setCatechists] = useState<CatechistRecord[]>([])
  const [adminSchedules, setAdminSchedules] = useState<AdminSchedule[]>([])
  const [classes, setClasses] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [activeSection, setActiveSection] = useState<'applications' | 'catequizandos' | 'schedules' | 'catechists' | 'profiles' | 'meetings' | 'attendance' | 'agenda'>('applications')
  const [viewingRegistration, setViewingRegistration] = useState<RegistrationRow | null>(null)
  const [catechistName, setCatechistName] = useState('')
  const [catechistPhone, setCatechistPhone] = useState('')
  const [catechistCpf, setCatechistCpf] = useState('')
  const [catechistClassId, setCatechistClassId] = useState('')
  const [catechistEmail, setCatechistEmail] = useState('')
  const [catechistInitialPassword, setCatechistInitialPassword] = useState('')
  const [catechistConfirmPassword, setCatechistConfirmPassword] = useState('')
  const [editingCatechistId, setEditingCatechistId] = useState<string | null>(null)
  const [deletingCatechistId, setDeletingCatechistId] = useState<string | null>(null)
  const [managingCatequizandoId, setManagingCatequizandoId] = useState<string | null>(null)
  const [inviteName, setInviteName] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteCpf, setInviteCpf] = useState('')
  const [inviteClassId, setInviteClassId] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('catequizando')
  const [systemProfiles, setSystemProfiles] = useState<UserDirectoryProfile[]>([])
  const [profileInviteLoading, setProfileInviteLoading] = useState(false)
  const [catechistLoading, setCatechistLoading] = useState(false)
  const [newClassName, setNewClassName] = useState('')
  const [editingClassId, setEditingClassId] = useState<string | null>(null)
  const [newSchedule, setNewSchedule] = useState({ classId: '', weekday: '0', startsAt: '19:00', endsAt: '21:00' })
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [accountLoadingId, setAccountLoadingId] = useState<string | null>(null)
  const handleSignOut = async () => {
    if (!await onSignOut()) {
      setFeedback({ kind: 'error', text: 'Não foi possível encerrar a sessão. Tente novamente.' })
    }
  }

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    const loadDashboard = async () => {
      const [
        { data, error },
        { data: classRows, error: classError },
      ] = await Promise.all([
        client.from('t_catequizando').select('*').order('created_at', { ascending: false }),
        client.from('classes').select('id, name, active').order('name'),
      ])
      if (!active) return
      if (error) {
        setFeedback({ kind: 'error', text: 'Não foi possível carregar as inscrições autorizadas.' })
        setLoading(false)
        return
      }
      if (classError) {
        setFeedback({ kind: 'error', text: 'Não foi possível carregar as turmas.' })
      } else if (classRows) {
        setClasses(classRows)
        setCatechistClassId((current) =>
          current || classRows.find((classItem) => classItem.active)?.id || '',
        )
        setInviteClassId((current) =>
          current || classRows.find((classItem) => classItem.active)?.id || '',
        )
        setNewSchedule((current) => ({
          ...current,
          classId: classRows.some((classItem) => classItem.id === current.classId && classItem.active)
            ? current.classId
            : classRows.find((classItem) => classItem.active)?.id ?? '',
        }))
      }

      const rows = (data ?? []) as RegistrationRow[]
      setApplications(rows)
      if (profile.role === 'coordenador') {
        const [
          { data: catechistRows, error: catechistError },
          { data: profileRows, error: profilesError },
          { data: catequizandoRows, error: catequizandoError },
          { data: scheduleRows, error: scheduleError },
        ] = await Promise.all([
          client.from('t_catequista').select('id, full_name, phone, email, cpf, class_id').order('full_name'),
          client.from('profiles').select('id, role').order('role'),
          client.from('t_catequizando').select('user_id, full_name, active').order('created_at', { ascending: false }),
          client.from('class_schedules').select('id, class_id, weekday, starts_at, ends_at, active, available, classes(name)').order('weekday'),
        ])
        if (!active) return
        if (catechistError || profilesError || catequizandoError || scheduleError) {
          setFeedback({ kind: 'error', text: 'Não foi possível carregar todos os dados de administração.' })
        }
        if (catechistRows) setCatechists(catechistRows)
        if (profileRows) {
          const catechistNames = new Map((catechistRows ?? []).map((item) => [item.id, item.full_name]))
          const catequizandoNames = new Map<string, string>()
          const inactiveUsers = new Set<string>()
          for (const item of catequizandoRows ?? []) {
            if (item.user_id && !catequizandoNames.has(item.user_id)) {
              catequizandoNames.set(item.user_id, item.full_name)
            }
            if (item.user_id && !item.active) inactiveUsers.add(item.user_id)
          }
          setSystemProfiles(profileRows.map((item) => ({
            ...item,
            active: !inactiveUsers.has(item.id),
            full_name: item.role === 'catequista'
              ? catechistNames.get(item.id) ?? roles[item.role]
              : item.role === 'catequizando'
                ? catequizandoNames.get(item.id) ?? roles[item.role]
                : catechistNames.get(item.id) ?? (item.id === profile.id ? profile.full_name : roles[item.role]),
          })))
        }
        if (scheduleRows) setAdminSchedules(scheduleRows as AdminSchedule[])
      }
      if (rows.length > 0) {
        const { data: preferenceRows, error: preferenceError } = await client
          .from('registration_preferences')
          .select('application_id, class_schedules(weekday, starts_at, ends_at, classes(name))')
          .in('application_id', rows.map((row) => row.id))
        if (!active) return
        if (preferenceError) {
          setFeedback({ kind: 'error', text: 'Não foi possível carregar as preferências de horário.' })
        } else {
          const grouped: Record<string, RegistrationPreference[]> = {}
          for (const preference of preferenceRows ?? []) {
            const schedule = preference.class_schedules
            if (!schedule) continue
            grouped[preference.application_id] ??= []
            grouped[preference.application_id].push(schedule as RegistrationPreference)
          }
          setPreferences(grouped)
        }
      }
      setLoading(false)
    }
    void loadDashboard()
    return () => {
      active = false
    }
  }, [profile.id, profile.role])

  const filteredApplications = applications.filter((application) =>
    application.full_name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')),
  )
  const pendingApplications = filteredApplications.filter((application) => !application.user_id)
  const confirmedCatequizandos = filteredApplications.filter((application) => application.user_id)

  const openCertificate = async (application: RegistrationRow) => {
    if (!supabase || !application.marriage_certificate_path) return
    setOpeningId(application.id)
    setFeedback(null)
    const { data, error } = await supabase.storage
      .from('marriage-certificates')
      .createSignedUrl(application.marriage_certificate_path, 60)
    setOpeningId(null)
    if (error || !data) {
      setFeedback({ kind: 'error', text: 'Você não tem autorização para abrir este documento ou ele não está disponível.' })
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const assignClass = async (applicationId: string, classId: string) => {
    if (!supabase) return
    setFeedback(null)
    const { error } = await supabase
      .from('t_catequizando')
      .update({ assigned_class_id: classId || null })
      .eq('id', applicationId)
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível atualizar a turma do catequizando.' })
      return
    }
    setApplications((current) => current.map((application) =>
      application.id === applicationId
        ? { ...application, assigned_class_id: classId || null }
        : application,
    ))
  }

  const createCatequizandoAccount = async (application: RegistrationRow) => {
    if (!supabase || profile.role !== 'coordenador') return
    if (!application.assigned_class_id) {
      setFeedback({ kind: 'error', text: 'Associe uma turma ao catequizando antes de confirmar a inscrição.' })
      return
    }

    setAccountLoadingId(application.id)
    setFeedback(null)
    const { data, error } = await supabase.functions.invoke<{ user_id: string }>(
      'create-catequizando-account',
      {
        body: {
          registration_id: application.id,
          provisional_password: defaultProvisionalPassword,
        },
      },
    )
    setAccountLoadingId(null)
    if (error || !data?.user_id) {
      let message = 'Não foi possível criar o usuário. Confira se o e-mail já possui uma conta e tente novamente.'
      const context = (error as { context?: Response } | null)?.context
      if (context && typeof context.json === 'function') {
        const body = await context.json().catch(() => null) as { error?: string } | null
        if (body?.error) message = body.error
      }
      setFeedback({
        kind: 'error',
        text: message,
      })
      return
    }

    setApplications((current) => current.map((item) =>
      item.id === application.id ? { ...item, user_id: data.user_id } : item,
    ))
    setFeedback({
      kind: 'success',
      text: `Inscrição confirmada. Usuário criado para ${application.email} com a senha temporária ${defaultProvisionalPassword}; ela deverá ser trocada no primeiro acesso.`,
    })
  }

  const deleteCatequizando = async (registration: RegistrationRow) => {
    if (!supabase || profile.role !== 'coordenador') return
    if (!window.confirm(`Excluir o cadastro de ${registration.full_name}? Esta ação não pode ser desfeita.`)) return
    setFeedback(null)
    const { error } = await supabase
      .from('t_catequizando')
      .delete()
      .eq('id', registration.id)
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível excluir o cadastro do catequizando.' })
      return
    }
    setApplications((current) => current.filter((item) => item.id !== registration.id))
    setPreferences((current) => {
      const next = { ...current }
      delete next[registration.id]
      return next
    })
    setFeedback({ kind: 'success', text: 'Cadastro do catequizando excluído.' })
  }

  const manageCatequizando = async (registration: RegistrationRow, action: 'deactivate' | 'activate' | 'delete') => {
    if (!supabase || profile.role !== 'coordenador') return
    const confirmations = {
      deactivate: `Desativar ${registration.full_name}? O acesso ao sistema será bloqueado.`,
      activate: `Reativar ${registration.full_name}? O acesso ao sistema será liberado.`,
      delete: `Excluir ${registration.full_name}? O cadastro e a conta de acesso serão removidos e isso não pode ser desfeito.`,
    }
    if (!window.confirm(confirmations[action])) return
    setManagingCatequizandoId(registration.id)
    setFeedback(null)
    const { error } = await supabase.functions.invoke('manage-catequizando', {
      body: { id: registration.id, action },
    })
    setManagingCatequizandoId(null)
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível concluir a ação para o catequizando.' })
      return
    }
    if (action === 'delete') {
      setApplications((current) => current.filter((item) => item.id !== registration.id))
      if (registration.user_id) setSystemProfiles((current) => current.filter((item) => item.id !== registration.user_id))
      setFeedback({ kind: 'success', text: 'Catequizando e conta de acesso excluídos.' })
      return
    }
    const active = action === 'activate'
    setApplications((current) => current.map((item) => item.id === registration.id ? { ...item, active } : item))
    setSystemProfiles((current) => current.map((item) => item.id === registration.user_id ? { ...item, active } : item))
    setFeedback({ kind: 'success', text: active ? 'Catequizando reativado.' : 'Catequizando desativado.' })
  }

  const createClass = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || profile.role !== 'coordenador') return
    const name = newClassName.trim()
    if (!name) return
    const result = editingClassId
      ? await supabase
        .from('classes')
        .update({ name })
        .eq('id', editingClassId)
        .select('id, name, active')
        .single()
      : await supabase
        .from('classes')
        .insert({ name })
        .select('id, name, active')
        .single()
    const { data, error } = result
    if (error || !data) {
      setFeedback({ kind: 'error', text: `Não foi possível ${editingClassId ? 'atualizar' : 'cadastrar'} a turma.` })
      return
    }
    setClasses((current) => (editingClassId
      ? current.map((item) => item.id === data.id ? data : item)
      : [...current, data]
    ).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
    setAdminSchedules((current) => current.map((schedule) =>
      schedule.class_id === data.id ? { ...schedule, classes: { name: data.name } } : schedule,
    ))
    if (!editingClassId) {
      setNewSchedule((current) => ({ ...current, classId: current.classId || data.id }))
    }
    setNewClassName('')
    setEditingClassId(null)
    setFeedback({ kind: 'success', text: `Turma ${editingClassId ? 'atualizada' : 'cadastrada'}.` })
  }

  const createSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || profile.role !== 'coordenador' || !newSchedule.classId) return
    const wasEditing = Boolean(editingScheduleId)
    const scheduleValues = {
        class_id: newSchedule.classId,
        weekday: Number(newSchedule.weekday),
        starts_at: newSchedule.startsAt,
        ends_at: newSchedule.endsAt,
      }
    const result = editingScheduleId
      ? await supabase
        .from('class_schedules')
        .update(scheduleValues)
        .eq('id', editingScheduleId)
        .select('id, class_id, weekday, starts_at, ends_at, active, available, classes(name)')
        .single()
      : await supabase
        .from('class_schedules')
        .insert(scheduleValues)
        .select('id, class_id, weekday, starts_at, ends_at, active, available, classes(name)')
        .single()
    const { data, error } = result
    if (error || !data) {
      setFeedback({ kind: 'error', text: `Não foi possível ${editingScheduleId ? 'atualizar' : 'cadastrar'} o horário. ${error?.code === '23505' ? 'Já existe um horário igual para esta turma.' : error?.code === '23514' ? 'Confira se o horário final é posterior ao inicial.' : error?.message ?? ''}` })
      return
    }
    setAdminSchedules((current) => (editingScheduleId
      ? current.map((schedule) => schedule.id === data.id ? data as AdminSchedule : schedule)
      : [...current, data as AdminSchedule]
    ).sort((a, b) => a.weekday - b.weekday || a.starts_at.localeCompare(b.starts_at)))
    if (wasEditing) {
      setEditingScheduleId(null)
      setNewSchedule({
        classId: classes.find((item) => item.active)?.id ?? '',
        weekday: '0',
        startsAt: '19:00',
        endsAt: '21:00',
      })
    }
    setFeedback({ kind: 'success', text: `Horário ${wasEditing ? 'atualizado' : 'cadastrado'}.` })
  }

  const deleteSchedule = async (schedule: AdminSchedule) => {
    if (!supabase || profile.role !== 'coordenador') return
    if (!window.confirm(`Excluir o horário de ${schedule.classes?.name ?? 'Turma'}? As preferências de inscrição vinculadas a ele também serão removidas.`)) return
    const { error } = await supabase.rpc('delete_class_schedule', { p_schedule_id: schedule.id })
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível excluir o horário.' })
      return
    }
    setAdminSchedules((current) => current.filter((item) => item.id !== schedule.id))
    if (editingScheduleId === schedule.id) {
      setEditingScheduleId(null)
      setNewSchedule({
        classId: classes.find((item) => item.active)?.id ?? '',
        weekday: '0',
        startsAt: '19:00',
        endsAt: '21:00',
      })
    }
    setFeedback({ kind: 'success', text: 'Horário excluído.' })
  }

  const deleteClass = async (classItem: { id: string; name: string; active: boolean }) => {
    if (!supabase || profile.role !== 'coordenador') return
    if (!window.confirm(`Excluir a turma ${classItem.name}? Os horários e as preferências de inscrição vinculados também serão removidos.`)) return
    const { error } = await supabase.rpc('delete_class_record', { p_class_id: classItem.id })
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível excluir a turma.' })
      return
    }
    const remainingClasses = classes.filter((item) => item.id !== classItem.id)
    const deletedScheduleIsBeingEdited = adminSchedules.some((schedule) =>
      schedule.class_id === classItem.id && schedule.id === editingScheduleId,
    )
    setClasses(remainingClasses)
    setAdminSchedules((current) => current.filter((schedule) => schedule.class_id !== classItem.id))
    if (deletedScheduleIsBeingEdited) {
      setEditingScheduleId(null)
      setNewSchedule({
        classId: remainingClasses.find((item) => item.active)?.id ?? '',
        weekday: '0',
        startsAt: '19:00',
        endsAt: '21:00',
      })
    }
    if (newSchedule.classId === classItem.id) {
      setNewSchedule((current) => ({
        ...current,
        classId: remainingClasses.find((item) => item.active)?.id ?? '',
      }))
    }
    if (editingClassId === classItem.id) {
      setEditingClassId(null)
      setNewClassName('')
    }
    setFeedback({ kind: 'success', text: 'Turma excluída.' })
  }

  const toggleScheduleAvailability = async (schedule: AdminSchedule, field: 'active' | 'available') => {
    if (!supabase || profile.role !== 'coordenador') return
    const result = field === 'active'
      ? await supabase.from('class_schedules').update({ active: !schedule.active }).eq('id', schedule.id)
      : await supabase.from('class_schedules').update({ available: !schedule.available }).eq('id', schedule.id)
    const { error } = result
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível atualizar a disponibilidade do horário.' })
      return
    }
    setAdminSchedules((current) => current.map((item) =>
      item.id === schedule.id ? { ...item, [field]: !schedule[field] } : item,
    ))
    setFeedback({ kind: 'success', text: 'Disponibilidade atualizada.' })
  }

  const toggleClassActive = async (classItem: { id: string; name: string; active: boolean }) => {
    if (!supabase || profile.role !== 'coordenador') return
    const { error } = await supabase
      .from('classes')
      .update({ active: !classItem.active })
      .eq('id', classItem.id)
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível atualizar a turma.' })
      return
    }
    setClasses((current) => current.map((item) =>
      item.id === classItem.id ? { ...item, active: !classItem.active } : item,
    ))
    if (classItem.active && newSchedule.classId === classItem.id) {
      setNewSchedule((current) => ({
        ...current,
        classId: classes.find((item) => item.active && item.id !== classItem.id)?.id ?? '',
      }))
    }
    setFeedback({ kind: 'success', text: `Turma ${classItem.active ? 'desativada' : 'ativada'}.` })
  }

  const resetCatechistForm = () => {
    setEditingCatechistId(null)
    setCatechistName('')
    setCatechistPhone('')
    setCatechistCpf('')
    setCatechistClassId('')
    setCatechistEmail('')
    setCatechistInitialPassword('')
    setCatechistConfirmPassword('')
  }

  const registerCatechist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || profile.role !== 'coordenador') return
    if (editingCatechistId) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(catechistEmail.trim())) {
        setFeedback({ kind: 'error', text: 'Informe um e-mail válido para o catequista.' })
        return
      }
      if (!isValidCpf(catechistCpf)) {
        setFeedback({ kind: 'error', text: 'Informe um CPF válido para o catequista.' })
        return
      }
      setCatechistLoading(true)
      setFeedback(null)
      const { error } = await supabase.functions.invoke('update-catechist', {
        body: {
          id: editingCatechistId,
          full_name: catechistName.trim(),
          email: catechistEmail.trim(),
          phone: digits(catechistPhone),
          cpf: digits(catechistCpf),
          class_id: catechistClassId || null,
        },
      })
      setCatechistLoading(false)
      if (error) {
        setFeedback({ kind: 'error', text: await functionErrorMessage(error, 'Não foi possível atualizar o cadastro do catequista.') })
        return
      }
      setCatechists((current) => current.map((item) => item.id === editingCatechistId
        ? {
          ...item,
          full_name: catechistName.trim(),
          phone: digits(catechistPhone),
          email: catechistEmail.trim().toLowerCase(),
          cpf: digits(catechistCpf),
          class_id: catechistClassId || null,
        }
        : item,
      ).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR')))
      setSystemProfiles((current) => current.map((item) => item.id === editingCatechistId
        ? { ...item, full_name: catechistName.trim() }
        : item,
      ))
      resetCatechistForm()
      setFeedback({ kind: 'success', text: 'Cadastro do catequista atualizado.' })
      return
    }
    if (!isValidCpf(catechistCpf)) {
      setFeedback({ kind: 'error', text: 'Informe um CPF válido para o catequista.' })
      return
    }
    if (catechistInitialPassword.length < 8) {
      setFeedback({ kind: 'error', text: 'A senha inicial deve ter pelo menos 8 caracteres.' })
      return
    }
    if (catechistInitialPassword !== catechistConfirmPassword) {
      setFeedback({ kind: 'error', text: 'A confirmação da senha inicial não corresponde.' })
      return
    }
    setCatechistLoading(true)
    setFeedback(null)
    const { data, error } = await supabase.functions.invoke<{ id: string }>('invite-catechist', {
      body: {
        full_name: catechistName.trim(),
        email: catechistEmail.trim(),
        phone: digits(catechistPhone),
        cpf: digits(catechistCpf),
        class_id: catechistClassId || null,
        role: 'catequista',
        send_invite: false,
        initial_password: catechistInitialPassword,
      },
    })
    setCatechistLoading(false)
    if (error || !data?.id) {
      setFeedback({ kind: 'error', text: await functionErrorMessage(error, 'Não foi possível cadastrar o catequista. Verifique a integração e tente novamente.') })
      return
    }
    const newCatechist: CatechistRecord = {
      id: data.id,
      full_name: catechistName.trim(),
      phone: digits(catechistPhone),
      email: catechistEmail.trim().toLowerCase(),
      cpf: digits(catechistCpf),
      class_id: catechistClassId || null,
    }
    setCatechists((current) =>
      [...current, newCatechist].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR')),
    )
    setSystemProfiles((current) =>
      [...current, { id: data.id, role: 'catequista' as const, full_name: newCatechist.full_name }]
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR')),
    )
    resetCatechistForm()
    setFeedback({ kind: 'success', text: 'Catequista cadastrado. No primeiro acesso, será necessário trocar a senha inicial.' })
  }

  const deleteCatechist = async (catechist: CatechistRecord) => {
    if (!supabase || profile.role !== 'coordenador') return
    if (!window.confirm(`Excluir o catequista ${catechist.full_name}? A conta de acesso também será removida.`)) return
    setDeletingCatechistId(catechist.id)
    setFeedback(null)
    const { error } = await supabase.functions.invoke('delete-catechist', {
      body: { id: catechist.id },
    })
    setDeletingCatechistId(null)
    if (error) {
      setFeedback({ kind: 'error', text: 'Não foi possível excluir o catequista e sua conta de acesso.' })
      return
    }
    setCatechists((current) => current.filter((item) => item.id !== catechist.id))
    setSystemProfiles((current) => current.filter((item) => item.id !== catechist.id))
    if (editingCatechistId === catechist.id) resetCatechistForm()
    setFeedback({ kind: 'success', text: 'Catequista e conta de acesso excluídos.' })
  }

  const inviteProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || profile.role !== 'coordenador') return
    if (inviteRole === 'catequista' && !isValidCpf(inviteCpf)) {
      setFeedback({ kind: 'error', text: 'Informe um CPF válido para o catequista.' })
      return
    }
    setProfileInviteLoading(true)
    setFeedback(null)
    const { data, error } = await supabase.functions.invoke<{ id: string; role: UserRole }>('invite-catechist', {
      body: {
        full_name: inviteName.trim(),
        email: inviteEmail.trim(),
        phone: digits(invitePhone),
        cpf: inviteRole === 'catequista' ? digits(inviteCpf) : undefined,
        class_id: inviteRole === 'catequista' ? inviteClassId || null : null,
        role: inviteRole,
      },
    })
    setProfileInviteLoading(false)
    if (error || !data?.id || data.role !== inviteRole) {
      setFeedback({ kind: 'error', text: await functionErrorMessage(error, 'Não foi possível criar o perfil. Confira os dados e tente novamente.') })
      return
    }
    const newProfile: UserDirectoryProfile = {
      id: data.id,
      role: data.role,
      full_name: inviteName.trim(),
    }
    setSystemProfiles((current) =>
      [...current, newProfile].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR')),
    )
    if (data.role === 'catequista') {
      setCatechists((current) =>
        [...current, {
          id: newProfile.id,
          full_name: newProfile.full_name,
          phone: digits(invitePhone),
          email: inviteEmail.trim().toLowerCase(),
          cpf: digits(inviteCpf),
          class_id: inviteClassId || null,
        }].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR')),
      )
    }
    setInviteName('')
    setInvitePhone('')
    setInviteEmail('')
    setInviteCpf('')
    setFeedback({
      kind: 'success',
      text: `Convite enviado. O usuário receberá acesso como ${roles[data.role].toLocaleLowerCase('pt-BR')} após aceitar o convite.`,
    })
  }

  const changeUserRole = async (target: UserDirectoryProfile, newRole: UserRole) => {
    if (!supabase || profile.role !== 'coordenador' || target.role === newRole) return
    setFeedback(null)
    const { error } = await supabase.rpc('change_user_role', { p_user_id: target.id, p_role: newRole })
    if (error) {
      setFeedback({ kind: 'error', text: error.message || 'Não foi possível alterar o perfil.' })
      return
    }
    setSystemProfiles((current) => current.map((item) => item.id === target.id ? { ...item, role: newRole } : item))
    const { data: catechistRows } = await supabase
      .from('t_catequista')
      .select('id, full_name, phone, email, cpf, class_id')
      .order('full_name')
    if (catechistRows) {
      setCatechists(catechistRows)
      const catechistName = catechistRows.find((item) => item.id === target.id)?.full_name
      if (catechistName) {
        setSystemProfiles((current) => current.map((item) => item.id === target.id ? { ...item, full_name: catechistName } : item))
      }
    }
    setFeedback({ kind: 'success', text: `Perfil alterado para ${roles[newRole].toLocaleLowerCase('pt-BR')}.` })
  }

  const setCoordinatorCatechist = async (target: UserDirectoryProfile, enabled: boolean, classId: string | null) => {
    if (!supabase || profile.role !== 'coordenador' || target.role !== 'coordenador') return
    setFeedback(null)
    const { error } = await supabase.rpc('set_coordinator_catechist', {
      p_user_id: target.id,
      p_enabled: enabled,
      p_class_id: enabled ? classId : null,
    })
    if (error) {
      setFeedback({ kind: 'error', text: error.message || 'Não foi possível atualizar o vínculo de catequista.' })
      return
    }
    const { data: catechistRows } = await supabase
      .from('t_catequista')
      .select('id, full_name, phone, email, cpf, class_id')
      .order('full_name')
    if (catechistRows) setCatechists(catechistRows)
    setFeedback({
      kind: 'success',
      text: enabled ? 'Coordenador vinculado como catequista.' : 'Vínculo de catequista removido.',
    })
  }

  const roleHeading = profile.role === 'coordenador'    ? 'Visão geral da catequese'
    : profile.role === 'catequista'
      ? 'Suas inscrições acompanhadas'
      : 'Seu caminho na catequese'

  return (
    <main className="dashboard-page">
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-symbol"><Church size={20} /></span>
          <span>São José<small>CATEQUESE DE ADULTOS</small></span>
        </div>
        <div className="sidebar-section-label">ESPAÇO DE TRABALHO</div>
        <button className={`sidebar-nav-item ${activeSection === 'applications' ? 'active' : ''}`} onClick={() => { setActiveSection('applications'); onCloseMenu() }}><UsersRound size={18} /> {profile.role === 'coordenador' ? 'Inscrições' : roles[profile.role]}</button>
        {profile.role !== 'catequizando' && (
          <button className={`sidebar-nav-item ${activeSection === 'catequizandos' ? 'active' : ''}`} onClick={() => { setActiveSection('catequizandos'); onCloseMenu() }}><Search size={18} /> Consultar catequizando</button>
        )}
        {profile.role === 'coordenador' && (
          <>
            <button className={`sidebar-nav-item ${activeSection === 'catechists' ? 'active' : ''}`} onClick={() => { setActiveSection('catechists'); onCloseMenu() }}><UserPlus size={18} /> Cadastrar catequista</button>
            <button className={`sidebar-nav-item ${activeSection === 'profiles' ? 'active' : ''}`} onClick={() => { setActiveSection('profiles'); onCloseMenu() }}><ShieldCheck size={18} /> Perfis de acesso</button>
            <button className={`sidebar-nav-item ${activeSection === 'schedules' ? 'active' : ''}`} onClick={() => { setActiveSection('schedules'); onCloseMenu() }}><Clock3 size={18} /> Turmas e horários</button>
            <button className={`sidebar-nav-item ${activeSection === 'meetings' ? 'active' : ''}`} onClick={() => { setActiveSection('meetings'); onCloseMenu() }}><CalendarDays size={18} /> Cadastro de encontros</button>
          </>
        )}
        <button className={`sidebar-nav-item ${activeSection === 'agenda' ? 'active' : ''}`} onClick={() => { setActiveSection('agenda'); onCloseMenu() }}><CalendarDays size={18} /> Agenda de encontros</button>
        {profile.role !== 'catequizando' && (
          <button className={`sidebar-nav-item ${activeSection === 'attendance' ? 'active' : ''}`} onClick={() => { setActiveSection('attendance'); onCloseMenu() }}><FileCheck2 size={18} /> Chamada</button>
        )}
        <div className="sidebar-spacer" />
        <div className="sidebar-profile">
          <span className="avatar">{profile.full_name.slice(0, 1).toUpperCase()}</span>
          <span><strong>{profile.full_name}</strong><small>{roles[profile.role]}</small></span>
          <button className="icon-button" onClick={onNavigateToProfile} title="Meu perfil" aria-label="Meu perfil"><UserRound size={17} /></button>
          <button className="icon-button" onClick={() => void handleSignOut()} title="Sair" aria-label="Sair"><LogOut size={17} /></button>
        </div>
      </aside>
      {mobileMenuOpen && <button className="sidebar-scrim" aria-label="Fechar menu" onClick={onToggleMenu} />}
      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <button className="mobile-menu-button" onClick={onToggleMenu} aria-label="Abrir menu"><Menu size={21} /></button>
          <span>Paróquia São José <ChevronDown size={15} /></span>
          <span className="dashboard-topbar-right"><ShieldCheck size={15} /> Ambiente seguro</span>
        </header>
        <div className="dashboard-content">
          <div className="dashboard-greeting">
            <span className="eyebrow">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()).toLocaleUpperCase('pt-BR')}</span>
            <h1>{roleHeading}</h1>
            <p>Olá, {profile.full_name.split(' ')[0]}. Que bom ter você por aqui.</p>
          </div>
          <ErrorBanner feedback={feedback} />
          <NotificationsBanner profile={profile} />
          {activeSection === 'agenda' && <MeetingAgenda profile={profile} onFeedback={setFeedback} />}
          {profile.role === 'coordenador' && activeSection === 'meetings' && <MeetingsManagement onFeedback={setFeedback} />}
          {profile.role !== 'catequizando' && activeSection === 'attendance' && <AttendancePanel registrations={applications} role={profile.role} onFeedback={setFeedback} />}
          {profile.role === 'coordenador' && activeSection === 'schedules' && (
            <section className="schedule-management">
              <div className="dashboard-section-title">
                <div><h2>Turmas e horários</h2><p>Somente horários ativos e disponíveis aparecem no formulário público.</p></div>
              </div>
              <div className="management-grid">
                <form className="management-card" onSubmit={(event) => void createClass(event)}>
                  <h3>{editingClassId ? 'Editar turma' : 'Cadastrar turma'}</h3>
                  <p>{editingClassId ? 'Altere o nome desta turma.' : 'Adicione uma turma para organizar os encontros.'}</p>
                  <div className="management-input-row">
                    <input aria-label="Nome da nova turma" placeholder="Ex.: Turma de quarta-feira" value={newClassName} onChange={(event) => setNewClassName(event.target.value)} maxLength={100} required />
                    <button className="button button-primary" type="submit">{editingClassId ? 'Salvar' : 'Adicionar'}</button>
                    {editingClassId && <button className="button button-outline" type="button" onClick={() => { setEditingClassId(null); setNewClassName('') }}>Cancelar</button>}
                  </div>
                  <div className="class-list">
                    {classes.map((classItem) => (
                      <div className="class-list-row" key={classItem.id}>
                        <span>{classItem.name}</span>
                        <div className="row-actions">
                          <button type="button" onClick={() => { setNewClassName(classItem.name); setEditingClassId(classItem.id) }} aria-label={`Editar turma ${classItem.name}`} title="Editar turma"><Pencil size={14} /></button>
                          <button type="button" onClick={() => void deleteClass(classItem)} aria-label={`Excluir turma ${classItem.name}`} title="Excluir turma"><Trash2 size={14} /></button>
                          <button type="button" onClick={() => void toggleClassActive(classItem)}>{classItem.active ? 'Ativa · desativar' : 'Inativa · ativar'}</button>
                        </div>
                      </div>
                    ))}
                    {classes.length === 0 && <span className="empty-class-list">Nenhuma turma cadastrada.</span>}
                  </div>
                </form>
                <form className="management-card" onSubmit={(event) => void createSchedule(event)}>
                  <h3>{editingScheduleId ? 'Editar horário' : 'Adicionar horário'}</h3>
                  <p>{editingScheduleId ? 'Altere a turma, o dia ou a faixa de horário.' : 'Cadastre dia e faixa de horário para uma turma ativa.'}</p>
                  <div className="management-fields">
                    <label>Turma
                      <select value={newSchedule.classId} onChange={(event) => setNewSchedule((current) => ({ ...current, classId: event.target.value }))} required disabled={classes.length === 0}>
                        {classes.length === 0 && <option value="">Cadastre uma turma primeiro</option>}
                        {classes.filter((classItem) => classItem.active || adminSchedules.find((schedule) => schedule.id === editingScheduleId)?.class_id === classItem.id).map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                      </select>
                    </label>
                    <label>Dia
                      <select value={newSchedule.weekday} onChange={(event) => setNewSchedule((current) => ({ ...current, weekday: event.target.value }))}>
                        {weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}
                      </select>
                    </label>
                    <label>Início<input type="time" value={newSchedule.startsAt} onChange={(event) => setNewSchedule((current) => ({ ...current, startsAt: event.target.value }))} required /></label>
                    <label>Fim<input type="time" value={newSchedule.endsAt} onChange={(event) => setNewSchedule((current) => ({ ...current, endsAt: event.target.value }))} required /></label>
                  </div>
                  <button className="button button-primary" type="submit" disabled={classes.filter((item) => item.active || adminSchedules.find((schedule) => schedule.id === editingScheduleId)?.class_id === item.id).length === 0}>
                    {editingScheduleId ? 'Salvar alterações' : 'Salvar horário'} <ArrowRight size={15} />
                  </button>
                  {editingScheduleId && <button className="button button-outline" type="button" onClick={() => { setEditingScheduleId(null); setNewSchedule({ classId: classes.find((item) => item.active)?.id ?? '', weekday: '0', startsAt: '19:00', endsAt: '21:00' }) }}>Cancelar edição</button>}
                </form>
              </div>
              <div className="applications-card schedule-list">
                <div className="schedule-list-heading"><strong>Agenda cadastrada</strong><span>Horários indisponíveis e turmas inativas não aparecem na inscrição.</span></div>
                {adminSchedules.length === 0 ? <div className="dashboard-empty">Nenhum horário cadastrado.</div> : adminSchedules.map((schedule) => (
                  <article className="schedule-row" key={schedule.id}>
                    <span className="schedule-day">{weekdays[schedule.weekday].slice(0, 3).toUpperCase()}</span>
                    <span className="schedule-info"><strong>{schedule.classes?.name ?? 'Turma'}</strong><small>{weekdays[schedule.weekday]} · {schedule.starts_at.slice(0, 5)} às {schedule.ends_at.slice(0, 5)}</small></span>
                    <button className={`availability-toggle ${schedule.active && schedule.available ? 'enabled' : ''}`} onClick={() => void toggleScheduleAvailability(schedule, 'available')} disabled={!schedule.active}>{schedule.available ? 'Disponível' : 'Indisponível'}</button>
                    <button className="schedule-status-button" onClick={() => void toggleScheduleAvailability(schedule, 'active')}>{schedule.active ? 'Desativar' : 'Ativar'}</button>
                    <div className="row-actions">
                      <button type="button" onClick={() => {
                        setEditingScheduleId(schedule.id)
                        setNewSchedule({
                          classId: schedule.class_id,
                          weekday: String(schedule.weekday),
                          startsAt: schedule.starts_at.slice(0, 5),
                          endsAt: schedule.ends_at.slice(0, 5),
                        })
                      }} aria-label="Editar horário" title="Editar horário"><Pencil size={14} /></button>
                      <button type="button" onClick={() => void deleteSchedule(schedule)} aria-label="Excluir horário" title="Excluir horário"><Trash2 size={14} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {profile.role === 'coordenador' && activeSection === 'catechists' && (
            <section className="schedule-management">
              <div className="dashboard-section-title">
                <div><h2>Cadastro de catequista</h2><p>Preencha os dados para cadastrar o catequista no sistema.</p></div>
              </div>
              <div className="management-grid catechist-management-grid">
                <form className="management-card" onSubmit={(event) => void registerCatechist(event)}>
                  <h3>{editingCatechistId ? 'Editar catequista' : 'Novo catequista'}</h3>
                  <p>{editingCatechistId ? 'Atualize os dados do catequista. Alterar o e-mail também altera o e-mail de acesso.' : 'Associe o catequista a uma turma; vários catequistas podem acompanhar a mesma turma.'}</p>
                  <div className="management-fields">
                    <label className="span-all">Nome<input autoComplete="name" value={catechistName} onChange={(event) => setCatechistName(event.target.value)} required maxLength={150} /></label>
                    <label>CPF<input inputMode="numeric" value={maskCpf(catechistCpf)} onChange={(event) => setCatechistCpf(maskCpf(event.target.value))} placeholder="000.000.000-00" required maxLength={14} /></label>
                    <label>Telefone<input type="tel" inputMode="tel" autoComplete="tel-national" value={catechistPhone} onChange={(event) => setCatechistPhone(maskPhone(event.target.value))} placeholder="(11) 99999-9999" required maxLength={16} /></label>
                    <label className="span-all">E-mail<input type="email" autoComplete="email" value={catechistEmail} onChange={(event) => setCatechistEmail(event.target.value)} required maxLength={254} /></label>
                    <label className="span-all">Turma
                      <select value={catechistClassId} onChange={(event) => setCatechistClassId(event.target.value)}>
                        <option value="">Sem turma associada</option>
                        {classes.filter((classItem) =>
                          classItem.active || classItem.id === catechistClassId,
                        ).map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                      </select>
                    </label>
                    {!editingCatechistId && <>
                      <label>Senha do primeiro acesso<input type="password" autoComplete="new-password" value={catechistInitialPassword} onChange={(event) => setCatechistInitialPassword(event.target.value)} required minLength={8} /></label>
                      <label>Confirmar senha<input type="password" autoComplete="new-password" value={catechistConfirmPassword} onChange={(event) => setCatechistConfirmPassword(event.target.value)} required minLength={8} /></label>
                    </>}
                  </div>
                  {!editingCatechistId && <p className="role-warning">Entregue a senha inicial ao catequista por um canal seguro. Ela será obrigatoriamente trocada no primeiro acesso.</p>}
                  <button className="button button-primary" type="submit" disabled={catechistLoading}>
                    {catechistLoading ? <><LoaderCircle className="spin" size={16} /> Salvando...</> : <>{editingCatechistId ? 'Salvar alterações' : 'Cadastrar'} <ArrowRight size={15} /></>}
                  </button>
                  {editingCatechistId && <button className="button button-outline" type="button" onClick={resetCatechistForm}>Cancelar edição</button>}
                </form>
                <div className="management-card catechist-directory">
                  <h3>Catequistas cadastrados</h3>
                  <p>Catequistas e coordenadores que também atuam como catequista.</p>
                  {catechists.length === 0 ? <span className="empty-class-list">Nenhum catequista cadastrado.</span> : catechists.map((catechist) => (
                    <div className="class-list-row catechist-row" key={catechist.id}>
                      <span className="catechist-identity">
                        <strong>{catechist.full_name}</strong>
                        <small>{catechist.email || 'E-mail não informado'}{catechist.cpf ? ` · CPF ${maskCpf(catechist.cpf)}` : ' · CPF não informado'}</small>
                      </span>
                      <div className="row-actions">
                        <small>{systemProfiles.find((item) => item.id === catechist.id)?.role === 'coordenador' ? 'Coordenador e catequista' : 'Catequista'}</small>
                        <button type="button" onClick={() => {
                          setEditingCatechistId(catechist.id)
                          setCatechistName(catechist.full_name)
                          setCatechistPhone(maskPhone(catechist.phone ?? ''))
                          setCatechistEmail(catechist.email ?? '')
                          setCatechistCpf(catechist.cpf ?? '')
                          setCatechistClassId(catechist.class_id ?? '')
                        }} aria-label={`Editar catequista ${catechist.full_name}`} title="Editar catequista"><Pencil size={14} /></button>
                        {systemProfiles.find((item) => item.id === catechist.id)?.role !== 'coordenador' && <button type="button" disabled={deletingCatechistId === catechist.id} onClick={() => void deleteCatechist(catechist)} aria-label={`Excluir catequista ${catechist.full_name}`} title="Excluir catequista">
                          {deletingCatechistId === catechist.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                        </button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          {profile.role === 'coordenador' && activeSection === 'profiles' && (
            <section className="schedule-management">
              <div className="dashboard-section-title">
                <div><h2>Perfis de acesso</h2><p>Crie contas para os três perfis. Convites são enviados por e-mail.</p></div>
                <span className="count-pill">{systemProfiles.length} {systemProfiles.length === 1 ? 'usuário' : 'usuários'}</span>
              </div>
              <div className="management-grid catechist-management-grid">
                <form className="management-card" onSubmit={(event) => void inviteProfile(event)}>
                  <h3>Criar perfil de usuário</h3>
                  <p>O acesso será criado no Supabase Auth e vinculado ao perfil selecionado.</p>
                  <div className="management-fields">
                    <label className="span-all">Nome completo<input autoComplete="name" value={inviteName} onChange={(event) => setInviteName(event.target.value)} required maxLength={150} /></label>
                    <label>Telefone<input type="tel" inputMode="tel" autoComplete="tel-national" value={maskPhone(invitePhone)} onChange={(event) => setInvitePhone(maskPhone(event.target.value))} placeholder="(11) 99999-9999" required maxLength={16} /></label>
                    <label>E-mail<input type="email" autoComplete="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required maxLength={254} /></label>
                    <label className="span-all">Perfil de acesso
                      <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as UserRole)}>
                        <option value="catequizando">Catequizando</option>
                        <option value="catequista">Catequista</option>
                        <option value="coordenador">Coordenador</option>
                      </select>
                    </label>
                    {inviteRole === 'catequista' && (
                      <label className="span-all">CPF<input inputMode="numeric" value={maskCpf(inviteCpf)} onChange={(event) => setInviteCpf(maskCpf(event.target.value))} placeholder="000.000.000-00" required maxLength={14} /></label>
                    )}
                    {inviteRole === 'catequista' && (
                      <label className="span-all">Turma
                        <select value={inviteClassId} onChange={(event) => setInviteClassId(event.target.value)}>
                          <option value="">Sem turma associada</option>
                          {classes.filter((classItem) => classItem.active).map((classItem) =>
                            <option key={classItem.id} value={classItem.id}>{classItem.name}</option>,
                          )}
                        </select>
                      </label>
                    )}
                  </div>
                  {inviteRole === 'coordenador' && (
                    <p className="role-warning">Coordenadores têm acesso amplo aos dados. Conceda esse perfil somente a pessoas autorizadas.</p>
                  )}
                  <button className="button button-primary" type="submit" disabled={profileInviteLoading}>
                    {profileInviteLoading ? <><LoaderCircle className="spin" size={16} /> Criando perfil...</> : <>Criar perfil e enviar convite <ArrowRight size={15} /></>}
                  </button>
                </form>
                <div className="management-card catechist-directory">
                  <h3>Usuários do sistema</h3>
                  <p>Perfis e níveis de acesso cadastrados.</p>
                  {systemProfiles.length === 0 ? <span className="empty-class-list">Nenhum perfil cadastrado.</span> : systemProfiles.map((systemProfile) => (
                    <div className="class-list-row" key={systemProfile.id}>
                      <span>{systemProfile.full_name}</span>
                      {systemProfile.role === 'catequizando' || systemProfile.id === profile.id ? (
                        <small className={`role-badge role-${systemProfile.role}`}>{roles[systemProfile.role]}{systemProfile.active === false ? ' · Inativo' : ''}</small>
                      ) : (
                        <select
                          aria-label={`Perfil de ${systemProfile.full_name}`}
                          value={systemProfile.role}
                          onChange={(event) => void changeUserRole(systemProfile, event.target.value as UserRole)}
                        >
                          <option value="catequista">Catequista</option>
                          <option value="coordenador">Coordenador</option>
                        </select>
                      )}
                      {systemProfile.role === 'coordenador' && (
                        <span className="coordinator-catechist">
                          <label>
                            <input
                              type="checkbox"
                              checked={catechists.some((item) => item.id === systemProfile.id)}
                              onChange={(event) => void setCoordinatorCatechist(systemProfile, event.target.checked, catechists.find((item) => item.id === systemProfile.id)?.class_id ?? null)}
                            /> Também é catequista
                          </label>
                          {catechists.some((item) => item.id === systemProfile.id) && (
                            <select
                              aria-label={`Turma de ${systemProfile.full_name}`}
                              value={catechists.find((item) => item.id === systemProfile.id)?.class_id ?? ''}
                              onChange={(event) => void setCoordinatorCatechist(systemProfile, true, event.target.value || null)}
                            >
                              <option value="">Sem turma</option>
                              {classes.filter((classItem) => classItem.active || classItem.id === catechists.find((item) => item.id === systemProfile.id)?.class_id).map((classItem) =>
                                <option key={classItem.id} value={classItem.id}>{classItem.name}</option>,
                              )}
                            </select>
                          )}
                        </span>
                      )}                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          {activeSection === 'applications' && profile.role !== 'catequizando' && (
            <>
              <div className="dashboard-section-title">
                <div><h2>Inscrições recebidas</h2><p>Dados visíveis conforme seu perfil e suas responsabilidades.</p></div>
                <span className="count-pill">{applications.filter((application) => !application.user_id).length} {applications.filter((application) => !application.user_id).length === 1 ? 'pessoa' : 'pessoas'}</span>
              </div>
              <div className="applications-card">
                <div className="table-toolbar">
                  <div className="table-search">
                    <UserRound size={17} />
                    <input aria-label="Buscar catequizando" placeholder="Buscar por nome..." value={search} onChange={(event) => setSearch(event.target.value)} />
                  </div>
                  <span className="private-data-note"><ShieldCheck size={15} /> Acesso restrito</span>
                </div>
                {loading ? (
                  <div className="dashboard-empty"><LoaderCircle className="spin" size={22} /> Carregando inscrições...</div>
                ) : pendingApplications.length === 0 ? (
                  <div className="dashboard-empty"><UsersRound size={25} /><strong>Nenhuma inscrição por aqui ainda</strong><span>Quando houver inscrições autorizadas para você, elas aparecerão nesta lista.</span></div>
                ) : (
                  <div className="application-list">
                    {pendingApplications.map((application) => (
                      <article className="application-row" key={application.id}>
                        <RegistrationSummary
                          registration={application}
                          classLabel={classes.find((classItem) => classItem.id === application.assigned_class_id)?.name}
                        />
                        <span className="application-date">{formatDateTime(application.created_at)}</span>
                        {preferences[application.id]?.length ? (
                          <span className="application-preferences">
                            Preferências: {preferences[application.id].map((preference) =>
                              `${weekdays[preference.weekday]} ${preference.starts_at.slice(0, 5)}–${preference.ends_at.slice(0, 5)} · ${preference.classes?.name ?? 'Turma'}`,
                            ).join(', ')}
                          </span>
                        ) : <span className="application-preferences">Sem preferência de horário</span>}
                        {profile.role === 'coordenador' && (
                          <label className="assignment-field">
                            <span>Turma do catequizando</span>
                            <select
                              value={application.assigned_class_id ?? ''}
                              onChange={(event) => void assignClass(application.id, event.target.value)}
                            >
                              <option value="">Sem turma</option>
                              {classes.filter((classItem) =>
                                classItem.active || classItem.id === application.assigned_class_id,
                              ).map((classItem) => (
                                <option key={classItem.id} value={classItem.id}>{classItem.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {application.marriage_certificate_path ? (
                          <button className="document-button" onClick={() => void openCertificate(application)} disabled={openingId === application.id}>
                            {openingId === application.id ? <LoaderCircle className="spin" size={15} /> : <FileCheck2 size={15} />}
                            Comprovante
                          </button>
                        ) : <span className="no-document">Sem anexo</span>}
                        <button type="button" className="button button-primary view-registration-button" onClick={() => setViewingRegistration(application)}>
                          <Eye size={15} /> Visualizar cadastro
                        </button>
                        {profile.role === 'coordenador' && (
                          <div className="row-actions registration-actions">
                            <button
                              className="button button-primary create-account-button"
                              type="button"
                              onClick={() => void createCatequizandoAccount(application)}
                              disabled={accountLoadingId === application.id || !application.email || !application.assigned_class_id}
                              title={!application.assigned_class_id ? 'Associe uma turma antes de confirmar' : !application.email ? 'A inscrição não possui e-mail' : undefined}
                            >
                              {accountLoadingId === application.id
                                ? <><LoaderCircle className="spin" size={14} /> Confirmando...</>
                                : 'Confirmar inscrição'}
                            </button>
                            <button type="button" onClick={() => void deleteCatequizando(application)} aria-label={`Excluir cadastro de ${application.full_name}`} title="Excluir catequizando"><Trash2 size={15} /></button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {activeSection === 'catequizandos' && profile.role !== 'catequizando' && (
            <>
              <div className="dashboard-section-title">
                <div><h2>Consultar catequizando</h2><p>Consulte os dados dos catequizandos cadastrados. Os cadastros são somente para leitura.</p></div>
                <span className="count-pill">{applications.filter((application) => application.user_id).length} {applications.filter((application) => application.user_id).length === 1 ? 'pessoa' : 'pessoas'}</span>
              </div>
              <div className="applications-card">
                <div className="table-toolbar">
                  <div className="table-search">
                    <UserRound size={17} />
                    <input aria-label="Buscar catequizando" placeholder="Buscar por nome..." value={search} onChange={(event) => setSearch(event.target.value)} />
                  </div>
                  <span className="private-data-note"><ShieldCheck size={15} /> Acesso restrito</span>
                </div>
                {loading ? (
                  <div className="dashboard-empty"><LoaderCircle className="spin" size={22} /> Carregando catequizandos...</div>
                ) : confirmedCatequizandos.length === 0 ? (
                  <div className="dashboard-empty"><UsersRound size={25} /><strong>Nenhum catequizando encontrado</strong><span>Os catequizandos autorizados para você aparecerão nesta lista.</span></div>
                ) : (
                  <div className="application-list">
                    {confirmedCatequizandos.map((application) => (
                      <article className="application-row" key={application.id}>
                        <RegistrationSummary
                          registration={application}
                          classLabel={classes.find((classItem) => classItem.id === application.assigned_class_id)?.name}
                        />
                        <span className="application-date">{formatDateTime(application.created_at)}</span>
                        <button type="button" className="button button-outline view-registration-button" onClick={() => setViewingRegistration(application)}>
                          <Eye size={15} /> Visualizar cadastro completo
                        </button>
                        {application.active === false && <small className="role-badge role-inactive">Inativo</small>}
                        {application.active !== false && (
                          <TransferClassControl
                            registration={application}
                            classes={classes}
                            onFeedback={setFeedback}
                            onTransferred={(registration, classId, permanent) => {
                              if (!permanent) return
                              setApplications((current) => profile.role === 'coordenador'
                                ? current.map((item) => item.id === registration.id ? { ...item, assigned_class_id: classId } : item)
                                : current.filter((item) => item.id !== registration.id))
                            }}
                          />
                        )}
                        {profile.role === 'coordenador' && (
                          <div className="catequizando-actions">
                            <button
                              type="button"
                              className="button button-outline view-registration-button"
                              disabled={managingCatequizandoId === application.id}
                              onClick={() => void manageCatequizando(application, application.active === false ? 'activate' : 'deactivate')}
                            >
                              {application.active === false ? 'Reativar' : 'Desativar'}
                            </button>
                            <button
                              type="button"
                              className="button button-outline view-registration-button"
                              disabled={managingCatequizandoId === application.id}
                              onClick={() => void manageCatequizando(application, 'delete')}
                              aria-label={`Excluir catequizando ${application.full_name}`}
                              title="Excluir catequizando"
                            >
                              {managingCatequizandoId === application.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                              Excluir
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {viewingRegistration && (
            <RegistrationDetailsModal
              registration={viewingRegistration}
              classLabel={classes.find((classItem) => classItem.id === viewingRegistration.assigned_class_id)?.name}
              preferences={preferences[viewingRegistration.id] ?? []}
              onClose={() => setViewingRegistration(null)}
            />
          )}
          {activeSection === 'applications' && profile.role === 'catequizando' && (
            <section className="own-application-card">
              <div className="dashboard-section-title">
                <div><h2>Sua inscrição</h2><p>Você pode consultar apenas os dados vinculados à sua conta.</p></div>
              </div>
              {applications.length === 0 ? (
                <div className="applications-card dashboard-empty">
                  <UsersRound size={25} />
                  <strong>Nenhuma inscrição vinculada a esta conta</strong>
                  <span>Se você já se inscreveu com outro e-mail, procure a secretaria paroquial para atualizar seu cadastro.</span>
                </div>
              ) : (
                applications.map((application) => (
                  <article className="applications-card own-application" key={application.id}>
                    <span className="application-avatar">{application.full_name.slice(0, 1).toUpperCase()}</span>
                    <div><strong>{application.full_name}</strong><p>{application.email}</p><small>Inscrição recebida em {formatDateTime(application.created_at)}</small></div>
                    {preferences[application.id]?.length ? (
                      <p className="application-preferences">Preferências: {preferences[application.id].map((preference) =>
                        `${weekdays[preference.weekday]} ${preference.starts_at.slice(0, 5)}–${preference.ends_at.slice(0, 5)}`,
                      ).join(', ')}</p>
                    ) : null}
                  </article>
                ))
              )}
            </section>
          )}
          <footer className="dashboard-footer"><span>PARÓQUIA SÃO JOSÉ <span>·</span> CATEQUESE DE ADULTOS</span><span>Se precisar de ajuda, procure a secretaria paroquial.</span></footer>
        </div>
      </section>
    </main>
  )
}

export default App
