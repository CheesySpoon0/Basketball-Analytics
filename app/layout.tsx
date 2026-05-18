import type { Metadata } from 'next';
import Link from 'next/link';
import { Fraunces, Manrope, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  axes: ['opsz', 'SOFT', 'WONK'],
  display: 'swap',
});

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SCOUT — Big West Basketball Intelligence',
  description: 'Analytical scouting for Big West men\'s basketball.',
};

function Nav() {
  return (
    <nav className="border-b border-border bg-bg/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-baseline gap-2 group">
            <span className="display text-[22px] font-medium tracking-tight text-text">SCOUT</span>
            <span className="mono text-[10px] text-text-dim tracking-widest uppercase">v0.1</span>
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm">
            <Link href="/" className="text-text-dim hover:text-text transition-colors">Home</Link>
            <Link href="/teams" className="text-text-dim hover:text-text transition-colors">Teams</Link>
            <Link href="/players" className="text-text-dim hover:text-text transition-colors">Players</Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono text-[11px] uppercase tracking-wider px-2.5 py-1 border border-border rounded text-text-dim">
            2024–25 Season
          </span>
        </div>
      </div>
    </nav>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text">
        <Nav />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
