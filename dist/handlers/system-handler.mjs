// dist/handlers/system-handler.mjs
// Domain: System — /start /help /cancel /info + navigation callbacks

import {
  needsNumberPick,
  setActiveNumber,
  buildNumberPickerKeyboard,
  resolveActiveNumber,
} from '../lib/number-profiles.mjs';

export const pluginManifest = {
  name: 'system',
  version: '1.0.0',
  type: 'handler',
  description: 'أوامر النظام: /start /help /cancel /info + navigation callbacks',
  textOrder: 1,
  cbOrder: 1,
  enabled: true,
};

let _deps = null;
export function setDeps(d) { _deps = d; }

/** عرض شاشة اختيار الرقم */
async function showNumberPicker(bot, chatId, user, context = 'main') {
  const nums = user.whatsappNumbers || [];
  const active = resolveActiveNumber(user);
  const lines = nums.map(n => {
    const isActive = n.number === active;
    return `${isActive ? '✅' : '📱'} ${n.number}`;
  });
  const text =
    `📱 *اختر الرقم الذي تريد إدارته:*\n\n` +
    `عندك *${nums.length}* أرقام مربوطة:\n${lines.join('\n')}\n\n` +
    `كل رقم له إعداداته الخاصة (ميزات رسائلي وغيرها).\n` +
    `النقاط والباقة مشتركة بين جميع الأرقام.`;
  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: buildNumberPickerKeyboard(nums, context),
  });
}

export async function handleText(bot, msg) {
  if (!msg.text) return false;
  const text = msg.text;
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id);
  const user = _deps.getUser(userId);
  const isDev = userId === _deps.DEVELOPER_ID;

  if (text === '/start' || text === '/menu') {
    await _deps.handleStart(bot, chatId, userId, msg.from);
    // بعد رسالة الترحيب: اعرض منتقي الأرقام إذا عنده أرقام متعددة
    if (needsNumberPick(user)) {
      await showNumberPicker(bot, chatId, user, 'main');
    }
    return true;
  }
  if (text === '/help' || text === '/help_commands') {
    await _deps.handleHelp(bot, chatId, userId);
    return true;
  }
  // [HELP-CENTER v8.29.0] بحث مباشر: /help كلمة
  if (/^\/(help|help_commands)\s+\S/.test(text)) {
    await _deps.handleHelp(bot, chatId, userId, text.replace(/^\/(help|help_commands)\s+/, ''));
    return true;
  }
  if (text === '/cancel') {
    _deps.clearState(userId);
    await bot.sendMessage(chatId, '\u2705 \u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629', {
      reply_markup: _deps.mainMenuKeyboard(user.points || 0, user.tier, isDev),
    });
    return true;
  }
  // ── [VIEW-ONCE v8.37.0] استخراج «عرض مرة واحدة» وإرسال المحتوى بدون غلاف ──
  if (/^\/peek(\s|$)/i.test(text)) {
    if (typeof _deps.peekViewOnce !== 'function') {
      await bot.sendMessage(chatId, '⚠️ ميزة الاستخراج غير متاحة في هذه النسخة.');
      return true;
    }
    const query = text.replace(/^\/peek\s*/i, '').trim();
    await bot.sendMessage(chatId, '⏳ أستخرج المحتوى بدون غلاف… (أجرّب كل الطرق: المخزَّن، المكتبة، فكّ التشفير الذاتي)').catch(() => {});
    let res = { ok: false, text: '❌ تعذّر الاستخراج.' };
    try {
      res = await _deps.peekViewOnce(userId, query, bot, chatId);
    } catch (err) {
      res = { ok: false, text: `❌ خطأ أثناء الاستخراج: ${String(err?.message || err).slice(0, 200)}` };
    }
    // الوسيط يُرسل من داخل peek؛ هنا نُبلغ بالنتيجة فقط عند وجود ما يُقال أو عند الفشل
    if (!res?.ok || (res.text && !/^✅/.test(res.text))) {
      await bot.sendMessage(chatId, res?.text || '❌ لا شيء.', { parse_mode: 'Markdown' }).catch(() => {});
    }
    return true;
  }
  if (/^\/viewonce(\s|$)/i.test(text) || /^\/view-once(\s|$)/i.test(text)) {
    const arg = text.replace(/^\/(viewonce|view-once)\s*/i, '').trim();
    let res = { ok: false, text: '⚠️ الميزة غير متاحة.' };
    try { res = _deps.viewOnceCommand ? _deps.viewOnceCommand(userId, arg) : res; }
    catch (err) { res = { ok: false, text: `❌ ${String(err?.message || err).slice(0, 160)}` }; }
    await bot.sendMessage(chatId, res?.text || '—', { parse_mode: 'Markdown' }).catch(() => {});
    return true;
  }

  if (text === '/info' || text === '/info_profile') {
    await _deps.showInfo(bot, chatId, userId);
    return true;
  }
  return false;
}

