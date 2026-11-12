import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setGroupWorldDeps, handleGroupWorldMessage, sameWhatsAppIdentity } from "../../dist/handlers/group-world-handler.mjs";
import { createGroupWorldService } from "../../dist/services/groups/group-world-service.mjs";
import { createGroupWorldStore } from "../../dist/services/groups/group-world-store.mjs";

const GROUP = "120363000000001-111111@g.us";
const OWNER_PHONE = "249000000001@s.whatsapp.net";
const OWNER_LID = "100000000001@lid";
const MEMBER = "249000000002@s.whatsapp.net";

async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "group-world-handler-test-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const service = createGroupWorldService({
    store: createGroupWorldStore({ dataDir }),
    now: () => new Date("2026-11-12T10:00:00.000Z"),
  });
  await service.activateGroup({
    groupId: GROUP,
    ownerId: "web-owner",
    ownerPhoneNumber: "249000000001",
    members: [
      { memberId: OWNER_LID, name: "Owner" },
      { memberId: MEMBER, name: "Member" },
    ],
  });

  setGroupWorldDeps({ groupWorldServiceOverride: service, logger: { warn() {} } });
  t.after(() => setGroupWorldDeps({ groupWorldServiceOverride: null }));

  const sent = [];
  const sock = {
    user: { id: OWNER_PHONE, jid: OWNER_PHONE, pn: OWNER_PHONE, lid: OWNER_LID },
    groupMetadata: async () => ({
      id: GROUP,
      participants: [
        { id: OWNER_LID, pn: OWNER_PHONE, lid: OWNER_LID, admin: null },
        { id: MEMBER, pn: MEMBER, admin: null },
      ],
    }),
    sendMessage: async (_groupId, content) => {
      sent.push(content);
      return { key: { id: `sent-${sent.length}` } };
    },
  };

  return { service, sock, sent };
}

function message(id, text, { fromMe = true, participant = OWNER_LID, participantAlt = OWNER_PHONE } = {}) {
  return {
    key: {
      id,
      remoteJid: GROUP,
      fromMe,
      participant,
      participantAlt,
    },
    message: { conversation: text },
    pushName: fromMe ? "Owner" : "Member",
  };
}

test("the linked owner can use public Group World commands from their own WhatsApp account", async (t) => {
  const { sock, sent } = await setup(t);
  const commands = [
    [".نقاطي", /500/],
    [".متجر", /متجر عالم المجموعة/],
    [".صدارة", /الصدارة العامة/],
    [".كل الاكواد", /\.نقاطي/],
  ];

  for (const [index, [text, expected]] of commands.entries()) {
    sent.length = 0;
    await handleGroupWorldMessage("web-owner", sock, message(`owner-command-${index}`, text), "notify");
    assert.match(sent.map((entry) => entry.text || "").join("\n"), expected);
  }
});

test("the linked owner can adjust points, while ordinary members cannot", async (t) => {
  const { service, sock, sent } = await setup(t);
  await handleGroupWorldMessage("web-owner", sock, message("owner-adjust", ".تزويد 2 25"), "notify");
  assert.equal((await service.getMemberProfile(GROUP, MEMBER)).balance, 525);

  sent.length = 0;
  await handleGroupWorldMessage("web-owner", sock, message(
    "member-adjust",
    ".تزويد 2 25",
    { fromMe: false, participant: MEMBER, participantAlt: MEMBER },
  ), "notify");
  assert.equal((await service.getMemberProfile(GROUP, MEMBER)).balance, 525);
  assert.match(sent.map((entry) => entry.text || "").join("\n"), /المشرفين المخوّلين/);
});

test("bot-generated self messages and mismatched fromMe identities are ignored", async (t) => {
  const { service, sock, sent } = await setup(t);

  assert.equal(await handleGroupWorldMessage(
    "web-owner",
    sock,
    message("automatic-echo", "رسالة آلية من البوت"),
    "notify",
  ), null);
  assert.equal(await handleGroupWorldMessage(
    "web-owner",
    sock,
    message("outgoing-command-echo", ".نقاطي"),
    "append",
  ), null);
  assert.equal(await handleGroupWorldMessage(
    "web-owner",
    sock,
    message("conflicting-self-identity", ".تزويد 2 100", {
      participant: MEMBER,
      participantAlt: MEMBER,
    }),
    "notify",
  ), null);

  assert.equal(sent.length, 0);
  assert.equal((await service.getMemberProfile(GROUP, OWNER_LID)).messages, 0);
  assert.equal((await service.getMemberProfile(GROUP, MEMBER)).balance, 500);
});

test("WhatsApp identity comparison supports JID variants without conflating LIDs", () => {
  assert.equal(sameWhatsAppIdentity("249000000001:7@s.whatsapp.net", "249000000001@c.us"), true);
  assert.equal(sameWhatsAppIdentity("249000000001@lid", "249000000001@s.whatsapp.net"), false);
  assert.equal(sameWhatsAppIdentity("", ""), false);
});
