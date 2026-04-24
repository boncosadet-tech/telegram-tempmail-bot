// Login + dashboard HTML templates. All user-controlled data is rendered via
// textContent / setAttribute on the client to guarantee no XSS.

import { escapeHtml } from "./html.js";

const BASE_STYLES = `
:root {
  color-scheme: light;
  --ink: #171717;
  --ink-soft: #2d2d2d;
  --muted: #6b5f3f;
  --muted-strong: #4a4129;
  --paper: #fffef7;
  --cream: #fff7d1;
  --line: #171717;
  --line-soft: rgba(23, 23, 23, 0.12);
  --yellow: #ffd84d;
  --yellow-2: #ffbd1f;
  --orange: #ff8a00;
  --accent: #4338ca;
  --accent-soft: rgba(67, 56, 202, 0.14);
  --success: #047857;
  --danger: #b91c1c;
  --shadow-card: 0 10px 30px rgba(23, 23, 23, 0.08), 0 1px 2px rgba(23, 23, 23, 0.04);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at 8% 4%, rgba(255, 235, 120, 0.85), transparent 28rem),
    radial-gradient(circle at 96% 8%, rgba(255, 138, 0, 0.22), transparent 32rem),
    radial-gradient(circle at 50% 110%, rgba(67, 56, 202, 0.18), transparent 30rem),
    linear-gradient(135deg, #fffdf2 0%, #fff1a8 48%, #ffc83d 100%);
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
  border: 2px solid var(--line);
  border-radius: 14px;
  background: #fff;
  padding: 10px 14px;
  font-weight: 800;
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}
button:hover:not(:disabled) {
  transform: translate(-1px, -1px);
  box-shadow: 4px 4px 0 var(--line);
}
button:disabled { opacity: 0.55; cursor: not-allowed; }
button.primary {
  background: linear-gradient(135deg, var(--yellow), var(--yellow-2));
}
button.ghost { background: rgba(255, 255, 255, 0.6); }
button.danger { background: #fff; color: var(--danger); border-color: var(--danger); }
input, select, textarea {
  width: 100%;
  background: var(--paper);
  border: 2px solid var(--line);
  border-radius: 14px;
  padding: 11px 13px;
}
a { color: var(--accent); text-decoration: underline; font-weight: 700; }
`;

