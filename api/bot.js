const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {};
const TELEGRAM_ADMIN = '@aure_ember';

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

async function getMainMenu(ctx) {
    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);
    return Markup.keyboard(buttons).resize();
}

function generateGiftCode() {
    return 'GIFT_' + Math.random().toString(36).substring(2, 12).toUpperCase();
}

// --- ФУНКЦИЯ АКТИВАЦИИ ПРОМОКОДА / ПОДАРКА ---
async function processPromoCode(ctx, userId, code) {
    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', code).maybeSingle();
    if (!promo) return ctx.reply('❌ Такого промокода или подарка не существует.');
    
    const { data: sub } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId.toString()).maybeSingle();
    if (!sub) return ctx.reply('❌ Сначала запустите бота через /start');

    if (promo.used_count >= promo.max_uses) return ctx.reply('❌ Этот код уже был использован максимальное количество раз.');
    
    const { data: used } = await supabase.from('promo_activations').select('id').eq('user_id', sub.id).eq('promo_id', promo.id).maybeSingle();
    if (used) return ctx.reply('❌ Вы уже активировали этот код.');

    if (promo.bonus_rub && promo.bonus_rub > 0) {
        await supabase.from('vpn_subs').update({ balance: (sub.balance || 0) + promo.bonus_rub }).eq('id', sub.id);
        await ctx.replyWithHTML(`🎉 <b>Активировано!</b>\nНа баланс: <b>${promo.bonus_rub}₽</b>`);
    } else {
        const newDate = addDaysToDate(sub.expires_at, promo.days);
        await supabase.from('vpn_subs').update({ 
            expires_at: newDate, 
            tariff_type: promo.tariff_type || 'both', 
            profile_title: 'Psychosis VPN | Premium' 
        }).eq('id', sub.id);
        await ctx.replyWithHTML(`🎉 <b>Активировано!</b>\nДобавлено: <b>${promo.days} дн.</b>\nДо: <b>${formatDate(newDate)}</b>`);
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
    
    await ctx.reply('Psychosis VPN запущен!', await getMainMenu(ctx));

    if (ctx.payload) {
        await processPromoCode(ctx, userId, ctx.payload);
    }
});

// --- ПРОФИЛЬ ---
bot.hears('👤 Профиль', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    const today = new Date().toISOString().split('T')[0];
    const isExpired = !s || s.expires_at === '2000-01-01' || s.expires_at < today;
    const subUrl = `https://psychosisvpn.vercel.app/api/get_sub?id=${s?.id}`;
    
    const report = `👤 Профиль: <b>${s?.internal_name || ctx.from.first_name}</b>\n💰 Баланс: <b>${s?.balance || 0}₽</b>\n🕗 До: <b>${isExpired ? '-' : formatDate(s.expires_at)}</b>\n💎 Тариф: <b>${isExpired ? 'Нету' : (TARIFF_MAP[s.tariff_type] || 'Нету')}</b>\n\n🔗 <code>${subUrl}</code>`;
    
    const inlineButtons = [[Markup.button.callback('💳 Пополнить баланс', 'topup_init')]];
    if (!s?.test_used && (isExpired || s?.tariff_type === 'none')) {
        inlineButtons.push([Markup.button.callback('🎁 Взять тест-период (5 дн.)', 'activate_test_profile')]);
    }
    inlineButtons.push([Markup.button.callback('🎟 Ввести промокод', 'enter_promo_inline')]);
    await ctx.replyWithHTML(report, Markup.inlineKeyboard(inlineButtons));
});

bot.action('topup_init', async (ctx) => {
    ctx.answerCbQuery();
    const adminUsername = TELEGRAM_ADMIN.replace('@', '');
    ctx.replyWithHTML(`💳 <b>Пополнение</b>\nНапиши админу: <code>${TELEGRAM_ADMIN}</code>`, Markup.inlineKeyboard([[Markup.button.url('💬 Написать', `https://t.me/${adminUsername}`)]]));
});

bot.action('activate_test_profile', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    if (user?.test_used) return ctx.answerCbQuery('❌ Тест уже был использован!', { show_alert: true });
    const newDate = addDaysToDate('2000-01-01', 5); 
    await supabase.from('vpn_subs').update({ tariff_type: 'both', expires_at: newDate, profile_title: 'Psychosis VPN | TEST', test_used: true }).eq('tg_chat_id', userId);
    ctx.answerCbQuery('✅ Тест активирован!');
    ctx.reply('✅ Тестовый период (5 дней) активирован!');
});

