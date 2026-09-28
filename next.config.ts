import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const development = process.env.NODE_ENV !== 'production';
    const policy = [
      "default-src 'self'", "script-src 'self' 'unsafe-inline'" + (development ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
      development ? "connect-src 'self' ws: wss:" : "connect-src 'none'",
      "worker-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'"
    ].join('; ');
    return [{ source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: policy },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    ] }];
  },
};

export default nextConfig;
