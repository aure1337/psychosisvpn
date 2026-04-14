const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

// --- НАСТРОЙКИ FREEKASSA ---
const FK_ID = '72200';
const FK_KEY1 = 'D4)_tQ4H*N=[eNt'; 
const FK_KEY2 = '1yggQ([ReO$VVWl';

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {};
const USERS_PER_PAGE = 10;

const TARIFF_MAP = {
    'both': 'Обход и Впн',
    'white': 'Обход',
    'base': 'Базовый Впн',
    'none': 'Нету'
};

const PRICES = [
    { days: 30, price: 65, label: '1 месяц - 65₽ (-5%)' },
    { days: 90, price: 150, label: '3 месяца - 150₽ (-25%)' },
    { days: 180, price: 350, label: '6 месяцев - 350₽ (-10%)' },
    { days: 365, price: 590, label: '12 месяцев - 590₽ (-25%)' }
];

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function addDaysToDate(baseDateStr, days) {
    let baseDate = new Date(baseDateStr);
    let today = new Date();
    if (isNaN(baseDate.getTime()) || baseDate < today || baseDate.getFullYear() === 2000) baseDate = today;
    baseDate.setDate(baseDate.getDate() + parseInt(days));
    return baseDate.toISOString().split('T')[0];
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime()) || d.getFullYear() === 2000) return 'Нет подписки';
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function generateFkLink(amount, orderId) {
    const sign = crypto.createHash('md5').update(`${FK_ID}:${amount}:${FK_KEY1}:RUB:${orderId}`).digest('hex');
    return `https://pay.freekassa.ru/?m=${FK_ID}&oa=${amount}&o=${orderId}&s=${sign}&currency=RUB`;
}

async function safeDelete(ctx, msgId = null) {
    try {
        const cid = ctx.from?.id || ctx.chat?.id || ctx;
        const mid = msgId || ctx.message?.message_id || ctx.callbackQuery?.message?.message_id;
        if (mid) await bot.telegram.deleteMessage(cid, mid);
    } catch (e) {}
}

// --- БД: ЛОГИ ОПЛАТЫ ---
async function savePaymentMsg(orderId, chatId, msgId) {
    await supabase.from('payment_messages').insert([{ 
        order_id: orderId, 
        chat_id: chatId.toString(), 
        message_id: msgId 
    }]);
}

// --- ОТРИСОВКА ПРОФИЛЯ ---
async function renderProfile(ctx, isEdit = false) {
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    const today = new Date().toISOString().split('T')[0];
    const isExpired = !s || s.expires_at === '2000-01-01' || s.expires_at < today;
    const subUrl = `https://psychosisvpn.vercel.app/api/get_sub?id=${s?.id}`;
    
    const report = `👤 <b>${s?.internal_name || ctx.from.first_name}</b>\n💰 Баланс: <b>${s?.balance || 0}₽</b>\n🕗 До: <b>${isExpired ? '—' : formatDate(s.expires_at)}</b>\n💎 Тариф: <b>${TARIFF_MAP[s?.tariff_type] || 'Не активна'}</b>\n\n🔗 <code>${subUrl}</code>`;
    
    const inlineButtons = [[Markup.button.callback('💳 Пополнить', 'topup_menu')]];
    if (!s?.test_used && (isExpired || s?.tariff_type === 'none')) {
        inlineButtons.push([Markup.button.callback('🎁 Тест-период (5 дн.)', 'activate_test_profile')]);
    }
    inlineButtons.push([Markup.button.callback('🎟 Ввести промокод', 'enter_promo_inline')]);

    const keyboard = Markup.inlineKeyboard(inlineButtons);
    
    if (isEdit) {
        await ctx.editMessageText(report, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } else {
        await ctx.replyWithHTML(report, keyboard);
    }
}

// --- ОТРИСОВКА МЕНЮ ПОКУПКИ ---
async function renderBuyMenu(ctx, isEdit = false) {
    const buttons = PRICES.map((p, i) => [Markup.button.callback(p.label, `buy_select_${i}`)]);
    const text = '<b>💎 Выберите период подписки</b>\n<i>Тариф: Обход + Впн</i>';
    const kb = Markup.inlineKeyboard(buttons);
    
    if (isEdit) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }).catch(() => {});
    } else {
        await ctx.replyWithHTML(text, kb);
    }
}

// --- ПАГИНАЦИЯ АДМИНКИ ---
async function renderUsersList(ctx, page = 0) {
    const from = page * USERS_PER_PAGE;
    const to = from + USERS_PER_PAGE - 1;
    const { data: users, count } = await supabase.from('vpn_subs')
        .select('id, internal_name', { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, to);

    if (!users) return ctx.answerCbQuery('Ошибка загрузки');
    
    const buttons = users.map(u => [Markup.button.callback(u.internal_name || `ID: ${u.id}`, `manage_user_${u.id}`)]);
    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️', `admin_users_page_${page - 1}`));
    if (to < (count || 0) - 1) nav.push(Markup.button.callback('➡️', `admin_users_page_${page + 1}`));
    if (nav.length) buttons.push(nav);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);

    await ctx.editMessageText(`<b>👥 Юзеры</b> (Стр. ${page + 1})`, { 
        parse_mode: 'HTML', 
        ...Markup.inlineKeyboard(buttons) 
    });
}

// --- ОЧИСТКА ИСПОЛЬЗОВАННЫХ ПРОМОКОДОВ ---
async function cleanupExpiredPromos() {
    const { data: promos } = await supabase.from('promocodes').select('id, used_count, max_uses');
    for (const promo of promos || []) {
        if (promo.used_count >= promo.max_uses) {
            await supabase.from('promo_activations').delete().eq('promo_id', promo.id);
            await supabase.from('promocodes').delete().eq('id', promo.id);
        }
    }
}

// --- ФУНКЦИЯ АКТИВАЦИИ ПРОМОКОДА / ПОДАРКА ---
async function processPromoCode(ctx, userId, code, editMsgId = null) {
    const replyFn = async (text) => {
        if (editMsgId) {
            await ctx.telegram.editMessageText(ctx.from.id, editMsgId, null, text, { 
                parse_mode: 'HTML', 
                ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ В профиль', 'back_to_profile')]]) 
            });
        } else {
            await ctx.replyWithHTML(text);
        }
    };

    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', code).maybeSingle();
    if (!promo) return replyFn('❌ Такого промокода или подарка не существует.');
    
    const { data: sub } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId.toString()).maybeSingle();
    if (!sub) return replyFn('❌ Сначала запустите бота через /start');

    if (promo.used_count >= promo.max_uses) {
        await supabase.from('promo_activations').delete().eq('promo_id', promo.id);
        await supabase.from('promocodes').delete().eq('id', promo.id);
        return replyFn('❌ Этот код уже был использован максимальное количество раз.');
    }
    
    const { data: used } = await supabase.from('promo_activations').select('id').eq('user_id', sub.id).eq('promo_id', promo.id).maybeSingle();
    if (used) return replyFn('❌ Вы уже активировали этот код.');

    if (promo.bonus_rub && promo.bonus_rub > 0) {
        await supabase.from('vpn_subs').update({ balance: (sub.balance || 0) + promo.bonus_rub }).eq('id', sub.id);
        await replyFn(`🎉 <b>Активировано!</b>\n💰 На баланс: <b>${promo.bonus_rub}₽</b>`);
    } else {
        const newDate = addDaysToDate(sub.expires_at, promo.days);
        await supabase.from('vpn_subs').update({ 
            expires_at: newDate, 
            tariff_type: promo.tariff_type || 'both', 
            profile_title: 'Psychosis VPN | Premium' 
        }).eq('id', sub.id);
        await replyFn(`🎉 <b>Активировано!</b>\n⏳ Добавлено: <b>${promo.days} дн.</b>\n🕗 До: <b>${formatDate(newDate)}</b>`);
    }

    await supabase.from('promocodes').update({ used_count: (promo.used_count || 0) + 1 }).eq('id', promo.id);
    await supabase.from('promo_activations').insert([{ user_id: sub.id, promo_id: promo.id }]);
}

