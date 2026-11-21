import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  getMyMsgsSettingsForNumber,
  handleMyMsgsCallback,
  handleMyMsgsCommandControl,
  myMsgsMenuKeyboard,
  setDeps,
} from "../../dist/my-msgs.mjs";

function setupUser(userId, phoneNumber) {
  const user = {
    telegramId: userId,
    whatsappNumbers: [{ number: phoneNumber, settings: {} }],
  };
  setDeps({
    getUser: () => user,
    saveUser: (_id, update) => Object.assign(user, update),
  });
  return user;
}

test("WhatsApp controls rename, enable, disable, and explain a feature per number", () => {
  const userId = "my-msgs-controls";
  const phoneNumber = "+249900000111";
  const user = setupUser(userId, phoneNumber);

  const changed = handleMyMsgsCommandControl(
    userId,
    phoneNumber,
    "/mg cod nc",
    getMyMsgsSettingsForNumber(user, phoneNumber),
  );
  assert.match(changed, /تم تغيير كود صورة البروفايل إلى \/nc/u);
  assert.equal(getMyMsgsSettingsForNumber(user, phoneNumber).profilePicCmd, "/nc");

  let settings = getMyMsgsSettingsForNumber(user, phoneNumber);
  assert.match(handleMyMsgsCommandControl(userId, phoneNumber, "/nc off", settings), /تم إيقاف/u);
  settings = getMyMsgsSettingsForNumber(user, phoneNumber);
  assert.equal(settings.profilePicEnabled, false);
  assert.match(handleMyMsgsCommandControl(userId, phoneNumber, "/nc of", settings), /تم إيقاف/u);
  assert.match(handleMyMsgsCommandControl(userId, phoneNumber, "/nc on", settings), /تم تشغيل/u);
  settings = getMyMsgsSettingsForNumber(user, phoneNumber);
  assert.match(handleMyMsgsCommandControl(userId, phoneNumber, "/nc help", settings), /إدارة الميزة/u);
  assert.equal(handleMyMsgsCommandControl(userId, phoneNumber, "/nc me", settings), null);
});

test("command updates reject conflicts and reserve /help", () => {
  const userId = "my-msgs-conflicts";
  const phoneNumber = "+249900000112";
  const user = setupUser(userId, phoneNumber);
  let settings = getMyMsgsSettingsForNumber(user, phoneNumber);

  assert.match(
    handleMyMsgsCommandControl(userId, phoneNumber, "/mg cod /gm", settings),
    /مستخدم لميزة/u,
  );
  assert.match(
    handleMyMsgsCommandControl(userId, phoneNumber, "/mg cod /help", settings),
    /محجوز/u,
  );
  assert.equal(getMyMsgsSettingsForNumber(user, phoneNumber).profilePicCmd, "/mg");

  const help = handleMyMsgsCommandControl(userId, phoneNumber, "/help", settings);
  assert.match(help, /أكواد ميزات رسائلي وحالتها/u);
  assert.match(help, /صورة البروفايل: \/mg/u);
  assert.match(help, /تحويل النص إلى صوت/u);
});

test("existing bang commands and automatic features also accept controls", () => {
  const userId = "my-msgs-other-controls";
  const phoneNumber = "+249900000114";
  const user = setupUser(userId, phoneNumber);
  let settings = getMyMsgsSettingsForNumber(user, phoneNumber);

  assert.match(handleMyMsgsCommandControl(userId, phoneNumber, "!tr on", settings), /تم تشغيل الترجمة/u);
  settings = getMyMsgsSettingsForNumber(user, phoneNumber);
  assert.equal(settings.translateEnabled, true);

  assert.match(handleMyMsgsCommandControl(userId, phoneNumber, "/linkvideo off", settings), /تم إيقاف تنزيل الفيديو من رابط/u);
  settings = getMyMsgsSettingsForNumber(user, phoneNumber);
  assert.equal(settings.linkVideoEnabled, false);

  assert.match(handleMyMsgsCommandControl(userId, phoneNumber, "/statusas on", settings), /تم تشغيل الحفظ التلقائي للحالات/u);
  assert.equal(getMyMsgsSettingsForNumber(user, phoneNumber).statusAutoSave, true);
});

