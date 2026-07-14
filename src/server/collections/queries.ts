import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import type { Collection } from '#/types/entities'

export const listActiveCollections = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Collection[]> => {
    const supabase = getSupabaseServerClient()
    const { data, error } = await supabase
      .from('collections')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) throw error
    return data
  },
)
