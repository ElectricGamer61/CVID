import type { DocPageContent } from '../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Keyboard Shortcuts',
  description: 'Default shortcuts, custom bindings, conflicts, presets, and reset.',
  category: 'Reference',
  sections: [
    {
      title: 'Default groups',
      items: [
        'Playback covers transport, frame stepping, and timeline jumps.',
        'Editing covers split, join, delete, ripple delete, freeze frame, link, unlink, and nudging.',
        'Tools covers selection, trim, razor, rate stretch, ripple, slip, and slide.',
        'Markers, Keyframes, Source Monitor, Clipboard, History and UI, and Project groups map to their matching editor surfaces.',
      ],
    },
    {
      title: 'Customize shortcuts',
      items: [
        'Open Keyboard Shortcuts from the toolbar.',
        'Search commands or shortcuts.',
        'Select a command and record a new binding.',
        'Resolve conflicts or overwrite existing bindings intentionally.',
      ],
    },
    {
      title: 'Presets',
      items: [
        'Export a keybind preset for backup or transfer.',
        'Import a preset when moving between browsers or machines.',
        'Reset all shortcuts to restore defaults.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
