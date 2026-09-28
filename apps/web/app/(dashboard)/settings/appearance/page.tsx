import { redirect } from 'next/navigation'

// Settings is one page now; keep old links working.
export default function Page() {
  redirect('/settings')
}
