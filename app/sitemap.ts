import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
    return ['', '/docs', '/privacy', '/terms', '/licenses'].map(path => ({ url: `${SITE}${path}`, changeFrequency: 'monthly', priority: path === '' ? 1 : 0.6 }));
}
