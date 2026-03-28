import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "100x Workflow Test Lab",
  description: "Workflow schema discovery, dataset generation, and execution testing for the 100x extension.",
}

export const viewport: Viewport = {
  themeColor: "#141414",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark theme" suppressHydrationWarning>
      <body className="antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-none focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to Main Content
        </a>
        <div className="page-shell">
          {children}
        </div>
      </body>
    </html>
  )
}
