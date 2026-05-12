# Server RedDB — TypeScript

RedDB rodando como **servidor em container** (Docker), com cliente
TypeScript. O exemplo usa o mesmo corpus e a mesma coleção `tales` do modo
embedded, mas acessa o banco via servidor.

## Transportes

| transporte | URI | porta | quando usar |
|---|---|---:|---|
| **HTTP JSON**   | `http://host:port`   | 8080 | proxies, browsers, debug com `curl`, infra HTTP-only (CDN/WAF/k8s ingress) |
| **RedWire (TCP)** | `red://host:port`   | 5050 | protocolo nativo, lowest overhead, multiplexing nativo, suporte a mTLS |
| **gRPC**         | `grpc://host:port`   | 5055 | clientes em outras linguagens (Go/Python/Java), streaming, integrações existentes |

O caminho padrão do exemplo é HTTP JSON (`pnpm start:http`). Os scripts
`start:wire` e `start:grpc` ficam disponíveis para validar outros transportes
quando o ambiente local estiver configurado para eles.

---

## Subir o servidor

### Caminho A — Docker (via GitHub Container Registry)

A imagem está em `ghcr.io/reddb-io/reddb:latest` e por enquanto é
**privada**. Você precisa autenticar antes:

```bash
# Use um Personal Access Token (classic) do GitHub com escopo read:packages.
# Gere em https://github.com/settings/tokens
echo "$GH_TOKEN" | docker login ghcr.io -u <seu-github-username> --password-stdin

pnpm up        # docker compose up -d
pnpm logs      # docker compose logs -f reddb
pnpm down      # docker compose down
```

O `docker-compose.yml` expõe **todas as 3 portas** e passa as flags
`--http --grpc --http-bind … --grpc-bind … --wire-bind …` pro processo
`red server` dentro do container. Wire é default, HTTP e gRPC são opt-in
via flag.

### Caminho B — Bare metal (sem Docker, sem acesso ao GHCR)

Usa o binário `red` que o exemplo `embedded` já baixou via `postinstall`:

```bash
# Garante que o embedded está instalado (que disponibiliza o binário 1.0.8)
cd ../embedded && pnpm install && cd -

# Sobe o servidor com os 3 transportes
pnpm install
pnpm up:bare
```

`pnpm up:bare` invoca:

```bash
red server --http --grpc \
  --http-bind 127.0.0.1:8080 \
  --grpc-bind 127.0.0.1:5055 \
  --wire-bind 127.0.0.1:5050 \
  --path ../../output/server.rdb
```

Roda em foreground; `Ctrl-C` pra parar.

---

## Rodar o cliente nos 3 transportes

```bash
pnpm install         # baixa @reddb-io/client + binário red_client

# Cada um testa o mesmo ingest + demos via transporte diferente:
pnpm start:http      # REDDB_URL=http://127.0.0.1:8080
pnpm start:wire      # REDDB_URL=red://127.0.0.1:5050
pnpm start:grpc      # REDDB_URL=grpc://127.0.0.1:5055

# Ou customize:
REDDB_URL=red://outra-maquina:5050 pnpm start
REDDB_URL=reds://prod.example.com:5050 pnpm start   # TLS
```

Variáveis:

| Var              | Default                              | Efeito                          |
|------------------|--------------------------------------|---------------------------------|
| `REDDB_URL`      | `http://127.0.0.1:8080`              | URI completa (scheme decide transporte). |
| `REDDB_DATA_DIR` | `<repo>/input`                       | Pasta de dados pra ingest.      |

---

## O que o script faz

Idêntico ao `src/embedded` (mesma lógica de 3 fases — ingest nodes →
calibração `label → entity_id` → ingest edges — mais a suite de demos),
mas usando `@reddb-io/client.connect(URI)` em vez de
`@reddb-io/sdk.connect('file://...')`. **A API `db.query()` é a mesma**
nos dois pacotes, só muda o que o `connect()` aceita.

1. Conecta via URI (auto-detecta transporte pelo scheme).
2. Probe de readiness: `SELECT 1`.
3. Idempotency check — pula ingest se a coleção já tem dados.
4. Insert 655 nodes em chunks de 100 (multi-row VALUES).
5. Calibração via `GRAPH NEIGHBORHOOD '102'`.
6. Insert 1741 edges em chunks de 50.
7. Suite de demos: distribuição, top edges, centralidade, propriedades, caminhos mais curtos.

---

## Limpeza

```bash
pnpm down                              # docker compose down (Caminho A)
# Caminho B: Ctrl-C no foreground `red server`
```

Os dados persistem em `<repo>/output/server.rdb` no host (via bind-mount
do volume). Apague o arquivo pra recomeçar do zero.

---

## Segurança

Esse setup **não tem auth**. Não exponha as portas pra além do localhost.
Pra produção: bootstrap com vault + mTLS + Docker secrets. Ver
[docs/getting-started/docker.md](https://github.com/reddb-io/reddb/blob/main/docs/getting-started/docker.md).

Pra TLS no cliente: `REDDB_URL=reds://host:5050 pnpm start` ou
`grpcs://host:5056 pnpm start`. O `@reddb-io/client` aceita `tls` em
`ConnectOptions` — exemplo:

```ts
const db = await connect('reds://prod.example.com:5050', {
  auth: { token: process.env.REDDB_TOKEN },
  tls: { ca: '/etc/ssl/reddb-ca.pem' },
})
```