// --- СТАРТ ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'User');
    const { data: exists } = await supabase.from('vpn_subs').select('id').eq('tg_chat_id', userId).maybeSingle();
    
    if (!exists) {
        await supabase.from('vpn_subs').insert([{
            internal_name: username, tg_chat_id: userId, tariff_type: 'none',
            expires_at: '2000-01-01', profile_title: 'Psychosis VPN | Free',
            test_used: false, balance: 0
        }]);
    } else {
        await supabase.from('vpn_subs').update({ internal_name: username }).eq('tg_chat_id', userId);
    }
    
    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);
    
    await ctx.reply('🚀 Psychosis VPN запущен!\n\n⚡ Быстрый VPN для России и обхода блокировок', 
        Markup.keyboard(buttons).resize());

    if (ctx.payload) {
        await processPromoCode(ctx, userId, ctx.payload);
    }
});

// --- ГЛОБАЛЬНЫЕ КНОПКИ ---
bot.action('cancel_state', async (ctx) => {
    delete userStates[ctx.from.id];
    await renderProfile(ctx, true).catch(() => ctx.deleteMessage());
});

bot.action('back_to_profile', async (ctx) => {
    await renderProfile(ctx, true);
});

// --- ПРОФИЛЬ ---
bot.hears('👤 Профиль', async (ctx) => {
    await safeDelete(ctx);
    await renderProfile(ctx, false);
});

// ========== НОВОЕ МЕНЮ ПОПОЛНЕНИЯ ==========
bot.action('topup_menu', async (ctx) => {
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    await ctx.editMessageText(
        `💳 <b>Пополнение баланса</b>\n\n` +
        `👤 ${username}\n\n` +
        `<i>Выберите тип пополнения:</i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💰 Пополнить свой баланс', 'topup_self')],
                [Markup.button.callback('🎁 Купить подарочную карту', 'topup_gift')],
                [Markup.button.callback('⬅️ Назад', 'back_to_profile')]
            ])
        }
    );
});

// Пополнение своего баланса
bot.action('topup_self', async (ctx) => {
    userStates[ctx.from.id] = { 
        action: 'topup_amount_self', 
        msgId: ctx.callbackQuery.message.message_id 
    };
    
    await ctx.editMessageText(
        '💰 <b>Пополнение своего баланса</b>\n\n' +
        'Введите сумму пополнения в рублях (минимум 10₽):',
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Отмена', 'topup_menu')]
            ])
        }
    );
});

// Покупка подарочной карты на рубли
bot.action('topup_gift', async (ctx) => {
    userStates[ctx.from.id] = { 
        action: 'topup_amount_gift', 
        msgId: ctx.callbackQuery.message.message_id 
    };
    
    await ctx.editMessageText(
        '🎁 <b>Покупка подарочной карты</b>\n\n' +
        'Введите номинал подарочной карты в рублях (минимум 10₽):\n\n' +
        '<i>После оплаты вы получите ссылку, которую можно отправить другу. ' +
        'При активации друг получит указанную сумму на баланс.</i>',
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Отмена', 'topup_menu')]
            ])
        }
    );
});

// ========== КОНЕЦ МЕНЮ ПОПОЛНЕНИЯ ==========

bot.action('activate_test_profile', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    if (user?.test_used) return ctx.answerCbQuery('❌ Тест уже использован!', { show_alert: true });
    const newDate = addDaysToDate('2000-01-01', 5); 
    await supabase.from('vpn_subs').update({ 
        tariff_type: 'both', 
        expires_at: newDate, 
        profile_title: 'Psychosis VPN | TEST', 
        test_used: true 
    }).eq('tg_chat_id', userId);
    ctx.answerCbQuery('✅ Активировано!');
    await renderProfile(ctx, true);
});

bot.action('enter_promo_inline', async (ctx) => {
    userStates[ctx.from.id] = { action: 'enter_promo', msgId: ctx.callbackQuery.message.message_id };
    await ctx.editMessageText('🎟 <b>Введите промокод или подарок:</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'back_to_profile')]])
    });
});

// --- ПОКУПКА ---
bot.hears('💎 Покупка', async (ctx) => {
    await safeDelete(ctx);
    await renderBuyMenu(ctx, false);
});

bot.action('buy_menu_back', async (ctx) => {
    await renderBuyMenu(ctx, true);
});

bot.action(/^buy_select_(\d+)$/, async (ctx) => {
    const idx = ctx.match[1];
    const pkg = PRICES[idx];
    await ctx.editMessageText(`<b>${pkg.label}</b>\n\nВыберите способ оплаты:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 С баланса бота', `buy_confirm_${idx}`)],
            [Markup.button.callback('💳 Картой / СБП (FreeKassa)', `buy_fk_${idx}`)],
            [Markup.button.callback('🎁 В подарок', `buy_gift_${idx}`)],
            [Markup.button.callback('⬅️ Назад', 'buy_menu_back')]
        ])
    });
});

bot.action(/^buy_fk_(\d+)$/, async (ctx) => {
    const idx = ctx.match[1];
    const pkg = PRICES[idx];
    const orderId = `SUB_${ctx.from.id}_${idx}_${Date.now()}`;
    const link = generateFkLink(pkg.price, orderId);
    
    const sent = await ctx.editMessageText(
        `🚀 <b>Оплата подписки: ${pkg.price}₽</b>\n\nСообщение удалится через 5 минут или после оплаты.`, 
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.url('💳 Оплатить', link)],
                [Markup.button.callback('⬅️ Назад', `buy_select_${idx}`)]
            ])
        }
    );

    await savePaymentMsg(orderId, ctx.from.id, sent.message_id);
    setTimeout(() => safeDelete(ctx.from.id, sent.message_id), 300000);
});

bot.action(/^buy_confirm_(\d+)$/, async (ctx) => {
    const pkg = PRICES[ctx.match[1]];
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    if (s.balance < pkg.price) return ctx.answerCbQuery('❌ Недостаточно средств!', { show_alert: true });
    const newDate = addDaysToDate(s.expires_at, pkg.days);
    await supabase.from('vpn_subs').update({ 
        balance: s.balance - pkg.price, 
        expires_at: newDate, 
        tariff_type: 'both', 
        profile_title: 'Psychosis VPN | Premium' 
    }).eq('id', s.id);
    await ctx.editMessageText(`✅ <b>Успешно!</b>\n⏳ Активно до: <b>${formatDate(newDate)}</b>`, { 
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('👤 В профиль', 'back_to_profile')]])
    });
});

