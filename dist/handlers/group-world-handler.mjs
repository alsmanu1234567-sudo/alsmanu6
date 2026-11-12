/**
 * WhatsApp group event and command handler for Group World.
 * Dependencies: the shared group-world service and a Baileys socket.
 * Exports: setGroupWorldDeps, handleGroupWorldMessage, handleGroupWorldParticipants.
 */

import {
  groupWorldService as defaultGroupWorldService,
  groupWorldDayKey,
  groupWorldWeekKey,
  renderMessageTemplate,
} from "../services/groups/group-world-service.mjs";

let _deps = {};
const groupWorldService = new Proxy(defaultGroupWorldService, {
  get(target, property) {
    const source = _deps.groupWorldServiceOverride || target;
    const value = Reflect.get(source, property, source);
    return typeof value === "function" ? value.bind(source) : value;
  },
});
const GROUP_ID_PATTERN = /^[A-Za-z0-9._:-]{3,128}@g\.us$/;
const MAX_REPLY_LENGTH = 3_500;
const commandEvents = new Map();
const participantEvents = new Map();

export function setGroupWorldDeps(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function messageText(message) {
  let content = message?.message || {};
  for (let index = 0; index < 5; index += 1) {
    const wrapped =
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message ||
      content.documentWithCaptionMessage?.message;
    if (!wrapped) break;
    content = wrapped;
  }
  return [
    content.conversation,
    content.extendedTextMessage?.text,
    content.imageMessage?.caption,
    content.videoMessage?.caption,
    content.documentMessage?.caption,
  ].filter(Boolean).join("\n").trim();
}

function participantId(message) {
  const key = message?.key || {};
  return key.participant || key.participantAlt || key.participantPn || message?.participant || "";
}

function normalizeWhatsAppAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  const separator = address.lastIndexOf("@");
  if (separator <= 0 || separator === address.length - 1) return address;
  const user = address.slice(0, separator).replace(/:\d+$/, "");
  const domain = address.slice(separator + 1) === "c.us"
    ? "s.whatsapp.net"
    : address.slice(separator + 1);
  return `${user}@${domain}`;
}

function phoneDigits(value) {
  const address = String(value || "").trim().toLowerCase();
  const separator = address.lastIndexOf("@");
  if (separator < 0) {
    return /^\+?[\d\s()-]+$/.test(address) ? address.replace(/\D/g, "") : "";
  }
  const domain = address.slice(separator + 1);
  if (!["s.whatsapp.net", "c.us"].includes(domain)) return "";
  const user = address.slice(0, separator).replace(/:\d+$/, "");
  return /^\+?\d+$/.test(user) ? user.replace(/\D/g, "") : "";
}

