import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SiteShell } from '../components/layout/site-shell';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://macrohub.local';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'MacroHub — Geometry Dash Macros',
    template: '%s · MacroHub',
  },
  description: 'Find, share, convert, and download Geometry Dash macros in formats compatible with your replay tool.',
  applicationName: 'MacroHub',
  category: 'gaming',
  openGraph: {
    type: 'website',
    siteName: 'MacroHub',
    title: 'MacroHub — Geometry Dash Macros',
    description: 'A modern community library for Geometry Dash macros, tools, and formats.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'MacroHub — Geometry Dash macros, connected.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MacroHub — Geometry Dash Macros',
    description: 'A modern community library for Geometry Dash macros, tools, and formats.',
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#080a0f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}