// ========== НОВАЯ ЛОГИКА ПОДАРКОВ ==========
bot.action(/^buy_gift_(\d+)$/, async (ctx) => {
    const idx = ctx.match[1];
    const pkg = PRICES[idx];
    const userId = ctx.from.id.toString();
    
    const { data: s } = await supabase.from('vpn_subs').select('balance').eq('tg_chat_id', userId).maybeSingle();
    
    if (!s || s.balance < pkg.price) {
        return ctx.editMessageText(
            `⚠️ <b>Недостаточно средств на балансе!</b>\n\n` +
            `💰 Ваш баланс: ${s?.balance || 0}₽\n` +
            `💎 Стоимость подарка: ${pkg.price}₽\n\n` +
            `Выберите способ оплаты:`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('💳 Оплатить картой (FreeKassa)', `gift_fk_${idx}`)],
                    [Markup.button.callback('💵 Пополнить баланс', 'topup_menu')],
                    [Markup.button.callback('⬅️ Назад', `buy_select_${idx}`)]
                ])
            }
        );
    }
    
    await ctx.editMessageText(
        `🎁 <b>Подарок другу</b>\n\n` +
        `📦 Тариф: Обход + Впн\n` +
        `⏳ Срок: ${pkg.days} дней\n` +
        `💰 Спишется с баланса: ${pkg.price}₽\n` +
        `💳 Ваш баланс: ${s.balance}₽\n\n` +
        `<i>После создания вы получите ссылку-подарок, которую можно отправить другу</i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Подтвердить и оплатить', `gift_confirm_${idx}`)],
                [Markup.button.callback('💳 Оплатить картой вместо баланса', `gift_fk_${idx}`)],
                [Markup.button.callback('⬅️ Назад', `buy_select_${idx}`)]
            ])
        }
    );
});

bot.action(/^gift_confirm_(\d+)$/, async (ctx) => {
    const idx = ctx.match[1];
    const pkg = PRICES[idx];
    const userId = ctx.from.id.toString();
    
    const { data: s } = await supabase.from('vpn_subs').select('balance').eq('tg_chat_id', userId).maybeSingle();
    
    if (!s || s.balance < pkg.price) {
        await ctx.answerCbQuery('❌ Недостаточно средств!', { show_alert: true });
        return ctx.editMessageText(
            `⚠️ <b>Недостаточно средств!</b>\n\nБаланс: ${s?.balance || 0}₽\nНужно: ${pkg.price}₽`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('💳 Оплатить картой', `gift_fk_${idx}`)],
                    [Markup.button.callback('💵 Пополнить баланс', 'topup_menu')],
                    [Markup.button.callback('⬅️ Назад', `buy_gift_${idx}`)]
                ])
            }
        );
    }
    
    await supabase.from('vpn_subs').update({ balance: s.balance - pkg.price }).eq('tg_chat_id', userId);
    
    const code = `GIFT_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    await supabase.from('promocodes').insert([{ 
        code: code, 
        tariff_type: 'both', 
        days: pkg.days, 
        max_uses: 1, 
        bonus_rub: 0, 
        used_count: 0 
    }]);
    
    const botInfo = await ctx.telegram.getMe();
    const giftLink = `https://t.me/${botInfo.username}?start=${code}`;
    
    await ctx.editMessageText(
        `✅ <b>Подарок успешно создан!</b>\n\n` +
        `💰 С баланса списано: ${pkg.price}₽\n` +
        `💳 Остаток на балансе: ${s.balance - pkg.price}₽\n\n` +
        `🎁 <b>Ссылка-подарок:</b>\n` +
        `<code>${giftLink}</code>\n\n` +
        `<i>Отправь эту ссылку другу. При активации он получит ${pkg.days} дней подписки!</i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.url('📤 Поделиться ссылкой', `https://t.me/share/url?url=${encodeURIComponent(giftLink)}&text=${encodeURIComponent('🎁 Дарю тебе подписку на Psychosis VPN!')}`)],
                [Markup.button.callback('👤 В профиль', 'back_to_profile')],
                [Markup.button.callback('🛒 В магазин', 'buy_menu_back')]
            ])
        }
    );
});

bot.action(/^gift_fk_(\d+)$/, async (ctx) => {
    const idx = ctx.match[1];
    const pkg = PRICES[idx];
    const orderId = `GIFT_${ctx.from.id}_${idx}_${Date.now()}`;
    const link = generateFkLink(pkg.price, orderId);
    
    userStates[ctx.from.id] = { 
        action: 'waiting_gift_payment',
        giftIdx: idx,
        orderId: orderId
    };
    
    const sent = await ctx.editMessageText(
        `🎁 <b>Оплата подарка: ${pkg.price}₽</b>\n\n` +
        `После оплаты подарок будет создан автоматически.\n` +
        `Сообщение удалится через 5 минут или после оплаты.`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.url('💳 Перейти к оплате', link)],
                [Markup.button.callback('⬅️ Назад', `buy_gift_${idx}`)]
            ])
        }
    );

    await savePaymentMsg(orderId, ctx.from.id, sent.message_id);
    setTimeout(() => safeDelete(ctx.from.id, sent.message_id), 300000);
});

// ========== КОНЕЦ НОВОЙ ЛОГИКИ ПОДАРКОВ ==========

// --- АДМИН-ПАНЕЛЬ ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    await safeDelete(ctx);
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('🎁 Подарки', 'admin_create_gift_menu')],
        [Markup.button.callback('📢 Рассылка', 'global_msg'), Markup.button.callback('📊 Статистика', 'admin_stats')]
    ]);
    await ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

bot.action('admin_menu_back', async (ctx) => {
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('🎁 Подарки', 'admin_create_gift_menu')],
        [Markup.button.callback('📢 Рассылка', 'global_msg'), Markup.button.callback('📊 Статистика', 'admin_stats')]
    ]);
    await ctx.editMessageText('<b>🛠 Панель управления</b>', { parse_mode: 'HTML', ...kb });
});