export async function handleCallback(bot, query) {
  const data = query.data || '';
  const chatId = query.message?.chat.id;
  const userId = String(query.from.id);
  const user = _deps.getUser(userId);
  const isDev = userId === _deps.DEVELOPER_ID;

  if (data === 'noop') return true;

  // ── منتقي الرقم (من شاشة البداية) ─────────────────────────────────────
  if (data.startsWith('numbpick_')) {
    const picked = data.slice('numbpick_'.length);
    if (picked !== 'skip') {
      // التحقق: الرقم المختار يجب أن يكون في قائمة أرقام المستخدم الفعلية
      const validNums = (user.whatsappNumbers || []).map(n => n.number);
      if (!validNums.includes(picked)) {
        // [FIX-NUMBPICK] الكولباك مُجاب مسبقاً في callback-handler — يجب عدم رمي خطأ هنا
        await bot.answerCallbackQuery(query.id, { text: '❌ رقم غير صالح' }).catch(() => {});
        await bot.sendMessage(chatId, '❌ رقم غير صالح').catch(() => {});
        return true;
      }
      setActiveNumber(userId, picked);
      await bot.answerCallbackQuery(query.id, { text: `✅ تم اختيار ${picked}` }).catch(() => {});
      await bot.sendMessage(chatId, `✅ تم اختيار الرقم ${picked} كرقم نشط`).catch(() => {});
    } else {
      await bot.answerCallbackQuery(query.id, { text: '🏠 تخطي — ستعمل بدون اختيار رقم' }).catch(() => {});
    }
    const freshUser = _deps.getUser(userId);
    _deps.clearState(userId);
    await bot.sendMessage(chatId, _deps.getWelcomeText(freshUser), {
      parse_mode: 'Markdown',
      reply_markup: _deps.mainMenuKeyboard(freshUser.points || 0, freshUser.tier, isDev),
    });
    return true;
  }

  // ── الرئيسية ────────────────────────────────────────────────────────────
  if (data === 'home' || data === 'back') {
    _deps.clearState(userId);
    await bot.sendMessage(chatId, _deps.getWelcomeText(user), {
      parse_mode: 'Markdown',
      reply_markup: _deps.mainMenuKeyboard(user.points || 0, user.tier, isDev),
    });
    return true;
  }

  if (data === 'cancel') {
    _deps.clearState(userId);
    await bot.sendMessage(chatId, '\u2705 \u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u064A\u0629', {
      reply_markup: _deps.mainMenuKeyboard(user.points || 0, user.tier, isDev),
    });
    return true;
  }

  if (data === 'next') {
    const state = _deps.getState(userId);
    if (state.state === 'awaiting_reply_content' || state.state === 'awaiting_long_text') {
      _deps.setState(userId, 'awaiting_reply_target');
      await bot.sendMessage(chatId, '\u{1F465} *\u0627\u062E\u062A\u0631 \u0645\u0646 \u064A\u0633\u062A\u0644\u0645 \u0627\u0644\u0631\u062F:*', {
        parse_mode: 'Markdown',
        reply_markup: _deps.replyTargetKeyboard(),
      });
    }
    return true;
  }

  // [WEBAPP-LINK v8.26.0] زر «رابط الويب آب»: يعرض الرابط الحالي بمسار /webapp،
  // ويعيد إنشاءه إن لم يوجد. سبب الإصلاح: الرابط كان يُفتح على "/" فيرجع 404.
  if (data === 'menu_webapp_link' || data === 'webapp_link_refresh') {
    let state = { url: null, provider: null };
    try {
      const t = await import('../tunnel.mjs');
      state = { url: t.tunnelUrl?.() || null, provider: t.tunnelProvider?.() || null };
    } catch (error) {
      _deps.logger?.warn?.({ error: String(error?.message || error) }, '[WEBAPP-LINK] تعذّر قراءة النفق');
    }
    if (!state.url) {
      await bot.sendMessage(chatId,
        '\u{1F310} *\u0631\u0627\u0628\u0637 \u0627\u0644\u0648\u064A\u0628 \u0622\u0628*\n\n' +
        '\u26A0\uFE0F \u0644\u0627 \u064A\u0648\u062C\u062F \u0631\u0627\u0628\u0637 \u0639\u0627\u0645 \u0627\u0644\u0622\u0646 (\u0627\u0644\u0646\u0641\u0642 \u0644\u0645 \u064A\u0628\u062F\u0623 \u0623\u0648 \u0645\u0627\u062A).\n' +
        '\u0627\u0636\u063A\u0637 \u00AB\u{1F504} \u0625\u0646\u0634\u0627\u0621 \u0631\u0627\u0628\u0637 \u062C\u062F\u064A\u062F\u00BB \u0648\u0633\u064A\u0638\u0647\u0631 \u062e\u0644\u0627\u0644 \u062b\u0648\u0627\u0646\u064d.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '\u{1F504} إنشاء رابط جديد', callback_data: 'webapp_link_refresh' }],
              [{ text: '\u25C0\uFE0F رجوع', callback_data: 'home' }],
            ],
          },
        });
      return true;
    }
    const link = `${state.url}/webapp`;
    let reachable = null;
    try {
      const res = await fetch(link, { method: 'GET', signal: AbortSignal.timeout(8000), redirect: 'follow' });
      reachable = res.status;
    } catch { reachable = 0; }
    const statusLine = reachable === 200
      ? '\u2705 \u0627\u0644\u0631\u0627\u0628\u0637 \u064A\u0639\u0645\u0644 \u0627\u0644\u0622\u0646'
      : `\u26A0\uFE0F \u0627\u0644\u0641\u062D\u0635 \u0623\u0631\u062C\u0639 ${reachable === 0 ? '\u0644\u0627 \u0627\u0633\u062A\u062C\u0627\u0628\u0629' : 'HTTP ' + reachable}`;
    await bot.sendMessage(chatId,
      '\u{1F310} *\u0631\u0627\u0628\u0637 \u0627\u0644\u0648\u064A\u0628 \u0622\u0628 \u0627\u0644\u062D\u0627\u0644\u064A*\n\n' +
      `${link}\n\n` +
      `${statusLine}\n` +
      `\u{1F517} \u0627\u0644\u0645\u0632\u0648\u0651\u062F: ${state.provider || '—'}\n\n` +
      '\u2139\uFE0F \u0627\u0644\u0631\u0627\u0628\u0637 \u064A\u062A\u063A\u064A\u0631 \u0645\u0639 \u0643\u0644 \u0625\u0639\u0627\u062F\u0629 \u062a\u0634\u063a\u064a\u0644 \u2014 \u0627\u0633\u062a\u062e\u062f\u0645 \u0647\u0630\u0627 \u0627\u0644\u0632\u0631 \u062f\u0627\u0626\u0645\u0627\u064b.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '\u{1F310} فتح الويب آب', url: link }],
            [{ text: '\u{1F504} تحديث / إعادة الفحص', callback_data: 'webapp_link_refresh' }],
            [{ text: '\u25C0\uFE0F رجوع', callback_data: 'home' }],
          ],
        },
      });
    return true;
  }
  if (data === 'menu_help') {
    await _deps.showHelp(bot, chatId, userId, user, isDev);
    return true;
  }
  // ═══ [HELP-TOGGLES v8.32.0] فتح/قفل أوامر «رسائلي» من /help ═══
  if (data.startsWith('help_tg_') || data.startsWith('help_tgall_') || data.startsWith('help_myp_')) {
    const editMsg = async (view) => {
      const opts = { parse_mode: 'Markdown', reply_markup: view.keyboard };
      try {
        if (query.message) await bot.editMessageText(view.text, { chat_id: chatId, message_id: query.message.message_id, ...opts });
        else await bot.sendMessage(chatId, view.text, opts);
      } catch {
        await bot.sendMessage(chatId, view.text, opts);
      }
    };
    try { await bot.answerCbQuery?.(query.id); } catch {}
    try {
      if (data.startsWith('help_tgall_')) {
        const enabled = data.endsWith('_1');
        await editMsg(await _deps.toggleAllMyMsgsCommands(userId, enabled));
        return true;
      }
      if (data.startsWith('help_myp_')) {
        await _deps.showMyMsgsCommands(bot, chatId, userId, Number(data.replace('help_myp_', '')) || 0);
        return true;
      }
      await editMsg(await _deps.toggleMyMsgsCommand(userId, data.replace('help_tg_', '')));
      return true;
    } catch (error) {
      await bot.sendMessage(chatId, `⚠️ ${String(error?.message || error).slice(0, 160)}`);
      return true;
    }
  }
  // ═══ [HELP-CENTER v8.29.0] دليل الأوامر التفاعلي ═══
  if (data === 'help_home' || data.startsWith('help_cat_') || data.startsWith('help_cmd_') || data === 'help_search') {
    const hc = await import('../help-center.mjs');
    const edit = async (view) => {
      const opts = { parse_mode: 'Markdown', reply_markup: view.keyboard };
      try {
        if (query.message) await bot.editMessageText(view.text, { chat_id: chatId, message_id: query.message.message_id, ...opts });
        else await bot.sendMessage(chatId, view.text, opts);
      } catch {
        await bot.sendMessage(chatId, view.text, opts);
      }
    };
    try { await bot.answerCbQuery?.(query.id).catch?.(() => {}); } catch {}
    if (data === 'help_home') { await edit(await hc.helpHomeView(isDev)); return true; }
    if (data === 'help_search') {
      await bot.sendMessage(chatId, '🔎 أرسل: `/help كلمة` — مثال: `/help طرد` أو `/help تنزيل`', { parse_mode: 'Markdown' });
      return true;
    }
    if (data.startsWith('help_cat_')) {
      const [, , catId, page] = data.split('_');
      await edit(await hc.helpCategoryView(catId, Number(page) || 0, isDev));
      return true;
    }
    if (data.startsWith('help_cmd_')) {
      await edit(await hc.helpCommandView(data.replace('help_cmd_', ''), isDev));
      return true;
    }
  }
  if (data === 'menu_info') {
    await _deps.showInfo2(bot, chatId, userId, user, isDev);
    return true;
  }
  if (data === 'msg_to_dev') {
    await _deps.handleMsgToDev(bot, chatId, userId);
    return true;
  }
  if (data === 'buy_mizaj_stars') {
    await _deps.handleBuyMizajStars(bot, chatId, userId, user);
    return true;
  }

  return false;
}
