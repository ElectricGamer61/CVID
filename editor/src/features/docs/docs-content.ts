export interface DocSection {
  title: string
  items: string[]
}

export type DocCategory = 'Start' | 'Core Editing' | 'Creative Tools' | 'Output' | 'Reference'

export interface DocPage {
  slug: string
  title: string
  description: string
  category: DocCategory
  sections: DocSection[]
}

export interface DocPageContent extends DocPage {
  order: number
}

type DocPageModule = { default: DocPageContent }

const pageModules = import.meta.glob<DocPageModule>('./pages/*.ts', { eager: true })

const orderedDocPageContent = Object.values(pageModules)
  .map((module) => module.default)
  .sort((a, b) => a.order - b.order)

export const DOC_PAGES: DocPage[] = orderedDocPageContent.map(({ order: _order, ...page }) => page)

export const DOC_GROUPS: DocCategory[] = [
  'Start',
  'Core Editing',
  'Creative Tools',
  'Output',
  'Reference',
]

export function getDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug)
}
