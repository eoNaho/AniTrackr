"use client";

import React, { useEffect, useMemo, useState } from "react";

type DownloadStatus = "Queued" | "Downloading" | "Downloaded" | "Missing" | "Paused";

type Anime = {
  id: number;
  title: string;
  alt: string;
  status: DownloadStatus;
  downloaded: number;
  total: number;
  score: number;
  source: string;
  provider: string;
  quality: string;
  size: string;
  path: string;
  type: string;
  year: number;
  tags: string[];
  nextRelease: string | null;
  lastDownload: string;
  synopsis: string;
  ascii: string;
};

const animes: Anime[] = [
  {
    id: 1,
    title: "Sousou no Frieren",
    alt: "Frieren: Beyond Journey's End",
    status: "Downloading",
    downloaded: 24,
    total: 28,
    score: 10,
    source: "AniList",
    provider: "goanime-br",
    quality: "1080p HEVC",
    size: "18.4 GB",
    path: "~/Anime/Frieren/Season 01",
    type: "TV",
    year: 2023,
    tags: ["Adventure", "Drama", "Fantasy"],
    nextRelease: "Hoje, 23:00",
    lastDownload: "Hoje, 14:22",
    synopsis:
      "Tracker local de episódios baixados. Frieren possui 24 episódios salvos, 4 pendentes e 1 lançamento previsto para hoje.",
    ascii: [
      "   /\\_\\",
      "  ( o.o )",
      "   > ^ <",
      "  /  _  \\",
      " /_| |_\\_\\",
    ].join("\n"),
  },
  {
    id: 2,
    title: "Solo Leveling",
    alt: "Ore dake Level Up na Ken",
    status: "Queued",
    downloaded: 8,
    total: 12,
    score: 8.5,
    source: "MAL",
    provider: "goanime-en",
    quality: "1080p AVC",
    size: "9.1 GB",
    path: "~/Anime/Solo Leveling/Season 01",
    type: "TV",
    year: 2024,
    tags: ["Action", "System", "Dark Fantasy"],
    nextRelease: "Sábado",
    lastDownload: "Ontem, 22:10",
    synopsis:
      "Série na fila para completar a temporada. O tracker detectou 4 episódios faltando e mantém os metadados sincronizados com MAL.",
    ascii: [
      "   /| ________________",
      " O|===|* >________________>",
      "   \\|",
    ].join("\n"),
  },
  {
    id: 3,
    title: "Jujutsu Kaisen 2nd Season",
    alt: "Shibuya Incident",
    status: "Downloaded",
    downloaded: 47,
    total: 47,
    score: 9.5,
    source: "AniList",
    provider: "goanime-br",
    quality: "1080p HEVC",
    size: "31.8 GB",
    path: "~/Anime/Jujutsu Kaisen/Season 02",
    type: "TV",
    year: 2023,
    tags: ["Action", "Supernatural", "Gore"],
    nextRelease: null,
    lastDownload: "11 Maio",
    synopsis:
      "Temporada completa no disco. Nenhum episódio faltando, pronto para backup, exportação ou rescan da biblioteca.",
    ascii: [
      "   ///\\\\",
      "  | 0 0 |",
      "   \\_-_/",
      "   /|||\\",
    ].join("\n"),
  },
  {
    id: 4,
    title: "Dungeon Meshi",
    alt: "Delicious in Dungeon",
    status: "Missing",
    downloaded: 11,
    total: 24,
    score: 9,
    source: "Local",
    provider: "goanime-en",
    quality: "720p AVC",
    size: "7.6 GB",
    path: "~/Anime/Dungeon Meshi/Season 01",
    type: "TV",
    year: 2024,
    tags: ["Comedy", "Fantasy", "Food"],
    nextRelease: "Quinta-feira",
    lastDownload: "Segunda, 19:40",
    synopsis:
      "Download incompleto. O tracker encontrou episódios ausentes entre o 12 e o 24 e sugere um batch download.",
    ascii: [
      "   ( )",
      "  (   )",
      " (_____)",
      "  |___|",
    ].join("\n"),
  },
  {
    id: 5,
    title: "Vinland Saga S2",
    alt: "Farmland Arc",
    status: "Paused",
    downloaded: 14,
    total: 24,
    score: 9.7,
    source: "AniList",
    provider: "goanime-br",
    quality: "1080p AVC",
    size: "13.2 GB",
    path: "~/Anime/Vinland Saga/Season 02",
    type: "TV",
    year: 2023,
    tags: ["Historical", "Drama", "Seinen"],
    nextRelease: null,
    lastDownload: "08 Maio",
    synopsis:
      "Download pausado manualmente. Ainda faltam 10 episódios para fechar a temporada local.",
    ascii: [
      "  /\\____/\\",
      " /  o  o  \\",
      " \\  --   /",
      "  /|____|\\",
    ].join("\n"),
  },
];

