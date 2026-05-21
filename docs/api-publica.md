# API Pública do AniTrackr

A API pública permite que você construa suas próprias integrações com a sua instância self-hosted do AniTrackr — bots de Discord, bots de Telegram, scripts de automação, CLIs, painéis externos, apps mobile, etc.

## Autenticação

Todas as rotas `/api/v1/*` (exceto `/api/v1/health`) exigem uma API Key.

Gere sua chave em **Settings → API Keys** na interface web.

### Header obrigatório

```http
Authorization: Bearer <sua_api_key>
```

Ou, como alternativa:

```http
X-API-Key: <sua_api_key>
```

A chave é mostrada **apenas uma vez** na criação. Guarde-a em segredo — ela não pode ser recuperada.

---

## Escopos disponíveis

| Escopo          | O que permite                        |
|-----------------|--------------------------------------|
| `search:read`   | Buscar animes e listar episódios     |
| `library:read`  | Ler a biblioteca local               |
| `downloads:read`| Consultar a fila e status de downloads|
| `queue:write`   | Enfileirar episódios para download   |
| `config:read`   | Ler configurações do servidor        |
| `admin`         | Acesso completo (inclui todos acima) |

---

## Endpoints

### `GET /api/v1/health` — público

Verifica se o servidor está no ar.

```bash
curl http://localhost:3001/api/v1/health
```

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "version": "2.1.1",
    "timestamp": "2026-05-20T03:00:00.000Z",
    "scopes": ["search:read", "library:read", "downloads:read", "queue:write", "config:read", "admin"]
  }
}
```

---

### `GET /api/v1/search` — escopo: `search:read`

Busca animes nos providers configurados.

| Parâmetro | Tipo   | Obrigatório | Descrição                                        |
|-----------|--------|-------------|--------------------------------------------------|
| `q`       | string | sim         | Termo de busca (mínimo 2 caracteres)             |
| `source`  | string | não         | Provider: `animefire`, `goyabu`, `allanime`, etc. Padrão: todos |

```bash
curl "http://localhost:3001/api/v1/search?q=attack+on+titan" \
  -H "Authorization: Bearer atk_..."
```

```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "title": "Shingeki no Kyojin",
        "url": "https://...",
        "provider": "animefire",
        "posterUrl": "https://...",
        "year": 2013
      }
    ],
    "total": 5,
    "source": "all"
  }
}
```

---

### `GET /api/v1/search/episodes` — escopo: `search:read`

Lista episódios de um anime que já está na sua biblioteca.

| Parâmetro | Tipo   | Obrigatório | Descrição                        |
|-----------|--------|-------------|----------------------------------|
| `animeId` | string | sim         | ID do anime na biblioteca local  |
| `season`  | number | não         | Número da temporada. Padrão: 1   |

```bash
curl "http://localhost:3001/api/v1/search/episodes?animeId=uuid-aqui&season=1" \
  -H "Authorization: Bearer atk_..."
```

```json
{
  "ok": true,
  "data": {
    "animeId": "uuid-aqui",
    "title": "Shingeki no Kyojin",
    "season": 1,
    "episodes": [
      { "number": 1, "title": "Para Além das Muralhas", "url": "https://..." }
    ],
    "total": 25
  }
}
```

---

### `GET /api/v1/library` — escopo: `library:read`

Lista os animes na sua biblioteca.

| Parâmetro | Tipo   | Padrão | Descrição                    |
|-----------|--------|--------|------------------------------|
| `page`    | number | 1      | Página atual                 |
| `limit`   | number | 20     | Itens por página (máx. 100)  |

```bash
curl "http://localhost:3001/api/v1/library?limit=10" \
  -H "Authorization: Bearer atk_..."
