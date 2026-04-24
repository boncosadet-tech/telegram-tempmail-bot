export class CloudflareClient {
  constructor({ email, globalApiKey }) {
    this.email = email;
    this.globalApiKey = globalApiKey;
    this.baseUrl = "https://api.cloudflare.com/client/v4";
  }

  headers(extra = {}) {
    return {
      "X-Auth-Email": this.email,
      "X-Auth-Key": this.globalApiKey,
      Accept: "application/json",
      ...extra
    };
  }

  async request(path, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(headers),
      body
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const detail = JSON.stringify(data.errors || data.messages || data || {});
      throw new Error(`Cloudflare API ${method} ${path} failed (${res.status}): ${detail}`);
    }
    return data;
  }

  async requestJson(path, { method = "GET", body } = {}) {
    return this.request(path, {
      method,
      body: body == null ? undefined : JSON.stringify(body),
      headers: body == null ? {} : { "Content-Type": "application/json" }
    });
  }

  async getZoneByDomain(domain) {
    const res = await this.requestJson(
      `/zones?name=${encodeURIComponent(domain)}&status=active&per_page=1`
    );
    if (!res.result || res.result.length === 0) {
      throw new Error(`Active zone not found for domain: ${domain}`);
    }
    return res.result[0];
  }

  async getAccountWorkersSubdomain(accountId) {
    const res = await this.requestJson(`/accounts/${accountId}/workers/subdomain`);
    if (!res.result || !res.result.subdomain) {
      throw new Error("Workers subdomain is not configured on this account.");
    }
    return res.result.subdomain;
  }

  async listKVNamespaces(accountId) {
    const res = await this.requestJson(
      `/accounts/${accountId}/storage/kv/namespaces?per_page=100&page=1`
    );
    return res.result || [];
  }

  async listD1Databases(accountId) {
    const res = await this.requestJson(`/accounts/${accountId}/d1/database?page=1&per_page=100`);
    return res.result || [];
  }

  async findOrCreateKVNamespace(accountId, title) {
    const namespaces = await this.listKVNamespaces(accountId);
    const existing = namespaces.find((ns) => ns.title === title);
    if (existing) return existing;
    const created = await this.requestJson(`/accounts/${accountId}/storage/kv/namespaces`, {
      method: "POST",
      body: { title }
    });
    return created.result;
  }

  async findOrCreateD1Database(accountId, name) {
    const databases = await this.listD1Databases(accountId);
    const existing = databases.find((db) => db.name === name);
    if (existing) return existing;
    const created = await this.requestJson(`/accounts/${accountId}/d1/database`, {
      method: "POST",
      body: { name }
    });
    return created.result;
  }

  async queryD1(accountId, databaseId, sql, params = []) {
    const res = await this.requestJson(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
      method: "POST",
      body: { sql, params }
    });
    return res.result || [];
  }

  /**
   * Upload a (possibly multi-module) Worker script. `modules` is an array of
   * `{ path, content }` where `path` is the name used in ES-module imports —
   * the main module must be included and its path matches `mainModule`.
   *
   * @param {string} accountId
   * @param {string} scriptName
   * @param {Array<{ path: string, content: string | ArrayBuffer | Uint8Array }>} modules
   * @param {object} options
   * @param {string} options.domain - Primary DOMAIN binding value.
   * @param {string} options.kvNamespaceId - STATE_KV binding namespace id.
   * @param {string} options.compatibilityDate - e.g. "2026-04-18".
   * @param {string} [options.d1DatabaseId] - Optional MAIL_DB D1 database id.
   * @param {string} [options.mainModule="main.js"] - Entry-point module path.
   */
  async uploadWorkerScript(accountId, scriptName, modules, options = {}) {
    const {
      domain,
      kvNamespaceId,
      compatibilityDate,
      d1DatabaseId = "",
      mainModule = "main.js"
    } = options;

    const bindings = [
      { type: "plain_text", name: "DOMAIN", text: domain },
      { type: "kv_namespace", name: "STATE_KV", namespace_id: kvNamespaceId }
    ];
    if (d1DatabaseId) {
      bindings.push({ type: "d1", name: "MAIL_DB", database_id: d1DatabaseId });
    }
    const metadata = {
      main_module: mainModule,
      compatibility_date: compatibilityDate,
      bindings
    };

    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    if (!Array.isArray(modules) || modules.length === 0) {
      throw new Error("uploadWorkerScript requires at least one module");
    }
    if (!modules.some((m) => m.path === mainModule)) {
      throw new Error(`uploadWorkerScript modules must include the main module "${mainModule}"`);
    }
    for (const mod of modules) {
      form.append(
        mod.path,
        new Blob([mod.content], { type: "application/javascript+module" }),
        mod.path
      );
    }
    return this.request(`/accounts/${accountId}/workers/scripts/${scriptName}`, {
      method: "PUT",
      body: form
    });
  }

  async setWorkerSecret(accountId, scriptName, name, text) {
    return this.requestJson(`/accounts/${accountId}/workers/scripts/${scriptName}/secrets`, {
      method: "PUT",
      body: { name, text, type: "secret_text" }
    });
  }

  async enableWorkerSubdomain(accountId, scriptName) {
    return this.requestJson(`/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
      method: "POST",
      body: { enabled: true, previews_enabled: false }
    });
  }

  async getWorkerSettings(accountId, scriptName) {
    const res = await this.requestJson(
      `/accounts/${accountId}/workers/scripts/${scriptName}/settings`
    );
    return res.result;
  }

  async getEmailRouting(zoneId) {
    const res = await this.requestJson(`/zones/${zoneId}/email/routing`);
    return res.result;
  }

  async enableEmailRoutingDns(zoneId) {
    return this.requestJson(`/zones/${zoneId}/email/routing/dns`, {
      method: "POST"
    });
  }

  async getCatchAllRule(zoneId) {
    const res = await this.requestJson(`/zones/${zoneId}/email/routing/rules/catch_all`);
    return res.result;
  }

  async setCatchAllWorker(zoneId, scriptName) {
    return this.requestJson(`/zones/${zoneId}/email/routing/rules/catch_all`, {
      method: "PUT",
      body: {
        name: "Telegram TempMail Catch-all",
        enabled: true,
        matchers: [{ type: "all" }],
        actions: [{ type: "worker", value: [scriptName] }]
      }
    });
  }

  async getAllEmailRules(zoneId) {
    const res = await this.requestJson(`/zones/${zoneId}/email/routing/rules?per_page=100`);
    return res.result || [];
  }

  async getKVValue(accountId, namespaceId, keyName) {
    const res = await fetch(
      `${this.baseUrl}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(keyName)}`,
      {
        method: "GET",
        headers: this.headers()
      }
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloudflare KV GET failed (${res.status}): ${text}`);
    }
    return res.text();
  }

  async putKVValue(accountId, namespaceId, keyName, value) {
    const res = await fetch(
      `${this.baseUrl}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(keyName)}`,
      {
        method: "PUT",
        headers: this.headers({ "Content-Type": "text/plain; charset=utf-8" }),
        body: String(value)
      }
    );
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_error) {
      data = {};
    }
    if (!res.ok || data.success === false) {
      throw new Error(`Cloudflare KV PUT failed (${res.status}): ${text}`);
    }
  }

  async deleteKVValue(accountId, namespaceId, keyName) {
    const res = await fetch(
      `${this.baseUrl}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(keyName)}`,
      {
        method: "DELETE",
        headers: this.headers()
      }
    );
    if (res.status === 404) return;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloudflare KV DELETE failed (${res.status}): ${text}`);
    }
  }
}
