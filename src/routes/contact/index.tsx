import { createFileRoute } from '@tanstack/react-router'
import { Facebook, Instagram } from 'lucide-react'
import { TikTokIcon } from '#/components/storefront/TikTokIcon'

export const Route = createFileRoute('/contact/')({ component: ContactPage })

const SOCIAL_LINKS = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/spadesofficialph/',
    Icon: Facebook,
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/spades_officialph/',
    Icon: Instagram,
  },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@spades_officialbrand',
    Icon: TikTokIcon,
  },
] as const

function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="text-3xl font-bold">Contact Us</h1>
      <p className="mt-4 text-neutral-600 dark:text-neutral-400">
        Find us and reach out on our social channels.
      </p>

      <div className="mt-10 flex justify-center gap-8">
        {SOCIAL_LINKS.map(({ label, href, Icon }) => (
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
