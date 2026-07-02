import type { DocPageContent } from '../docs-content'

const page = {
  order: 7,
  slug: 'editing-tools',
  title: 'Editing Tools',
  description: 'Selection, razor, trim, ripple, rolling, slip, slide, and rate stretch.',
  category: 'Core Editing',
  sections: [
    {
      title: 'Core tools',
      items: [
        'Selection Tool moves, selects, and arranges clips.',
        'Razor Tool cuts clips directly on the timeline.',
        'Trim Edit Tool adjusts clip edges.',
        'Rate Stretch Tool changes duration by changing playback speed.',
      ],
    },
    {
      title: 'Trim modes',
      items: [
        'Ripple edit changes an edit and shifts later material.',
        'Rolling edit moves the cut between neighboring clips.',
        'Slip edit changes the source frames inside a clip without moving the clip.',
        'Slide edit moves a clip while adjusting adjacent edit points.',
      ],
    },
    {
      title: 'Advanced edit actions',
      items: [
        'Insert freeze frames at the playhead.',
        'Link and unlink clips when audio/video relationships need to change.',
        'Create compound clips for grouped sections.',
        'Use Bento layout to arrange selected visual clips into structured grids.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
