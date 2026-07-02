import type { DocPageContent } from '../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Editor Layout and Navigation',
  description: 'The toolbar, panels, preview, timeline, and workspace layout.',
  category: 'Start',
  sections: [
    {
      title: 'Primary surfaces',
      items: [
        'Use the Editor toolbar for Back to Projects, workspace tabs, project specs, Settings, Keyboard Shortcuts, Save, and Export.',
        'Use the Media sidebar for Media, Text, Shapes, Effects, Transitions, and AI.',
        'Use the Preview monitor to inspect the current frame, overlays, masks, scopes, and playback state.',
        'Use the Timeline for tracks, clips, markers, in/out points, snapping, trim tools, and zoom.',
      ],
    },
    {
      title: 'Workspaces',
      items: [
        'Use Edit for cutting, arranging, text, shapes, effects, transitions, preview, and clip properties.',
        'Use Color for grading-focused work, color tools, and scopes.',
        'Switch workspaces from the center toolbar tabs.',
      ],
    },
    {
      title: 'Supporting panels',
      items: [
        'Use Properties to edit the selected clip or selected clips.',
        'Use the Keyframe editor for animation timing and curves.',
        'Use Settings for general, timeline, AI, storage, and language preferences.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
