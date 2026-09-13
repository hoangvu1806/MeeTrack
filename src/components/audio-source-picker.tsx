"use client";

import { useEffect, useMemo, useState } from "react";
import { AudioLines, Check, LoaderCircle, Mic, MonitorSpeaker, RefreshCw, Volume2, X } from "lucide";
import { listCaptureSources, type CaptureCatalog, type CaptureSelection } from "@/lib/meeting-core";
import type { Locale } from "@/lib/i18n";
import { UiIcon } from "./ui-icon";

const copy = {
  vi: { title: "Nguồn âm thanh", hint: "Cấu hình được dùng tự động khi bắt đầu ghi.", microphone: "Micrô", microphoneHint: "Giọng nói gần thiết bị", system: "Âm thanh hệ thống", systemHint: "Mọi âm thanh đang phát trên máy", applications: "Ứng dụng đang phát âm", appHint: "Chỉ thu ứng dụng đã chọn", noApps: "Chưa có ứng dụng nào đang phát âm thanh.", refresh: "Làm mới", cancel: "Hủy", start: "Bắt đầu ghi", save: "Lưu nguồn âm", loading: "Đang đọc nguồn âm…", unavailable: "Không hỗ trợ thu theo ứng dụng trên Windows này", required: "Chọn ít nhất một nguồn âm." },
  en: { title: "Audio sources", hint: "This configuration is used automatically when recording starts.", microphone: "Microphone", microphoneHint: "Voices near this device", system: "System audio", systemHint: "Everything currently playing", applications: "Apps playing audio", appHint: "Capture only selected apps", noApps: "No application is currently playing audio.", refresh: "Refresh", cancel: "Cancel", start: "Start recording", save: "Save sources", loading: "Reading audio sources…", unavailable: "Per-app capture is unavailable on this Windows version", required: "Choose at least one audio source." },
  zh: { title: "音频来源", hint: "开始录音时自动使用此配置。", microphone: "麦克风", microphoneHint: "设备附近的语音", system: "系统音频", systemHint: "电脑当前播放的所有声音", applications: "正在播放音频的应用", appHint: "仅录制所选应用", noApps: "当前没有应用正在播放音频。", refresh: "刷新", cancel: "取消", start: "开始录音", save: "保存音源", loading: "正在读取音频来源…", unavailable: "此 Windows 版本不支持按应用录制", required: "请至少选择一个音频来源。" },
  ja: { title: "音声ソース", hint: "録音開始時にこの設定を自動で使用します。", microphone: "マイク", microphoneHint: "デバイス周辺の音声", system: "システム音声", systemHint: "PCで再生中のすべての音", applications: "音声を再生中のアプリ", appHint: "選択したアプリのみ録音", noApps: "音声を再生中のアプリはありません。", refresh: "更新", cancel: "キャンセル", start: "録音開始", save: "音源を保存", loading: "音声ソースを確認中…", unavailable: "この Windows ではアプリ別録音を利用できません", required: "音声ソースを1つ以上選択してください。" },
  ko: { title: "오디오 소스", hint: "녹음을 시작하면 이 설정을 자동으로 사용합니다.", microphone: "마이크", microphoneHint: "기기 주변의 음성", system: "시스템 오디오", systemHint: "PC에서 재생되는 모든 소리", applications: "오디오 재생 앱", appHint: "선택한 앱만 녹음", noApps: "현재 오디오를 재생 중인 앱이 없습니다.", refresh: "새로고침", cancel: "취소", start: "녹음 시작", save: "소스 저장", loading: "오디오 소스 확인 중…", unavailable: "이 Windows에서는 앱별 녹음을 지원하지 않습니다", required: "오디오 소스를 하나 이상 선택하세요." },
} as const;

type Props = {
  locale: Locale;
  onCancel?: () => void;
  onStart: (selection: CaptureSelection, labels: string[]) => void;
  embedded?: boolean;
  initialSelection?: CaptureSelection | null;
};