bot.action('admin_stats', async (ctx) => {
    const { data: allUsers } = await supabase.from('vpn_subs').select('id, expires_at, tariff_type, balance');
    const today = new Date().toISOString().split('T')[0];
    const activeUsers = (allUsers || []).filter(u => u.expires_at && u.expires_at > today).length;
    const totalBalance = (allUsers || []).reduce((sum, u) => sum + (u.balance || 0), 0);
    const { data: promos } = await supabase.from('promocodes').select('id');
    
    await ctx.editMessageText(
        `📊 <b>Статистика</b>\n\n` +
        `👥 Всего юзеров: <b>${allUsers?.length || 0}</b>\n` +
        `✅ Активных подписок: <b>${activeUsers}</b>\n` +
        `💰 Общий баланс: <b>${totalBalance}₽</b>\n` +
        `🎟 Активных промо: <b>${promos?.length || 0}</b>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_menu_back')]]) }
    );
});

// Создание подарков (Админ)
bot.action('admin_create_gift_menu', (ctx) => {
    ctx.editMessageText('<b>Тип подарка:</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⏳ Дни подписки', 'adm_gift_type_days'), Markup.button.callback('💰 Рубли', 'adm_gift_type_rub')],
            [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]
        ])
    });
});

bot.action('adm_gift_type_days', (ctx) => { 
    userStates[ctx.from.id] = { action: 'admin_gift_days_create', msgId: ctx.callbackQuery.message.message_id }; 
    ctx.editMessageText('Сколько дней подписки?', Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_menu_back')]])); 
});

bot.action('adm_gift_type_rub', (ctx) => { 
    userStates[ctx.from.id] = { action: 'admin_gift_rub_create', msgId: ctx.callbackQuery.message.message_id }; 
    ctx.editMessageText('Сумма пополнения (₽)?', Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_menu_back')]])); 
});

// ========== ОБНОВЛЁННЫЙ БЛОК ПРОМОКОДОВ (С РЕДАКТИРОВАНИЕМ) ==========

// Промокоды (Админ) - список
bot.action('admin_promo_list', async (ctx) => {
    await cleanupExpiredPromos();
    const { data: promos } = await supabase.from('promocodes').select('*');
    const buttons = (promos || []).map(p => [Markup.button.callback(`${p.code} (${p.used_count}/${p.max_uses})`, `manage_promo_${p.id}`)]);
    buttons.push([Markup.button.callback('➕ Создать новый', 'admin_promo_add')]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    await ctx.editMessageText('<b>Управление промокодами:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

// Создание нового промокода
bot.action('admin_promo_add', (ctx) => {
    userStates[ctx.from.id] = { action: 'adm_promo_step1', msgId: ctx.callbackQuery.message.message_id };
    ctx.editMessageText('Название для промокода?\n\n<i>Пример: SUMMER2025, NEW_USER, VIP</i>', { 
        parse_mode: 'HTML', 
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_promo_list')]]) 
    });
});

// Управление конкретным промокодом (просмотр)
bot.action(/^manage_promo_(.+)$/, async (ctx) => {
    const promoId = ctx.match[1];
    const { data: p } = await supabase.from('promocodes').select('*').eq('id', promoId).single();
    const botInfo = await ctx.telegram.getMe();
    const promoLink = `https://t.me/${botInfo.username}?start=${p.code}`;
    
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Редактировать', `promo_edit_${p.id}`)],
        [Markup.button.callback('🔄 Обнулить', `promo_reset_${p.id}`), Markup.button.callback('🗑 Удалить', `promo_del_${p.id}`)],
        [Markup.button.callback('📋 Копировать ссылку', `promo_copy_${p.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_promo_list')]
    ]);
    
    await ctx.editMessageText(
        `🎟 <b>${p.code}</b>\n\n` +
        `📊 <b>Статистика:</b>\n` +
        `├ Использовано: ${p.used_count}/${p.max_uses}\n` +
        `├ Даёт дней: ${p.days}\n` +
        `├ Рублей на баланс: ${p.bonus_rub || 0}₽\n` +
        `└ Тариф: ${TARIFF_MAP[p.tariff_type]}\n\n` +
        `🔗 <b>Ссылка:</b>\n<code>${promoLink}</code>`,
        { parse_mode: 'HTML', ...kb }
    );
});

// Копирование ссылки промокода
bot.action(/^promo_copy_(.+)$/, async (ctx) => {
    const promoId = ctx.match[1];
    const { data: p } = await supabase.from('promocodes').select('code').eq('id', promoId).single();
    const botInfo = await ctx.telegram.getMe();
    const promoLink = `https://t.me/${botInfo.username}?start=${p.code}`;
    
    await ctx.answerCbQuery('✅ Ссылка скопирована! (см. сообщение выше)', { show_alert: true });
    
    await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ <i>Ссылка скопирована в буфер обмена!</i>',
        { 
            parse_mode: 'HTML', 
            ...Markup.inlineKeyboard(ctx.callbackQuery.message.reply_markup.inline_keyboard)
        }
    );
});

// ========== РЕДАКТИРОВАНИЕ ПРОМОКОДА ==========
bot.action(/^promo_edit_(.+)$/, async (ctx) => {
    const promoId = ctx.match[1];
    const { data: p } = await supabase.from('promocodes').select('*').eq('id', promoId).single();
    
    userStates[ctx.from.id] = { 
        action: 'promo_edit_menu', 
        promoId: promoId,
        promoData: p,
        msgId: ctx.callbackQuery.message.message_id 
    };
    
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback(`📝 Название: ${p.code}`, 'promo_edit_name')],
        [Markup.button.callback(`📅 Дни: ${p.days}`, 'promo_edit_days')],
        [Markup.button.callback(`💰 Рубли: ${p.bonus_rub || 0}₽`, 'promo_edit_rub')],
        [Markup.button.callback(`🔢 Макс. активаций: ${p.max_uses}`, 'promo_edit_max_uses')],
        [Markup.button.callback(`💎 Тариф: ${TARIFF_MAP[p.tariff_type]}`, 'promo_edit_tariff')],
        [Markup.button.callback('✅ Сохранить и выйти', `manage_promo_${promoId}`)],
        [Markup.button.callback('❌ Отменить', `manage_promo_${promoId}`)]
    ]);
    
    await ctx.editMessageText(
        `✏️ <b>Редактирование промокода</b>\n\n` +
        `<code>${p.code}</code>\n\n` +
        `<i>Выберите, что хотите изменить:</i>`,
        { parse_mode: 'HTML', ...kb }
    );
});

// Редактирование названия
bot.action('promo_edit_name', async (ctx) => {
    const state = userStates[ctx.from.id];
    if (!state) return ctx.answerCbQuery('Ошибка состояния');
    
    state.action = 'promo_edit_name_input';
    await ctx.editMessageText(
        `📝 <b>Текущее название:</b> <code>${state.promoData.code}</code>\n\n` +
        `Введите новое название для промокода:`,
        { 
            parse_mode: 'HTML', 
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]])
        }
    );
});

// Редактирование дней
bot.action('promo_edit_days', async (ctx) => {
    const state = userStates[ctx.from.id];
    if (!state) return ctx.answerCbQuery('Ошибка состояния');
    
    state.action = 'promo_edit_days_input';
    await ctx.editMessageText(
        `📅 <b>Текущее количество дней:</b> ${state.promoData.days}\n\n` +
        `Введите новое количество дней (0 - если только рубли):`,
        { 
            parse_mode: 'HTML', 
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]])
        }
    );
});

// Редактирование рублей
bot.action('promo_edit_rub', async (ctx) => {
    const state = userStates[ctx.from.id];
    if (!state) return ctx.answerCbQuery('Ошибка состояния');
    
    state.action = 'promo_edit_rub_input';
    await ctx.editMessageText(
        `💰 <b>Текущая сумма на баланс:</b> ${state.promoData.bonus_rub || 0}₽\n\n` +
        `Введите новую сумму в рублях (0 - если только дни):`,
        { 
            parse_mode: 'HTML', 
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]])
        }
    );
});

// Редактирование максимальных активаций
bot.action('promo_edit_max_uses', async (ctx) => {
    const state = userStates[ctx.from.id];
    if (!state) return ctx.answerCbQuery('Ошибка состояния');
    
    state.action = 'promo_edit_max_uses_input';
    await ctx.editMessageText(
        `🔢 <b>Текущее макс. активаций:</b> ${state.promoData.max_uses}\n` +
        `📊 <b>Использовано:</b> ${state.promoData.used_count}\n\n` +
        `Введите новое максимальное количество активаций:`,
        { 
            parse_mode: 'HTML', 
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]])
        }
    );
});

// Редактирование тарифа
bot.action('promo_edit_tariff', async (ctx) => {
    const state = userStates[ctx.from.id];
    if (!state) return ctx.answerCbQuery('Ошибка состояния');
    
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Обход + Впн', 'promo_set_tariff_both')],
        [Markup.button.callback('Обход', 'promo_set_tariff_white')],
        [Markup.button.callback('Базовый Впн', 'promo_set_tariff_base')],
        [Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]
    ]);
    
    await ctx.editMessageText(
        `💎 <b>Текущий тариф:</b> ${TARIFF_MAP[state.promoData.tariff_type]}\n\n` +
        `Выберите новый тариф:`,
        { parse_mode: 'HTML', ...kb }
    );
});

