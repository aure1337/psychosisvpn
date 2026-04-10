const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {}; 

// Хелпер для дат
function addDaysToDate(baseDateStr, days) {
    let baseDate = new Date(baseDateStr);
    let today = new Date();
    if (isNaN(baseDate.getTime()) || baseDate < today) baseDate = today;
    baseDate.setDate(baseDate.getDate() + parseInt(days));
    return baseDate.toISOString().split('T')[0];
}

async function getMainMenu(ctx) {
    const username = ctx.from.username || ctx.from.first_name;
    const { data: testExists } = await supabase.from('vpn_subs').select('id').eq('internal_name', `Тест @${username}`).maybeSingle();
    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (!testExists) buttons.push(['🎁 Тест Период']);
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);
    return Markup.keyboard(buttons).resize();
}

bot.start(async (ctx) => ctx.reply('Psychosis VPN запущен!', await getMainMenu(ctx)));

// --- ТЕСТОВЫЙ ПЕРИОД (ВОЗВРАЩЕН И УЛУЧШЕН) ---
bot.hears('🎁 Тест Период', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    const internalName = `Тест @${username}`;
    try {
        const { data: existing } = await supabase.from('vpn_subs').select('*').eq('internal_name', internalName).maybeSingle();
        if (existing) return ctx.reply('Вы уже использовали тест!', await getMainMenu(ctx));

        const expDate = new Date();
        expDate.setDate(expDate.getDate() + 5);
        const dateStr = expDate.toISOString().split('T')[0];
        
        await supabase.from('vpn_subs').insert([{
            internal_name: internalName,
            tariff_type: 'both',
            expires_at: dateStr,
            profile_title: 'Psychosis VPN | TEST',
            tg_chat_id: ctx.from.id.toString(),
            total_gb: 0
        }]);

        await ctx.replyWithHTML(
            `@${username}, тестовый период активирован.\n` +
            `Окончание: <b>${expDate.toLocaleDateString('ru-RU')}</b>\n` +
            `Тариф: <b>BOTH</b>`, 
            await getMainMenu(ctx)
        );
    } catch (e) { ctx.reply('Ошибка сервера.'); }
});

// --- ПРОФИЛЬ ---
bot.hears('👤 Профиль', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    let { data: subs } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`);
    if (ADMINS.includes(ctx.from.id)) {
        const { data: adminSub } = await supabase.from('vpn_subs').select('*').eq('internal_name', 'test').maybeSingle();
        if (adminSub) subs = [adminSub];
    }
    if (!subs || subs.length === 0) return ctx.reply('Подписок не найдено.');

    for (const s of subs) {
        await supabase.from('vpn_subs').update({ tg_chat_id: ctx.from.id.toString() }).eq('id', s.id);
        const dateObj = new Date(s.expires_at);
        const report = `👤 Профиль: <b>@${username}</b>\n🕗 До: <code>${dateObj.toLocaleDateString('ru-RU')}</code>\n🔗 <code>https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}</code>`;
        await ctx.replyWithHTML(report);
    }
});

// --- ОБРАБОТКА ТЕКСТА ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates[userId];

    if (state) {
        const input = ctx.message.text.trim();
        if (state.action === 'msg_single') {
            const { data: t } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', state.targetId).single();
            if (t?.tg_chat_id) await bot.telegram.sendMessage(t.tg_chat_id, `🔔 <b>Сообщение:</b>\n\n${input}`, { parse_mode: 'HTML' });
            ctx.reply('✅ Отправлено.');
        } 
        else if (state.action === 'msg_all') {
            const { data: users } = await supabase.from('vpn_subs').select('tg_chat_id');
            for (const u of users) {
                if (u.tg_chat_id) try { await bot.telegram.sendMessage(u.tg_chat_id, input); } catch(e){}
            }
            ctx.reply('✅ Рассылка завершена.');
        }
        else if (state.action === 'add_days_manual') {
            const { data: s } = await supabase.from('vpn_subs').select('expires_at').eq('id', state.targetId).single();
            const newDate = addDaysToDate(s.expires_at, input);
            await supabase.from('vpn_subs').update({ expires_at: newDate }).eq('id', state.targetId);
            ctx.reply(`✅ Добавлено! Новая дата: ${newDate}`);
        }
        else if (state.action === 'srv_add_step1') {
            userStates[userId] = { action: 'srv_add_step2', vless: input };
            return ctx.reply('Введите название сервера:');
        }
        else if (state.action === 'srv_add_step2') {
            await supabase.from('vpn_servers').insert([{ vless_url: state.vless, name: input, tariff_type: 'both' }]);
            ctx.reply('✅ Сервер добавлен.');
        }
        delete userStates[userId]; return;
    }

    const serviceButtons = ['👤 Профиль', '💎 Покупка', '🎟 Промокод', '🎁 Тест Период', '🛠 Админ-панель'];
    if (ctx.message.text.startsWith('/') || serviceButtons.includes(ctx.message.text)) return next();

    // Промокод
    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', ctx.message.text.trim()).maybeSingle();
    if (promo) {
        const username = ctx.from.username || ctx.from.first_name;
        let { data: sub } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`).maybeSingle();
        const newDate = addDaysToDate(sub ? sub.expires_at : new Date(), promo.days);
        if (sub) {
            await supabase.from('vpn_subs').update({ expires_at: newDate, tariff_type: promo.tariff_type }).eq('id', sub.id);
        } else {
            await supabase.from('vpn_subs').insert([{ internal_name: `User @${username}`, expires_at: newDate, tariff_type: promo.tariff_type, tg_chat_id: ctx.from.id.toString() }]);
        }
        ctx.reply(`✅ Активировано до ${newDate}`);
    }
});

