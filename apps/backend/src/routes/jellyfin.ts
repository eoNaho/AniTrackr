import Elysia, { t } from "elysia";
import { generateNfo, generateNfoAll, downloadPosters } from "../services/jellyfin.ts";
import { logger } from "../utils/logger.ts";

function jsonError(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const jellyfinRoutes = new Elysia({ prefix: "/jellyfin" })

  // POST /api/jellyfin/nfo/:id — gera NFO para um anime
  .post("/nfo/:id", async ({ params, query }) => {
    const downloadImages = query.images !== "false";
    try {
      const result = await generateNfo(params.id, downloadImages);
      logger.info("jellyfin", `nfo generated for ${params.id}: ${result.episodesNfo} episode nfos`);
      return { ok: true, ...result };
    } catch (err) {
      return jsonError(String(err), 500);
    }
  }, {
    params: t.Object({ id: t.String() }),
    query: t.Object({ images: t.Optional(t.String()) }),
  })

  // POST /api/jellyfin/nfo/all — gera NFO para toda a biblioteca
  .post("/nfo/all", async ({ query }) => {
    const downloadImages = query.images === "true";
    const result = await generateNfoAll(downloadImages);
    return { ok: true, ...result };
  }, {
    query: t.Object({ images: t.Optional(t.String()) }),
  })

  // POST /api/jellyfin/posters/:id — baixa poster.jpg e fanart.jpg
  .post("/posters/:id", async ({ params }) => {
    try {
      const result = await downloadPosters(params.id);
      return { ok: true, ...result };
    } catch (err) {
      return jsonError(String(err), 500);
    }
  }, { params: t.Object({ id: t.String() }) });
