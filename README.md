# AniTrackr

**Dashboard de download e rastreamento de animes com estética de terminal CRT.**

Busca em múltiplos providers PT-BR e EN, baixa via yt-dlp ou qBittorrent + Nyaa.si, rastreia episódios locais, enriquece metadados com AniList/Kitsu/MAL (Jikan), e agenda downloads automáticos para séries em lançamento — tudo em uma interface de terminal com scanlines.

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Stack Técnica](#stack-técnica)
3. [Funcionalidades](#funcionalidades)
4. [Instalação](#instalação)
   - [Desenvolvimento Local](#desenvolvimento-local)
   - [Docker (Recomendado para Produção)](#docker-recomendado-para-produção)
5. [Uso](#uso)
   - [Biblioteca](#biblioteca-aba-library)
   - [Busca e Download](#busca-e-download-aba-search)
   - [Configurações](#configurações-aba--config)
6. [Providers de Anime](#providers-de-anime)
7. [Integração qBittorrent + Nyaa.si](#integração-qbittorrent--nyaasi)
8. [Auto-Schedule](#auto-schedule)
9. [Metadados (AniList / Kitsu / Jikan)](#metadados-anilist--kitsu--jikan)
10. [Notificações](#notificações)
11. [Backup Automático](#backup-automático)
12. [Referência de Configuração](#referência-de-configuração)
13. [Referência de API](#referência-de-api)
14. [Atalhos de Teclado](#atalhos-de-teclado)
15. [Variáveis de Ambiente](#variáveis-de-ambiente)
16. [Estrutura do Projeto](#estrutura-do-projeto)
17. [Troubleshooting](#troubleshooting)

---

## Visão Geral

O AniTrackr é uma aplicação full-stack para quem quer **automatizar o download e rastreamento de animes** sem depender de serviços em nuvem. Todos os dados ficam em um banco SQLite local (`~/.anitrackr/tracker.db`), sem necessidade de conta ou internet para a interface.

**O que ele faz:**
- Busca animes simultaneamente em até 7 providers (PT-BR e EN)
- Baixa episódios via yt-dlp (streams diretos) ou qBittorrent (torrents via Nyaa.si)
- Rastreia o que foi baixado e o que está faltando na biblioteca local
- Enriquece cada anime com poster, sinopse, episôdios, score, gêneros e status de lançamento
- Detecta automaticamente novos episódios de séries em andamento e enfileira o download
- Mostra progresso de download em tempo real via SSE (Server-Sent Events)
- Notifica via browser quando um episódio termina de baixar
- Faz backup semanal automático do banco de dados

---

## Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | **Bun** v1.3+ |
| Backend | **Elysia** (framework HTTP) + TypeScript |
| Frontend | **Next.js** 16 + React 19 + Tailwind CSS 4 |
| Banco de dados | **SQLite** via `bun:sqlite` (WAL mode) |
| Scrapers | **Cheerio** (HTML parsing) |
| Monorepo | Bun Workspaces |
| Deploy | Docker + Docker Compose |

---

## Funcionalidades

### Biblioteca
- Listagem de todos os animes adicionados com progresso de download
- Filtro por nome (busca local instantânea)
- Ordenação por: título, progresso, episódios faltando, rating, ano
- Painel de detalhes com poster, sinopse, tags, path local
- Visualizador de episódios individuais com status por episódio
- Marcação de episódios como assistidos (clique nos episódios baixados)
- Indicador visual de episódios filler e recaps (via Jikan/MAL)
- Estatísticas: queued, concluídos, faltando, storage total

### Busca e Download
- Busca simultânea em todos os providers configurados
- Seleção de episódios individuais ou em lote ("todos" / "nenhum")
- Criação automática da entrada na biblioteca ao enfileirar
- Enriquecimento de metadados via Kitsu na seleção do resultado
- Validação: botão de download desabilitado sem pasta configurada

### Fila de Downloads
- Monitor em tempo real via SSE (Server-Sent Events)
- Fallback para polling a cada 2s quando SSE não disponível
- Cancel, retry e retry em lote
- Limpeza do monitor (remove jobs finalizados)
- Suporte a yt-dlp (streams) e qBittorrent (torrents)

### Circuit Breaker por Provider
- Cada provider tem um estado: `closed` (normal) → `open` (falhas) → `half-open` (recuperando)
- Abre após 3 falhas consecutivas, fecha após 60s + 1 probe bem-sucedida
- Reset manual via API ou pela interface de configurações
- Fallback automático para o próximo provider disponível

### Metadados
- **Kitsu**: poster, sinopse, score, tipo, status, contagem de episódios
- **AniList**: dados detalhados, gêneros, tags, schedule de lançamento, mal_id
- **Jikan (MAL)**: título/sinopse por episódio, filler, recap
- Enriquecimento manual (`POST /api/metadata/enrich/:id`) ou pelo fluxo de busca
- Enriquecimento de episódios com dados do MAL (`POST /api/metadata/jikan/enrich/:id`)

### Torrent (qBittorrent + Nyaa.si)
- Busca no Nyaa.si com filtro por grupo, resolução e categoria
- Busca no AniRena (fonte alternativa PT-BR)
- Envio de magnet link ou URL de torrent diretamente ao qBittorrent
- Monitoramento automático de progresso (a cada 5s)
- Associação automática download torrent ↔ episódio na biblioteca
- Restauração do monitoramento após reinício do servidor

### Auto-Schedule
- Verifica series com `anilist_status = RELEASING` a cada hora
- Detecta episódios novos além do último baixado
- Enfileira automaticamente sem duplicar jobs existentes
- Controle via API: status, trigger manual

### Estatísticas
- Downloads por mês (gráfico de barras ASCII)
- Taxa de sucesso/falha por provider
- Totais: downloads, concluídos, falharam, bytes baixados

### Backup
- `VACUUM INTO` semanal → `~/.anitrackr/backups/tracker-YYYY-MM-DDTHH-MM-SS.db`
- Mantém os 4 backups mais recentes automaticamente
- Registra data do último backup na tabela `config`

---

## Instalação

### Pré-requisitos

- **Bun** >= 1.3 ([instalação](https://bun.sh))
- **yt-dlp** no PATH (`pip install yt-dlp` ou binário)
- **ffmpeg** no PATH (para remux/merge de streams)
- **qBittorrent** com Web UI habilitada *(opcional, para torrents)*

### Desenvolvimento Local

```bash
# 1. Clonar o repositório
git clone https://github.com/eoNaho/AniTrackr.git
cd AniTrackr

# 2. Instalar dependências
bun install

# 3. Iniciar backend + frontend simultaneamente
bun run dev
```

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001
- **Health check**: http://localhost:3001/health

O banco de dados é criado automaticamente em `~/.anitrackr/tracker.db` na primeira execução.

### Docker (Recomendado para Produção)

```bash
# Subir a stack completa
docker compose up -d --build

# Verificar status
docker compose ps
docker compose logs -f --tail=150

# Acessar
# Web:     http://localhost:3000
# Backend: http://localhost:3001/health
```

**Volumes persistentes:**
- `anitrackr_data` → banco SQLite em `/data/.anitrackr/tracker.db`
- `anitrackr_downloads` → arquivos baixados em `/downloads`

> **Atenção:** Nunca use `docker compose down -v` — isso apaga banco e downloads.

**Atualizar:**
```bash
docker compose up -d --build
```

---

## Uso

### Biblioteca (aba `[LIBRARY]`)

A aba Library é a tela principal. Mostra todos os animes adicionados com progresso de download.

**Navegação:**
- `↑` / `k` — selecionar anime anterior
- `↓` / `j` — selecionar próximo anime
- Clique direto em qualquer anime da lista

**Filtro e ordenação:**
- Digite no campo de filtro para busca instantânea por título
- Selecione a ordenação: `A→Z`, `Progresso`, `Faltando`, `Rating`, `Ano`

**Painel de detalhes (direita):**
- Poster (do Kitsu/AniList), ou ASCII art como fallback
- Informações: status, provider, qualidade, tamanho, rating, ano
- Barra de progresso de episódios baixados
- **Visualizador de episódios individuais** — grade com ícone por status:
  - `✓` verde → baixado
  - `↓` azul → baixando agora
  - `◷` amarelo → na fila
  - `○` cinza → faltando
  - `✕` vermelho → falhou
  - ⬜ opaco → filler (via MAL)
  - 👁 → episódio marcado como assistido
  - *Clique em episódios `✓` baixados para marcar/desmarcar como assistido*

**Ações (botões e atalhos):**

| Tecla | Ação |
|-------|------|
| `d` | Enfileirar episódios faltando do anime selecionado |
| `b` | Enfileirar faltando de **todos** os animes rastreados |
| `s` | Escanear pasta local (detecta novos arquivos) |
| `r` | Atualizar biblioteca |
| `x` | Remover anime do banco (não apaga arquivos) |

**Monitor de downloads (painel inferior):**
- Lista todos os jobs com status, progresso, velocidade, tentativas
- Ações: `cancel`, `retry` por job
- Ações globais: `retry failed` (lote), `cancel all`, `clear monitor`
- Indicador de modo SSE: `SSE live` (tempo real) ou `fallback polling`

---

### Busca e Download (aba `[SEARCH]`)

**Fluxo básico:**

1. Digite o nome do anime no campo de busca
2. Selecione o provider (ou `all providers` para buscar em todos)
3. Pressione `Enter` ou clique `BUSCAR`
4. Clique em um resultado — carrega metadados Kitsu + lista de episódios
5. Selecione os episódios desejados (checkbox)
6. Clique `▶ ENFILEIRAR N EPISÓDIOS`

**Seleção de episódios:**
- `todos` → seleciona todos os episódios listados
- `nenhum` → deseleciona tudo
- Clique individual em cada checkbox

**Requisito para baixar:**
A pasta de download deve estar configurada em `[⚙ config]`. Se não estiver, o botão fica desabilitado e um aviso aparece acima dele.

**Providers disponíveis na busca:**

| Valor | Provider | Idioma |
|-------|----------|--------|
| `all` | Todos simultâneos | PT-BR + EN |
| `animefire` | AnimeFire | PT-BR |
| `goyabu` | Goyabu | PT-BR |
| `animedrive` | AnimeDrive | PT-BR |
| `superflix` | SuperFlix | PT-BR |
| `dattebayo` | DatteBayo BR | PT-BR |
| `allanime` | AllAnime | EN |
| `nineanime` | 9Anime | EN |

---

### Configurações (aba `[⚙ config]`)

#### Download

| Campo | Descrição | Padrão |
|-------|-----------|--------|
| Pasta de destino | Onde os arquivos serão salvos | `~/Anime` |
| Qualidade padrão | Resolução preferida pelo yt-dlp | `1080p` |
| Esquema de nomes | Formato dos arquivos/pastas | `jellyfin` |
| Downloads simultâneos | Máximo de jobs paralelos | `3` |
| Provider padrão | Provider preferido | `animefire` |
| Preferir legenda (sub) | Sub vs Dub em providers que suportam | `true` |
| Downloads simulados | Modo dev (não baixa de verdade) | `false` |

**Esquemas de nomes disponíveis:**
- `jellyfin` → `Titulo (Ano)/Season XX/Titulo - SXXEXX.mkv`
- `plex` → mesmo formato do Jellyfin
- `simple` → `Titulo/EpXX.mkv`

#### yt-dlp / ffmpeg

| Campo | Descrição | Padrão |
|-------|-----------|--------|
| Caminho do yt-dlp | Executável no PATH ou caminho absoluto | `yt-dlp` |
| Caminho do ffmpeg | Executável no PATH ou caminho absoluto | `ffmpeg` |
| Retry automático | Retentar downloads com falha | `true` |
| Tentativas máx. | Número de retries | `3` |
| Delay base (s) | Espera inicial entre retries | `20` |
| Delay máx. (s) | Teto de espera (backoff exponencial) | `900` |

#### qBittorrent

| Campo | Descrição | Padrão |
|-------|-----------|--------|
| Habilitar integração | Ativa o client qBittorrent | `false` |
| Endereço WebUI | URL da interface Web do qBittorrent | `http://localhost:8080` |
| Usuário | Username da WebUI | `admin` |
| Senha | Senha da WebUI (armazenada, mascarada na API) | `adminadmin` |
| Pasta de download | Sobrescreve a pasta padrão para torrents | *(usa pasta padrão)* |

> Use `testar conexão` para validar as credenciais sem precisar salvar manualmente.

#### Nyaa.si — Torrent

| Campo | Descrição | Padrão |
|-------|-----------|--------|
| Grupo preferido | Grupo de fansub preferido | `SubsPlease` |
| Resolução preferida | Resolução preferida nos resultados | `1080p` |
| Categoria padrão | Categoria de busca no Nyaa | `Anime — English Translated` |

Grupos populares com atalho rápido: `SubsPlease`, `Erai-raws`, `HorribleSubs`, `Judas`, `Yameii`.

#### Estatísticas e Auto-Schedule

Mostra:
- Downloads concluídos / falhados / total de bytes baixados
- Gráfico de barras por mês (últimos 12 meses)
- Taxa de sucesso por provider
- Status do auto-scheduler e botão "verificar agora"

#### Provider Health (Circuit Breakers)

Lista o estado de cada provider com:
- `●` verde → `closed` (normal)
- `◐` amarelo → `half-open` (recuperando)
- `✕` vermelho → `open` (bloqueado por falhas)

Botão `reset` disponível quando provider está fora de `closed`.

---

## Providers de Anime

### Providers PT-BR

| ID | Nome | Tecnologia | Características |
|----|------|-----------|-----------------|
| `animefire` | AnimeFire | HTML scraping | Principal PT-BR. Alta disponibilidade. |
| `goyabu` | Goyabu | WordPress REST API + HTML | Alternativa PT-BR. Boa cobertura. |
| `animedrive` | AnimeDrive | WordPress DooPlay API | Provider PT-BR com streams MP4/HLS diretos. |
| `superflix` | SuperFlix | CSRF tokens + bootstrap API | Filmes, séries e animes. Requer autenticação no site. |
| `dattebayo` | DatteBayo BR | HTML scraping | Especializado em séries populares PT-BR. |

### Providers EN

| ID | Nome | Tecnologia | Características |
|----|------|-----------|-----------------|
| `allanime` | AllAnime | GraphQL + AES-256-CTR | Melhor fonte EN. Suporte sub/dub. Alta qualidade. |
| `nineanime` | 9Anime | AJAX + Rapid-Cloud | Alternativa EN. Sub/Dub. |

### Provider Chain e Fallback

Quando um provider falha, o sistema tenta automaticamente o próximo na cadeia:

```
animefire → goyabu → allanime → nineanime → animedrive → dattebayo
```

O circuit breaker garante que providers com falhas recentes sejam pulados até se recuperarem.

### Nyaa.si (Torrents)

Busca dedicada de torrents anime. Retorna resultados ordenados por:
1. Grupo preferido configurado (ex: `SubsPlease`)
2. Resolução preferida (ex: `1080p`)
3. Número de seeders

---

## Integração qBittorrent + Nyaa.si

### Configuração

1. Abra o qBittorrent → `Ferramentas > Preferências > Web UI`
2. Habilite a Web UI e configure usuário/senha
3. No AniTrackr, vá em `[⚙ config] > [QBITTORRENT]`
4. Preencha endereço, usuário e senha
5. Clique `testar conexão`

### Fluxo de Download por Torrent

1. Vá em `[⚙ config]` e habilite a integração qBittorrent
2. Na aba `[SEARCH]`, busque o anime normalmente
3. Após adicionar à biblioteca, use a API diretamente ou a busca Nyaa:

```bash
# Buscar no Nyaa via API
GET /api/nyaa/search?q=One+Piece+1100&group=SubsPlease&resolution=1080p

# Enviar torrent ao qBittorrent
POST /api/torrent/add
{
  "magnetLink": "magnet:?xt=urn:btih:...",
  "animeId": "uuid-do-anime",
  "episodeNumber": 1100,
  "season": 1,
  "infoHash": "abc123..."
}
```

### Monitoramento de Torrents

O backend monitora automaticamente todos os torrents ativos a cada 5 segundos e atualiza:
- Status do download na tabela `downloads`
- Status do episódio na tabela `episodes`
- `last_download` no anime quando concluído

Ao reiniciar o servidor, os torrents em andamento são restaurados automaticamente.

---

## Auto-Schedule

O auto-scheduler verifica séries em lançamento automaticamente a cada **1 hora** e enfileira novos episódios sem intervenção manual.

### Como Funciona

1. Seleciona animes com `anilist_status = 'RELEASING'` e `source_url` definido
2. Para cada anime, busca os episódios disponíveis no provider (usa cache de 5min)
3. Compara com o episódio mais alto já baixado ou na fila
4. Enfileira apenas episódios novos, sem duplicar jobs existentes
5. Aguarda 1s entre animes para não sobrecarregar os providers

### Configurar um Anime para Auto-Schedule

O anime precisa:
1. Estar na biblioteca (`is_tracked = 1`)
2. Ter `anilist_status = 'RELEASING'` (definido pelo enriquecimento AniList)
3. Ter `source_url` válido (URL do anime no provider)

Para enriquecer com AniList:
```bash
POST /api/metadata/enrich/:id
```

### Controle

```bash
# Verificar status do scheduler
GET /api/auto-schedule/status

# Forçar verificação imediata
POST /api/auto-schedule/run
```

Ou via interface: `[⚙ config] > [ESTATÍSTICAS] > verificar agora`

---

## Metadados (AniList / Kitsu / Jikan)

### Enriquecimento Manual

```bash
# Enriquecer com AniList (poster, gêneros, status, mal_id, etc.)
POST /api/metadata/enrich/:id

# Sincronizar episódios com MAL via Jikan (título, filler, recap)
POST /api/metadata/jikan/enrich/:id
```

O segundo endpoint requer que o anime já tenha `mal_id` (definido pelo primeiro).

### Busca de Metadados

```bash
# Busca AniList (padrão)
GET /api/metadata/search?q=Naruto&source=anilist

# Busca Kitsu
GET /api/metadata/search?q=Naruto&source=kitsu

# Ambas as fontes
GET /api/metadata/search?q=Naruto&source=all

# Busca no MAL via Jikan
GET /api/metadata/jikan/search?q=Naruto

# Episódios de um anime pelo MAL ID
GET /api/metadata/jikan/:malId/episodes

# Episódio específico
GET /api/metadata/jikan/:malId/episode/:ep
```

### Schedule de Lançamento

```bash
# Próximos episódios de uma série (via AniList)
GET /api/metadata/anilist/:id/airing
```

---

## Notificações

O AniTrackr solicita permissão de notificação do browser automaticamente na primeira abertura.

Quando um episódio termina de baixar, aparece uma notificação do sistema:
```
✓ Download concluído
Attack on Titan — Ep 87
```

Para funcionar, é necessário:
1. Conceder permissão de notificação quando solicitado
2. O browser deve estar aberto (a aba pode estar em segundo plano)

---

## Backup Automático

O banco SQLite é salvo automaticamente **uma vez por semana** usando `VACUUM INTO`, que cria uma cópia compactada e consistente.

**Local dos backups:**
```
~/.anitrackr/backups/tracker-2026-05-14T10-30-00.db
```

**Políticas:**
- Máximo de 4 backups mantidos (os mais antigos são removidos)
- Data e hora no nome do arquivo
- Executa na inicialização do servidor se o intervalo de 7 dias passou

**Restaurar um backup:**
```bash
# Parar o servidor
# Substituir o banco atual pelo backup
cp ~/.anitrackr/backups/tracker-2026-05-14T10-30-00.db ~/.anitrackr/tracker.db
# Reiniciar o servidor
```

---

## Referência de Configuração

Todas as configurações são armazenadas no SQLite (tabela `config`) e podem ser lidas/alteradas via API ou pela interface.

| Chave | Tipo | Descrição | Padrão |
|-------|------|-----------|--------|
| `download_path` | string | Pasta de destino dos downloads | `~/Anime` |
| `quality` | string | Qualidade preferida (`1080p`, `720p`, etc.) | `1080p` |
| `provider` | string | Provider padrão | `animefire` |
| `max_concurrent` | number | Downloads simultâneos | `3` |
| `language` | string | Idioma preferido | `pt-BR` |
| `naming_scheme` | string | Esquema de nomes de arquivo | `jellyfin` |
| `prefer_sub` | bool | Preferir legendado sobre dublado | `true` |
| `allow_simulated_downloads` | bool | Modo dev: não baixa de verdade | `true` |
| `yt_dlp_path` | string | Caminho do executável yt-dlp | `yt-dlp` |
| `ffmpeg_path` | string | Caminho do executável ffmpeg | `ffmpeg` |
| `auto_retry_enabled` | bool | Retry automático em falhas | `true` |
| `retry_max_attempts` | number | Máximo de tentativas | `3` |
| `retry_base_delay_seconds` | number | Delay inicial entre retries | `20` |
| `retry_max_delay_seconds` | number | Teto do delay (backoff exp.) | `900` |
| `qbittorrent_enabled` | bool | Habilitar integração qBittorrent | `false` |
| `qbittorrent_host` | string (URL) | Endereço da WebUI | `http://localhost:8080` |
| `qbittorrent_username` | string | Usuário da WebUI | `admin` |
| `qbittorrent_password` | string | Senha da WebUI *(mascarada na API)* | `adminadmin` |
| `qbittorrent_save_path` | string | Pasta de destino no qBittorrent | *(usa download_path)* |
| `nyaa_preferred_group` | string | Grupo fansub preferido | `SubsPlease` |
| `nyaa_preferred_resolution` | string | Resolução preferida | `1080p` |
| `nyaa_default_category` | string | Categoria padrão no Nyaa | `1_2` |

---

## Referência de API

O backend expõe uma REST API completa em `http://localhost:3001`.

### Health

```
GET  /health
```

### Busca

```
GET  /api/search?q=&source=all|animefire|goyabu|allanime|...
GET  /api/search/episodes?url=&provider=&allAnimeId=
GET  /api/search/stream?allAnimeId=&episode=&mode=sub|dub&quality=best
GET  /api/search/providers
```

### Biblioteca

```
GET    /api/library?q=&status=&provider=&sort=title|rating|year|recent|missing
POST   /api/library
GET    /api/library/:id
PATCH  /api/library/:id
DELETE /api/library/:id

GET    /api/library/:id/episodes?season=
PATCH  /api/library/:id/episodes/:ep    { watched?, watchProgress?, status? }

GET    /api/library/stats/summary

POST   /api/library/:id/scan
POST   /api/library/scan/all
POST   /api/library/:id/rename?dry=true
```

### Downloads / Fila

```
GET  /api/downloads?status=
GET  /api/downloads/stream          ← SSE
GET  /api/downloads/stats
GET  /api/downloads/health
GET  /api/downloads/history

POST /api/queue                     { animeId, episodes[], season?, sourceUrl? }
POST /api/queue/missing             { animeId, season? }
POST /api/queue/missing-all         { statusFilter? }

POST /api/downloads/:id/retry
POST /api/downloads/retry-failed    { limit? }
DELETE /api/downloads/:id
DELETE /api/downloads/all
DELETE /api/downloads/monitor

GET  /api/auto-schedule/status
POST /api/auto-schedule/run
```

### Metadados

```
GET  /api/metadata/search?q=&source=kitsu|anilist|all
GET  /api/metadata/anilist/:id
GET  /api/metadata/anilist/:id/airing
GET  /api/metadata/kitsu/:kitsuId

POST /api/metadata/enrich/:id
POST /api/metadata/save             { title, provider, anilistId, malId, ... }

GET  /api/metadata/jikan/search?q=
GET  /api/metadata/jikan/:malId/episodes
GET  /api/metadata/jikan/:malId/episode/:ep
POST /api/metadata/jikan/enrich/:id
```

### Torrent / Nyaa.si

```
GET  /api/nyaa/search?q=&category=&group=&resolution=&limit=
GET  /api/anirena/search?q=&page=&group=&resolution=&limit=

GET  /api/torrent/status
GET  /api/torrent/list
GET  /api/torrent/:hash
GET  /api/torrent/categories

POST /api/torrent/add               { magnetLink?, torrentUrl?, animeId?, episodeNumber?, season?, infoHash? }
POST /api/torrent/:hash/pause
POST /api/torrent/:hash/resume
DELETE /api/torrent/:hash?deleteFiles=true
```

### Providers / Circuit Breakers

```
GET  /api/providers/health
POST /api/providers/:name/reset
```

### Configuração

```
GET  /api/config
GET  /api/config/:key
POST /api/config                    { key: value, ... }
PUT  /api/config/:key               { value }
```

### Jellyfin / Plex

```
GET  /api/jellyfin/nfo/:id
GET  /api/jellyfin/posters/:id
```

### Legendas

```
GET  /api/subtitles/search?title=&season=&episode=
POST /api/subtitles/auto            { animeId }
```

---

## Atalhos de Teclado

Todos os atalhos funcionam na aba `[LIBRARY]` quando o foco não está em um input.

| Tecla | Ação |
|-------|------|
| `Tab` | Alternar entre abas (Library → Search → Config → Library) |
| `↑` / `k` | Navegar para o anime anterior |
| `↓` / `j` | Navegar para o próximo anime |
| `d` | Enfileirar episódios faltando do anime selecionado |
| `b` | Enfileirar faltando de **todos** os animes rastreados |
| `s` | Escanear pasta local do anime selecionado |
| `r` | Atualizar biblioteca e fila |

---

## Variáveis de Ambiente

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do servidor HTTP | `3001` |
| `ANITRACKR_DATA_DIR` | Diretório raiz dos dados (banco, backups) | `~` (home) |
| `ANITRACKR_DOWNLOAD_PATH` | Pasta padrão de downloads | `~/Anime` |
| `OPENSUBTITLES_API_KEY` | Chave para busca de legendas no OpenSubtitles | *(opcional)* |

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `NEXT_PUBLIC_BACKEND_URL` | URL do backend vista pelo browser | *(usa mesma origem)* |
| `BACKEND_INTERNAL_URL` | URL interna do backend (Docker SSR) | `http://backend:3001` |

---

## Estrutura do Projeto

```
anitrackr/
├── apps/
│   ├── backend/
│   │   └── src/
│   │       ├── index.ts               ← Entry point, startup hooks
│   │       ├── db/
│   │       │   └── index.ts           ← Schema SQLite + índices + config padrão
│   │       ├── routes/
│   │       │   ├── config.ts          ← GET/POST /api/config
│   │       │   ├── downloads.ts       ← Fila, SSE, histórico, auto-schedule
│   │       │   ├── library.ts         ← CRUD biblioteca + episódios + scanner
│   │       │   ├── metadata.ts        ← AniList, Kitsu, Jikan
│   │       │   ├── search.ts          ← Busca por provider
│   │       │   ├── torrent.ts         ← qBittorrent, Nyaa, circuit breakers
│   │       │   ├── jellyfin.ts        ← NFO + posters Jellyfin
│   │       │   └── subtitles.ts       ← Busca de legendas
│   │       ├── services/
│   │       │   ├── provider-chain.ts  ← Fallback chain + cache de episódios
│   │       │   ├── circuit-breaker.ts ← Estado closed/open/half-open
│   │       │   ├── auto-schedule.ts   ← Scheduler horário de novos eps
│   │       │   ├── backup.ts          ← VACUUM INTO semanal
│   │       │   ├── downloader.ts      ← Fila de downloads (yt-dlp)
│   │       │   ├── scanner.ts         ← Scan de arquivos locais
│   │       │   ├── scraper.ts         ← AnimeFire + Goyabu
│   │       │   ├── allanime.ts        ← AllAnime GraphQL + AES
│   │       │   ├── nineanime.ts       ← 9Anime AJAX
│   │       │   ├── animedrive.ts      ← AnimeDrive DooPlay
│   │       │   ├── superflix.ts       ← SuperFlix CSRF
│   │       │   ├── dattebayo.ts       ← DatteBayo BR
│   │       │   ├── nyaa.ts            ← Nyaa.si RSS parser
│   │       │   ├── anirena.ts         ← AniRena
│   │       │   ├── qbittorrent.ts     ← qBittorrent Web API v2 client
│   │       │   ├── anilist.ts         ← AniList GraphQL
│   │       │   ├── kitsu.ts           ← Kitsu REST API
│   │       │   ├── jikan.ts           ← Jikan v4 (MAL)
│   │       │   └── source-resolver.ts ← Resolução de stream URL
│   │       └── utils/
│   │           └── logger.ts
│   └── web/
│       └── src/
│           ├── lib/
│           │   └── api.ts             ← Funções de acesso à API do backend
│           └── components/home/
│               ├── tracker-home.tsx   ← Componente raiz, estado global
│               ├── library-view.tsx   ← Aba biblioteca + filtro/sort
│               ├── search-view.tsx    ← Aba busca
│               ├── settings-view.tsx  ← Aba config + stats
│               ├── episode-list.tsx   ← Grid de episódios individuais
│               └── ui.tsx             ← Componentes base (Panel, Badge, etc.)
├── docker-compose.yml
├── DEPLOY_DOCKER.md
└── package.json
```

---

## Troubleshooting

### Backend não inicia

```bash
# Verificar se a porta 3001 está livre
lsof -i :3001

# Verificar versão do Bun
bun --version  # >= 1.3

# Logs de erro
bun run dev:backend
```

### Downloads ficam presos em "queued"

1. Verifique se `allow_simulated_downloads` está `false` em `[⚙ config]`
2. Verifique se `yt-dlp` está instalado: `yt-dlp --version`
3. Verifique se a pasta de download existe e tem permissão de escrita
4. Verifique os logs do backend

### Provider retornando "sem episódios"

1. O provider pode estar com circuit breaker `open` — verifique em `[⚙ config] > [PROVIDERS / HEALTH]`
2. Use `reset` para forçar uma nova tentativa
3. O site do provider pode estar em manutenção — tente outro provider

### qBittorrent não conecta

1. Verifique se a Web UI está habilitada no qBittorrent
2. Certifique-se que o endereço usa `http://` ou `https://` (obrigatório)
3. Use o botão `testar conexão` antes de salvar
4. Em Docker, use o IP da máquina host, não `localhost` (ex: `http://192.168.1.100:8080`)

### Metadados não carregam (poster, sinopse)

1. Os metadados vêm de APIs externas (AniList, Kitsu) — verifique a conexão com a internet
2. Use `POST /api/metadata/enrich/:id` manualmente para forçar o enriquecimento
3. O Jikan (MAL) tem rate limit de 3 req/s — aguarde alguns segundos entre buscas intensas

### Banco de dados corrompido

```bash
# Verificar integridade
sqlite3 ~/.anitrackr/tracker.db "PRAGMA integrity_check;"

# Restaurar backup mais recente
ls ~/.anitrackr/backups/
cp ~/.anitrackr/backups/tracker-MAIS-RECENTE.db ~/.anitrackr/tracker.db
```

### Auto-schedule não enfileira novos episódios

1. O anime precisa ter `anilist_status = 'RELEASING'` — use `POST /api/metadata/enrich/:id`
2. O `source_url` precisa estar definido (URL do anime no provider)
3. Verifique se há jobs duplicados: o scheduler pula episódios já na fila ou concluídos
4. Force uma verificação manual via `POST /api/auto-schedule/run`

### SSE desconecta constantemente

A interface cai automaticamente para `fallback polling` (a cada 2s) quando o SSE desconecta — os dados continuam atualizando. Isso é normal atrás de proxies reversos sem suporte a streaming. Para resolver com Nginx:

```nginx
location /api/downloads/stream {
    proxy_pass http://localhost:3001;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding on;
}
```

---

## Licença

Este projeto é de uso pessoal. Os scrapers acessam sites de terceiros — use com responsabilidade e respeite os termos de serviço de cada site.
