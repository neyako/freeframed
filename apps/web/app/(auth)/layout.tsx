import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in · freeframed',
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-primary px-4 py-10">
      <div className="w-full max-w-[320px] space-y-6">
        <h1 className="text-[15px] font-semibold text-text-primary">freeframed</h1>
        {children}
      </div>
    </div>
  )
}
