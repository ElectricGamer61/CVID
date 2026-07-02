import type { DocPageContent } from '../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'Effects and Color',
  description: 'Effects, presets, grading, scopes, LUTs, qualifiers, and adjustment layers.',
  category: 'Creative Tools',
  sections: [
    {
      title: 'Effects workflow',
      items: [
        'Search and add effects from the Effects tab or Properties panel.',
        'Use categories such as Color, Blur, Distort, Stylize, and Keying.',
        'Enable, disable, reorder, remove, and reset effects.',
        'Save and apply presets where available.',
      ],
    },
    {
      title: 'Color workspace',
      items: [
        'Select a clip to grade in the Color workspace.',
        'Use color wheels, curves, levels, exposure, contrast, saturation, and vibrance controls.',
        'Use waveform, vectorscope, and histogram scopes when visible.',
        'Use before, after, and split comparison for grade review.',
      ],
    },
    {
      title: 'Advanced color tools',
      items: [
        'Import .cube LUT files and adjust intensity.',
        'Use Power Window and Secondary Qualifier controls for isolated correction.',
        'Use Chroma Key for green-screen or blue-screen removal.',
        'Use adjustment layers to apply effects or grades to clips below.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
