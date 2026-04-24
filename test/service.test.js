import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addDomainToApp,
  performSetup,
  performVerify,
  resetOwner,
  rotateWebhookSecret
} from "../src/lib/service.js";

function createTempRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tempmail-bot-"));
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src/main.js"), "export default {};\n", "utf8");
  return cwd;
}

function createCloudflareMock() {
  const state = {
    owner: JSON.stringify({ userId: "1", chatId: "1" }),
    webhookSecretWrites: [],
    botTokenWrites: [],
    workerUploads: [],
    d1Queries: [],
    catchAllTarget: "",
    enabledDns: 0,
    deletedKeys: [],
    kvValues: {}
  };
  return {
    state,
    async getZoneByDomain(domain) {
      return { id: "zone-1", name: domain, account: { id: "acct-1" } };
    },
    async findOrCreateKVNamespace() {
      return { id: "kv-1", title: "telegram-tempmail:test" };
    },
    async findOrCreateD1Database() {
      return { uuid: "d1-1", name: "telegram-tempmail-example.com" };
    },
    async getAccountWorkersSubdomain() {
      return "demoacct";
    },
    async uploadWorkerScript(_accountId, scriptName, modules, options) {
      state.workerUploads.push({
        scriptName,
        modulePaths: Array.isArray(modules) ? modules.map((m) => m.path) : [],
        mainModule: options?.mainModule ?? "main.js",
        bindings: {
          domain: options?.domain,
          kvNamespaceId: options?.kvNamespaceId,
          d1DatabaseId: options?.d1DatabaseId
        }
      });
    },
    async setWorkerSecret(_accountId, _scriptName, name, text) {
      if (name === "WEBHOOK_SECRET") state.webhookSecretWrites.push(text);
      if (name === "BOT_TOKEN") state.botTokenWrites.push(text);
    },
    async enableWorkerSubdomain() {},
    async enableEmailRoutingDns() {
      state.enabledDns += 1;
    },
    async getCatchAllRule() {
      return state.catchAllTarget
        ? { actions: [{ type: "worker", value: [state.catchAllTarget] }] }
        : { actions: [] };
    },
    async setCatchAllWorker(_zoneId, scriptName) {
      state.catchAllTarget = scriptName;
    },
    async getWorkerSettings() {
      return {
        bindings: [
          { type: "plain_text", name: "DOMAIN", text: "example.com" },
          { type: "kv_namespace", name: "STATE_KV", namespace_id: "kv-1" },
          { type: "d1", name: "MAIL_DB", database_id: "d1-1" }
        ]
      };
    },
    async getEmailRouting() {
      return { enabled: true, status: "ready" };
    },
    async queryD1(_accountId, _databaseId, sql) {
      state.d1Queries.push(sql);
      return [{ success: true, results: [{ ok: 1 }] }];
    },
    async getKVValue(_accountId, _namespaceId, key) {
      if (key === "owner") return state.owner;
      return state.kvValues[key] || null;
    },
    async putKVValue(_accountId, _namespaceId, key, value) {
      state.kvValues[key] = value;
    },
    async deleteKVValue(_accountId, _namespaceId, key) {
      state.deletedKeys.push(key);
      state.owner = null;
    }
  };
}

function createTelegramMock() {
  const state = { webhooks: [] };
  return {
    state,
    async getMe() {
      return { username: "demo_bot" };
    },
    async setWebhook(url, secret) {
      state.webhooks.push({ url, secret });
    },
    async getWebhookInfo() {
      const current = state.webhooks.at(-1);
      return { url: current?.url || "https://telegram-tempmail.demoacct.workers.dev/tg/current" };
    }
  };
}

test("performSetup writes state and configures catch-all/webhook", async () => {
  const cwd = createTempRepo();
  const cf = createCloudflareMock();
  const tg = createTelegramMock();
  const result = await performSetup({
    cwd,
    cf,
    tg,
    domain: "example.com",
    scriptName: "telegram-tempmail-example-com",
    telegramBotToken: "token",
    onProgress() {}
  });

  assert.equal(result.scriptName, "telegram-tempmail-example-com");
  assert.equal(cf.state.catchAllTarget, "telegram-tempmail-example-com");
  assert.equal(cf.state.enabledDns, 1);
  assert.ok(cf.state.d1Queries.length >= 1);
  assert.equal(tg.state.webhooks.length, 1);
  assert.match(result.claimLink, /https:\/\/t\.me\/demo_bot\?start=claim/);
  const saved = JSON.parse(fs.readFileSync(path.join(cwd, ".tempmail/setup-state.json"), "utf8"));
  assert.equal(saved.scriptName, "telegram-tempmail-example-com");
  assert.equal(saved.d1DatabaseId, "d1-1");
  assert.deepEqual(JSON.parse(cf.state.kvValues.domains), ["example.com"]);
});