test("My Messages includes a help button with current WhatsApp codes and instructions", async () => {
  const userId = "my-msgs-help-button";
  const phoneNumber = "+249900000113";
  const user = setupUser(userId, phoneNumber);
  const menu = myMsgsMenuKeyboard(getMyMsgsSettingsForNumber(user, phoneNumber));
  assert.ok(
    menu.inline_keyboard.flat().some((button) => button.callback_data === "mymsgs_show_help"),
  );

  const sent = [];
  await handleMyMsgsCallback(
    { sendMessage: async (...args) => sent.push(args) },
    123,
    userId,
    "mymsgs_show_help",
  );
  assert.match(sent[0][1], /الأكواد المساعدة/u);
  assert.match(sent[0][1], /الكود cod nc/u);
  assert.match(sent[0][1], /\/help/u);
});

test("WhatsApp command controls are wired into the registered message patch for the linked account", async () => {
  const bundle = await readFile(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(bundle, /PATCH_MYMSGS_COMMAND_MANAGER_V1/u);
  assert.match(bundle, /msg\.key\?\.fromMe && typeof _mmMod\.handleMyMsgsCommandControl/u);
  assert.match(
    bundle,
    /handleMyMsgsCommandControl\(userId, _selfNumForSettings, trimmed, myS\)/u,
  );
});

test('socket identity resolves the correct stored phone and never uses LID as a number', async()=>{
  const {resolveMyMsgsSocketNumber}=await import('../../dist/my-msgs.mjs');
  const user={whatsappNumbers:[{number:'+249111'},{number:'249222'}]};
  assert.equal(resolveMyMsgsSocketNumber(user,{user:{id:'991234@lid',pn:'249111:3@s.whatsapp.net'}}),'+249111');
  assert.equal(resolveMyMsgsSocketNumber(user,{user:{id:'249222:1@s.whatsapp.net'}}),'249222');
  assert.equal(resolveMyMsgsSocketNumber(user,{user:{id:'249111@lid'}}),null);
});

test('status autosave uses the current socket and WhatsApp number, not telegram id', async()=>{
 const bundle=await readFile(new URL('../../dist/index.mjs',import.meta.url),'utf8');
 const section=bundle.slice(bundle.indexOf('// [STATUS-AUTO-SAVE]'),bundle.indexOf('return; // [DISPATCH-FIX]',bundle.indexOf('// [STATUS-AUTO-SAVE]')));
 assert.match(section,/resolveMyMsgsSocketNumber\(_statusUser, sock\)/);assert.match(section,/await sock\.sendMessage\(_selfJid/);assert.doesNotMatch(section,/\$\{userId\}@s\.whatsapp\.net/);assert.doesNotMatch(section,/activeSock/);
});

test('custom codes button reaches its own menu rather than generic feature handler',async()=>{
 const user=setupUser('codes-menu','+249900000115');const sent=[];
 await handleMyMsgsCallback({sendMessage:async(...args)=>sent.push(args)},123,'codes-menu','mymsgs_show_codes');
 assert.match(sent[0][1],/الأكواد الخاصة/u);assert.ok(sent[0][2].reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='mymsgs_codes_add'));
});

test('custom image codes use the repaired image pipeline and rotating codes advance in order',async()=>{
 const bundle=await readFile(new URL('../../dist/index.mjs',import.meta.url),'utf8');
 const section=bundle.slice(bundle.indexOf('// ── أكواد خاصة (Code Triggers)'),bundle.indexOf('cachePush(cacheKey, msg);',bundle.indexOf('// ── أكواد خاصة (Code Triggers)')));
 assert.match(section,/searchAndSendTextImages/);assert.match(section,/mymsgs_rot_/);assert.doesNotMatch(section,/searchImgCC/);
});
