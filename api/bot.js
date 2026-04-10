const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076];
const userStates = {}; 

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

// --- ТЕСТОВЫЙ ПЕРИОД ---
bot.hears('🎁 Тест Период', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    const internalName = `Тест @${username}`;
    const { data: existing } = await supabase.from('vpn_subs').select('id').eq('internal_name', internalName).maybeSingle();
    
    if (existing) return ctx.reply('Вы уже использовали тест!', await getMainMenu(ctx));

    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 5);
    const dateStr = expDate.toISOString().split('T')[0];

    await supabase.from('vpn_subs').insert([{
        internal_name: internalName,
        tariff_type: 'both',
        expires_at: dateStr,
        profile_title: 'Psychosis VPN | TEST',
        tg_chat_id: ctx.from.id.toString()
    }]);

    const formattedDate = `${String(expDate.getMonth() + 1).padStart(2, '0')}.${String(expDate.getDate()).padStart(2, '0')}.${expDate.getFullYear()}`;

    ctx.replyWithMarkdownV2(
        `@${username}, тестовый период активирован\\.\n` +
        `Окончание: **${formattedDate}**\n` +
        `Тариф: **BOTH**`, 
        await getMainMenu(ctx)
    );
});

// --- ОБРАБОТКА СОСТОЯНИЙ (ВВОД ТЕКСТА) ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates[userId];

    if (state) {
        const input = ctx.message.text.trim();
        if (state.action === 'msg_all') {
            const { data: users } = await supabase.from('vpn_subs').select('tg_chat_id');
            for (const u of users) {
                if (u.tg_chat_id) try { await bot.telegram.sendMessage(u.tg_chat_id, input); } catch(e){}
            }
            ctx.reply('✅ Рассылка завершена.');
        } 
        else if (state.action === 'msg_single') {
            const { data: t } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', state.targetId).single();
            if (t?.tg_chat_id) await bot.telegram.sendMessage(t.tg_chat_id, `🔔 **Сообщение:**\n\n${input}`, { parse_mode: 'MarkdownV2' });
            ctx.reply('✅ Отправлено.');
        }
        else if (state.action === 'add_days_manual') {
            const { data: s } = await supabase.from('vpn_subs').select('expires_at').eq('id', state.targetId).single();
            const newDate = addDaysToDate(s.expires_at, input);
            await supabase.from('vpn_subs').update({ expires_at: newDate }).eq('id', state.targetId);
            ctx.reply(`✅ Добавлено ${input} дн.`);
        }
        else if (state.action === 'set_date_manual') {
            await supabase.from('vpn_subs').update({ expires_at: input }).eq('id', state.targetId);
            ctx.reply(`✅ Новая дата установлена: ${input}`);
        }
        else if (state.action === 'srv_add_step1') {
            userStates[userId] = { action: 'srv_add_step2', vless: input };
            return ctx.reply('Введите название сервера:');
        }
        else if (state.action === 'srv_add_step2') {
            await supabase.from('vpn_servers').insert([{ vless_url: state.vless, name: input, tariff_type: 'both' }]);
            ctx.reply('✅ Сервер добавлен.');
        }
        else if (state.action === 'give_days_all') {
            const { data: allSubs } = await supabase.from('vpn_subs').select('id, expires_at');
            for (const s of allSubs) {
                const newDate = addDaysToDate(s.expires_at, input);
                await supabase.from('vpn_subs').update({ expires_at: newDate }).eq('id', s.id);
            }
            ctx.reply(`✅ Всем добавлено ${input} дн.`);
        }
        delete userStates[userId]; return;
    }

    // Промокоды через обычный ввод
    const serviceButtons = ['👤 Профиль', '💎 Покупка', '🎟 Промокод', '🎁 Тест Период', '🛠 Админ-панель'];
    if (ctx.message.text.startsWith('/') || serviceButtons.includes(ctx.message.text)) return next();

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

// --- АДМИН ПАНЕЛЬ ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('📢 Рассылка', 'global_msg')],
        [Markup.button.callback('🎁 Дать всем дни', 'global_give_days')]
    ]);
    ctx.replyWithMarkdownV2('**🛠 Панель управления**', kb);
});

bot.action('admin_menu_back', async (ctx) => {
    await ctx.answerCbQuery();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('📢 Рассылка', 'global_msg')],
        [Markup.button.callback('🎁 Дать всем дни', 'global_give_days')]
    ]);
    await ctx.editMessageText('**🛠 Панель управления**', { parse_mode: 'MarkdownV2', ...kb });
});

bot.action('admin_users', async (ctx) => {
    await ctx.answerCbQuery();
    const { data: users, count } = await supabase.from('vpn_subs').select('id, internal_name', { count: 'exact' }).limit(20);
    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    
    await ctx.editMessageText(`**Список юзеров:**\n\nВсего юзеров: ${count || 0}`, { 
        parse_mode: 'MarkdownV2', 
        ...Markup.inlineKeyboard(buttons) 
    });
});

