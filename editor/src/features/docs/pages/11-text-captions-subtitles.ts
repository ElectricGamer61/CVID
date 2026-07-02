import type { DocPageContent } from '../docs-content'

const page = {
  order: 11,
  slug: 'text-captions-subtitles',
  title: 'Text, Captions, and Subtitles',
  description: 'Text clips, transcripts, generated captions, cue editing, and embedded subtitles.',
  category: 'Creative Tools',
  sections: [
    {
      title: 'Text clips',
      items: [
        'Add text from the Text tab.',
        'Choose single-span or multi-span text presets.',
        'Adjust font, size, color, alignment, background, padding, radius, and animation.',
      ],
    },
    {
      title: 'Captions',
      items: [
        'Generate transcripts from media when speech text is needed.',
        'Create caption text from transcripts or AI caption workflows.',
        'Edit cue start, end, content, and style from the Properties panel.',
        'Apply caption style presets for consistent caption appearance.',
      ],
    },
    {
      title: 'Embedded subtitles',
      items: [
        'Scan files for embedded subtitle tracks.',
        'Choose a subtitle track from the Embedded subtitles dialog.',
        'Insert available cues into the timeline.',
        'Embed transcript captions as subtitle tracks during export when the container supports it.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
