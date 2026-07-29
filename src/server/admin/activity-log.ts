import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { StaffUser } from '#/types/entities'

/**
 * Every admin mutation writes one of these, per src/server/admin/README.md.
 * `entityId` is a uuid column — pass null for bulk operations spanning
 * multiple entities (there's no single id to record); the affected ids
 * belong in `metadata` instead.
 */
export async function logStaffActivity(
  staff: StaffUser,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const admin = getSupabaseAdminClient()
  const { error } = await admin.from('activity_logs').insert({
    actor_type: 'staff',
    staff_user_id: staff.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  })
  if (error) throw error
}
