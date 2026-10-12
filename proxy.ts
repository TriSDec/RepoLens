import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content-Security-Policy with a fresh nonce.
 *
 * The page may only run scripts that carry the nonce, load nothing from other origins, and make no
 * network connections at all (connect-src 'none'), so project files read in the browser have nowhere to go.
 * Inline style *attributes* are allowed (they cannot run code); inline <style> and <script> tags need the nonce.
 */
export function buildCsp(nonce: string, { dev, https }: { dev: boolean; https: boolean }): string {
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
        `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        dev ? "connect-src 'self' ws: wss:" : "connect-src 'none'",
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        ...(https ? ['upgrade-insecure-requests'] : []),
    ].join('; ');
}

export function proxy(request: NextRequest) {
    const nonce = btoa(crypto.randomUUID());
    const csp = buildCsp(nonce, {
        dev: process.env.NODE_ENV === 'development',
        https: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
    });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
}

export const config = {
    // Pages only: static assets, the analyzer worker (which has its own stricter policy) and metadata files are excluded.
    matcher: [{ source: '/((?!_next/static|_next/image|worker/|favicon|icon|.*\\.[a-z0-9]+$).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
};
