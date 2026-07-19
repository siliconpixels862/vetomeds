import type { Metadata, Viewport } from 'next';
import { ConditionalHeader } from '@/components/ConditionalHeader';
import './globals.css';

export const metadata: Metadata = {
  title: 'VetoMeds — Trust Layer for Indian Healthcare',
  description: 'VetoMeds is the trust layer for Indian healthcare: evidence-cited capability checks, human-verified overrides, and honest medical-desert maps down to the PIN code.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0284c7',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" style={{ colorScheme: 'light' }}>
      <body>
        <ConditionalHeader />
        {children}
      </body>
    </html>
  );
}
