import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SpeechResult = {
  part: number; kind: string; start: number; end: number;
  speaker: string; text: string; audio: string;
};
export type CoreRecord = { id: number; path: string; start: number; end: number; status: string; processing_ms: number; processed?: { results: SpeechResult[] } | null };
export type CoreStatus = { active: boolean; paused: boolean; device?: string | null; output?: string | null; error?: string | null };
export type Person = { id: string; name: string; role: string; location: string; voiceReady: boolean; sampleSeconds: number; updatedAt: number };
export type PersonInput = { id?: string; name: string; role: string; location: string };
export type VoiceLevel = { rms: number; peak: number; seconds: number };

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
export function startCoreRecording() {
  return invoke<CoreStatus>("start_recording", { device: null, profilesPath: null, sttApi: false });
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

export async function subscribeToMeetingCore(onRecord: (record: CoreRecord) => void, onStatus: (status: CoreStatus) => void) {
  if (!isTauri()) return () => undefined;
  const unlisten: UnlistenFn[] = await Promise.all([
    listen<CoreRecord>("meeting://record", ({ payload }) => onRecord(payload)),
    listen<CoreStatus>("meeting://status", ({ payload }) => onStatus(payload)),
  ]);
  return () => unlisten.forEach((dispose) => dispose());
}
