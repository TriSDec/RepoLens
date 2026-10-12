import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

const baseline = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=(), browsing-topics=(), clipboard-read=()' },
    ...(isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
];

const nextConfig: NextConfig = {
    poweredByHeader: false,
    reactStrictMode: true,
    async headers() {
        return [
            { source: '/:path*', headers: baseline },
            {
                // The analyzer worker has no reason to touch the network, so it is forbidden to (its own policy,
                // independent of the page's). Even a compromised analyzer could not send data anywhere.
                source: '/worker/:path*',
                headers: [
                    { key: 'Content-Security-Policy', value: "default-src 'none'; connect-src 'none'; script-src 'self'; worker-src 'none'; img-src 'none'; frame-ancestors 'none'" },
                    { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
                ],
            },
        ];
    },
};

export default nextConfig;
