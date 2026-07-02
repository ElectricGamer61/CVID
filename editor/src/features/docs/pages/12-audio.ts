import type { DocPageContent } from '../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Audio Editing',
  description: 'Gain, fades, pitch, EQ, meters, mixer, silence, and filler words.',
  category: 'Creative Tools',
  sections: [
    {
      title: 'Clip audio',
      items: [
        'Adjust clip gain in dB.',
        'Add fade in and fade out.',
        'Adjust semitone and cent pitch changes.',
        'Use per-clip EQ when one clip needs tone shaping.',
      ],
    },
    {
      title: 'Mixing',
      items: [
        'Use track EQ for track-wide tonal changes.',
        'Use track faders and the master bus for mix balance.',
        'Watch stereo meters for clipping and relative levels.',
        'Remember monitor volume affects only local playback.',
      ],
    },
    {
      title: 'Cleanup tools',
      items: [
        'Use Remove silence to find and remove silent ranges.',
        'Use Remove filler words when transcripts and audio confidence support it.',
        'Preview removal ranges before applying destructive edit actions.',
      ],
    },
  ],
} satisfies DocPageContent

export default page