bot.action('enter_promo_inline', (ctx) => {
    ctx.reply('🎟 Введите промокод или подарок:');
    ctx.answerCbQuery();
});

// --- ПОКУПКА ---
bot.hears('💎 Покупка', async (ctx) => {
    const buttons = PRICES.map((p, i) => [Markup.button.callback(p.label, `buy_select_${i}`)]);
    buttons.push([Markup.button.callback('💳 Пополнить баланс', 'topup_init')]);
    ctx.replyWithHTML('<b>Выберите период:</b>', Markup.inlineKeyboard(buttons));
});

bot.action(/^buy_select_(\d+)$/, async (ctx) => {
    const idx = ctx.match[1];
    ctx.editMessageText(`Вы выбрали: <b>${PRICES[idx].label}</b>\nЧто сделать?`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Купить себе', `buy_confirm_${idx}`)],
            [Markup.button.callback('🎁 Купить в подарок', `buy_gift_${idx}`)],
            [Markup.button.callback('⬅️ Назад', 'buy_menu_back')]
        ])
    });
});

bot.action('buy_menu_back', async (ctx) => {
    const buttons = PRICES.map((p, i) => [Markup.button.callback(p.label, `buy_select_${i}`)]);
    ctx.editMessageText('<b>Выберите период:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^buy_confirm_(\d+)$/, async (ctx) => {
    const pkg = PRICES[ctx.match[1]];
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    if (s.balance < pkg.price) return ctx.answerCbQuery('❌ Недостаточно средств!', { show_alert: true });
    const newDate = addDaysToDate(s.expires_at, pkg.days);
    await supabase.from('vpn_subs').update({ balance: s.balance - pkg.price, expires_at: newDate, tariff_type: 'both' }).eq('id', s.id);
    ctx.editMessageText(`✅ Успешно! Активно до: ${formatDate(newDate)}`);
});

bot.action(/^buy_gift_(\d+)$/, async (ctx) => {
    const pkg = PRICES[ctx.match[1]];
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    if (s.balance < pkg.price) return ctx.answerCbQuery('❌ Недостаточно средств!', { show_alert: true });
    await supabase.from('vpn_subs').update({ balance: s.balance - pkg.price }).eq('id', s.id);
    const code = generateGiftCode();
    await supabase.from('promocodes').insert([{ code: code, tariff_type: 'both', days: pkg.days, max_uses: 1, bonus_rub: 0, used_count: 0 }]);
    const botInfo = await ctx.telegram.getMe();
    ctx.editMessageText(`🎁 <b>Подарок создан!</b>\n\nСсылка:\n<code>https://t.me/${botInfo.username}?start=${code}</code>`, { parse_mode: 'HTML' });
});

// --- АДМИН-ПАНЕЛЬ ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('🎁 Создать подарок', 'admin_create_gift_menu')],
        [Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

bot.action('admin_menu_back', async (ctx) => {
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('🎁 Создать подарок', 'admin_create_gift_menu')],
        [Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    await ctx.editMessageText('<b>🛠 Панель управления</b>', { parse_mode: 'HTML', ...kb });
});

// --- СОЗДАНИЕ ПОДАРКОВ (АДМИН) ---
bot.action('admin_create_gift_menu', (ctx) => {
    ctx.editMessageText('<b>Тип подарка:</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⏳ Дни подписки', 'adm_gift_type_days'), Markup.button.callback('💰 Рубли', 'adm_gift_type_rub')],
            [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]
        ])
    });
});

bot.action('adm_gift_type_days', (ctx) => { userStates[ctx.from.id] = { action: 'admin_gift_days_create' }; ctx.reply('Введите кол-во дней:'); ctx.answerCbQuery(); });
bot.action('adm_gift_type_rub', (ctx) => { userStates[ctx.from.id] = { action: 'admin_gift_rub_create' }; ctx.reply('Введите сумму (₽):'); ctx.answerCbQuery(); });

