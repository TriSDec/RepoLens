import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'RepoLens',
        short_name: 'RepoLens',
        description: 'Turn any codebase into an interactive 3D map. Runs entirely in your browser.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0c0d',
        theme_color: '#0b0c0d',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    };
}
