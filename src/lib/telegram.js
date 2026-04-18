export class TelegramClient {
  constructor(botToken) {
    this.botToken = botToken;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async request(method, payload = {}) {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(`Telegram ${method} failed (${res.status}): ${JSON.stringify(data)}`);
    }
    return data.result;
  }

  async getMe() {
    return this.request("getMe");
  }

  async setWebhook(url, secretToken) {
    return this.request("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: false
    });
  }

  async getWebhookInfo() {
    return this.request("getWebhookInfo");
  }
}
