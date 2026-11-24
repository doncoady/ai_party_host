#!/usr/bin/env python3
"""
Renders the game-show sound effect set used by the party host.

Every effect is synthesized from scratch (numpy + a tiny DSP toolkit) so the
assets are reproducible, license-free, and tweakable. The script writes OGG
(Vorbis) plus MP3 fallbacks into public/audio/sfx via ffmpeg.

    python3 scripts/generate-sfx.py            # render everything
    python3 scripts/generate-sfx.py correct    # render one effect

Requires: python3, numpy, scipy, ffmpeg on PATH.
"""
from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
from scipy import signal

SR = 44100
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "audio" / "sfx"
rng = np.random.default_rng(1985)


# --------------------------------------------------------------------------- #
# DSP helpers
# --------------------------------------------------------------------------- #
def t(seconds: float) -> np.ndarray:
    return np.arange(int(SR * seconds)) / SR


def env_adsr(n: int, a: float, d: float, s: float, r: float) -> np.ndarray:
    a_n, d_n, r_n = (int(SR * x) for x in (a, d, r))
    s_n = max(0, n - a_n - d_n - r_n)
    parts = [
        np.linspace(0, 1, a_n, endpoint=False),
        np.linspace(1, s, d_n, endpoint=False),
        np.full(s_n, s),
        np.linspace(s, 0, r_n),
    ]
    env = np.concatenate(parts)
    return env[:n] if len(env) >= n else np.pad(env, (0, n - len(env)))


def env_exp(n: int, tau: float, hold: float = 0.0) -> np.ndarray:
    x = np.arange(n) / SR
    return np.where(x < hold, 1.0, np.exp(-(x - hold) / tau))


def osc(kind: str, freq, length: float, phase: float = 0.0) -> np.ndarray:
    tt = t(length)
    f = np.broadcast_to(np.asarray(freq, dtype=float), tt.shape)
    ph = 2 * np.pi * np.cumsum(f) / SR + phase
    if kind == "sine":
        return np.sin(ph)
    if kind == "saw":
        return signal.sawtooth(ph)
    if kind == "square":
        return signal.square(ph)
    if kind == "tri":
        return signal.sawtooth(ph, 0.5)
    raise ValueError(kind)


def noise(length: float) -> np.ndarray:
    return rng.standard_normal(int(SR * length))


def lowpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    b, a = signal.butter(order, min(cutoff, SR / 2 - 1) / (SR / 2), "low")
    return signal.lfilter(b, a, x)


def highpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    b, a = signal.butter(order, max(cutoff, 10) / (SR / 2), "high")
    return signal.lfilter(b, a, x)


def bandpass(x: np.ndarray, low: float, high: float, order: int = 2) -> np.ndarray:
    b, a = signal.butter(order, [low / (SR / 2), min(high, SR / 2 - 1) / (SR / 2)], "band")
    return signal.lfilter(b, a, x)


def sweep_bandpass(x: np.ndarray, f_start: float, f_end: float, q: float = 2.0) -> np.ndarray:
    """Time-varying band-pass (for whooshes). Processed in short blocks."""
    out = np.zeros_like(x)
    block = 512
    for i in range(0, len(x), block):
        p = i / len(x)
        fc = f_start * (f_end / f_start) ** p
        bw = fc / q
        lo, hi = max(20, fc - bw / 2), min(SR / 2 - 100, fc + bw / 2)
        b, a = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], "band")
        out[i : i + block] = signal.lfilter(b, a, x[i : i + block])
    return out


def reverb(x: np.ndarray, mix: float = 0.25, decay: float = 0.5, tail: float = 0.8) -> np.ndarray:
    """Cheap Schroeder reverb: 4 parallel feedback combs + 2 series allpasses."""
    n = len(x) + int(SR * tail)
    dry = np.pad(x, (0, n - len(x)))
    wet = np.zeros(n)
    for delay_ms in (29.7, 37.1, 41.1, 43.7):
        d = int(SR * delay_ms / 1000)
        a = np.zeros(d + 1)
        a[0], a[d] = 1.0, -decay
        wet += signal.lfilter([1.0], a, dry)
    wet /= 4
    for delay_ms, g in ((5.0, 0.7), (1.7, 0.7)):
        d = int(SR * delay_ms / 1000)
        b = np.zeros(d + 1)
        a = np.zeros(d + 1)
        b[0], b[d] = -g, 1.0
        a[0], a[d] = 1.0, -g
        wet = signal.lfilter(b, a, wet)
    return dry * (1 - mix) + wet * mix


