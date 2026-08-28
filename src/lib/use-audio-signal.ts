"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

export type AudioSignal = {
  level: number;
  bass: number;
  mid: number;
  high: number;
  pitch: number;
  pitchConfidence: number;
  transient: number;
  burst: number;
};

export type AudioSignalRef = MutableRefObject<AudioSignal>;

const SAMPLE_INTERVAL = 1000 / 30;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function averageBand(
  values: Uint8Array<ArrayBuffer>,
  binHz: number,
  lowHz: number,
  highHz: number,
) {
  const start = Math.max(1, Math.floor(lowHz / binHz));
  const end = Math.min(values.length, Math.ceil(highHz / binHz));
  let total = 0;

  for (let index = start; index < end; index += 1) total += values[index];
  return end > start ? total / (end - start) / 255 : 0;
}

function estimatePitch(
  values: Uint8Array<ArrayBuffer>,
  sampleRate: number,
  correlations: Float32Array<ArrayBuffer>,
) {
  const minLag = Math.max(2, Math.floor(sampleRate / 900));
  const maxLag = Math.min(correlations.length - 1, Math.floor(sampleRate / 70), values.length >> 1);
  let bestLag = 0;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let cross = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = values.length - lag;

    for (let index = 0; index < limit; index += 2) {
      const a = (values[index] - 128) / 128;
      const b = (values[index + lag] - 128) / 128;
      cross += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const correlation = cross / Math.sqrt(Math.max(1e-9, energyA * energyB));
    correlations[lag] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (!bestLag || bestCorrelation < 0.58) return { pitch: 0, confidence: 0 };

  for (let lag = minLag + 1; lag < bestLag; lag += 1) {
    const current = correlations[lag];
    if (
      current >= 0.58
      && current >= bestCorrelation * 0.92
      && current > correlations[lag - 1]
      && current >= correlations[lag + 1]
    ) {
      bestLag = lag;
      bestCorrelation = current;
      break;
    }
  }

  const left = correlations[Math.max(minLag, bestLag - 1)];
  const center = correlations[bestLag];
  const right = correlations[Math.min(maxLag, bestLag + 1)];
  const denominator = left - 2 * center + right;
  const offset = Math.abs(denominator) > 1e-5 ? 0.5 * (left - right) / denominator : 0;
  const frequency = sampleRate / (bestLag + Math.max(-0.5, Math.min(0.5, offset)));

  return {
    pitch: clamp01(Math.log2(frequency / 80) / Math.log2(700 / 80)),
    confidence: bestCorrelation,
  };
}

/**
 * Samples the microphone into one mutable object. Consumers read the ref from
 * their own render loop, so audio never causes React to reconcile the app.
 */
export function useAudioSignal(paused: boolean): AudioSignalRef {
  const signalRef = useRef<AudioSignal>({
    level: 0,
    bass: 0,
    mid: 0,
    high: 0,
    pitch: 0,
    pitchConfidence: 0,
    transient: 0,
    burst: 0,
  });
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let lastSample = 0;
    let lastBurst = -Infinity;
    let pitchFrame = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;

    const reset = () => {
      const signal = signalRef.current;
      signal.level = 0;
      signal.bass = 0;
      signal.mid = 0;
      signal.high = 0;
      signal.pitch = 0;
      signal.pitchConfidence = 0;
      signal.transient = 0;
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        context = new AudioContext({ latencyHint: "interactive" });
        if (context.state === "suspended") await context.resume();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.72;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -18;

        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);

        const timeDomain = new Uint8Array(analyser.fftSize);
        const frequency = new Uint8Array(analyser.frequencyBinCount);
        const correlations = new Float32Array(analyser.fftSize >> 1);
        const sampleRate = context.sampleRate;
        const binHz = sampleRate / analyser.fftSize;

        const sample = (now: number) => {
          frame = window.requestAnimationFrame(sample);
          if (document.hidden || now - lastSample < SAMPLE_INTERVAL) return;
          lastSample = now;

          const signal = signalRef.current;
          if (pausedRef.current) {
            signal.level *= 0.7;
            signal.bass *= 0.7;
            signal.mid *= 0.7;
            signal.high *= 0.7;
            signal.pitch *= 0.82;
            signal.pitchConfidence *= 0.7;
            signal.transient *= 0.5;
            return;
          }

          analyser.getByteTimeDomainData(timeDomain);
          analyser.getByteFrequencyData(frequency);

          let squareSum = 0;
          for (let index = 0; index < timeDomain.length; index += 1) {
            const sampleValue = (timeDomain[index] - 128) / 128;
            squareSum += sampleValue * sampleValue;
          }

          const rms = Math.sqrt(squareSum / timeDomain.length);
          const target = clamp01((rms - 0.018) / 0.19);
          const previous = signal.level;
          const response = target > previous ? 0.42 : 0.13;
          signal.level += (target - previous) * response;
          signal.bass += (averageBand(frequency, binHz, 80, 280) - signal.bass) * 0.25;
          signal.mid += (averageBand(frequency, binHz, 280, 2200) - signal.mid) * 0.22;
          signal.high += (averageBand(frequency, binHz, 2200, 8000) - signal.high) * 0.18;
          pitchFrame += 1;
          if (pitchFrame % 2 === 0) {
            const detected = target > 0.05
              ? estimatePitch(timeDomain, sampleRate, correlations)
              : { pitch: 0, confidence: 0 };
            const pitchTarget = detected.confidence > 0 ? detected.pitch : signal.pitch * 0.82;
            signal.pitch += (pitchTarget - signal.pitch) * (detected.confidence > 0 ? 0.24 : 0.12);
            signal.pitchConfidence += (detected.confidence - signal.pitchConfidence) * 0.22;
          }
          signal.transient = Math.max(0, target - previous) * 0.82 + signal.transient * 0.18;

          if (target > 0.42 && signal.transient > 0.15 && now - lastBurst > 4200) {
            signal.burst += 1;
            lastBurst = now;
          }
        };

        frame = window.requestAnimationFrame(sample);
      } catch {
        reset();
      }
    };

    void start();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close();
      reset();
    };
  }, []);

  return signalRef;
}
