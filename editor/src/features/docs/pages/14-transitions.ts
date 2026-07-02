import type { DocPageContent } from '../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: 'Transitions',
  description: 'Apply transitions, adjust duration, placement, easing, direction, and handles.',
  category: 'Creative Tools',
  sections: [
    {
      title: 'Applying transitions',
      items: [
        'Drag a transition onto a valid cut in the timeline.',
        'Click to apply when the selected clip and neighboring cut support it.',
        'Use transition categories such as Basic, Dissolve, Motion, Wipe, Slide, Flip, Mask, Iris, Shape, Light, and Chromatic.',
      ],
    },
    {
      title: 'Transition controls',
      items: [
        'Adjust duration from the Transition section.',
        'Set placement to Left, Center, or Right around the cut.',
        'Choose easing and direction when the transition supports it.',
        'Resize transitions directly on the timeline when available.',
      ],
    },
    {
      title: 'Common blockers',
      items: [
        'A transition needs a valid visual cut.',
        'Some placements require enough source handle on one or both sides.',
        'Click-to-apply may be unavailable until a compatible clip or cut is selected.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
