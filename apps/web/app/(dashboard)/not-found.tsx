import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function DashboardNotFound() {
  return (
    <div className="space-y-3 px-4 py-6 text-[13px]">
      <h2 className="font-medium text-text-primary">Page not found.</h2>
      <Button asChild variant="secondary" size="sm">
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  )
}
