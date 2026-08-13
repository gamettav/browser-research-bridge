const debuggerPort = Number(process.env.BROWSER_RESEARCH_CDP_PORT ?? 9223);
const targets = await fetch(`http://127.0.0.1:${debuggerPort}/json/list`).then((response) => response.json());
const extension = targets.find((target) => target.type === "page" && target.url.includes("/options.html"));
if (!extension) throw new Error("Extension options page not found");

const socket = new WebSocket(extension.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const expression = `new Promise(async resolve => {
  const config = await chrome.storage.local.get(['token', 'port']);
  const port = chrome.runtime.connectNative('com.browser_research.bridge');
  const timer = setTimeout(() => { port.disconnect(); resolve({ ok: false, error: 'timed out' }); }, 5000);
  const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const hmac = async payload => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(config.token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  };
  port.onMessage.addListener(async message => {
    if (message?.type === 'auth_challenge') {
      const expected = await hmac('browser-research|server|extension|' + message.nonce + '|' + message.protocolVersion + '|' + message.serverBuildId);
      if (expected !== message.proof) return resolve({ ok: false, error: 'invalid server proof' });
      const clientBuildId = 'browser-research-0.4.0-progress-v3';
      const proof = await hmac('browser-research|client|extension|' + message.nonce + '|3|' + chrome.runtime.id + '|' + clientBuildId);
      port.postMessage({ type: 'auth_response', channel: 'extension', nonce: message.nonce, protocolVersion: 3, clientId: chrome.runtime.id, clientVersion: chrome.runtime.getManifest().version, clientBuildId, proof });
      return;
    }
    if (message?.type === 'auth_ok') {
      clearTimeout(timer);
      port.disconnect();
      resolve({ ok: true, message });
    }
  });
  port.onDisconnect.addListener(() => {
    clearTimeout(timer);
    resolve({ ok: false, error: chrome.runtime.lastError?.message ?? 'disconnected' });
  });
})`;
socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
const result = await new Promise((resolve) => {
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id === 1) resolve(message);
  });
});
socket.close();
process.stdout.write(`${JSON.stringify(result.result?.result?.value ?? result, null, 2)}\n`);