const jobs = [
  { time: "20:30", title: "Frieren", episode: "Episódio 25", state: "READY" },
  { time: "21:10", title: "Dungeon Meshi", episode: "Batch 12-24", state: "MISSING" },
  { time: "22:00", title: "Solo Leveling", episode: "Episódios 09-12", state: "QUEUED" },
];

const activity = ["▁", "▃", "▂", "▆", "▄", "█", "▇", "▁", "▄", "▅", "▃", "█", "▆", "▂", "█", "▇", "▄", "▆", "█", "▄", "▅", "▇", "▂", "█"];

function getProgress(current: number, total: number) {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
}

function generateAsciiBar(current: number, total: number, length = 14) {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(total) ||
    total <= 0 ||
    length <= 0
  ) {
    return `[${"░".repeat(Math.max(0, length))}]`;
  }

  const safeCurrent = Math.min(total, Math.max(0, current));
  const filled = Math.round((safeCurrent / total) * length);

  return `[${"█".repeat(filled)}${"░".repeat(length - filled)}]`;
}

function getMissingEpisodes(anime: { downloaded: number; total: number }) {
  if (!anime || anime.total <= 0) return 0;
  return Math.max(0, anime.total - Math.max(0, anime.downloaded));
}

function getNextDownload(anime: { downloaded: number; total: number }) {
  const missing = getMissingEpisodes(anime);
  if (missing === 0) return "Complete";
  return `Episode ${anime.downloaded + 1}`;
}

function runSelfTests() {
  const tests = [
    { name: "normal progress", result: getProgress(18, 28), expected: 64 },
    { name: "completed progress", result: getProgress(24, 24), expected: 100 },
    { name: "zero total is safe", result: getProgress(4, 0), expected: 0 },
    { name: "overflow is capped", result: getProgress(30, 24), expected: 100 },
    { name: "negative progress is clamped", result: getProgress(-4, 24), expected: 0 },
    { name: "ascii empty bar", result: generateAsciiBar(0, 10, 4), expected: "[░░░░]" },
    { name: "ascii full bar", result: generateAsciiBar(10, 10, 4), expected: "[████]" },
    { name: "next download increments", result: getNextDownload({ downloaded: 4, total: 12 }), expected: "Episode 5" },
    { name: "next download completed", result: getNextDownload({ downloaded: 12, total: 12 }), expected: "Complete" },
    { name: "missing episodes", result: getMissingEpisodes({ downloaded: 8, total: 12 }), expected: 4 },
  ];

  tests.forEach((test) => {
    if (test.result !== test.expected) {
      throw new Error(
        `Self-test failed: ${test.name}. Expected ${test.expected}, received ${test.result}.`
      );
    }
  });
}

runSelfTests();

function Panel({
  title,
  focused,
  children,
  className = "",
}: {
  title: string;
  focused?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative border bg-[#1a1a24] ${
        focused
          ? "border-[#cba6f7] shadow-[0_0_8px_rgba(203,166,247,.14)]"
          : "border-[#45475a]"
      } ${className}`}
    >
      <div
        className={`absolute -top-3 left-4 bg-[#0f0f14] px-2 text-[12px] font-bold tracking-normal ${
          focused ? "text-[#a6e3a1]" : "text-[#cba6f7]"
        }`}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function TerminalBadge({
  children,
  tone = "purple",
}: {
  children: React.ReactNode;
  tone?: "purple" | "green" | "cyan" | "pink" | "yellow" | "muted";
}) {
  const tones: Record<string, string> = {
    purple: "bg-[#cba6f7] text-[#0f0f14]",
    green: "bg-[#a6e3a1] text-[#0f0f14]",
    cyan: "bg-[#89dceb] text-[#0f0f14]",
    pink: "bg-[#f38ba8] text-[#0f0f14]",
    yellow: "bg-[#f9e2af] text-[#0f0f14]",
    muted: "border border-[#45475a] text-[#bac2de]",
  };

  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[11px] font-bold uppercase ${
        tones[tone] || tones.purple
      }`}
    >
      {children}
    </span>
  );
}

