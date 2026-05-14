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

- `goanime_data` -> dados do SQLite (`/data/.goanime/tracker.db`)
- `goanime_downloads` -> arquivos baixados (`/downloads`)

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
