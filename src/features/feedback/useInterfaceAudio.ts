import { useCallback, useEffect, useRef, useState } from "react";

import { AudioRateLimiter } from "./audioRateLimiter";
import { audioVolumeGain } from "../../preferences/preferencesModel";

export type InterfaceSound = "tick" | "action" | "navigate" | "success" | "warning";

const SOUND_INTERVALS: Record<InterfaceSound, number> = {
  tick: 42,
  action: 55,
  navigate: 70,
  success: 90,
  warning: 90,
};

export function useInterfaceAudio(options?: { enabled?: boolean; volume?: number }) {
  const controlled = options?.enabled !== undefined;
  const [enabled, setEnabledState] = useState(() => options?.enabled ??
    window.localStorage.getItem("muller.audio.enabled") !== "false",
  );
  const enabledRef = useRef(enabled);
  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const volumeRef = useRef(options?.volume ?? 65);
  const limitersRef = useRef(
    Object.fromEntries(
      Object.entries(SOUND_INTERVALS).map(([sound, interval]) => [
        sound,
        new AudioRateLimiter(interval),
      ]),
    ) as Record<InterfaceSound, AudioRateLimiter>,
  );

  const setEnabled = useCallback((next: boolean) => {
    let available = next;
    if (next && !contextRef.current) {
      try {
        contextRef.current = new window.AudioContext();
        void contextRef.current.resume();
      } catch {
        available = false;
      }
    }
    enabledRef.current = available;
    setEnabledState(available);
    if (!controlled) window.localStorage.setItem("muller.audio.enabled", String(available));
  }, [controlled]);

  const ensureGraph = useCallback((context: AudioContext) => {
    if (!masterRef.current || !compressorRef.current) {
      const master = context.createGain();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;
      master.connect(compressor);
      compressor.connect(context.destination);
      masterRef.current = master;
      compressorRef.current = compressor;
    }
    masterRef.current.gain.setTargetAtTime(audioVolumeGain(volumeRef.current), context.currentTime, 0.01);
    return masterRef.current;
  }, []);

  useEffect(() => {
    if (options?.enabled === undefined) return;
    enabledRef.current = options.enabled;
    setEnabledState(options.enabled);
  }, [options?.enabled]);

  useEffect(() => {
    volumeRef.current = options?.volume ?? 65;
    const context = contextRef.current;
    if (context) ensureGraph(context);
  }, [ensureGraph, options?.volume]);

  const play = useCallback((sound: InterfaceSound) => {
    if (!enabledRef.current || document.visibilityState !== "visible") return;
    const now = performance.now();
    if (!limitersRef.current[sound].allow(now)) return;

    const AudioContextConstructor = window.AudioContext;
    const context = contextRef.current ?? new AudioContextConstructor();
    contextRef.current = context;
    const master = ensureGraph(context);
    void context.resume();
    const start = context.currentTime + 0.001;

    const tone = (
      frequency: number,
      endFrequency: number,
      offset: number,
      duration: number,
      peak: number,
      type: OscillatorType,
      cutoff?: number,
    ) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start + offset);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + offset + duration);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(peak, start + offset + Math.min(0.008, duration / 3));
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
      if (cutoff) {
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(cutoff, start + offset);
        oscillator.connect(filter);
        filter.connect(gain);
      } else {
        oscillator.connect(gain);
      }
      gain.connect(master);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + duration + 0.004);
    };

    if (sound === "tick") {
      tone(610, 480, 0, 0.026, 0.03, "triangle", 1450);
    } else if (sound === "action") {
      tone(185, 142, 0, 0.058, 0.05, "triangle", 520);
      tone(610, 790, 0.028, 0.07, 0.036, "sine", 1800);
    } else if (sound === "success") {
      tone(700, 940, 0, 0.115, 0.07, "sine", 2200);
    } else if (sound === "warning") {
      tone(250, 205, 0, 0.09, 0.06, "triangle", 800);
    } else {
      tone(470, 540, 0, 0.045, 0.035, "sine", 1600);
    }
  }, [ensureGraph]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const button = (event.target as Element | null)?.closest("button:not(:disabled)");
      const item = (event.target as Element | null)?.closest(
        '[data-selection-item="true"]:not(.is-placeholder)',
      );
      if (button || item) play("action");
    };
    const handlePointerOver = (event: PointerEvent) => {
      const item = (event.target as Element | null)?.closest<HTMLElement>(
        '[data-selection-item="true"]:not(.is-placeholder)',
      );
      if (!item) return;
      const previous = event.relatedTarget instanceof Element
        ? event.relatedTarget.closest('[data-selection-item="true"]')
        : null;
      if (previous === item) return;
      play("tick");
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerover", handlePointerOver, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerover", handlePointerOver, true);
    };
  }, [play]);

  useEffect(
    () => () => {
      if (contextRef.current) void contextRef.current.close();
      contextRef.current = null;
      masterRef.current = null;
      compressorRef.current = null;
    },
    [],
  );

  return { enabled, setEnabled, play };
}