```

```json
{
  "ok": true,
  "data": {
    "animes": [
      {
        "id": "uuid",
        "title": "Shingeki no Kyojin",
        "title_english": "Attack on Titan",
        "episode_count": 25,
        "downloaded_count": 25,
        "download_status": "Downloaded",
        "rating": 9.0,
        "year": 2013
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 10,
    "pages": 5
  }
}
```

---

### `GET /api/v1/library/:id` — escopo: `library:read`

Detalhes de um anime específico com lista de episódios.

```bash
curl "http://localhost:3001/api/v1/library/uuid-aqui" \
  -H "Authorization: Bearer atk_..."
```

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "title": "Shingeki no Kyojin",
    "synopsis": "...",
    "genres": ["Action", "Drama"],
    "episodes": [
      { "number": 1, "season": 1, "status": "downloaded", "watched": 1 }
    ]
  }
}
```

---

### `GET /api/v1/downloads` — escopo: `downloads:read`

Consulta a fila de downloads.

| Parâmetro | Tipo   | Descrição                                                         |
|-----------|--------|-------------------------------------------------------------------|
| `status`  | string | Filtrar por status: `queued`, `downloading`, `completed`, `failed` |

```bash
curl "http://localhost:3001/api/v1/downloads?status=downloading" \
  -H "Authorization: Bearer atk_..."
```

```json
{
  "ok": true,
  "data": {
    "jobs": [
      {
        "id": "uuid",
        "animeTitle": "Shingeki no Kyojin",
        "episode": 3,
        "season": 1,
        "status": "downloading",
        "progress": 47,
        "speedKbps": 8192,
        "provider": "animefire"
      }
    ],
    "total": 1
  }
}
```

---

### `POST /api/v1/queue` — escopo: `queue:write`

Enfileira episódios para download. O anime precisa já estar na biblioteca.

```bash
curl -X POST "http://localhost:3001/api/v1/queue" \
  -H "Authorization: Bearer atk_..." \
  -H "Content-Type: application/json" \
  -d '{"animeId": "uuid-aqui", "episodes": [1, 2, 3], "season": 1}'
```

```json
{
  "ok": true,
  "message": "queued",
  "queued": 3,
  "jobs": [
    { "id": "uuid", "episode": 1, "season": 1, "status": "queued" },
    { "id": "uuid", "episode": 2, "season": 1, "status": "queued" },
    { "id": "uuid", "episode": 3, "season": 1, "status": "queued" }
  ]
}
```

#### Idempotência

Para evitar downloads duplicados em retries acidentais, envie o header `Idempotency-Key`:

```bash
curl -X POST "http://localhost:3001/api/v1/queue" \
  -H "Authorization: Bearer atk_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: meu-request-unico-123" \
  -d '{"animeId": "uuid-aqui", "episodes": [1]}'
```

Se a mesma chave for enviada dentro de 60 segundos, o servidor responde com `queued: 0` sem criar novos jobs.

---

### `GET /api/v1/providers` — escopo: `search:read`

Lista os providers disponíveis e seus status.

```bash
curl "http://localhost:3001/api/v1/providers" \
  -H "Authorization: Bearer atk_..."
```

---

## Erros comuns

| Status | `error`               | Causa                                      |
|--------|-----------------------|--------------------------------------------|
| 401    | `unauthorized`        | Header ausente ou chave inválida           |
| 401    | `api_key_revoked`     | Chave foi revogada                         |
| 401    | `api_key_expired`     | Chave expirou                              |
| 403    | `insufficient_scope`  | Chave não tem o escopo necessário          |
| 404    | `not_found`           | Recurso não encontrado                     |
| 422    | `validation_error`    | Payload inválido                           |
| 500    | `search_error`        | Erro interno na busca                      |

Formato padrão de erro:

```json
{
  "ok": false,
  "error": "insufficient_scope",
  "message": "Required scope: queue:write"
}
```

---

## Fluxo completo — exemplo em curl

```bash
HOST="http://localhost:3001"
KEY="atk_..."

# 1. Verificar saúde
curl "$HOST/api/v1/health"

# 2. Buscar anime
curl "$HOST/api/v1/search?q=bleach" -H "Authorization: Bearer $KEY"

# 3. Pegar ID da biblioteca (o anime precisa ter sido adicionado via UI)
curl "$HOST/api/v1/library" -H "Authorization: Bearer $KEY"

# 4. Listar episódios disponíveis
curl "$HOST/api/v1/search/episodes?animeId=UUID&season=1" \
  -H "Authorization: Bearer $KEY"

# 5. Enfileirar download
curl -X POST "$HOST/api/v1/queue" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"animeId":"UUID","episodes":[1,2,3],"season":1}'

# 6. Consultar progresso
curl "$HOST/api/v1/downloads?status=downloading" \
  -H "Authorization: Bearer $KEY"
```

---

## Exemplo em Node.js

```js
const HOST = "http://localhost:3001";
const KEY = "atk_...";

const headers = {
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function searchAnime(query) {
  const res = await fetch(`${HOST}/api/v1/search?q=${encodeURIComponent(query)}`, { headers });
  const json = await res.json();
  return json.data.results;
}

async function queueEpisodes(animeId, episodes, season = 1) {
  const res = await fetch(`${HOST}/api/v1/queue`, {
    method: "POST",
    headers,
    body: JSON.stringify({ animeId, episodes, season }),
  });
  return res.json();
}

async function getDownloads(status) {
  const url = status
    ? `${HOST}/api/v1/downloads?status=${status}`
    : `${HOST}/api/v1/downloads`;
  const res = await fetch(url, { headers });
  const json = await res.json();
  return json.data.jobs;
}

// Fluxo completo
const results = await searchAnime("fullmetal alchemist");
console.log("Resultados:", results.length);

const library = await fetch(`${HOST}/api/v1/library`, { headers }).then(r => r.json());
const anime = library.data.animes.find(a => a.title.includes("Fullmetal"));

if (anime) {
  const queued = await queueEpisodes(anime.id, [1, 2, 3, 4, 5]);
  console.log(`Enfileirados: ${queued.queued} episódios`);

  const downloads = await getDownloads("downloading");
  console.log("Baixando agora:", downloads.length);
}
```

---

## Segurança

- **Nunca exponha sua API key em código frontend público ou repositórios.**
- Chaves são armazenadas como hash SHA-256 — nem o servidor sabe a chave bruta.
- Use escopos mínimos — crie chaves específicas para cada integração.
- Revogue imediatamente chaves comprometidas via Settings → API Keys.
- A interface de gerenciamento de chaves (`/api/api-keys`) só é acessível da mesma origem que o frontend (localhost). Não exponha a porta do backend diretamente à internet sem um proxy reverso.