export function sameWhatsAppIdentity(left, right) {
  const a = normalizeWhatsAppAddress(left);
  const b = normalizeWhatsAppAddress(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const leftPhone = phoneDigits(left);
  const rightPhone = phoneDigits(right);
  return Boolean(leftPhone && rightPhone && leftPhone === rightPhone);
}

function sameMember(left, right) {
  return sameWhatsAppIdentity(left, right);
}

function participantIdentityValues(participant) {
  if (!participant || typeof participant !== "object") return [];
  return [participant.id, participant.jid, participant.pn, participant.phoneNumber, participant.lid]
    .filter(Boolean)
    .map(String);
}

function socketIdentityValues(sock) {
  const user = sock?.user || {};
  return [user.id, user.jid, user.pn, user.lid, user.phoneNumber]
    .filter(Boolean)
    .map(String);
}

async function resolvedMessageSenderIds(message, memberId, sock) {
  const ids = messageSenderIds(message, memberId);
  const mapping = sock?.signalRepository?.lidMapping;
  if (typeof mapping?.getPNForLID !== "function") return ids;
  for (const id of ids) {
    if (!String(id).toLowerCase().endsWith("@lid")) continue;
    try {
      const phoneJid = await mapping.getPNForLID(id);
      if (phoneJid) ids.push(String(phoneJid));
    } catch {
      // The alternate participant JID remains usable when the local mapping is absent.
    }
  }
  return [...new Set(ids)];
}

function socketPhoneNumber(sock) {
  const user = sock?.user || {};
  return [
    phoneDigits(user.pn),
    phoneDigits(user.phoneNumber),
    phoneDigits(user.jid),
    phoneDigits(user.id),
  ].find(Boolean) || "";
}

async function isCurrentSocketOwnerMessage(groupId, sock, message) {
  const ownIds = socketIdentityValues(sock);
  if (message?.key?.fromMe !== true || !ownIds.length) return false;
  const senderIds = messageSenderIds(message, "");
  if (!senderIds.length) return true;
  const resolved = await resolvedMessageSenderIds(message, "", sock);
  if (resolved.some((sender) => ownIds.some((own) => sameWhatsAppIdentity(sender, own)))) return true;

  if (typeof sock?.groupMetadata !== "function") return false;
  try {
    const metadata = await sock.groupMetadata(groupId);
    return (metadata?.participants || []).some((participant) => {
      const identities = participantIdentityValues(participant);
      return identities.some((identity) => senderIds.some((sender) => sameWhatsAppIdentity(identity, sender))) &&
        identities.some((identity) => ownIds.some((own) => sameWhatsAppIdentity(identity, own)));
    });
  } catch {
    return false;
  }
}

async function ownerMemberId(groupId, sock, message) {
  const ownIds = socketIdentityValues(sock);
  const senderIds = await resolvedMessageSenderIds(message, "", sock);
  const primarySender = participantId(message);
  if (primarySender && senderIds.some((sender) => ownIds.some((own) => sameWhatsAppIdentity(sender, own)))) {
    return normalizeWhatsAppAddress(primarySender);
  }

  if (typeof sock?.groupMetadata === "function") {
    try {
      const metadata = await sock.groupMetadata(groupId);
      const participant = (metadata?.participants || []).find((entry) =>
        participantIdentityValues(entry).some((identity) =>
          ownIds.some((own) => sameWhatsAppIdentity(identity, own))
        )
      );
      const id = participant?.id || participant?.jid || participant?.pn || participant?.lid;
      if (id) return normalizeWhatsAppAddress(id);
    } catch {
      // Fall through to the linked socket identity so a metadata outage does not block commands.
    }
  }

  const linkedId = [sock?.user?.pn, sock?.user?.id, sock?.user?.jid, sock?.user?.lid]
    .find(Boolean);
  return normalizeWhatsAppAddress(linkedId);
}

async function isGroupWorldOwner(groupId, userId, sock) {
  const group = await groupWorldService.getGroup(groupId);
  if (group.ownerId && String(group.ownerId) === String(userId || "")) return true;
  const savedPhone = String(group.ownerPhoneNumber || "").replace(/\D/g, "");
  const linkedPhone = socketPhoneNumber(sock);
  return Boolean(savedPhone && linkedPhone && savedPhone === linkedPhone);
}

function groupAdmin(metadata, memberId) {
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const participant = participants.find((item) =>
    [item?.id, item?.jid, item?.pn, item?.phoneNumber, item?.lid].some((value) => sameMember(value, memberId))
  );
  return participant?.admin === "admin" || participant?.admin === "superadmin" || participant?.isAdmin === true;
}

function messageSenderIds(message, primaryId) {
  const key = message?.key || {};
  return [...new Set([
    primaryId,
    key.participant,
    key.participantAlt,
    key.participantPn,
    message?.participant,
  ].filter(Boolean).map(String))];
}

async function canManageFromChat(groupId, message, memberId, metadata, permission, sock, isBotOwner = false) {
  if (isBotOwner) return true;
  const candidates = await resolvedMessageSenderIds(message, memberId, sock);
  if (candidates.some((candidate) => groupAdmin(metadata, candidate))) return true;
  for (const candidate of candidates) {
    if (await groupWorldService.hasPermission(groupId, candidate, permission)) return true;
  }
  return false;
}

function ownAccountIsAdmin(sock, metadata) {
  const own = [sock?.user?.id, sock?.user?.jid, sock?.user?.pn, sock?.user?.lid].filter(Boolean);
  return own.some((id) => groupAdmin(metadata, id));
}

async function sendText(sock, groupId, text) {
  const content = String(text || "").trim();
  if (!content) return;
  let remaining = content;
  const chunks = [];
  while (remaining.length > MAX_REPLY_LENGTH && chunks.length < 19) {
    let cut = remaining.lastIndexOf("\n", MAX_REPLY_LENGTH);
    if (cut < Math.floor(MAX_REPLY_LENGTH * 0.55)) cut = MAX_REPLY_LENGTH;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining.length > MAX_REPLY_LENGTH) {
    remaining = `${remaining.slice(0, MAX_REPLY_LENGTH - 35)}\n… تم اختصار بقية النتائج.`;
  }
  if (remaining) chunks.push(remaining);
  for (const chunk of chunks) await sock.sendMessage(groupId, { text: chunk });
}

async function sendTemplate(sock, groupId, template, values) {
  const rendered = renderMessageTemplate(template, values);
  if (rendered.buttons.length) {
    _deps.logger?.warn?.({ groupId }, "Skipped a template with unsupported outgoing interactive buttons");
    return false;
  }
  if (rendered.image) {
    await sock.sendMessage(groupId, {
      image: { url: rendered.image },
      caption: String(rendered.text || "").slice(0, MAX_REPLY_LENGTH),
    });
  } else {
    await sendText(sock, groupId, rendered.text);
  }
  return true;
}

function accountIdFromMessage(message) {
  return participantId(message);
}

async function getTemplateValues(sock, groupId, memberId, profile, includeImage = false) {
  const safeProfile = profile || {
    balance: 0,
    name: memberId.split("@")[0],
    rank: { name: "مبتدئ" },
    position: null,
    totalEarned: 0,
    totalSpent: 0,
    activePet: null,
    nextPoints: 0,
  };
  const all = await groupWorldService.getMembers(groupId);
  let image = null;
  if (includeImage && typeof sock?.profilePictureUrl === "function") {
    try {
      image = await sock.profilePictureUrl(memberId, "image");
    } catch {
      image = null;
    }
  }
  return {
    points: safeProfile.balance,
    name: safeProfile.name || memberId.split("@")[0],
    time: new Intl.DateTimeFormat("ar", {
      timeZone: "Africa/Khartoum",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date()),
    image,
    allMembers: all.map((entry, index) => `${index + 1}. ${entry.name}: ${entry.balance}`).join("\n"),
    rank: safeProfile.rank?.name || "مبتدئ",
    position: safeProfile.position || "—",
    earned: safeProfile.totalEarned,
    spent: safeProfile.totalSpent,
    pet: safeProfile.activePet?.catalog?.name || "لا يوجد",
    nextPoints: safeProfile.nextPoints || 0,
  };
}

function formatMemberLine(member, index) {
  const name = String(member.name || member.memberId.split("@")[0]).slice(0, 32);
  return `${index + 1}. ${name} — ${Number(member.balance).toLocaleString("ar")} نقطة · ${member.rank?.name || "مبتدئ"}`;
}

async function commandReply(sock, groupId, memberId, message, text, isBotOwner = false) {
  const commandToken = text.trim().split(/\s+/)[0];
  const args = text.trim().slice(commandToken.length).trim();
  const name = message?.pushName || "";
  await groupWorldService.ensureMember(groupId, memberId, name);
  const profile = await groupWorldService.getMemberProfile(groupId, memberId);
  const argsList = args.split(/\s+/).filter(Boolean);

  if (commandToken === ".نقاطي") {
    return sendText(sock, groupId, [
      `${profile.name || name || "عضو"}`,
      `الرصيد: ${profile.balance.toLocaleString("ar")} نقطة`,
      `الرتبة: ${profile.rank?.icon || "⭐"} ${profile.rank?.name || "مبتدئ"}`,
      `الترتيب: ${profile.position || "—"} · التالي بعد ${profile.nextPoints || 0} نقطة`,
      `المستوى: ${profile.level} · XP: ${profile.xp}`,
    ].join("\n"));
  }

  if (commandToken === ".نقاط" && args === "الكل") {
    const members = await groupWorldService.getMembers(groupId);
    return sendText(sock, groupId, members.length
      ? `نقاط أعضاء المجموعة:\n${members.map(formatMemberLine).join("\n")}`
      : "لا توجد أرصدة مسجّلة بعد.");
  }

  if (commandToken === ".هدية" && !args) {
    const gift = await groupWorldService.claimGiftForMember(groupId, memberId, "daily", name);
    return sendText(sock, groupId, `استلمت ${gift.amount.toLocaleString("ar")} نقطة. رصيدك الآن ${gift.balance.toLocaleString("ar")}.`);
  }

  if (commandToken === ".هدية" && ["اسبوعية", "أسبوعية"].includes(args)) {
    const gift = await groupWorldService.claimGiftForMember(groupId, memberId, "weekly", name);
    return sendText(sock, groupId, `استلمت ${gift.amount.toLocaleString("ar")} نقطة أسبوعية. رصيدك الآن ${gift.balance.toLocaleString("ar")}.`);
  }

  if (commandToken === ".صدارة") {
    const period = /شهر/i.test(args) ? "monthly" : /اسبوع|أسبوع/i.test(args) ? "weekly" : /يوم/i.test(args) ? "daily" : "all";
    const title = { daily: "اليومية", weekly: "الأسبوعية", monthly: "الشهرية", all: "العامة" }[period];
    const leaders = await groupWorldService.getLeaderboard(groupId, period, 10);
    return sendText(sock, groupId, leaders.length
      ? `الصدارة ${title}:\n${leaders.map((entry, index) => `${index + 1}. ${entry.name} — ${Number(entry.score).toLocaleString("ar")}`).join("\n")}`
      : `لا توجد نتائج للصدارة ${title} بعد.`);
  }

  if (commandToken === ".متجر") {
    const group = await groupWorldService.getGroup(groupId);
    const pets = group.catalogs.pets.filter((pet) => pet.enabled !== false);
    const items = group.catalogs.items.filter((item) => item.enabled !== false).slice(0, 10);
    return sendText(sock, groupId, [
      "متجر عالم المجموعة",
      "الحيوانات — للشراء اكتب .شراء <معرّف>",
      ...pets.map((pet) => `${pet.icon} ${pet.name} — ${Number(pet.price).toLocaleString("ar")} · ${pet.id}`),
      "العناصر",
      ...items.map((item) => `${item.icon} ${item.name} — ${Number(item.price).toLocaleString("ar")} · ${item.id}`),
    ].join("\n"));
  }

  if (commandToken === ".شراء" && args) {
    const pet = profile.pets.find((item) => item.petId === args);
    if (pet) return sendText(sock, groupId, "تملك هذا الحيوان بالفعل.");
    const group = await groupWorldService.getGroup(groupId);
    if (group.catalogs.pets.some((item) => item.id === args && item.enabled !== false)) {
      const result = await groupWorldService.purchasePet(groupId, memberId, args, name);
      return sendText(sock, groupId, `تم شراء ${result.pet.name}. رصيدك ${result.balance.toLocaleString("ar")}.`);
    }
    const result = await groupWorldService.purchaseItem(groupId, memberId, args);
    return sendText(sock, groupId, `تم شراء ${result.item.name}. رصيدك ${result.balance.toLocaleString("ar")}.`);
  }

  if (commandToken === ".حيواني") {
    const pet = profile.activePet;
    return sendText(sock, groupId, pet
      ? `${pet.catalog?.icon || "🐾"} ${pet.catalog?.name || pet.petId} · المستوى ${pet.level}\nالقدرة: ${pet.catalog?.ability || "نشاط"}`
      : "ليس لديك حيوان نشط. استخدم .متجر لعرض الحيوانات.");
  }

  if (commandToken === ".حيواناتي") {
    return sendText(sock, groupId, profile.pets.length
      ? `حيواناتك:\n${profile.pets.map((pet) => `${pet.catalog?.icon || "🐾"} ${pet.catalog?.name || pet.petId} · مستوى ${pet.level}${profile.activePetId === pet.petId ? " (نشط)" : ""}`).join("\n")}`
      : "لا تملك حيوانات بعد.");
  }

  if (commandToken === ".تفعيل" && argsList[0] === "حيوان" && argsList[1]) {
    const result = await groupWorldService.activatePet(groupId, memberId, argsList[1]);
    return sendText(sock, groupId, `تم تغيير حيوانك النشط إلى ${result.activePetId}.`);
  }

  if (commandToken === ".ترقية" && ["حيواني", "حيوان"].includes(args)) {
    const result = await groupWorldService.upgradePet(groupId, memberId);
    return sendText(sock, groupId, `تمت الترقية إلى المستوى ${result.pet.level} مقابل ${result.cost.toLocaleString("ar")} نقطة.`);
  }

  if (commandToken === ".مهامي") {
    const group = await groupWorldService.getGroup(groupId);
    const dayKey = groupWorldDayKey(new Date());
    const weekKey = groupWorldWeekKey(new Date());
    const daily = group.settings.dailyTasks.map((task) => {
      const progress = profile.taskProgress?.daily?.[dayKey]?.[task.id]?.count || 0;
      return `• ${task.name}: ${Math.min(progress, task.target)}/${task.target} · ${task.reward} نقطة`;
    });
    const weekly = group.settings.weeklyTasks.map((task) => {
      const progress = profile.taskProgress?.weekly?.[weekKey]?.[task.id]?.count || 0;
      return `• ${task.name}: ${Math.min(progress, task.target)}/${task.target} · ${task.reward} نقطة`;
    });
    return sendText(sock, groupId, ["مهام اليوم:", ...daily, "مهام الأسبوع:", ...weekly].join("\n"));
  }

  if (commandToken === ".انجازاتي") {
    const names = {
      "first-message": "أول رسالة",
      "messages-100": "مئة رسالة",
      "messages-1000": "ألف رسالة",
      "streak-7": "سلسلة أسبوع",
      "pet-owner": "أول حيوان",
    };
    return sendText(sock, groupId, profile.achievements.length
      ? `إنجازاتك:\n${profile.achievements.map((item) => `🏅 ${names[item] || item}`).join("\n")}`
      : "لم تحصل على إنجازات بعد.");
  }

  if (commandToken === ".ملفي") {
    return sendText(sock, groupId, [
      `الملف الشخصي: ${profile.name || name || "عضو"}`,
      `${profile.rank?.icon || "⭐"} ${profile.rank?.name || "مبتدئ"} · المركز ${profile.position || "—"}`,
      `النقاط ${profile.balance} · XP ${profile.xp} · المستوى ${profile.level}`,
      `الرسائل ${profile.messages} · السلسلة ${profile.streak} يوم`,
      `المكتسب ${profile.totalEarned} · المصروف ${profile.totalSpent}`,
      `الحيوان ${profile.activePet?.catalog?.name || "لا يوجد"} · الإنجازات ${profile.achievements.length}`,
    ].join("\n"));
  }

  if (commandToken === ".حقيبتي") {
    const items = profile.inventory.map((item) => `${item.itemId} ×${item.quantity}`);
    const pets = profile.pets.map((pet) => `${pet.catalog?.icon || "🐾"} ${pet.catalog?.name || pet.petId}`);
    return sendText(sock, groupId, [
      "حقيبتك:",
      `الحيوانات: ${pets.length ? pets.join("، ") : "لا يوجد"}`,
      `المقتنيات: ${items.length ? items.join("، ") : "لا يوجد"}`,
      `اللقب: ${profile.titleItemId || "لا يوجد"} · الإطار: ${profile.frameItemId || "لا يوجد"}`,
    ].join("\n"));
  }

  if (commandToken === ".فريقي") {
    const team = (await groupWorldService.getGroup(groupId)).teams.find((item) => item.id === profile.teamId);
    return sendText(sock, groupId, team ? `فريقك: ${team.title}` : "لست ضمن فريق حاليًا.");
  }

  if (commandToken === ".تحدي") {
    const mentioned = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const stake = Number(argsList.find((item) => /^\d+$/.test(item)));
    if (!mentioned.length || !Number.isInteger(stake) || stake < 1) {
      return sendText(sock, groupId, "استخدم منشن الخصم ثم مبلغًا، مثل: .تحدي @عضو 100");
    }
    const metadata = await sock.groupMetadata(groupId);
    const opponentIsPresent = (metadata.participants || []).some((item) =>
      [item.id, item.jid, item.pn, item.lid].some((value) => sameMember(value, mentioned[0]))
    );
    if (!opponentIsPresent) return sendText(sock, groupId, "يجب أن يكون الخصم عضوًا حاليًا في المجموعة.");
    await groupWorldService.ensureMember(groupId, mentioned[0]);
    const challenge = await groupWorldService.createChallenge(groupId, memberId, mentioned[0], stake, memberId);
    return sendText(sock, groupId, `تم إنشاء التحدي ${challenge.id} برهان ${stake}. على الخصم كتابة .قبول ${challenge.id}`);
  }

  if (commandToken === ".قبول" && args) {
    const challenge = await groupWorldService.acceptChallenge(groupId, args, memberId);
    return sendText(sock, groupId, `قُبل التحدي ${challenge.id}. يستطيع مشرف المجموعة تسويته بعد انتهائه.`);
  }

  if (commandToken === ".حسم" && args) {
    const mentioned = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentioned.length) return sendText(sock, groupId, "استخدم منشن الفائز، مثل: .حسم <معرّف التحدي> @الفائز");
    const metadata = await sock.groupMetadata(groupId);
    if (!(await canManageFromChat(groupId, message, memberId, metadata, "points", sock, isBotOwner))) {
      return sendText(sock, groupId, "تسوية التحدي متاحة لمشرفي المجموعة أو المشرفين المخوّلين فقط.");
    }
    const challengeId = argsList.find((item) => item.startsWith("challenge-"));
    if (!challengeId) return sendText(sock, groupId, "أضف معرّف التحدي قبل منشن الفائز.");
    const settled = await groupWorldService.settleChallenge(groupId, challengeId, mentioned[0], memberId);
    return sendText(sock, groupId, `تمت تسوية ${settled.challenge.id} لصالح الفائز.`);
  }

  if (commandToken === ".قائمة") {
    const slots = await groupWorldService.getSlots(groupId);
    return sendText(sock, groupId, slots.length
      ? `قائمة الأعضاء:\n${slots.map((slot) => `${slot.slot}. ${slot.memberId ? slot.name || slot.memberId.split("@")[0] : "— فارغ —"}`).join("\n")}`
      : "القائمة فارغة. استخدم .تحديث القائمة بعد تفعيل النظام.");
  }

  if (commandToken === ".تحديث" && args === "القائمة") {
    const metadata = await sock.groupMetadata(groupId);
    if (!(await canManageFromChat(groupId, message, memberId, metadata, "members", sock, isBotOwner))) {
      return sendText(sock, groupId, "هذا الأمر متاح لمشرفي المجموعة فقط.");
    }
    const members = (metadata.participants || []).map((item) => ({
      memberId: item.id || item.jid || item.pn || item.lid,
      name: item.notify || item.name || "",
    })).filter((item) => item.memberId);
    const result = await groupWorldService.refreshSlots(groupId, members, memberId);
    return sendText(sock, groupId, `تم تحديث القائمة وإعادة ترقيم ${result.slots.length} عضوًا.`);
  }

  if (commandToken === ".تزويد") {
    const [slotNumber, rawAmount, ...reasonParts] = argsList;
    const amount = Number(rawAmount);
    if (!/^\d+$/.test(slotNumber || "") || !Number.isInteger(amount) || amount === 0) {
      return sendText(sock, groupId, "استخدم: .تزويد <رقم الخانة> <المبلغ>، ويمكن أن يكون المبلغ سالبًا للخصم.");
    }
    const metadata = await sock.groupMetadata(groupId);
    const permitted = await canManageFromChat(groupId, message, memberId, metadata, "points", sock, isBotOwner);
    if (!permitted) return sendText(sock, groupId, "هذا الأمر متاح لمشرفي المجموعة أو المشرفين المخوّلين فقط.");
    const target = await groupWorldService.getSlotMember(groupId, Number(slotNumber));
    const current = (metadata.participants || []).some((item) =>
      [item.id, item.jid, item.pn, item.phoneNumber, item.lid].some((value) => sameMember(value, target.memberId))
    );
    if (!current) {
      await groupWorldService.markMemberLeft(groupId, target.memberId);
      return sendText(sock, groupId, "الخانة فارغة لأن صاحبها غادر المجموعة؛ لم تُنفّذ العملية.");
    }
    const result = await groupWorldService.adjustSlot(
      groupId,
      Number(slotNumber),
      amount,
      memberId,
      reasonParts.join(" ") || "تعديل عبر أمر القائمة",
    );
    return sendText(sock, groupId, `${amount > 0 ? "أُضيفت" : "خُصمت"} ${Math.abs(amount)} نقطة من الخانة ${slotNumber}. الرصيد ${result.member.balance}.`);
  }

  if (commandToken === ".كل" && args === "الاكواد") {
    const commands = await groupWorldService.getPublicCommands(groupId);
    return sendText(sock, groupId, `الأوامر:\n${commands.join(" · ")}`);
  }

  const group = await groupWorldService.getGroup(groupId);
  const customDefinition = group.commands.find((item) =>
    item.enabled && item.name.toLowerCase() === commandToken.toLowerCase()
  );
  const custom = await groupWorldService.runCustomCommand(
    groupId,
    commandToken,
    await getTemplateValues(
      sock,
      groupId,
      memberId,
      profile,
      Boolean(customDefinition?.response?.includes("_img")),
    ),
  );
  if (custom) {
    if (custom.buttons.length) {
      return sendText(sock, groupId, "لم يُرسل الرد: الأزرار التفاعلية غير مدعومة في إصدار Baileys الحالي. لم يتم تحويلها إلى نصوص شكلية.");
    }
    if (custom.image) {
      await sock.sendMessage(groupId, {
        image: { url: custom.image },
        caption: String(custom.text || "").slice(0, MAX_REPLY_LENGTH),
      });
      return { sent: true, image: true };
    }
    return sendText(sock, groupId, custom.text);
  }
  return null;
}

export async function handleGroupWorldMessage(userId, sock, message, eventType = "") {
  const groupId = String(message?.key?.remoteJid || "");
  if (!GROUP_ID_PATTERN.test(groupId)) return null;
  const text = messageText(message);
  const fromMe = message?.key?.fromMe === true;
  if (fromMe && (eventType !== "notify" || !text.startsWith("."))) return null;
  if (fromMe && !(await isCurrentSocketOwnerMessage(groupId, sock, message))) return null;
  const memberId = fromMe
    ? await ownerMemberId(groupId, sock, message)
    : accountIdFromMessage(message);
  if (!memberId || !text) return null;

  try {
    if (text.startsWith(".")) {
      const eventId = String(message?.key?.id || "");
      const dedupeKey = `${groupId}:${eventId}`;
      if (eventId && commandEvents.has(dedupeKey)) return { duplicate: true };
      if (eventId) {
        commandEvents.set(dedupeKey, Date.now());
        if (commandEvents.size > 10_000) {
          const cutoff = Date.now() - 10 * 60_000;
          for (const [key, at] of commandEvents) {
            if (at < cutoff) commandEvents.delete(key);
          }
          while (commandEvents.size > 10_000) commandEvents.delete(commandEvents.keys().next().value);
        }
      }
      const botOwner = fromMe && await isGroupWorldOwner(groupId, userId, sock);
      return await commandReply(sock, groupId, memberId, message, text, botOwner);
    }
    const result = await groupWorldService.processMessage({
      groupId,
      memberId,
      name: message?.pushName || "",
      text,
      messageId: message?.key?.id,
      timestamp: message?.messageTimestamp
        ? new Date(Number(message.messageTimestamp) * 1_000)
        : new Date(),
      fromMe: false,
    });
    if (result?.shouldWarn) {
      const group = await groupWorldService.getGroup(groupId);
      const template = group.settings.messageTemplates?.spamWarning;
      if (template) {
        const profile = await groupWorldService.getMemberProfile(groupId, memberId);
        await sendTemplate(
          sock,
          groupId,
          template,
          await getTemplateValues(sock, groupId, memberId, profile, template.includes("_img")),
        );
      } else {
        await sendText(sock, groupId, `تنبيه: تكرار رسائل غير طبيعي. تم تسجيل المخالفة وخصم ${result.penalty} نقطة.`);
      }
    }
    if (result?.shouldKick && typeof sock.groupParticipantsUpdate === "function") {
      try {
        const metadata = await sock.groupMetadata(groupId);
        if (ownAccountIsAdmin(sock, metadata)) {
          await sock.groupParticipantsUpdate(groupId, [memberId], "remove");
          await sendText(sock, groupId, "تمت محاولة إزالة عضو بعد تجاوز حد مخالفات السبام.");
        }
      } catch {
        // Do not stop message processing when the current account lacks group moderation rights.
      }
    }
    return result;
  } catch (error) {
    if (text.startsWith(".")) {
      await sendText(sock, groupId, error?.message || "تعذّر تنفيذ الأمر.");
    }
    _deps.logger?.warn?.({ err: String(error), userId, groupId }, "Group World message failed");
    return null;
  }
}

export async function handleGroupWorldParticipants(userId, sock, event) {
  const groupId = String(event?.id || "");
  if (!GROUP_ID_PATTERN.test(groupId)) return;
  const action = String(event?.action || "");
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  try {
    if (action === "add") {
      const author = event?.author || event?.participant || null;
      for (const participant of participants) {
        const memberId = typeof participant === "string"
          ? participant
          : participant?.id || participant?.jid || participant?.pn || participant?.lid;
        if (!memberId) continue;
        const dedupeKey = `${groupId}:${action}:${memberId}:${author || ""}`;
        const previous = participantEvents.get(dedupeKey);
        if (previous && Date.now() - previous < 60_000) continue;
        participantEvents.set(dedupeKey, Date.now());
        if (participantEvents.size > 10_000) {
          const cutoff = Date.now() - 60_000;
          for (const [key, at] of participantEvents) if (at < cutoff) participantEvents.delete(key);
          while (participantEvents.size > 10_000) participantEvents.delete(participantEvents.keys().next().value);
        }
        await groupWorldService.markMemberJoined(groupId, {
          memberId,
          name: typeof participant === "object" ? participant.notify || participant.name || "" : "",
        });
        if (author && !sameMember(author, memberId)) {
          await groupWorldService.rewardInvite({
            groupId,
            inviterId: author,
            invitedId: memberId,
            eventId: event?.id ? `${event.id}:${memberId}` : null,
          });
        }
        const group = await groupWorldService.getGroup(groupId);
        const welcome = group.settings.messageTemplates?.welcome;
        if (group.enabled && group.modules.messageTemplates && welcome) {
          await groupWorldService.ensureMember(groupId, memberId, typeof participant === "object" ? participant.notify || participant.name || "" : "");
          const profile = await groupWorldService.getMemberProfile(groupId, memberId);
          await sendTemplate(
            sock,
            groupId,
            welcome,
            await getTemplateValues(sock, groupId, memberId, profile, welcome.includes("_img")),
          );
        }
      }
    } else if (action === "remove" || action === "leave") {
      for (const participant of participants) {
        const memberId = typeof participant === "string"
          ? participant
          : participant?.id || participant?.jid || participant?.pn || participant?.lid;
        if (memberId) {
          const dedupeKey = `${groupId}:${action}:${memberId}`;
          const previous = participantEvents.get(dedupeKey);
          if (previous && Date.now() - previous < 60_000) continue;
          participantEvents.set(dedupeKey, Date.now());
          if (participantEvents.size > 10_000) {
            const cutoff = Date.now() - 60_000;
            for (const [key, at] of participantEvents) if (at < cutoff) participantEvents.delete(key);
            while (participantEvents.size > 10_000) participantEvents.delete(participantEvents.keys().next().value);
          }
          await groupWorldService.markMemberLeft(groupId, memberId);
        }
      }
    }
  } catch (error) {
    _deps.logger?.warn?.({ err: String(error), userId, groupId, action }, "Group World participant update failed");
  }
}

export { groupWorldService };
