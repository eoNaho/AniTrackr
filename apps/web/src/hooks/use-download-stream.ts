"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDownloads, openDownloadStream, type DownloadJob, type DownloadStreamEvent } from "@/lib/api";

export type StreamState = "connecting" | "live" | "fallback";

function sendNotification(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "/favicon.ico", tag });
}

export function useDownloadStream(pushLog: (module: string, text: string) => void) {
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [lastStreamTs, setLastStreamTs] = useState<number | null>(null);

  const prevCompletedRef = useRef<Set<string>>(new Set());
  const prevFailedRef = useRef<Set<string>>(new Set());

  const refreshDownloads = useCallback(async () => {
    try {
      const downloads = await fetchDownloads();
      setDownloadJobs(downloads.jobs);
    } catch (err) {
      pushLog("downloads", `erro ao atualizar fila: ${(err as Error).message}`);
    }
  }, [pushLog]);

  // SSE connection
  useEffect(() => {
    let mounted = true;
    const close = openDownloadStream(
      (payload: DownloadStreamEvent) => {
        if (!mounted) return;
        setLastStreamTs(Date.now());

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
          pushLog("queue", `novos jobs enfileirados: ${payload.count}`);
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
        if (state === "open") setStreamState("live");
        else setStreamState("fallback");
      }
    );
    return () => {
      mounted = false;
      close();
    };
  }, [pushLog, refreshDownloads]);

  // Polling fallback quando SSE cai
  useEffect(() => {
    if (streamState === "live") return;
    const boot = setTimeout(() => { void refreshDownloads(); }, 0);
    const timer = setInterval(() => { void refreshDownloads(); }, 2000);
    return () => { clearTimeout(boot); clearInterval(timer); };
  }, [refreshDownloads, streamState]);

  const hasActiveDownloads = useMemo(
    () => downloadJobs.some((j) => j.status === "queued" || j.status === "downloading" || j.status === "retry_wait"),
    [downloadJobs]
  );

  // Polling extra durante downloads ativos no fallback
  useEffect(() => {
    if (!hasActiveDownloads || streamState === "live") return;
    const timer = setInterval(() => { void refreshDownloads(); }, 2000);
    return () => clearInterval(timer);
  }, [hasActiveDownloads, refreshDownloads, streamState]);

  const queuedCount = useMemo(
    () => downloadJobs.filter((j) => j.status === "queued" || j.status === "downloading" || j.status === "retry_wait").length,
    [downloadJobs]
  );

  return { downloadJobs, streamState, lastStreamTs, refreshDownloads, hasActiveDownloads, queuedCount };
}