def mix(*layers: tuple[np.ndarray, float, float]) -> np.ndarray:
    """Mix (signal, gain, start_seconds) tuples into one buffer."""
    n = max(int(SR * start) + len(sig) for sig, _, start in layers)
    out = np.zeros(n)
    for sig, gain, start in layers:
        s = int(SR * start)
        out[s : s + len(sig)] += sig * gain
    return out


def soft_clip(x: np.ndarray, drive: float = 1.0) -> np.ndarray:
    return np.tanh(x * drive) / math.tanh(drive)


def finalize(x: np.ndarray, peak_db: float = -1.5, fade_ms: float = 4.0) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    x = highpass(x, 30, 1)
    f = int(SR * fade_ms / 1000)
    if f > 0 and len(x) > 2 * f:
        x[:f] *= np.linspace(0, 1, f)
        x[-f:] *= np.linspace(1, 0, f)
    peak = np.max(np.abs(x)) or 1.0
    return x / peak * (10 ** (peak_db / 20))


def note(name: str) -> float:
    names = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
    key, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[key] + (octave - 4) * 12 - 9) / 12)


def synth_brass(freq: float, length: float, detune: float = 0.4) -> np.ndarray:
    """80s poly-synth brass: 3 detuned saws through a decaying low-pass."""
    layers = sum(osc("saw", freq * (1 + c * detune / 100), length, rng.uniform(0, 6.28)) for c in (-1, 0, 1)) / 3
    n = len(layers)
    out = np.zeros(n)
    block = 256
    env = env_adsr(n, 0.01, 0.18, 0.7, 0.18)
    for i in range(0, n, block):
        p = i / n
        cutoff = 900 + 5200 * math.exp(-p * 4)
        out[i : i + block] = lowpass(layers[i : i + block], cutoff)
    return out * env


def compress(x: np.ndarray, threshold: float = 0.5, ratio: float = 3.0) -> np.ndarray:
    """Simple RMS compressor for punch (applied before finalize)."""
    env = np.abs(signal.lfilter([1 - 0.999], [1, -0.999], np.abs(x)))
    gain = np.where(env > threshold, (threshold + (env - threshold) / ratio) / np.maximum(env, 1e-6), 1.0)
    return x * gain


def crowd_voice(length: float, pitch_from: float, pitch_to: float, vowel: tuple[float, float, float]) -> np.ndarray:
    """A crowd of voices: detuned saw voices through formant band-passes (vowel = three formant centre frequencies)."""
    n = int(SR * length)
    glide = np.geomspace(pitch_from, pitch_to, n)
    voices = np.zeros(n)
    for i in range(14):
        detune = 1 + rng.uniform(-0.06, 0.06)
        voices += osc("saw", glide * detune, length, rng.uniform(0, 6.28)) * rng.uniform(0.5, 1.0)
    voices /= 14
    out = np.zeros(n)
    for fc, gain in zip(vowel, (1.0, 0.6, 0.3)):
        out += bandpass(voices, fc * 0.8, fc * 1.25) * gain
    breath = bandpass(noise(length), 800, 4000) * 0.08
    return (out + breath) * env_adsr(n, 0.12, 0.2, 0.8, 0.35)


def slide_brass(f_from: float, f_to: float, length: float) -> np.ndarray:
    """Trombone-ish tone sliding between two pitches."""
    n = int(SR * length)
    glide = np.geomspace(f_from, f_to, n)
    vib = glide * (1 + 0.008 * osc("sine", 5.5, length))
    tone = osc("saw", vib, length) * 0.7 + osc("square", vib / 2, length) * 0.2 + osc("sine", vib, length) * 0.3
    return lowpass(tone, 2200, 2) * env_adsr(n, 0.03, 0.1, 0.85, 0.12)


