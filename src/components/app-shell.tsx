"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, AudioLines, Bell, BookOpen, BookOpenCheck, BrainCircuit, Briefcase,
  CalendarCheck, CalendarDays, Check, ChevronDown, ChevronRight, CircleCheck,
  Clock3, Cpu, Database, Ellipsis, FileAudio, FolderOpen, HardDrive,
  Languages, LayoutDashboard, ListFilter, MapPin, Mic, Moon, PanelLeftClose, Pencil, PenLine,
  PanelLeftOpen, PanelsTopLeft, Pause, Play, Radio, Search, Settings,
  ShieldCheck, ShieldAlert, SlidersHorizontal, Sparkles, Square, Sun, Trash2, Upload, User,
  UserPlus, UserRoundCheck, UserRoundPlus,
  Users, Volume2, X,
} from "lucide";
import { dictionaries, languages, type Locale, type TranslationKey } from "@/lib/i18n";
import { deletePerson, isTauri, listPeople, pauseCoreRecording, pickVoiceFile, savePerson, startCoreRecording, startVoiceEnrollment, stopCoreRecording, stopVoiceEnrollment, subscribeToMeetingCore, subscribeToVoiceEnrollment, uploadVoiceSample, type Person, type SpeechResult } from "@/lib/meeting-core";
import { useAudioSignal } from "@/lib/use-audio-signal";
import LavaLamp from "./origin/lava-lamp";
import { UiIcon } from "./ui-icon";
import { WindowTitlebar } from "./window-titlebar";

type Tab = "overview" | "meetings" | "people" | "knowledge" | "settings";
type Theme = "light" | "dark" | "system";

const navItems = [
  { id: "overview", icon: LayoutDashboard, activeIcon: PanelsTopLeft },
  { id: "meetings", icon: CalendarDays, activeIcon: CalendarCheck },
  { id: "people", icon: Users, activeIcon: UserRoundCheck },
  { id: "knowledge", icon: BrainCircuit, activeIcon: BookOpenCheck },
  { id: "settings", icon: Settings, activeIcon: SlidersHorizontal },
] as const;

const sessions = [
  { title: "Sprint planning · W34", meta: "09:30 · 48 min", people: ["NT", "LH", "+3"], state: "ready" as const, color: "emerald" },
  { title: "Architecture review", meta: "Fri · 1 hr 12 min", people: ["DQ", "MK", "+2"], state: "review" as const, color: "cyan" },
  { title: "Product weekly", meta: "20 Aug · 36 min", people: ["AN", "HT"], state: "finalized" as const, color: "violet" },
];

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button className={`switch${checked ? " is-on" : ""}`} type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange}>
      <span><UiIcon icon={checked ? Check : Square} size={11} strokeWidth={2.3} /></span>
    </button>
  );
}

