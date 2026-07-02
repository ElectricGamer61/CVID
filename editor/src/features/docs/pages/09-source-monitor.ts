import type { DocPageContent } from '../docs-content'

const page = {
  order: 9,
  slug: 'source-monitor',
  title: 'Source Monitor Workflow',
  description: 'Preview source media, mark in/out, insert, and overwrite.',
  category: 'Core Editing',
  sections: [
    {
      title: 'Open and preview source media',
      items: [
        'Open media from the Media panel or Media info.',
        'Preview the source before placing it on the timeline.',
        'Use source playback controls independently of the timeline preview.',
      ],
    },
    {
      title: 'Mark ranges',
      items: [
        'Set Mark In and Mark Out to define the source range.',
        'Clear In/Out when the full source should be available again.',
        'Use shortcuts I, O, and Alt+X when working keyboard-first.',
      ],
    },
    {
      title: 'Edit to timeline',
      items: [
        'Use Insert edit to place the marked range and push later material.',
        'Use Overwrite edit to replace timeline material at the destination.',
        'Use patch destinations to control which timeline tracks receive source media.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
