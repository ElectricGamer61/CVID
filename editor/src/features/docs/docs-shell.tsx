import { Link } from '@tanstack/react-router'
import type React from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Search } from 'lucide-react'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { DOC_GROUPS, DOC_PAGES, type DocCategory, type DocPage } from './docs-content'

interface DocsShellProps {
  children: React.ReactNode
  currentSlug?: string
}

export function DocsShell({ children, currentSlug }: DocsShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground select-text">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <FreeCutLogo size="md" />
            <span className="hidden text-sm text-muted-foreground sm:inline">Docs</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">Open FreeCut</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/">Home</Link>
            </Button>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <DocsNavigation currentSlug={currentSlug} />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  )
}

function DocsNavigation({ currentSlug }: { currentSlug?: string }) {
  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-3">
      <Link
        to="/docs"
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-accent',
          !currentSlug && 'bg-accent text-primary',
        )}
      >
        <BookOpen className="h-4 w-4" />
        Docs overview
      </Link>

      {DOC_GROUPS.map((group) => (
        <div key={group} className="space-y-1">
          <p className="px-2 text-xs font-medium text-muted-foreground">{group}</p>
          {DOC_PAGES.filter((page) => page.category === group).map((page) => (
            <Link
              key={page.slug}
              to="/docs/$slug"
              params={{ slug: page.slug }}
              className={cn(
                'block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
                currentSlug === page.slug && 'bg-accent text-foreground',
              )}
            >
              {page.title}
            </Link>
          ))}
        </div>
      ))}
    </div>
  )
}

export function DocsHome() {
  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <div className="mb-4 flex items-center gap-2 text-primary">
          <BookOpen className="h-5 w-5" />
          <span className="text-sm font-medium">FreeCut documentation</span>
        </div>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          FreeCut User Guide
        </h1>
        <p className="mt-4 max-w-3xl text-muted-foreground">
          Start with setup, workspaces, media import, timeline editing, and export. Use the
          reference pages when you need a precise control, shortcut, or troubleshooting path.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/docs/$slug" params={{ slug: 'getting-started' }}>
              Start editing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/docs/$slug" params={{ slug: 'troubleshooting' }}>
              Fix a problem
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {(
          [
            ['Start', 'Set up the browser, workspace, projects, and editor layout.'],
            [
              'Core Editing',
              'Import media, cut on the timeline, preview, and adjust clip properties.',
            ],
            [
              'Creative Tools',
              'Use text, audio, effects, color, transitions, keyframes, scenes, and local AI.',
            ],
            ['Output', 'Export files from the browser and manage queued renders.'],
          ] satisfies [DocCategory, string][]
        ).map(([title, description]) => (
          <div key={title} className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            <div className="mt-4 space-y-1">
              {DOC_PAGES.filter((page) => page.category === title).map((page) => (
                <Link
                  key={page.slug}
                  to="/docs/$slug"
                  params={{ slug: page.slug }}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  {page.title}
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">Reference</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_PAGES.filter((page) => page.category === 'Reference').map((page) => (
            <Link
              key={page.slug}
              to="/docs/$slug"
              params={{ slug: page.slug }}
              className="rounded-md border border-border bg-background p-3 hover:border-primary/60"
            >
              <p className="text-sm font-medium">{page.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{page.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

export function DocsArticle({ page }: { page: DocPage }) {
  const index = DOC_PAGES.findIndex((candidate) => candidate.slug === page.slug)
  const previous = index > 0 ? DOC_PAGES[index - 1] : undefined
  const next = index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : undefined

  return (
    <article className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-6 sm:p-8">
        <Link
          to="/docs"
          className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Docs
        </Link>
        <p className="text-sm font-medium text-primary">{page.category}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">{page.description}</p>
      </div>

      <div className="space-y-8 p-6 sm:p-8">
        {page.sections.map((section, sectionIndex) => (
          <section key={sectionIndex}>
            <h2 className="text-xl font-semibold">{section.title}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              {section.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">
        {previous ? (
          <Button asChild variant="outline" className="justify-start">
            <Link to="/docs/$slug" params={{ slug: previous.slug }}>
              <ArrowLeft className="h-4 w-4" />
              {previous.title}
            </Link>
          </Button>
        ) : (
          <div />
        )}
        {next && (
          <Button asChild variant="outline" className="justify-end">
            <Link to="/docs/$slug" params={{ slug: next.slug }}>
              {next.title}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </footer>
    </article>
  )
}
