// Seamless preview of the edited timeline, cut by cut, from the 720p proxies.
//
// One <video> element can't jump over a cut without a visible stall and an audible click:
// the seek takes tens of milliseconds and the sound stops mid-wave. So two elements take
// turns. While one plays a piece, the other is already parked a little before the start of
// the next piece and starts rolling silently just before the seam; at the seam the sound
// crossfades in 6 ms (Web Audio) and the pictures swap. Cut edges already sit in silence
// (snap.ts), so the few milliseconds of overlap are never heard.
//
// Seams are timed with timers planned from where the video REALLY is, and re-planned if it
// stalls, never with animation frames: a window behind another one gets as few as 2 frames
// a second (measured), which made the preview play straight through cuts and then replay.
// Animation frames only move the clock on screen.

import type { Segment } from "./timeline";
import { editedDuration, toEdited, toSource } from "./timeline";

const PRE_ROLL = 0.12; // the waiting element starts this long before its piece
const FADE = 0.006;

interface Deck {
  el: HTMLVideoElement;
  gain: GainNode | null;
  seg: number; // segment parked or playing in this deck, -1 = none
}

export class SeamlessPlayer {
  private decks: [Deck, Deck];
  private active = 0;
  private segs: Segment[] = [];
  private ctx: AudioContext | null = null;
  private raf = 0;
  private timers: number[] = [];
  private rolling = false; // the waiting deck has been started for the next seam
  private switching = false; // a seam is being crossed the slow way (no pre-roll)
  private stopAt: number | null = null;
  private restore: { segs: Segment[]; time: number } | null = null; // after an audition
  playing = false;

  onTime: (t: number) => void = () => {};
  onPlayState: (playing: boolean) => void = () => {};

  constructor(a: HTMLVideoElement, b: HTMLVideoElement, private srcFor: (clip: string) => string | null) {
    this.decks = [{ el: a, gain: null, seg: -1 }, { el: b, gain: null, seg: -1 }];
    this.decks.forEach((d, k) => {
      d.el.preload = "auto";
      d.el.playsInline = true;
      d.el.crossOrigin = "anonymous";
      // A stall (buffering) pushes the seam back; plan again once it really plays.
      d.el.addEventListener("waiting", () => { if (k === this.active) this.clearTimers(); });
      d.el.addEventListener("playing", () => { if (k === this.active && this.playing) this.schedule(); });
      // Animation frames drive the clock smoothly, but an occluded window gets none at all
      // (measured: 0 in 3 s), so the media clock's own ~4 Hz tick keeps it honest.
      d.el.addEventListener("timeupdate", () => { if (k === this.active && this.playing) this.onTime(this.time); });
    });
    this.show(0);
  }

  destroy() {
    this.pause();
    cancelAnimationFrame(this.raf);
    for (const d of this.decks) { d.el.removeAttribute("src"); d.el.load(); }
    void this.ctx?.close();
  }

  private get deck() { return this.decks[this.active]; }
  private get spare() { return this.decks[1 - this.active]; }

  /** Edited time right now. */
  get time(): number {
    const d = this.deck, s = this.segs[d.seg];
    return s ? s.offset + Math.max(0, d.el.currentTime - s.start) : 0;
  }

  /** The edit changed. Stay on the same moment of the same clip if it survived. */
  setSegments(segs: Segment[]) {
    const d = this.deck, old = this.segs[d.seg];
    const at = old ? toEdited(segs, old.clip, d.el.currentTime) : 0;
    this.segs = segs;
    this.restore = null; // a real edit replaces whatever was being auditioned
    this.spare.seg = -1;
    void this.seek(at ?? 0);
  }

  // ---------------------------------------------------------- plumbing

