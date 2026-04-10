const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {}; // Хранилище для ожидания текста сообщения

// --- МЕНЮ ---
async function getMainMenu(ctx) {
    const username = ctx.from.username || ctx.from.first_name;
    const { data: testExists } = await supabase.from('vpn_subs').select('id').eq('internal_name', `Тест @${username}`).maybeSingle();

    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (!testExists) buttons.push(['🎁 Тест Период']);
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);

    return Markup.keyboard(buttons).resize();
}

// --- СТАРТ ---
bot.start(async (ctx) => {
    const menu = await getMainMenu(ctx);
    ctx.replyWithHTML(`<b>Добро пожаловать в Psychosis VPN!</b>`, menu);
});

// --- ПРОФИЛЬ (С АВТО-ОБНОВЛЕНИЕМ ID) ---
bot.hears('👤 Профиль', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    let { data: subs } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`);
    
    if (ADMINS.includes(ctx.from.id)) {
        const { data: adminSub } = await supabase.from('vpn_subs').select('*').eq('internal_name', 'test').maybeSingle();
        if (adminSub) subs = [adminSub];
    }

    if (!subs || subs.length === 0) return ctx.reply('Подписок не найдено.');

    for (const s of subs) {
        // АВТО-ОБНОВЛЕНИЕ CHAT ID
        if (!s.tg_chat_id) {
            await supabase.from('vpn_subs').update({ tg_chat_id: ctx.from.id.toString() }).eq('id', s.id);
        }

        const dateObj = new Date(s.expires_at);
        const diffDays = Math.ceil((dateObj - new Date()) / (1000 * 60 * 60 * 24));
        const report = `👤 Ваш профиль: <b>@${username}</b>\n\n🎫 <b>${s.profile_title}</b>\n🕗 До: <code>${dateObj.toLocaleDateString('ru-RU')}</code> | <b>${diffDays > 0 ? diffDays : 0} дн.</b>\n🎮 Тариф: <code>${s.tariff_type.toUpperCase()}</code>\n\n🔗 <code>https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}</code>`;
        await ctx.replyWithHTML(report);
    }
});

// --- ЛОГИКА ТЕКСТА (ПРОМОКОДЫ + ОТПРАВКА СООБЩЕНИЙ) ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;

    // Если админ в режиме ожидания текста для отправки юзеру
    if (userStates[userId]?.action === 'waiting_msg') {
        const targetSubId = userStates[userId].targetId;
        const { data: target } = await supabase.from('vpn_subs').select('tg_chat_id, internal_name').eq('id', targetSubId).single();
        
        if (target?.tg_chat_id) {
            try {
                await bot.telegram.sendMessage(target.tg_chat_id, `🔔 <b>Сообщение от Psychosis VPN:</b>\n\n${ctx.message.text}`, { parse_mode: 'HTML' });
                ctx.reply(`✅ Сообщение отправлено пользователю ${target.internal_name}`);
            } catch (e) { ctx.reply('❌ Ошибка: пользователь заблокировал бота.'); }
        } else { ctx.reply('❌ У пользователя нет Chat ID.'); }
        
        delete userStates[userId];
        return;
    }

    // Обычная активация промокода
    const serviceButtons = ['👤 Профиль', '💎 Покупка', '🎟 Промокод', '🎁 Тест Период', '🛠 Админ-панель'];
    if (ctx.message.text.startsWith('/') || serviceButtons.includes(ctx.message.text)) return next();

    const inputCode = ctx.message.text.trim();
    const username = ctx.from.username || ctx.from.first_name;

    try {
        const { data: promo } = await supabase.from('promocodes').select('*').eq('code', inputCode).maybeSingle();
        if (!promo) return ctx.reply('❌ Промокод не найден.');
        if (promo.used_count >= promo.max_uses) return ctx.reply('❌ Промокод истек.');

        let { data: sub } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`).maybeSingle();
        
        let targetDate = new Date();
        if (sub && new Date(sub.expires_at) > targetDate && promo.add_to_existing) {
            targetDate = new Date(sub.expires_at);
        }
        targetDate.setDate(targetDate.getDate() + promo.days);
        const finalDate = targetDate.toISOString().split('T')[0];

        await supabase.from('vpn_subs').update({ 
            expires_at: finalDate, 
            tariff_type: promo.tariff_type,
            tg_chat_id: ctx.from.id.toString() 
        }).ilike('internal_name', `%${username}%`);

        await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);
        ctx.replyWithHTML(`<b>✅ Активировано!</b>\nТеперь до: <code>${targetDate.toLocaleDateString('ru-RU')}</code>`);
    } catch (e) { ctx.reply('Ошибка активации.'); }
});

// --- АДМИН-ПАНЕЛЬ ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Список юзеров', 'admin_users')],
        [Markup.button.callback('📊 Статистика', 'admin_stats'), Markup.button.callback('🖥 Сервера', 'admin_servers')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('➕ Создать промо', 'admin_add_promo_info')]
    ]);
    ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

bot.action('admin_menu', async (ctx) => {
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Список юзеров', 'admin_users')],
        [Markup.button.callback('📊 Статистика', 'admin_stats'), Markup.button.callback('🖥 Сервера', 'admin_servers')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('➕ Создать промо', 'admin_add_promo_info')]
    ]);
    await ctx.editMessageText('<b>🛠 Панель управления</b>', { parse_mode: 'HTML', ...kb });
});

