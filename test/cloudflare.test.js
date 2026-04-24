import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CloudflareClient } from "../src/lib/cloudflare.js";
import { collectWorkerModules } from "../src/lib/service.js";

describe("CloudflareClient.uploadWorkerScript", () => {
  function createClient({ captureRequest }) {
    const client = new CloudflareClient({ email: "t@example.com", globalApiKey: "k" });
    client.request = async (path, options) => {
      captureRequest({ path, options });
      return { ok: true };
    };
    return client;
  }

  it("throws when no modules are provided", async () => {
    const client = createClient({ captureRequest: () => {} });
    await assert.rejects(
      () =>
        client.uploadWorkerScript("acct", "worker", [], {
          domain: "a.example",
          kvNamespaceId: "kv",
          compatibilityDate: "2026-04-18"
        }),
      /at least one module/
    );
  });

  it("throws when the main module is missing", async () => {
    const client = createClient({ captureRequest: () => {} });
    await assert.rejects(
      () =>
        client.uploadWorkerScript(
          "acct",
          "worker",
          [{ path: "worker/x.js", content: "export const x = 1;" }],
          { domain: "a.example", kvNamespaceId: "kv", compatibilityDate: "2026-04-18" }
        ),
      /main module/
    );
  });

  it("builds a multi-module FormData payload with correct metadata", async () => {
    let captured;
    const client = createClient({ captureRequest: (r) => (captured = r) });
    const modules = [
      { path: "main.js", content: "import './worker/x.js';" },
      { path: "worker/x.js", content: "export const x = 1;" }
    ];
    await client.uploadWorkerScript("acct123", "tempmail-worker", modules, {
      domain: "mail.example",
      kvNamespaceId: "kv-1",
      compatibilityDate: "2026-04-18",
      d1DatabaseId: "d1-uuid"
    });
    assert.equal(captured.path, "/accounts/acct123/workers/scripts/tempmail-worker");
    assert.equal(captured.options.method, "PUT");
    const form = captured.options.body;
    assert.ok(form instanceof FormData);
    const metadata = JSON.parse(form.get("metadata"));
    assert.equal(metadata.main_module, "main.js");
    assert.equal(metadata.compatibility_date, "2026-04-18");
    const bindingNames = metadata.bindings.map((b) => b.name);
    assert.deepEqual(bindingNames, ["DOMAIN", "STATE_KV", "MAIL_DB"]);
    assert.ok(form.get("main.js"));
    assert.ok(form.get("worker/x.js"));
  });
});

describe("collectWorkerModules", () => {
  it("returns main.js plus every file in src/worker/", () => {
    const modules = collectWorkerModules(new URL("../src", import.meta.url).pathname);
    const paths = modules.map((m) => m.path).sort();
    assert.ok(paths.includes("main.js"));
    assert.ok(paths.includes("worker/api.js"));
    assert.ok(paths.includes("worker/auth.js"));
    assert.ok(paths.includes("worker/dashboard.js"));
    assert.ok(paths.includes("worker/domains.js"));
    assert.ok(paths.includes("worker/email.js"));
    assert.ok(paths.includes("worker/html.js"));
    assert.ok(paths.includes("worker/telegram.js"));
    assert.ok(paths.includes("worker/utils.js"));
    assert.ok(paths.includes("worker/db.js"));
    for (const mod of modules) {
      assert.ok(typeof mod.content === "string" && mod.content.length > 0);
    }
  });
});
