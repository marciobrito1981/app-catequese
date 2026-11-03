export type UserRole = 'coordenador' | 'catequista' | 'catequizando'

export type Schedule = {
  id: string
  weekday: number
  starts_at: string
  ends_at: string
  active: boolean
  available: boolean
  class_id: string
  classes: { name: string } | null
}

export type Profile = {
  id: string
  role: UserRole
}

export type AuthenticatedProfile = Profile & {
  full_name: string
  phone: string | null
  email: string
  cpf: string | null
  birth_date: string | null
  address: ProfileAddress | null
  mustChangePassword: boolean
}

export type ProfileAddress = {
  postal_code: string
  street: string
  street_number: string
  complement: string | null
  neighborhood: string
  city: string
  state: string
}

export type CatechistRecord = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  cpf: string | null
  class_id: string | null
}

export type Meeting = {
  id: string
  meeting_number: number
  theme: string
  mandatory: boolean
  created_at: string
}

export type AttendanceRecord = {
  meeting_id: string
  catequizando_id: string
  present: boolean
}

export type AppNotification = {
  id: string
  title: string
  message: string
  read_at: string | null
  created_at: string
}

export type RegistrationRow = {
  id: string
  full_name: string
  birth_date: string
  cpf: string
  sex: string | null
  postal_code: string
  street: string
  street_number: string
  complement: string | null
  neighborhood: string
  city: string
  state: string
  email: string | null
  phone: string | null
  marital_status: string
  referral_source: string
  referral_other: string | null
  registration_reason: string
  reason_other: string | null
  sacraments: string[]
  baptism_date: string | null
  baptism_parish: string | null
  baptism_city: string | null
  baptism_state: string | null
  eucharist_parish: string | null
  eucharist_city: string | null
  privacy_acknowledged_at: string
  marriage_certificate_path: string | null
  assigned_catechist_id: string | null
  assigned_class_id: string | null
  user_id: string | null
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: { id: string; role?: UserRole }
        Update: { role?: UserRole }
        Relationships: []
      }
      t_catequista: {
        Row: CatechistRecord & { created_at: string }
        Insert: { id: string; full_name: string; phone?: string | null; email?: string | null; cpf?: string | null; class_id?: string | null }
        Update: Partial<Pick<CatechistRecord, 'full_name' | 'phone' | 'email' | 'cpf' | 'class_id'>>
        Relationships: []
      }
      classes: {
        Row: { id: string; name: string; active: boolean }
        Insert: { id?: string; name: string; active?: boolean }
        Update: { name?: string; active?: boolean }
        Relationships: []
      }
      class_schedules: {
        Row: Schedule
        Insert: {
          id?: string
          class_id: string
          weekday: number
          starts_at: string
          ends_at: string
          active?: boolean
          available?: boolean
        }
        Update: Partial<{
          class_id: string
          weekday: number
          starts_at: string
          ends_at: string
          active: boolean
          available: boolean
        }>
        Relationships: [
          {
            foreignKeyName: 'class_schedules_class_id_fkey'
            columns: ['class_id']
            isOneToOne: false
            referencedRelation: 'classes'
            referencedColumns: ['id']
          },
        ]
      }
      t_catequizando: {
        Row: RegistrationRow
        Insert: never
        Update: Partial<RegistrationRow>
        Relationships: []
      }
      meetings: {
        Row: Meeting
        Insert: { meeting_number: number; theme: string; mandatory: boolean }
        Update: Partial<{ meeting_number: number; theme: string; mandatory: boolean }>
        Relationships: []
      }
      absence_settings: {
        Row: { id: boolean; max_absences: number; updated_at: string }
        Insert: never
        Update: { max_absences?: number; updated_at?: string }
        Relationships: []
      }
      meeting_attendance: {
        Row: AttendanceRecord & { recorded_by: string | null; recorded_at: string }
        Insert: AttendanceRecord & { recorded_by?: string | null; recorded_at?: string }
        Update: Partial<AttendanceRecord & { recorded_by: string | null; recorded_at: string }>
        Relationships: []
      }
      notifications: {
        Row: AppNotification & { user_id: string }
        Insert: never
        Update: { read_at?: string | null }
        Relationships: []
      }
      registration_preferences: {
        Row: { application_id: string; schedule_id: string }
        Insert: { application_id: string; schedule_id: string }
        Update: never
        Relationships: [
          {
            foreignKeyName: 'registration_preferences_application_id_fkey'
            columns: ['application_id']
            isOneToOne: false
            referencedRelation: 'applications'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'registration_preferences_schedule_id_fkey'
            columns: ['schedule_id']
            isOneToOne: false
            referencedRelation: 'class_schedules'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      create_registration_upload_token: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      create_catequizando_registration: {
        Args: { p_payload: Record<string, unknown> }
        Returns: string
      }
      update_own_profile: {
        Args: { p_full_name: string; p_phone: string; p_address?: Record<string, unknown> | null }
        Returns: undefined
      }
      is_initial_password_change_required: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      submit_public_registration: {
        Args: { p_payload: Record<string, unknown> }
        Returns: string
      }
      is_registration_upload_token_valid: {
        Args: { p_token: string }
        Returns: boolean
      }
      delete_class_schedule: {
        Args: { p_schedule_id: string }
        Returns: undefined
      }
      delete_class_record: {
        Args: { p_class_id: string }
        Returns: undefined
      }
      set_coordinator_catechist: {
        Args: { p_user_id: string; p_enabled: boolean; p_class_id?: string | null }
        Returns: undefined
      }
      change_user_role: {
        Args: { p_user_id: string; p_role: UserRole }
        Returns: UserRole
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
