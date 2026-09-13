use meeting_core_rust::{
    capture::AudioOrigin,
    identity::{cosine, normalize, SpeakerEncoder},
    Record, SpeechResult,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};
use tauri::{AppHandle, Emitter, Manager};

const REGISTERED_THRESHOLD: f32 = 0.66;
const UNKNOWN_THRESHOLD: f32 = 0.66;
const CONTINUITY_THRESHOLD: f32 = 0.60;
const SESSION_MATCH_THRESHOLD: f32 = 0.64;
const CENTROID_UPDATE_THRESHOLD: f32 = 0.72;
const RETROACTIVE_LINK_THRESHOLD: f32 = 0.78;
const UNAMBIGUOUS_MATCH_THRESHOLD: f32 = 0.78;
const MATCH_MARGIN: f32 = 0.05;
const MIN_NEW_IDENTITY_SECONDS: f32 = 1.5;
const CONTINUITY_WINDOW_SECONDS: f32 = 2.5;

#[derive(Clone, Default)]
pub struct IdentityStoreLock(Arc<Mutex<()>>);

impl IdentityStoreLock {
    fn lock(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.0
            .lock()
            .map_err(|_| "Identity store is unavailable".to_owned())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceIdentity {
    id: String,
    person_id: Option<String>,
    centroid: Vec<f32>,
    observations: u32,
    representative_audio: String,
    updated_at: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSpeech {
    pub part: usize,
    pub kind: String,
    pub start: f32,
    pub end: f32,
    pub speaker_id: String,
    pub speaker: String,
    pub person_id: Option<String>,
    pub confidence: f32,
    pub text: String,
    pub audio: String,
    #[serde(default)]
    pub origin: AudioOrigin,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRecord {
    pub id: usize,
    pub start: f32,
    pub end: f32,
    pub status: String,
    pub processing_ms: u128,
    pub results: Vec<ResolvedSpeech>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityUpdate {
    pub speaker_id: String,
    pub person_id: Option<String>,
    pub display_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSummary {
    pub id: String,
    pub output: String,
    pub created_at: u64,
    pub utterances: usize,
    pub speakers: usize,
}

pub struct IdentityResolver {
    app: AppHandle,
    encoder: SpeakerEncoder,
    identities: Vec<VoiceIdentity>,
    people: HashMap<String, String>,
    output: PathBuf,
    transcript: Vec<ResolvedRecord>,
    last_speaker: HashMap<String, (String, f32)>,
    session_speakers: BTreeSet<String>,
    session_anchor: HashMap<String, String>,
}

impl IdentityResolver {
    pub fn load(app: &AppHandle, output: PathBuf) -> Result<Self, String> {
        let mut encoder = SpeakerEncoder::load().map_err(|error| format!("{error:#}"))?;
        let store = app.state::<IdentityStoreLock>();
        let _guard = store.lock()?;
        let mut identities = load_identities(app)?;
        let people = crate::meeting_core::load_people(app)?;
        let names = people
            .iter()
            .map(|person| (person.id.clone(), person.name.clone()))
            .collect();

        for person in people.iter().filter(|person| person.voice_ready) {
            let linked: Vec<_> = identities
                .iter()
                .enumerate()
                .filter_map(|(index, identity)| {
                    (identity.person_id.as_deref() == Some(&person.id)).then_some(index)
                })
                .collect();
            let audio = crate::meeting_core::people_root(app)?
                .join("audio")
                .join(format!("{}.wav", person.id));
            if let Ok(centroid) = encoder.encode_file(&audio) {
                if linked.is_empty() {
                    identities.push(VoiceIdentity {
                        id: next_speaker_id(&identities),
                        person_id: Some(person.id.clone()),
                        centroid,
                        observations: 1,
                        representative_audio: audio.display().to_string(),
                        updated_at: crate::meeting_core::unix_time(),
                    });
                } else {
                    for index in linked {
                        // A registered profile is the canonical reference. Do not
                        // carry forward a centroid polluted by earlier weak matches.
                        identities[index].centroid = centroid.clone();
                        identities[index].representative_audio = audio.display().to_string();
                    }
                }
            }
        }
        save_identities(app, &identities)?;
        Ok(Self {
            app: app.clone(),
            encoder,
            identities,
            people: names,
            output,
            transcript: Vec::new(),
            last_speaker: HashMap::new(),
            session_speakers: BTreeSet::new(),
            session_anchor: HashMap::new(),
        })
    }

    pub fn resolve(&mut self, record: Record) -> Result<ResolvedRecord, String> {
        self.sync_aliases()?;
        let source = record
            .processed
            .map(|processed| processed.results)
            .unwrap_or_default();
        let mut results = Vec::with_capacity(source.len());
        let mut blocked = BTreeSet::new();
        let mut current_part = None;
        for item in source {
            if current_part != Some(item.part) {
                blocked.clear();
                current_part = Some(item.part);
            }
            let is_overlap = item.kind == "overlap";
            let (speaker_id, confidence) =
                self.resolve_speech(&item, is_overlap, is_overlap.then_some(&blocked))?;
            if is_overlap {
                blocked.insert(speaker_id.clone());
            }
            let identity = self
                .identities
                .iter()
                .find(|identity| identity.id == speaker_id)
                .unwrap();
            let person_id = identity.person_id.clone();
            let speaker = person_id
                .as_ref()
                .and_then(|id| self.people.get(id))
                .cloned()
                .unwrap_or_else(|| speaker_id.clone());
            if !is_overlap {
                self.last_speaker.insert(
                    item.origin.source_id.clone(),
                    (speaker_id.clone(), item.end),
                );
            }
            results.push(ResolvedSpeech {
                part: item.part,
                kind: item.kind,
                start: item.start,
                end: item.end,
                speaker_id,
                speaker,
                person_id,
                confidence,
                text: item.text,
                audio: item.audio,
                origin: item.origin,
            });
        }
        let results = collapse_same_speaker_branches(results);
        let resolved = ResolvedRecord {
            id: record.id,
            start: record.start,
            end: record.end,
            status: record.status,
            processing_ms: record.processing_ms,
            results,
        };
        self.transcript.push(resolved.clone());
        self.persist()?;
        Ok(resolved)
    }

    fn sync_aliases(&mut self) -> Result<(), String> {
        let store = self.app.state::<IdentityStoreLock>();
        let _guard = store.lock()?;
        let persisted: HashMap<_, _> = load_identities(&self.app)?
            .into_iter()
            .map(|identity| (identity.id, identity.person_id))
            .collect();
        for identity in &mut self.identities {
            if let Some(person_id) = persisted.get(&identity.id) {
                identity.person_id = person_id.clone();
            }
        }
        self.people = crate::meeting_core::load_people(&self.app)?
            .into_iter()
            .map(|person| (person.id, person.name))
            .collect();
        Ok(())
    }

    fn resolve_speech(
        &mut self,
        item: &SpeechResult,
        is_overlap: bool,
        blocked: Option<&BTreeSet<String>>,
    ) -> Result<(String, f32), String> {
        let reliable_for_identity = is_reliable_identity_sample(item, is_overlap);
        if is_ambiguous_short_overlap(item, is_overlap) {
            return Ok(self.fallback_identity(item, blocked));
        }
        let embedding = match self.encoder.encode_file(Path::new(&item.audio)) {
            Ok(embedding) => embedding,
            Err(_) => return Ok(self.fallback_identity(item, blocked)),
        };

        // A provisional session anchor may be created when the first event is too
        // short or overlapped. Seed it only from a clean, sufficiently long clip.
        if reliable_for_identity {
            if let Some(anchor) = self.session_anchor.get(&item.origin.source_id).cloned() {
                if let Some(identity) = self
                    .identities
                    .iter_mut()
                    .find(|identity| identity.id == anchor && identity.centroid.is_empty())
                {
                    identity.centroid = embedding.clone();
                    identity.observations = 1;
                    identity.representative_audio = item.audio.clone();
                    identity.updated_at = crate::meeting_core::unix_time();
                    self.remember_session_speaker(&anchor, &item.origin.source_id);
                    return Ok((anchor, 1.0));
                }
            }
        }

        let mut candidates = Vec::new();
        for (index, identity) in self.identities.iter().enumerate() {
            if identity.centroid.is_empty() || blocked.is_some_and(|set| set.contains(&identity.id))
            {
                continue;
            }
            let score = cosine(&embedding, &identity.centroid);
            candidates.push((index, score));
        }
        candidates.sort_by(|left, right| right.1.total_cmp(&left.1));
        let best = candidates.first().copied();
        let runner_up = best.and_then(|(best_index, _)| {
            candidates.iter().skip(1).find_map(|(index, score)| {
                distinct_identity(&self.identities[best_index], &self.identities[*index])
                    .then_some(*score)
            })
        });
        let continuity = self
            .last_speaker
            .get(&item.origin.source_id)
            .filter(|(_, end)| item.start - *end <= CONTINUITY_WINDOW_SECONDS)
            .map(|(id, _)| id.as_str());
        let matched = best.and_then(|(index, score)| {
            let identity = &self.identities[index];
            let continuous = continuity == Some(identity.id.as_str());
            let threshold = if continuous {
                CONTINUITY_THRESHOLD
            } else if self.session_speakers.contains(&identity.id) {
                SESSION_MATCH_THRESHOLD
            } else if identity.person_id.is_some() {
                REGISTERED_THRESHOLD
            } else {
                UNKNOWN_THRESHOLD
            };
            confident_match(score, runner_up, threshold, continuous).then_some((index, score))
        });
        if let Some((index, score)) = matched {
            if self.identities[index].person_id.is_none()
                && reliable_for_identity
                && score >= CENTROID_UPDATE_THRESHOLD
            {
                update_centroid(&mut self.identities[index], &embedding);
            }
            self.identities[index].updated_at = crate::meeting_core::unix_time();
            let id = self.identities[index].id.clone();
            self.remember_session_speaker(&id, &item.origin.source_id);
            return Ok((id, score));
        }

        // Overlap stems and very short clips are useful for matching an already
        // established voice, but are not reliable enough to create a new one.
        if !reliable_for_identity {
            return Ok(self.fallback_identity(item, blocked));
        }

        let id = next_speaker_id(&self.identities);
        self.identities.push(VoiceIdentity {
            id: id.clone(),
            person_id: None,
            centroid: embedding,
            observations: 1,
            representative_audio: item.audio.clone(),
            updated_at: crate::meeting_core::unix_time(),
        });
        self.remember_session_speaker(&id, &item.origin.source_id);
        Ok((id, 1.0))
    }

    fn fallback_identity(
        &mut self,
        item: &SpeechResult,
        blocked: Option<&BTreeSet<String>>,
    ) -> (String, f32) {
        if let Some((speaker_id, end)) = self.last_speaker.get(&item.origin.source_id) {
            if item.start - *end <= CONTINUITY_WINDOW_SECONDS
                && !blocked.is_some_and(|set| set.contains(speaker_id))
            {
                return (speaker_id.clone(), 0.0);
            }
        }

        // If overlap separation is uncertain, keep one stable session identity.
        // Blocking is intentionally ignored here: only confident matches may
        // claim a distinct second speaker inside an overlap region.
        if let Some(anchor) = self.session_anchor.get(&item.origin.source_id) {
            return (anchor.clone(), 0.0);
        }

        let id = next_speaker_id(&self.identities);
        self.identities.push(VoiceIdentity {
            id: id.clone(),
            person_id: None,
            centroid: Vec::new(),
            observations: 0,
            representative_audio: item.audio.clone(),
            updated_at: crate::meeting_core::unix_time(),
        });
        self.remember_session_speaker(&id, &item.origin.source_id);
        (id, 0.0)
    }

    fn remember_session_speaker(&mut self, speaker_id: &str, source_id: &str) {
        self.session_speakers.insert(speaker_id.to_owned());
        self.session_anchor
            .entry(source_id.to_owned())
            .or_insert_with(|| speaker_id.to_owned());
    }

    fn persist(&mut self) -> Result<(), String> {
        let store = self.app.state::<IdentityStoreLock>();
        let _guard = store.lock()?;
        let persisted: HashMap<_, _> = load_identities(&self.app)?
            .into_iter()
            .map(|identity| (identity.id, identity.person_id))
            .collect();
        for identity in &mut self.identities {
            if let Some(person_id) = persisted.get(&identity.id) {
                identity.person_id = person_id.clone();
            }
        }
        self.people = crate::meeting_core::load_people(&self.app)?
            .into_iter()
            .map(|person| (person.id, person.name))
            .collect();
        save_identities(&self.app, &self.identities)?;
        fs::write(
            self.output.join("identity-transcript.json"),
            serde_json::to_vec_pretty(&self.transcript).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
    }
}

fn is_reliable_identity_sample(item: &SpeechResult, is_overlap: bool) -> bool {
    !is_overlap && item.end - item.start >= MIN_NEW_IDENTITY_SECONDS
}

fn is_ambiguous_short_overlap(item: &SpeechResult, is_overlap: bool) -> bool {
    is_overlap && item.end - item.start < MIN_NEW_IDENTITY_SECONDS
}

fn confident_match(score: f32, runner_up: Option<f32>, threshold: f32, continuous: bool) -> bool {
    score >= threshold
        && (continuous
            || score >= UNAMBIGUOUS_MATCH_THRESHOLD
            || runner_up.is_none_or(|runner_up| score - runner_up >= MATCH_MARGIN))
}

fn distinct_identity(left: &VoiceIdentity, right: &VoiceIdentity) -> bool {
    !matches!(
        (&left.person_id, &right.person_id),
        (Some(left), Some(right)) if left == right
    )
}

fn collapse_same_speaker_branches(results: Vec<ResolvedSpeech>) -> Vec<ResolvedSpeech> {
    let mut collapsed: Vec<ResolvedSpeech> = Vec::with_capacity(results.len());
    for item in results {
        if let Some(existing) = collapsed
            .iter_mut()
            .find(|existing| existing.part == item.part && existing.speaker_id == item.speaker_id)
        {
            if transcript_quality(&item.text) > transcript_quality(&existing.text) {
                existing.text = item.text;
                existing.audio = item.audio;
                existing.confidence = existing.confidence.max(item.confidence);
            }
            existing.start = existing.start.min(item.start);
            existing.end = existing.end.max(item.end);
            continue;
        }
        collapsed.push(item);
    }
    collapsed
}

fn transcript_quality(text: &str) -> usize {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .count()
}

fn update_centroid(identity: &mut VoiceIdentity, embedding: &[f32]) {
    let weight = 1.0 / (identity.observations.saturating_add(1).min(8) as f32);
    for (centroid, sample) in identity.centroid.iter_mut().zip(embedding) {
        *centroid = *centroid * (1.0 - weight) + *sample * weight;
    }
    normalize(&mut identity.centroid);
    identity.observations = identity.observations.saturating_add(1);
}

#[tauri::command]
pub fn assign_speaker_identity(
    app: AppHandle,
    speaker_id: String,
    person_id: String,
) -> Result<IdentityUpdate, String> {
    let store = app.state::<IdentityStoreLock>();
    let _guard = store.lock()?;
    let mut identities = load_identities(&app)?;
    let target = identities
        .iter()
        .find(|identity| identity.id == speaker_id)
        .ok_or("Không tìm thấy speaker")?;
    let target_centroid = target.centroid.clone();
    let representative_audio = target.representative_audio.clone();
    let people = crate::meeting_core::load_people(&app)?;
    let person = people
        .iter()
        .find(|person| person.id == person_id)
        .ok_or("Không tìm thấy hồ sơ")?;
    let now = crate::meeting_core::unix_time();
    let mut linked = Vec::new();
    for identity in &mut identities {
        let is_target = identity.id == speaker_id;
        let same_voice = !target_centroid.is_empty()
            && !identity.centroid.is_empty()
            && cosine(&target_centroid, &identity.centroid) >= RETROACTIVE_LINK_THRESHOLD;
        if is_target || same_voice {
            identity.person_id = Some(person_id.clone());
            identity.updated_at = now;
            linked.push(identity.id.clone());
        }
    }
    let source = Path::new(&representative_audio);
    if source.is_file() && !person.voice_ready {
        let destination = crate::meeting_core::people_root(&app)?
            .join("audio")
            .join(format!("{person_id}.wav"));
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        if source != destination {
            fs::copy(source, &destination).map_err(|error| error.to_string())?;
        }
        let seconds = meeting_core_rust::decode_audio(&destination)
            .map_err(|error| format!("{error:#}"))?
            .len() as f32
            / 16_000.0;
        crate::meeting_core::mark_identity_voice_ready(&app, &person_id, seconds)?;
    }
    save_identities(&app, &identities)?;
    for linked_id in linked {
        let _ = app.emit(
            "meeting://identity-updated",
            IdentityUpdate {
                speaker_id: linked_id,
                person_id: Some(person_id.clone()),
                display_name: person.name.clone(),
            },
        );
    }
    Ok(IdentityUpdate {
        speaker_id,
        person_id: Some(person_id),
        display_name: person.name.clone(),
    })
}

pub fn notify_person_updated(
    app: &AppHandle,
    person_id: &str,
    display_name: &str,
) -> Result<(), String> {
    let store = app.state::<IdentityStoreLock>();
    let _guard = store.lock()?;
    for identity in load_identities(app)?
        .into_iter()
        .filter(|identity| identity.person_id.as_deref() == Some(person_id))
    {
        let _ = app.emit(
            "meeting://identity-updated",
            IdentityUpdate {
                speaker_id: identity.id,
                person_id: Some(person_id.to_owned()),
                display_name: display_name.to_owned(),
            },
        );
    }
    Ok(())
}

pub fn detach_person(app: &AppHandle, person_id: &str) -> Result<(), String> {
    let store = app.state::<IdentityStoreLock>();
    let _guard = store.lock()?;
    let mut identities = load_identities(app)?;
    let mut detached = Vec::new();
    for identity in identities
        .iter_mut()
        .filter(|identity| identity.person_id.as_deref() == Some(person_id))
    {
        identity.person_id = None;
        detached.push(identity.id.clone());
    }
    save_identities(app, &identities)?;
    for speaker_id in detached {
        let _ = app.emit(
            "meeting://identity-updated",
            IdentityUpdate {
                display_name: speaker_id.clone(),
                speaker_id,
                person_id: None,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub fn list_meeting_transcripts(app: AppHandle) -> Result<Vec<MeetingSummary>, String> {
    let runs = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("runs");
    let mut meetings = Vec::new();
    for entry in fs::read_dir(&runs).into_iter().flatten().flatten() {
        let path = entry.path();
        let transcript = path.join("identity-transcript.json");
        if !transcript.is_file() {
            continue;
        }
        let records: Vec<ResolvedRecord> =
            serde_json::from_slice(&fs::read(transcript).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        let speaker_ids: BTreeSet<_> = records
            .iter()
            .flat_map(|record| record.results.iter().map(|item| &item.speaker_id))
            .collect();
        let id = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let created_at = id
            .strip_prefix("run_")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or_default();
        meetings.push(MeetingSummary {
            id,
            output: path.display().to_string(),
            created_at,
            utterances: records.iter().map(|record| record.results.len()).sum(),
            speakers: speaker_ids.len(),
        });
    }
    meetings.sort_by_key(|meeting| std::cmp::Reverse(meeting.created_at));
    Ok(meetings)
}

#[tauri::command]
pub fn load_meeting_transcript(
    app: AppHandle,
    output: String,
) -> Result<Vec<ResolvedRecord>, String> {
    let runs = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("runs")
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let output = PathBuf::from(output)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !output.starts_with(&runs) {
        return Err("Đường dẫn cuộc họp không hợp lệ".to_owned());
    }
    let mut records: Vec<ResolvedRecord> = serde_json::from_slice(
        &fs::read(output.join("identity-transcript.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    apply_current_names(&app, &mut records)?;
    Ok(records)
}

fn apply_current_names(app: &AppHandle, records: &mut [ResolvedRecord]) -> Result<(), String> {
    let store = app.state::<IdentityStoreLock>();
    let _guard = store.lock()?;
    let identities: HashMap<_, _> = load_identities(app)?
        .into_iter()
        .map(|identity| (identity.id, identity.person_id))
        .collect();
    let people: HashMap<_, _> = crate::meeting_core::load_people(app)?
        .into_iter()
        .map(|person| (person.id, person.name))
        .collect();
    for item in records.iter_mut().flat_map(|record| &mut record.results) {
        item.person_id = identities.get(&item.speaker_id).cloned().flatten();
        item.speaker = item
            .person_id
            .as_ref()
            .and_then(|id| people.get(id))
            .cloned()
            .unwrap_or_else(|| item.speaker_id.clone());
    }
    Ok(())
}

fn identity_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("voice_identities"))
}

fn load_identities(app: &AppHandle) -> Result<Vec<VoiceIdentity>, String> {
    let path = identity_root(app)?.join("identities.json");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn save_identities(app: &AppHandle, identities: &[VoiceIdentity]) -> Result<(), String> {
    let root = identity_root(app)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    fs::write(
        root.join("identities.json"),
        serde_json::to_vec_pretty(identities).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn next_speaker_id(identities: &[VoiceIdentity]) -> String {
    let next = identities
        .iter()
        .filter_map(|identity| identity.id.strip_prefix("speaker_")?.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        + 1;
    format!("speaker_{next:03}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speech(kind: &str, start: f32, end: f32) -> SpeechResult {
        SpeechResult {
            part: 1,
            kind: kind.to_owned(),
            start,
            end,
            speaker: "local".to_owned(),
            text: "test".to_owned(),
            audio: "test.wav".to_owned(),
            origin: AudioOrigin::default(),
        }
    }

    fn resolved(speaker_id: &str, text: &str) -> ResolvedSpeech {
        ResolvedSpeech {
            part: 1,
            kind: "overlap".to_owned(),
            start: 2.31,
            end: 3.05,
            speaker_id: speaker_id.to_owned(),
            speaker: speaker_id.to_owned(),
            person_id: None,
            confidence: 0.0,
            text: text.to_owned(),
            audio: format!("{speaker_id}.wav"),
            origin: AudioOrigin::default(),
        }
    }

    fn identity(id: &str, person_id: Option<&str>) -> VoiceIdentity {
        VoiceIdentity {
            id: id.to_owned(),
            person_id: person_id.map(str::to_owned),
            centroid: vec![1.0],
            observations: 1,
            representative_audio: String::new(),
            updated_at: 0,
        }
    }

    #[test]
    fn weak_session_similarity_cannot_absorb_a_new_voice() {
        assert!(!confident_match(0.55, None, SESSION_MATCH_THRESHOLD, false));
        assert!(!confident_match(0.63, Some(0.40), UNKNOWN_THRESHOLD, false));
    }

    #[test]
    fn ambiguous_candidates_are_not_merged() {
        assert!(!confident_match(0.70, Some(0.68), 0.66, false));
        assert!(confident_match(0.70, Some(0.50), 0.66, false));
    }

    #[test]
    fn strong_continuity_can_keep_the_current_speaker() {
        assert!(confident_match(
            0.61,
            Some(0.60),
            CONTINUITY_THRESHOLD,
            true
        ));
    }

    #[test]
    fn aliases_of_one_registered_person_do_not_compete() {
        assert!(!distinct_identity(
            &identity("speaker_001", Some("person_1")),
            &identity("speaker_002", Some("person_1"))
        ));
        assert!(distinct_identity(
            &identity("speaker_001", Some("person_1")),
            &identity("speaker_003", Some("person_2"))
        ));
    }

    #[test]
    fn short_or_overlapped_clips_cannot_create_an_identity() {
        assert!(!is_reliable_identity_sample(
            &speech("overlap", 2.31, 3.05),
            true
        ));
        assert!(is_ambiguous_short_overlap(
            &speech("overlap", 2.31, 3.05),
            true
        ));
        assert!(!is_reliable_identity_sample(
            &speech("single", 0.0, 1.2),
            false
        ));
        assert!(is_reliable_identity_sample(
            &speech("single", 3.05, 5.04),
            false
        ));
    }

    #[test]
    fn uncertain_overlap_branches_for_one_identity_are_collapsed() {
        let collapsed = collapse_same_speaker_branches(vec![
            resolved("speaker_001", "ALO"),
            resolved("speaker_001", "NGHE NGƯỜI TA NÓI"),
        ]);
        assert_eq!(collapsed.len(), 1);
        assert_eq!(collapsed[0].text, "NGHE NGƯỜI TA NÓI");
    }

    #[test]
    fn confident_distinct_overlap_speakers_are_preserved() {
        let collapsed = collapse_same_speaker_branches(vec![
            resolved("speaker_001", "ALO"),
            resolved("speaker_002", "XIN CHÀO"),
        ]);
        assert_eq!(collapsed.len(), 2);
    }
}
