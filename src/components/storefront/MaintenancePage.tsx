import type { StorefrontScope } from '#/server/storefront/domain'

/** Shown instead of the normal site on every storefront route (never
 *  admin) when that brand's maintenance mode is switched on — see
 *  routes/__root.tsx. */
export function MaintenancePage({ scope }: { scope: StorefrontScope }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white px-6 text-center dark:bg-neutral-950">
      <img
        src={scope.logoLight}
        alt={scope.name}
        className="h-10 w-auto dark:hidden"
      />
      <img
        src={scope.logoDark}
        alt={scope.name}
        className="hidden h-10 w-auto dark:block"
      />
      <div>
        <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
          We&apos;ll be back soon
        </h1>
        <p className="mt-2 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
          {scope.name} is currently down for maintenance. Please check back
          shortly.
        </p>
      </div>
    </div>
  )
}