// Установка тарифа
bot.action(/^promo_set_tariff_(.+)$/, async (ctx) => {
    const state = userStates[ctx.from.id];
    if (!state) return ctx.answerCbQuery('Ошибка состояния');
    
    const newTariff = ctx.match[1];
    state.promoData.tariff_type = newTariff;
    
    await ctx.answerCbQuery(`✅ Тариф изменён на: ${TARIFF_MAP[newTariff]}`);
    
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback(`📝 Название: ${state.promoData.code}`, 'promo_edit_name')],
        [Markup.button.callback(`📅 Дни: ${state.promoData.days}`, 'promo_edit_days')],
        [Markup.button.callback(`💰 Рубли: ${state.promoData.bonus_rub || 0}₽`, 'promo_edit_rub')],
        [Markup.button.callback(`🔢 Макс. активаций: ${state.promoData.max_uses}`, 'promo_edit_max_uses')],
        [Markup.button.callback(`💎 Тариф: ${TARIFF_MAP[state.promoData.tariff_type]}`, 'promo_edit_tariff')],
        [Markup.button.callback('✅ Сохранить и выйти', `manage_promo_${state.promoId}`)],
        [Markup.button.callback('❌ Отменить', `manage_promo_${state.promoId}`)]
    ]);
    
    await ctx.editMessageText(
        `✏️ <b>Редактирование промокода</b>\n\n` +
        `<code>${state.promoData.code}</code>\n\n` +
        `<i>Выберите, что хотите изменить:</i>`,
        { parse_mode: 'HTML', ...kb }
    );
});

// Обнуление промокода
bot.action(/^promo_reset_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').update({ used_count: 0 }).eq('id', ctx.match[1]);
    await supabase.from('promo_activations').delete().eq('promo_id', ctx.match[1]);
    ctx.answerCbQuery('✅ Использования обнулены');
    
    const { data: p } = await supabase.from('promocodes').select('*').eq('id', ctx.match[1]).single();
    const botInfo = await ctx.telegram.getMe();
    const promoLink = `https://t.me/${botInfo.username}?start=${p.code}`;
    
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Редактировать', `promo_edit_${p.id}`)],
        [Markup.button.callback('🔄 Обнулить', `promo_reset_${p.id}`), Markup.button.callback('🗑 Удалить', `promo_del_${p.id}`)],
        [Markup.button.callback('📋 Копировать ссылку', `promo_copy_${p.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_promo_list')]
    ]);
    
    await ctx.editMessageText(
        `🎟 <b>${p.code}</b>\n\n` +
        `📊 <b>Статистика:</b>\n` +
        `├ Использовано: ${p.used_count}/${p.max_uses}\n` +
        `├ Даёт дней: ${p.days}\n` +
        `├ Рублей на баланс: ${p.bonus_rub || 0}₽\n` +
        `└ Тариф: ${TARIFF_MAP[p.tariff_type]}\n\n` +
        `🔗 <b>Ссылка:</b>\n<code>${promoLink}</code>`,
        { parse_mode: 'HTML', ...kb }
    );
});

// Удаление промокода
bot.action(/^promo_del_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    ctx.answerCbQuery('✅ Промокод удалён');
    
    await cleanupExpiredPromos();
    const { data: promos } = await supabase.from('promocodes').select('*');
    const buttons = (promos || []).map(p => [Markup.button.callback(`${p.code} (${p.used_count}/${p.max_uses})`, `manage_promo_${p.id}`)]);
    buttons.push([Markup.button.callback('➕ Создать новый', 'admin_promo_add')]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    await ctx.editMessageText('<b>Управление промокодами:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

// ========== КОНЕЦ БЛОКА ПРОМОКОДОВ ==========

// Управление юзерами (Админ)
bot.action('admin_users', (ctx) => renderUsersList(ctx, 0));
bot.action(/^admin_users_page_(\d+)$/, (ctx) => renderUsersList(ctx, parseInt(ctx.match[1])));

bot.action(/^manage_user_(.+)$/, async (ctx) => {
    const { data: u } = await supabase.from('vpn_subs').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('💰 Баланс', `adm_add_bal_${u.id}`), Markup.button.callback('💎 Тариф', `adm_sel_trf_${u.id}`)],
        [Markup.button.callback('💬 Написать', `msg_user_${u.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    await ctx.editMessageText(
        `<b>Юзер:</b> ${u.internal_name}\n<b>До:</b> ${formatDate(u.expires_at)}\n<b>Баланс:</b> ${u.balance || 0}₽\n<b>Тариф:</b> ${TARIFF_MAP[u.tariff_type]}`, 
        { parse_mode: 'HTML', ...kb }
    );
});

bot.action(/^adm_add_bal_(.+)$/, (ctx) => { 
    userStates[ctx.from.id] = { action: 'add_balance_manual', targetId: ctx.match[1], msgId: ctx.callbackQuery.message.message_id }; 
    ctx.editMessageText('Сумма для начисления?', Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `manage_user_${ctx.match[1]}`)]])); 
});

bot.action(/^msg_user_(.+)$/, (ctx) => { 
    userStates[ctx.from.id] = { action: 'msg_single_user', targetId: ctx.match[1], msgId: ctx.callbackQuery.message.message_id }; 
    ctx.editMessageText('Текст сообщения:', Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `manage_user_${ctx.match[1]}`)]])); 
});

bot.action(/^adm_sel_trf_(.+)$/, async (ctx) => {
    const uid = ctx.match[1];
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Обход + Впн', `trf_step_${uid}_both`)],
        [Markup.button.callback('Обход', `trf_step_${uid}_white`)],
        [Markup.button.callback('Базовый Впн', `trf_step_${uid}_base`)],
        [Markup.button.callback('⬅️ Назад', `manage_user_${uid}`)]
    ]);
    await ctx.editMessageText('<b>Выберите тариф:</b>', { parse_mode: 'HTML', ...kb });
});

bot.action(/^trf_step_(.+?)_(.+)$/, async (ctx) => {
    userStates[ctx.from.id] = { 
        action: 'adm_set_days', 
        targetId: ctx.match[1], 
        tariff: ctx.match[2], 
        msgId: ctx.callbackQuery.message.message_id 
    };
    await ctx.editMessageText('На сколько дней установить?', Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `manage_user_${ctx.match[1]}`)]]));
});

