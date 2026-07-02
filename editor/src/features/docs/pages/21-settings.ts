import type { DocPageContent } from '../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Settings',
  description: 'General, timeline, AI, storage, language, and shortcut preferences.',
  category: 'Reference',
  sections: [
    {
      title: 'General settings',
      items: [
        'Turn Auto-save on or off.',
        'Set the auto-save interval.',
        'Set undo history depth.',
        'Choose the interface language.',
      ],
    },
    {
      title: 'Timeline settings',
      items: [
        'Choose whether Snap is enabled by default.',
        'Show or hide waveforms.',
        'Show or hide filmstrips.',
        'Enable or disable filmstrip extraction during import and display.',
      ],
    },
    {
      title: 'AI and storage settings',
      items: [
        'Set AI caption sample interval.',
        'Choose the default caption style.',
        'Generate missing proxies.',
        'Clear project cache, regenerate thumbnails, or delete proxies.',
        'Inspect, clear, or unload local AI model cache and runtimes.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