def bell(freq: float, length: float, bright: float = 1.0) -> np.ndarray:
    partials = ((1.0, 1.0, 0.9), (2.0, 0.55, 0.5), (2.99, 0.3 * bright, 0.32), (4.2, 0.16 * bright, 0.22), (5.6, 0.08 * bright, 0.15))
    out = np.zeros(int(SR * length))
    for ratio, amp, tau in partials:
        out += osc("sine", freq * ratio, length) * amp * env_exp(len(out), tau)
    return out


# --------------------------------------------------------------------------- #
# Effects
# --------------------------------------------------------------------------- #
def sfx_correct() -> np.ndarray:
    """Game-show 'correct': cash-register ka-ching, a bright bell, and a major synth stab."""
    # ka-ching: metallic bell + coin clatter
    ching = mix((bell(note("E7"), 0.8, bright=1.2), 0.6, 0.0), (bell(note("B6"), 0.9, bright=1.0), 0.5, 0.0))
    coins = np.zeros(int(SR * 0.5))
    for t0 in np.linspace(0.02, 0.32, 9):
        n = int(SR * 0.05)
        coin = bell(rng.uniform(5000, 8500), 0.05, bright=0.3) * env_exp(n, 0.012)
        s0 = int(SR * t0)
        coins[s0 : s0 + n] += coin * rng.uniform(0.3, 0.7)
    drawer = bandpass(noise(0.12), 200, 900) * env_exp(int(SR * 0.12), 0.03)
    # major stab
    stab = sum(synth_brass(note(nm), 0.55) for nm in ("C4", "E4", "G4", "C5")) / 2
    body = mix((drawer, 0.5, 0.0), (ching, 0.8, 0.04), (coins, 0.7, 0.06), (stab, 0.45, 0.05))
    return finalize(reverb(compress(body, 0.5, 3), 0.22, 0.55, 0.6))


def sfx_wrong() -> np.ndarray:
    """Strike buzzer with a sub thump, then the crowd goes 'awww'."""
    length = 0.7
    f = 98.0
    wobble = 1 + 0.01 * osc("sine", 16, length)
    core = osc("square", f * wobble, length) * 0.6 + osc("saw", f * 2.01 * wobble, length) * 0.35 + osc("square", f * 1.5, length) * 0.2
    core = lowpass(core, 1400, 3) * env_adsr(int(SR * length), 0.006, 0.05, 0.85, 0.08)
    thump = osc("sine", np.geomspace(120, 45, int(SR * 0.3)), 0.3) * env_exp(int(SR * 0.3), 0.09)
    aww = crowd_voice(1.1, 220, 150, (700, 1100, 2500))
    aww = aww / (np.max(np.abs(aww)) or 1.0)
    body = mix((soft_clip(core, 2.2), 0.8, 0.0), (thump, 0.8, 0.0), (aww, 1.1, 0.5))
    return finalize(reverb(body, 0.25, 0.55, 0.6))


def sfx_timeout() -> np.ndarray:
    """The sad trombone: wah, wah, wah, waaaah (sliding down on the last note)."""
    steps = [(note("Bb3"), note("Bb3"), 0.3), (note("A3"), note("A3"), 0.3), (note("Ab3"), note("Ab3"), 0.3), (note("G3"), note("E3"), 0.95)]
    layers = []
    start = 0.0
    for f_from, f_to, length in steps:
        layers.append((slide_brass(f_from, f_to, length), 0.8, start))
        start += length * 0.9
    return finalize(reverb(mix(*layers), 0.2, 0.5, 0.5))


def sfx_lock_in() -> np.ndarray:
    """'Locked in': a mechanical click followed by a small bell ding."""
    click = bandpass(noise(0.03), 1500, 6000) * env_exp(int(SR * 0.03), 0.005)
    ding = bell(note("A6"), 0.45, bright=0.8)
    return finalize(mix((click, 0.6, 0.0), (ding, 0.8, 0.03)))


def sfx_buzz_in() -> np.ndarray:
    """'Your turn' arcade bloop: a quick pitch-up blip with a sparkle on top."""
    n = int(SR * 0.22)
    sweep = np.geomspace(note("E5"), note("B5"), n)
    a = (osc("square", sweep, 0.22) * 0.5 + osc("tri", sweep, 0.22) * 0.5) * env_adsr(n, 0.004, 0.06, 0.5, 0.1)
    b = bell(note("E7"), 0.3, bright=0.5)
    return finalize(mix((lowpass(a, 6000), 0.8, 0.0), (b, 0.35, 0.06)))


