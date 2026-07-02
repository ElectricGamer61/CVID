import type { DocPageContent } from '../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Basic Timeline Editing',
  description: 'Tracks, clips, selection, trimming, markers, zoom, and undo.',
  category: 'Core Editing',
  sections: [
    {
      title: 'Timeline anatomy',
      items: [
        'Video tracks hold visual items such as video, images, text, shapes, captions, and adjustment layers.',
        'Audio tracks hold audio clips and linked audio from video files.',
        'Markers, in/out points, snapping, and zoom controls sit around the timeline surface.',
      ],
    },
    {
      title: 'Basic edits',
      items: [
        'Drag clips from the Media panel to tracks.',
        'Use selection and linked selection to move video and audio together or separately.',
        'Split clips at the playhead or cursor.',
        'Join adjacent clip sections when they can be rejoined.',
        'Use Delete for removal and Ripple Delete when the gap should close.',
      ],
    },
    {
      title: 'Navigation and safety',
      items: [
        'Toggle snapping when precise alignment is or is not needed.',
        'Add markers for edit notes and timing references.',
        'Set in/out points for range-based workflows.',
        'Use timeline zoom to inspect dense edits without changing clip timing.',
        'Use Undo and Redo for timeline operations.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
