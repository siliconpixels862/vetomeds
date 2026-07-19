'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

function BrandMark() {
  return (
    <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-sky-600 text-white shadow-sm shadow-sky-600/25 shrink-0">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 12h3.5l1.8-4.5 3 9 2-4.5H21" />
      </svg>
    </span>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 bg-white/75 backdrop-blur-xl border-b border-slate-200/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-6">
        {/* Brand lockup */}
        <Link href="/" className="flex items-center gap-2.5 min-w-0 group" onClick={() => setOpen(false)}>
          <BrandMark />
          <span className="flex flex-col leading-none min-w-0">
            <span className="font-bold tracking-tight text-slate-900 truncate text-[17px]">VetoMeds</span>
            <span className="hidden lg:block text-[11px] text-slate-400 mt-0.5 truncate">Trust layer for Indian healthcare</span>
          </span>
        </Link>

        {/* Desktop nav + status chip */}
        <div className="hidden sm:flex items-center gap-3">
          <nav className="flex items-center gap-1 text-sm">
            <NavLink href="/trust-desk" label="Trust Desk" active={pathname?.startsWith('/trust-desk') || pathname?.startsWith('/facility')} />
            <NavLink href="/desert" label="Desert Planner" active={pathname?.startsWith('/desert')} />
          </nav>
          <span className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-400 ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
            Databricks Free Edition
          </span>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="sm:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 bg-white/70 text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {open ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile sheet */}
      {open && (
        <div className="sm:hidden border-t border-slate-200/70 bg-white/95 backdrop-blur">
          <nav className="px-4 py-3 flex flex-col gap-1 text-sm">
            <MobileLink href="/trust-desk" label="Trust Desk" active={pathname?.startsWith('/trust-desk') || pathname?.startsWith('/facility')} onClick={() => setOpen(false)} />
            <MobileLink href="/desert" label="Desert Planner" active={pathname?.startsWith('/desert')} onClick={() => setOpen(false)} />
            <span className="mt-1 inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              Databricks Free Edition
            </span>
          </nav>
        </div>
      )}
    </header>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`px-3.5 py-1.5 rounded-full font-medium transition-colors ${
        active
          ? 'bg-sky-100 text-sky-800'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
      }`}
    >
      {label}
    </Link>
  );
}

function MobileLink({ href, label, active, onClick }: { href: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`px-3 py-3 rounded-xl font-medium transition-colors ${
        active
          ? 'bg-sky-100 text-sky-800'
          : 'text-slate-700 hover:bg-slate-100 active:bg-slate-200'
      }`}
    >
      {label}
    </Link>
  );
}
