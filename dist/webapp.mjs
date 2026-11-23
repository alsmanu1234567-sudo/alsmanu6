import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as groupGuard from "../services/group-guard.mjs";
import * as aiCard from "../services/ai-card.mjs";
import { createZip, readZip } from "../services/zip-lite.mjs";
// ═══════════════════════════════════════════════════════════════════
// webapp.mjs — واجهة ويب داخلية لإدارة التحويلات
// تعمل داخل نفس خادم البوت — لا تحتاج أي شيء خارجي
// كل مستخدم يرى بياناته فقط عبر token خاص به
// ═══════════════════════════════════════════════════════════════════
import { userForToken } from "./webapp-auth.mjs";
import {
  webGetOverview,
  webPreviewChannel,
  webAddChannel,
  webDeleteChannel,
  webRefreshGroups,
  webSendGroupMessage,
  webCreateRule,
  webUpdateRule,
  webDeleteRule,
  webChatPicture,
} from "./forward.mjs";
import {
  applyWebGroupAction,
  getWebGroupDetails,
  getWebGroupInvite,
  setWebGroupSetting,
  saveWebGroupLinkWarningMessage,
  saveWebGroupWordFilterSettings,
  saveWebGroupMessageSettings,
  saveWebGroupLockSchedule,
  saveWebGroupReminder,
  setWebGroupReminderEnabled,
  deleteWebGroupReminder,
  saveWebGroupAutoPost,
  setWebGroupAutoPostEnabled,
  deleteWebGroupAutoPost,
  previewWebGroupAutoPost,
  publishWebGroupAutoPostNow,
  webGuardTestWelcome,
  webGuardReAdd,
} from "./handlers/groups-handler.mjs";
import {ludoEngine,loadLudoHtml} from "../services/ludo-game.mjs";
import { getSharedState, joinShared, moveShared } from "../services/xo-shared.mjs";
import { getMultiState, moveMulti, acceptMulti } from "../services/xo-multiplayer.mjs";
import { registerGroupWorldWebApp } from "./group-world-web.mjs";

