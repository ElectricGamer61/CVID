import type { DocPageContent } from '../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Projects',
  description: 'Create, organize, import, export, delete, and restore projects.',
  category: 'Start',
  sections: [
    {
      title: 'Project lifecycle',
      items: [
        'Create a new project from the Projects page.',
        'Edit project name, description, resolution, frame rate, and background color.',
        'Duplicate projects when you need a variation without changing the original.',
      ],
    },
    {
      title: 'Project organization',
      items: [
        'Search, sort, and filter the project list.',
        'Use project thumbnails and metadata to identify recent edits.',
        'Use the active workspace indicator to confirm where projects are stored.',
      ],
    },
    {
      title: 'Trash and bundles',
      items: [
        'Move projects to Trash before permanent deletion.',
        'Restore projects from Trash while they are still available.',
        'Export and import project bundles when moving work between workspaces.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
