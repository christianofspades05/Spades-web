import { useBlocker } from '@tanstack/react-router'

/**
 * Warns before losing unsaved edits — both in-app navigation (e.g. a "Back"
 * button) and closing/refreshing the tab (via useBlocker's
 * enableBeforeUnload, which triggers the browser's native confirmation).
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  useBlocker(
    () => !window.confirm('You have unsaved changes. Leave without saving?'),
    isDirty,
  )
}
