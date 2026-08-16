/** The "I don't have a script yet" path on Create.
 *
 *  CVideo doesn't write your script — the AI you already use does. You answer a few
 *  plain questions, we hand you ONE prompt to paste into Claude/ChatGPT, and it asks for
 *  the script in exactly the shape `backend/app/intake.py:parse_script` reads
 *  (`HOOK:` / `BEAT` / `Spoken:` / `On-screen:` / `Shot:` / `Proof:`). The reply pastes
 *  straight back into the box on Create and becomes your scenes — no reformatting.
 *
 *  Keep this a pure string builder: it's the only part of the flow that can be tested
 *  without a browser, and the format is a contract with the parser.
 */

export type ScriptAnswers = {
  topic: string;      // what the video is about
  audience: string;   // who it's for
  hook: string;       // the angle / first line, if they already have one
  notes: string;      // anything that must be in it (a number, a product, a story)
  scenes: number;     // how many BEAT blocks to ask for
};

export const EMPTY_ANSWERS: ScriptAnswers = { topic: "", audience: "", hook: "", notes: "", scenes: 5 };

/** The questions Create asks, in order. Driving the form off this keeps the copy and the
 *  prompt in one place (and lets a test assert the topic is the only required one). */
export const SCRIPT_QUESTIONS: { key: keyof ScriptAnswers; label: string; placeholder: string; required?: boolean; long?: boolean }[] = [
  { key: "topic", label: "What's the video about?", placeholder: "e.g. hidden sugar in pasta sauce", required: true },
  { key: "audience", label: "Who's it for?", placeholder: "e.g. parents doing the weekly shop" },
  { key: "hook", label: "Got a first line or angle?", placeholder: "e.g. this “healthy” sauce has more sugar than a donut" },
  { key: "notes", label: "Anything that has to be in it?", placeholder: "a number, a product, a story beat…", long: true },
];

/** How many scenes we'll ask for — clamped so a typo can't ask an AI for 900 beats. */
export const MIN_SCENES = 2;
export const MAX_SCENES = 12;
export const clampScenes = (n: number): number =>
  Math.min(MAX_SCENES, Math.max(MIN_SCENES, Math.round(Number.isFinite(n) ? n : EMPTY_ANSWERS.scenes)));

export const canBuildPrompt = (a: ScriptAnswers): boolean => a.topic.trim().length > 0;

/** The prompt the user copies. Dead simple on purpose: context lines they filled in, then
 *  the exact output format, then a couple of rules that keep the script short enough to say. */
export function buildScriptPrompt(a: ScriptAnswers): string {
  const n = clampScenes(a.scenes);
  const ctx = [
    ["What it's about", a.topic],
    ["Who it's for", a.audience],
    ["Angle or first line I want", a.hook],
    ["Must include", a.notes],
  ].filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v.trim()}`);

  return [
    "Write me a short vertical video script (TikTok / Reels / Shorts).",
    "",
    ...ctx,
    "",
    "Reply with the script ONLY — no intro, no notes, no markdown formatting.",
    "Use exactly this layout:",
    "",
    "HOOK: the one line that stops the scroll",
    "",
    "BEAT",
    "Spoken: what I say out loud in this scene",
    "On-screen: SHORT BIG TEXT (optional)",
    "Shot: what to film for this scene",
    "Proof: yes   (only on a scene that states a real number or fact)",
    "",
    "BEAT",
    "Spoken: …",
    "",
    `Give me ${n} BEAT blocks.`,
    "Keep every spoken line short enough to say in one breath.",
    "Keep the whole thing under 45 seconds of talking.",
  ].join("\n");
}
