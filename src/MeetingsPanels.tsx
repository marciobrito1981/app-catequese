import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Bell, LoaderCircle, X } from 'lucide-react'
import { supabase } from './lib/supabase'
import type { AppNotification, AttendanceRecord, AuthenticatedProfile, Meeting, RegistrationRow } from './lib/types'

type Notify = (feedback: { kind: 'success' | 'error' | 'info'; text: string }) => void

export function MeetingsManagement({ onFeedback }: { onFeedback: Notify }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [maxAbsences, setMaxAbsences] = useState('3')
  const [number, setNumber] = useState('')
  const [theme, setTheme] = useState('')
  const [mandatory, setMandatory] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    const [{ data: meetingRows, error }, { data: settings }] = await Promise.all([
      supabase.from('meetings').select('*').order('meeting_number'),
      supabase.from('absence_settings').select('max_absences').eq('id', true).maybeSingle(),
    ])
    if (error) onFeedback({ kind: 'error', text: 'Não foi possível carregar os encontros.' })
    else setMeetings(meetingRows ?? [])
    if (settings) setMaxAbsences(String(settings.max_absences))
  }, [onFeedback])

  useEffect(() => { void load() }, [load])

  const reset = () => {
    setNumber('')
    setTheme('')
    setMandatory(true)
    setEditingId(null)
  }

  const saveMeeting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    const meetingNumber = Number(number)
    if (!Number.isInteger(meetingNumber) || meetingNumber < 1 || !theme.trim()) {
      onFeedback({ kind: 'error', text: 'Informe o número do encontro e o tema abordado.' })
      return
    }
    setSaving(true)
    const payload = { meeting_number: meetingNumber, theme: theme.trim(), mandatory }
    const { error } = editingId
      ? await supabase.from('meetings').update(payload).eq('id', editingId)
      : await supabase.from('meetings').insert(payload)
    setSaving(false)
    if (error) {
      onFeedback({
        kind: 'error',
        text: error.code === '23505' ? 'Já existe um encontro com este número.' : 'Não foi possível salvar o encontro.',
      })
      return
    }
    onFeedback({ kind: 'success', text: editingId ? 'Encontro atualizado.' : 'Encontro cadastrado.' })
    reset()
    await load()
  }

  const deleteMeeting = async (meeting: Meeting) => {
    if (!supabase) return
    if (!window.confirm(`Excluir o encontro ${meeting.meeting_number}? As presenças registradas nele também serão removidas.`)) return
    const { error } = await supabase.from('meetings').delete().eq('id', meeting.id)
    if (error) {
      onFeedback({ kind: 'error', text: 'Não foi possível excluir o encontro.' })
      return
    }
    if (editingId === meeting.id) reset()
    await load()
  }

  const saveLimit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    const value = Number(maxAbsences)
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      onFeedback({ kind: 'error', text: 'Informe um limite de faltas entre 0 e 100.' })
      return
    }
    const { error } = await supabase
      .from('absence_settings')
      .update({ max_absences: value, updated_at: new Date().toISOString() })
      .eq('id', true)
    onFeedback(error
      ? { kind: 'error', text: 'Não foi possível salvar o limite de faltas.' }
      : { kind: 'success', text: 'Limite de faltas atualizado.' })
  }

  return (
    <section className="schedule-management">
      <div className="dashboard-section-title">
        <div><h2>Cadastro de encontros</h2><p>Defina os encontros da catequese e o limite de faltas permitido.</p></div>
        <span className="count-pill">{meetings.length} {meetings.length === 1 ? 'encontro' : 'encontros'}</span>
      </div>
      <div className="management-grid">
        <div>
          <form className="management-card" onSubmit={(event) => void saveMeeting(event)}>
            <h3>{editingId ? 'Editar encontro' : 'Novo encontro'}</h3>
            <div className="management-fields">
              <label>Nº do encontro<input type="number" min={1} value={number} onChange={(event) => setNumber(event.target.value)} required /></label>
              <label>Obrigatório?
                <select value={mandatory ? 'sim' : 'nao'} onChange={(event) => setMandatory(event.target.value === 'sim')}>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              </label>
              <label className="span-all">Tema abordado<input value={theme} onChange={(event) => setTheme(event.target.value)} required maxLength={200} /></label>
            </div>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? <><LoaderCircle className="spin" size={15} /> Salvando...</> : editingId ? 'Salvar encontro' : 'Cadastrar encontro'}
            </button>
            {editingId && <button className="button button-outline" type="button" onClick={reset}>Cancelar</button>}
          </form>
          <form className="management-card" onSubmit={(event) => void saveLimit(event)}>
            <h3>Limite de faltas</h3>
            <p>Quando o catequizando ultrapassar este limite, ele e os catequistas da turma dele são avisados.</p>
            <div className="management-fields">
              <label className="span-all">Máximo de faltas permitido
                <input type="number" min={0} max={100} value={maxAbsences} onChange={(event) => setMaxAbsences(event.target.value)} required />
              </label>
            </div>
            <button className="button button-primary" type="submit">Salvar limite</button>
          </form>
        </div>
        <div className="management-card">
          <h3>Encontros cadastrados</h3>
          {meetings.length === 0 ? <span className="empty-class-list">Nenhum encontro cadastrado.</span> : meetings.map((meeting) => (
            <div className="class-list-row" key={meeting.id}>
              <span><strong>{meeting.meeting_number}.</strong> {meeting.theme} <small>({meeting.mandatory ? 'obrigatório' : 'opcional'})</small></span>
              <span>
                <button type="button" onClick={() => {
                  setEditingId(meeting.id)
                  setNumber(String(meeting.meeting_number))
                  setTheme(meeting.theme)
                  setMandatory(meeting.mandatory)
                }}>Editar</button>
                {' '}
                <button type="button" onClick={() => void deleteMeeting(meeting)}>Excluir</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function AttendancePanel({ registrations, role, onFeedback }: {
  registrations: RegistrationRow[]
  role: AuthenticatedProfile['role']
  onFeedback: Notify
}) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [allAttendance, setAllAttendance] = useState<AttendanceRecord[]>([])
  const [transfers, setTransfers] = useState<{ catequizando_id: string; meeting_id: string; to_class_id: string }[]>([])
  const [myClassId, setMyClassId] = useState<string | null>(null)
  const [maxAbsences, setMaxAbsences] = useState(0)
  const [meetingId, setMeetingId] = useState('')
  const [marks, setMarks] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [attendanceSummaryOpen, setAttendanceSummaryOpen] = useState(false)

  const students = useMemo(() => {
    const confirmed = registrations.filter((item) => item.user_id && item.active && item.assigned_class_id)
    if (role === 'coordenador' || !meetingId) return confirmed
    return confirmed.filter((item) => {
      const transfer = transfers.find((entry) => entry.catequizando_id === item.id && entry.meeting_id === meetingId)
      return (transfer ? transfer.to_class_id : item.assigned_class_id) === myClassId
    })
  }, [registrations, role, meetingId, transfers, myClassId])

  const load = useCallback(async () => {
    if (!supabase) return
    const { data: userData } = await supabase.auth.getUser()
    const [{ data: meetingRows }, { data: attendanceRows }, { data: settings }, { data: transferRows }, { data: ownRow }] = await Promise.all([
      supabase.from('meetings').select('*').order('meeting_number'),
      supabase.from('meeting_attendance').select('meeting_id, catequizando_id, present'),
      supabase.from('absence_settings').select('max_absences').eq('id', true).maybeSingle(),
      supabase.from('class_transfers').select('catequizando_id, meeting_id, to_class_id'),
      supabase.from('t_catequista').select('class_id').eq('id', userData.user?.id ?? '').maybeSingle(),
    ])
    setMeetings(meetingRows ?? [])
    setAllAttendance(attendanceRows ?? [])
    setTransfers(transferRows ?? [])
    setMyClassId(ownRow?.class_id ?? null)
    if (settings) setMaxAbsences(settings.max_absences)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!attendanceSummaryOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAttendanceSummaryOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [attendanceSummaryOpen])

  useEffect(() => {
    const next: Record<string, boolean> = {}
    for (const student of students) {
      const record = allAttendance.find((item) => item.meeting_id === meetingId && item.catequizando_id === student.id)
      next[student.id] = record ? record.present : false
    }
    setMarks(next)
  }, [meetingId, allAttendance, students])

  const absences = (studentId: string) =>
    allAttendance.filter((item) => item.catequizando_id === studentId && !item.present).length
  const meetingAttendance = allAttendance.filter((item) => item.meeting_id === meetingId)
  const attendanceGroups = [
    ['Presentes', students.filter((student) => meetingAttendance.find((item) => item.catequizando_id === student.id)?.present === true)],
    ['Ausentes', students.filter((student) => meetingAttendance.find((item) => item.catequizando_id === student.id)?.present === false)],
    ['Sem registro', students.filter((student) => !meetingAttendance.some((item) => item.catequizando_id === student.id))],
  ] as const
  const selectedMeeting = meetings.find((meeting) => meeting.id === meetingId)

  const save = async () => {
    if (!supabase || !meetingId || students.length === 0) return
    setSaving(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('meeting_attendance').upsert(
      students.map((student) => ({
        meeting_id: meetingId,
        catequizando_id: student.id,
        present: marks[student.id] ?? false,
        recorded_by: userData.user?.id ?? null,
        recorded_at: new Date().toISOString(),
      })),
      { onConflict: 'meeting_id,catequizando_id' },
    )
    setSaving(false)
    if (error) {
      onFeedback({ kind: 'error', text: 'Não foi possível salvar a chamada.' })
      return
    }
    onFeedback({ kind: 'success', text: 'Chamada salva. Os avisos de limite de faltas foram gerados quando necessário.' })
    await load()
    void supabase.functions.invoke('send-absence-alerts').catch(() => undefined)
  }

  return (
    <section className="schedule-management">
      <div className="dashboard-section-title">
        <div><h2>Chamada dos encontros</h2><p>Marque apenas os catequizandos que compareceram; os não marcados serão registrados como falta. Limite de faltas: {maxAbsences}.</p></div>
      </div>
      <div className="management-card">
        <div className="management-fields">
          <label className="span-all">Encontro
            <select value={meetingId} onChange={(event) => setMeetingId(event.target.value)}>
              <option value="">Selecione o encontro</option>
              {meetings.map((meeting) => (
                <option key={meeting.id} value={meeting.id}>{meeting.meeting_number}. {meeting.theme}{meeting.mandatory ? '' : ' (opcional)'}</option>
              ))}
            </select>
          </label>
        </div>
        {!meetingId ? <span className="empty-class-list">Selecione um encontro para registrar a presença.</span>
          : students.length === 0 ? <span className="empty-class-list">Nenhum catequizando confirmado com turma.</span>
            : students.map((student) => (
              <div className="class-list-row" key={student.id}>
                <span>{student.full_name} <small>— faltas: {absences(student.id)}{absences(student.id) > maxAbsences ? ' (acima do limite)' : ''}</small></span>
                <label>
                  <input
                    type="checkbox"
                    checked={marks[student.id] ?? false}
                    onChange={(event) => setMarks((current) => ({ ...current, [student.id]: event.target.checked }))}
                  /> Presente
                </label>
              </div>
            ))}
        {meetingId && students.length > 0 && (
          <div className="attendance-actions">
            <button className="button button-primary view-registration-button" type="button" onClick={() => setAttendanceSummaryOpen(true)}>
              Ver presenças e ausências
            </button>
            <button className="button button-primary view-registration-button" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? <><LoaderCircle className="spin" size={15} /> Salvando...</> : 'Salvar chamada'}
            </button>
          </div>
        )}
      </div>
      {attendanceSummaryOpen && (
        <div className="modal-backdrop" onClick={() => setAttendanceSummaryOpen(false)}>
          <div
            className="registration-modal attendance-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-summary-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="registration-modal-header">
              <div>
                <span className="eyebrow">
                  {selectedMeeting ? `${selectedMeeting.meeting_number}. ${selectedMeeting.theme}` : 'CHAMADA'}
                </span>
                <h2 id="attendance-summary-title">Presenças e ausências</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setAttendanceSummaryOpen(false)} aria-label="Fechar">
                <X size={18} />
              </button>
            </header>
            <div className="registration-modal-body attendance-summary">
              {attendanceGroups.map(([label, list]) => (
                <section key={label}>
                  <h3>{label} ({list.length})</h3>
                  {list.length > 0 && <ul>{list.map((student) => <li key={student.id}>{student.full_name}</li>)}</ul>}
                </section>
              ))}
            </div>
            <footer className="registration-modal-footer">
              <button type="button" className="button button-primary" onClick={() => setAttendanceSummaryOpen(false)}>Fechar</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}

export function TransferClassControl({ registration, classes, onFeedback, onTransferred }: {
  registration: RegistrationRow
  classes: { id: string; name: string; active: boolean }[]
  onFeedback: Notify
  onTransferred: (registration: RegistrationRow, classId: string, permanent: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [classId, setClassId] = useState('')
  const [scope, setScope] = useState<'permanent' | 'meeting'>('permanent')
  const [meetingId, setMeetingId] = useState('')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !supabase) return
    void supabase.from('meetings').select('*').order('meeting_number').then(({ data }) => setMeetings(data ?? []))
  }, [open])

  const submit = async () => {
    if (!supabase || !classId || (scope === 'meeting' && !meetingId)) return
    setSaving(true)
    const { error } = await supabase.rpc('transfer_catequizando', {
      p_catequizando_id: registration.id,
      p_class_id: classId,
      p_meeting_id: scope === 'meeting' ? meetingId : null,
    })
    setSaving(false)
    if (error) {
      onFeedback({ kind: 'error', text: error.message || 'Não foi possível transferir o catequizando.' })
      return
    }
    onFeedback({
      kind: 'success',
      text: scope === 'permanent' ? 'Turma alterada.' : 'Transferência temporária registrada.',
    })
    setOpen(false)
    setClassId('')
    setMeetingId('')
    onTransferred(registration, classId, scope === 'permanent')
  }

  if (!open) {
    return <button type="button" className="button button-outline view-registration-button" onClick={() => setOpen(true)}>Transferir turma</button>
  }
  return (
    <div className="transfer-control">
      <select aria-label="Turma de destino" value={classId} onChange={(event) => setClassId(event.target.value)}>
        <option value="">Turma de destino</option>
        {classes.filter((item) => item.active && item.id !== registration.assigned_class_id).map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      <select aria-label="Tipo de transferência" value={scope} onChange={(event) => setScope(event.target.value as 'permanent' | 'meeting')}>
        <option value="permanent">Permanente</option>
        <option value="meeting">Temporária</option>
      </select>
      {scope === 'meeting' && (
        <select aria-label="Encontro da transferência" value={meetingId} onChange={(event) => setMeetingId(event.target.value)}>
          <option value="">Encontro</option>
          {meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.meeting_number}. {meeting.theme}</option>)}
        </select>
      )}
      <button type="button" className="button button-outline view-registration-button" disabled={saving || !classId || (scope === 'meeting' && !meetingId)} onClick={() => void submit()}>
        {saving ? <LoaderCircle className="spin" size={15} /> : 'Confirmar'}
      </button>
      <button type="button" className="button button-outline view-registration-button" onClick={() => setOpen(false)}>Cancelar</button>
    </div>
  )
}

export function NotificationsBanner({ profile }: { profile: AuthenticatedProfile }) {
  const [items, setItems] = useState<AppNotification[]>([])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase
      .from('notifications')
      .select('id, title, message, read_at, created_at')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => { if (active && data) setItems(data) })
    return () => { active = false }
  }, [profile.id])

  const markRead = async (id: string) => {
    if (!supabase) return
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    if (!error) setItems((current) => current.filter((item) => item.id !== id))
  }

  if (items.length === 0) return null
  return (
    <div className="notifications-list">
      {items.map((item) => (
        <div className="feedback feedback-error" role="alert" key={item.id}>
          <Bell size={16} />
          <span><strong>{item.title}.</strong> {item.message}</span>
          <button className="schedule-status-button" type="button" onClick={() => void markRead(item.id)}>Marcar como lida</button>
        </div>
      ))}
    </div>
  )
}