bot.action('admin_servers_list', async (ctx) => {
    const { data: servers } = await supabase.from('vpn_servers').select('id, name, country, speed');
    if (!servers || servers.length === 0) {
        return ctx.editMessageText('🖥️ <b>Нет серверов</b>', { 
            parse_mode: 'HTML', 
            ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_menu_back')]]) 
        });
    }
    const buttons = servers.map(s => [Markup.button.callback(`${s.name} (${s.country})`, `manage_srv_${s.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    await ctx.editMessageText('<b>🖥️ Список серверов:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action('global_msg', (ctx) => { 
    userStates[ctx.from.id] = { action: 'msg_all', msgId: ctx.callbackQuery.message.message_id }; 
    ctx.editMessageText('Текст рассылки:', Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_menu_back')]])); 
});

// --- STATE MACHINE (ОБРАБОТКА ТЕКСТА) ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates[userId];
    const input = ctx.message.text.trim();

    if (input === '🎟 Промокод') {
        await safeDelete(ctx);
        const kb = await ctx.reply('🎟 Введите промокод или подарок:', 
            Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_state')]]));
        userStates[userId] = { action: 'enter_promo', msgId: kb.message_id };
        return;
    }

    if (state) {
        await safeDelete(ctx);

        const editPrompt = async (text, kb = []) => {
            if (state.msgId) {
                await ctx.telegram.editMessageText(userId, state.msgId, null, text, { 
                    parse_mode: 'HTML', 
                    ...Markup.inlineKeyboard(kb) 
                }).catch(() => {});
            } else {
                await ctx.replyWithHTML(text, Markup.inlineKeyboard(kb));
            }
        };

        // --- ВВОД ПРОМОКОДА ---
        if (state.action === 'enter_promo') {
            delete userStates[userId];
            return await processPromoCode(ctx, userId, input, state.msgId);
        }

        // --- ПОПОЛНЕНИЕ СВОЕГО БАЛАНСА ---
        if (state.action === 'topup_amount_self') {
            const amount = parseInt(input);
            if (isNaN(amount) || amount < 10) {
                return editPrompt('❌ Минимальная сумма — 10₽. Введите корректную сумму:', 
                    [[Markup.button.callback('❌ Отмена', 'topup_menu')]]);
            }
            const orderId = `BILL_${userId}_${Date.now()}`;
            const link = generateFkLink(amount, orderId);
            
            await editPrompt(
                `💳 <b>Пополнение своего баланса на ${amount}₽</b>\n\nСообщение удалится через 5 минут или после оплаты.`, 
                [[Markup.button.url('💳 Перейти к оплате', link)], [Markup.button.callback('👤 В профиль', 'back_to_profile')]]
            );
            
            await savePaymentMsg(orderId, userId, state.msgId);
            setTimeout(() => safeDelete(userId, state.msgId), 300000);
            delete userStates[userId];
            return;
        }

        // --- ПОКУПКА ПОДАРОЧНОЙ КАРТЫ НА РУБЛИ ---
        if (state.action === 'topup_amount_gift') {
            const amount = parseInt(input);
            if (isNaN(amount) || amount < 10) {
                return editPrompt('❌ Минимальная сумма — 10₽. Введите корректную сумму:', 
                    [[Markup.button.callback('❌ Отмена', 'topup_menu')]]);
            }
            const orderId = `GIFTRUB_${userId}_${Date.now()}`;
            const link = generateFkLink(amount, orderId);
            
            await editPrompt(
                `🎁 <b>Покупка подарочной карты на ${amount}₽</b>\n\n` +
                `После оплаты вы получите ссылку-подарок, которую можно отправить другу.\n` +
                `При активации друг получит ${amount}₽ на баланс.\n\n` +
                `Сообщение удалится через 5 минут или после оплаты.`,
                [[Markup.button.url('💳 Перейти к оплате', link)], [Markup.button.callback('⬅️ Назад', 'topup_menu')]]
            );
            
            await savePaymentMsg(orderId, userId, state.msgId);
            setTimeout(() => safeDelete(userId, state.msgId), 300000);
            delete userStates[userId];
            return;
        }

        // --- РЕДАКТИРОВАНИЕ ПРОМОКОДОВ (ВВОД ТЕКСТА) ---
        if (state.action === 'promo_edit_name_input') {
            const newName = input.toUpperCase().substring(0, 30);
            
            const { data: existing } = await supabase.from('promocodes')
                .select('id')
                .eq('code', newName)
                .neq('id', state.promoId)
                .maybeSingle();
                
            if (existing) {
                return editPrompt(
                    `❌ Промокод <b>${newName}</b> уже существует!\n\nВведите другое название:`,
                    [[Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]]
                );
            }
            
            state.promoData.code = newName;
            await supabase.from('promocodes').update({ code: newName }).eq('id', state.promoId);
            
            await ctx.answerCbQuery('✅ Название обновлено').catch(() => {});
            
            state.action = 'promo_edit_menu';
            const kb = Markup.inlineKeyboard([
                [Markup.button.callback(`📝 Название: ${state.promoData.code}`, 'promo_edit_name')],
                [Markup.button.callback(`📅 Дни: ${state.promoData.days}`, 'promo_edit_days')],
                [Markup.button.callback(`💰 Рубли: ${state.promoData.bonus_rub || 0}₽`, 'promo_edit_rub')],
                [Markup.button.callback(`🔢 Макс. активаций: ${state.promoData.max_uses}`, 'promo_edit_max_uses')],
                [Markup.button.callback(`💎 Тариф: ${TARIFF_MAP[state.promoData.tariff_type]}`, 'promo_edit_tariff')],
                [Markup.button.callback('✅ Сохранить и выйти', `manage_promo_${state.promoId}`)],
                [Markup.button.callback('❌ Отменить', `manage_promo_${state.promoId}`)]
            ]);
            
            await editPrompt(
                `✏️ <b>Редактирование промокода</b>\n\n` +
                `<code>${state.promoData.code}</code>\n\n` +
                `<i>Выберите, что хотите изменить:</i>`,
                kb
            );
            return;
        }
        
        if (state.action === 'promo_edit_days_input') {
            const days = parseInt(input);
            if (isNaN(days) || days < 0) {
                return editPrompt(
                    '❌ Введите корректное число дней (0 или больше):',
                    [[Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]]
                );
            }
            
            state.promoData.days = days;
            await supabase.from('promocodes').update({ days: days }).eq('id', state.promoId);
            
            await ctx.answerCbQuery('✅ Дни обновлены').catch(() => {});
            
            state.action = 'promo_edit_menu';
            const kb = Markup.inlineKeyboard([
                [Markup.button.callback(`📝 Название: ${state.promoData.code}`, 'promo_edit_name')],
                [Markup.button.callback(`📅 Дни: ${state.promoData.days}`, 'promo_edit_days')],
                [Markup.button.callback(`💰 Рубли: ${state.promoData.bonus_rub || 0}₽`, 'promo_edit_rub')],
                [Markup.button.callback(`🔢 Макс. активаций: ${state.promoData.max_uses}`, 'promo_edit_max_uses')],
                [Markup.button.callback(`💎 Тариф: ${TARIFF_MAP[state.promoData.tariff_type]}`, 'promo_edit_tariff')],
                [Markup.button.callback('✅ Сохранить и выйти', `manage_promo_${state.promoId}`)],
                [Markup.button.callback('❌ Отменить', `manage_promo_${state.promoId}`)]
            ]);
            
            await editPrompt(
                `✏️ <b>Редактирование промокода</b>\n\n` +
                `<code>${state.promoData.code}</code>\n\n` +
                `<i>Выберите, что хотите изменить:</i>`,
                kb
            );
            return;
        }
        
        if (state.action === 'promo_edit_rub_input') {
            const rub = parseInt(input);
            if (isNaN(rub) || rub < 0) {
                return editPrompt(
                    '❌ Введите корректную сумму (0 или больше):',
                    [[Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]]
                );
            }
            
            state.promoData.bonus_rub = rub;
            await supabase.from('promocodes').update({ bonus_rub: rub }).eq('id', state.promoId);
            
            await ctx.answerCbQuery('✅ Рубли обновлены').catch(() => {});
            
            state.action = 'promo_edit_menu';
            const kb = Markup.inlineKeyboard([
                [Markup.button.callback(`📝 Название: ${state.promoData.code}`, 'promo_edit_name')],
                [Markup.button.callback(`📅 Дни: ${state.promoData.days}`, 'promo_edit_days')],
                [Markup.button.callback(`💰 Рубли: ${state.promoData.bonus_rub || 0}₽`, 'promo_edit_rub')],
                [Markup.button.callback(`🔢 Макс. активаций: ${state.promoData.max_uses}`, 'promo_edit_max_uses')],
                [Markup.button.callback(`💎 Тариф: ${TARIFF_MAP[state.promoData.tariff_type]}`, 'promo_edit_tariff')],
                [Markup.button.callback('✅ Сохранить и выйти', `manage_promo_${state.promoId}`)],
                [Markup.button.callback('❌ Отменить', `manage_promo_${state.promoId}`)]
            ]);
            
            await editPrompt(
                `✏️ <b>Редактирование промокода</b>\n\n` +
                `<code>${state.promoData.code}</code>\n\n` +
                `<i>Выберите, что хотите изменить:</i>`,
                kb
            );
            return;
        }
        
        if (state.action === 'promo_edit_max_uses_input') {
            const maxUses = parseInt(input);
            if (isNaN(maxUses) || maxUses < 1) {
                return editPrompt(
                    '❌ Введите число от 1 до 1000000:',
                    [[Markup.button.callback('❌ Отмена', `promo_edit_${state.promoId}`)]]
                );
            }
            
            if (maxUses < state.promoData.used_count) {
                await supabase.from('promo_activations').delete().eq('promo_id', state.promoId);
                state.promoData.used_count = 0;
            }
            
            state.promoData.max_uses = maxUses;
            await supabase.from('promocodes').update({ 
                max_uses: maxUses,
                used_count: maxUses < state.promoData.used_count ? 0 : state.promoData.used_count
            }).eq('id', state.promoId);
            
            await ctx.answerCbQuery('✅ Макс. активаций обновлено').catch(() => {});
            
            state.action = 'promo_edit_menu';
            const kb = Markup.inlineKeyboard([
                [Markup.button.callback(`📝 Название: ${state.promoData.code}`, 'promo_edit_name')],
                [Markup.button.callback(`📅 Дни: ${state.promoData.days}`, 'promo_edit_days')],
                [Markup.button.callback(`💰 Рубли: ${state.promoData.bonus_rub || 0}₽`, 'promo_edit_rub')],
                [Markup.button.callback(`🔢 Макс. активаций: ${state.promoData.max_uses}`, 'promo_edit_max_uses')],
                [Markup.button.callback(`💎 Тариф: ${TARIFF_MAP[state.promoData.tariff_type]}`, 'promo_edit_tariff')],
                [Markup.button.callback('✅ Сохранить и выйти', `manage_promo_${state.promoId}`)],
                [Markup.button.callback('❌ Отменить', `manage_promo_${state.promoId}`)]
            ]);
            
            await editPrompt(
                `✏️ <b>Редактирование промокода</b>\n\n` +
                `<code>${state.promoData.code}</code>\n\n` +
                `<i>Выберите, что хотите изменить:</i>`,
                kb
            );
            return;
        }

        // --- ПРОМОКОДЫ (Пошагово) ---
        if (state.action === 'adm_promo_step1') {
            state.promo_name = input.toUpperCase().substring(0, 30);
            state.action = 'adm_promo_step2';
            return editPrompt(`Промокод: ${state.promo_name}\n\nСколько дней подписки? (0 если только рубли)`, 
                [[Markup.button.callback('❌ Отмена', 'admin_promo_list')]]);
        }
        if (state.action === 'adm_promo_step2') {
            state.promo_days = parseInt(input) || 0;
            state.action = 'adm_promo_step3';
            return editPrompt('Макс. активаций для кода? (1-1000)', 
                [[Markup.button.callback('❌ Отмена', 'admin_promo_list')]]);
        }
        if (state.action === 'adm_promo_step3') {
            state.promo_uses = Math.max(1, parseInt(input) || 1);
            state.action = 'adm_promo_step4';
            return editPrompt('Рублей на баланс? (0 если только дни)', 
                [[Markup.button.callback('❌ Отмена', 'admin_promo_list')]]);
        }
        if (state.action === 'adm_promo_step4') {
            const rub = parseInt(input) || 0;
            await supabase.from('promocodes').insert([{ 
                code: state.promo_name, days: state.promo_days, max_uses: state.promo_uses, 
                bonus_rub: rub, tariff_type: 'both', used_count: 0 
            }]);
            const botInfo = await ctx.telegram.getMe();
            await editPrompt(
                `✅ <b>Промокод создан!</b>\n\n<code>https://t.me/${botInfo.username}?start=${state.promo_name}</code>`, 
                [[Markup.button.callback('⬅️ К списку', 'admin_promo_list')]]
            );
            delete userStates[userId];
            return;
        }

        // --- ПОДАРКИ ---
        if (state.action === 'admin_gift_days_create') {
            const customName = `GIFT_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            await supabase.from('promocodes').insert([{ 
                code: customName, days: parseInt(input), max_uses: 1, bonus_rub: 0, tariff_type: 'both', used_count: 0 
            }]);
            const botInfo = await ctx.telegram.getMe();
            await editPrompt(
                `🎁 <b>Подарок создан!</b>\n\n<code>https://t.me/${botInfo.username}?start=${customName}</code>`, 
                [[Markup.button.callback('⬅️ Назад', 'admin_create_gift_menu')]]
            );
            delete userStates[userId];
            return;
        }
        if (state.action === 'admin_gift_rub_create') {
            const customName = `GIFT_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            await supabase.from('promocodes').insert([{ 
                code: customName, days: 0, max_uses: 1, bonus_rub: parseInt(input), tariff_type: 'none', used_count: 0 
            }]);
            const botInfo = await ctx.telegram.getMe();
            await editPrompt(
                `🎁 <b>Подарок (₽) создан!</b>\n\n<code>https://t.me/${botInfo.username}?start=${customName}</code>`, 
                [[Markup.button.callback('⬅️ Назад', 'admin_create_gift_menu')]]
            );
            delete userStates[userId];
            return;
        }
        
        // --- ЮЗЕРЫ (АДМИН) ---
        if (state.action === 'add_balance_manual') {
            const amount = parseInt(input);
            if (isNaN(amount) || amount <= 0) return editPrompt('Введите число > 0');
            const { data: u } = await supabase.from('vpn_subs').select('balance').eq('id', state.targetId).single();
            await supabase.from('vpn_subs').update({ balance: (u.balance || 0) + amount }).eq('id', state.targetId);
            await editPrompt(`✅ Добавлено ${amount}₽`, [[Markup.button.callback('⬅️ К юзеру', `manage_user_${state.targetId}`)]]);
            delete userStates[userId];
            return;
        }
        if (state.action === 'adm_set_days') {
            const days = parseInt(input);
            if (isNaN(days) || days <= 0) return editPrompt('Введите число > 0');
            const newDate = addDaysToDate('2000-01-01', days);
            await supabase.from('vpn_subs').update({ 
                expires_at: newDate, 
                tariff_type: state.tariff, 
                profile_title: 'Psychosis VPN | Premium' 
            }).eq('id', state.targetId);
            await editPrompt(
                `✅ Подписка установлена: ${TARIFF_MAP[state.tariff]} до ${formatDate(newDate)}`, 
                [[Markup.button.callback('⬅️ К юзеру', `manage_user_${state.targetId}`)]]
            );
            delete userStates[userId];
            return;
        }
        if (state.action === 'msg_single_user') {
            const { data: u } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', state.targetId).single();
            try { 
                await bot.telegram.sendMessage(u.tg_chat_id, `✉️ <b>Сообщение от администрации:</b>\n\n${input}`, { parse_mode: 'HTML' }); 
                await editPrompt('✅ Отправлено.', [[Markup.button.callback('⬅️ К юзеру', `manage_user_${state.targetId}`)]]);
            } catch(e) { 
                await editPrompt('❌ Ошибка отправки.', [[Markup.button.callback('⬅️ К юзеру', `manage_user_${state.targetId}`)]]);
            }
            delete userStates[userId];
            return;
        }
        if (state.action === 'msg_all') {
            const { data: users } = await supabase.from('vpn_subs').select('tg_chat_id');
            let count = 0;
            for (const u of users || []) { 
                try { 
                    await bot.telegram.sendMessage(u.tg_chat_id, `📢 <b>Объявление:</b>\n\n${input}`, { parse_mode: 'HTML' }); 
                    count++; 
                } catch(e) {} 
            }
            await editPrompt(
                `✅ Рассылка завершена: доставлено ${count} пользователям.`, 
                [[Markup.button.callback('⬅️ В админку', 'admin_menu_back')]]
            );
            delete userStates[userId];
            return;
        }

        return;
    }

    return next();
});