test("addDomainToApp configures an onboarded Cloudflare domain on existing worker", async () => {
  const cwd = createTempRepo();
  fs.mkdirSync(path.join(cwd, ".tempmail"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".tempmail/setup-state.json"),
    JSON.stringify({
      domain: "example.com",
      domains: ["example.com"],
      accountId: "acct-1",
      scriptName: "telegram-tempmail-example-com"
    }),
    "utf8"
  );
  const cf = createCloudflareMock();
  const result = await addDomainToApp({
    cf,
    domain: "Second.Example",
    scriptName: "",
    cwd,
    onProgress() {}
  });

  assert.equal(result.domain, "second.example");
  assert.equal(cf.state.enabledDns, 1);
  assert.equal(cf.state.catchAllTarget, "telegram-tempmail-example-com");
  assert.deepEqual(JSON.parse(cf.state.kvValues.domains), ["example.com", "second.example"]);
  const saved = JSON.parse(fs.readFileSync(path.join(cwd, ".tempmail/setup-state.json"), "utf8"));
  assert.deepEqual(saved.domains, ["example.com", "second.example"]);
  assert.equal(saved.domainZones["second.example"], "zone-1");
});

test("performVerify reports ok with mocked clients", async () => {
  const cf = createCloudflareMock();
  cf.state.catchAllTarget = "telegram-tempmail-example-com";
  const tg = createTelegramMock();
  tg.state.webhooks.push({
    url: "https://telegram-tempmail-example-com.demoacct.workers.dev/tg/secret",
    secret: "secret"
  });
  const statuses = [];
  const result = await performVerify({
    cf,
    tg,
    domain: "example.com",
    scriptName: "telegram-tempmail-example-com",
    onStatus(name, status, detail) {
      statuses.push({ name, status, detail });
    }
  });

  assert.equal(result.ok, true);
  assert.ok(statuses.some((item) => item.name === "verify" && item.status === "ok"));
});

test("performVerify accepts an added domain listed in app KV", async () => {
  const cf = createCloudflareMock();
  cf.state.catchAllTarget = "telegram-tempmail-example-com";
  cf.state.kvValues.domains = JSON.stringify(["example.com", "second.example"]);
  const statuses = [];
  const result = await performVerify({
    cf,
    domain: "second.example",
    scriptName: "telegram-tempmail-example-com",
    onStatus(name, status, detail) {
      statuses.push({ name, status, detail });
    }
  });

  assert.equal(result.ok, true);
  assert.ok(
    statuses.some((item) => item.name === "binding DOMAIN" && item.detail.includes("in domains KV"))
  );
});

test("resetOwner deletes owner key from KV", async () => {
  const cwd = createTempRepo();
  fs.mkdirSync(path.join(cwd, ".tempmail"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".tempmail/setup-state.json"),
    JSON.stringify({ scriptName: "telegram-tempmail-example-com" }),
    "utf8"
  );
  const cf = createCloudflareMock();
  await resetOwner({
    cf,
    domain: "example.com",
    scriptName: "telegram-tempmail-example-com",
    cwd,
    onProgress() {}
  });
  assert.deepEqual(cf.state.deletedKeys, ["owner"]);
});

test("rotateWebhookSecret updates webhook and state", async () => {
  const cwd = createTempRepo();
  fs.mkdirSync(path.join(cwd, ".tempmail"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".tempmail/setup-state.json"),
    JSON.stringify({ scriptName: "telegram-tempmail-example-com" }),
    "utf8"
  );
  const cf = createCloudflareMock();
  const tg = createTelegramMock();
  const result = await rotateWebhookSecret({
    cf,
    tg,
    domain: "example.com",
    scriptName: "telegram-tempmail-example-com",
    telegramBotToken: "token",
    cwd,
    onProgress() {}
  });
  assert.equal(tg.state.webhooks.length, 1);
  assert.match(result.webhookUrl, /workers\.dev\/tg\//);
  const saved = JSON.parse(fs.readFileSync(path.join(cwd, ".tempmail/setup-state.json"), "utf8"));
  assert.equal(saved.scriptName, "telegram-tempmail-example-com");
});
