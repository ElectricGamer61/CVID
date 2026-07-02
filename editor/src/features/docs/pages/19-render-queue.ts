import type { DocPageContent } from '../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: 'Render Queue',
  description: 'Queue exports, split ranges, pause, resume, retry, and manage saved exports.',
  category: 'Output',
  sections: [
    {
      title: 'Queue jobs',
      items: [
        'Add the current export settings to the render queue.',
        'Queue the whole project or the current range.',
        'Split work into one segment per marker.',
        'Split long work into timed chunks.',
      ],
    },
    {
      title: 'Manage queue state',
      items: [
        'Queued exports render one at a time.',
        'Pause and resume the queue.',
        'Move jobs up or down when order matters.',
        'Cancel, remove, retry, or clear finished jobs.',
      ],
    },
    {
      title: 'Saved exports',
      items: [
        'Use the Saved exports tab to review completed files.',
        'Download, refresh, or delete saved export records.',
        'Find exported files in the project local folder inside the workspace.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
