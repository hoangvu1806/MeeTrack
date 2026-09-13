import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SpeechResult = {
  part: number; kind: string; start: number; end: number;
  speakerId: string; speaker: string; personId?: string | null; confidence: number;
  text: string; audio: string;
  origin: AudioOrigin;
};
export type CoreRecord = { id: number; start: number; end: number; status: string; processingMs: number; results: SpeechResult[] };
export type CoreStatus = { active: boolean; paused: boolean; device?: string | null; output?: string | null; error?: string | null };
export type IdentityUpdate = { speakerId: string; personId?: string | null; displayName: string };
export type MeetingSummary = { id: string; output: string; createdAt: number; utterances: number; speakers: number };
export type Person = { id: string; name: string; role: string; location: string; voiceReady: boolean; sampleSeconds: number; updatedAt: number };
export type PersonInput = { id?: string; name: string; role: string; location: string };
export type VoiceLevel = { rms: number; peak: number; seconds: number };
export type AudioOrigin = {
  sourceId: string; kind: "microphone" | "system" | "application" | "file" | "unknown";
  label: string; deviceId?: string | null; processId?: number | null;
};
export type CaptureDevice = { id: string; label: string; isDefault: boolean };
export type AudioApplication = { id: string; label: string; processId: number; peak: number };
export type CaptureCatalog = {
  microphones: CaptureDevice[]; outputs: CaptureDevice[]; applications: AudioApplication[];
  applicationCaptureSupported: boolean;
};
export type CaptureSelection = {
  microphoneDevice: string | null; systemAudio: boolean; outputDevice: string | null;
  applications: { processId: number; label: string }[];
};

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
export function listCaptureSources() {
  return invoke<CaptureCatalog>("list_capture_sources");
}
export function startCoreRecording(selection?: CaptureSelection | null) {
  return invoke<CoreStatus>("start_recording", { device: null, selection, profilesPath: null, sttApi: true });
}
export function pauseCoreRecording(paused: boolean) {
  return invoke<CoreStatus>("set_recording_paused", { paused });
}
export function stopCoreRecording() { return invoke<CoreStatus>("stop_recording"); }
export function listPeople() { return invoke<Person[]>("list_people"); }
export function savePerson(person: PersonInput) { return invoke<Person>("save_person", { person }); }
export function deletePerson(id: string) { return invoke<void>("delete_person", { id }); }
export function startVoiceEnrollment(personId: string) { return invoke<void>("start_voice_enrollment", { personId, device: null }); }
export function stopVoiceEnrollment() { return invoke<void>("stop_voice_enrollment"); }
export function uploadVoiceSample(personId: string, filePath: string) {
  return invoke<Person>("upload_voice_sample", { personId, filePath });
}
export function assignSpeakerIdentity(speakerId: string, personId: string) {
  return invoke<IdentityUpdate>("assign_speaker_identity", { speakerId, personId });
}
export function listMeetingTranscripts() { return invoke<MeetingSummary[]>("list_meeting_transcripts"); }
export function loadMeetingTranscript(output: string) { return invoke<CoreRecord[]>("load_meeting_transcript", { output }); }

export async function pickVoiceFile(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    title: "Chọn file âm thanh",
    multiple: false,
    filters: [{
      name: "Audio",
      extensions: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma", "opus"],
    }],
  });
  return result ?? null;
}

export async function subscribeToVoiceEnrollment(onLevel: (level: VoiceLevel) => void, onFinished: (payload: { person?: Person; error?: string }) => void) {
  if (!isTauri()) return () => undefined;
  const unlisten: UnlistenFn[] = await Promise.all([
    listen<VoiceLevel>("voice://level", ({ payload }) => onLevel(payload)),
    listen<{ person?: Person; error?: string }>("voice://enrollment-finished", ({ payload }) => onFinished(payload)),
  ]);
  return () => unlisten.forEach((dispose) => dispose());
}

export async function subscribeToMeetingCore(onRecord: (record: CoreRecord) => void, onStatus: (status: CoreStatus) => void, onIdentity?: (update: IdentityUpdate) => void) {
  if (!isTauri()) return () => undefined;
  const unlisten: UnlistenFn[] = await Promise.all([
    listen<CoreRecord>("meeting://record", ({ payload }) => onRecord(payload)),
    listen<CoreStatus>("meeting://status", ({ payload }) => onStatus(payload)),
    listen<IdentityUpdate>("meeting://identity-updated", ({ payload }) => onIdentity?.(payload)),
  ]);
  return () => unlisten.forEach((dispose) => dispose());
}

export async function subscribeToIdentityUpdates(onIdentity: (update: IdentityUpdate) => void) {
  if (!isTauri()) return () => undefined;
  return listen<IdentityUpdate>("meeting://identity-updated", ({ payload }) => onIdentity(payload));
}