// --- СОЗДАНИЕ ПРОМОКОДОВ (ИНТЕРАКТИВНО) ---
bot.action('admin_promo_add', (ctx) => {
    userStates[ctx.from.id] = { action: 'adm_promo_step1' };
    ctx.reply('Введите название промокода (например: SUMMER):');
    ctx.answerCbQuery();
});

bot.action('admin_promo_list', async (ctx) => {
    const { data: promos } = await supabase.from('promocodes').select('*');
    const buttons = (promos || []).map(p => [Markup.button.callback(`${p.code} (${p.used_count}/${p.max_uses})`, `manage_promo_${p.id}`)]);
    buttons.push([Markup.button.callback('➕ Создать новый', 'admin_promo_add')]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('<b>Управление промокодами:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_promo_(.+)$/, async (ctx) => {
    const { data: p } = await supabase.from('promocodes').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🗑 Удалить', `promo_del_${p.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_promo_list')]
    ]);
    ctx.editMessageText(`🎟 <b>${p.code}</b>\nДает: ${p.days} дн. / ${p.bonus_rub}₽\nЮзов: ${p.used_count}/${p.max_uses}`, { parse_mode: 'HTML', ...kb });
});

bot.action(/^promo_del_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    ctx.answerCbQuery('Удалено');
    ctx.editMessageText('✅ Промокод удален.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_promo_list')]]));
});

