import { createFileRoute, redirect } from '@tanstack/react-router'
import { resumeCartByToken } from '#/server/cart/resume'

export const Route = createFileRoute('/cart/resume/$token')({
  beforeLoad: async ({ params }) => {
    await resumeCartByToken({ data: { token: params.token } })
    throw redirect({ to: '/cart' })
  },
})
