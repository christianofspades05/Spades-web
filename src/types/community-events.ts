export type EventRegistrationStatus = 'pending' | 'confirmed' | 'released'

export interface CommunityEventRow {
  id: string
  name: string
  slug: string
  location_name: string
  location_map_url: string | null
  image_url: string | null
  latitude: number | null
  longitude: number | null
  starts_at: string
  ends_at: string
  total_slots: number
  slots_reserved: number
  fee_cents: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface EventRegistrationRow {
  id: string
  event_id: string
  full_name: string
  age: number
  email: string | null
  phone: string | null
  fee_cents: number
  status: EventRegistrationStatus
  xendit_invoice_id: string | null
  confirmed_at: string | null
  released_at: string | null
  created_at: string
}

type Table<T> = {
  Row: { [K in keyof T]: T[K] }
  Insert: { [K in keyof T]?: T[K] }
  Update: { [K in keyof T]?: T[K] }
  Relationships: []
}

export type CommunityEventsTables = {
  community_events: Table<CommunityEventRow>
  event_registrations: Table<EventRegistrationRow>
}
