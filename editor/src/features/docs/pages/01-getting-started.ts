import type { DocPageContent } from '../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Getting Started',
  description: 'First launch through first export.',
  category: 'Start',
  sections: [
    {
      title: 'What this page covers',
      items: [
        'What FreeCut is: a local-first, browser-based video editor.',
        'Why projects and media stay local instead of being uploaded.',
        'Recommended browsers and why Chromium support matters.',
      ],
    },
    {
      title: 'First edit path',
      items: [
        'Open FreeCut in a supported browser.',
        'Pick a workspace folder with read/write access.',
        'Create a project and choose the project resolution and frame rate.',
        'Import media into the Media panel.',
        'Drag media to the timeline and press Space to preview.',
        'Save the project and export the first video.',
      ],
    },
    {
      title: 'First-run checks',
      items: [
        'Confirm the workspace picker opens.',
        'Confirm imported media appears in the Media panel.',
        'Confirm playback starts from the timeline.',
        'Confirm Export opens and preflight does not show blocking issues.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
