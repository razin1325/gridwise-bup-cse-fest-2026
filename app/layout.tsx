import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GridWise | Smart Campus Energy Optimization Engine',
  description: 'BUP CSE FEST 2026 Hackathon - LLM-Assisted Smart Campus Energy Optimization Engine with 3-tier processing pipeline and Linear Programming solver.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased selection:bg-cyan-500 selection:text-black">
        {children}
      </body>
    </html>
  );
}
