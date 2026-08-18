import type { MetadataRoute } from 'next';

/**
 * Makes the platform installable to a phone's Home Screen.
 *
 * Beyond the standalone window, installing is what unlocks notifications on
 * iOS: Safari only delivers Web Push to a site that has been added to the Home
 * Screen, never to one open in a tab.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GarmentOS — Operations',
    short_name: 'GarmentOS',
    description:
      'Operations dashboard for catalog, orders, production, and AI-assisted garment sales.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#F7F5F2',
    theme_color: '#C4622D',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops to its own shape; this one keeps the mark inside the
      // safe zone so the crop never clips it.
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Support Inbox',
        short_name: 'Inbox',
        url: '/support',
        description: 'Customer conversations across every channel',
      },
      {
        name: 'Orders',
        short_name: 'Orders',
        url: '/orders',
        description: 'Open and in-progress orders',
      },
    ],
  };
}
