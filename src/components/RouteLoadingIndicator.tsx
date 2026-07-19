export function RouteLoadingIndicator() {
  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center py-20">
      <div className="animate-pulse">
        <img src="/logo-black.png" alt="Loading" className="h-8 w-auto dark:hidden" />
        <img
          src="/logo-white.png"
          alt="Loading"
          className="hidden h-8 w-auto dark:block"
        />
      </div>
    </div>
  )
}
