import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FreeFrame — Auth',
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative min-h-screen bg-bg-primary ff-dotgrid flex flex-col items-center justify-center px-4">
      <div className="relative mb-10 flex flex-col items-center gap-3">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-text-tertiary">
          <span className="h-[7px] w-[7px] rounded-full bg-accent" aria-hidden />
          Frame-accurate review
        </span>
        <h1 className="font-sans text-[44px] font-medium leading-[0.9] tracking-[-0.045em] text-text-primary">
          freeframe<span className="text-accent">d</span>
        </h1>
      </div>

      <div className="relative w-full max-w-sm rounded-lg border border-border bg-bg-secondary p-6 animate-fade-in">
        {children}
      </div>

      <p className="relative mt-8 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        Collaborative media review &amp; approval
      </p>
    </div>
  )
}
