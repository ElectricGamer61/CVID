import type { DocPageContent } from '../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: 'Scene Browser and AI Analysis',
  description: 'Analyze media, detect scenes, search captions, meaning, and color.',
  category: 'Creative Tools',
  sections: [
    {
      title: 'Prepare scenes',
      items: [
        'Run Analyze with AI on clips that should become searchable.',
        'Use scene detection to split or index meaningful moments.',
        'Re-analyze media when captions or scene data should refresh.',
      ],
    },
    {
      title: 'Search modes',
      items: [
        'Use Keyword search for exact text matches.',
        'Use Semantic search for meaning-based matches.',
        'Use Color search and palette matching for visual matching.',
        'Limit search scope to a single media item or all analyzed media.',
      ],
    },
    {
      title: 'Use results',
      items: [
        'Review match badges and confidence tiers.',
        'Click a scene to preview it in the source monitor.',
        'Drag scenes back to the timeline when the moment is useful.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
