"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDownloads, openDownloadStream, type DownloadJob, type DownloadStreamEvent } from "@/lib/api";

export type StreamState = "connecting" | "live" | "fallback";

// Sem eventos SSE por mais que este threshold → stream considerado stale → fallback
const STALE_MS = 45_000;
const STALE_CHECK_INTERVAL_MS = 10_000;
const FALLBACK_POLL_MS = 2_000;

function sendNotification(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "/favicon.ico", tag });
}

export function useDownloadStream(pushLog: (module: string, text: string) => void) {
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [lastStreamTs, setLastStreamTs] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  const prevCompletedRef = useRef<Set<string>>(new Set());
  const prevFailedRef = useRef<Set<string>>(new Set());
  // Ref separada para evitar closure stale no stale-check interval
  const lastEventMsRef = useRef<number>(0);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshDownloads = useCallback(async () => {
    try {
      const downloads = await fetchDownloads();
      setDownloadJobs(downloads.jobs);
    } catch (err) {
      pushLog("downloads", `erro ao atualizar fila: ${(err as Error).message}`);
    }
  }, [pushLog]);

  // ── SSE connection ─────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const close = openDownloadStream(
      (payload: DownloadStreamEvent) => {
        if (!mounted) return;
        const now = Date.now();
        lastEventMsRef.current = now;
        setLastStreamTs(now);

        if (payload.type === "snapshot" || payload.type === "progress") {
          setDownloadJobs(payload.jobs);
          for (const job of payload.jobs) {
            if (job.status === "completed" && !prevCompletedRef.current.has(job.id)) {
              prevCompletedRef.current.add(job.id);
              sendNotification(
                "Download concluído",
                `${job.animeTitle} — Ep. ${job.episodeNumber}`,
                job.id
              );
            }
            if (
              job.status === "failed" &&
              job.attemptCount >= job.maxAttempts &&
              !prevFailedRef.current.has(job.id)
            ) {
              prevFailedRef.current.add(job.id);
              sendNotification(
                "Falha no download",
                `${job.animeTitle} — Ep. ${job.episodeNumber}: ${job.errorMsg ?? "erro desconhecido"}`,
                `fail-${job.id}`
              );
            }
          }
          return;
        }

        if (payload.type === "enqueued") {
          pushLog("queue", `${payload.count} job(s) enfileirado(s)`);
          return;
        }
        if (payload.type === "cancelled") {
          pushLog("queue", `job cancelado: ${payload.jobId.slice(0, 8)}`);
          void refreshDownloads();
          return;
        }
        if (payload.type === "retried") {
          pushLog("queue", `job em retry: ${payload.jobId.slice(0, 8)}`);
          void refreshDownloads();
          return;
        }
        if (payload.type === "retry-batch") {
          pushLog("queue", `retry em lote: ${payload.retried}/${payload.requested}`);
          void refreshDownloads();
          return;
        }
        if (payload.type === "batch-enqueued") {
          pushLog("queue", `missing-all: ${payload.totalQueued} jobs`);
          void refreshDownloads();
        }
      },
      (state) => {
        if (!mounted) return;
        if (state === "open") {
          retryCountRef.current = 0;
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          lastEventMsRef.current = Date.now();
          setStreamState("live");
        } else {
          setStreamState("fallback");
          pushLog("stream", "SSE desconectado — modo fallback ativo");
          // F04: Agendar reconexão com backoff exponencial (3s, 6s, 12s … até 60s)
          const delay = Math.min(3_000 * Math.pow(2, retryCountRef.current), 60_000);
          retryCountRef.current++;
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            setReconnectKey((k) => k + 1);
          }, delay);
        }
      }
    );
    return () => {
      mounted = false;
      close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [pushLog, refreshDownloads, reconnectKey]);

  // ── Stale detection: SSE live mas sem eventos por STALE_MS → fallback ─────
  useEffect(() => {
    if (streamState !== "live") return;
    const check = setInterval(() => {
      if (lastEventMsRef.current > 0 && Date.now() - lastEventMsRef.current > STALE_MS) {
        setStreamState("fallback");
        pushLog("stream", `SSE inativo por >${STALE_MS / 1000}s — ativando polling`);
      }
    }, STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(check);
  }, [streamState, pushLog]);

  // ── Polling fallback (único, sem duplicata) ────────────────────────────────
  useEffect(() => {
    if (streamState === "live") return;
    const boot = setTimeout(() => { void refreshDownloads(); }, 0);
    const poll = setInterval(() => { void refreshDownloads(); }, FALLBACK_POLL_MS);
    return () => { clearTimeout(boot); clearInterval(poll); };
  }, [streamState, refreshDownloads]);

  const hasActiveDownloads = useMemo(
    () => downloadJobs.some((j) => j.status === "queued" || j.status === "downloading" || j.status === "retry_wait"),
    [downloadJobs]
  );

  const queuedCount = useMemo(
    () => downloadJobs.filter((j) => j.status === "queued" || j.status === "downloading" || j.status === "retry_wait").length,
    [downloadJobs]
  );

  return { downloadJobs, streamState, lastStreamTs, refreshDownloads, hasActiveDownloads, queuedCount };
}
