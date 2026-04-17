import type { ProviderConfig, Target } from "../types.js"

const VERIFY_METHODS = [
    "header-token",
    "hmac-sha256",
    "hmac-sha512",
    "stripe-signature",
    "none",
] as const

const css = `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 0; background: #f7f7f8; color: #222; }
    nav { background: #1f2937; color: #fff; padding: 12px 24px; display: flex; gap: 16px; align-items: center; }
    nav a { color: #d1d5db; text-decoration: none; font-size: 14px; }
    nav a:hover { color: #fff; }
    nav .title { font-weight: 600; color: #fff; margin-right: 24px; }
    main { max-width: 1100px; margin: 24px auto; padding: 0 24px; }
    h1 { font-size: 22px; margin: 0 0 16px 0; }
    h2 { font-size: 16px; margin: 24px 0 12px 0; color: #444; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 20px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
    th { background: #fafafa; font-weight: 600; color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: .02em; }
    td code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .badge-on { background: #d1fae5; color: #065f46; }
    .badge-off { background: #fee2e2; color: #991b1b; }
    form { display: grid; grid-template-columns: 160px 1fr; gap: 10px 16px; align-items: start; }
    form label { font-size: 13px; padding-top: 6px; color: #444; }
    form input[type=text], form input[type=url], form input[type=number], form select, form textarea { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; font-family: inherit; }
    form textarea { font-family: ui-monospace, SFMono-Regular, monospace; min-height: 80px; }
    form .actions { grid-column: 2; display: flex; gap: 8px; margin-top: 8px; }
    button, .btn { padding: 6px 14px; border: 1px solid #d1d5db; background: #fff; border-radius: 4px; font-size: 13px; cursor: pointer; text-decoration: none; color: #222; display: inline-block; }
    button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
    button.primary:hover { background: #1d4ed8; }
    button.danger { background: #fff; color: #b91c1c; border-color: #fca5a5; }
    button.danger:hover { background: #fef2f2; }
    .btn-secondary:hover { background: #f3f4f6; }
    .error { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; padding: 10px 14px; border-radius: 4px; margin-bottom: 16px; font-size: 13px; }
    .note { color: #6b7280; font-size: 12px; }
    .empty { color: #9ca3af; padding: 16px; text-align: center; font-size: 13px; }
`

interface Props {
    providers: ProviderConfig[]
    targets: Target[]
    editProvider?: string
    editTarget?: string
    error?: string
}

function Badge({ enabled }: { enabled: boolean }) {
    return enabled
        ? <span class="badge badge-on">enabled</span>
        : <span class="badge badge-off">disabled</span>
}

function DeleteForm({ resource, name }: { resource: string; name: string }) {
    return (
        <form method="post" action={`/admin/config/${resource}/${encodeURIComponent(name)}/delete`} style="display:inline; grid-template-columns: none;">
            <button
                type="submit"
                class="danger"
                onclick={`return confirm('Yakin mau hapus ${name}?')`}
            >
                delete
            </button>
        </form>
    )
}

