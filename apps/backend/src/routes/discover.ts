import Elysia, { t } from "elysia";
import db from "../db/index.ts";
import { getAniListAnime } from "../services/anilist.ts";

export const discoverRoutes = new Elysia({ prefix: "/discover" })
  .get("/", async ({ query }) => {
    const { basedOn } = query;
    if (!basedOn) return { error: "Parâmetro basedOn é obrigatório" };

    const anime = db.query<{
      anilist_id: number | null; title: string; genres: string;
    }, [string]>(`
      SELECT anilist_id, title, genres FROM animes WHERE id = ?
    `).get(basedOn);

    if (!anime?.anilist_id) {
      return { basedOn, recommendations: [], reason: "Sem anilist_id para buscar recomendações" };
    }

    const anilistData = await getAniListAnime(anime.anilist_id).catch(() => null);
    if (!anilistData) return { basedOn, recommendations: [] };

    const libraryAnilistIds = new Set(
      db.query<{ anilist_id: number }, []>(
        `SELECT anilist_id FROM animes WHERE anilist_id IS NOT NULL`
      ).all().map((r) => r.anilist_id)
    );

    // Usa relações do AniList (sequels, prequels, side stories) como recomendações
    const related = (anilistData.relations?.edges ?? [])
      .filter((edge) =>
        !libraryAnilistIds.has(edge.node.id) &&
        ["SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE"].includes(edge.relationType) &&
        edge.node.format !== "MUSIC" && edge.node.format !== "MANGA"
      )
      .map((edge) => ({
        anilistId: edge.node.id,
        title: edge.node.title.english ?? edge.node.title.romaji,
        titleRomaji: edge.node.title.romaji,
        relationType: edge.relationType,
        format: edge.node.format,
      }))
      .slice(0, 10);

    return { basedOn, basedOnTitle: anime.title, recommendations: related };
  }, {
    query: t.Object({ basedOn: t.Optional(t.String()) }),
  });
