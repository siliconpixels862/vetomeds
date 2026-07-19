'use client';

import { usePathname } from 'next/navigation';
import { Header } from './Header';

/**
 * The chat home page ("/") is a full-screen app shell with its own VetoMeds branding
 * in the sidebar, so the global navbar is hidden there. The secondary manual pages
 * (/trust-desk, /desert) keep the navbar for navigation.
 */
export function ConditionalHeader() {
  const pathname = usePathname();
  if (pathname === '/') return null;
  return <Header />;
}
