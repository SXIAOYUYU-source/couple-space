/* 小禹和小颖的专属空间 · 离线推送中继
   部署到 Cloudflare Workers 后，把 Worker 网址填写到 App 设置里的“离线推送”中。
   不需要的时候可以保留此文件，App 会等网址填好后自动开启。 */

const VAPID_PUBLIC_KEY = "BJDcQivlelNDUkOujikcH0schuI0rC6hYQNXNcWImLSqOOY6kATwDU3h7vHm02jVrUSbW5tGMaTMek9t-XDhGWw";
const VAPID_PRIVATE_JWK = {
  "kty": "EC",
  "x": "kNxCK-V6U0NSQ66OKRwfSxyG4jSsLqFhA1c1xYiYtKo",
  "y": "OOY6kATwDU3h7vHm02jVrUSbW5tGMaTMek9t-XDhGWw",
  "crv": "P-256",
  "d": "wf-QPpOazUNEQY3s8pdTh7pnnz-29j3EMAxJcyivzb0"
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function json(data, status){
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: JSON_HEADERS
  });
}

function bytesToBase64Url(bytes){
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for(let i = 0; i < bytes.length; i += 3){
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? alphabet[((b1 & 15) << 2) | (b2 >> 6)] : "";
    out += i + 2 < bytes.length ? alphabet[b2 & 63] : "";
  }
  return out;
}

function base64UrlToBytes(str){
  const clean = (str || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(){
  const parts = Array.prototype.slice.call(arguments);
  const total = parts.reduce(function(n, p){ return n + p.length; }, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach(function(p){
    out.set(p, offset);
    offset += p.length;
  });
  return out;
}

async function hkdfExtract(salt, ikm){
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm));
}

async function hkdfExpand(prk, info, length){
  const out = new Uint8Array(length);
  let block = new Uint8Array(0);
  let i = 1;
  let written = 0;
  while(written < length){
    const input = new Uint8Array(block.length + info.length + 1);
    input.set(block, 0);
    input.set(info, block.length);
    input[input.length - 1] = i;
    const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    block = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
    const take = Math.min(32, length - written);
    out.set(block.subarray(0, take), written);
    written += take;
    i++;
  }
  return out;
}

async function hkdf(salt, ikm, info, length){
  const prk = await hkdfExtract(salt, ikm);
  return hkdfExpand(prk, info, length);
}

async function encryptPayload(subscription, payloadBytes){
  const p256dh = base64UrlToBytes(subscription.keys.p256dh);
  const auth = base64UrlToBytes(subscription.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const rawEph = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const receiver = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiver }, eph.privateKey, 256));
  const encoder = new TextEncoder();
  const prkKey = await hkdfExtract(auth, shared);
  const webPushInfo = concatBytes(encoder.encode("WebPush: info\0"), p256dh, rawEph);
  const ikm = await hkdfExpand(prkKey, webPushInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const padded = concatBytes(Uint8Array.of(2), payloadBytes);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, padded));
  const header = concatBytes(salt, Uint8Array.of(0, 0, 0x10, 0x00), rawEph);
  return concatBytes(header, ciphertext);
}

async function createVapidJwt(endpoint){
  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: aud,
    exp: now + 12 * 3600,
    sub: "mailto:couple-space@example.com"
  };
  const encoder = new TextEncoder();
  const data = bytesToBase64Url(encoder.encode(JSON.stringify(header))) + "." + bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("jwk", VAPID_PRIVATE_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(data)));
  return data + "." + bytesToBase64Url(signature);
}

async function sendPush(subscription, title, body, tag){
  const payload = JSON.stringify({ title: title, body: body, tag: tag || "chat", url: "/#chat" });
  const encrypted = await encryptPayload(subscription, new TextEncoder().encode(payload));
  const vapid = await createVapidJwt(subscription.endpoint);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": "vapid " + vapid,
      "TTL": "86400",
      "Urgency": "normal",
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm"
    },
    body: encrypted
  });
}

async function readSubs(env, coupleCode, who){
  const raw = await env.PUSH_KV.get("subs:" + coupleCode + ":" + who);
  if(!raw) return [];
  const list = JSON.parse(raw);
  return Array.isArray(list) ? list : [];
}

async function handleRegister(request, env){
  try{
    const data = await request.json();
    const coupleCode = String(data.coupleCode || "").trim();
    const who = data.who === "boy" ? "boy" : (data.who === "girl" ? "girl" : "");
    const sub = data.subscription;
    if(!coupleCode || !who || !sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth){
      return json({ ok: false, error: "参数不完整" }, 400);
    }
    const key = "subs:" + coupleCode + ":" + who;
    const list = await readSubs(env, coupleCode, who);
    const next = list.filter(function(item){ return item.endpoint !== sub.endpoint; });
    next.push({ endpoint: sub.endpoint, keys: sub.keys, name: data.name || "", time: Date.now() });
    await env.PUSH_KV.put(key, JSON.stringify(next.slice(-5)));
    return json({ ok: true, registered: true });
  }catch(err){
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

async function handleNotify(request, env){
  try{
    const data = await request.json();
    const coupleCode = String(data.coupleCode || "").trim();
    const toWho = data.toWho === "boy" ? "boy" : (data.toWho === "girl" ? "girl" : "");
    const title = String(data.title || "新消息").slice(0, 80);
    const body = String(data.body || "").slice(0, 200);
    const tag = String(data.tag || "chat");
    if(!coupleCode || !toWho){
      return json({ ok: false, error: "参数不完整" }, 400);
    }
    const key = "subs:" + coupleCode + ":" + toWho;
    const list = await readSubs(env, coupleCode, toWho);
    if(!list.length) return json({ ok: true, sent: 0, total: 0 });
    const results = await Promise.all(list.map(async function(sub){
      try{
        const res = await sendPush(sub, title, body, tag);
        return { sub: sub, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
      }catch(err){
        return { sub: sub, ok: false, gone: false };
      }
    }));
    const alive = list.filter(function(sub, i){ return !results[i].gone; });
    if(alive.length !== list.length) await env.PUSH_KV.put(key, JSON.stringify(alive));
    return json({ ok: true, sent: results.filter(function(r){ return r.ok; }).length, total: list.length });
  }catch(err){
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

async function handleTest(request, env){
  try{
    const data = await request.json();
    const coupleCode = String(data.coupleCode || "").trim();
    const who = data.who === "boy" ? "boy" : (data.who === "girl" ? "girl" : "");
    const sub = data.subscription;
    if(!coupleCode || !who || !sub || !sub.endpoint){
      return json({ ok: false, error: "参数不完整" }, 400);
    }
    const res = await sendPush(sub, "离线推送已开启", "这是一条测试消息，退出 App 后也能收到。", "test");
    return json({ ok: res.status >= 200 && res.status < 300, status: res.status });
  }catch(err){
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

export default {
  async fetch(request, env){
    if(request.method === "OPTIONS"){
      return new Response("ok", { headers: JSON_HEADERS });
    }
    const url = new URL(request.url);
    if(url.pathname === "/" && request.method === "GET"){
      return json({ ok: true, service: "couple-push" });
    }
    if(url.pathname === "/api/push/register" && request.method === "POST"){
      return handleRegister(request, env);
    }
    if(url.pathname === "/api/push/notify" && request.method === "POST"){
      return handleNotify(request, env);
    }
    if(url.pathname === "/api/push/test" && request.method === "POST"){
      return handleTest(request, env);
    }
    return json({ ok: false, error: "not found" }, 404);
  }
};