function StatLine({
  label,
  value,
  command,
}: {
  label: string;
  value: string | number;
  command: string;
}) {
  return (
    <div className="border border-[#45475a] bg-black/20 p-3">
      <div className="mb-1 text-[11px] uppercase tracking-normal text-[#6c7086]">
        {label}
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-2xl font-extrabold text-[#e0e0ed]">{value}</span>
        <span className="text-xs text-[#89dceb]">{command}</span>
      </div>
    </div>
  );
}

function statusTone(status: DownloadStatus) {
  if (status === "Downloaded") return "text-[#a6e3a1]";
  if (status === "Downloading") return "text-[#89dceb]";
  if (status === "Queued") return "text-[#f9e2af]";
  if (status === "Missing") return "text-[#f38ba8]";
  return "text-[#6c7086]";
}

function statusBadgeTone(status: DownloadStatus) {
  if (status === "Downloaded") return "green" as const;
  if (status === "Downloading") return "cyan" as const;
  if (status === "Queued") return "yellow" as const;
  if (status === "Missing") return "pink" as const;
  return "muted" as const;
}

function AnimeRow({
  anime,
  index,
  selected,
  onSelect,
}: {
  anime: Anime;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const percent = getProgress(anime.downloaded, anime.total);
  const bar = generateAsciiBar(anime.downloaded, anime.total);
  const missing = getMissingEpisodes(anime);

  return (
    <button
      onClick={onSelect}
      className={`grid w-full grid-cols-[20px_1fr_auto] items-center gap-2 px-3 py-2 text-left text-[14px] transition-none ${
        selected
          ? "bg-[#cba6f7] font-bold text-[#0f0f14]"
          : "text-[#e0e0ed] hover:bg-white/5"
      }`}
    >
      <span className={selected ? "text-[#0f0f14]" : "text-[#cba6f7] opacity-0"}>
        ▶
      </span>
      <span className="min-w-0 break-words pr-2">
        <span className={selected ? "text-[#0f0f14]" : "text-[#6c7086]"}>
          #{String(index + 1).padStart(2, "0")}
        </span>{" "}
        {anime.title}
      </span>
      <span className="hidden items-center gap-2 tabular-nums xl:flex">
        <span className={selected ? "text-[#0f0f14]" : statusTone(anime.status)}>
          {anime.status}
        </span>
        <span className={selected ? "text-[#0f0f14]" : "text-[#a6e3a1]"}>
          {bar}
        </span>
        <span className={selected ? "text-[#0f0f14]" : "text-[#6c7086]"}>
          {anime.downloaded}/{anime.total}
        </span>
        <span className={selected ? "text-[#0f0f14]" : "text-[#f38ba8]"}>
          miss:{missing}
        </span>
        <span className={selected ? "text-[#0f0f14]" : "text-[#89dceb]"}>
          {percent}%
        </span>
      </span>
    </button>
  );
}

export function TrackerHome() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [logs, setLogs] = useState([
    { time: "08:15:44", module: "sqlite", text: "download library loaded from ~/.goanime/tracker.db (5 titles)" },
    { time: "08:15:44", module: "scanner", text: "filesystem scan finished: 17 missing episodes detected" },
    { time: "08:15:44", module: "queue", text: "download queue ready: 3 jobs waiting" },
  ]);

  const selected = animes[selectedIndex];
  const progress = useMemo(
    () => getProgress(selected.downloaded, selected.total),
    [selected]
  );

  const queuedCount = animes.filter((anime) => anime.status === "Queued").length;
  const downloadedTitles = animes.filter((anime) => anime.status === "Downloaded").length;
  const missingEpisodes = animes.reduce((acc, anime) => acc + getMissingEpisodes(anime), 0);
  const downloadedEpisodes = animes.reduce((acc, anime) => acc + anime.downloaded, 0);
  const totalStorage = "80.1GB";

  function getCurrentTimeLabel() {
    return new Date().toLocaleTimeString("pt-BR", { hour12: false });
  }

  function pushLog(module: string, text: string) {
    setLogs((current) => [...current.slice(-2), { time: getCurrentTimeLabel(), module, text }]);
  }

  function selectAnime(index: number) {
    setSelectedIndex(index);
    pushLog("tui", `selected ${animes[index].title}`);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (["ArrowDown", "j"].includes(event.key)) {
        event.preventDefault();
        setSelectedIndex((current) => Math.min(animes.length - 1, current + 1));
      }

      if (["ArrowUp", "k"].includes(event.key)) {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(0, current - 1));
      }

      if (event.key === "d") {
        pushLog("download", `queued missing episodes for ${selected.title}`);
      }

      if (event.key === "b") {
        pushLog("batch", `batch download requested: ${selected.title}`);
      }

      if (event.key === "s") {
        pushLog("scanner", `rescanning folder: ${selected.path}`);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return (
    <div
      className="h-[100dvh] overflow-hidden bg-[#050505] p-2 text-[#e0e0ed] md:p-3"
      style={{
        fontFamily:
          "'JetBrains Mono', 'Fira Code', 'Courier New', Courier, monospace",
        backgroundImage:
          "linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,.25) 50%), linear-gradient(90deg, rgba(255,0,0,.06), rgba(0,255,0,.02), rgba(0,0,255,.06))",
        backgroundSize: "100% 4px, 3px 100%",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap');
        @keyframes boot {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .boot { animation: boot .32s ease-out both; }
        .terminal-cursor { animation: blink 1s step-end infinite; }
        * { scrollbar-width: thin; scrollbar-color: #45475a #0f0f14; }
      `}</style>

      <div className="flex h-full w-full flex-col rounded-md border border-[#45475a] bg-[#0f0f14] p-[10px] shadow-[0_20px_50px_rgba(0,0,0,.8),inset_0_0_100px_rgba(0,0,0,.5)]">
<header className="grid grid-cols-1 gap-3 px-[10px] pb-[3px] pt-[5px] text-[14px] md:grid-cols-[1fr_auto_auto] md:items-center">          <div className="min-w-0 font-extrabold tracking-[1px] text-[#cba6f7] drop-shadow-[0_0_4px_rgba(203,166,247,.35)]">
            GOANIME-TRACKER v2.0.1
          </div>

          <div className="flex min-w-0 flex-wrap gap-[12px] text-[#6c7086] md:justify-center">
            <span className="font-bold text-[#a6e3a1]">[QUEUE]</span>
            <span>[MISSING]</span>
            <span>[DOWNLOADED]</span>
            <span>[PROVIDERS]</span>
          </div>

          <div className="min-w-0 text-[#6c7086] md:text-right">
            Scan: <span className="font-bold text-[#a6e3a1]">Library OK</span>
          </div>
        </header>

<div className="grid flex-1 gap-[12px] pt-[12px] overflow-hidden xl:grid-cols-[46%_1fr] xl:grid-rows-[1fr_68px]">          <Panel title="Downloads :: Local SQLite" focused>
            <div className="grid grid-cols-2 gap-3 border-b border-dashed border-[#45475a] p-4 md:grid-cols-4">
              <StatLine label="Queued" value={queuedCount} command="queue.len()" />
              <StatLine label="Complete" value={downloadedTitles} command="--done" />
              <StatLine label="Missing eps" value={missingEpisodes} command="scan.diff" />
              <StatLine label="Storage" value={totalStorage} command="du -sh" />
            </div>

            <div className="flex items-center justify-between border-b border-dashed border-[#45475a] px-5 py-3 text-[12px] uppercase text-[#6c7086]">
              <span>TÍTULO</span>
              <span className="hidden md:block">STATUS · PROGRESSO · FALTANDO</span>
            </div>

            <div className="h-full overflow-auto py-[10px]">
              {animes.map((anime, index) => (
                <AnimeRow
                  key={anime.id}
                  anime={anime}
                  index={index}
                  selected={index === selectedIndex}
                  onSelect={() => selectAnime(index)}
                />
              ))}
            </div>
          </Panel>

          <Panel title="Detalhes do Download">
            <div className="grid h-full gap-5 overflow-auto p-5 lg:grid-cols-[210px_1fr]">
              <div className="space-y-4">
                <pre className="min-h-[150px] overflow-hidden border border-dashed border-[#45475a] bg-black/30 p-[10px] text-[12px] leading-[1.15] text-[#89dceb] drop-shadow-[0_0_2px_rgba(137,220,235,.5)]">
{selected.ascii}
                </pre>

                <div className="border border-[#45475a] bg-black/20 p-3 text-[13px] leading-6">
                  <div>
                    <span className="text-[#6c7086]">STATUS:</span>{" "}
                    <span className={statusTone(selected.status)}>{selected.status}</span>
                  </div>
                  <div>
                    <span className="text-[#6c7086]">PROVIDER:</span>{" "}
                    <span className="text-[#89dceb]">{selected.provider}</span>
                  </div>
                  <div>
                    <span className="text-[#6c7086]">QUALITY:</span> {selected.quality}
                  </div>
                  <div>
                    <span className="text-[#6c7086]">SIZE:</span>{" "}
                    <span className="text-[#f9e2af]">{selected.size}</span>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <div>
                  <div className="mb-1 text-[12px] uppercase text-[#6c7086]">
                    selected download entry
                  </div>
                  <h1 className="break-words text-2xl font-extrabold leading-tight text-[#cba6f7] md:text-3xl">
                    {selected.title}
                  </h1>
                  <p className="break-words text-[13px] text-[#6c7086]">{selected.alt}</p>
                </div>

                <div className="grid gap-[10px] md:grid-cols-3">
                  <div className="border border-[#45475a] bg-black/20 p-3">
                    <div className="text-[12px] uppercase text-[#6c7086]">Downloaded</div>
                    <div className="mt-2 text-[18px] font-extrabold text-[#a6e3a1]">
                      {generateAsciiBar(selected.downloaded, selected.total, 18)}
                    </div>
                    <div className="mt-1 text-[12px] text-[#bac2de]">
                      {selected.downloaded}/{selected.total} eps · {progress}%
                    </div>
                  </div>

                  <div className="border border-[#45475a] bg-black/20 p-3">
                    <div className="text-[12px] uppercase text-[#6c7086]">Next job</div>
                    <div className="mt-2 text-[18px] font-extrabold text-[#f9e2af]">
                      {getNextDownload(selected)}
                    </div>
                    <div className="mt-1 text-[12px] text-[#bac2de]">
                      {selected.nextRelease || "Sem lançamento pendente"}
                    </div>
                  </div>

                  <div className="border border-[#45475a] bg-black/20 p-3">
                    <div className="text-[12px] uppercase text-[#6c7086]">Missing</div>
                    <div className="mt-2 text-[18px] font-extrabold text-[#f38ba8]">
                      {getMissingEpisodes(selected)} episódios
                    </div>
                    <div className="mt-1 text-[12px] text-[#bac2de]">
                      Folder scan: OK
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-[5px] font-bold text-[#89dceb]">-- LOCAL PATH --</div>
                  <div className="border-l-2 border-[#45475a] bg-black/20 p-[10px] text-[13px] text-[#bac2de]">
                    {selected.path}
                  </div>
                </div>

                <div>
                  <div className="mb-[5px] font-bold text-[#89dceb]">-- TAGS --</div>
                  <div className="flex flex-wrap gap-[5px]">
                    <TerminalBadge tone={statusBadgeTone(selected.status)}>{selected.status}</TerminalBadge>
                    {selected.tags.map((tag, index) => (
                      <TerminalBadge
                        key={tag}
                        tone={index % 3 === 0 ? "cyan" : index % 3 === 1 ? "purple" : "yellow"}
                      >
                        {tag}
                      </TerminalBadge>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-[5px] font-bold text-[#89dceb]">-- TRACKER NOTE --</div>
                  <p className="border-l-2 border-[#45475a] bg-black/20 p-[10px] text-[13px] leading-[1.6] text-[#6c7086]">
                    {selected.synopsis}
                  </p>
                </div>

                <div className="mt-auto grid gap-[10px] border border-dashed border-[#45475a] bg-black/20 p-[15px] text-[13px] md:grid-cols-2">
                  <button
                    onClick={() => pushLog("download", `queued missing episodes for ${selected.title}`)}
                    className="text-left text-[#e0e0ed] hover:bg-[#cba6f7] hover:text-[#0f0f14]"
                  >
                    <TerminalBadge tone="pink">d</TerminalBadge> Download missing eps
                  </button>

                  <button
                    onClick={() => pushLog("batch", `batch download queued: ${selected.title}`)}
                    className="text-left text-[#e0e0ed] hover:bg-[#cba6f7] hover:text-[#0f0f14]"
                  >
                    <TerminalBadge tone="pink">b</TerminalBadge> Batch download season
                  </button>

                  <button
                    onClick={() => pushLog("scanner", `rescanning folder: ${selected.path}`)}
                    className="text-left text-[#e0e0ed] hover:bg-[#cba6f7] hover:text-[#0f0f14]"
                  >
                    <TerminalBadge tone="pink">s</TerminalBadge> Rescan local folder
                  </button>

                  <button
                    onClick={() => pushLog("folder", `opening folder: ${selected.path}`)}
                    className="text-left text-[#e0e0ed] hover:bg-[#cba6f7] hover:text-[#0f0f14]"
                  >
                    <TerminalBadge tone="pink">o</TerminalBadge> Open download path
                  </button>

                  <button
                    onClick={() => pushLog("quality", `quality profile changed: ${selected.title}`)}
                    className="text-left text-[#e0e0ed] hover:bg-[#cba6f7] hover:text-[#0f0f14]"
                  >
                    <TerminalBadge tone="pink">q</TerminalBadge> Change quality profile
                  </button>

                  <button
                    onClick={() => pushLog("sync", `metadata sync requested: ${selected.title}`)}
                    className="text-left text-[#e0e0ed] hover:bg-[#cba6f7] hover:text-[#0f0f14]"
                  >
                    <TerminalBadge tone="pink">m</TerminalBadge> Sync metadata
                  </button>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Download Daemon Logs" className="xl:col-span-2">
            <div className="grid h-full gap-4 px-[15px] py-[10px] md:grid-cols-[1fr_370px]">
              <div className="flex flex-col justify-center gap-0.5 overflow-hidden text-[12px] text-[#6c7086]">
                {logs.map((log, index) => (
                  <div key={`${log.module}-${index}`} className="truncate boot">
                    <span className="text-[#89dceb]">
                      {log.time}
                    </span>{" "}
                    <span className="text-[#f9e2af]">[{log.module}]</span>{" "}
                    <span>{log.text}</span>
                  </div>
                ))}
              </div>

              <div className="hidden items-center justify-between border-l border-dashed border-[#45475a] pl-4 text-[12px] text-[#6c7086] md:flex">
                <div>
                  <div>
                    <span className="font-bold text-[#cba6f7]">↑/k</span> Up ·{" "}
                    <span className="font-bold text-[#cba6f7]">↓/j</span> Down
                  </div>
                  <div>
                    <span className="font-bold text-[#cba6f7]">d</span> Download ·{" "}
                    <span className="font-bold text-[#cba6f7]">b</span> Batch ·{" "}
                    <span className="font-bold text-[#cba6f7]">s</span> Scan
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[#a6e3a1]">SQLite: OK</div>
                  <div className="text-[#f9e2af]">Queue: {jobs.length} jobs</div>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <footer className="mt-[10px] flex flex-col gap-2 border-t border-[#45475a] px-2 pt-[10px] text-[12px] text-[#6c7086] md:flex-row md:items-center md:justify-between">
          <div>
            <span className="text-[#cba6f7]">goanime</span> download-tracker --scan --queue --missing --provider=goanime-br,en
          </div>
          <div>
            <span className="font-bold text-[#cba6f7]">q/Esc</span> Quit ·{" "}
            <span className="font-bold text-[#cba6f7]">Tab</span> Switch Pane ·{" "}
            <span className="font-bold text-[#cba6f7]">Enter</span> Select
          </div>
        </footer>
      </div>
    </div>
  );
}
