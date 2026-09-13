# MeeTrack - Desktop Application

> **Local-first Meeting Intelligence & Organizational Memory**  
> Private, overlap-aware speech intelligence desktop application built with **Tauri v2 + Next.js 15 + Rust Core**.

---

## Overview

**MeeTrack** transforms meetings into structured organizational memory with provenance. Unlike traditional cloud meeting note-takers, MeeTrack prioritizes **100% local-first privacy**, persistent voice identity across sessions, and advanced multi-speaker speech separation.

- **Multi-source Audio Capture**: Record Microphone, System Audio, or specific running applications via Windows WASAPI loopback.
- **Persistent Speaker Identity & Diarization**: Recognize known voices across sessions using voice embeddings and centroids, with unknown speaker workflows and retroactive linking.
- **Overlap-Aware Processing**: Detects overlapping speech and separates concurrent voices using SepFormer neural separation.
- **Real-time Responsive Interface**: Built with Next.js 15, React 19, TypeScript, Tailwind/CSS variables, and an audio-reactive Lava Lamp visualizer powered by Three.js shaders.
- **Local-first Privacy**: Continuous raw audio, embeddings, transcripts, and metadata remain on the user's local machine.

---

## Architecture

```
+-------------------------------------------------------------+
|                    Desktop UI (Next.js 15)                  |
|    AppShell - AudioSourcePicker - People - WindowTitlebar   |
|               Audio-Reactive Lava Lamp (Three.js)           |
+------------------------------+------------------------------+
                               | Tauri IPC Events & Commands
+------------------------------v------------------------------+
|                    Tauri Backend (Rust)                     |
|    CoreManager - SpeakerIdentity - Enrollment - File Dialog |
+------------------------------+------------------------------+
                               | Rust Crate Dependency
+------------------------------v------------------------------+
|                Meeting Core Rust (core_rust)                |
|    WASAPI Capture -> Silero VAD -> Overlap Detector         |
|    -> SepFormer Separation -> Speaker ID -> Zipformer STT   |
+-------------------------------------------------------------+
```

---

## Tech Stack

- **Desktop Framework**: [Tauri v2](https://v2.tauri.app/)
- **Frontend**: [Next.js 15 (App Router)](https://nextjs.org/), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Styling & Components**: Glassmorphism CSS, Lucide Icons, Morphicons
- **3D Graphics & Visualization**: [Three.js](https://threejs.org/) raymarching shader
- **Audio & ML Core**: Rust, ONNX Runtime (`ort`), Silero VAD, SepFormer, Hound WAV, Windows WASAPI loopback

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended, tested on v22)
- [Rust](https://www.rust-lang.org/) (1.77.2+)
- [FFmpeg](https://ffmpeg.org/) installed and available in system `PATH`

### Installation

```bash
# Clone the repository
git clone https://github.com/hoangvu1806/MeeTrack.git
cd MeeTrack/application

# Install dependencies
npm install
```

### Running in Development

```bash
# Run Desktop Application (Next.js + Tauri native window)
npm run tauri dev

# Or run frontend only in browser (http://localhost:3000)
npm run dev
```

### Building for Production

```bash
# Package as standalone desktop executable
npm run tauri build
```

---

## License

Private / Proprietary - MeeTrack Team.