// --- КОМАНДЫ ---
bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const p = ctx.message.text.split('/add_promo ')[1]?.split('|').map(x => x.trim());
    if (!p || p.length < 5) return ctx.reply('Формат: /add_promo КОД | ТАРИФ | ДНИ | КОЛ_ВО | РУБЛИ');
    await supabase.from('promocodes').insert([{ 
        code: p[0], tariff_type: p[1], days: parseInt(p[2]), 
        max_uses: parseInt(p[3]), bonus_rub: parseInt(p[4]), used_count: 0 
    }]);
    ctx.reply(`✅ Промокод ${p[0]} создан.`);
});

bot.command('balance', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('balance, expires_at').eq('tg_chat_id', userId).maybeSingle();
    if (!s) return ctx.reply('Сначала нажмите /start');
    ctx.replyWithHTML(`💰 <b>Баланс:</b> ${s.balance || 0}₽\n🕗 <b>Подписка до:</b> ${formatDate(s.expires_at)}`);
});

bot.command('setbalance', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply('/setbalance USER_ID AMOUNT');
    const userId = args[1];
    const amount = parseInt(args[2]);
    await supabase.from('vpn_subs').update({ balance: amount }).eq('tg_chat_id', userId);
    ctx.reply(`✅ Баланс юзера ${userId} установлен в ${amount}₽`);
});

