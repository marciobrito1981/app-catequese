export type UserRole = 'administrador' | 'catequista' | 'catequizando'

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
  mustChangePassword: boolean
}

export type CatechistRecord = {
  id: string
  full_name: string
  phone: string | null
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
        Insert: { id: string; full_name: string; phone?: string | null }
        Update: Partial<Pick<CatechistRecord, 'full_name' | 'phone'>>
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
        Args: { p_full_name: string; p_phone: string }
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
      update_catequizando_registration: {
        Args: { p_id: string; p_payload: Record<string, unknown> }
        Returns: undefined
      }
      delete_class_schedule: {
        Args: { p_schedule_id: string }
        Returns: undefined
      }
      delete_class_record: {
        Args: { p_class_id: string }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
