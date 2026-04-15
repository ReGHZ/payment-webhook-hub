# Payment Webhook Hub

Terima webhook dari Xendit, teruskan ke service internal berdasarkan `external_id` prefix.

```text
POST /webhook/xendit
       |
  [xendit-webhook queue]
       |
  Dispatcher (cocokkan prefix)
       |
  [forward queue]
       |
  Forwarder (HTTP POST ke target)
       |
  gagal 5x? --> [dead-letter queue] --> Discord alert
```

## Quick Start

```bash
cp .env.example .env
# isi XENDIT_CALLBACK_TOKEN, ADMIN_BEARER_TOKEN, DISCORD_WEBHOOK_URL

npm install
npm run dev          # server (port 3005)
npm run dev:worker   # dispatcher + forwarder
```

Redis harus jalan di `localhost:6379` (atau sesuaikan di `.env`).

## Production (Docker)

```bash
cp .env.example .env
# isi semua env yang diperlukan

docker compose up -d --build
```

Container `webhook-hub-server` dan `webhook-hub-worker` akan join external network dan konek ke Redis yang sudah ada.

## Environment Variables

| Variable                | Default          | Keterangan                                                       |
| ----------------------- | ---------------- | ---------------------------------------------------------------- |
| `NODE_ENV`              | `development`    | Environment label (muncul di Discord alert)                      |
| `PORT`                  | `3005`           | Port HTTP server                                                 |
| `REDIS_HOST`            | `127.0.0.1`      | Redis host                                                       |
| `REDIS_PORT`            | `6379`           | Redis port                                                       |
| `REDIS_PASSWORD`        | -                | Redis password (opsional)                                        |
| `XENDIT_CALLBACK_TOKEN` | -                | **Wajib.** Token dari Xendit dashboard, dipakai validasi webhook |
| `ADMIN_BEARER_TOKEN`    | -                | **Wajib.** Token/password buat akses admin (Bearer & Basic auth) |
| `ADMIN_USER`            | `admin`          | Username untuk Basic auth di Bull Board                          |
| `TARGETS_FILE_PATH`     | `./targets.json` | Path ke config target                                            |
| `LOG_LEVEL`             | `info`           | Pino log level                                                   |
| `DISCORD_WEBHOOK_URL`   | -                | Discord webhook URL untuk DLQ alert (opsional)                   |

## Routing

Webhook di-route berdasarkan field `external_id` di body. Misal `external_id: "SVC-A-001"` akan match target dengan `prefix: "SVC-A-"`.

Kalau ada lebih dari satu prefix yang cocok, yang paling panjang (spesifik) menang.

Config target ada di `targets.json` dan auto-reload kalau file berubah (tanpa restart):

```json
{
  "targets": [
    {
      "name": "service-a",
      "url": "https://your-service-a.com/api/callback",
      "enabled": true,
      "prefix": "SVC-A-",
      "headers": { "Authorization": "Bearer secret" },
      "timeoutMs": 10000
    }
  ]
}
```

| Field       | Type    | Keterangan                                        |
| ----------- | ------- | ------------------------------------------------- |
| `name`      | string  | Identifier target                                 |
| `url`       | string  | URL tujuan forward (harus valid URL)              |
| `enabled`   | boolean | Toggle on/off tanpa hapus config                  |
| `prefix`    | string  | Prefix `external_id` yang di-match                |
| `headers`   | object  | Custom headers saat forward (opsional)            |
| `timeoutMs` | number  | Timeout request dalam ms, default 5000 (opsional) |

## API Endpoints

### `GET /health`

Health check. Return 503 kalau Redis mati.

### `POST /webhook/xendit`

Terima webhook dari Xendit. Header `x-callback-token` wajib ada dan harus cocok dengan `XENDIT_CALLBACK_TOKEN`.

Proteksi:

- Signature verification (`x-callback-token` + `timingSafeEqual`)
- Rate limit 100 req/menit per IP
- Body size limit 1MB
- Dedup berdasarkan Xendit event `id` (TTL 24 jam)

### `GET /admin/queues`

Bull Board UI — dashboard visual untuk monitoring semua queue (xendit-webhook, forward, dead-letter). Buka di browser, login pakai Basic auth:

- **Username**: value dari `ADMIN_USER` (default: `admin`)
- **Password**: value dari `ADMIN_BEARER_TOKEN`

### `GET /admin/dlq?limit=50`

List job yang gagal setelah max retry.

```bash
curl -H "Authorization: Bearer your-token" localhost:3005/admin/dlq
```

### `POST /admin/dlq/:jobId/replay`

Kirim ulang job dari DLQ ke forward queue.

```bash
curl -X POST -H "Authorization: Bearer your-token" localhost:3005/admin/dlq/123/replay
```

### `DELETE /admin/dlq/:jobId`

Hapus job dari DLQ.

```bash
curl -X DELETE -H "Authorization: Bearer your-token" localhost:3005/admin/dlq/123
```

Admin API endpoint support Bearer token dan Basic auth.

## Retry & Dead Letter Queue

| Queue                       | Max Retry | Backoff                    |
| --------------------------- | --------- | -------------------------- |
| `xendit-webhook` (dispatch) | 3x        | Exponential, mulai 1 detik |
| `forward`                   | 5x        | Exponential, mulai 3 detik |

Job yang gagal forward setelah 5x retry otomatis masuk DLQ. Bisa dilihat dan di-replay lewat admin endpoint atau Bull Board UI.

Kalau `DISCORD_WEBHOOK_URL` diset, notifikasi otomatis dikirim ke Discord saat job masuk DLQ dengan label environment (`[PRODUCTION]` / `[DEVELOPMENT]`).

## Testing

```bash
npm test        # jalankan semua test
npm run build   # type check
npx eslint .    # lint
```

## Tech Stack

- **Hono** - web framework
- **BullMQ** + **Redis** - job queue
- **Bull Board** - queue monitoring UI
- **Zod** - runtime validation
- **Pino** - structured logging (Promtail/Loki compatible)
- **Vitest** - testing
