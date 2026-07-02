import type { DocPageContent } from '../docs-content'

const page = {
  order: 10,
  slug: 'properties',
  title: 'Clip Properties',
  description: 'Transform, crop, opacity, blend, playback, fades, text, shape, and mixed values.',
  category: 'Core Editing',
  sections: [
    {
      title: 'Selection behavior',
      items: [
        'Select one clip for detailed editing.',
        'Select multiple clips to change shared properties at once.',
        'Mixed values indicate selected clips do not currently share the same setting.',
      ],
    },
    {
      title: 'Common controls',
      items: [
        'Use Transform for position, size, rotation, and anchor.',
        'Use Crop controls for edge crops and softness.',
        'Use Opacity and Blend modes for compositing.',
        'Use Playback controls for speed and related clip timing.',
      ],
    },
    {
      title: 'Type-specific controls',
      items: [
        'Use Audio controls for gain, fades, pitch, and equalizer.',
        'Use Text controls for content, font, color, alignment, background, and animation.',
        'Use Shape controls for shape type, path, fill, stroke, mask, and feather.',
        'Use Subtitle controls for transcript cues and caption styling.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
