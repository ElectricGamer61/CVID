import type { DocPageContent } from '../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Preview and Playback',
  description: 'Playback controls, frame stepping, zoom, proxy playback, and monitor audio.',
  category: 'Core Editing',
  sections: [
    {
      title: 'Playback controls',
      items: [
        'Play and pause from the preview controls or Space.',
        'Step previous and next frames for frame-accurate checks.',
        'Jump to the start or end of the timeline.',
        'Use timecode for precise position checks.',
      ],
    },
    {
      title: 'Preview view',
      items: [
        'Adjust preview zoom without changing the export canvas.',
        'Use fullscreen when reviewing motion or framing.',
        'Save the current frame as an image when needed.',
        'Use transform, mask, and edit overlays when editing selected items.',
      ],
    },
    {
      title: 'Playback performance',
      items: [
        'Use proxy playback for heavy source media when proxies exist.',
        'Monitor/device volume affects local playback only.',
        'Exports use the project mix, not the monitor volume setting.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
