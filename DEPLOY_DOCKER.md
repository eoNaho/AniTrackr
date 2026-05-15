# Deploy com Docker (Linux)

Este projeto agora roda com `web` + `backend` via `docker compose`.

## 1) Pré-requisitos

- Docker Engine + Docker Compose plugin (`docker compose`)
- Portas livres: `3000` (web) e `3001` (backend)

## 2) Subir stack

```bash
docker compose up -d --build
```

Ou via scripts:

```bash
bun run docker:up
```

## 3) Verificar

```bash
docker compose ps
docker compose logs -f --tail=150
```

- Web: `http://SEU_SERVIDOR:3000`
- Backend health: `http://SEU_SERVIDOR:3001/health`

## 4) Persistência

Volumes nomeados:

- `anitrackr_data` -> dados do SQLite (`/data/.anitrackr/tracker.db`)
- `anitrackr_downloads` -> arquivos baixados (`/downloads`)

## 5) Configuração de download no app

No frontend, em configuração de download, use:

- `download_path`: `/downloads`
- `yt_dlp_path`: `yt-dlp`
- `ffmpeg_path`: `ffmpeg`
- `allow_simulated_downloads`: `false` (produção)

## 6) Atualizar versão

```bash
docker compose pull
docker compose up -d --build
```

## 7) Derrubar

```bash
docker compose down
```

> Não use `-v` no `down` se quiser manter banco e downloads.

## 8) Rodar com imagem pronta (sem build local)

Depois que o workflow `docker-publish` enviar imagens para GHCR, o usuario final pode:

```bash
# 1) baixar imagens
docker compose -f docker-compose.images.yml pull

# 2) subir stack
docker compose -f docker-compose.images.yml up -d
```

Ou pelos scripts:

```bash
bun run docker:pull:image
bun run docker:up:image
```

Tags:

- `latest` na branch `main`
- `v*` quando publicar tag (ex: `v2.1.0`)

Para usar tag especifica:

```bash
ANITRACKR_IMAGE_TAG=v2.1.0 docker compose -f docker-compose.images.yml up -d
```

Para usar outro owner (fork):

```bash
ANITRACKR_IMAGE_OWNER=SEU_USUARIO docker compose -f docker-compose.images.yml up -d
```

Se o nome do repositorio da imagem for diferente:

```bash
ANITRACKR_IMAGE_OWNER=SEU_USUARIO ANITRACKR_IMAGE_REPO=SEU_REPO docker compose -f docker-compose.images.yml up -d
```

> Nota: referencias de imagem Docker/GHCR devem ficar em minusculo (`owner/repo`).