export function AudioSourcePicker({ locale, onCancel, onStart, embedded = false, initialSelection }: Props) {
  const text = copy[locale];
  const [catalog, setCatalog] = useState<CaptureCatalog | null>(null);
  const [microphone, setMicrophone] = useState<string | null>(initialSelection?.microphoneDevice ?? null);
  const [systemAudio, setSystemAudio] = useState(initialSelection?.systemAudio ?? false);
  const [output, setOutput] = useState<string | null>(initialSelection?.outputDevice ?? null);
  const [applications, setApplications] = useState<Set<number>>(new Set(initialSelection?.applications.map((item) => item.processId) ?? []));
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setCatalog(null);
    void listCaptureSources().then((next) => {
      setCatalog(next);
      const defaultMic = next.microphones.find((item) => item.isDefault) ?? next.microphones[0];
      const defaultOutput = next.outputs.find((item) => item.isDefault) ?? next.outputs[0];
      setMicrophone((current) => next.microphones.some((item) => item.id === current) ? current : defaultMic?.id ?? null);
      setOutput(defaultOutput?.id ?? null);
      setApplications((current) => new Set([...current].filter((processId) => next.applications.some((item) => item.processId === processId))));
    }).catch((reason) => setError(String(reason)));
  };
  useEffect(() => {
    let cancelled = false;
    void listCaptureSources().then((next) => {
      if (cancelled) return;
      setCatalog(next);
      const defaultMic = next.microphones.find((item) => item.isDefault) ?? next.microphones[0];
      const defaultOutput = next.outputs.find((item) => item.isDefault) ?? next.outputs[0];
      setMicrophone((current) => current && next.microphones.some((item) => item.id === current) ? current : defaultMic?.id ?? null);
      setOutput(defaultOutput?.id ?? null);
    }).catch((reason) => {
      if (!cancelled) setError(String(reason));
    });
    return () => { cancelled = true; };
  }, []);

  const selectedApplications = useMemo(() => catalog?.applications.filter((item) => applications.has(item.processId)) ?? [], [applications, catalog]);
  const valid = microphone !== null || systemAudio || selectedApplications.length > 0;
  const submit = () => {
    if (!catalog || !valid) return;
    const microphoneLabel = catalog.microphones.find((item) => item.id === microphone)?.label;
    const outputLabel = catalog.outputs.find((item) => item.id === output)?.label;
    const labels = [microphoneLabel, systemAudio ? `${text.system}${outputLabel ? ` · ${outputLabel}` : ""}` : null, ...selectedApplications.map((item) => item.label)].filter(Boolean) as string[];
    onStart({
      microphoneDevice: microphone,
      systemAudio,
      outputDevice: output,
      applications: selectedApplications.map((item) => ({ processId: item.processId, label: item.label })),
    }, labels);
  };

  const panel = <section className={`source-picker${embedded ? " source-picker--embedded" : ""}`} onMouseDown={(event) => event.stopPropagation()} aria-modal={embedded ? undefined : "true"} role={embedded ? undefined : "dialog"} aria-labelledby="source-picker-title">
      <header><div><h2 id="source-picker-title">{text.title}</h2><p>{text.hint}</p></div>{!embedded ? <button type="button" aria-label={text.cancel} onClick={onCancel}><UiIcon icon={X} size={16} /></button> : null}</header>
      {!catalog && !error ? <div className="source-picker-loading"><UiIcon icon={LoaderCircle} size={19} />{text.loading}</div> : null}
      {error ? <div className="source-picker-error">{error}<button type="button" onClick={load}><UiIcon icon={RefreshCw} size={14} />{text.refresh}</button></div> : null}
      {catalog ? <div className="source-picker-body">
        <div className="source-group">
          <div className="source-group-title"><span><UiIcon icon={Mic} size={16} /></span><div><strong>{text.microphone}</strong><small>{text.microphoneHint}</small></div><button className={`source-check${microphone ? " is-selected" : ""}`} type="button" role="switch" aria-checked={microphone !== null} onClick={() => setMicrophone((value) => value ? null : (catalog.microphones.find((item) => item.isDefault) ?? catalog.microphones[0])?.id ?? null)}>{microphone ? <UiIcon icon={Check} size={12} /> : null}</button></div>
          {microphone && catalog.microphones.length ? <select aria-label={text.microphone} value={microphone} onChange={(event) => setMicrophone(event.target.value)}>{catalog.microphones.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : null}
        </div>

        <div className="source-group">
          <div className="source-group-title"><span><UiIcon icon={MonitorSpeaker} size={16} /></span><div><strong>{text.system}</strong><small>{text.systemHint}</small></div><button className={`source-check${systemAudio ? " is-selected" : ""}`} type="button" role="switch" aria-checked={systemAudio} onClick={() => { setSystemAudio((value) => !value); setApplications(new Set()); }}>{systemAudio ? <UiIcon icon={Check} size={12} /> : null}</button></div>
          {systemAudio && catalog.outputs.length ? <select aria-label={text.system} value={output ?? ""} onChange={(event) => setOutput(event.target.value)}>{catalog.outputs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : null}
        </div>

        <div className="source-apps">
          <div className="source-apps-heading"><div><strong>{text.applications}</strong><small>{catalog.applicationCaptureSupported ? text.appHint : text.unavailable}</small></div><button type="button" onClick={load}><UiIcon icon={RefreshCw} size={13} />{text.refresh}</button></div>
          {catalog.applicationCaptureSupported && catalog.applications.length ? <div className="source-app-list">{catalog.applications.map((item) => {
            const selected = applications.has(item.processId);
            return <button className={selected ? "is-selected" : ""} type="button" key={item.id} onClick={() => { setSystemAudio(false); setApplications((current) => { const next = new Set(current); if (next.has(item.processId)) next.delete(item.processId); else next.add(item.processId); return next; }); }}>
              <span className="source-app-icon"><UiIcon icon={AudioLines} size={16} /></span><span><strong>{item.label}</strong><small>PID {item.processId}</small></span><i><b style={{ width: `${Math.max(4, Math.min(100, item.peak * 100))}%` }} /></i>{selected ? <UiIcon icon={Check} size={14} /> : null}
            </button>;
          })}</div> : <p className="source-app-empty">{text.noApps}</p>}
        </div>
      </div> : null}
      <footer>{catalog && !valid ? <small>{text.required}</small> : <span />}<div>{!embedded ? <button type="button" className="source-cancel" onClick={onCancel}>{text.cancel}</button> : null}<button type="button" className="source-start" disabled={!catalog || !valid} onClick={submit}><UiIcon icon={Volume2} hoverIcon={AudioLines} size={15} />{embedded ? text.save : text.start}</button></div></footer>
    </section>;
  return embedded ? panel : <div className="source-picker-overlay" onMouseDown={onCancel}>{panel}</div>;
}
