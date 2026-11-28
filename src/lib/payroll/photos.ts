/** Private storage bucket for clock-in selfies (migration 0141). Lives here,
 *  not in the server module, so the browser can import it without pulling
 *  in server-only code. */
export const ATTENDANCE_PHOTO_BUCKET = 'attendance-photos'
