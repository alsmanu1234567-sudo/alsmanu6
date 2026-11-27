import test from "node:test";
import assert from "node:assert/strict";
import {
  interpret,
  jidVariants,
  removeParticipant,
  resolveGroupMemberJid,
  kickErrorText,
  digitsOf,
} from "../../dist/lib/wa-kick.mjs";

function sockStub(map) {
  // map: { jid: status } — يرجّع status وهمي كما يفعل واتساب
  return {
    async groupParticipantsUpdate(_group, [jid]) {
      const status = map[jid];
      if (status === undefined) throw new Error("socket-error");
      return [{ status, jid }];
    },
  };
}

test("interpret: 200/ok/بلا status = نجاح، وأي رمز آخر = فشل", () => {
  assert.equal(interpret([{ status: "200" }]).ok, true);
  assert.equal(interpret([{ status: "ok" }]).ok, true);
  assert.equal(interpret([{}]).ok, true);
  assert.equal(interpret([{ status: "403" }]).ok, false);
  assert.equal(interpret([]).ok, false);
});

test("jidVariants: إزالة التكرار + بديل الهاتف لمعرّف LID", () => {
  const out = jidVariants(["99978869522643@lid", "99978869522643@lid", "249114375739@s.whatsapp.net", ""]);
  assert.deepEqual(out, ["99978869522643@lid", "249114375739@s.whatsapp.net"]);
});

test("removeParticipant: ينجح عند أول معرّف صالح (LID)", async () => {
  const sock = sockStub({ "111@lid": "200" });
  const res = await removeParticipant(sock, "g@g.us", ["111@lid", "24911@s.whatsapp.net"]);
  assert.equal(res.ok, true);
  assert.equal(res.jid, "111@lid");
  assert.equal(res.tried.length, 1);
});

test("خطأ الطرد الشهير: LID يفشل 403 ⇒ يجرّب رقم الهاتف وينجح", async () => {
  const sock = sockStub({ "111@lid": "403", "249114375739@s.whatsapp.net": "200" });
  const res = await removeParticipant(sock, "g@g.us", ["111@lid", "249114375739@s.whatsapp.net"]);
  assert.equal(res.ok, true);
  assert.equal(res.jid, "249114375739@s.whatsapp.net");
  assert.deepEqual(res.tried.map((t) => t.status), ["403", "200"]);
});

test("فشل حقيقي: كل الصيغ 403 ⇒ ok=false مع السبب (لا يُكتب «تم الطرد»)", async () => {
  const sock = sockStub({ "111@lid": "403", "249114375739@s.whatsapp.net": "403" });
  const res = await removeParticipant(sock, "g@g.us", ["111@lid", "249114375739@s.whatsapp.net"]);
  assert.equal(res.ok, false);
  assert.match(kickErrorText(res.status), /403|رفض/);
});

test("استثناء الشبكة لا يمنع تجربة الصيغة التالية", async () => {
  const sock = {
    calls: 0,
    async groupParticipantsUpdate(_g, [jid]) {
      this.calls++;
      if (jid.endsWith("@lid")) throw new Error("boom");
      return [{ status: "200", jid }];
    },
  };
  const res = await removeParticipant(sock, "g@g.us", ["1@lid", "249114375739@s.whatsapp.net"]);
  assert.equal(res.ok, true);
  assert.equal(sock.calls, 2);
});

test("resolveGroupMemberJid: يحوّل الرقم إلى معرّف LID الحقيقي داخل المجموعة", async () => {
  const sock = {
    async groupMetadata() {
      return {
        participants: [
          { id: "99978869522643@lid", phoneNumber: "249114375739@s.whatsapp.net", admin: null },
          { id: "222@s.whatsapp.net", phoneNumber: "201000000000@s.whatsapp.net", admin: "admin" },
        ],
      };
    },
  };
  assert.equal(await resolveGroupMemberJid(sock, "g@g.us", "249114375739"), "99978869522643@lid");
  assert.equal(await resolveGroupMemberJid(sock, "g@g.us", "201000000000"), "222@s.whatsapp.net");
  assert.equal(await resolveGroupMemberJid(sock, "g@g.us", "999999999999"), "");
});

test("digitsOf: تنظيف الرموز", () => {
  assert.equal(digitsOf("+249 114-375-739"), "249114375739");
  assert.equal(digitsOf("abc"), "");
});
