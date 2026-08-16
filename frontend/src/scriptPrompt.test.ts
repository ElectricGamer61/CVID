// The "I don't have a script yet" prompt builder. The format it asks for is a contract with
// `backend/app/intake.py:parse_script` — if these assertions change, that parser has to agree.
import { describe, expect, it } from "vitest";

import {
  buildScriptPrompt, canBuildPrompt, clampScenes, EMPTY_ANSWERS, MAX_SCENES, MIN_SCENES,
  ScriptAnswers, SCRIPT_QUESTIONS,
} from "./scriptPrompt";

const answers = (over: Partial<ScriptAnswers> = {}): ScriptAnswers => ({ ...EMPTY_ANSWERS, ...over });

describe("the questions Create asks", () => {
  it("asks a handful of plain questions, and only needs the topic", () => {
    expect(SCRIPT_QUESTIONS.length).toBeLessThanOrEqual(4);
    expect(SCRIPT_QUESTIONS.filter((q) => q.required).map((q) => q.key)).toEqual(["topic"]);
  });

  it("won't build a prompt with nothing to write about", () => {
    expect(canBuildPrompt(answers())).toBe(false);
    expect(canBuildPrompt(answers({ topic: "   " }))).toBe(false);
    expect(canBuildPrompt(answers({ topic: "sugar in sauces" }))).toBe(true);
  });
});

describe("buildScriptPrompt", () => {
  const p = buildScriptPrompt(answers({ topic: "hidden sugar in sauces" }));

  it("asks for the exact format CVideo parses", () => {
    // The labels intake.parse_script reads. A prompt that asks for anything else means
    // pasting the reply back gives you one giant scene.
    expect(p).toContain("HOOK:");
    expect(p).toContain("\nBEAT\n");
    expect(p).toContain("Spoken:");
    expect(p).toContain("On-screen:");
    expect(p).toContain("Shot:");
    expect(p).toContain("Proof:");
  });

  it("tells the AI to reply with the script and nothing else", () => {
    expect(p).toMatch(/script ONLY/);
    expect(p.toLowerCase()).toContain("no markdown");
  });

  it("carries the answers through, and leaves out the ones you skipped", () => {
    const full = buildScriptPrompt(answers({
      topic: "sugar in sauces", audience: "parents", hook: "this one is worse", notes: "12g per jar",
    }));
    expect(full).toContain("What it's about: sugar in sauces");
    expect(full).toContain("Who it's for: parents");
    expect(full).toContain("Angle or first line I want: this one is worse");
    expect(full).toContain("Must include: 12g per jar");
    // Skipped answers don't leave a dangling empty label behind.
    expect(p).not.toContain("Who it's for:");
    expect(p).not.toContain("Must include:");
  });

  it("asks for the number of scenes you picked", () => {
    expect(buildScriptPrompt(answers({ topic: "x", scenes: 3 }))).toContain("Give me 3 BEAT blocks.");
  });

  it("never asks an AI for an absurd number of scenes", () => {
    expect(clampScenes(0)).toBe(MIN_SCENES);
    expect(clampScenes(900)).toBe(MAX_SCENES);
    expect(clampScenes(NaN)).toBe(EMPTY_ANSWERS.scenes);
    expect(clampScenes(4.4)).toBe(4);
    expect(buildScriptPrompt(answers({ topic: "x", scenes: 999 }))).toContain(`Give me ${MAX_SCENES} BEAT blocks.`);
  });

  it("promises nothing about clips being placed for you", () => {
    // The old footage bin claimed clips you talk in get placed automatically. Nothing
    // in this flow auto-places anything, so nothing here may say it does.
    expect(p.toLowerCase()).not.toContain("automatic");
  });
});