// --- УПРАВЛЕНИЕ ЮЗЕРАМИ ---
bot.action('admin_users', async (ctx) => {
    const { data: users } = await supabase.from('vpn_subs').select('id, internal_name').limit(30);
    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    await ctx.editMessageText('<b>Список юзеров:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_user_(.+)$/, async (ctx) => {
    const { data: u } = await supabase.from('vpn_subs').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('💰 Баланс', `adm_add_bal_${u.id}`), Markup.button.callback('💎 Тариф', `adm_sel_trf_${u.id}`)],
        [Markup.button.callback('💬 Написать', `msg_user_${u.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    ctx.editMessageText(`<b>Юзер:</b> ${u.internal_name}\n<b>До:</b> ${formatDate(u.expires_at)}\n<b>Баланс:</b> ${u.balance}₽`, { parse_mode: 'HTML', ...kb });
});

bot.action(/^adm_add_bal_(.+)$/, (ctx) => { userStates[ctx.from.id] = { action: 'add_balance_manual', targetId: ctx.match[1] }; ctx.reply('Сколько начислить?'); });
bot.action(/^msg_user_(.+)$/, (ctx) => { userStates[ctx.from.id] = { action: 'msg_single_user', targetId: ctx.match[1] }; ctx.reply('Текст сообщения:'); });

bot.action(/^adm_sel_trf_(.+)$/, async (ctx) => {
    const uid = ctx.match[1];
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Обход и Впн', `trf_set_${uid}_both`), Markup.button.callback('Обход', `trf_set_${uid}_white`)],
        [Markup.button.callback('⬅️ Назад', `manage_user_${uid}`)]
    ]);
    ctx.editMessageText('Выберите тариф:', kb);
});

bot.action(/^trf_set_(.+?)_(.+)$/, async (ctx) => {
    userStates[ctx.from.id] = { action: 'adm_set_days', targetId: ctx.match[1], tariff: ctx.match[2] };
    ctx.reply('На сколько дней установить подписку?');
});

bot.action('admin_servers_list', async (ctx) => {
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const buttons = (servers || []).map(s => [Markup.button.callback(s.name, `manage_srv_${s.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('<b>Список серверов:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action('global_msg', (ctx) => { userStates[ctx.from.id] = { action: 'msg_all' }; ctx.reply('Введите текст рассылки:'); });

// --- STATE MACHINE (ОБРАБОТКА ТЕКСТА) ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates[userId];
    const input = ctx.message.text.trim();

    if (state) {
        // --- Логика создания ПРОМОКОДА (Пошагово) ---
        if (state.action === 'adm_promo_step1') {
            state.promo_name = 'PROMOCODE_' + input;
            state.action = 'adm_promo_step2';
            return ctx.reply('Сколько дней подписки давать? (0 если только рубли)');
        }
        if (state.action === 'adm_promo_step2') {
            state.promo_days = parseInt(input) || 0;
            state.action = 'adm_promo_step3';
            return ctx.reply('Макс. кол-во активаций?');
        }
        if (state.action === 'adm_promo_step3') {
            state.promo_uses = parseInt(input) || 1;
            state.action = 'adm_promo_step4';
            return ctx.reply('Сколько рублей давать на баланс? (0 если только дни)');
        }
        if (state.action === 'adm_promo_step4') {
            const rub = parseInt(input) || 0;
            await supabase.from('promocodes').insert([{ 
                code: state.promo_name, days: state.promo_days, max_uses: state.promo_uses, bonus_rub: rub, tariff_type: 'both', used_count: 0 
            }]);
            const botInfo = await ctx.telegram.getMe();
            ctx.replyWithHTML(`✅ <b>Промокод создан!</b>\n\nСсылка:\n<code>https://t.me/${botInfo.username}?start=${state.promo_name}</code>`);
            delete userStates[userId]; return;
        }

        // --- Логика ПОДАРКОВ ---
        if (state.action === 'admin_gift_days_create') {
            const code = generateGiftCode();
            await supabase.from('promocodes').insert([{ code: code, days: parseInt(input), max_uses: 1, bonus_rub: 0, tariff_type: 'both', used_count: 0 }]);
            const botInfo = await ctx.telegram.getMe();
            ctx.replyWithHTML(`🎁 <b>Подарок создан!</b>\n\nСсылка:\n<code>https://t.me/${botInfo.username}?start=${code}</code>`);
        }
        else if (state.action === 'admin_gift_rub_create') {
            const code = generateGiftCode();
            await supabase.from('promocodes').insert([{ code: code, days: 0, max_uses: 1, bonus_rub: parseInt(input), tariff_type: 'none', used_count: 0 }]);
            const botInfo = await ctx.telegram.getMe();
            ctx.replyWithHTML(`🎁 <b>Подарок (₽) создан!</b>\n\nСсылка:\n<code>https://t.me/${botInfo.username}?start=${code}</code>`);
        }
        
        // --- АДМИН: ЮЗЕРЫ ---
        else if (state.action === 'add_balance_manual') {
            const { data: u } = await supabase.from('vpn_subs').select('balance').eq('id', state.targetId).single();
            await supabase.from('vpn_subs').update({ balance: (u.balance || 0) + parseInt(input) }).eq('id', state.targetId);
            ctx.reply('✅ Баланс обновлен.');
        }
        else if (state.action === 'adm_set_days') {
            const newDate = addDaysToDate('2000-01-01', input);
            await supabase.from('vpn_subs').update({ expires_at: newDate, tariff_type: state.tariff }).eq('id', state.targetId);
            ctx.reply(`✅ Тариф установлен до ${newDate}`);
        }
        else if (state.action === 'msg_single_user') {
            const { data: u } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', state.targetId).single();
            try { await bot.telegram.sendMessage(u.tg_chat_id, `✉️ Сообщение от администрации:\n\n${input}`); ctx.reply('✅ Отправлено.'); } catch(e) { ctx.reply('❌ Ошибка.'); }
        }
        else if (state.action === 'msg_all') {
            const { data: users } = await supabase.from('vpn_subs').select('tg_chat_id');
            let count = 0;
            for (const u of users) { try { await bot.telegram.sendMessage(u.tg_chat_id, `📢 Рассылка:\n\n${input}`); count++; } catch(e){} }
            ctx.reply(`✅ Рассылка завершена. Доставлено: ${count}`);
        }

        delete userStates[userId];
        return;
    }

    if (input === '🎟 Промокод') return ctx.reply('Введите промокод:');
    
    // Ручная активация (если просто прислали текст)
    await processPromoCode(ctx, userId, input);
    return next();
});

// Резервная команда для админов (оставил как ты хотел)
bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const p = ctx.message.text.split('/add_promo ')[1]?.split('|').map(x => x.trim());
    if (!p || p.length < 5) return ctx.reply('Формат: /add_promo КОД | both | ДНИ | КОЛ_ВО | РУБЛИ');
    await supabase.from('promocodes').insert([{ code: p[0], tariff_type: p[1], days: parseInt(p[2]), max_uses: parseInt(p[3]), bonus_rub: parseInt(p[4]), used_count: 0 }]);
    ctx.reply(`✅ Промокод ${p[0]} создан.`);
});

// --- VERCEL ---
module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); } 
    catch (e) { console.error('Error:', e); } 
    finally { res.status(200).send('OK'); }
};