  private audio() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      for (const d of this.decks) {
        const src = this.ctx.createMediaElementSource(d.el);
        d.gain = this.ctx.createGain();
        src.connect(d.gain).connect(this.ctx.destination);
      }
    } catch {
      this.ctx = null; // fall back to plain element volume: still works, may click
    }
  }

  private setGain(d: Deck, v: number) {
    if (d.gain && this.ctx) {
      const g = d.gain.gain, now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + FADE);
    } else {
      d.el.volume = v;
    }
  }

  private show(i: number) {
    this.decks.forEach((d, k) => d.el.classList.toggle("on", k === i));
  }

  private clearTimers() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  private later(seconds: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, Math.max(0, seconds * 1000)));
  }

  /** Put segment `i` into deck `d`, `lead` seconds before its start. */
  private park(d: Deck, i: number, lead: number): Promise<void> {
    d.seg = i;
    const s = this.segs[i];
    const src = s && this.srcFor(s.clip);
    if (!s || !src) return Promise.resolve();
    const url = new URL(src, location.href).href;
    if (d.el.src !== url) d.el.src = url;
    const target = Math.max(0, s.start - lead);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; d.el.removeEventListener("seeked", finish); resolve(); };
      if (Math.abs(d.el.currentTime - target) < 0.002 && d.el.readyState >= 2) return finish();
      d.el.addEventListener("seeked", finish);
      d.el.currentTime = target;
      setTimeout(finish, 1500); // never hang the player on a seek that doesn't report back
    });
  }

  // ---------------------------------------------------------- transport

  async seek(t: number, keepPlaying = this.playing) {
    const loc = toSource(this.segs, t);
    this.clearTimers();
    this.rolling = false;
    this.switching = false;
    if (!loc) { this.onTime(0); return; }
    const was = this.playing;
    if (was) { this.deck.el.pause(); this.spare.el.pause(); }
    const d = this.deck;
    d.seg = loc.seg;
    const src = this.srcFor(loc.clip);
    if (src) {
      const url = new URL(src, location.href).href;
      if (d.el.src !== url) d.el.src = url;
      d.el.currentTime = loc.time;
    }
    this.setGain(d, 1);
    this.setGain(this.spare, 0);
    this.show(this.active);
    void this.park(this.spare, loc.seg + 1, PRE_ROLL);
    this.onTime(t);
    if (was && keepPlaying) {
      this.playing = false; // play() flips it back and plans the first seam
      await this.play();
    }
  }

  async play(from?: number, until?: number) {
    this.audio();
    await this.ctx?.resume();
    if (from !== undefined) await this.seek(from, false);
    else if (this.time >= editedDuration(this.segs) - 0.05) await this.seek(0, false); // from the top
    this.stopAt = until ?? null;
    if (!this.segs[this.deck.seg]) return;
    this.playing = true;
    this.onPlayState(true);
    this.setGain(this.deck, 1);
    try { await this.deck.el.play(); } catch { /* refused: the 'playing' event never comes */ }
    this.schedule();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Play [from, to] of a DIFFERENT edit (say, with one suggestion applied), then come back
   *  to the real edit, exactly where we were. "Hear it before you cut it." */
  async audition(segs: Segment[], from: number, to: number) {
    const back = this.restore ?? { segs: this.segs, time: this.time };
    this.restore = null;
    this.pause();
    this.segs = segs;
    this.spare.seg = -1;
    this.restore = back;
    await this.play(Math.max(0, from), to);
  }

  private endAudition() {
    const r = this.restore;
    if (!r) return;
    this.restore = null;
    this.segs = r.segs;
    this.spare.seg = -1;
    void this.seek(r.time, false);
  }

  pause() {
    this.clearTimers();
    this.rolling = false;
    this.switching = false;
    this.stopAt = null;
    for (const d of this.decks) d.el.pause();
    cancelAnimationFrame(this.raf);
    if (this.playing) { this.playing = false; this.onPlayState(false); }
    if (this.restore) this.endAudition();
    else if (this.spare.seg >= 0) void this.park(this.spare, this.spare.seg, PRE_ROLL);
  }

  toggle() { return this.playing ? this.pause() : this.play(); }

  // ---------------------------------------------------------- seams

  /** Plan the next seam (and the stop point, if any) from where the video really is. */
  private schedule() {
    this.clearTimers();
    if (!this.playing || this.switching) return;
    const d = this.deck, s = this.segs[d.seg];
    if (!s) return;
    if (!this.srcFor(s.clip)) { this.advance(); return; } // not ready yet: skip the piece
    const left = s.end - d.el.currentTime;
    if (this.stopAt !== null) {
      const untilStop = this.stopAt - this.time;
      if (untilStop <= left) { this.later(untilStop, () => this.pause()); return; }
    }
    if (left <= 0.004) { this.advance(); return; }
    if (d.seg + 1 < this.segs.length) this.later(left - PRE_ROLL - 0.02, () => this.roll());
    this.later(left - 0.002, () => this.seam());
  }

  /** Start the waiting deck, silently, just before the seam. */
  private roll() {
    const d = this.deck, next = this.spare;
    if (!this.playing || next.seg !== d.seg + 1 || next.el.readyState < 2) return;
    this.rolling = true;
    this.setGain(next, 0);
    void next.el.play().catch(() => {});
  }

  private seam() {
    if (!this.playing) return;
    const d = this.deck, s = this.segs[d.seg];
    if (s && s.end - d.el.currentTime > 0.03) { this.schedule(); return; } // stalled: not there yet
    this.advance();
  }

  private advance() {
    this.clearTimers();
    const cur = this.deck;
    const i = cur.seg + 1;
    if (i >= this.segs.length) { this.pause(); return; }
    const next = this.spare;
    const prerolled = this.rolling && next.seg === i;
    this.rolling = false;
    const go = () => {
      this.switching = false;
      if (!this.playing) return;
      this.setGain(next, 1);
      this.setGain(cur, 0);
      this.active = 1 - this.active;
      this.show(this.active);
      if (next.el.paused) void next.el.play().catch(() => {});
      setTimeout(() => { cur.el.pause(); void this.park(cur, i + 1, PRE_ROLL); }, 30);
      this.schedule();
    };
    if (prerolled) { go(); return; }
    // The waiting deck never got its run-up (a very short piece, or it wasn't parked yet):
    // it sits PRE_ROLL early, inside the cut, so put it exactly on its start first. This
    // costs a tiny pause, never a blip of removed audio.
    this.switching = true;
    cur.el.pause();
    void this.park(next, i, 0).then(go);
  }

  private tick = () => {
    if (!this.playing) return;
    this.onTime(this.time);
    // Safety net only: if timers were held back (a hidden tab), don't play into a cut.
    const d = this.deck, s = this.segs[d.seg];
    if (s && !this.switching && d.el.currentTime > s.end + 0.08) this.advance();
    this.raf = requestAnimationFrame(this.tick);
  };
}