def sfx_tick() -> np.ndarray:
    """Clock tick for the final seconds."""
    n = int(SR * 0.06)
    body = bandpass(noise(0.06), 1800, 5200) * env_exp(n, 0.006)
    knock = osc("sine", 1100, 0.06) * env_exp(n, 0.004)
    return finalize(mix((body, 0.7, 0.0), (knock, 0.6, 0.0)), peak_db=-3)


def sfx_timer_warning() -> np.ndarray:
    """Urgent alarm: three quick beeps, rising, with a nervous vibrato."""
    layers = []
    for i, nm in enumerate(("A5", "A5", "C6")):
        vib = note(nm) * (1 + 0.01 * osc("sine", 12, 0.1))
        beep = osc("square", vib, 0.1) * 0.5 + osc("sine", vib * 2, 0.1) * 0.5
        layers.append((lowpass(beep, 6000) * env_adsr(int(SR * 0.1), 0.004, 0.02, 0.8, 0.04), 0.9, i * 0.14))
    return finalize(mix(*layers))


def sfx_reveal_drumroll() -> np.ndarray:
    """Accelerating snare roll into a crash."""
    length = 1.35
    out = np.zeros(int(SR * length))
    time = 0.0
    gap = 0.085
    while time < length - 0.3:
        n = int(SR * 0.09)
        hit = bandpass(noise(0.09), 600, 5000) * env_exp(n, 0.018)
        body = osc("sine", 185, 0.09) * env_exp(n, 0.012)
        s = int(SR * time)
        vel = 0.5 + 0.5 * (time / length)
        out[s : s + n] += (hit * 0.7 + body * 0.5) * vel
        time += gap
        gap = max(0.032, gap * 0.93)
    crash_n = int(SR * 0.9)
    crash = highpass(noise(0.9), 2500) * env_exp(crash_n, 0.22) + bandpass(noise(0.9), 300, 1200) * env_exp(crash_n, 0.12)
    kick = osc("sine", np.geomspace(150, 45, crash_n), 0.9) * env_exp(crash_n, 0.14)
    full = mix((out, 0.8, 0.0), (crash, 0.8, length - 0.3), (kick, 0.9, length - 0.3))
    return finalize(soft_clip(full, 1.4), peak_db=-5.0)


def sfx_applause() -> np.ndarray:
    """Crowd applause: many randomly timed clap impulses through a room."""
    length = 2.6
    n = int(SR * length)
    out = np.zeros(n)
    for _ in range(520):
        start = rng.uniform(0, length - 0.06)
        amp = rng.uniform(0.3, 1.0) * (1.0 if start < length * 0.7 else (length - start) / (length * 0.3))
        clap_n = int(SR * 0.03)
        clap = bandpass(noise(0.03), 800, 4500) * env_exp(clap_n, rng.uniform(0.003, 0.009))
        s = int(SR * start)
        out[s : s + clap_n] += clap * amp
    crowd = bandpass(noise(length), 200, 1800) * 0.12
    crowd *= np.interp(np.arange(n), [0, n * 0.2, n * 0.7, n], [0.2, 1, 0.9, 0])
    cheer = crowd_voice(2.0, 260, 330, (650, 1200, 2600)) * 0.35
    whistle = osc("sine", np.geomspace(1800, 2600, int(SR * 0.5)), 0.5) * env_adsr(int(SR * 0.5), 0.05, 0.1, 0.6, 0.2)
    full = mix((out * 0.9 + crowd, 1.0, 0.0), (cheer, 1.0, 0.15), (whistle, 0.12, 0.4))
    return finalize(reverb(full, 0.35, 0.62, 0.6))