// --- УПРАВЛЕНИЕ ЮЗЕРАМИ ---
bot.action('admin_users', async (ctx) => {
    const { data: users } = await supabase.from('vpn_subs').select('id, internal_name').limit(20);
    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu')]);
    await ctx.editMessageText('<b>👥 Выберите пользователя:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_user_(.+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('id', userId).single();
    
    const text = `<b>👤 Юзер:</b> ${user.internal_name}\n<b>📅 До:</b> <code>${user.expires_at}</code>\n<b>🎮 Тариф:</b> ${user.tariff_type.toUpperCase()}`;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('➕ 7 дней', `add_time_${user.id}_7`), Markup.button.callback('➕ 30 дней', `add_time_${user.id}_30`)],
        [Markup.button.callback('💬 Написать сообщение', `msg_user_${user.id}`)],
        [Markup.button.callback('💎 BOTH', `set_t_${user.id}_both`), Markup.button.callback('⚪️ WHITE', `set_t_${user.id}_white`)],
        [Markup.button.callback('⬅️ Назад к списку', 'admin_users')]
    ]);
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
});

// Логика добавления дней кнопками
bot.action(/^add_time_(.+)_(.+)$/, async (ctx) => {
    const [_, id, days] = ctx.match;
    const { data: user } = await supabase.from('vpn_subs').select('expires_at').eq('id', id).single();
    
    let newDate = new Date(user.expires_at);
    if (newDate < new Date()) newDate = new Date();
    newDate.setDate(newDate.getDate() + parseInt(days));
    
    await supabase.from('vpn_subs').update({ expires_at: newDate.toISOString().split('T')[0] }).eq('id', id);
    await ctx.answerCbQuery(`Добавлено ${days} дней`);
    // Возврат в карточку
    ctx.editMessageText(`✅ Обновлено! Новая дата: ${newDate.toISOString().split('T')[0]}`, 
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `manage_user_${id}`)]]));
});

// Логика "Написать сообщение"
bot.action(/^msg_user_(.+)$/, async (ctx) => {
    const subId = ctx.match[1];
    userStates[ctx.from.id] = { action: 'waiting_msg', targetId: subId };
    await ctx.answerCbQuery();
    ctx.reply('✍️ Введите текст сообщения для пользователя. Он получит его от имени бота.');
});

// Смена тарифа
bot.action(/^set_t_(.+)_(.+)$/, async (ctx) => {
    const [_, id, tariff] = ctx.match;
    await supabase.from('vpn_subs').update({ tariff_type: tariff }).eq('id', id);
    await ctx.answerCbQuery(`Тариф: ${tariff}`);
    ctx.editMessageText(`✅ Тариф изменен на ${tariff.toUpperCase()}`, 
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `manage_user_${id}`)]]));
});

// --- СЕРВЕРА И ПРОМО (С КНОПКАМИ НАЗАД) ---
bot.action('admin_servers', async (ctx) => {
    const { data: servers } = await supabase.from('vpn_servers').select('*').order('sort_index', { ascending: true });
    let list = '<b>🖥 Сервера:</b>\n\n';
    servers.forEach(s => list += `${s.tariff_type === 'base' ? '🔴' : '⚪️'} ${s.name}\n`);
    const kb = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_menu')]]);
    await ctx.editMessageText(list, { parse_mode: 'HTML', ...kb });
});

bot.action('admin_promo_list', async (ctx) => {
    const { data: promos } = await supabase.from('promocodes').select('*');
    if (!promos?.length) return ctx.reply('Промокодов нет.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_menu')]]));
    
    for (const p of promos) {
        const kb = Markup.inlineKeyboard([[Markup.button.callback('🗑 Удалить', `del_promo_${p.id}`)]]);
        await ctx.replyWithHTML(`🎟 <code>${p.code}</code> | ${p.days}дн | ${p.used_count}/${p.max_uses}`, kb);
    }
    ctx.reply('Конец списка', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_menu')]]));
});

bot.action(/^del_promo_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.deleteMessage();
});

bot.action('admin_add_promo_info', async (ctx) => {
    ctx.replyWithHTML('<b>Создать промо:</b>\n<code>/add_promo КОД | ТАРИФ | ДНИ | КОЛ-ВО | true/false</code>', 
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_menu')]]));
});

// Команда /add_promo
bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add_promo ')[1]?.split('|').map(p => p.trim());
    if (parts.length < 5) return ctx.reply('Ошибка формата!');
    await supabase.from('promocodes').insert([{ code: parts[0], tariff_type: parts[1], days: parseInt(parts[2]), max_uses: parseInt(parts[3]), add_to_existing: parts[4] === 'true' }]);
    ctx.reply(`✅ Промокод ${parts[0]} создан!`);
});

bot.hears('💎 Покупка', (ctx) => ctx.replyWithHTML('Свяжитесь с админом: @psychosisvpn'));

bot.hears('🎁 Тест Период', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    const expDate = new Date(); expDate.setDate(expDate.getDate() + 5);
    await supabase.from('vpn_subs').insert([{
        internal_name: `Тест @${username}`, tariff_type: 'both', 
        expires_at: expDate.toISOString().split('T')[0], profile_title: 'Psychosis VPN | TEST',
        tg_chat_id: ctx.from.id.toString()
    }]);
    ctx.reply('✅ Тест активирован!', await getMainMenu(ctx));
});

module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); res.status(200).send('OK'); }
    catch (e) { res.status(500).send('Error'); }
};