// --- VERCEL WEBHOOK + ОБРАБОТКА ОПЛАТ FREEKASSA ---
module.exports = async (req, res) => {
    if (req.method === 'POST' && req.query.fk_webhook === '1') {
        const { MERCHANT_ID, AMOUNT, MERCHANT_ORDER_ID, SIGN } = req.body;
        
        const checkSign = crypto.createHash('md5').update(`${FK_ID}:${AMOUNT}:${FK_KEY2}:${MERCHANT_ORDER_ID}`).digest('hex');
        
        if (SIGN === checkSign) {
            const { data: payLog } = await supabase.from('payment_messages')
                .select('*')
                .eq('order_id', MERCHANT_ORDER_ID)
                .maybeSingle();
                
            if (payLog) {
                await bot.telegram.deleteMessage(payLog.chat_id, payLog.message_id).catch(() => {});
                await supabase.from('payment_messages').delete().eq('order_id', MERCHANT_ORDER_ID);
            }

            const orderParts = MERCHANT_ORDER_ID.split('_'); 
            const tgId = orderParts[1];

            if (orderParts[0] === 'BILL') {
                const { data: u } = await supabase.from('vpn_subs').select('balance').eq('tg_chat_id', tgId).single();
                if (u) {
                    await supabase.from('vpn_subs').update({ balance: (u.balance || 0) + parseFloat(AMOUNT) }).eq('tg_chat_id', tgId);
                    await bot.telegram.sendMessage(tgId, `💰 <b>Баланс пополнен на ${AMOUNT}₽!</b>\n\nСпасибо за оплату!`, { parse_mode: 'HTML' });
                }
            } 
            else if (orderParts[0] === 'SUB') {
                const pkg = PRICES[orderParts[2]];
                const { data: u } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', tgId).single();
                if (u) {
                    const newDate = addDaysToDate(u.expires_at, pkg.days);
                    await supabase.from('vpn_subs').update({ 
                        expires_at: newDate, 
                        tariff_type: 'both',
                        profile_title: 'Psychosis VPN | Premium'
                    }).eq('tg_chat_id', tgId);
                    await bot.telegram.sendMessage(tgId, `💎 <b>Оплата принята!</b>\n\nПодписка продлена до: ${formatDate(newDate)}\nСпасибо за покупку!`, { parse_mode: 'HTML' });
                }
            }
            else if (orderParts[0] === 'GIFT') {
                const pkg = PRICES[orderParts[2]];
                
                const code = `GIFT_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                await supabase.from('promocodes').insert([{ 
                    code: code, 
                    tariff_type: 'both', 
                    days: pkg.days, 
                    max_uses: 1, 
                    bonus_rub: 0, 
                    used_count: 0 
                }]);
                
                const botInfo = await bot.telegram.getMe();
                const giftLink = `https://t.me/${botInfo.username}?start=${code}`;
                
                await bot.telegram.sendMessage(
                    tgId, 
                    `✅ <b>Оплата подарка получена!</b>\n\n` +
                    `🎁 <b>Ваша ссылка-подарок:</b>\n` +
                    `<code>${giftLink}</code>\n\n` +
                    `<i>Отправьте эту ссылку другу! При активации он получит ${pkg.days} дней подписки.</i>`,
                    { 
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            [Markup.button.url('📤 Поделиться', `https://t.me/share/url?url=${encodeURIComponent(giftLink)}&text=${encodeURIComponent('🎁 Дарю тебе подписку на Psychosis VPN!')}`)]
                        ])
                    }
                );
            }
            // ========== ОБРАБОТКА ПОДАРОЧНЫХ КАРТ НА РУБЛИ ==========
            else if (orderParts[0] === 'GIFTRUB') {
                const rubAmount = parseFloat(AMOUNT);
                
                const code = `GIFTRUB_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                await supabase.from('promocodes').insert([{ 
                    code: code, 
                    tariff_type: 'none', 
                    days: 0, 
                    max_uses: 1, 
                    bonus_rub: rubAmount, 
                    used_count: 0 
                }]);
                
                const botInfo = await bot.telegram.getMe();
                const giftLink = `https://t.me/${botInfo.username}?start=${code}`;
                
                await bot.telegram.sendMessage(
                    tgId, 
                    `✅ <b>Подарочная карта оплачена!</b>\n\n` +
                    `🎁 <b>Номинал:</b> ${rubAmount}₽\n\n` +
                    `🔗 <b>Ссылка-подарок:</b>\n` +
                    `<code>${giftLink}</code>\n\n` +
                    `<i>Отправьте эту ссылку другу! При активации он получит ${rubAmount}₽ на баланс.</i>`,
                    { 
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            [Markup.button.url('📤 Поделиться', `https://t.me/share/url?url=${encodeURIComponent(giftLink)}&text=${encodeURIComponent(`🎁 Дарю тебе ${rubAmount}₽ на баланс Psychosis VPN!`)}`)]
                        ])
                    }
                );
            }
            // ========== КОНЕЦ ОБРАБОТКИ ПОДАРОЧНЫХ КАРТ ==========
            return res.status(200).send('YES');
        }
        return res.status(400).send('Wrong sign');
    }

    try { 
        if (req.method === 'POST') await bot.handleUpdate(req.body); 
    } 
    catch (e) { 
        console.error('Error:', e); 
    } 
    finally { 
        res.status(200).send('OK'); 
    }
};