// --- АДМИНКА ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

bot.action('admin_menu_back', async (ctx) => {
    await ctx.answerCbQuery();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    await ctx.editMessageText('<b>🛠 Панель управления</b>', { parse_mode: 'HTML', ...kb });
});

// Юзеры
bot.action('admin_users', async (ctx) => {
    await ctx.answerCbQuery();
    const { data: users } = await supabase.from('vpn_subs').select('id, internal_name').limit(20);
    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    await ctx.editMessageText('<b>Список юзеров:</b>', Markup.inlineKeyboard(buttons));
});

bot.action(/^manage_user_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const { data: u } = await supabase.from('vpn_subs').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Добавить дни', `add_days_ask_${u.id}`), Markup.button.callback('🗑 Удалить', `del_sub_${u.id}`)],
        [Markup.button.callback('💬 Написать', `msg_user_${u.id}`), Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    ctx.editMessageText(`<b>Юзер:</b> ${u.internal_name}\n<b>До:</b> ${u.expires_at}`, { parse_mode: 'HTML', ...kb });
});

bot.action(/^del_sub_(.+)$/, async (ctx) => {
    await supabase.from('vpn_subs').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.editMessageText('✅ Подписка удалена.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_users')]]));
});

// Сервера
bot.action('admin_servers_list', async (ctx) => {
    await ctx.answerCbQuery();
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const buttons = servers.map(s => [Markup.button.callback(s.name, `manage_srv_${s.id}`)]);
    buttons.push([Markup.button.callback('➕ Добавить сервер', 'srv_add_new')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('<b>Сервера:</b>', Markup.inlineKeyboard(buttons));
});

bot.action(/^manage_srv_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const { data: s } = await supabase.from('vpn_servers').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([[Markup.button.callback('🗑 Удалить', `srv_del_${s.id}`)], [Markup.button.callback('⬅️ Назад', 'admin_servers_list')]]);
    ctx.editMessageText(`<b>Сервер:</b> ${s.name}`, kb);
});

bot.action(/^srv_del_(.+)$/, async (ctx) => {
    await supabase.from('vpn_servers').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.editMessageText('✅ Сервер удален.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_servers_list')]]));
});

// Промокоды
bot.action('admin_promo_list', async (ctx) => {
    await ctx.answerCbQuery();
    const { data: promos } = await supabase.from('promocodes').select('*');
    if (!promos?.length) return ctx.reply('Нет промо.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_menu_back')]]));
    for (const p of promos) {
        const kb = Markup.inlineKeyboard([[Markup.button.callback('🗑 Удалить', `del_promo_${p.id}`)]]);
        await ctx.reply(`🎟 ${p.code} (${p.days} дн)`, kb);
    }
    ctx.reply('Управление:', Markup.inlineKeyboard([[Markup.button.callback('➕ Создать', 'admin_add_promo_info')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]]));
});

bot.action('admin_add_promo_info', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('Используй: /add_promo КОД | ТАРИФ | ДНИ | КОЛ-ВО | true');
});

bot.command('add_promo', async (ctx) => {
    const parts = ctx.message.text.split('/add_promo ')[1]?.split('|').map(p => p.trim());
    await supabase.from('promocodes').insert([{ code: parts[0], tariff_type: parts[1], days: parseInt(parts[2]), max_uses: parseInt(parts[3]), add_to_existing: true }]);
    ctx.reply('✅ Создан.');
});

bot.action(/^del_promo_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.deleteMessage();
});

// Вспомогательные экшены
bot.action('global_msg', (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'msg_all' }; ctx.reply('Текст рассылки:'); });
bot.action('srv_add_new', (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'srv_add_step1' }; ctx.reply('VLESS ссылку:'); });
bot.action(/^add_days_ask_(.+)$/, (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'add_days_manual', targetId: ctx.match[1] }; ctx.reply('Сколько дней?'); });
bot.action(/^msg_user_(.+)$/, (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'msg_single', targetId: ctx.match[1] }; ctx.reply('Текст сообщения:'); });

bot.hears('🎟 Промокод', (ctx) => ctx.reply('Введите код:'));
bot.hears('💎 Покупка', (ctx) => ctx.reply('Админ: @psychosisvpn'));

module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); res.status(200).send('OK'); }
    catch (e) { res.status(500).send('Error'); }
};
