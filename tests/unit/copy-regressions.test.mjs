import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyToSameChat, replyContextOf, _resetReactCopyState } from "../../dist/react-copy.mjs";
import { recordMessage } from "../../dist/lib/chat-log.mjs";

const JID = `120363-copy-regression-${Date.now()}@g.us`;
const UID = `copy-regression-${Date.now()}`;
const MID = `VO-STUB-${Date.now()}`;
const indexSource = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");

function fullViewOnceImage() {
  return {
    deviceSentMessage: {
      message: {
        viewOnceMessageV2: {
          message: {
            imageMessage: {
              mimetype: "image/jpeg",
              mediaKey: Buffer.alloc(32, 9),
              url: "https://mmg.whatsapp.net/full-copy-regression",
              fileLength: 1024,
            },
          },
        },
      },
    },
  };
}

test.beforeEach(() => {
  _resetReactCopyState();
});

test("replyContextOf: يجد الرد داخل غلاف الأمر ولا يضيع /copy g", () => {
  const quoted = { conversation: "الرسالة المستهدفة" };
  const command = {
    ephemeralMessage: {
      message: {
        extendedTextMessage: {
          text: "/copy g",
          contextInfo: {
            stanzaId: "quoted-1",
            participant: "249111@s.whatsapp.net",
            quotedMessage: quoted,
          },
        },
      },
    },
  };

  const ctx = replyContextOf(command);
  assert.equal(ctx?.stanzaId, "quoted-1");
  assert.equal(ctx?.quotedMessage, quoted);
});

test("/peek: يعيد جلب raw من chat-log بدلاً من الاعتماد على القائمة العامة", () => {
  assert.match(indexSource, /const full = _chatLogMod\.getMessage\(userId, g\.jid, m\.id\)/);
  assert.match(indexSource, /message: full\?\.raw\?\.message \|\| \{\}/);
});

test("/copy: يستبدل quotedMessage المصغّرة بنسخة chat-log الكاملة ويرسلها مفتوحة", async () => {
  const full = fullViewOnceImage();
  recordMessage(UID, JID, {
    key: { remoteJid: JID, id: MID, fromMe: false },
    message: full,
  });

  // هذا هو الشكل الذي يصل عادة داخل اقتباس view-once: نوع الوسيط والغلاف فقط،
  // بلا mediaKey ولا url؛ تمريره مباشرة إلى relay/download لا يمكن أن ينجح.
  const stub = {
    viewOnceMessageV2: {
      message: {
        imageMessage: { mimetype: "image/jpeg" },
      },
    },
  };
  const relayed = [];
  const sock = {
    user: { id: "249111@s.whatsapp.net" },
    relayMessage: async (jid, message, options) => {
      relayed.push({ jid, message, options });
    },
    sendMessage: async () => {
      throw new Error("يجب استخدام relay للنسخة الكاملة، لا sendMessage احتياطي");
    },
  };
  const baileys = {
    generateWAMessageFromContent: async (jid, message) => ({
      key: { remoteJid: jid, id: "relayed-copy" },
      message,
    }),
  };

  const result = await copyToSameChat({
    sock,
    baileys,
    jid: JID,
    quoted: stub,
    quotedKey: { remoteJid: JID, id: MID },
    userId: UID,
  });

  assert.equal(result.ok, true);
  assert.equal(result.wasViewOnce, true);
  assert.equal(result.usedRelay, true);
  assert.equal(relayed.length, 1);
  const content = relayed[0].message;
  assert.ok(content.imageMessage, "أُرسلت كصورة عادية");
  assert.equal(content.imageMessage.viewOnce, undefined);
  assert.ok(content.imageMessage.mediaKey, "استُخدمت النسخة الكاملة لا الـstub");
  assert.equal(content.viewOnceMessageV2, undefined, "لا يوجد غلاف viewOnce في الإرسال");

  // بعض الردود لا تحمل quotedMessage inline، لكنها تحمل stanzaId فقط.
  const idOnly = await copyToSameChat({
    sock,
    baileys,
    jid: JID,
    quoted: null,
    quotedKey: { remoteJid: JID, id: MID },
    userId: UID,
  });
  assert.equal(idOnly.ok, true, "المعرّف وحده يكفي مع وجود الرسالة في السجل");
  assert.equal(relayed.length, 2);
});
