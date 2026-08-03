import { createFileRoute } from '@tanstack/react-router'
import { Facebook, Instagram } from 'lucide-react'
import { TikTokIcon } from '#/components/storefront/TikTokIcon'
import { useLanguage } from '#/lib/i18n/LanguageContext'

export const Route = createFileRoute('/contact/')({ component: ContactPage })

function ContactPage() {
  const { storefrontScope } = Route.useRouteContext()
  const { t } = useLanguage()
  const socialLinks = [
    {
      label: 'Facebook',
      href: storefrontScope.social.facebook,
      Icon: Facebook,
    },
    {
      label: 'Instagram',
      href: storefrontScope.social.instagram,
      Icon: Instagram,
    },
    { label: 'TikTok', href: storefrontScope.social.tiktok, Icon: TikTokIcon },
  ].filter((link) => link.href)

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="text-3xl font-bold">{t.nav.contactUs}</h1>
      <p className="mt-4 text-neutral-600 dark:text-neutral-400">
        {t.contact.body}
      </p>

      <div className="mt-10 flex justify-center gap-8">
        {socialLinks.map(({ label, href, Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center gap-2"
          >
            <span className="flex size-16 items-center justify-center rounded-full border border-neutral-300 text-neutral-900 transition group-hover:border-neutral-900 group-hover:bg-neutral-950 group-hover:text-white dark:border-neutral-700 dark:text-white dark:group-hover:border-white dark:group-hover:bg-white dark:group-hover:text-neutral-950">
              <Icon size={26} />
            </span>
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {label}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