def sfx_fanfare() -> np.ndarray:
    """Game-over fanfare: synth brass triad hits into a big sustained chord."""
    chords = [
        (("C4", "E4", "G4"), 0.17, 0.0),
        (("C4", "E4", "G4"), 0.17, 0.2),
        (("C4", "E4", "G4"), 0.17, 0.4),
        (("F4", "A4", "C5", "F5"), 0.32, 0.62),
        (("G4", "B4", "D5", "G5"), 0.32, 0.98),
        (("C4", "E4", "G4", "C5", "E5"), 1.4, 1.34),
    ]
    layers = []
    for names, length, start in chords:
        for nm in names:
            layers.append((synth_brass(note(nm), length), 0.32 / math.sqrt(len(names)), start))
    bass = osc("saw", note("C2"), 1.5) * env_adsr(int(SR * 1.5), 0.01, 0.2, 0.7, 0.4)
    layers.append((lowpass(bass, 500), 0.35, 1.34))
    for t0 in (0.0, 0.2, 0.4, 1.34):
        n = int(SR * 0.6)
        timpani = osc("sine", np.geomspace(110, 70, n), 0.6) * env_exp(n, 0.18) + bandpass(noise(0.6), 100, 600) * env_exp(n, 0.03) * 0.5
        layers.append((timpani, 0.6, t0))
    crash_n = int(SR * 1.2)
    crash = highpass(noise(1.2), 3000) * env_exp(crash_n, 0.3)
    layers.append((crash, 0.25, 1.34))
    return finalize(reverb(compress(soft_clip(mix(*layers), 1.3), 0.5, 3), 0.3, 0.6, 0.9), peak_db=-3.0)


def sfx_intro_sting() -> np.ndarray:
    """80s show-open sting: rising synth arpeggio then a brass chord + snare."""
    arp = ["C4", "E4", "G4", "C5", "E5", "G5"]
    layers = []
    for i, nm in enumerate(arp):
        s = osc("square", note(nm), 0.16) * 0.4 + osc("saw", note(nm) * 1.005, 0.16) * 0.6
        s = lowpass(s, 3500) * env_adsr(len(s), 0.004, 0.05, 0.6, 0.06)
        layers.append((s, 0.35, i * 0.075))
    for nm in ("C4", "G4", "C5", "E5"):
        layers.append((synth_brass(note(nm), 1.0), 0.22, 0.48))
    snare_n = int(SR * 0.3)
    snare = bandpass(noise(0.3), 400, 6000) * env_exp(snare_n, 0.05) + osc("sine", 190, 0.3) * env_exp(snare_n, 0.03)
    layers.append((snare, 0.7, 0.48))
    return finalize(reverb(soft_clip(mix(*layers), 1.2), 0.28, 0.6, 0.8))


def sfx_theme_set() -> np.ndarray:
    """Sparkle: fast high bell arpeggio."""
    layers = []
    for i, nm in enumerate(("C6", "E6", "G6", "C7")):
        layers.append((bell(note(nm), 0.55, bright=0.6), 0.5, i * 0.055))
    return finalize(reverb(mix(*layers), 0.3, 0.55, 0.5))


def sfx_player_join() -> np.ndarray:
    """Friendly two-note pop."""
    a = osc("sine", note("G5"), 0.14) * env_exp(int(SR * 0.14), 0.05)
    b = osc("sine", note("C6"), 0.2) * env_exp(int(SR * 0.2), 0.07)
    return finalize(mix((a, 0.9, 0.0), (b, 0.9, 0.1)))


def sfx_game_start() -> np.ndarray:
    """Riser into a hit: noise + pitch sweep, then a punchy chord."""
    rise_len = 0.9
    rise_n = int(SR * rise_len)
    riser = sweep_bandpass(noise(rise_len), 300, 6000, 1.5) * np.linspace(0.1, 1.0, rise_n) ** 2
    tone = osc("saw", np.geomspace(note("C3"), note("C5"), rise_n), rise_len) * np.linspace(0.0, 0.6, rise_n)
    hit = sum(synth_brass(note(nm), 0.8) for nm in ("C3", "G3", "C4", "E4")) / 2
    kick = osc("sine", np.geomspace(160, 40, int(SR * 0.5)), 0.5) * env_exp(int(SR * 0.5), 0.1)
    full = mix((riser, 0.5, 0.0), (lowpass(tone, 2500), 0.4, 0.0), (hit, 0.7, rise_len), (kick, 0.9, rise_len))
    return finalize(reverb(soft_clip(full, 1.3), 0.25, 0.55, 0.6), peak_db=-3.0)


