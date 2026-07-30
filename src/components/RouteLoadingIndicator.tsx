import { Route as RootRoute } from '#/routes/__root'

/** Rendered by the router itself (see defaultPendingComponent in
 *  router.tsx), not by RootDocument, so it can't receive `scope` as a
 *  normal prop — reads the root route's own context instead, same data
 *  Header/Footer get, so the loading logo matches whichever brand's
 *  domain this is (previously always showed Spades' logo everywhere). */
export function RouteLoadingIndicator() {
  const { storefrontScope } = RootRoute.useRouteContext()

  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center py-20">
      <div className="animate-pulse">
        <img
          src={storefrontScope.logoLight}
          alt="Loading"
          className="h-8 w-auto dark:hidden"
        />
        <img
          src={storefrontScope.logoDark}
          alt="Loading"
          className="hidden h-8 w-auto dark:block"
        />
      </div>
    </div>
  )
}