bot.action(/^manage_user_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const { data: u } = await supabase.from('vpn_subs').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Добавить дни', `add_days_ask_${u.id}`), Markup.button.callback('📅 Уст. дату', `set_date_ask_${u.id}`)],
        [Markup.button.callback('🗑 Удалить подписку', `del_sub_final_${u.id}`)],
        [Markup.button.callback('💬 Написать юзеру', `msg_user_${u.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    ctx.editMessageText(`**Юзер:** ${u.internal_name}\n**До:** ${u.expires_at}`, { parse_mode: 'MarkdownV2', ...kb });
});

bot.action(/^set_date_ask_(.+)$/, (ctx) => {
    ctx.answerCbQuery();
    userStates[ctx.from.id] = { action: 'set_date_manual', targetId: ctx.match[1] };
    ctx.reply('Введите новую дату в формате ГГГГ-ММ-ДД:');
});

bot.action(/^del_sub_final_(.+)$/, async (ctx) => {
    await supabase.from('vpn_subs').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.editMessageText('✅ Удалено.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_users')]]));
});

bot.action('admin_servers_list', async (ctx) => {
    await ctx.answerCbQuery();
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const buttons = servers.map(s => [Markup.button.callback(s.name, `manage_srv_${s.id}`)]);
    buttons.push([Markup.button.callback('➕ Добавить сервер', 'srv_add_new')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('**Сервера:**', { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_srv_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const { data: s } = await supabase.from('vpn_servers').select('*').eq('id', ctx.match[1]).single();
    ctx.editMessageText(`**Сервер:** ${s.name}\n\nVLESS: \`${s.vless_url.substring(0, 30)}...\``, {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([[Markup.button.callback('🗑 Удалить', `srv_del_${s.id}`)], [Markup.button.callback('⬅️ Назад', 'admin_servers_list')]])
    });
});

bot.action(/^srv_del_(.+)$/, async (ctx) => {
    await supabase.from('vpn_servers').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.editMessageText('✅ Сервер удален.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_servers_list')]]));
});

bot.action('admin_promo_list', async (ctx) => {
    await ctx.answerCbQuery();
    const { data: promos } = await supabase.from('promocodes').select('*');
    if (!promos?.length) return ctx.reply('Нет промокодов.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_menu_back')]]));
    for (const p of promos) {
        const kb = Markup.inlineKeyboard([[Markup.button.callback('🗑 Удалить', `del_promo_${p.id}`)]]);
        await ctx.reply(`🎟 ${p.code} | ${p.days}дн`, kb);
    }
    ctx.reply('Админ:', Markup.inlineKeyboard([[Markup.button.callback('➕ Создать', 'admin_add_promo_info')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]]));
});

bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add_promo ')[1]?.split('|').map(p => p.trim());
    if (!parts || parts.length < 4) return ctx.reply('Ошибка формата!');
    await supabase.from('promocodes').insert([{ code: parts[0], tariff_type: parts[1], days: parseInt(parts[2]), max_uses: parseInt(parts[3]), add_to_existing: true }]);
    ctx.reply('✅ Промокод создан.');
});

bot.action(/^del_promo_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.deleteMessage();
});

// Регистрация колбэков для ввода
bot.action('global_msg', (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'msg_all' }; ctx.reply('Текст рассылки:'); });
bot.action('global_give_days', (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'give_days_all' }; ctx.reply('Сколько дней добавить ВСЕМ?'); });
bot.action('srv_add_new', (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'srv_add_step1' }; ctx.reply('Пришлите VLESS ссылку:'); });
bot.action(/^add_days_ask_(.+)$/, (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'add_days_manual', targetId: ctx.match[1] }; ctx.reply('Сколько дней добавить?'); });
bot.action(/^msg_user_(.+)$/, (ctx) => { ctx.answerCbQuery(); userStates[ctx.from.id] = { action: 'msg_single', targetId: ctx.match[1] }; ctx.reply('Текст сообщения:'); });

// --- ПРОФИЛЬ ---
bot.hears('👤 Профиль', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    let { data: subs } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`);
    if (!subs || subs.length === 0) return ctx.reply('Подписок нет.');
    
    for (const s of subs) {
        await supabase.from('vpn_subs').update({ tg_chat_id: ctx.from.id.toString() }).eq('id', s.id);
        const d = new Date(s.expires_at);
        const formattedDate = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${d.getFullYear()}`;
        
        const report = `👤 Профиль: **@${username}**\n🕗 До: **${formattedDate}**\n💎 Тариф: **${(s.tariff_type || 'BOTH').toUpperCase()}**\n\n🔗 \`https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}\``;
        
        await ctx.replyWithMarkdownV2(report);
    }
});

bot.hears('🎟 Промокод', (ctx) => ctx.reply('Введите ваш промокод:'));
bot.hears('💎 Покупка', (ctx) => ctx.reply('Админ: @psychosisvpn'));

module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); res.status(200).send('OK'); }
    catch (e) { res.status(500).send('Error'); }
};
