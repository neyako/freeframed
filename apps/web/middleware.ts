import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/setup']
const PUBLIC_PREFIXES = ['/invite/', '/share/']

// Server-side (middleware) must reach the API with an ABSOLUTE url — a
// relative NEXT_PUBLIC_API_URL like "/api" (all-in-one) has no origin here.
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || ''
const API_URL =
  process.env.INTERNAL_API_URL ||
  (PUBLIC_API_URL.startsWith('http') ? PUBLIC_API_URL : 'http://127.0.0.1:8000')

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  return false
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  // Check if setup is needed — redirect to /setup if no superadmin exists
  // Uses a cookie cache to avoid calling the API on every request
  let markSetupDone = false
  if (!request.cookies.get('ff_setup_done')?.value) {
    try {
      const res = await fetch(`${API_URL}/setup/status`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        if (data.needs_setup) {
          return NextResponse.redirect(new URL('/setup', request.url))
        }
        markSetupDone = true
      }
    } catch {
      // API unreachable — let the request through, the page will show errors
    }
  }

  // Check for auth tokens
  const accessToken = request.cookies.get('ff_access_token')?.value
  const refreshToken = request.cookies.get('ff_refresh_token')?.value

  let response: NextResponse
  if (!accessToken && !refreshToken) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    response = NextResponse.redirect(loginUrl)
  } else {
    response = NextResponse.next()
  }

  // Setup is done — set cookie so we don't check again for 24 hours
  if (markSetupDone) {
    response.cookies.set('ff_setup_done', '1', { path: '/', maxAge: 60 * 60 * 24 })
  }
  return response
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - api routes
     * - public assets (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf)).*)',
  ],
}
