import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about/')({ component: AboutPage })

function AboutPage() {
  return (
    <div className="bg-neutral-950 text-white">
      <section>
        <video
          src="/about/hero.mp4"
          poster="/about/hero-poster.jpg"
          className="aspect-video w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
        />
      </section>

      <section>
        <img
          src="/about/banner-2.jpg"
          alt="About us. The brand. We don't believe in luck. We believe in betting on yourself."
          className="aspect-video w-full object-cover"
        />
      </section>

      <section className="grid grid-cols-1 gap-10 border-t border-neutral-800 px-8 py-16 md:grid-cols-2 md:px-14">
        <div>
          <p className="text-xs font-semibold tracking-widest text-neutral-400 uppercase">
            Our vision
          </p>
          <p className="mt-3 text-sm leading-relaxed text-neutral-300">
            To become one of the world's leading streetwear brands that
            represents ambition, confidence, and self-belief.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-neutral-300">
            We envision a generation of individuals who choose courage over
            comfort, embrace calculated risks, and inspire others through the
            way they live.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-neutral-300">
            Spades exists to remind people that success belongs to those willing
            to bet on themselves.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-widest text-neutral-400 uppercase">
            Our mission
          </p>
          <p className="mt-3 text-sm leading-relaxed text-neutral-300">
            To create premium streetwear that represents more than fashion.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-neutral-300">
            Every product we release is designed to inspire confidence, elevate
            self-expression, and encourage people to chase bigger goals without
            fear of failure.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-neutral-300">
            Our mission is simple: build clothing that reminds people to bet on
            themselves — every single day.
          </p>
        </div>
      </section>

      <section>
        <img
          src="/about/bet-on-yourself.jpg"
          alt="The house doesn't make winners. You do. Bet on yourself."
          className="aspect-video w-full object-cover"
        />
      </section>
    </div>
  )
}