def sfx_clip_whoosh() -> np.ndarray:
    """Tape-rewind style whoosh that precedes a media clue."""
    length = 0.7
    n = int(SR * length)
    body = sweep_bandpass(noise(length), 4000, 400, 1.2) * env_adsr(n, 0.08, 0.2, 0.6, 0.25)
    squeal = osc("sine", np.geomspace(2600, 700, n), length) * env_adsr(n, 0.1, 0.2, 0.4, 0.3)
    return finalize(mix((body, 0.9, 0.0), (squeal, 0.15, 0.0)))


def sfx_transition() -> np.ndarray:
    """Short swipe for phase changes."""
    length = 0.38
    n = int(SR * length)
    body = sweep_bandpass(noise(length), 900, 5000, 1.6) * env_adsr(n, 0.03, 0.1, 0.5, 0.2)
    ping = osc("sine", note("E6"), 0.3) * env_exp(int(SR * 0.3), 0.06)
    return finalize(mix((body, 0.7, 0.0), (ping, 0.35, 0.12)))


def sfx_streak() -> np.ndarray:
    """Combo! Fast rising arpeggio with glitter and a final bright stab."""
    layers = []
    for i, nm in enumerate(("C5", "E5", "G5", "C6", "E6", "G6")):
        s = osc("square", note(nm), 0.2) * 0.5 + osc("sine", note(nm) * 2, 0.2) * 0.5
        layers.append((lowpass(s, 6000) * env_exp(int(SR * 0.2), 0.07), 0.5, i * 0.055))
    for i in range(10):
        layers.append((bell(rng.uniform(3000, 7000), 0.25, bright=0.3), 0.12, 0.2 + i * 0.04))
    stab = sum(synth_brass(note(nm), 0.5) for nm in ("C5", "E5", "G5")) / 2
    layers.append((stab, 0.4, 0.36))
    return finalize(reverb(mix(*layers), 0.25, 0.5, 0.5))


def sfx_scoreboard() -> np.ndarray:
    """Scoreboard reveal: typewriter-like counter clicks ending in a chime."""
    layers = []
    for i in range(8):
        n = int(SR * 0.04)
        click = bandpass(noise(0.04), 1500, 6000) * env_exp(n, 0.005)
        layers.append((click, 0.6, i * 0.055))
    layers.append((bell(note("G5"), 0.6), 0.7, 0.5))
    return finalize(reverb(mix(*layers), 0.2, 0.5, 0.4))


EFFECTS = {
    "correct": sfx_correct,
    "wrong": sfx_wrong,
    "timeout": sfx_timeout,
    "lock-in": sfx_lock_in,
    "buzz-in": sfx_buzz_in,
    "tick": sfx_tick,
    "timer-warning": sfx_timer_warning,
    "reveal-drumroll": sfx_reveal_drumroll,
    "applause": sfx_applause,
    "fanfare": sfx_fanfare,
    "intro-sting": sfx_intro_sting,
    "theme-set": sfx_theme_set,
    "player-join": sfx_player_join,
    "game-start": sfx_game_start,
    "clip-whoosh": sfx_clip_whoosh,
    "transition": sfx_transition,
    "streak": sfx_streak,
    "scoreboard": sfx_scoreboard,
}


def write_wav(path: Path, samples: np.ndarray) -> None:
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())


def encode(wav_path: Path, name: str) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to encode sound effects")
    targets = [
        (OUT_DIR / f"{name}.ogg", ["-c:a", "libvorbis", "-q:a", "5"]),
        (OUT_DIR / f"{name}.mp3", ["-c:a", "libmp3lame", "-q:a", "3"]),
    ]
    for target, codec in targets:
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav_path), *codec, str(target)],
            check=True,
        )


def main(argv: list[str]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wanted = argv or list(EFFECTS)
    unknown = [name for name in wanted if name not in EFFECTS]
    if unknown:
        raise SystemExit(f"Unknown effect(s): {', '.join(unknown)}. Known: {', '.join(EFFECTS)}")
    with tempfile.TemporaryDirectory() as tmp:
        for name in wanted:
            samples = EFFECTS[name]()
            wav_path = Path(tmp) / f"{name}.wav"
            write_wav(wav_path, samples)
            encode(wav_path, name)
            print(f"rendered {name:16s} {len(samples) / SR:5.2f}s")


if __name__ == "__main__":
    main(sys.argv[1:])
