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
    const res = await this.requestJson(`/zones?name=${encodeURIComponent(domain)}&status=active&per_page=1`);
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
    const res = await this.requestJson(`/accounts/${accountId}/storage/kv/namespaces?per_page=100&page=1`);
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

  async uploadWorkerScript(accountId, scriptName, sourceCode, domain, kvNamespaceId, compatibilityDate) {
    const metadata = {
      main_module: "main.js",
      compatibility_date: compatibilityDate,
      bindings: [
        { type: "plain_text", name: "DOMAIN", text: domain },
        { type: "kv_namespace", name: "STATE_KV", namespace_id: kvNamespaceId }
      ]
    };
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    form.append("main.js", new Blob([sourceCode], { type: "application/javascript+module" }), "main.js");
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
    const res = await this.requestJson(`/accounts/${accountId}/workers/scripts/${scriptName}/settings`);
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
