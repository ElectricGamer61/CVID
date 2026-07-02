import type { DocPageContent } from '../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Keyframe Animation',
  description: 'Animate transform, crop, text, effects, masks, and audio properties.',
  category: 'Creative Tools',
  sections: [
    {
      title: 'Keyframe basics',
      items: [
        'Add keyframes to supported properties.',
        'Clear selected property keyframes or all keyframes on selected clips.',
        'Use Auto-keyframe mode when property changes should create animation automatically.',
      ],
    },
    {
      title: 'Editor views',
      items: [
        'Use Graph view for curves and handles.',
        'Use Dopesheet view for timing and spacing.',
        'Use Split view when both timing and curve shape matter.',
        'Switch between local and global frame displays.',
      ],
    },
    {
      title: 'Editing animation',
      items: [
        'Use easing presets such as Hold, Linear, Ease In, Ease Out, and Ease In/Out.',
        'Copy, cut, paste, and move selected keyframes.',
        'Use marquee selection for groups of keyframes.',
        'Filter parameters to focus on active animated properties.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