function ProvidersSection({ providers, editing, error }: {
    providers: ProviderConfig[]
    editing?: ProviderConfig
    error?: string
}) {
    const method = editing?.verify.method ?? "header-token"
    const needsCreds = method !== "none"
    const editingHeaderName = editing && editing.verify.method !== "none" ? editing.verify.headerName : ""
    const editingEnvKey = editing && editing.verify.method !== "none" ? editing.verify.envKey : ""

    return (
        <section>
            <h1>Providers</h1>
            <p class="note">Kalo `enabled: false`, webhook dari provider ini bakal ditolak (404). Field <code>envKey</code> cuma nama env var — valuenya tetap di file <code>.env</code>.</p>

            {providers.length === 0
                ? <div class="empty">Belum ada provider.</div>
                : (
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Status</th>
                                <th>Routing Field</th>
                                <th>Dedup Field</th>
                                <th>Verify</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {providers.map((p) => (
                                <tr>
                                    <td><code>{p.name}</code></td>
                                    <td><Badge enabled={p.enabled} /></td>
                                    <td><code>{p.routingField}</code></td>
                                    <td>{p.dedupField != null ? <code>{p.dedupField}</code> : <span class="note">-</span>}</td>
                                    <td>
                                        <code>{p.verify.method}</code>
                                        {p.verify.method !== "none" && (
                                            <div class="note">{p.verify.headerName} ← ${p.verify.envKey}</div>
                                        )}
                                    </td>
                                    <td>
                                        <a href={`/admin/config?editProvider=${encodeURIComponent(p.name)}`} class="btn btn-secondary">edit</a>
                                        {" "}
                                        <DeleteForm resource="providers" name={p.name} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )
            }

            <h2>{editing ? `Edit provider: ${editing.name}` : "Add provider"}</h2>
            {error && <div class="error">{error}</div>}

            <form method="post" action="/admin/config/providers">
                {editing && <input type="hidden" name="_original_name" value={editing.name} />}

                <label>Name</label>
                <input type="text" name="name" required value={editing?.name ?? ""} />

                <label>Enabled</label>
                <div>
                    <input type="checkbox" name="enabled" value="true" checked={editing?.enabled ?? true} />
                </div>

                <label>Routing Field</label>
                <input type="text" name="routingField" required placeholder="external_id" value={editing?.routingField ?? ""} />

                <label>Dedup Field</label>
                <input type="text" name="dedupField" placeholder="id (opsional)" value={editing?.dedupField ?? ""} />

                <label>Verify Method</label>
                <select name="verifyMethod">
                    {VERIFY_METHODS.map((m) => (
                        <option value={m} selected={m === method}>{m}</option>
                    ))}
                </select>

                {needsCreds && (
                    <>
                        <label>Header Name</label>
                        <input type="text" name="headerName" placeholder="x-callback-token" value={editingHeaderName} />

                        <label>Env Key</label>
                        <input type="text" name="envKey" placeholder="XENDIT_CALLBACK_TOKEN" value={editingEnvKey} />
                    </>
                )}

                <div class="actions">
                    <button type="submit" class="primary">{editing ? "Update" : "Add"}</button>
                    {editing && <a href="/admin/config" class="btn btn-secondary">Cancel</a>}
                </div>
            </form>
        </section>
    )
}

function TargetsSection({ targets, editing, error }: {
    targets: Target[]
    editing?: Target
    error?: string
}) {
    const headersJson = editing?.headers ? JSON.stringify(editing.headers, null, 2) : ""

    return (
        <section>
            <h1>Targets</h1>
            <p class="note">Webhook di-forward ke target yang <code>prefix</code>-nya match dengan field routing. Prefix paling panjang menang.</p>

            {targets.length === 0
                ? <div class="empty">Belum ada target.</div>
                : (
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Status</th>
                                <th>Prefix</th>
                                <th>URL</th>
                                <th>Timeout</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {targets.map((t) => (
                                <tr>
                                    <td><code>{t.name}</code></td>
                                    <td><Badge enabled={t.enabled} /></td>
                                    <td><code>{t.prefix}</code></td>
                                    <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{t.url}</td>
                                    <td>{t.timeoutMs ?? 5000}ms</td>
                                    <td>
                                        <a href={`/admin/config?editTarget=${encodeURIComponent(t.name)}`} class="btn btn-secondary">edit</a>
                                        {" "}
                                        <DeleteForm resource="targets" name={t.name} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )
            }

            <h2>{editing ? `Edit target: ${editing.name}` : "Add target"}</h2>
            {error && <div class="error">{error}</div>}

            <form method="post" action="/admin/config/targets">
                {editing && <input type="hidden" name="_original_name" value={editing.name} />}

                <label>Name</label>
                <input type="text" name="name" required value={editing?.name ?? ""} />

                <label>Enabled</label>
                <div>
                    <input type="checkbox" name="enabled" value="true" checked={editing?.enabled ?? true} />
                </div>

                <label>URL</label>
                <input type="url" name="url" required placeholder="https://service.internal/api/callback" value={editing?.url ?? ""} />

                <label>Prefix</label>
                <input type="text" name="prefix" required placeholder="SVC-A-" value={editing?.prefix ?? ""} />

                <label>Timeout (ms)</label>
                <input type="number" name="timeoutMs" min="1" placeholder="5000 (default)" value={editing?.timeoutMs?.toString() ?? ""} />

                <label>Headers (JSON)</label>
                <textarea name="headers" placeholder={`{"Authorization": "Bearer xxx"}`}>{headersJson}</textarea>

                <div class="actions">
                    <button type="submit" class="primary">{editing ? "Update" : "Add"}</button>
                    {editing && <a href="/admin/config" class="btn btn-secondary">Cancel</a>}
                </div>
            </form>
        </section>
    )
}

export function renderAdminConfig(props: Props) {
    return <AdminConfigPage {...props} />
}

function AdminConfigPage({ providers, targets, editProvider, editTarget, error }: Props) {
    const provEditing = editProvider ? providers.find((p) => p.name === editProvider) : undefined
    const tgtEditing = editTarget ? targets.find((t) => t.name === editTarget) : undefined

    // error hanya relevan buat section yang sedang di-edit / di-submit
    const provError = editProvider ? error : undefined
    const tgtError = editTarget ? error : undefined

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <title>Admin Config — Payment Webhook Hub</title>
                <style>{css}</style>
            </head>
            <body>
                <nav>
                    <span class="title">webhook-hub admin</span>
                    <a href="/admin/config">Config</a>
                    <a href="/admin/queues">Queues</a>
                    <a href="/admin/queues/queue/dead-letter">Dead Letter Queue</a>
                </nav>
                <main>
                    <ProvidersSection providers={providers} editing={provEditing} error={provError} />
                    <TargetsSection targets={targets} editing={tgtEditing} error={tgtError} />
                </main>
            </body>
        </html>
    )
}