export function AppShell() {
  const [locale, setLocale] = useState<Locale>("vi");
  const [theme, setTheme] = useState<Theme>("system");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [compact, setCompact] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<SpeechResult[]>([]);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [backgroundProcessing, setBackgroundProcessing] = useState(true);
  const [notifications, setNotifications] = useState(true);

  // Lifted from PeopleView so AppShell can guard tab switches
  const [voiceEnrolling, setVoiceEnrolling] = useState(false);
  // Tab-switch warning
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);

  const t = useCallback((key: TranslationKey) => dictionaries[locale][key], [locale]);

  const warnCopy = useMemo(() => ({
    vi: { title: "Đang ghi âm", body: "Bạn đang thu âm. Chuyển tab sẽ dừng phiên ghi hiện tại.", stay: "Tiếp tục ghi", leave: "Dừng và chuyển" },
    en: { title: "Recording in progress", body: "Switching tabs will stop the current recording session.", stay: "Keep recording", leave: "Stop & switch" },
    zh: { title: "正在录音", body: "切换标签页将停止当前录制。", stay: "继续录制", leave: "停止并切换" },
    ja: { title: "録音中", body: "タブを切り替えると録音が停止されます。", stay: "録音を続ける", leave: "停止して切替" },
    ko: { title: "녹음 중", body: "탭을 전환하면 녹음이 중지됩니다.", stay: "계속 녹음", leave: "중지 후 전환" },
  })[locale], [locale]);

  const trySetTab = useCallback((tab: Tab) => {
    if (tab === activeTab) return;
    if (recording || voiceEnrolling) {
      setPendingTab(tab);
      return;
    }
    setActiveTab(tab);
  }, [activeTab, recording, voiceEnrolling]);

  const confirmTabSwitch = useCallback(async () => {
    if (recording) {
      if (isTauri()) { try { await stopCoreRecording(); } catch {} }
      setRecording(false); setPaused(false); setElapsed(0);
    }
    if (voiceEnrolling) {
      if (isTauri()) { try { await stopVoiceEnrollment(); } catch {} }
      setVoiceEnrolling(false);
    }
    if (pendingTab) { setActiveTab(pendingTab); setPendingTab(null); }
  }, [recording, voiceEnrolling, pendingTab]);

  const cancelTabSwitch = useCallback(() => { setPendingTab(null); }, []);

  useEffect(() => {
    const storedLocale = localStorage.getItem("meetrack-locale") as Locale | null;
    const storedTheme = localStorage.getItem("meetrack-theme") as Theme | null;
    queueMicrotask(() => {
      if (storedLocale && languages.some((item) => item.code === storedLocale)) setLocale(storedLocale);
      if (storedTheme && ["light", "dark", "system"].includes(storedTheme)) setTheme(storedTheme);
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    localStorage.setItem("meetrack-theme", theme);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("meetrack-locale", locale);
  }, [locale]);

  useEffect(() => {
    if (!recording || paused) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [paused, recording]);

  useEffect(() => {
    let dispose: () => void = () => undefined;
    subscribeToMeetingCore(
      (record) => {
        const results = record.processed?.results ?? [];
        if (results.length) setTranscript((current) => [...current, ...results]);
      },
      (status) => {
        setPaused(status.paused);
        if (status.error) setCoreError(status.error);
        if (!status.active) setRecording(false);
      },
    ).then((unlisten) => { dispose = unlisten; });
    return () => dispose();
  }, []);

  const beginRecording = async () => {
    setCoreError(null);
    setTranscript([]);
    setElapsed(0);
    if (!isTauri()) { setRecording(true); return; }
    try {
      await startCoreRecording();
      setRecording(true);
    } catch (error) {
      setCoreError(String(error));
      setRecording(true);
    }
  };

  const stopRecording = async () => {
    if (isTauri()) {
      try { await stopCoreRecording(); } catch (error) { setCoreError(String(error)); }
    }
    setRecording(false);
    setPaused(false);
    setElapsed(0);
  };

  const togglePaused = async () => {
    const next = !paused;
    if (isTauri()) {
      try { await pauseCoreRecording(next); } catch (error) { setCoreError(String(error)); return; }
    }
    setPaused(next);
  };

  const title = useMemo(() => {
    if (activeTab === "settings") return [t("settingsTitle"), t("settingsSubtitle")];
    if (activeTab === "meetings") return [t("meetingsTitle"), t("meetingsSubtitle")];
    if (activeTab === "people") return [t("peopleTitle"), t("peopleSubtitle")];
    if (activeTab === "knowledge") return [t("knowledgeTitle"), t("knowledgeSubtitle")];
    return [t("today"), t("todaySubtitle")];
  }, [activeTab, t]);

  return (
    <div className="desktop-shell">
      <WindowTitlebar t={t} />
      <div className={`app-frame${compact ? " is-compact" : ""}`}>
        <aside className="sidebar glass-panel">
          <button className="workspace-switcher" type="button" title={t("workspace")}>
            <span className="workspace-avatar"><img src="/logo.png" alt="" /></span>
            <span className="workspace-copy"><strong>MeeTrack</strong><small>{t("workspace")}</small></span>
            <UiIcon icon={ChevronDown} hoverIcon={ChevronRight} size={14} className="workspace-chevron" />
          </button>

          <nav className="main-navigation" aria-label="Main navigation">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button className={`nav-item${active ? " is-active" : ""}`} key={item.id} type="button" title={t(item.id)} onClick={() => trySetTab(item.id)}>
                  <span className="nav-icon-wrap"><UiIcon icon={active ? item.activeIcon : item.icon} hoverIcon={item.activeIcon} size={18} strokeWidth={active ? 2 : 1.75} /></span>
                  <span className="nav-label">{t(item.id)}</span>
                  {item.id === "meetings" ? <small className="nav-count">12</small> : null}
                </button>
              );
            })}
          </nav>

          <div className="sidebar-spacer" />
          <div className="storage-widget">
            <span className="storage-icon"><UiIcon icon={HardDrive} size={16} /></span>
            <div className="storage-content"><div><span>{t("storage")}</span><strong>18%</strong></div><div className="storage-track"><span /></div><small>9.2 GB · {t("used")}</small></div>
          </div>
          <button className="sidebar-collapse" type="button" aria-label={compact ? t("expandSidebar") : t("compactSidebar")} title={compact ? t("expandSidebar") : t("compactSidebar")} onClick={() => setCompact((value) => !value)}>
            <UiIcon icon={compact ? PanelLeftOpen : PanelLeftClose} hoverIcon={compact ? PanelLeftClose : PanelLeftOpen} size={17} /><span>{compact ? "" : t("compactSidebar")}</span>
          </button>
        </aside>

        <main className="content-area">
          <header className="content-toolbar">
            <div className="page-title"><h1>{title[0]}</h1><p>{title[1]}</p></div>
            <div className="toolbar-actions">
              <label className="search-box"><UiIcon icon={Search} size={16} /><input aria-label={t("search")} placeholder={t("search")} /></label>
              <button className="icon-button" type="button" aria-label="Notifications"><UiIcon icon={Bell} hoverIcon={Radio} size={17} /></button>
              <button className="record-button" type="button" onClick={beginRecording}><span><UiIcon icon={Mic} hoverIcon={AudioLines} size={16} strokeWidth={2} /></span>{t("newMeeting")}</button>
            </div>
          </header>

          <div className="view-stage">
            {recording ? (
              <RecordingView t={t} elapsed={elapsed} paused={paused} togglePaused={togglePaused} stop={stopRecording} transcript={transcript} coreError={coreError} />
            ) : activeTab === "overview" ? (
              <OverviewView t={t} start={beginRecording} />
            ) : activeTab === "people" ? (
              <PeopleView locale={locale} onEnrollingChange={setVoiceEnrolling} />
            ) : activeTab === "settings" ? (
              <SettingsView t={t} locale={locale} setLocale={setLocale} theme={theme} setTheme={setTheme} autoConfirm={autoConfirm} setAutoConfirm={setAutoConfirm} backgroundProcessing={backgroundProcessing} setBackgroundProcessing={setBackgroundProcessing} notifications={notifications} setNotifications={setNotifications} />
            ) : (
              <CollectionView tab={activeTab} t={t} />
            )}
          </div>
        </main>
      </div>

      {/* Tab switch warning modal */}
      {pendingTab ? (
        <div className="tab-warning-overlay" onClick={cancelTabSwitch}>
          <div className="tab-warning-modal glass-card" onClick={(e) => e.stopPropagation()}>
            <span className="tab-warning-icon"><UiIcon icon={AlertTriangle} size={22} strokeWidth={1.8} /></span>
            <strong>{warnCopy.title}</strong>
            <p>{warnCopy.body}</p>
            <div className="tab-warning-actions">
              <button type="button" className="tab-warning-stay" onClick={cancelTabSwitch}><UiIcon icon={Mic} hoverIcon={AudioLines} size={14} />{warnCopy.stay}</button>
              <button type="button" className="tab-warning-leave" onClick={() => void confirmTabSwitch()}><UiIcon icon={Square} size={12} strokeWidth={2.4} />{warnCopy.leave}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OverviewView({ t, start }: { t: (key: TranslationKey) => string; start: () => void }) {
  return (
    <div className="overview-view">
      <section className="hero-panel glass-card">
        <div className="hero-copy"><span className="hero-kicker"><i />{t("localPrivacy")}</span><h2>{t("startRecording")}</h2><div className="hero-meta"><span><UiIcon icon={Mic} size={14} />{t("microphone")}</span><span><UiIcon icon={Volume2} size={14} />{t("systemAudio")}</span></div></div>
        <button className="hero-record" type="button" aria-label={t("startRecording")} onClick={start}><span className="hero-record-core"><UiIcon icon={Mic} hoverIcon={AudioLines} size={24} strokeWidth={1.8} /></span></button>
      </section>

      <section className="metric-grid">
        <Metric icon={Clock3} value="4h 18m" label={t("meetingTime")} note={t("thisWeek")} />
        <Metric icon={CircleCheck} value="14" label={t("actions")} note={`5 ${t("pending")}`} />
        <Metric icon={Sparkles} value="9" label={t("decisions")} note={t("sourced")} />
      </section>

      <section className="recent-card glass-card">
        <div className="section-heading"><div><h2>{t("recent")}</h2><span>3</span></div><button type="button">{t("seeAll")}<UiIcon icon={ArrowUpRight} hoverIcon={ChevronRight} size={14} /></button></div>
        <div className="session-list">
          {sessions.map((session) => (
            <article className="session-row" key={session.title}>
              <div className={`session-wave session-wave--${session.color}`}><UiIcon icon={AudioLines} size={18} /></div>
              <div className="session-copy"><strong>{session.title}</strong><small>{session.meta}</small></div>
              <div className="avatar-stack">{session.people.map((person) => <span key={person}>{person}</span>)}</div>
              <span className={`status-pill status-pill--${session.state}`}>{t(session.state)}</span>
              <button className="row-action" type="button" aria-label="More"><UiIcon icon={Ellipsis} hoverIcon={ListFilter} size={17} /></button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ icon, value, label, note }: { icon: typeof Clock3; value: string; label: string; note: string }) {
  return <article className="metric-card glass-card"><span className="metric-icon"><UiIcon icon={icon} size={17} /></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div><UiIcon icon={ChevronRight} size={15} className="metric-chevron" /></article>;
}

function RecordingView({ t, elapsed, paused, togglePaused, stop, transcript, coreError }: { t: (key: TranslationKey) => string; elapsed: number; paused: boolean; togglePaused: () => void; stop: () => void; transcript: SpeechResult[]; coreError: string | null }) {
  const audioSignal = useAudioSignal(paused);

  return (
    <section className={`recording-view${paused ? " is-paused" : ""}`}>
      <div className="recording-main glass-card">
        <div className="recording-status"><span className="live-dot" /><span>{paused ? t("pause") : t("recording")}</span></div>
        <div className="recording-visual">
          <LavaLamp
            active={!paused}
            signal={audioSignal}
            top="#9af466"
            bottom="#10a83a"
            sheen="#d6ff57"
            blobs={8}
            viscosity={1}
            wander={4}
            speed={13}
            glow={6}
            gloss={5}
            magnet={8}
            sizePercent={78}
          />
        </div>
        <time>{formatTime(elapsed)}</time><p>{paused ? t("pause") : t("listening")}</p><small>{t("recordingHint")}</small>
        <div className="recording-controls">
          <button className="round-control" type="button" aria-label={paused ? t("resume") : t("pause")} onClick={togglePaused}><UiIcon icon={paused ? Play : Pause} hoverIcon={paused ? Pause : Play} size={19} /></button>
          <button className="stop-control" type="button" onClick={stop}><span><UiIcon icon={Square} size={13} strokeWidth={2.4} /></span>{t("stopRecording")}</button>
        </div>
      </div>
      <aside className="transcript-panel glass-card">
        <div className="panel-heading"><div><span className="panel-icon"><UiIcon icon={AudioLines} size={16} /></span><strong>{t("liveTranscript")}</strong></div><span className="processing-pill"><i />Live</span></div>
        {coreError ? <div className="transcript-error">{coreError}</div> : transcript.length ? <div className="transcript-stream">{transcript.map((item, index) => <article className={item.kind === "overlap" ? "is-overlap" : ""} key={`${item.part}-${item.speaker}-${index}`}><div><strong>{item.speaker}</strong><time>{formatTime(Math.floor(item.start))}</time></div><p>{item.text || "…"}</p></article>)}</div> : <div className="transcript-empty"><span><UiIcon icon={Radio} size={24} /></span><strong>{t("noTranscript")}</strong><small>{t("speaker")} 1</small></div>}
      </aside>
    </section>
  );
}

function SettingsView({ t, locale, setLocale, theme, setTheme, autoConfirm, setAutoConfirm, backgroundProcessing, setBackgroundProcessing, notifications, setNotifications }: {
  t: (key: TranslationKey) => string; locale: Locale; setLocale: (value: Locale) => void; theme: Theme; setTheme: (value: Theme) => void;
  autoConfirm: boolean; setAutoConfirm: (value: boolean) => void; backgroundProcessing: boolean; setBackgroundProcessing: (value: boolean) => void; notifications: boolean; setNotifications: (value: boolean) => void;
}) {
  const themes = [{ id: "light" as const, icon: Sun }, { id: "dark" as const, icon: Moon }, { id: "system" as const, icon: Cpu }];
  return (
    <div className="settings-view">
      <section className="settings-card glass-card">
        <div className="settings-section-title"><span><UiIcon icon={Sparkles} size={17} /></span><div><h2>{t("appearance")}</h2><p>{t("appearanceHint")}</p></div></div>
        <div className="setting-row setting-row--themes"><div className="setting-label"><strong>{t("theme")}</strong></div><div className="theme-picker">{themes.map((item) => <button className={theme === item.id ? "is-selected" : ""} key={item.id} type="button" onClick={() => setTheme(item.id)}><span><UiIcon icon={item.icon} size={17} /></span><small>{t(item.id)}</small><i /></button>)}</div></div>
        <div className="setting-row"><div className="setting-label"><span className="setting-icon"><UiIcon icon={Languages} size={17} /></span><div><strong>{t("language")}</strong><small>{t("languageHint")}</small></div></div><div className="language-picker">{languages.map((item) => <button className={locale === item.code ? "is-selected" : ""} type="button" key={item.code} onClick={() => setLocale(item.code)}><span>{item.short}</span><strong>{item.name}</strong>{locale === item.code ? <UiIcon icon={Check} size={14} strokeWidth={2.2} /> : null}</button>)}</div></div>
      </section>

      <section className="settings-card glass-card">
        <div className="settings-section-title"><span><UiIcon icon={SlidersHorizontal} size={17} /></span><div><h2>{t("behavior")}</h2></div></div>
        <Preference icon={Mic} title={t("autoRecord")} hint={t("autoRecordHint")} checked={autoConfirm} change={() => setAutoConfirm(!autoConfirm)} />
        <Preference icon={Cpu} title={t("backgroundProcessing")} hint={t("backgroundHint")} checked={backgroundProcessing} change={() => setBackgroundProcessing(!backgroundProcessing)} />
        <Preference icon={Bell} title={t("notifications")} hint={t("notificationsHint")} checked={notifications} change={() => setNotifications(!notifications)} />
      </section>

      <section className="settings-card glass-card">
        <div className="settings-section-title"><span><UiIcon icon={ShieldCheck} size={17} /></span><div><h2>{t("privacy")}</h2><p>{t("localOnly")}</p></div></div>
        <div className="setting-row"><div className="setting-label"><span className="setting-icon"><UiIcon icon={FolderOpen} size={17} /></span><div><strong>{t("dataLocation")}</strong><small>C:\Users\MeeTrack\Data</small></div></div><button className="secondary-button" type="button">{t("openFolder")}<UiIcon icon={ArrowUpRight} hoverIcon={FolderOpen} size={13} /></button></div>
        <div className="setting-row"><div className="setting-label"><span className="setting-icon"><UiIcon icon={Database} size={17} /></span><div><strong>{t("modelProfile")}</strong><small>{t("modelHint")}</small></div></div><button className="select-button" type="button"><span>{t("balanced")}</span><UiIcon icon={ChevronDown} size={14} /></button></div>
      </section>
    </div>
  );
}

function Preference({ icon, title, hint, checked, change }: { icon: typeof Mic; title: string; hint: string; checked: boolean; change: () => void }) {
  return <div className="setting-row"><div className="setting-label"><span className="setting-icon"><UiIcon icon={icon} size={17} /></span><div><strong>{title}</strong><small>{hint}</small></div></div><Toggle checked={checked} onChange={change} label={title} /></div>;
}

const peopleCopy = {
  vi: { add: "Thêm người", directory: "Danh bạ giọng nói", empty: "Chưa có hồ sơ", emptyHint: "Thêm một người để MeeTrack nhận biết giọng nói trong cuộc họp.", name: "Họ và tên", role: "Chức vụ", location: "Vị trí", save: "Lưu thông tin", delete: "Xóa hồ sơ", voice: "Định danh giọng nói", ready: "Đã đăng ký", missing: "Chưa đăng ký", record: "Thu mẫu giọng", rerecord: "Thu lại", stop: "Hoàn tất thu", voiceHint: "Nói tự nhiên trong ít nhất 10 giây. Chỉ giọng nói của người này nên xuất hiện.", recordingNow: "Đang thu mẫu", select: "Chọn một hồ sơ để xem và chỉnh sửa", saved: "Thông tin đã được lưu", local: "Lưu cục bộ", upload: "Tải file âm", uploadHint: "Chọn file MP3, WAV hoặc tương tự", uploading: "Đang xử lý...", uploadDone: "Đã nhận mẫu giọng từ file", or: "hoặc" },
  en: { add: "Add person", directory: "Voice directory", empty: "No profiles yet", emptyHint: "Add someone so MeeTrack can recognize their voice in meetings.", name: "Full name", role: "Role", location: "Location", save: "Save details", delete: "Delete profile", voice: "Voice identity", ready: "Enrolled", missing: "Not enrolled", record: "Record voice", rerecord: "Record again", stop: "Finish recording", voiceHint: "Speak naturally for at least 10 seconds. Only this person's voice should be present.", recordingNow: "Recording sample", select: "Select a profile to view and edit", saved: "Details saved", local: "Stored locally", upload: "Upload audio", uploadHint: "Choose MP3, WAV, or similar", uploading: "Processing...", uploadDone: "Voice sample imported", or: "or" },
  zh: { add: "添加成员", directory: "语音名录", empty: "暂无档案", emptyHint: "添加成员，让 MeeTrack 在会议中识别其声音。", name: "姓名", role: "职位", location: "地点", save: "保存信息", delete: "删除档案", voice: "声纹身份", ready: "已注册", missing: "未注册", record: "录制声音", rerecord: "重新录制", stop: "完成录制", voiceHint: "自然说话至少 10 秒，仅应包含此人的声音。", recordingNow: "正在录制", select: "选择档案进行查看和编辑", saved: "信息已保存", local: "本地存储", upload: "上传音频", uploadHint: "选择 MP3、WAV 等文件", uploading: "处理中...", uploadDone: "已导入声纹样本", or: "或" },
  ja: { add: "メンバーを追加", directory: "音声ディレクトリ", empty: "プロフィールはありません", emptyHint: "会議で声を識別できるようメンバーを追加します。", name: "氏名", role: "役職", location: "所在地", save: "情報を保存", delete: "プロフィールを削除", voice: "音声ID", ready: "登録済み", missing: "未登録", record: "音声を録音", rerecord: "再録音", stop: "録音を完了", voiceHint: "10秒以上自然に話してください。この人以外の声は含めないでください。", recordingNow: "録音中", select: "プロフィールを選択して編集", saved: "保存しました", local: "ローカル保存", upload: "音声をアップロード", uploadHint: "MP3/WAVなど選択", uploading: "処理中...", uploadDone: "音声サンプルを取り込みました", or: "または" },
  ko: { add: "사람 추가", directory: "음성 디렉터리", empty: "프로필 없음", emptyHint: "회의에서 음성을 인식할 사람을 추가하세요.", name: "이름", role: "직책", location: "위치", save: "정보 저장", delete: "프로필 삭제", voice: "음성 ID", ready: "등록됨", missing: "미등록", record: "음성 녹음", rerecord: "다시 녹음", stop: "녹음 완료", voiceHint: "10초 이상 자연스럽게 말하세요. 이 사람의 목소리만 포함되어야 합니다.", recordingNow: "녹음 중", select: "프로필을 선택해 확인하고 수정하세요", saved: "저장됨", local: "로컬 저장", upload: "음성 업로드", uploadHint: "MP3, WAV 등 선택", uploading: "처리 중...", uploadDone: "음성 샘플 가져옴", or: "또는" },
} as const;

function PeopleView({ locale, onEnrollingChange }: { locale: Locale; onEnrollingChange: (enrolling: boolean) => void }) {
  const copy = peopleCopy[locale];
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [draft, setDraft] = useState({ name: "", role: "", location: "" });
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "success" | "error" } | null>(null);

  // Notify parent of enrolling state
  useEffect(() => { onEnrollingChange(recordingVoice); }, [recordingVoice, onEnrollingChange]);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try { setPeople(await listPeople()); } catch (error) { setMessage({ text: String(error), kind: "error" }); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    let dispose: () => void = () => undefined;
    subscribeToVoiceEnrollment(
      (signal) => { setLevel(Math.min(1, signal.rms * 8)); setSeconds(signal.seconds); },
      (payload) => {
        setRecordingVoice(false); setLevel(0);
        if (payload.error) setMessage({ text: payload.error, kind: "error" });
        if (payload.person) { setSelected(payload.person); setMessage({ text: copy.saved, kind: "success" }); }
        refresh();
      },
    ).then((value) => { dispose = value; });
    return () => dispose();
  }, [copy.saved, refresh]);

  const choose = (person: Person | null) => {
    setSelected(person); setDraft(person ? { name: person.name, role: person.role, location: person.location } : { name: "", role: "", location: "" }); setMessage(null);
  };
  const persist = async () => {
    try {
      const person = await savePerson({ id: selected?.id, ...draft });
      setSelected(person); setMessage({ text: copy.saved, kind: "success" }); await refresh(); return person;
    } catch (error) { setMessage({ text: String(error), kind: "error" }); return null; }
  };
  const beginVoice = async () => {
    const person = selected ?? await persist(); if (!person) return;
    try { setSeconds(0); setMessage(null); await startVoiceEnrollment(person.id); setRecordingVoice(true); } catch (error) { setMessage({ text: String(error), kind: "error" }); }
  };
  const finishVoice = async () => { try { await stopVoiceEnrollment(); } catch (error) { setMessage({ text: String(error), kind: "error" }); } };
  const handleUpload = async () => {
    const person = selected ?? await persist(); if (!person) return;
    try {
      const path = await pickVoiceFile();
      if (!path) return;
      setUploading(true); setMessage(null);
      const updated = await uploadVoiceSample(person.id, path);
      setSelected(updated);
      setMessage({ text: copy.uploadDone, kind: "success" });
      await refresh();
    } catch (error) { setMessage({ text: String(error), kind: "error" }); } finally { setUploading(false); }
  };
  const remove = async () => {
    if (!selected) return;
    try { await deletePerson(selected.id); choose(null); await refresh(); } catch (error) { setMessage({ text: String(error), kind: "error" }); }
  };

  return <section className="people-directory glass-card">
    <div className="people-list-pane">
      <div className="people-pane-heading"><div><h2>{copy.directory}</h2><small>{people.length}</small></div><button type="button" onClick={() => choose(null)}><UiIcon icon={UserPlus} hoverIcon={UserRoundPlus} size={16} />{copy.add}</button></div>
      <div className="people-list">{people.length ? people.map((person) => <button className={selected?.id === person.id ? "is-selected" : ""} type="button" key={person.id} onClick={() => choose(person)}><span className="person-avatar">{person.name.split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{person.name}</strong><small>{[person.role, person.location].filter(Boolean).join(" · ") || copy.local}</small></span><i className={person.voiceReady ? "is-ready" : ""}>{person.voiceReady ? copy.ready : copy.missing}</i><UiIcon icon={Pencil} hoverIcon={PenLine} size={14} /></button>) : <div className="people-empty"><span className="people-empty-icon"><UiIcon icon={Users} size={28} strokeWidth={1.4} /></span><strong>{copy.empty}</strong><p>{copy.emptyHint}</p></div>}</div>
    </div>
    <div className="person-editor">
      <div className="editor-title"><div><span>{selected ? selected.name : copy.add}</span><small><i />{copy.local}</small></div>{selected ? <button type="button" aria-label={copy.delete} title={copy.delete} onClick={remove}><UiIcon icon={Trash2} hoverIcon={X} size={16} /></button> : null}</div>
      <div className="person-form">
        <label><span>{copy.name}</span><span className="field-control"><UiIcon icon={User} size={15} /><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></span></label>
        <div><label><span>{copy.role}</span><span className="field-control"><UiIcon icon={Briefcase} size={15} /><input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></span></label><label><span>{copy.location}</span><span className="field-control"><UiIcon icon={MapPin} size={15} /><input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></span></label></div>
        <button className="person-save" type="button" onClick={persist}><UiIcon icon={Check} hoverIcon={CircleCheck} size={14} />{copy.save}</button>
      </div>
      <div className={`voice-enrollment${recordingVoice ? " is-recording" : ""}`}>
        <div className="voice-header">
          <div className="voice-copy"><div><strong>{copy.voice}</strong><span className={`voice-badge${selected?.voiceReady ? " is-ready" : ""}`}><UiIcon icon={selected?.voiceReady ? ShieldCheck : ShieldAlert} size={12} strokeWidth={2} />{selected?.voiceReady ? copy.ready : copy.missing}</span></div><p>{copy.voiceHint}</p></div>
        </div>
        {recordingVoice ? (
          <div className="voice-recording-area">
            <div className="voice-lava-orb">
              <VoiceEnrollmentLava />
            </div>
            <div className="voice-recording-info">
              <span className="voice-rec-badge"><i />{copy.recordingNow}</span>
              <time>{seconds.toFixed(1)}s</time>
            </div>
            <button className="voice-stop" type="button" onClick={finishVoice}><UiIcon icon={Square} size={12} strokeWidth={2.4} />{copy.stop}</button>
          </div>
        ) : (
          <>
            <div className="voice-meter" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(.025, level)})` }} /></div>
            <div className="voice-actions">
              <time>{seconds.toFixed(1)}s</time>
              <div className="voice-action-group">
                <button className="voice-record-btn" type="button" onClick={beginVoice} disabled={uploading}><UiIcon icon={Mic} hoverIcon={AudioLines} size={15} />{selected?.voiceReady ? copy.rerecord : copy.record}</button>
                <span className="voice-or">{copy.or}</span>
                <button className="voice-upload-btn" type="button" onClick={() => void handleUpload()} disabled={uploading || recordingVoice}>
                  <UiIcon icon={Upload} hoverIcon={FileAudio} size={15} />{uploading ? copy.uploading : copy.upload}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {message ? <p className={`person-message is-${message.kind}`}>{message.text}</p> : null}
    </div>
  </section>;
}

/** Mini lava lamp rendered only during voice enrollment recording. */
function VoiceEnrollmentLava() {
  const signal = useAudioSignal(false);
  return (
    <LavaLamp
      active
      signal={signal}
      top="#9af466"
      bottom="#10a83a"
      sheen="#d6ff57"
      blobs={5}
      viscosity={2}
      wander={3}
      speed={10}
      glow={8}
      gloss={4}
      magnet={6}
      sizePercent={120}
    />
  );
}

function CollectionView({ tab, t }: { tab: Exclude<Tab, "overview" | "settings">; t: (key: TranslationKey) => string }) {
  const config = {
    meetings: { icon: CalendarDays, items: sessions.map((item) => item.title), stat: "12" },
    people: { icon: Users, items: ["Minh Khôi", "Lan Anh", "Huy Trần"], stat: "8" },
    knowledge: { icon: BookOpen, items: ["Speech core architecture", "MVP scope", "Privacy policy"], stat: "24" },
  }[tab];
  return <section className="collection-view glass-card"><div className="collection-summary"><span><UiIcon icon={config.icon} size={23} /></span><div><strong>{config.stat}</strong><small>{t(tab)}</small></div><button type="button"><UiIcon icon={ListFilter} hoverIcon={SlidersHorizontal} size={15} /></button></div><div className="collection-list">{config.items.map((item, index) => <button type="button" key={item}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item}</strong><UiIcon icon={ChevronRight} hoverIcon={ArrowUpRight} size={15} /></button>)}</div></section>;
}
