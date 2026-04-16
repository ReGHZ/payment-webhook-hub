# Payment Webhook Hub

Terima webhook dari berbagai payment provider, teruskan ke service internal berdasarkan prefix routing.

```text
POST /webhook/:provider
       |
  [Verify signature/token]
       |
  [Dedup] → skip kalau sudah pernah
       |
  [webhook-incoming queue]
       |
  Dispatcher (cocokkan routing field dengan prefix target)
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
cp providers.json.example providers.json
# isi token dan config sesuai kebutuhan

npm install
npm run dev          # server (port 3005)
npm run dev:worker   # dispatcher + forwarder
```

Redis harus jalan di `localhost:6379` (atau sesuaikan di `.env`).

## Production (Docker)

```bash
docker compose up -d --build
```

Container `webhook-hub-server` dan `webhook-hub-worker` join external network dan konek ke Redis yang sudah ada.

## Multi-Provider Support

Provider dikonfigurasi di `providers.json`. Setiap provider mendefinisikan:
- **Verification method** — cara verifikasi webhook (token, HMAC, Stripe signature, atau none)
- **Routing field** — field mana di body yang dipakai untuk prefix matching (support dot-notation)
- **Dedup field** — field untuk deduplikasi (opsional)

```json
{
  "providers": [
    {
      "name": "xendit",
      "enabled": true,
      "routingField": "external_id",
      "dedupField": "id",
      "verify": {
        "method": "header-token",
        "headerName": "x-callback-token",
        "envKey": "XENDIT_CALLBACK_TOKEN"
      }
    }
  ]
}
```

### Verification Methods

| Method | Deskripsi | Contoh Provider |
|--------|-----------|-----------------|
| `header-token` | Token di header, dibandingkan langsung | Xendit |
| `hmac-sha256` | HMAC SHA-256 signature di header | Generic |
| `hmac-sha512` | HMAC SHA-512 signature di header | Midtrans |
| `stripe-signature` | Format `t=timestamp,v1=signature` | Stripe |
| `none` | Tanpa verifikasi (testing/internal) | Custom |

Secret token disimpan di `.env`, config hanya reference nama env var via `envKey`.

### Menambah Provider Baru

1. Tambah entry di `providers.json`
2. Set token/secret di `.env`
3. Tidak perlu ubah code — config hot-reload tanpa restart

## Environment Variables

| Variable                | Default            | Keterangan                                                  |
| ----------------------- | ------------------ | ----------------------------------------------------------- |
| `NODE_ENV`              | `development`      | Environment label (muncul di Discord alert)                 |
| `PORT`                  | `3005`             | Port HTTP server                                            |
| `REDIS_HOST`            | `127.0.0.1`        | Redis host                                                  |
| `REDIS_PORT`            | `6379`             | Redis port                                                  |
| `REDIS_PASSWORD`        | -                  | Redis password (opsional)                                   |
| `XENDIT_CALLBACK_TOKEN` | -                  | Token Xendit (referenced dari providers.json)               |
| `ADMIN_BEARER_TOKEN`    | -                  | **Wajib.** Token/password untuk admin (Bearer & Basic auth) |
| `ADMIN_USER`            | `admin`            | Username untuk Basic auth di Bull Board                     |
| `TARGETS_FILE_PATH`     | `./targets.json`   | Path ke config target                                       |
| `PROVIDERS_FILE_PATH`   | `./providers.json` | Path ke config provider                                     |
| `LOG_LEVEL`             | `info`             | Pino log level                                              |
| `DISCORD_WEBHOOK_URL`   | -                  | Discord webhook URL untuk DLQ alert (opsional)              |

## Routing

Webhook di-route berdasarkan `routingField` yang dikonfigurasi per provider. Misal Xendit pakai `external_id`, value `"SVC-A-001"` akan match target dengan `prefix: "SVC-A-"`.

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
| `prefix`    | string  | Prefix routing value yang di-match                |
| `headers`   | object  | Custom headers saat forward (opsional)            |
| `timeoutMs` | number  | Timeout request dalam ms, default 5000 (opsional) |

## API Endpoints

### `GET /health`

Health check. Return 503 kalau Redis mati.

### `POST /webhook/:provider`

Terima webhook dari provider yang terdaftar di `providers.json`. Verifikasi otomatis sesuai config provider.

Proteksi:
- Signature/token verification (per-provider)
- Rate limit 100 req/menit per IP
- Body size limit 1MB
- Dedup berdasarkan `dedupField` provider (TTL 24 jam)

### `GET /admin/queues`

Bull Board UI — dashboard visual untuk monitoring semua queue. Login pakai Basic auth:

- **Username**: value dari `ADMIN_USER` (default: `admin`)
- **Password**: value dari `ADMIN_BEARER_TOKEN`

### `GET /admin/dlq?limit=50`

List job yang gagal setelah max retry.

```bash
curl -H "Authorization: Bearer your-token" localhost:3005/admin/dlq
```

### `POST /admin/dlq/:jobId/replay`

Kirim ulang job dari DLQ ke forward queue.

### `DELETE /admin/dlq/:jobId`

Hapus job dari DLQ.

Admin API endpoint support Bearer token dan Basic auth.

## Retry & Dead Letter Queue

| Queue                        | Max Retry | Backoff                    |
| ---------------------------- | --------- | -------------------------- |
| `webhook-incoming` (dispatch) | 3x        | Exponential, mulai 1 detik |
| `forward`                    | 5x        | Exponential, mulai 3 detik |

Job yang gagal forward setelah 5x retry otomatis masuk DLQ. Bisa dilihat dan di-replay lewat admin endpoint atau Bull Board UI.

Kalau `DISCORD_WEBHOOK_URL` diset, notifikasi otomatis dikirim ke Discord saat job masuk DLQ dengan label environment (`[PRODUCTION]` / `[DEVELOPMENT]`).

## Testing

```bash
npm test        # jalankan semua test
npx tsc --noEmit # type check
npx eslint .    # lint
```

## Tech Stack

- **Hono** - web framework
- **BullMQ** + **Redis** - job queue
- **Bull Board** - queue monitoring UI
- **Zod** - runtime validation
- **Pino** - structured logging (Promtail/Loki compatible)
- **Vitest** - testing