// ─── مصادقة ────────────────────────────────────────────────────────
function authUid(req) {
  const token =
    req.query?.token ||
    req.headers["x-webapp-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return userForToken(token);
}

function guard(handler) {
  return async (req, res) => {
    const uid = authUid(req);
    if (!uid) return res.status(401).json({ error: "غير مصرح — افتح الرابط من البوت" });
    try {
      const out = await handler(uid, req, res);
      if (out !== undefined) res.json(out);
    } catch (e) {
      res.status(400).json({ error: e?.message || "خطأ غير متوقع" });
    }
  };
}

// ─── التسجيل في تطبيق Express ──────────────────────────────────────
export function registerWebApp(app, { replyService, aiService, myMsgsService, siteGenService, messagesService, memberService, statusService, devDiag, sessionBridge } = {}) {
  // JSON body parsing خاص بمسارات الويب آب فقط (لا يؤثر على بقية البوت)
  const parseJson = (req, res, next) => {
    if (req.headers["content-type"]?.includes("application/json") && !req.body) {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 26e6) req.destroy(); });
      req.on("end", () => {
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        next();
      });
    } else next();
  };

  // ─── صفحة تشخيص الرد (للمطور) ───────────────────────────────────
  if (devDiag) {
    app.get("/dev-diag", (req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.end(readFileSync(fileURLToPath(new URL("../public/dev-diag.html", import.meta.url))));
    });
    app.get("/api/dev-diag/overview", guard(async (uid) => devDiag.overview(uid)));
    app.post("/api/dev-diag/action", parseJson, guard(async (uid, req) => devDiag.action(uid, req.body?.name, req.body?.payload || {})));
  }

  app.get("/webapp", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const navigation = '<a class="btn btn-s btn-sm" style="margin-top:10px;text-decoration:none" href="/group-world" onclick="location.href=\'/group-world\'+location.search;return false">🌍 عالم المجموعات</a>\n  <a class="btn btn-s btn-sm" style="margin-top:10px;text-decoration:none" href="/dev-diag" onclick="location.href=\'/dev-diag\'+location.search;return false">🩺 تشخيص الرد</a>';
    res.end(HTML_PAGE.replace('<div class="hdr">', `<div class="hdr">\n  ${navigation}`));
  });

  app.get("/steam-games/:name", async (req,res) => {res.setHeader("Cache-Control","no-store");res.setHeader("Referrer-Policy","no-referrer");try{const {loadSteamGame}=await import("../services/steam-games.mjs");res.type("html").send(await loadSteamGame(req.params.name));}catch{res.status(404).send("اللعبة غير موجودة");}});
  app.get("/ludo", async (_req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); try {res.end(await loadLudoHtml());} catch {res.status(500).end("تعذر تحميل اللعبة");} });
  // The embedded game may be hosted by WhatsApp at an opaque origin. Game/seat
  // capability tokens, not browser cookies, authorize these isolated endpoints.
  const ludoCors = (req,res,next) => {res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Ludo-Game, X-Ludo-Seat");res.setHeader("Cache-Control","no-store");if(req.method === "OPTIONS")return res.status(204).end();next();};
  if (typeof app.options === "function") app.options("/api/ludo/:action",ludoCors);
  const ludoGuard = fn => async(req,res) => {res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Cache-Control","no-store");try{res.json(await fn(req.headers["x-ludo-game"],req.headers["x-ludo-seat"],req));}catch(e){res.status(400).json({error:e?.message||"تعذر تنفيذ الحركة"});}};
  app.get("/api/ludo/state",ludoGuard(async(id,seat)=>ludoEngine.state(id,seat)));
  app.post("/api/ludo/join",parseJson,ludoGuard(async(id,seat,req)=>ludoEngine.join(id,seat,req.body?.name)));
  app.post("/api/ludo/start",parseJson,ludoGuard(async(id,seat)=>ludoEngine.start(id,seat)));
  app.post("/api/ludo/roll",parseJson,ludoGuard(async(id,seat)=>ludoEngine.roll(id,seat)));
  app.post("/api/ludo/move",parseJson,ludoGuard(async(id,seat,req)=>ludoEngine.move(id,seat,req.body?.piece)));
  app.post("/api/ludo/chat",parseJson,ludoGuard(async(id,seat,req)=>ludoEngine.chat(id,seat,req.body)));

  app.get("/xo-shared", (_req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.end(readFileSync(fileURLToPath(new URL("../public/xo-shared.html", import.meta.url)))); });
  const sharedGuard = fn => async(req,res) => { res.setHeader("Cache-Control","no-store"); try {res.json(await fn(req.headers["x-xo-game"],req.headers["x-xo-seat"],req));}catch(e){res.status(400).json({error:e?.message||"تعذر تنفيذ الحركة"});} };
  app.get("/api/xo-shared/state",sharedGuard(async(id,seat)=>getSharedState(id,seat)));
  app.post("/api/xo-shared/join",parseJson,sharedGuard(async(id,seat)=>joinShared(id,seat)));
  app.post("/api/xo-shared/move",parseJson,sharedGuard(async(id,seat,req)=>moveShared(id,seat,req.body?.position)));

  app.get("/xo-multi", (_req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.end(readFileSync(fileURLToPath(new URL("../public/xo-multi.html", import.meta.url)))); });
  const xoGuard = fn => async (req,res) => { res.setHeader("Cache-Control","no-store"); try { res.json(await fn(req.headers["x-xo-token"],req)); } catch (e) {res.status(400).json({error:e?.message||"تعذر تنفيذ الحركة"});} };
  app.get("/api/xo-multi/state", xoGuard(async t => getMultiState(t)));
  app.post("/api/xo-multi/join", parseJson, xoGuard(async t => acceptMulti(t)));
  app.post("/api/xo-multi/move", parseJson, xoGuard(async (t,req) => moveMulti(t,req.body?.position)));

  app.get("/xo-ultra", (_req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(readFileSync(fileURLToPath(new URL("../public/xo-ultra.html", import.meta.url)))); });

  const siteWeb = () => {if(!siteGenService)throw Error('الأداة غير جاهزة');return siteGenService;};
  app.get('/sitegen-web.js',(_req,res)=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(readFileSync(fileURLToPath(new URL('../public/sitegen-web.js',import.meta.url))));});
  app.get('/api/sitegen/overview',guard(async uid=>siteWeb().overview(uid)));
  app.post('/api/sitegen/start',parseJson,guard(async(uid,req)=>siteWeb().start(uid,req.body||{})));
  app.post('/api/sitegen/stop',parseJson,guard(async(uid,req)=>siteWeb().stop(uid,req.body?.code)));

  const statusWeb=()=>{if(!statusService)throw Error('قسم الحالات غير جاهز');return statusService;};
  app.get('/status-web.js',(_req,res)=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(readFileSync(fileURLToPath(new URL('../public/status-web.js',import.meta.url))));});
  app.get('/api/status/overview',guard(async uid=>statusWeb().overview(uid)));
  app.post('/api/status/audience',parseJson,guard(async(uid,req)=>statusWeb().saveAudience(uid,req.body?.jids)));
  app.post('/api/status/publish',parseJson,guard(async(uid,req)=>statusWeb().publishWeb(uid,req.body)));

  const membersWeb=()=>{if(!memberService)throw Error('مركز الأعضاء غير جاهز');return memberService;};
  app.get('/member-manager.js',(_req,res)=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(readFileSync(fileURLToPath(new URL('../public/member-manager.js',import.meta.url))));});
  app.get('/api/member-manager/overview',guard(async uid=>membersWeb().overview(uid)));
  app.get('/api/member-manager/groups',guard(async uid=>({groups:await membersWeb().groups(uid)})));
  app.get('/api/member-manager/members',guard(async(uid,req)=>membersWeb().members(uid,req.query?.id,req.query?.q)));
  app.get('/api/member-manager/job',guard(async(uid,req)=>membersWeb().jobDetail(uid,req.query?.id)));
  app.post('/api/member-manager/extract',parseJson,guard(async(uid,req)=>membersWeb().extract(uid,req.body)));
  app.post('/api/member-manager/delete-list',parseJson,guard(async(uid,req)=>membersWeb().removeList(uid,req.body?.id)));
  app.post('/api/member-manager/start',parseJson,guard(async(uid,req)=>membersWeb().createJob(uid,req.body)));
  app.post('/api/member-manager/control',parseJson,guard(async(uid,req)=>membersWeb().control(uid,req.body?.id,req.body?.action)));
  // ═══ [GROUP-GUARD] حماية المجموعات: تحذيرات تصاعدية، كروت، أوامر النقطة ═══
  const guardGroupId = (req) => {
    const id = String(req.body?.groupId || req.query?.groupId || "").trim();
    if (!id.endsWith("@g.us")) throw new Error("اختر مجموعة أولاً");
    return id;
  };
  const publicGuardConfig = (config) => {
    const cards = {};
    for (const [kind, file] of Object.entries(config.cards || {})) {
      try { cards[kind] = Boolean(file) && existsSync(file); } catch { cards[kind] = false; }
    }
    const { cards: _drop, ...rest } = config;
    return { ...rest, cards, cardVersion: Date.now() };
  };
  app.get('/groups-guard-web.js', (_req, res) => { res.setHeader('Content-Type', 'application/javascript; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(readFileSync(fileURLToPath(new URL("../public/groups-guard-web.js", import.meta.url)))); });
  app.get('/api/fw/groups/guard', guard(async (uid, req) => {
    const groupId = guardGroupId(req);
    return { groupId, config: publicGuardConfig(groupGuard.getGroupConfig(uid, groupId)), warnings: groupGuard.listWarnings(uid, groupId), kicked: groupGuard.listKicked(uid, groupId), commands: groupGuard.commandsCatalog() };
  }));
  app.get('/api/fw/groups/guard/card', guard(async (uid, req, res) => {
    const groupId = guardGroupId(req);
    const kind = String(req.query?.kind || "warn1");
    const file = groupGuard.getGroupConfig(uid, groupId).cards?.[kind];
    if (!file || !existsSync(file)) throw new Error("لا يوجد كرت بهذا النوع");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(readFileSync(file));
  }));
  app.post('/api/fw/groups/guard', parseJson, guard(async (uid, req) => {
    const groupId = guardGroupId(req);
    const patch = req.body?.patch || {};
    const allowed = {};
    for (const key of ["enabled", "linkGuard", "wordGuard", "stickerGuard", "imageGuard", "audioGuard", "kickOnLimit", "maxWarnings", "stickerWarnEvery", "kickDelaySec", "words", "welcome", "goodbye"]) {
      if (key in patch) allowed[key] = patch[key];
    }
    return { groupId, config: publicGuardConfig(groupGuard.updateGroupConfig(uid, groupId, allowed)) };
  }));
  app.post('/api/fw/groups/guard/card', parseJson, guard(async (uid, req) => {
    const groupId = guardGroupId(req);
    return { ok: true, config: publicGuardConfig(groupGuard.saveCardImage(uid, groupId, String(req.body?.kind || ""), req.body?.dataUrl)) };
  }));
  // ═══ [AI-CARD] كرت ردود الذكاء الاصطناعي ═══
  app.get('/ai-card-web.js', (_req, res) => { res.setHeader('Content-Type', 'application/javascript; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(readFileSync(fileURLToPath(new URL("../public/ai-card-web.js", import.meta.url)))); });
  app.get('/api/ai/card', guard(async () => {
    const config = aiCard.getAiCardConfig();
    return { enabled: config.enabled, custom: config.custom, exists: config.exists, version: config.version };
  }));
  app.get('/api/ai/card/image', guard(async (_uid, _req, res) => {
    const file = aiCard.aiCardFile();
    if (!file || !existsSync(file)) throw new Error("لا يوجد كرت");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(readFileSync(file));
  }));
  app.post('/api/ai/card', parseJson, guard(async (_uid, req) => {
    let config;
    if (req.body?.reset) config = aiCard.resetAiCardImage();
    else if (req.body?.dataUrl) config = aiCard.saveAiCardImage(req.body.dataUrl);
    else if (typeof req.body?.enabled === "boolean") config = aiCard.setAiCardEnabled(req.body.enabled);
    else throw new Error("طلب غير صالح");
    return { enabled: config.enabled, custom: config.custom, exists: config.exists, version: config.version };
  }));

  app.post('/api/fw/groups/guard/readd', parseJson, guard(async (uid, req) => {
    const groupId = guardGroupId(req);
    return webGuardReAdd(uid, groupId, String(req.body?.jid || ""), req.body?.phoneNumber || null);
  }));
  app.post('/api/fw/groups/guard/kicked/remove', parseJson, guard(async (uid, req) => {
    const groupId = guardGroupId(req);
    const left = groupGuard.removeKicked(uid, groupId, String(req.body?.jid || ""));
    return { ok: true, kicked: left };
  }));
  app.post('/api/fw/groups/guard/test-welcome', parseJson, guard(async (uid, req) => {
    const groupId = guardGroupId(req);
    return webGuardTestWelcome(uid, groupId, req.body?.phoneNumber || null, Array.isArray(req.body?.jids) ? req.body.jids : []);
  }));
  app.post('/api/fw/groups/guard/reset', parseJson, guard(async (uid, req) => {
    const groupId = guardGroupId(req);
    const cleared = groupGuard.resetWarnings(uid, groupId, req.body?.memberJid || null);
    return { ok: true, cleared, warnings: groupGuard.listWarnings(uid, groupId) };
  }));

  // ═══ [SESSION-PORT] تصدير واستيراد جلسة واتساب كملف مضغوط ═══
  const sessionRoot = () => process.env.WA_SESSIONS_ROOT || join(process.cwd(), "wa-sessions");
  const sessionDirsFor = (uid) => {
    try {
      return readdirSync(sessionRoot()).filter((name) => {
        try { return statSync(join(sessionRoot(), name)).isDirectory() && (name === String(uid) || name.startsWith(`${uid}_`)); } catch { return false; }
      });
    } catch { return []; }
  };
  app.get('/api/session/list', guard(async (uid) => ({
    sessions: sessionDirsFor(uid).map((key) => ({ key, phone: key.includes("_") ? key.split("_").pop() : key })),
  })));
  app.get('/api/session/export', guard(async (uid, req, res) => {
    const dirs = sessionDirsFor(uid);
    if (!dirs.length) throw new Error("لا توجد جلسة محفوظة لهذا الحساب بعد");
    const wanted = String(req.query?.key || "");
    const key = dirs.includes(wanted) ? wanted : dirs[0];
    const base = join(sessionRoot(), key);
    const files = [];
    const walk = (dir, prefix) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, rel);
        else {
          try {
            if (statSync(full).size > 20 * 1024 * 1024) continue;
            files.push({ name: rel, data: readFileSync(full) });
          } catch { }
        }
      }
    };
    walk(base, "");
    if (!files.some((file) => file.name === "creds.json" || file.name.endsWith("/creds.json"))) {
      throw new Error("الجلسة غير مكتملة (creds.json مفقود) — أعد ربط الرقم أولاً");
    }
    const zip = createZip(files);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="wa-session-${key}.zip"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(zip);
  }));
  app.post('/api/session/import', parseJson, guard(async (uid, req) => {
    const raw = String(req.body?.zipBase64 || "").replace(/^data:[^;]*;base64,/, "");
    if (!raw) throw new Error("لم يتم إرسال ملف الجلسة");
    const zipBuf = Buffer.from(raw, "base64");
    if (!zipBuf.length) throw new Error("الملف فارغ");
    if (zipBuf.length > 24 * 1024 * 1024) throw new Error("حجم الملف يتجاوز 24 ميغابايت");
    const entries = readZip(zipBuf);
    const creds = entries.find((entry) => entry.name === "creds.json" || entry.name.endsWith("/creds.json"));
    if (!creds) throw new Error("الملف لا يحتوي جلسة واتساب (creds.json مفقود)");
    let phone = String(req.body?.phone || "").replace(/\D/g, "");
    if (!phone) {
      try {
        const parsed = JSON.parse(creds.data.toString("utf8"));
        phone = String(parsed?.me?.id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
      } catch { }
    }
    if (!phone || phone.length < 8) throw new Error("تعذر تحديد رقم الجلسة؛ اكتب الرقم مع رمز الدولة");
    const key = `${uid}_${phone}`;
    const target = join(sessionRoot(), key);
    try { if (existsSync(target)) rmSync(target, { recursive: true, force: true }); } catch { }
    mkdirSync(target, { recursive: true });
    let written = 0;
    for (const entry of entries) {
      const name = entry.name.replace(/\\/g, "/").replace(/^\.?\//, "");
      if (!name || name.includes("..") || name.startsWith("/")) continue;
      const dest = join(target, name);
      if (!dest.startsWith(target)) continue;
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, entry.data);
      written += 1;
    }
    if (!written) throw new Error("لم يُكتب أي ملف من الأرشيف");
    let reconnected = false;
    try {
      if (typeof sessionBridge?.reconnect === "function") {
        await sessionBridge.reconnect(uid);
        reconnected = true;
      }
    } catch (error) {
      return { ok: true, key, written, reconnected, warning: String(error?.message || error).slice(0, 160) };
    }
    return { ok: true, key, written, reconnected };
  }));

  const messagesWeb = () => {if(!messagesService)throw Error('قسم الرسائل غير جاهز');return messagesService;};
  app.get('/messages-web.js',(_req,res)=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(readFileSync(fileURLToPath(new URL('../public/messages-web.js',import.meta.url))));});
  app.get('/api/messages/overview',guard(async uid=>messagesWeb().overview(uid)));
  app.post('/api/messages/settings',parseJson,guard(async(uid,req)=>messagesWeb().save(uid,req.body?.settings)));
  app.post('/api/messages/list',parseJson,guard(async(uid,req)=>messagesWeb().list(uid,req.body?.type,req.body?.items)));
  app.post('/api/messages/broadcast/preview',parseJson,guard(async(uid,req)=>messagesWeb().preview(uid,req.body)));
  app.post('/api/messages/broadcast/send',parseJson,guard(async(uid,req)=>messagesWeb().send(uid,req.body?.id)));

  const myMsgsWeb = () => {if(!myMsgsService)throw Error('قسم رسائلي غير جاهز');return myMsgsService;};
  app.get('/my-msgs-web.js',(_req,res)=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(readFileSync(fileURLToPath(new URL('../public/my-msgs-web.js',import.meta.url))));});
  app.get('/api/my-msgs/overview',guard(async(uid,req)=>myMsgsWeb().overview(uid,req.query?.phone)));
  app.post('/api/my-msgs/feature',parseJson,guard(async(uid,req)=>myMsgsWeb().feature(uid,req.body?.phone,req.body?.id,req.body||{})));
  app.post('/api/my-msgs/custom',parseJson,guard(async(uid,req)=>myMsgsWeb().custom(uid,req.body?.phone,req.body||{})));
  app.post('/api/my-msgs/delete',parseJson,guard(async(uid,req)=>myMsgsWeb().remove(uid,req.body?.phone,req.body?.id)));
  app.post('/api/my-msgs/group',parseJson,guard(async(uid,req)=>myMsgsWeb().group(uid,req.body?.phone,req.body?.jid)));
  app.post('/api/my-msgs/pair',parseJson,guard(async(uid,req)=>myMsgsWeb().pairing(uid,req.body?.phone)));

  const aiWeb = () => { if (!aiService) throw Error("خدمة الذكاء غير جاهزة"); return aiService; };
  app.get('/ai-web.js', (_req,res)=>{res.setHeader('Content-Type','application/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(readFileSync(fileURLToPath(new URL('../public/ai-web.js',import.meta.url))));});
  app.get('/api/ai/overview',guard(async uid=>aiWeb().overview(uid)));
  app.get('/api/ai/models',guard(async (uid,req)=>aiWeb().models(uid,{refresh:req.query?.refresh==='1'})));
  app.get('/api/ai/scan-status',guard(async uid=>aiWeb().scanStatus(uid)));
  app.post('/api/ai/scan',parseJson,guard(async uid=>aiWeb().scan(uid)));
  app.post('/api/ai/key',parseJson,guard(async(uid,req)=>aiWeb().saveKey(uid,req.body?.key)));
  app.post('/api/ai/key/delete',parseJson,guard(async uid=>aiWeb().deleteKey(uid)));
  app.post('/api/ai/model',parseJson,guard(async(uid,req)=>aiWeb().select(uid,req.body?.id)));
  app.post('/api/ai/settings',parseJson,guard(async(uid,req)=>aiWeb().settings(uid,req.body||{})));
  app.post('/api/ai/number',parseJson,guard(async(uid,req)=>aiWeb().saveNumber(uid,req.body?.id,req.body||{})));
  app.post('/api/ai/test',parseJson,guard(async(uid,req)=>aiWeb().test(uid,req.body?.text)));
  app.post('/api/ai/memory/clear',parseJson,guard(async uid=>aiWeb().clear(uid)));

  const reply = () => { if (!replyService) throw new Error('خدمة الردود غير جاهزة'); return replyService; };
  app.get('/auto-replies.js', (_req, res) => { res.setHeader('Content-Type','application/javascript; charset=utf-8'); res.setHeader('Cache-Control','no-store'); res.end(readFileSync(fileURLToPath(new URL('../public/auto-replies.js', import.meta.url)))); });
  app.get('/auto-replies.css', (_req, res) => { res.setHeader('Content-Type','text/css; charset=utf-8'); res.setHeader('Cache-Control','no-store'); res.end(readFileSync(fileURLToPath(new URL('../public/auto-replies.css', import.meta.url)))); });
  app.get('/api/replies/list', guard(async uid => ({replies:reply().list(uid), numbers:reply().numbers(uid)})));
  app.post('/api/replies/save', parseJson, guard(async (uid, req) => reply().save(uid, req.body || {})));
  app.post('/api/replies/delete', parseJson, guard(async (uid, req) => reply().delete(uid, req.body?.id)));
  app.post('/api/replies/toggle', parseJson, guard(async (uid, req) => reply().toggle(uid, req.body?.id, req.body?.enabled)));
  app.post('/api/replies/all', parseJson, guard(async (uid, req) => reply().all(uid, req.body?.enabled)));
  app.post('/api/replies/duplicate', parseJson, guard(async (uid, req) => reply().duplicate(uid, req.body?.id)));
  app.post('/api/replies/import', parseJson, guard(async (uid, req) => reply().import(uid, req.body?.replies)));
  app.post('/api/replies/upload', parseJson, guard(async (uid, req) => await reply().upload(uid, req.body || {})));
  app.get('/api/replies/typing',guard(async uid=>reply().typing(uid)));
  app.post('/api/replies/typing',parseJson,guard(async(uid,req)=>reply().saveTyping(uid,req.body)));
  app.post('/api/replies/delay', parseJson, guard(async (uid, req) => reply().delay(uid, req.body?.id, req.body?.enabled)));

  app.get("/api/fw/overview", guard(async (uid) => webGetOverview(uid)));

  app.post("/api/fw/channel/preview", parseJson, guard(async (uid, req) => {
    return await webPreviewChannel(uid, req.body?.input);
  }));

  app.post("/api/fw/channel/add", parseJson, guard(async (uid, req) => {
    return webAddChannel(uid, req.body || {});
  }));

  app.post("/api/fw/channel/delete", parseJson, guard(async (uid, req) => {
    return webDeleteChannel(uid, req.body?.id);
  }));

  app.post("/api/fw/groups/refresh", parseJson, guard(async (uid, req) => {
    return await webRefreshGroups(uid, req.body?.number);
  }));

  app.post("/api/fw/groups/send", parseJson, guard(async (uid, req) => {
    return await webSendGroupMessage(uid, req.body?.id, req.body?.text, req.body?.phoneNumber);
  }));

  app.post("/api/fw/groups/detail", parseJson, guard(async (uid, req) => {
    return await getWebGroupDetails(uid, req.body?.id, req.body?.phoneNumber);
  }));

  app.post("/api/fw/groups/invite", parseJson, guard(async (uid, req) => {
    return await getWebGroupInvite(uid, req.body?.id, req.body?.phoneNumber);
  }));

  app.post("/api/fw/groups/settings", parseJson, guard(async (uid, req) => {
    return await setWebGroupSetting(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.setting,
      req.body?.enabled,
    );
  }));

  app.post("/api/fw/groups/link-warning", parseJson, guard(async (uid, req) => {
    return await saveWebGroupLinkWarningMessage(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.message,
    );
  }));

  app.post("/api/fw/groups/word-filter", parseJson, guard(async (uid, req) => {
    return await saveWebGroupWordFilterSettings(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body || {},
    );
  }));

  app.post("/api/fw/groups/messages", parseJson, guard(async (uid, req) => {
    return await saveWebGroupMessageSettings(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body || {},
    );
  }));

  app.post("/api/fw/groups/lock-schedule", parseJson, guard(async (uid, req) => {
    return await saveWebGroupLockSchedule(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body || {},
    );
  }));

  app.post("/api/fw/groups/reminders/save", parseJson, guard(async (uid, req) => {
    return await saveWebGroupReminder(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      {
        reminderId: req.body?.reminderId,
        message: req.body?.message,
        time: req.body?.time,
        days: req.body?.days,
      },
    );
  }));

  app.post("/api/fw/groups/reminders/toggle", parseJson, guard(async (uid, req) => {
    return await setWebGroupReminderEnabled(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.reminderId,
      req.body?.enabled,
    );
  }));

  app.post("/api/fw/groups/reminders/delete", parseJson, guard(async (uid, req) => {
    return await deleteWebGroupReminder(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.reminderId,
    );
  }));

  app.post("/api/fw/groups/action", parseJson, guard(async (uid, req) => {
    return await applyWebGroupAction(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.action,
      req.body?.value,
    );
  }));

  app.post("/api/fw/groups/autopost/save", parseJson, guard(async (uid, req) => {
    return await saveWebGroupAutoPost(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      {
        id: req.body?.autoPostId,
        topic: req.body?.topic,
        times: req.body?.times,
        excerptLength: req.body?.excerptLength,
        excerptMode: req.body?.excerptMode,
        aiPrompt: req.body?.aiPrompt,
      },
    );
  }));

  app.post("/api/fw/groups/autopost/toggle", parseJson, guard(async (uid, req) => {
    return await setWebGroupAutoPostEnabled(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.autoPostId,
      req.body?.enabled,
    );
  }));

  app.post("/api/fw/groups/autopost/delete", parseJson, guard(async (uid, req) => {
    return await deleteWebGroupAutoPost(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.autoPostId,
    );
  }));

  app.post("/api/fw/groups/autopost/test", parseJson, guard(async (uid, req) => {
    return await previewWebGroupAutoPost(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.autoPostId,
    );
  }));

  app.post("/api/fw/groups/autopost/publish", parseJson, guard(async (uid, req) => {
    return await publishWebGroupAutoPostNow(
      uid,
      req.body?.id,
      req.body?.phoneNumber,
      req.body?.autoPostId,
    );
  }));

  app.post("/api/fw/rule/create", parseJson, guard(async (uid, req) => {
    return webCreateRule(uid, req.body || {});
  }));

  app.post("/api/fw/rule/update", parseJson, guard(async (uid, req) => {
    return webUpdateRule(uid, req.body?.id, req.body?.patch || {});
  }));

  app.post("/api/fw/rule/delete", parseJson, guard(async (uid, req) => {
    return webDeleteRule(uid, req.body?.id);
  }));

  app.get("/api/fw/pic", guard(async (uid, req, res) => {
    const url = await webChatPicture(uid, String(req.query.jid || ""));
    res.json({ url: url || null });
  }));

  registerGroupWorldWebApp(app, parseJson, guard);

  console.log("[WEBAPP] ✅ واجهة إدارة التحويلات جاهزة على /webapp");
}

// ═══════════════════════════════════════════════════════════════════
// صفحة الويب — واجهة عربية RTL احترافية مناسبة للهاتف
// ═══════════════════════════════════════════════════════════════════
const HTML_PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#171331">
<title>لوحة البوت</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<link rel="stylesheet" href="/auto-replies.css">
<script defer src="/sitegen-web.js"></script>
<script defer src="/member-manager.js" onload="if (typeof TAB !== 'undefined' && TAB === 'members') render()"></script>
<script defer src="/messages-web.js" onload="if (typeof TAB !== 'undefined' && TAB === 'messages') render()"></script>
<script defer src="/my-msgs-web.js" onload="if (typeof TAB !== 'undefined' && TAB === 'mymsgs') render()"></script>
<script defer src="/ai-web.js" onload="if (typeof TAB !== 'undefined' && TAB === 'ai') render()"></script>
<script defer src="/status-web.js" onload="if (typeof TAB !== 'undefined' && TAB === 'status') render()"></script>
<script defer src="/auto-replies.js" onload="if (typeof TAB !== 'undefined' && TAB === 'replies') render()"></script>
<style>
:root{
  --bg:#0a0e1a;--card:#141927;--card2:#1c2436;--line:#252e45;
  --txt:#eef2fa;--mut:#94a3c0;--acc:#34d399;--accD:#052e22;
  --ok:#34d399;--warn:#fbbf24;--del:#f87171;--r:16px;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{background:var(--bg);color:var(--txt);font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;min-height:100%}
body{padding-bottom:88px;font-size:15px;line-height:1.5}
.hdr{position:sticky;top:0;z-index:20;background:rgba(10,14,26,.92);backdrop-filter:blur(12px);padding:16px 18px 10px;border-bottom:1px solid var(--line)}
.hdr h1{font-size:18px;font-weight:800;display:flex;align-items:center;gap:8px;letter-spacing:-.2px}
.hdr .sub{color:var(--mut);font-size:12.5px;margin-top:3px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex-shrink:0}
.dot.on{background:var(--ok);box-shadow:0 0 0 3px rgba(52,211,153,.18)}
.dot.off{background:var(--del);box-shadow:0 0 0 3px rgba(248,113,113,.15)}
.srch{margin:14px 18px 0;position:relative}
.srch input{width:100%;background:var(--card);border:1.5px solid var(--line);border-radius:var(--r);padding:13px 44px 13px 14px;color:var(--txt);font-size:14.5px;outline:none;transition:border-color .18s}
.srch input::placeholder{color:#5b6a8a}
.srch input:focus{border-color:var(--acc)}
.srch .ic{position:absolute;right:15px;top:50%;transform:translateY(-50%);color:var(--mut);font-size:15px;pointer-events:none}
.container{padding:0 18px}
.tabs{display:flex;gap:4px;margin:12px 18px 14px;background:var(--card);border-radius:var(--r);padding:4px;border:1px solid var(--line)}
.tab{flex:1;text-align:center;padding:10px 4px;border-radius:12px;color:var(--mut);font-size:13.5px;font-weight:700;cursor:pointer;transition:background .15s,color .15s;border:none;background:none}
.tab.act{background:var(--acc);color:var(--accD)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 15px;margin-bottom:10px;transition:border-color .15s}
.card:active{border-color:#31405f}
.row{display:flex;align-items:center;gap:13px}
.avatar{width:48px;height:48px;border-radius:14px;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:21px;flex-shrink:0;overflow:hidden;border:1px solid var(--line)}
.avatar img{width:100%;height:100%;object-fit:cover}
.grow{flex:1;min-width:0}
.nm{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.1px}
.meta{color:var(--mut);font-size:12.5px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px}
.btn{border:none;border-radius:13px;padding:11px 16px;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .15s,transform .1s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.btn:active{transform:scale(.97);opacity:.9}
.btn-p{background:var(--acc);color:var(--accD)}
.btn-s{background:var(--card2);color:var(--txt);border:1px solid var(--line)}
.btn-d{background:rgba(248,113,113,.12);color:var(--del)}
.btn-sm{padding:8px 13px;font-size:13px;border-radius:11px}
.btn-ic{width:42px;height:42px;padding:0;border-radius:13px;font-size:17px;flex-shrink:0}
.btn:disabled{opacity:.45;pointer-events:none}
.fab{position:fixed;bottom:18px;left:18px;right:18px;z-index:25}
.fab .btn{width:100%;padding:15px;font-size:15.5px;border-radius:var(--r);box-shadow:0 10px 30px rgba(52,211,153,.28)}
.empty{text-align:center;color:var(--mut);padding:52px 24px;font-size:14px;line-height:2}
.empty .big{font-size:44px;margin-bottom:10px;opacity:.85}
.sw{position:relative;width:48px;height:28px;flex-shrink:0}
.sw input{opacity:0;width:0;height:0}
.sw .sl{position:absolute;inset:0;background:var(--card2);border:1px solid var(--line);border-radius:28px;cursor:pointer;transition:background .18s,border-color .18s}
.sw .sl:before{content:"";position:absolute;width:20px;height:20px;right:3px;top:3px;background:var(--mut);border-radius:50%;transition:transform .18s,background .18s}
.sw input:checked+.sl{background:rgba(52,211,153,.22);border-color:var(--ok)}
.sw input:checked+.sl:before{background:var(--ok);transform:translateX(-19px)}
.sheet-bg{position:fixed;inset:0;background:rgba(4,7,14,.68);z-index:40;opacity:0;pointer-events:none;transition:opacity .22s}
.sheet-bg.open{opacity:1;pointer-events:auto}
.sheet{position:fixed;bottom:0;left:0;right:0;z-index:50;background:var(--card);border-radius:24px 24px 0 0;max-height:88vh;overflow-y:auto;transform:translateY(105%);transition:transform .28s cubic-bezier(.32,.9,.35,1);padding:10px 18px 28px;border-top:1px solid var(--line)}
.sheet.open{transform:translateY(0)}
.sheet .grip{width:42px;height:4.5px;background:var(--line);border-radius:4px;margin:8px auto 16px}
.sheet h2{font-size:17px;font-weight:800;margin-bottom:16px;letter-spacing:-.2px}
.fld{margin-bottom:15px}
.fld label{display:block;color:var(--mut);font-size:12.5px;margin-bottom:7px;font-weight:700}
.fld input[type=text]{width:100%;background:var(--card2);border:1.5px solid var(--line);border-radius:13px;padding:12px 14px;color:var(--txt);font-size:14.5px;outline:none;transition:border-color .18s}
.fld input[type=text]:focus{border-color:var(--acc)}
.fld textarea{width:100%;min-height:140px;resize:vertical;background:var(--card2);border:1.5px solid var(--line);border-radius:13px;padding:12px 14px;color:var(--txt);font:inherit;font-size:14.5px;outline:none;transition:border-color .18s}
.fld textarea:focus{border-color:var(--acc)}
.pick{max-height:230px;overflow-y:auto;background:var(--card2);border:1px solid var(--line);border-radius:13px}
.pick .it{display:flex;align-items:center;gap:11px;padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;font-size:14px;transition:background .12s}
.pick .it:last-child{border-bottom:none}
.pick .it .chk{width:21px;height:21px;border-radius:7px;border:2px solid #37456a;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;color:transparent;transition:background .15s,border-color .15s}
.pick .it.sel .chk{background:var(--acc);border-color:var(--acc);color:var(--accD)}
.pick .it.sel{color:var(--acc);background:rgba(52,211,153,.06)}
.flags{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.flag{display:flex;align-items:center;gap:8px;background:var(--card2);border:1.5px solid var(--line);border-radius:13px;padding:11px 13px;font-size:13px;cursor:pointer;transition:border-color .15s,color .15s}
.flag.on{border-color:var(--acc);color:var(--acc);background:rgba(52,211,153,.06)}
.toast{position:fixed;bottom:98px;left:50%;transform:translateX(-50%) translateY(16px);background:#202b42;border:1px solid #31405f;color:var(--txt);padding:12px 20px;border-radius:14px;font-size:14px;z-index:99;opacity:0;transition:opacity .22s,transform .22s;max-width:88vw;text-align:center;box-shadow:0 10px 34px rgba(0,0,0,.5)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.badge{font-size:11px;padding:3px 10px;border-radius:20px;font-weight:800}
.badge.on{background:rgba(52,211,153,.14);color:var(--ok)}
.badge.off{background:rgba(248,113,113,.12);color:var(--del)}
.prev{border:1.5px dashed var(--acc);background:rgba(52,211,153,.05)}
.spin{display:inline-block;width:15px;height:15px;border:2px solid rgba(148,163,192,.4);border-top-color:var(--acc);border-radius:50%;animation:sp .7s linear infinite;vertical-align:middle}
@keyframes sp{to{transform:rotate(360deg)}}
.group-message-toggle{display:flex;align-items:center;gap:9px;margin:12px 0;color:var(--txt);font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.chip{background:var(--card2);border:1px solid var(--line);border-radius:20px;padding:4px 11px;font-size:11.5px;color:var(--mut);font-weight:600}
.hide{display:none!important}
.sechead{display:flex;align-items:center;justify-content:space-between;margin:2px 0 12px;gap:10px}
.sechead .t{font-size:13.5px;font-weight:800;color:var(--mut)}
.cnt{display:inline-flex;align-items:center;gap:4px;background:var(--card2);border:1px solid var(--line);border-radius:20px;padding:2px 10px;font-size:11.5px;color:var(--mut);font-weight:700;flex-shrink:0}
.group-card{cursor:pointer}
.group-detail-block{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:13px;margin:0 0 12px}
.group-detail-title{font-size:13px;font-weight:800;margin-bottom:8px}
.group-detail-line{font-size:13px;color:var(--mut);line-height:1.8;overflow-wrap:anywhere}
.group-option{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.group-member-list{max-height:230px;overflow:auto}
.group-member{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.group-invite-value{font-size:12px;color:var(--mut);overflow-wrap:anywhere;line-height:1.7;margin-top:8px}
.group-card:hover,.group-card:focus-visible{border-color:var(--acc);outline:none}
.auto-post-item{background:rgba(10,14,26,.45);border:1px solid var(--line);border-radius:13px;padding:12px;margin-top:9px}
.auto-post-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.auto-post-actions .btn{flex:1 1 auto}
.auto-post-form{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.auto-post-preview{font-size:12px;line-height:1.8;overflow-wrap:anywhere;margin-top:8px;color:var(--mut)}
.auto-post-preview a{color:var(--acc);text-decoration:underline}
.auto-post-error{color:var(--del);font-size:12px;margin-top:6px;overflow-wrap:anywhere}

/* A calmer, brighter interface with comfortable touch targets. */
:root{--bg:#100f23;--card:#1d1a38;--card2:#272341;--line:#40395d;--txt:#f8f5ff;--mut:#b6aecf;--acc:#b8a1ff;--accD:#211546;--ok:#65e0bd;--r:18px}
html,body{background:var(--bg)}
body{background:radial-gradient(ellipse at 5% 0%,rgba(192,141,255,.18),transparent 28rem),radial-gradient(ellipse at 95% 26%,rgba(65,196,191,.09),transparent 30rem),var(--bg);background-attachment:fixed}
.hdr{background:rgba(25,20,48,.92);padding:15px 18px 12px;border-bottom:1px solid rgba(191,167,255,.18)}
.brandline{display:flex;align-items:center;gap:11px}.brandicon{display:grid;place-items:center;width:43px;height:43px;border-radius:15px;background:linear-gradient(135deg,#f1b3dc,#a894ff);color:#28153e;font-size:24px;box-shadow:0 8px 28px #9c75ef4d}
.brandeyebrow{font-size:11px;color:#d5b5ff;letter-spacing:.03em}.hdr h1{font-size:19px}.header-refresh{margin-inline-start:auto;border:1px solid var(--line);background:var(--card2);color:var(--txt);width:42px;height:42px;border-radius:14px;font-size:23px;cursor:pointer}
.srch input{box-shadow:0 10px 28px #06041722}.tabs{gap:5px;background:#1d1936;border-radius:18px}.tab{min-height:46px}.tab.act{background:linear-gradient(135deg,#c2aaff,#9f8df3);color:#241642;box-shadow:0 4px 15px #9679ef55}
.card{background:linear-gradient(135deg,#25203f,#1d1a36);box-shadow:0 10px 28px #08041336;transition:transform .18s,border-color .18s}.card:hover{border-color:#806fb5;transform:translateY(-2px)}
.btn{min-height:44px}.btn-p{background:linear-gradient(135deg,#d3b3ff,#a894ff);color:#211438}.btn-s{background:#302a4d}.fab{max-width:620px;margin:auto}.fab .btn{box-shadow:0 10px 30px #9470ef55}
.sheet{background:#1c1935;box-shadow:0 -18px 70px #05031099;scroll-behavior:smooth}.group-detail-block{background:#25213d;box-shadow:0 8px 22px #0603172b;scroll-margin-top:14px}.group-detail-title{color:#eee5ff}.auto-post-item{background:#1c1a34}
.group-shortcuts{display:flex;gap:8px;overflow-x:auto;padding:6px 0 14px;scrollbar-width:thin}.group-shortcuts button{flex:none;min-height:38px;padding:8px 12px;background:#373052;color:#e9e0ff;border:1px solid #5a4e80;border-radius:999px;font-size:12px;cursor:pointer}.group-shortcuts button:focus-visible,.btn:focus-visible,.tab:focus-visible{outline:3px solid #efc7ff;outline-offset:2px}
.group-description{white-space:pre-wrap}.group-detail-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
.fld select,.fld input[type=number]{width:100%;background:var(--card2);border:1.5px solid var(--line);border-radius:13px;padding:12px;color:var(--txt);font:inherit}
@media(min-width:760px){.hdr,.srch,.tabs,.container{padding-left:max(24px,calc((100% - 1000px)/2));padding-right:max(24px,calc((100% - 1000px)/2))}.srch,.tabs{margin-left:0;margin-right:0}.sheet{left:50%;right:auto;width:min(760px,96vw);transform:translate(-50%,105%)}.sheet.open{transform:translate(-50%,0)}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}

.dash-card{text-align:right;color:var(--txt);cursor:pointer;font:inherit}.dash-card strong,.dash-card small{display:block}.dash-card small{margin-top:8px;opacity:.75}.msg-hero,.msg-links,.msg-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin:14px 0}.msg-grid,.msg-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px}.msg-panel{background:var(--card,#1c2536);border:1px solid #ffffff22;border-radius:16px;padding:16px;margin:12px 0}.msg-panel h2{font-size:18px}.msg-field,.msg-toggle{display:flex;gap:8px;margin:12px 0}.msg-field{flex-direction:column}.msg-field textarea,.msg-field input,.msg-field select{width:100%;padding:10px;background:#101827;color:#fff;border:1px solid #ffffff33;border-radius:9px}.msg-toggle{justify-content:space-between}.msg-toggle small,.msg-list-item small{display:block;opacity:.7}.msg-list-item{display:flex;justify-content:space-between;gap:10px;padding:10px;border-bottom:1px solid #ffffff22;overflow-wrap:anywhere}
.tabs{overflow-x:auto;overscroll-behavior-inline:contain;max-width:calc(100% - 36px);scrollbar-width:thin}.tab{flex:0 0 auto;white-space:nowrap;padding-inline:12px}@media(min-width:760px){.tabs{max-width:100%}}
.mm-summary,.mm-actions,.mm-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mm-head{justify-content:space-between}.mm-summary span,.mm-status{padding:7px 10px;border-radius:999px;background:#ffffff12;font-size:12px}.mm-caution{line-height:1.7;color:#e7d3a4;font-size:12px}.mm-confirm{display:flex;gap:10px;align-items:center;margin:14px 0}.mm-row{display:flex;justify-content:space-between;gap:10px;padding:10px;border-bottom:1px solid #ffffff18;overflow-wrap:anywhere}.mm-search{width:100%;padding:10px;margin-top:12px;border-radius:10px;background:#111426;color:#fff;border:1px solid #ffffff33}.mm-job{padding:14px;margin:10px 0;border:1px solid #ffffff20;border-radius:14px}.mm-job progress{width:100%;margin:10px 0;accent-color:#bea6ff}.mm-job small{color:#bdb5d2}.mm-job p{font-size:12px;color:#e1cf9d}.mm-actions .btn{min-height:39px}
</style>
</head>
<body>
<div class="hdr">
  <div class="brandline"><span class="brandicon">✦</span><div><span class="brandeyebrow">لوحة البوت</span><h1>إدارة واتساب <span class="dot off" id="waDot"></span></h1></div><button class="header-refresh" type="button" onclick="load()" aria-label="تحديث البيانات">↻</button></div>
  <div class="sub" id="subTitle">جارٍ التحميل…</div>
</div>

<div class="srch">
  <input id="srchIn" type="text" placeholder="ابحث عن مجموعة أو قناة أو قاعدة…" autocomplete="off">
  <span class="ic">🔍</span>
</div>

<div class="tabs">
  <button class="tab" data-tab="dashboard">🏠 الرئيسية</button>
  <button class="tab act" data-tab="rules">📋 القواعد</button>
  <button class="tab" data-tab="channels">📺 القنوات</button>
  <button class="tab" data-tab="status">📸 الحالات</button>
  <button class="tab" data-tab="members">👥 مركز الأعضاء</button>
  <button class="tab" data-tab="groups">👥 المجموعات</button>
  <button class="tab" data-tab="replies">💬 الردود</button>
  <button class="tab" data-tab="ai">✦ الذكاء</button>
  <button class="tab" data-tab="messages">💬 الرسائل</button>
  <button class="tab" data-tab="mymsgs">📨 رسائلي</button>
  <button class="tab" data-tab="sessions">🔗 ربط الجلسة</button>
</div>

<div class="container">
  <div id="chPreview" class="hide"></div>
  <div id="view"></div>
</div>

<div class="fab" id="fab">
  <button class="btn btn-p" onclick="openRuleSheet()">➕ قاعدة تحويل جديدة</button>
</div>

<div class="sheet-bg" id="sheetBg" onclick="closeSheet()"></div>
<div class="sheet" id="sheet"></div>
<div class="toast" id="toast"></div>

<style>
.gg-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 16px}
.gg-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid #ffffff26;background:linear-gradient(180deg,#ffffff18,#ffffff08);color:inherit;border-radius:999px;padding:9px 15px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:transform .15s,border-color .15s,box-shadow .15s;box-shadow:0 4px 14px #0000001f}
.gg-pill b{font-size:13px;line-height:1}
.gg-pill:hover{transform:translateY(-1px);border-color:#7fb3ff66;box-shadow:0 8px 20px #00000030}
.gg-pill:active{transform:translateY(0)}
.gg-count{margin-inline-start:auto;font-size:12px;opacity:.6}
.gc-list{display:flex;flex-direction:column;gap:10px;align-items:center}
.gc-card{box-sizing:border-box;width:100%;max-width:540px;border-radius:18px;border:1px solid #ffffff1f;background:linear-gradient(180deg,#ffffff10,#ffffff06);overflow:hidden;transition:max-width .22s ease,border-color .2s,box-shadow .2s}
.gc-card.open{max-width:100%;border-color:#60a5fa66;box-shadow:0 14px 34px #0000003d}
.gc-head{display:flex;align-items:center;gap:11px;padding:12px 14px;cursor:pointer;user-select:none}
.gc-head:hover{background:#ffffff08}
.gc-pic{width:46px;height:46px;border-radius:14px;overflow:hidden;display:grid;place-items:center;font-size:22px;background:linear-gradient(135deg,#1f2b45,#2b1f45);border:1px solid #ffffff24;flex:0 0 auto}
.gc-pic img{width:100%;height:100%;object-fit:cover;display:block}
.gc-meta{flex:1;min-width:0;display:flex;align-items:center;gap:8px}
.gc-name{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gc-count{order:-1;flex:0 0 auto;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:#3b82f633;color:#9dc4ff;border:1px solid #3b82f64d}
.gc-caret{flex:0 0 auto;font-size:15px;opacity:.55;transition:transform .22s ease}
.gc-card.open .gc-caret{transform:rotate(180deg);opacity:.9}
.gc-body{max-height:0;overflow:hidden;transition:max-height .26s ease}
.gc-card.open .gc-body{max-height:220px;border-top:1px solid #ffffff14}
.gc-actions{display:flex;gap:8px;flex-wrap:wrap;padding:12px 14px}
.gc-act{display:inline-flex;align-items:center;gap:6px;border:1px solid #ffffff26;background:linear-gradient(180deg,#ffffff18,#ffffff08);color:inherit;border-radius:999px;padding:8px 13px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:transform .14s,border-color .14s}
.gc-act:hover{transform:translateY(-1px);border-color:#7fb3ff66}
@media(max-width:520px){.gc-card{max-width:100%}.gc-pic{width:42px;height:42px;font-size:20px}}
</style>
<script src="/groups-guard-web.js"></script>
<script src="/ai-card-web.js"></script>
<script>
const TG = window.Telegram?.WebApp;
if (TG) { try { TG.ready(); TG.expand(); } catch(e){} }

const qs = new URLSearchParams(location.search);
const TOKEN = qs.get("token") || localStorage.getItem("fw_token") || "";
if (qs.get("token")) localStorage.setItem("fw_token", qs.get("token"));

let ST = { numbers:[], channels:[], groups:[], rules:[], waConnected:false };
let TAB = ["dashboard","messages","groups","members","replies","channels","ai","mymsgs","status","sessions"].includes(qs.get("section")) ? qs.get("section") : "rules";
let Q = "";
const picCache = {};

function api(path, body){
  const opt = body
    ? { method:"POST", headers:{ "Content-Type":"application/json", "x-webapp-token":TOKEN }, body: JSON.stringify(body) }
    : { headers:{ "x-webapp-token":TOKEN } };
  return fetch(path, opt).then(async r => {
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(j.error || "خطأ في الاتصال");
    return j;
  });
}
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove("show"), 2600);
}
function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function nameOf(id){
  const all = [...ST.channels, ...ST.groups];
  const f = all.find(x=>x.id===id);
  if (f) return f.name;
  if (String(id).endsWith("@s.whatsapp.net")) return "👤 +" + String(id).split("@")[0];
  return String(id).split("@")[0].slice(-8) + "…";
}
function isChannelJid(id){ return String(id).endsWith("@newsletter"); }

async function load(){
  try {
    ST = await api("/api/fw/overview");
    document.getElementById("waDot").className = "dot " + (ST.waConnected ? "on" : "off");
    document.getElementById("subTitle").textContent =
      (ST.waConnected ? "واتساب متصل" : "واتساب غير متصل") +
      " · " + ST.rules.length + " قاعدة · " + ST.channels.length + " قناة · " + ST.groups.length + " مجموعة";
    if(!((TAB === "messages" && document.getElementById("messagesForm")) || TAB === "members" || TAB === "status"))render();
  } catch(e){
    document.getElementById("subTitle").textContent = "⚠️ " + e.message;
    if (TAB === "replies" || TAB === "ai" || TAB === "mymsgs" || TAB === "messages" || TAB === "members" || TAB === "status") render();
    else document.getElementById("view").innerHTML = '<div class="empty"><div class="big">🔒</div>' + esc(e.message) + '<br>افتح الرابط من داخل البوت مجدداً.</div>';
  }
}

// ─── بحث موحّد: أسماء محلية + روابط قنوات واتساب ─────────────────
let srchTimer = null;
document.getElementById("srchIn").addEventListener("input", (e)=>{
  Q = e.target.value.trim();
  clearTimeout(srchTimer);
  const looksLikeChannel = Q.includes("whatsapp.com/channel/") || Q.endsWith("@newsletter");
  if (looksLikeChannel && TAB === "channels") {
    srchTimer = setTimeout(()=>previewChannel(Q), 450);
  } else {
    document.getElementById("chPreview").classList.add("hide");
    if(TAB!=="messages" && TAB!=="members")render();
  }
});

async function previewChannel(input){
  const box = document.getElementById("chPreview");
  box.classList.remove("hide");
  box.innerHTML = '<div class="card prev"><div class="row"><span class="spin"></span><span style="color:var(--mut);font-size:14px">جارٍ جلب معلومات القناة من واتساب…</span></div></div>';
  try {
    const p = await api("/api/fw/channel/preview", { input });
    const subs = p.subscribers ? Number(p.subscribers).toLocaleString("ar") + " مشترك" : "";
    box.innerHTML =
      '<div class="card prev"><div class="row">' +
      '<div class="avatar">' + (p.picture ? '<img src="'+esc(p.picture)+'" onerror="this.parentNode.textContent=\\'📺\\'">' : "📺") + '</div>' +
      '<div class="grow"><div class="nm">' + esc(p.name) + (p.verified ? " ✅" : "") + '</div>' +
      '<div class="meta">' + esc(subs) + (p.description ? " · " + esc(p.description.slice(0,60)) : "") + '</div></div>' +
      (p.alreadySaved
        ? '<span class="badge on">محفوظة ✓</span>'
        : '<button class="btn btn-p btn-ic" onclick=\\'addChannel(' + JSON.stringify(JSON.stringify({id:p.id,name:p.name})) + ')\\'>+</button>') +
      '</div></div>';
  } catch(e){
    box.innerHTML = '<div class="card prev"><div class="meta">❌ ' + esc(e.message) + '</div></div>';
  }
}

async function addChannel(jsonStr){
  try {
    const ch = JSON.parse(jsonStr);
    await api("/api/fw/channel/add", ch);
    toast("✅ تمت إضافة القناة: " + ch.name);
    document.getElementById("srchIn").value = ""; Q = "";
    document.getElementById("chPreview").classList.add("hide");
    await load();
  } catch(e){ toast("❌ " + e.message); }
}

// ─── التبويبات ──────────────────────────────────────────────────
function selectTab(tab, shouldRender=true){
  TAB = ["dashboard", "messages", "groups", "members", "channels", "replies", "ai", "mymsgs", "status", "sessions"].includes(tab) ? tab : "rules";
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("act", t.dataset.tab===TAB));
  document.getElementById("fab").style.display = TAB==="rules" ? "" : "none";
  document.getElementById("srchIn").placeholder = TAB==="groups"
    ? "ابحث باسم المجموعة أو معرّفها…"
    : TAB==="channels" ? "ابحث بالاسم… أو الصق رابط قناة واتساب" : TAB==="replies" ? "ابحث عن رد أو مفتاح…" : TAB==="ai" ? "ابحث عن نموذج أو رقم…" : TAB==="mymsgs" ? "ابحث عن ميزة…" : "ابحث باسم القاعدة…";
  const title = document.querySelector(".hdr h1");
  if (title?.firstChild) title.firstChild.nodeValue = TAB==="status" ? "📸 الحالات " : TAB==="groups" ? "👥 إدارة المجموعات " : TAB==="replies" ? "💬 الردود التلقائية " : TAB==="ai" ? "✦ الذكاء الاصطناعي " : TAB==="mymsgs" ? "📨 رسائلي " : "📡 إدارة التحويلات ";
  if (shouldRender) render();
}

document.querySelectorAll(".tab").forEach(t=>{
  t.addEventListener("click", ()=>{
    selectTab(t.dataset.tab);
  });
});
selectTab(TAB, false);

function nrmSearch(value){
  return String(value==null?"":value)
    .replace(/[\u064B-\u0652\u0670\u0640\u06D6-\u06ED]/g,"")
    .replace(/[\u0622\u0623\u0625\u0671]/g,"\u0627")
    .replace(/\u0649/g,"\u064A").replace(/\u0629/g,"\u0647")
    .replace(/[\u0624\u0626]/g,"\u0648")
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g,"")
    .replace(/\u0640+/g,"")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase();
}

function filt(arr){
  if (!Q || Q.includes("whatsapp.com/") || Q.endsWith("@newsletter")) return arr;
  const q = nrmSearch(Q);
  if (!q) return arr;
  const compact = q.replace(/\s+/g,"");
  return arr.filter(x => {
    const name = nrmSearch(x.name);
    const id = nrmSearch(x.id);
    return name.includes(q) || id.includes(q) || name.replace(/\s+/g,"").includes(compact);
  });
}

function render(){
  const v = document.getElementById("view");
  if (TAB === "status") return window.StatusUI ? window.StatusUI.render(v) : (v.innerHTML='<div class="empty">جارٍ تحميل الحالات…</div>');
  if (TAB === "members") return window.MemberManagerUI ? window.MemberManagerUI.render(v) : (v.innerHTML='<div class="empty">جارٍ تحميل مركز الأعضاء…</div>');
  if (TAB === "dashboard") return renderDashboard(v);
  if (TAB === "rules") return renderRules(v);
  if (TAB === "channels") return renderChannels(v);
  if (TAB === "messages") return window.MessagesUI ? window.MessagesUI.render(v) : (v.innerHTML = '<div class="empty">جارٍ تحميل الرسائل…</div>');
  if (TAB === "mymsgs") return window.MyMsgsUI ? window.MyMsgsUI.render(v, Q) : (v.innerHTML = '<div class="empty">جارٍ تحميل رسائلي…</div>');
  if (TAB === "ai") return window.AiUI ? window.AiUI.render(v, Q) : (v.innerHTML = '<div class="empty">جارٍ تحميل قسم الذكاء…</div>');
  if (TAB === "replies") return window.RepliesUI ? window.RepliesUI.render(v, Q) : (v.innerHTML = '<div class="empty">جارٍ تحميل قسم الردود…</div>');
  if (TAB === "sessions") return window.SessionUI ? window.SessionUI.render(v) : (v.innerHTML = '<div class="empty">جارٍ تحميل قسم الجلسات…</div>');
  renderGroups(v);
}

function renderDashboard(v){
 const active=ST.rules.filter(r=>r.isActive!==false && r.enabled!==false).length;
 const entries=[['rules','📋 قواعد التحويل',ST.rules.length+' قاعدة · '+active+' مفعلة تقريباً'],['channels','📺 القنوات',ST.channels.length+' قناة'],['groups','👥 المجموعات',ST.groups.length+' مجموعة'],['members','👥 مركز الأعضاء','القوائم والمهام'],['replies','💬 الردود التلقائية','إدارة الردود'],['messages','✉️ الرسائل','الإعدادات والإرسال الجماعي'],['mymsgs','📨 رسائلي','ميزات الرقم'],['ai','✦ الذكاء','النماذج والإعدادات']];
 const q=Q.trim().toLowerCase(), visible=entries.filter(x=>!q||x.slice(1).join(' ').toLowerCase().includes(q));
 v.innerHTML='<div class="msg-hero"><div><h2>لوحة التحكم</h2><p>حالة واتساب: '+(ST.waConnected?'متصل':'غير متصل')+' · ملخص البيانات المحمّلة</p></div><button class="btn btn-s" onclick="load()">↻ تحديث</button></div><div class="msg-grid">'+visible.map(x=>'<button type="button" class="msg-panel dash-card" data-go="'+x[0]+'"><strong>'+esc(x[1])+'</strong><small>'+esc(x[2])+'</small></button>').join('')+'</div>'+(visible.length?'':'<div class="empty">لا توجد أقسام مطابقة</div>');
 v.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>{Q='';document.getElementById('srchIn').value='';selectTab(button.dataset.go)}));
}

// ─── القواعد ────────────────────────────────────────────────────
function renderRules(v){
  const rules = !Q ? ST.rules : ST.rules.filter(r => (r.name||"").toLowerCase().includes(Q.toLowerCase()));
  if (!rules.length) {
    v.innerHTML = '<div class="empty"><div class="big">📋</div>لا توجد قواعد تحويل بعد<br>اضغط "قاعدة تحويل جديدة" للبدء</div>';
    return;
  }
  v.innerHTML = rules.map(r =>
    '<div class="card"><div class="row">' +
    '<div class="grow" onclick="openRuleSheet(\\''+r.id+'\\')" style="cursor:pointer">' +
    '<div class="nm">' + esc(r.name) + '</div>' +
    '<div class="meta">📥 ' + r.sources.length + ' مصدر ← 📤 ' + esc(nameOf(r.destination)) +
    (r.sourceNumber ? ' · 📱 ' + esc(r.sourceNumber) : "") + '</div>' +
    '<div class="chips">' +
    (r.blockLinks?'<span class="chip">🚫 روابط</span>':"") +
    (r.blockImages?'<span class="chip">🚫 صور</span>':"") +
    (r.blockVideos?'<span class="chip">🚫 فيديو</span>':"") +
    (r.blockAudios?'<span class="chip">🚫 صوت</span>':"") +
    (r.noForward?'<span class="chip">↩️ بدون علامة</span>':"") +
    '</div></div>' +
    '<label class="sw"><input type="checkbox" '+(r.enabled?"checked":"")+' onchange="toggleRule(\\''+r.id+'\\',this.checked)"><span class="sl"></span></label>' +
    '</div></div>'
  ).join("");
}

async function toggleRule(id, on){
  try { await api("/api/fw/rule/update", { id, patch:{ enabled:on } }); toast(on?"✅ تم تفعيل القاعدة":"⏸️ تم إيقاف القاعدة"); await load(); }
  catch(e){ toast("❌ "+e.message); load(); }
}

// ─── القنوات ────────────────────────────────────────────────────
function renderChannels(v){
  const items = filt(ST.channels);
  let html = '<div class="sechead"><span class="t">القنوات المحفوظة (' + ST.channels.length + ')</span></div>';
  if (!items.length) {
    html += '<div class="empty"><div class="big">📺</div>لا توجد قنوات' + (Q?' مطابقة للبحث':'') + '<br>الصق رابط قناة واتساب في البحث بالأعلى لإضافتها</div>';
  } else {
    html += items.map(c =>
      '<div class="card"><div class="row">' +
      '<div class="avatar" data-jid="'+esc(c.id)+'">📺</div>' +
      '<div class="grow"><div class="nm">' + esc(c.name) + '</div>' +
      '<div class="meta">📺 قناة واتساب</div></div>' +
      '<button class="btn btn-d btn-ic" onclick="delChannel(\\''+esc(c.id)+'\\')">🗑</button>' +
      '</div></div>'
    ).join("");
  }
  v.innerHTML = html;
  lazyPics();
}

async function delChannel(id){
  if (!confirm("حذف هذه القناة من قائمتك؟")) return;
  try { await api("/api/fw/channel/delete", { id }); toast("🗑 تم حذف القناة"); await load(); }
  catch(e){ toast("❌ "+e.message); }
}

// ─── المجموعات ──────────────────────────────────────────────────
function renderGroups(v){
  const items = filt(ST.groups);
  let html = '<div class="gg-toolbar">' +
    '<button class="gg-pill" onclick="refreshGroups(this)"><b>🔄</b> تحديث من واتساب</button>' +
    '<button class="gg-pill" onclick="window.GroupGuardUI&&window.GroupGuardUI.open()"><b>🛡️</b> الحماية</button>' +
    '<button class="gg-pill" onclick="window.GroupGuardUI&&window.GroupGuardUI.docs()"><b>📖</b> الأوامر</button>' +
    '<span class="gg-count">' + ST.groups.length + ' مجموعة</span></div>';
  if (!items.length) {
    html += '<div class="empty"><div class="big">👥</div>لا توجد مجموعات' + (Q?' مطابقة للبحث':'') + '<br>اضغط "تحديث من واتساب" لجلب مجموعاتك</div>';
  } else {
    html += '<div class="gc-list">' + items.map(g =>
      '<div class="gc-card" data-card="'+esc(g.id)+'">' +
        '<div class="gc-head" data-toggle="1" role="button" tabindex="0">' +
          '<span class="gc-pic avatar" data-jid="'+esc(g.id)+'">👥</span>' +
          '<span class="gc-meta"><span class="gc-count">'+(g.members?esc(g.members):'—')+'</span><span class="gc-name">'+esc(g.name)+'</span></span>' +
          '<span class="gc-caret">⌄</span>' +
        '</div>' +
        '<div class="gc-body"><div class="gc-actions">' +
          '<button class="gc-act" data-act="guard"><b>🛡️</b> الحماية والتحذيرات</button>' +
          '<button class="gc-act" data-act="docs"><b>📖</b> أوامر المجموعات</button>' +
          '<button class="gc-act" data-act="details"><b>⚙️</b> تفاصيل وإدارة</button>' +
        '</div></div>' +
      '</div>'
    ).join('') + '</div>';
  }
  v.innerHTML = html;

  // أكورديون: بطاقة واحدة مفتوحة في كل مرة
  v.querySelectorAll(".gc-card").forEach(card=>{
    const head = card.querySelector("[data-toggle]");
    const toggle = ()=>{
      const wasOpen = card.classList.contains("open");
      v.querySelectorAll(".gc-card.open").forEach(other=>{ if(other!==card) other.classList.remove("open"); });
      card.classList.toggle("open", !wasOpen);
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", event=>{
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
    });
    card.querySelectorAll("[data-act]").forEach(btn=>{
      btn.addEventListener("click", event=>{
        event.stopPropagation();
        const id = card.dataset.card;
        if (btn.dataset.act === "guard" && window.GroupGuardUI) window.GroupGuardUI.openFor(id);
        else if (btn.dataset.act === "docs" && window.GroupGuardUI) window.GroupGuardUI.docs();
        else if (btn.dataset.act === "details") openGroupDetails(id);
      });
    });
  });
  lazyPics();
}

async function refreshGroups(btn){
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> جارٍ الجلب…';
  try { await api("/api/fw/groups/refresh", {}); toast("✅ تم تحديث المجموعات"); await load(); }
  catch(e){ toast("❌ "+e.message); }
  btn.disabled = false; btn.innerHTML = "🔄 تحديث من واتساب";
}

let GROUP_DETAIL = null;
let AUTO_POST_EDIT_ID = null;
let GROUP_REMINDER_EDIT_ID = null;
async function openGroupDetails(groupId){
  const group = ST.groups.find(item=>item.id===groupId);
  if (!group) return toast("❌ المجموعة غير موجودة في قائمتك");
  AUTO_POST_EDIT_ID = null;
  GROUP_REMINDER_EDIT_ID = null;
  GROUP_DETAIL = { ...group };
  const sh = document.getElementById("sheet");
  sh.innerHTML = '<div class="grip"></div><div class="empty"><span class="spin"></span><br>جارٍ جلب تفاصيل المجموعة…</div>';
  document.getElementById("sheetBg").classList.add("open");
  sh.classList.add("open");
  try {
    const detail = await api("/api/fw/groups/detail", {
      id: group.id,
      phoneNumber: group.phoneNumber || ""
    });
    GROUP_DETAIL = { ...group, ...detail };
    renderGroupDetails();
  } catch(e) {
    sh.innerHTML = '<div class="grip"></div><h2>⚠️ تعذّر فتح المجموعة</h2><div class="meta" style="white-space:normal">'+esc(e.message)+'</div><button class="btn btn-s" style="margin-top:16px" onclick="closeSheet()">إغلاق</button>';
  }
}

function renderGroupDetails(){
  if (!GROUP_DETAIL) return;
  const detail = GROUP_DETAIL;
  const sh = document.getElementById("sheet");
  const canManage = detail.isAdmin === true;
  // [GROUP-GUARD] زر الحماية داخل ورقة خيارات المجموعة (لا يفعّل الحماية، فقط يفتح الإعدادات)
  setTimeout(()=>{
    if (!sh.querySelector("[data-guard-sheet]")) {
      const bar = document.createElement("div");
      bar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px";
      bar.innerHTML = '<button class="gg-pill" data-guard-sheet="1"><b>🛡️</b> الحماية والتحذيرات</button>' +
        '<button class="gg-pill" data-guard-docs="1"><b>📖</b> أوامر المجموعات</button>';
      bar.querySelector("[data-guard-sheet]").onclick = ()=>{ if(window.GroupGuardUI) window.GroupGuardUI.openFor(detail.id); };
      bar.querySelector("[data-guard-docs]").onclick = ()=>{ if(window.GroupGuardUI) window.GroupGuardUI.docs(); };
      sh.insertBefore(bar, sh.children[1] || null);
    }
  }, 0);
  const created = detail.createdAt ? new Date(detail.createdAt).toLocaleDateString("ar") : "غير متاح";
  const members = Array.isArray(detail.members) ? detail.members : [];
  const autoPosts = Array.isArray(detail.autoPosts) ? detail.autoPosts : [];
  const editingAutoPost = autoPosts.find(item=>item.id===AUTO_POST_EDIT_ID) || null;
  const reminders = Array.isArray(detail.reminders) ? detail.reminders : [];
  const editingReminder = reminders.find(item=>item.id===GROUP_REMINDER_EDIT_ID) || null;
  const reminderDayNames = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  const memberRows = members.length
    ? members.map(member =>
        '<div class="group-member"><span>'+esc(member.label)+'</span><span class="meta">'+esc(member.role)+'</span></div>'
      ).join("")
    : '<div class="meta" style="white-space:normal">لا تتوفر بيانات الأعضاء حالياً.</div>';
  const settingRow = (key, label, enabled) =>
    '<div class="group-option"><div><div class="nm">'+label+'</div><div class="meta">'+(enabled?"مفعّل":"متوقف")+'</div></div>' +
    '<button class="btn '+(enabled?"btn-p":"btn-s")+'" data-group-setting="'+key+'">'+(enabled?"إيقاف":"تفعيل")+'</button></div>';
  const autoPostRows = autoPosts.length
    ? autoPosts.map(item =>
        '<div class="auto-post-item"><div class="row" style="align-items:flex-start">' +
        '<div class="grow"><div class="nm">'+esc(item.topic)+'</div>' +
        '<div class="meta">🕒 '+esc((item.times||[]).join("، "))+' · توقيت الخرطوم</div></div>' +
        '<span class="badge '+(item.enabled?"on":"off")+'">'+(item.enabled?"مفعّل":"متوقف")+'</span></div>' +
        (item.lastError?'<div class="auto-post-error">آخر خطأ: '+esc(item.lastError)+'</div>':
          item.lastSentAt?'<div class="meta" style="white-space:normal;margin-top:5px">آخر نشر: '+esc(new Date(item.lastSentAt).toLocaleString("ar"))+'</div>':
          '<div class="meta" style="margin-top:5px">لم يُنشر شيء بعد</div>') +
        '<div class="auto-post-actions">' +
        '<button class="btn btn-s btn-sm" data-auto-edit="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>تعديل</button>' +
        '<button class="btn btn-s btn-sm" data-auto-test="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>' +
        '<span>اختبار الجلب</span></button>' +
        '<button class="btn btn-p btn-sm" data-auto-publish="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>' +
        '<span>نشر الآن</span></button>' +
        '<button class="btn btn-s btn-sm" data-auto-toggle="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>' +
        (item.enabled?"إيقاف":"تفعيل")+'</button>' +
        '<button class="btn btn-d btn-sm" data-auto-delete="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>حذف</button>' +
        '</div><div class="auto-post-preview" data-auto-preview="'+esc(item.id)+'"></div></div>'
      ).join("")
    : '<div class="meta" style="white-space:normal">لا توجد جداول نشر لهذه المجموعة بعد.</div>';
  const reminderRows = reminders.length
    ? reminders.map(item => {
        const dayLabels = (item.days||[]).map(Number)
          .filter(day=>Number.isInteger(day)&&day>=0&&day<reminderDayNames.length)
          .map(day=>reminderDayNames[day]);
        return '<div class="auto-post-item"><div class="row" style="align-items:flex-start">' +
          '<div class="grow"><div class="nm">'+esc(String(item.message||"").slice(0,90))+
          (String(item.message||"").length>90?"…":"")+'</div>' +
          '<div class="meta">🕒 '+esc(item.time)+' · '+esc(dayLabels.join("، "))+' · توقيت الخرطوم</div></div>' +
          '<span class="badge '+(item.enabled?"on":"off")+'">'+(item.enabled?"مفعّل":"متوقف")+'</span></div>' +
          (item.lastError?'<div class="auto-post-error">آخر خطأ: '+esc(item.lastError)+'</div>':
            item.lastSentAt?'<div class="meta" style="white-space:normal;margin-top:5px">آخر إرسال: '+esc(new Date(item.lastSentAt).toLocaleString("ar"))+'</div>':
            '<div class="meta" style="margin-top:5px">لم يُرسل بعد</div>') +
          '<div class="auto-post-actions">' +
          '<button class="btn btn-s btn-sm" data-reminder-edit="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>تعديل</button>' +
          '<button class="btn btn-s btn-sm" data-reminder-toggle="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>'+
          (item.enabled?"إيقاف":"استئناف")+'</button>' +
          '<button class="btn btn-d btn-sm" data-reminder-delete="'+esc(item.id)+'" '+(canManage?"":"disabled")+'>حذف</button>' +
          '</div></div>';
      }).join("")
    : '<div class="meta" style="white-space:normal">لا توجد تذكيرات لهذه المجموعة بعد.</div>';
  const reminderDayInputs = reminderDayNames.map((day,index) =>
    '<label style="display:flex;align-items:center;gap:4px"><input type="checkbox" name="groupReminderDay" value="'+index+'" style="width:16px;height:16px;margin:0" '+
    ((editingReminder?.days||[]).includes(index)?"checked":"")+' '+(canManage?"":"disabled")+'><span>'+day+'</span></label>'
  ).join("");

  sh.innerHTML =
    '<div class="grip"></div>' +
    '<h2>👥 '+esc(detail.name||detail.id)+'</h2>' +
    '<div class="group-detail-block"><div class="group-detail-title">تفاصيل المجموعة</div>' +
    '<div class="group-detail-line">الأعضاء: '+Number(detail.memberCount||0).toLocaleString("ar")+
    ' · المشرفون: '+Number(detail.adminCount||0).toLocaleString("ar")+'</div>' +
    '<div class="group-detail-line">تاريخ الإنشاء: '+created+'</div>' +
    '<div class="group-detail-line">إرسال الأعضاء: '+(detail.locked?"للمشرفين فقط":"مفتوح للأعضاء")+'</div>' +
    '<div class="group-detail-line group-description">الوصف: '+esc(detail.description||"لا يوجد وصف")+'</div>' +
    '<div class="group-detail-actions"><button class="btn btn-s btn-sm" type="button" data-copy-description '+(detail.description?"":"disabled")+'>📋 نسخ الوصف</button></div></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">الأعضاء ('+members.length+(detail.membersTruncated?"+":"")+')</div>' +
    '<div class="group-member-list">'+memberRows+'</div>' +
    (detail.membersTruncated?'<div class="meta" style="white-space:normal">تُعرض أول 500 عضوية فقط.</div>':"")+'</div>' +
    '<div class="group-detail-block"><div class="group-detail-title">إعدادات الروابط</div>' +
    settingRow("antiLink","منع الروابط وحذفها عند توفر الصلاحية",detail.antiLinkEnabled) +
    settingRow("inspectInvite","فحص روابط دعوة واتساب",detail.inspectInviteEnabled) +
    '<div class="meta" style="white-space:normal;margin-top:8px">فحص روابط الدعوة يعمل دون صلاحية أدمن ما دام البوت عضواً في المجموعة. حذف رسالة شخص آخر يتطلب أن يكون البوت مشرفاً؛ إذا لم يكن مشرفاً، يحاول إرسال رسالة تنبيه مخصصة مع الإشارة إلى صاحب الرابط، بشرط أن تسمح المجموعة للأعضاء بالكتابة.</div>' +
    '<div class="fld" style="margin-top:12px"><label for="antiLinkWarningMessage">رسالة التنبيه عند تعذّر الحذف</label>' +
    '<textarea id="antiLinkWarningMessage" maxlength="1000" placeholder="مثال: الرجاء عدم إرسال الروابط هنا">'+
    esc(detail.groupMessages?.antiLinkWarningMessage||"")+'</textarea>' +
    '<div class="meta">إذا كان البوت مشرفاً وحذف الرابط بنجاح، لن يرسل تنبيهاً إضافياً.</div></div>' +
    '<button class="btn btn-s btn-sm" data-link-warning-save>حفظ رسالة التنبيه</button></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">فلتر الكلمات الممنوعة</div>' +
    '<label class="group-message-toggle"><input id="bannedWordsEnabled" type="checkbox" style="width:18px;height:18px;margin:0" '+
    (detail.groupMessages?.bannedWordsEnabled?"checked":"")+'><span>تفعيل فلتر الكلمات السيئة العربية والإنجليزية</span></label>' +
    '<div class="fld"><label for="bannedWords">كلمات إضافية للمجموعة (اختياري)</label><textarea id="bannedWords" maxlength="2000" placeholder="كلمة أو عبارة في كل سطر">'+
    esc((detail.groupMessages?.bannedWords||[]).join("\\n"))+'</textarea><div class="meta">القاعدة العربية والإنجليزية المدمجة تعمل تلقائياً عند التفعيل. أضف حتى 50 كلمة أو عبارة اختيارية، سطراً لكل بند. الفلتر يعتمد على الكلمات لا السياق، وقد يخطئ أو يفوّت بعض الصيغ.</div></div>' +
    '<div class="fld"><label for="bannedWordWarningMessage">رسالة التنبيه عند تعذّر الحذف</label><textarea id="bannedWordWarningMessage" maxlength="1000" placeholder="مثال: الرجاء الالتزام بقواعد المجموعة">'+
    esc(detail.groupMessages?.bannedWordWarningMessage||"")+'</textarea></div>' +
    '<div class="meta" style="white-space:normal">إعداد الفلتر لا يتطلب أدمن. حذف رسالة عضو آخر يتطلب أن يكون البوت مشرفاً؛ وإلا يرسل التنبيه إذا سمحت المجموعة للأعضاء بالكتابة.</div>' +
    '<button class="btn btn-s btn-sm" data-word-filter-save>حفظ فلتر الكلمات</button></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">رسائل الترحيب والوداع</div>' +
    '<label class="group-message-toggle"><input id="welcomeEnabled" type="checkbox" style="width:18px;height:18px;margin:0" '+
    (detail.groupMessages?.welcomeEnabled?"checked":"")+'><span>تفعيل رسالة الترحيب عند انضمام عضو</span></label>' +
    '<div class="fld"><label for="welcomeMessage">نص الترحيب</label><textarea id="welcomeMessage" maxlength="1000">'+
    esc(detail.groupMessages?.welcomeMessage||"")+'</textarea></div>' +
    '<label class="group-message-toggle"><input id="goodbyeEnabled" type="checkbox" style="width:18px;height:18px;margin:0" '+
    (detail.groupMessages?.goodbyeEnabled?"checked":"")+'><span>تفعيل رسالة الوداع عند مغادرة عضو</span></label>' +
    '<div class="fld"><label for="goodbyeMessage">نص الوداع</label><textarea id="goodbyeMessage" maxlength="1000">'+
    esc(detail.groupMessages?.goodbyeMessage||"")+'</textarea></div>' +
    '<div class="meta" style="white-space:normal">المتغيرات: <code>_nem</code> اسم العضو، <code>_time</code> الوقت بتوقيت الخرطوم، <code>_nemgrob</code> اسم المجموعة. اكتب المتغير كما هو مع الشرطة السفلية.</div>' +
    '<button class="btn btn-p btn-sm" data-group-messages-save>حفظ رسائل الترحيب والوداع</button></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">🗓️ النشر التلقائي</div>' +
    '<div class="meta" style="white-space:normal">ينشر مقالاً من موضوع كاملاً أو مقتطفاً بالطول المحدد أو بالذكاء الاصطناعي، بدون رابط أو اسم الكاتب. القصص تُنشر كاملة عند اختيار الذكاء. الأوقات بتوقيت الخرطوم وسجل منع التكرار محفوظ للمجموعة.</div>' +
    autoPostRows +
    '<div class="auto-post-form"><div class="fld"><label for="autoPostTopic">نوع المحتوى أو موضوع البحث</label>' +
    '<input type="text" id="autoPostTopic" list="autoPostTopics" maxlength="60" '+
    'placeholder="مثال: قصص حب، قصص، نكات أو موضوع آخر" value="'+esc(editingAutoPost?.topic||"")+'" '+(canManage?"":"disabled")+'>' +
    '<datalist id="autoPostTopics"><option value="قصص حب"><option value="قصص"><option value="نكات"></datalist></div>' +
    '<div class="fld"><label for="autoPostTimes">مواعيد النشر اليومية</label>' +
    '<input type="text" id="autoPostTimes" maxlength="63" placeholder="08:30, 20:15" '+
    'value="'+esc((editingAutoPost?.times||[]).join(", "))+'" '+(canManage?"":"disabled")+'>' +
    '<div class="meta">أدخل حتى 8 أوقات بصيغة 24 ساعة، مفصولة بفواصل. الإعداد الجديد يبدأ متوقفاً.</div></div>' +
    '<div class="fld"><label for="autoPostMode">طريقة اختيار المقتطف</label>' +
    '<select id="autoPostMode" '+(canManage?"":"disabled")+'>' +
    '<option value="length" '+(editingAutoPost?.excerptMode!=="ai"?"selected":"")+'>عدد أحرف محدد</option>' +
    '<option value="ai" '+(editingAutoPost?.excerptMode==="ai"?"selected":"")+'>الذكاء الاصطناعي (النموذج المختار في قسم الذكاء)</option>' +
    '<option value="full" '+(editingAutoPost?.excerptMode==="full"?"selected":"")+'>المقال كاملاً بدون اختصار</option></select></div>' +
    '<div class="fld" id="autoPostAiFields" style="display:'+(editingAutoPost?.excerptMode==="ai"?"block":"none")+'"><label for="autoPostAiPrompt">تعليمات الذكاء للنشر (اختياري)</label>' +
    '<textarea id="autoPostAiPrompt" maxlength="2000" placeholder="مثال: اختر أهم المعلومات ورتبها في نقاط" '+(canManage?"":"disabled")+'>'+esc(editingAutoPost?.aiPrompt||"")+'</textarea>' +
    '<div class="meta">يُستخدم مع الذكاء للمقالات العادية. للقصص تُنشر كاملة كما هي دون برومبت حتى لا تُختصر.</div></div>' +
    '<div class="fld" id="autoPostLengthFields" style="display:'+(editingAutoPost?.excerptMode && editingAutoPost?.excerptMode!=="length"?"none":"block")+'"><label for="autoPostLength">الحد الأقصى لأحرف المقتطف</label>' +
    '<input type="number" id="autoPostLength" min="50" max="12000" step="1" value="'+esc(editingAutoPost?.excerptLength||500)+'" '+(canManage?"":"disabled")+'>' +
    '<div class="meta">من 50 إلى 12000 حرف، الافتراضي 500 حرف.</div></div>' +
    '<button class="btn btn-p btn-sm" data-auto-save '+(canManage?"":"disabled")+'>' +
    (editingAutoPost?"حفظ التعديل":"إضافة جدول نشر")+'</button> '+
    (editingAutoPost?'<button class="btn btn-s btn-sm" data-auto-cancel-edit>إلغاء التعديل</button>':"")+
    (!canManage?'<div class="meta" style="white-space:normal;margin-top:8px">تتطلب إدارة النشر التلقائي أن يكون رقم واتساب المرتبط مشرفاً.</div>':"")+
    '</div></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">⏰ تذكيرات المجموعة</div>' +
    '<div class="meta" style="white-space:normal">ترسل رسالة في الأيام والأوقات المحددة بتوقيت الخرطوم. يمكنك إيقافها أو استئنافها أو حذفها. يتطلب الإعداد أن يكون البوت مشرفاً.</div>' +
    reminderRows +
    '<div class="auto-post-form"><div class="fld"><label for="groupReminderMessage">رسالة التذكير</label>' +
    '<textarea id="groupReminderMessage" maxlength="1000" '+(canManage?"":"disabled")+'>'+
    esc(editingReminder?.message||"")+'</textarea><div class="meta">حتى 1000 حرف.</div></div>' +
    '<div class="fld"><label for="groupReminderTime">وقت الإرسال</label><input id="groupReminderTime" type="time" value="'+
    esc(editingReminder?.time||"09:00")+'" '+(canManage?"":"disabled")+'></div>' +
    '<div class="fld"><div class="meta">أيام الإرسال</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">'+reminderDayInputs+'</div></div>' +
    '<button class="btn btn-p btn-sm" data-reminder-save '+(canManage?"":"disabled")+'>'+
    (editingReminder?"حفظ التذكير":"إضافة وتفعيل التذكير")+'</button> '+
    (editingReminder?'<button class="btn btn-s btn-sm" data-reminder-cancel>إلغاء التعديل</button>':"")+
    (!canManage?'<div class="meta" style="white-space:normal;margin-top:8px">إدارة التذكيرات متاحة عندما يكون رقم واتساب المرتبط مشرفاً في المجموعة.</div>':"")+
    '</div></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">جدولة فتح وإغلاق الكتابة</div>' +
    '<label class="group-message-toggle"><input id="groupLockScheduleEnabled" type="checkbox" style="width:18px;height:18px;margin:0" '+
    (detail.lockSchedule?.enabled?"checked":"")+'><span>تفعيل الجدولة اليومية</span></label>' +
    '<div class="fld"><label for="groupLockCloseTime">وقت قفل الكتابة</label><input id="groupLockCloseTime" type="time" value="'+
    esc(detail.lockSchedule?.closeTime||"22:00")+'"></div>' +
    '<div class="fld"><label for="groupLockOpenTime">وقت فتح الكتابة</label><input id="groupLockOpenTime" type="time" value="'+
    esc(detail.lockSchedule?.openTime||"07:00")+'"></div>' +
    '<div class="meta" style="white-space:normal">الأوقات بتوقيت الخرطوم. يتطلب تفعيل الجدولة أن يكون البوت مشرفاً. يراجع البوت حالة المجموعة كل 30 ثانية، ويعيد ضبطها حسب الجدول حتى لو تغيرت يدوياً.</div>' +
    (detail.lockSchedule?.lastError?'<div class="meta" style="white-space:normal;color:var(--danger);margin-top:8px">تعذّر تطبيق الجدولة: '+esc(detail.lockSchedule.lastError)+'</div>':"")+
    '<button class="btn btn-p btn-sm" data-group-lock-schedule-save>حفظ جدول الفتح والإغلاق</button></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">إدارة المجموعة</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn btn-s btn-sm" data-group-action="rename" '+(canManage?"":"disabled")+'>تغيير الاسم</button>' +
    '<button class="btn btn-s btn-sm" data-group-action="description" '+(canManage?"":"disabled")+'>تغيير الوصف</button>' +
    '<button class="btn btn-s btn-sm" data-group-action="'+(detail.locked?"unlock":"lock")+'" '+(canManage?"":"disabled")+'>'+
    (detail.locked?"فتح الإرسال للأعضاء":"قصر الإرسال على المشرفين")+'</button></div>' +
    '<div class="meta" style="white-space:normal;margin-top:8px">تتطلب هذه التعديلات صلاحية المشرف وتأكيداً قبل التنفيذ.</div></div>' +
    '<div class="group-detail-block"><div class="group-detail-title">رابط الدعوة</div>' +
    '<button class="btn btn-s btn-sm" data-group-invite '+(canManage?"":"disabled")+'>عرض رابط الدعوة</button>' +
    '<button class="btn btn-s btn-sm" data-copy-group-invite '+(detail.inviteLink?"":"disabled")+'>نسخ</button>' +
    '<div class="group-invite-value" id="groupInviteValue">'+esc(detail.inviteLink||"لا يظهر الرابط إلا بعد طلبه.")+'</div></div>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
    '<button class="btn btn-p" style="flex:1" data-group-message>📨 إرسال رسالة واحدة</button>' +
    '<button class="btn btn-s" onclick="closeSheet()">إغلاق</button></div>';

  sh.querySelectorAll("[data-group-setting]").forEach(button=>{
    button.addEventListener("click", ()=>toggleGroupSetting(button.dataset.groupSetting));
  });
  sh.querySelector("[data-link-warning-save]")?.addEventListener("click", saveGroupLinkWarningMessage);
  sh.querySelector("[data-word-filter-save]")?.addEventListener("click", saveGroupWordFilterSettings);
  sh.querySelector("[data-group-messages-save]")?.addEventListener("click", saveGroupMessageTemplates);
  sh.querySelector("[data-group-lock-schedule-save]")?.addEventListener("click", saveGroupLockSchedule);
  sh.querySelector("[data-reminder-save]")?.addEventListener("click", saveGroupReminder);
  sh.querySelector("[data-reminder-cancel]")?.addEventListener("click", ()=>{
    GROUP_REMINDER_EDIT_ID = null;
    renderGroupDetails();
  });
  sh.querySelectorAll("[data-reminder-edit]").forEach(button=>
    button.addEventListener("click", ()=>editGroupReminder(button.dataset.reminderEdit))
  );
  sh.querySelectorAll("[data-reminder-toggle]").forEach(button=>
    button.addEventListener("click", ()=>toggleGroupReminder(button.dataset.reminderToggle))
  );
  sh.querySelectorAll("[data-reminder-delete]").forEach(button=>
    button.addEventListener("click", ()=>deleteGroupReminder(button.dataset.reminderDelete))
  );
  const blocks = Array.from(sh.querySelectorAll('.group-detail-block'));
  const shortcuts = document.createElement('nav');
  shortcuts.className = 'group-shortcuts';
  shortcuts.setAttribute('aria-label', 'الانتقال إلى إعدادات المجموعة');
  blocks.forEach(block => {
    const title = block.querySelector('.group-detail-title')?.textContent;
    if (!title) return;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = title;
    button.addEventListener('click', () => block.scrollIntoView({behavior:'smooth',block:'start'}));
    shortcuts.appendChild(button);
  });
  if (blocks[0]) blocks[0].before(shortcuts);
  sh.querySelector('[data-copy-description]')?.addEventListener('click', copyGroupDescription);
  sh.querySelectorAll("[data-group-action]").forEach(button=>{
    button.addEventListener("click", ()=>runGroupAdminAction(button.dataset.groupAction));
  });
  sh.querySelector("[data-group-invite]")?.addEventListener("click", showGroupInvite);
  sh.querySelector("[data-copy-group-invite]")?.addEventListener("click", copyGroupInvite);
  sh.querySelector("[data-group-message]")?.addEventListener("click", ()=>openGroupMessageSheet(detail.id));
  sh.querySelector("[data-auto-save]")?.addEventListener("click", saveGroupAutoPost);
  sh.querySelector("[data-auto-cancel-edit]")?.addEventListener("click", ()=>{
    AUTO_POST_EDIT_ID = null;
    renderGroupDetails();
  });
  sh.querySelectorAll("[data-auto-edit]").forEach(button=>
    button.addEventListener("click", ()=>editGroupAutoPost(button.dataset.autoEdit))
  );
  sh.querySelectorAll("[data-auto-test]").forEach(button=>
    button.addEventListener("click", ()=>testGroupAutoPost(button.dataset.autoTest, button))
  );
  sh.querySelector("#autoPostMode")?.addEventListener("change", (event) => {
    const ai = event.target.value === "ai";
    sh.querySelector("#autoPostAiFields").style.display = ai ? "block" : "none";
    sh.querySelector("#autoPostLengthFields").style.display = event.target.value === "length" ? "block" : "none";
  });
  sh.querySelectorAll("[data-auto-publish]").forEach(button=>
    button.addEventListener("click", ()=>publishGroupAutoPost(button.dataset.autoPublish, button))
  );
  sh.querySelectorAll("[data-auto-toggle]").forEach(button=>
    button.addEventListener("click", ()=>toggleGroupAutoPost(button.dataset.autoToggle))
  );
  sh.querySelectorAll("[data-auto-delete]").forEach(button=>
    button.addEventListener("click", ()=>deleteGroupAutoPost(button.dataset.autoDelete))
  );
}

function editGroupAutoPost(autoPostId){
  if (!GROUP_DETAIL) return;
  AUTO_POST_EDIT_ID = autoPostId;
  renderGroupDetails();
  document.getElementById("autoPostTopic")?.focus();
}

async function saveGroupAutoPost(){
  if (!GROUP_DETAIL) return;
  const topic = String(document.getElementById("autoPostTopic")?.value||"").trim();
  const times = String(document.getElementById("autoPostTimes")?.value||"").trim();
  const excerptMode = String(document.getElementById("autoPostMode")?.value || "length");
  const aiPrompt = String(document.getElementById("autoPostAiPrompt")?.value || "").trim();
  const excerptLength = Number(document.getElementById("autoPostLength")?.value);
  if (!Number.isInteger(excerptLength) || excerptLength < 50 || excerptLength > 12000) return toast("⚠️ حدد طول المقتطف بين 50 و12000 حرف");
  if (!topic || !times) return toast("⚠️ أدخل نوع المحتوى ومواعيد النشر");
  const button = document.querySelector("[data-auto-save]");
  const editing = !!AUTO_POST_EDIT_ID;
  if (button) { button.disabled = true; button.textContent = "جارٍ الحفظ…"; }
  try {
    await api("/api/fw/groups/autopost/save", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId: AUTO_POST_EDIT_ID,
      topic,
      times,
      excerptLength,
      excerptMode,
      aiPrompt
    });
    AUTO_POST_EDIT_ID = null;
    toast(editing?"✅ تم تحديث الجدول":"✅ تمت إضافة الجدول وهو متوقف");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) {
    toast("❌ "+e.message);
    if (button) { button.disabled = false; button.textContent = editing?"حفظ التعديل":"إضافة جدول نشر"; }
  }
}

async function toggleGroupAutoPost(autoPostId){
  if (!GROUP_DETAIL) return;
  const item = (GROUP_DETAIL.autoPosts||[]).find(entry=>entry.id===autoPostId);
  if (!item) return toast("❌ إعداد النشر غير موجود");
  const enabled = !item.enabled;
  if (!confirm(enabled
    ? "سينشر البوت عنوان المقال ومقتطفه بدون رابط أو اسم الكاتب من موضوع في الأوقات المحددة. هل تريد التفعيل؟"
    : "إيقاف النشر التلقائي لهذا الجدول؟")) return;
  try {
    await api("/api/fw/groups/autopost/toggle", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId,
      enabled
    });
    toast(enabled?"✅ تم تفعيل الجدول":"⏸️ تم إيقاف الجدول");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) { toast("❌ "+e.message); }
}

async function testGroupAutoPost(autoPostId, button){
  if (!GROUP_DETAIL) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "جارٍ اختبار المصدر…";
  const preview = Array.from(document.querySelectorAll("[data-auto-preview]"))
    .find(element=>element.dataset.autoPreview===autoPostId);
  if (preview) preview.textContent = "جارٍ جلب المقال ونصه من موضوع…";
  try {
    const item = await api("/api/fw/groups/autopost/test", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId
    });
    if (preview) preview.innerHTML = '<div><strong>'+esc(item.title)+'</strong></div><div style="white-space:pre-wrap;margin:7px 0">'+esc(String(item.content||""))+'</div><a href="'+esc(item.url)+'" target="_blank" rel="noopener noreferrer">فتح المصدر في موضوع</a>';
    toast("✅ نجح اختبار الجلب؛ لم تُرسل رسالة للمجموعة");
  } catch(e) {
    if (preview) preview.innerHTML = '<div class="auto-post-error">'+esc(e.message)+'</div>';
    toast("❌ "+e.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function publishGroupAutoPost(autoPostId, button){
  if (!GROUP_DETAIL) return;
  if (!confirm("سيتم نشر عنوان المقال ومقتطفه بدون رابط أو اسم الكاتب في المجموعة الآن. هل تريد المتابعة؟")) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "جارٍ النشر…";
  try {
    const result = await api("/api/fw/groups/autopost/publish", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId
    });
    toast("✅ تم نشر عنوان المقال ومقتطفه");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) {
    toast("❌ "+e.message);
    button.disabled = false;
    button.textContent = original;
  }
}

async function deleteGroupAutoPost(autoPostId){
  if (!GROUP_DETAIL || !confirm("حذف هذا الجدول؟ سيبقى سجل الروابط محفوظاً لمنع تكرارها.")) return;
  try {
    await api("/api/fw/groups/autopost/delete", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      autoPostId
    });
    if (AUTO_POST_EDIT_ID === autoPostId) AUTO_POST_EDIT_ID = null;
    toast("🗑 تم حذف الجدول");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) { toast("❌ "+e.message); }
}

async function toggleGroupSetting(setting){
  if (!GROUP_DETAIL) return;
  const current = setting === "antiLink" ? GROUP_DETAIL.antiLinkEnabled : GROUP_DETAIL.inspectInviteEnabled;
  try {
    const result = await api("/api/fw/groups/settings", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      setting,
      enabled: !current
    });
    GROUP_DETAIL = { ...GROUP_DETAIL, ...result };
    renderGroupDetails();
    toast("✅ تم تحديث إعداد المجموعة");
  } catch(e) {
    toast("❌ " + e.message);
  }
}

async function saveGroupLinkWarningMessage(){
  if (!GROUP_DETAIL) return;
  try {
    const result = await api("/api/fw/groups/link-warning", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      message: document.getElementById("antiLinkWarningMessage")?.value || ""
    });
    GROUP_DETAIL = {
      ...GROUP_DETAIL,
      groupMessages: { ...(GROUP_DETAIL.groupMessages||{}), ...result }
    };
    renderGroupDetails();
    toast("✅ تم حفظ رسالة تنبيه الروابط");
  } catch(e) {
    toast("❌ "+e.message);
  }
}

async function saveGroupWordFilterSettings(){
  if (!GROUP_DETAIL) return;
  try {
    const result = await api("/api/fw/groups/word-filter", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      enabled: !!document.getElementById("bannedWordsEnabled")?.checked,
      words: document.getElementById("bannedWords")?.value || "",
      warningMessage: document.getElementById("bannedWordWarningMessage")?.value || ""
    });
    GROUP_DETAIL = {
      ...GROUP_DETAIL,
      groupMessages: { ...(GROUP_DETAIL.groupMessages||{}), ...result }
    };
    renderGroupDetails();
    toast(result.bannedWordsEnabled ? "✅ تم تفعيل فلتر الكلمات" : "✅ تم إيقاف فلتر الكلمات");
  } catch(e) {
    toast("❌ "+e.message);
  }
}

async function saveGroupMessageTemplates(){
  if (!GROUP_DETAIL) return;
  try {
    const result = await api("/api/fw/groups/messages", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      welcomeEnabled: !!document.getElementById("welcomeEnabled")?.checked,
      welcomeMessage: document.getElementById("welcomeMessage")?.value || "",
      goodbyeEnabled: !!document.getElementById("goodbyeEnabled")?.checked,
      goodbyeMessage: document.getElementById("goodbyeMessage")?.value || ""
    });
    GROUP_DETAIL = {
      ...GROUP_DETAIL,
      groupMessages: { ...(GROUP_DETAIL.groupMessages||{}), ...result }
    };
    renderGroupDetails();
    toast("✅ تم حفظ رسائل الترحيب والوداع");
  } catch(e) {
    toast("❌ "+e.message);
  }
}

async function saveGroupLockSchedule(){
  if (!GROUP_DETAIL) return;
  try {
    const result = await api("/api/fw/groups/lock-schedule", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      enabled: !!document.getElementById("groupLockScheduleEnabled")?.checked,
      closeTime: document.getElementById("groupLockCloseTime")?.value || "",
      openTime: document.getElementById("groupLockOpenTime")?.value || ""
    });
    GROUP_DETAIL = { ...GROUP_DETAIL, lockSchedule: result };
    renderGroupDetails();
    toast(result.enabled ? "✅ تم تفعيل جدول فتح وإغلاق القروب" : "✅ تم إيقاف جدول المجموعة");
  } catch(e) {
    toast("❌ "+e.message);
  }
}

function editGroupReminder(reminderId){
  if (!GROUP_DETAIL) return;
  GROUP_REMINDER_EDIT_ID = reminderId;
  renderGroupDetails();
  document.getElementById("groupReminderMessage")?.focus();
}

async function saveGroupReminder(){
  if (!GROUP_DETAIL) return;
  const message = String(document.getElementById("groupReminderMessage")?.value||"").trim();
  const time = String(document.getElementById("groupReminderTime")?.value||"").trim();
  const days = Array.from(document.querySelectorAll('input[name="groupReminderDay"]:checked'))
    .map(input=>Number(input.value));
  if (!message) return toast("⚠️ اكتب رسالة التذكير");
  if (!days.length) return toast("⚠️ اختر يوماً واحداً على الأقل");
  const button = document.querySelector("[data-reminder-save]");
  const editing = !!GROUP_REMINDER_EDIT_ID;
  if (button) { button.disabled = true; button.textContent = "جارٍ الحفظ…"; }
  const groupId = GROUP_DETAIL.id;
  try {
    await api("/api/fw/groups/reminders/save", {
      id: groupId,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      reminderId: GROUP_REMINDER_EDIT_ID,
      message,
      time,
      days
    });
    GROUP_REMINDER_EDIT_ID = null;
    toast(editing?"✅ تم تحديث التذكير":"✅ تمت إضافة التذكير وتفعيله");
    await openGroupDetails(groupId);
  } catch(e) {
    toast("❌ "+e.message);
    if (button) { button.disabled = false; button.textContent = editing?"حفظ التذكير":"إضافة وتفعيل التذكير"; }
  }
}

async function toggleGroupReminder(reminderId){
  if (!GROUP_DETAIL) return;
  const item = (GROUP_DETAIL.reminders||[]).find(entry=>entry.id===reminderId);
  if (!item) return toast("❌ التذكير غير موجود");
  const enabled = !item.enabled;
  if (!confirm(enabled?"استئناف إرسال هذا التذكير؟":"إيقاف هذا التذكير؟")) return;
  const groupId = GROUP_DETAIL.id;
  try {
    await api("/api/fw/groups/reminders/toggle", {
      id: groupId,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      reminderId,
      enabled
    });
    toast(enabled?"✅ تم استئناف التذكير":"⏸️ تم إيقاف التذكير");
    await openGroupDetails(groupId);
  } catch(e) { toast("❌ "+e.message); }
}

async function deleteGroupReminder(reminderId){
  if (!GROUP_DETAIL || !confirm("حذف هذا التذكير نهائياً؟")) return;
  const groupId = GROUP_DETAIL.id;
  try {
    await api("/api/fw/groups/reminders/delete", {
      id: groupId,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      reminderId
    });
    if (GROUP_REMINDER_EDIT_ID === reminderId) GROUP_REMINDER_EDIT_ID = null;
    toast("🗑 تم حذف التذكير");
    await openGroupDetails(groupId);
  } catch(e) { toast("❌ "+e.message); }
}

async function runGroupAdminAction(action){
  if (!GROUP_DETAIL) return;
  let value = "";
  if (action === "rename") {
    value = window.prompt("اكتب الاسم الجديد (حتى 25 حرفاً):", GROUP_DETAIL.name||"");
    if (value === null) return;
  } else if (action === "description") {
    value = window.prompt("اكتب وصف المجموعة الجديد:", GROUP_DETAIL.description||"");
    if (value === null) return;
  } else {
    const promptText = action === "lock"
      ? "سيتم قصر إرسال الرسائل على المشرفين. هل تريد المتابعة؟"
      : "سيُسمح لجميع الأعضاء بإرسال الرسائل. هل تريد المتابعة؟";
    if (!confirm(promptText)) return;
  }
  try {
    await api("/api/fw/groups/action", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || "",
      action,
      value
    });
    toast("✅ تم تحديث إعداد المجموعة");
    await openGroupDetails(GROUP_DETAIL.id);
  } catch(e) {
    toast("❌ " + e.message);
  }
}

async function showGroupInvite(){
  if (!GROUP_DETAIL) return;
  const button = document.querySelector("[data-group-invite]");
  if (button) { button.disabled = true; button.textContent = "جارٍ جلب الرابط…"; }
  try {
    const result = await api("/api/fw/groups/invite", {
      id: GROUP_DETAIL.id,
      phoneNumber: GROUP_DETAIL.phoneNumber || ""
    });
    GROUP_DETAIL.inviteLink = result.link;
    const value = document.getElementById("groupInviteValue");
    if (value) value.textContent = result.link;
    const copyButton = document.querySelector("[data-copy-group-invite]");
    if (copyButton) copyButton.disabled = false;
  } catch(e) {
    toast("❌ " + e.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = "عرض رابط الدعوة"; }
  }
}

async function copyGroupDescription(){
  const text = GROUP_DETAIL?.description;
  if (!text) return toast('لا يوجد وصف لنسخه');
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const input = document.createElement('textarea'); input.value = text;
      input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input);
      input.select(); const ok = document.execCommand('copy'); input.remove();
      if (!ok) throw new Error('copy failed');
    }
    toast('✅ تم نسخ وصف المجموعة');
  } catch { toast('تعذّر النسخ من هذا المتصفح'); }
}

async function copyGroupInvite(){
  if (!GROUP_DETAIL?.inviteLink || !navigator.clipboard?.writeText) return toast("تعذّر نسخ الرابط من هذا المتصفح");
  try {
    await navigator.clipboard.writeText(GROUP_DETAIL.inviteLink);
    toast("✅ تم نسخ رابط الدعوة");
  } catch(e) {
    toast("تعذّر نسخ الرابط من هذا المتصفح");
  }
}

let GROUP_MESSAGE = null;
function openGroupMessageSheet(groupId){
  const group = ST.groups.find(item=>item.id===groupId);
  if (!group) return toast("❌ المجموعة غير موجودة في قائمتك");
  GROUP_MESSAGE = { id:group.id, name:group.name||group.id, phoneNumber:group.phoneNumber||"" };
  const sh = document.getElementById("sheet");
  sh.innerHTML =
    '<div class="grip"></div>' +
    '<h2>📨 رسالة واحدة إلى المجموعة</h2>' +
    '<div class="meta" style="margin:-8px 0 16px">' + esc(GROUP_MESSAGE.name) + '</div>' +
    '<div class="fld"><label for="groupMessageText">نص الرسالة</label>' +
    '<textarea id="groupMessageText" maxlength="3500" placeholder="اكتب رسالتك للمجموعة"></textarea>' +
    '<div class="meta">إرسال يدوي واحد فقط. لا يوجد تكرار أو بث.</div></div>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
    '<button class="btn btn-p" id="sendGroupMessageBtn" style="flex:1" onclick="sendGroupMessage()">إرسال</button>' +
    '<button class="btn btn-s" onclick="closeSheet()">إلغاء</button></div>';
  document.getElementById("sheetBg").classList.add("open");
  sh.classList.add("open");
  document.getElementById("groupMessageText").focus();
}

async function sendGroupMessage(){
  const text = String(document.getElementById("groupMessageText")?.value||"").trim();
  if (!GROUP_MESSAGE) return toast("❌ اختر مجموعة أولاً");
  if (!text || text.length > 3500) return toast("⚠️ اكتب رسالة من 1 إلى 3500 حرف");
  if (!confirm("إرسال رسالة واحدة إلى مجموعة " + GROUP_MESSAGE.name + "؟")) return;
  const button = document.getElementById("sendGroupMessageBtn");
  button.disabled = true;
  button.textContent = "جارٍ الإرسال…";
  try {
    await api("/api/fw/groups/send", {
      id: GROUP_MESSAGE.id,
      phoneNumber: GROUP_MESSAGE.phoneNumber,
      text
    });
    toast("✅ تم إرسال رسالة واحدة إلى المجموعة");
    closeSheet();
  } catch(e) {
    toast("❌ " + e.message);
    button.disabled = false;
    button.textContent = "إرسال";
  }
}

// صور الدردشات — كسولة ومخزّنة
function lazyPics(){
  document.querySelectorAll(".avatar[data-jid]").forEach(async el=>{
    const jid = el.dataset.jid;
    if (picCache[jid] === null) return;
    if (picCache[jid]) { el.innerHTML = '<img src="'+picCache[jid]+'">'; return; }
    try {
      const r = await api("/api/fw/pic?jid=" + encodeURIComponent(jid) + "&token=" + TOKEN);
      picCache[jid] = r.url || null;
      if (r.url) el.innerHTML = '<img src="'+r.url+'" onerror="this.remove()">';
    } catch(e){ picCache[jid] = null; }
  });
}

// ─── شاشة إنشاء/تعديل قاعدة ─────────────────────────────────────
let SHEET = { srcSel:[], dst:null, flags:{}, editing:null, num:null };

function openRuleSheet(ruleId){
  const r = ruleId ? ST.rules.find(x=>x.id===ruleId) : null;
  SHEET = {
    editing: r ? r.id : null,
    srcSel: r ? [...r.sources] : [],
    dst: r ? r.destination : null,
    num: r ? r.sourceNumber : (ST.numbers[0] || null),
    flags: {
      blockLinks: !!r?.blockLinks, blockImages: !!r?.blockImages,
      blockVideos: !!r?.blockVideos, blockAudios: !!r?.blockAudios, noForward: !!r?.noForward,
    },
    name: r?.name || "",
  };
  drawSheet();
  document.getElementById("sheetBg").classList.add("open");
  document.getElementById("sheet").classList.add("open");
}
function closeSheet(){
  document.getElementById("sheetBg").classList.remove("open");
  document.getElementById("sheet").classList.remove("open");
}

function drawSheet(){
  const sh = document.getElementById("sheet");
  const all = [...ST.channels.map(c=>({...c,_t:"ch"})), ...ST.groups.map(g=>({...g,_t:"gr"}))];
  const dstAll = [...ST.groups.map(g=>({...g,_t:"gr"})), ...ST.channels.map(c=>({...c,_t:"ch"}))];
  const f = SHEET.flags;
  sh.innerHTML =
    '<div class="grip"></div>' +
    '<h2>' + (SHEET.editing ? "✏️ تعديل القاعدة" : "➕ قاعدة تحويل جديدة") + '</h2>' +

    (ST.numbers.length > 1 ?
      '<div class="fld"><label>📱 رقم الواتساب</label><div class="pick" style="max-height:130px">' +
      ST.numbers.map(n =>
        '<div class="it '+(SHEET.num===n?"sel":"")+'" onclick="SHEET.num=\\''+n+'\\';drawSheet()"><span class="chk">✓</span>'+esc(n)+'</div>'
      ).join("") + '</div></div>'
    : "") +

    '<div class="fld"><label>📥 المصادر — اختر واحداً أو أكثر (' + SHEET.srcSel.length + ' محدد)</label>' +
    '<input type="text" id="srcFilter" placeholder="🔍 فلترة سريعة…" oninput="filterPick(this,\\'srcPick\\')" style="margin-bottom:8px">' +
    '<div class="pick" id="srcPick">' +
    (all.length ? all.map(x =>
      '<div class="it '+(SHEET.srcSel.includes(x.id)?"sel":"")+'" data-nm="'+esc((x.name||"").toLowerCase())+'" onclick="togSrc(\\''+esc(x.id)+'\\')">' +
      '<span class="chk">✓</span>' + (x._t==="ch"?"📺 ":"👥 ") + esc(x.name) + '</div>'
    ).join("") : '<div class="it" style="color:var(--mut)">لا توجد عناصر — أضف قنوات أو حدّث المجموعات أولاً</div>') +
    '</div></div>' +

    '<div class="fld"><label>📤 الوجهة — اختر واحدة</label>' +
    '<input type="text" placeholder="🔍 فلترة سريعة…" oninput="filterPick(this,\\'dstPick\\')" style="margin-bottom:8px">' +
    '<div class="pick" id="dstPick">' +
    (dstAll.length ? dstAll.map(x =>
      '<div class="it '+(SHEET.dst===x.id?"sel":"")+'" data-nm="'+esc((x.name||"").toLowerCase())+'" onclick="SHEET.dst=\\''+esc(x.id)+'\\';drawSheet()">' +
      '<span class="chk">✓</span>' + (x._t==="ch"?"📺 ":"👥 ") + esc(x.name) + '</div>'
    ).join("") : '<div class="it" style="color:var(--mut)">لا توجد عناصر</div>') +
    '</div>' +
    '<div style="margin-top:8px"><input type="text" id="dstPhone" placeholder="👤 أو رقم شخص مباشرة: 9665XXXXXXXX" value="' +
    (SHEET.dst && SHEET.dst.endsWith("@s.whatsapp.net") ? esc(SHEET.dst.split("@")[0]) : "") + '" oninput="dstFromPhone(this.value)"></div></div>' +

    '<div class="fld"><label>⚙️ خيارات التحويل</label><div class="flags">' +
    flagBtn("blockLinks","🚫 حذف الروابط") + flagBtn("noForward","↩️ بدون علامة توجيه") +
    flagBtn("blockImages","🚫 حذف الصور") + flagBtn("blockVideos","🚫 حذف الفيديو") +
    flagBtn("blockAudios","🚫 حذف الصوت") +
    '</div></div>' +

    '<div class="fld"><label>🏷️ اسم القاعدة (اختياري)</label>' +
    '<input type="text" id="ruleName" placeholder="يُولَّد تلقائياً إن تُرك فارغاً" value="'+esc(SHEET.name||"")+'"></div>' +

    '<div style="display:flex;gap:8px;margin-top:6px">' +
    '<button class="btn btn-p" style="flex:1" onclick="saveRule()">💾 ' + (SHEET.editing?"حفظ التعديلات":"إنشاء القاعدة") + '</button>' +
    (SHEET.editing ? '<button class="btn btn-d" onclick="delRule()">🗑 حذف</button>' : "") +
    '</div>';
}
function flagBtn(k, label){
  return '<div class="flag '+(SHEET.flags[k]?"on":"")+'" onclick="SHEET.flags.'+k+'=!SHEET.flags.'+k+';drawSheet()">' +
    '<span>'+(SHEET.flags[k]?"✅":"⬜")+'</span> '+label+'</div>';
}
function togSrc(id){
  const i = SHEET.srcSel.indexOf(id);
  if (i>=0) SHEET.srcSel.splice(i,1); else SHEET.srcSel.push(id);
  drawSheet();
}
function dstFromPhone(v){
  const d = v.replace(/\\D/g,"");
  if (d.length >= 7) SHEET.dst = d + "@s.whatsapp.net";
}
function filterPick(inp, pickId){
  const q = inp.value.trim().toLowerCase();
  document.querySelectorAll("#"+pickId+" .it").forEach(el=>{
    el.style.display = (!q || (el.dataset.nm||"").includes(q)) ? "" : "none";
  });
}

async function saveRule(){
  const name = document.getElementById("ruleName")?.value?.trim() || "";
  if (!SHEET.srcSel.length) return toast("⚠️ اختر مصدراً واحداً على الأقل");
  if (!SHEET.dst) return toast("⚠️ اختر وجهة");
  try {
    if (SHEET.editing) {
      await api("/api/fw/rule/update", { id: SHEET.editing, patch: {
        sources: SHEET.srcSel, destination: SHEET.dst, sourceNumber: SHEET.num,
        ...SHEET.flags, ...(name ? {name} : {}),
      }});
      toast("✅ تم حفظ التعديلات");
    } else {
      await api("/api/fw/rule/create", {
        sources: SHEET.srcSel, destination: SHEET.dst, sourceNumber: SHEET.num,
        ...SHEET.flags, ...(name ? {name} : {}),
      });
      toast("✅ تم إنشاء القاعدة");
    }
    closeSheet(); await load();
  } catch(e){ toast("❌ " + e.message); }
}

async function delRule(){
  if (!confirm("حذف هذه القاعدة نهائياً؟")) return;
  try { await api("/api/fw/rule/delete", { id: SHEET.editing }); toast("🗑 تم حذف القاعدة"); closeSheet(); await load(); }
  catch(e){ toast("❌ " + e.message); }
}

load();
setInterval(()=>{if(!document.hidden)load()}, 30000);
</script>
</body>
</html>`;