export function renderLoginPage(domain) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TempMail — Owner Login</title>
<style>
${BASE_STYLES}
.shell {
  max-width: 640px;
  margin: 8vh auto;
  padding: 28px 24px 40px;
}
.card {
  background: rgba(255, 255, 255, 0.93);
  border: 3px solid var(--line);
  border-radius: 28px;
  padding: 32px;
  box-shadow: 10px 10px 0 var(--line);
}
.badge {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--ink); color: var(--yellow);
  padding: 8px 14px; border-radius: 999px; font-weight: 900; letter-spacing: 0.04em;
  font-size: 13px;
}
h1 { font-size: clamp(30px, 5.4vw, 48px); line-height: 0.98; margin: 20px 0 12px; letter-spacing: -1.5px; }
p { color: var(--muted-strong); font-size: 16px; line-height: 1.6; margin: 0 0 14px; }
code { background: var(--cream); border: 2px solid var(--line); padding: 2px 8px; border-radius: 8px; font-weight: 800; }
.steps { counter-reset: step; display: grid; gap: 12px; margin-top: 20px; }
.steps li {
  list-style: none; counter-increment: step;
  padding: 14px 18px 14px 56px; position: relative;
  background: var(--paper); border: 2px solid var(--line);
  border-radius: 18px;
}
.steps li::before {
  content: counter(step); position: absolute; left: 12px; top: 50%;
  transform: translateY(-50%); width: 32px; height: 32px; border-radius: 10px;
  background: var(--ink); color: var(--yellow);
  display: grid; place-items: center; font-weight: 900;
}
.footer { margin-top: 20px; color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<div class="shell">
  <div class="card">
    <span class="badge">⚡ Owner only</span>
    <h1>Private TempMail dashboard</h1>
    <p>Domain: <strong>${escapeHtml(domain)}</strong></p>
    <p>Dashboard ini hanya bisa dibuka oleh owner yang terdaftar. Untuk masuk, minta link login sekali pakai dari bot Telegram kamu.</p>
    <ol class="steps">
      <li>Buka bot Telegram kamu.</li>
      <li>Kirim <code>/web</code> atau tekan tombol <strong>📬 Dashboard</strong> di menu.</li>
      <li>Klik link login yang bot kirim — berlaku 10 menit dan hanya bisa dipakai sekali.</li>
    </ol>
    <p class="footer">Tidak punya akses? Hubungi owner bot atau jalankan <code>telegram-tempmail-admin --action reset-owner</code> dari mesin setup.</p>
  </div>
</div>
</body>
</html>`;
}

export function renderAppPage(domain) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TempMail — Private Dashboard</title>
<style>
${BASE_STYLES}
.app {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 100vh;
  gap: 18px;
  padding: 18px;
}
header.app-header {
  display: flex; flex-wrap: wrap; gap: 18px;
  justify-content: space-between; align-items: center;
  padding: 18px 22px;
  background: linear-gradient(135deg, #fffef7, #ffe17a);
  border: 3px solid var(--line); border-radius: 28px;
  box-shadow: 8px 8px 0 var(--line);
}
.brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
.brand-mark {
  width: 54px; height: 54px; border-radius: 18px;
  border: 3px solid var(--line);
  background: var(--ink); color: var(--yellow);
  display: grid; place-items: center; font-size: 24px;
  box-shadow: 4px 4px 0 var(--yellow-2);
}
.title-eyebrow {
  font-size: 12px; font-weight: 900;
  text-transform: uppercase; letter-spacing: 0.16em; color: var(--muted-strong);
}
.app-header h1 { margin: 0; font-size: clamp(22px, 2.4vw, 32px); letter-spacing: -0.03em; }
.domain-chip {
  display: inline-flex; margin-top: 6px;
  background: var(--ink); color: var(--cream);
  border-radius: 999px; padding: 5px 12px;
  font-weight: 800; font-size: 13px;
}
.header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.wrap {
  display: grid;
  grid-template-columns: minmax(320px, 400px) 1fr;
  gap: 18px;
  min-height: 0;
}
aside, main { min-width: 0; display: grid; gap: 14px; align-content: start; }
.card {
  background: rgba(255, 255, 255, 0.94);
  border: 3px solid var(--line);
  border-radius: 24px;
  padding: 18px;
  box-shadow: var(--shadow-card);
}
.card h3 { margin: 0 0 10px; font-size: 15px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--muted-strong); }
.muted { color: var(--muted-strong); font-size: 13.5px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.row > * { flex: 1; min-width: 140px; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.stat {
  background: linear-gradient(145deg, #fffef7, #fff4b7);
  border: 2px solid var(--line); border-radius: 18px;
  padding: 12px; text-align: left;
}
.stat-value { font-size: 22px; font-weight: 900; line-height: 1; }
.stat-label { font-size: 12px; color: var(--muted-strong); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.08em; }
.messages { display: grid; gap: 10px; max-height: 62vh; overflow: auto; padding-right: 2px; }
.message {
  all: unset; cursor: pointer; display: block;
  border: 2px solid var(--line); border-radius: 18px;
  padding: 13px; background: #fffdf4;
  box-shadow: 3px 3px 0 rgba(23, 23, 23, 0.5);
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}
.message:hover { transform: translate(-1px, -1px); box-shadow: 5px 5px 0 var(--line); }
.message.active { background: #fff1a8; box-shadow: 5px 5px 0 var(--line); }
.message-top { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.message-address { font-weight: 900; word-break: break-all; }
.message-subject { margin-top: 6px; font-weight: 700; }
.pill {
  display: inline-block; border-radius: 999px;
  padding: 3px 10px; font-size: 12px; font-weight: 900;
  background: var(--ink); color: var(--yellow);
}
.pill.soft { background: var(--accent-soft); color: var(--accent); }
.empty, .error {
  border: 2px dashed var(--line-soft); border-radius: 18px;
  padding: 24px; text-align: center; color: var(--muted-strong);
}
.error { border-color: var(--danger); color: var(--danger); background: #fff1f1; border-style: solid; }
.otp-callout {
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg, var(--yellow), var(--yellow-2));
  border: 2px solid var(--line); border-radius: 18px;
  padding: 12px 14px; box-shadow: var(--shadow-card);
}
.otp-callout-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 900;
  letter-spacing: 0.25em;
}
.otp-callout button { padding: 8px 12px; font-size: 13px; }
pre.preview {
  white-space: pre-wrap; word-break: break-word;
  background: #fffdf4; padding: 14px; border-radius: 18px;
  border: 2px solid var(--line-soft); color: #3f3f46;
  max-height: 220px; overflow: auto;
}
.email-surface {
  background: #ffffff; color: #202124;
  border: 2px solid var(--line); border-radius: 20px;
  padding: 20px; line-height: 1.65;
  box-shadow: inset 0 0 0 1px rgba(23, 23, 23, 0.05);
}
.email-surface p { margin: 0 0 14px; }
.email-surface ul { margin: 0 0 14px 18px; padding: 0; }
.email-surface li { margin-bottom: 6px; }
.email-surface .email-empty { color: #71717a; font-style: italic; }
.toast {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
  background: var(--ink); color: var(--cream);
  padding: 10px 16px; border-radius: 999px;
  font-weight: 800; font-size: 13.5px;
  box-shadow: 0 12px 30px rgba(23, 23, 23, 0.25);
  opacity: 0; pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast.visible { opacity: 1; transform: translateX(-50%) translateY(-4px); }
@media (max-width: 960px) {
  .wrap { grid-template-columns: 1fr; }
  .messages { max-height: 52vh; }
}
</style>
</head>
<body>
<div class="app">
  <header class="app-header">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">✉</div>
      <div>
        <div class="title-eyebrow">private tempmail</div>
        <h1>Dashboard</h1>
        <div class="domain-chip">${escapeHtml(domain)}</div>
      </div>
    </div>
    <div class="header-actions">
      <button id="refreshBtn" class="ghost" type="button">Refresh</button>
      <button id="logoutBtn" class="ghost" type="button">Logout</button>
    </div>
  </header>
  <div class="wrap">
    <aside>
      <div class="card">
        <h3>Create alias</h3>
        <div class="muted">Kosongkan untuk alias readable otomatis.</div>
        <div class="row" style="margin-top: 10px;">
          <input id="aliasInput" placeholder="hello atau hello.team" autocomplete="off" />
          <select id="aliasDomainSelect" aria-label="Alias domain"></select>
        </div>
        <div class="row" style="margin-top: 10px;">
          <button id="createAliasBtn" class="primary" type="button">Create alias</button>
        </div>
        <div id="aliasResult" class="muted" style="margin-top: 8px;"></div>
      </div>
      <div class="card">
        <h3>Filter</h3>
        <select id="aliasFilter" aria-label="Alias filter">
          <option value="">All aliases</option>
        </select>
      </div>
      <div class="card">
        <h3>Inbox</h3>
        <div class="stats" id="statsRow">
          <div class="stat"><div class="stat-value" id="statTotal">0</div><div class="stat-label">total</div></div>
          <div class="stat"><div class="stat-value" id="statOtp">0</div><div class="stat-label">OTP</div></div>
          <div class="stat"><div class="stat-value" id="statAliases">0</div><div class="stat-label">aliases</div></div>
        </div>
        <div style="margin-top: 12px;" class="messages" id="messages" aria-live="polite"></div>
      </div>
      <div class="card">
        <h3>Cleanup</h3>
        <div class="row">
          <button id="purgeOtpBtn" class="ghost" type="button">Delete OTP history</button>
          <button id="purgeAllBtn" class="danger" type="button">Delete all history</button>
        </div>
      </div>
    </aside>
    <main>
      <div class="card" style="display: grid; gap: 12px;">
        <h2 id="detailSubject" style="margin: 0;">Select a message</h2>
        <div class="muted" id="detailMeta">No message selected.</div>
        <div id="detailOtp"></div>
        <div id="detailHtml" class="email-surface"><p class="email-empty">Inbox preview will appear here.</p></div>
        <details>
          <summary class="muted" style="cursor: pointer;">Raw preview</summary>
          <pre id="detailPreview" class="preview">Inbox preview text will appear here.</pre>
        </details>
        <div class="row">
          <button id="deleteBtn" class="danger" type="button" disabled>Delete message</button>
        </div>
      </div>
    </main>
  </div>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
(function () {
  "use strict";

  var state = { messages: [], selectedId: null, aliases: [], domains: [], currentDomain: "" };
  var $ = function (id) { return document.getElementById(id); };

  function showToast(message) {
    var toast = $("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove("visible"); }, 1800);
  }

  function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function formatTime(value) {
    try { return new Date(value).toLocaleString(); } catch (_) { return String(value); }
  }

  async function api(path, options) {
    options = options || {};
    var response;
    try {
      response = await fetch(path, {
        credentials: "same-origin",
        headers: Object.assign({ "content-type": "application/json" }, options.headers || {}),
        method: options.method || "GET",
        body: options.body,
      });
    } catch (error) {
      throw new Error("Network error: " + (error && error.message ? error.message : "request failed"));
    }
    if (response.status === 401) {
      location.href = "/login";
      throw new Error("Unauthorized");
    }
    var contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") !== -1) {
      var data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || ("Request failed (" + response.status + ")"));
      }
      return data;
    }
    if (!response.ok) throw new Error("Request failed (" + response.status + ")");
    return response.text();
  }

  function updateStats() {
    $("statTotal").textContent = String(state.messages.length);
    $("statOtp").textContent = String(state.messages.filter(function (m) { return m.is_otp; }).length);
    $("statAliases").textContent = String(state.aliases.length);
  }

  function renderMessages() {
    var root = $("messages");
    clearNode(root);
    if (state.messages.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Belum ada email. Kirim email ke alias yang kamu buat — akan muncul di sini.";
      root.appendChild(empty);
      updateStats();
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.messages.length; i++) {
      var message = state.messages[i];
      var item = document.createElement("button");
      item.type = "button";
      item.className = "message" + (state.selectedId === message.id ? " active" : "");
      item.dataset.id = message.id;

      var top = document.createElement("div");
      top.className = "message-top";
      var addr = document.createElement("span");
      addr.className = "message-address";
      addr.textContent = message.alias_full;
      top.appendChild(addr);
      if (message.is_otp) {
        var pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = "OTP";
        top.appendChild(pill);
      }
      item.appendChild(top);

      var subject = document.createElement("div");
      subject.className = "message-subject";
      subject.textContent = message.subject || "(no subject)";
      item.appendChild(subject);

      var sender = document.createElement("div");
      sender.className = "muted";
      sender.textContent = message.sender || "-";
      item.appendChild(sender);

      var when = document.createElement("div");
      when.className = "muted";
      when.textContent = formatTime(message.received_at);
      item.appendChild(when);

      item.addEventListener("click", (function (id) {
        return function () { selectMessage(id); };
      })(message.id));
      frag.appendChild(item);
    }
    root.appendChild(frag);
    updateStats();
  }

  function populateDomainSelect(select, domains) {
    clearNode(select);
    for (var i = 0; i < domains.length; i++) {
      var opt = document.createElement("option");
      opt.value = domains[i];
      opt.textContent = "@" + domains[i];
      select.appendChild(opt);
    }
  }

  function populateAliasFilter(select, aliases, primaryDomain, previousValue) {
    clearNode(select);
    var all = document.createElement("option");
    all.value = "";
    all.textContent = "All aliases";
    select.appendChild(all);
    for (var i = 0; i < aliases.length; i++) {
      var opt = document.createElement("option");
      opt.value = aliases[i].alias_local;
      opt.textContent = aliases[i].alias_local + "@" + primaryDomain;
      if (aliases[i].alias_local === previousValue) opt.selected = true;
      select.appendChild(opt);
    }
  }

  async function loadAliases() {
    var data = await api("/api/aliases");
    state.aliases = data.aliases || [];
    state.domains = data.domains || [data.domain];
    state.currentDomain = data.domain;
    populateDomainSelect($("aliasDomainSelect"), state.domains);
    var currentFilter = $("aliasFilter").value;
    populateAliasFilter($("aliasFilter"), state.aliases, data.domain, currentFilter);
    updateStats();
  }

  function resetDetail() {
    $("detailSubject").textContent = "Select a message";
    $("detailMeta").textContent = "No message selected.";
    clearNode($("detailOtp"));
    clearNode($("detailHtml"));
    var placeholder = document.createElement("p");
    placeholder.className = "email-empty";
    placeholder.textContent = "Inbox preview will appear here.";
    $("detailHtml").appendChild(placeholder);
    $("detailPreview").textContent = "Inbox preview text will appear here.";
    $("deleteBtn").disabled = true;
  }

  function renderOtpCallout(code) {
    var holder = $("detailOtp");
    clearNode(holder);
    if (!code || code === "-") return;
    var box = document.createElement("div");
    box.className = "otp-callout";
    var label = document.createElement("div");
    label.innerHTML = '<div class="title-eyebrow">verification code</div>';
    var codeEl = document.createElement("div");
    codeEl.className = "otp-callout-code";
    codeEl.textContent = code;
    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { showToast("OTP copied"); });
      } else {
        showToast("Copy unsupported");
      }
    });
    var codeWrap = document.createElement("div");
    codeWrap.style.flex = "1";
    codeWrap.appendChild(label);
    codeWrap.appendChild(codeEl);
    box.appendChild(codeWrap);
    box.appendChild(copyBtn);
    holder.appendChild(box);
  }

  async function selectMessage(id) {
    state.selectedId = id;
    renderMessages();
    var data;
    try {
      data = await api("/api/messages/" + encodeURIComponent(id));
    } catch (error) {
      showToast(error.message || "Failed to load message");
      return;
    }
    var message = data.message;
    $("detailSubject").textContent = message.subject || "(no subject)";
    $("detailMeta").textContent = [message.alias_full, message.sender, formatTime(message.received_at)]
      .filter(Boolean).join(" • ");
    renderOtpCallout(message.is_otp ? message.otp_code : "");
    // renderedHtml is produced by the server-side allow-list renderer that
    // only emits <p>/<ul>/<li>/<br>/<a> and escapes all text. Safe to inject.
    $("detailHtml").innerHTML = message.rendered_html || '<p class="email-empty">(no html preview)</p>';
    $("detailPreview").textContent = message.preview_text || "(no preview)";
    $("deleteBtn").disabled = false;
  }

  async function loadMessages() {
    var alias = $("aliasFilter").value;
    var data = await api("/api/messages" + (alias ? "?alias=" + encodeURIComponent(alias) : ""));
    state.messages = data.messages || [];
    if (!state.messages.find(function (m) { return m.id === state.selectedId; })) {
      state.selectedId = state.messages.length ? state.messages[0].id : null;
    }
    renderMessages();
    if (state.selectedId) await selectMessage(state.selectedId);
    else resetDetail();
  }

  async function init() {
    try {
      await api("/api/session");
      await loadAliases();
      await loadMessages();
    } catch (error) {
      showToast(error.message || "Failed to load dashboard");
      resetDetail();
    }
  }

  $("refreshBtn").addEventListener("click", async function () {
    try { await loadAliases(); await loadMessages(); showToast("Refreshed"); }
    catch (error) { showToast(error.message || "Refresh failed"); }
  });
  $("aliasFilter").addEventListener("change", async function () {
    try { await loadMessages(); }
    catch (error) { showToast(error.message || "Filter failed"); }
  });
  $("createAliasBtn").addEventListener("click", async function () {
    var alias = $("aliasInput").value;
    var domain = $("aliasDomainSelect").value;
    try {
      var data = await api("/api/aliases", { method: "POST", body: JSON.stringify({ alias: alias, domain: domain }) });
      $("aliasResult").textContent = data.address;
      $("aliasInput").value = "";
      await loadAliases();
      await loadMessages();
      showToast("Alias created");
    } catch (error) {
      $("aliasResult").textContent = "";
      showToast(error.message || "Create failed");
    }
  });
  $("deleteBtn").addEventListener("click", async function () {
    if (!state.selectedId) return;
    try {
      await api("/api/messages/" + encodeURIComponent(state.selectedId), { method: "DELETE" });
      state.selectedId = null;
      await loadMessages();
      showToast("Message deleted");
    } catch (error) { showToast(error.message || "Delete failed"); }
  });
  $("purgeOtpBtn").addEventListener("click", async function () {
    if (!confirm("Hapus semua OTP history?")) return;
    try { await api("/api/messages/purge-otp", { method: "POST", body: "{}" }); state.selectedId = null; await loadMessages(); showToast("OTP purged"); }
    catch (error) { showToast(error.message || "Purge failed"); }
  });
  $("purgeAllBtn").addEventListener("click", async function () {
    if (!confirm("Hapus SEMUA email history? Tidak bisa di-undo.")) return;
    try { await api("/api/messages/purge-all", { method: "POST", body: "{}" }); state.selectedId = null; await loadMessages(); showToast("Inbox cleared"); }
    catch (error) { showToast(error.message || "Purge failed"); }
  });
  $("logoutBtn").addEventListener("click", async function () {
    try { await api("/logout", { method: "POST", body: "{}" }); }
    finally { location.href = "/login"; }
  });

  init();
})();
</script>
</body>
</html>`;
}
