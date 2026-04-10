const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {}; 

// Помощник для работы с датами (прибавление дней)
function addDaysToDate(baseDateStr, days) {
    let baseDate = new Date(baseDateStr);
    let today = new Date();
    // Если дата в прошлом или невалидна, берем "сегодня"
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

// --- ПРОФИЛЬ (С АВТО-ФИКСОМ ID) ---
bot.hears('👤 Профиль', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    let { data: subs } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`);
    
    if (ADMINS.includes(ctx.from.id)) {
        const { data: adminSub } = await supabase.from('vpn_subs').select('*').eq('internal_name', 'test').maybeSingle();
        if (adminSub) subs = [adminSub];
    }

    if (!subs || subs.length === 0) return ctx.reply('У вас нет активных подписок.');

    for (const s of subs) {
        if (!s.tg_chat_id) await supabase.from('vpn_subs').update({ tg_chat_id: ctx.from.id.toString() }).eq('id', s.id);
        
        const dateObj = new Date(s.expires_at);
        const diffDays = Math.ceil((dateObj - new Date()) / (1000 * 60 * 60 * 24));
        const report = `👤 Ваш профиль: <b>@${username}</b>\n\n🎫 <b>${s.profile_title}</b>\n🕗 До: <code>${dateObj.toLocaleDateString('ru-RU')}</code> | <b>${diffDays > 0 ? diffDays : 0} дн.</b>\n🎮 Тариф: <code>${s.tariff_type.toUpperCase()}</code>\n\n🔗 <code>https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}</code>`;
        await ctx.replyWithHTML(report);
    }
});

// --- ЛОГИКА ТЕКСТА (ОБРАБОТКА ВСЕХ ВВОДОВ) ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates[userId];

    if (state) {
        const input = ctx.message.text.trim();
        
        // 1. Личное сообщение
        if (state.action === 'msg_single') {
            const { data: target } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', state.targetId).single();
            if (target?.tg_chat_id) {
                await bot.telegram.sendMessage(target.tg_chat_id, `🔔 <b>Сообщение:</b>\n\n${input}`, { parse_mode: 'HTML' });
                ctx.reply('✅ Отправлено.');
            }
        } 
        // 2. Глобальная рассылка
        else if (state.action === 'msg_all') {
            const { data: users } = await supabase.from('vpn_subs').select('tg_chat_id');
            let count = 0;
            for (const u of users) {
                if (u.tg_chat_id) {
                    try { await bot.telegram.sendMessage(u.tg_chat_id, `📢 <b>Объявление:</b>\n\n${input}`, { parse_mode: 'HTML' }); count++; } catch(e){}
                }
            }
            ctx.reply(`✅ Рассылка завершена. Получили: ${count}`);
        }
        // 3. Установка даты вручную
        else if (state.action === 'set_date_manual') {
            await supabase.from('vpn_subs').update({ expires_at: input }).eq('id', state.targetId);
            ctx.reply(`✅ Дата установлена на ${input}`);
        }
        // 4. Прибавление дней всем
        else if (state.action === 'give_days_all') {
            const { data: allSubs } = await supabase.from('vpn_subs').select('id, expires_at');
            for (const s of allSubs) {
                const newDate = addDaysToDate(s.expires_at, input);
                await supabase.from('vpn_subs').update({ expires_at: newDate }).eq('id', s.id);
            }
            ctx.reply(`✅ Всем добавлено по ${input} дн.`);
        }
        // 5. Прибавление дней юзеру (ручное число)
        else if (state.action === 'add_days_manual') {
            const { data: s } = await supabase.from('vpn_subs').select('expires_at').eq('id', state.targetId).single();
            const newDate = addDaysToDate(s.expires_at, input);
            await supabase.from('vpn_subs').update({ expires_at: newDate }).eq('id', state.targetId);
            ctx.reply(`✅ Добавлено ${input} дн. Новая дата: ${newDate}`);
        }

        delete userStates[userId];
        return;
    }

    // Промокоды
    const serviceButtons = ['👤 Профиль', '💎 Покупка', '🎟 Промокод', '🎁 Тест Период', '🛠 Админ-панель'];
    if (ctx.message.text.startsWith('/') || serviceButtons.includes(ctx.message.text)) return next();

    const inputCode = ctx.message.text.trim();
    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', inputCode).maybeSingle();
    
    if (promo && promo.used_count < promo.max_uses) {
        const username = ctx.from.username || ctx.from.first_name;
        let { data: sub } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`).maybeSingle();
        
        const currentExp = sub ? sub.expires_at : new Date().toISOString();
        const newDate = addDaysToDate(currentExp, promo.days);

        if (sub) {
            await supabase.from('vpn_subs').update({ expires_at: newDate, tariff_type: promo.tariff_type, tg_chat_id: ctx.from.id.toString() }).eq('id', sub.id);
        } else {
            await supabase.from('vpn_subs').insert([{ internal_name: `User @${username}`, tariff_type: promo.tariff_type, expires_at: newDate, profile_title: 'Psychosis VPN | Premium', tg_chat_id: ctx.from.id.toString(), total_gb: 0 }]);
        }
        await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);
        ctx.replyWithHTML(`✅ Активировано! До: <code>${newDate}</code>`);
    } else {
        ctx.reply('❌ Неверный или истекший промокод.');
    }
});

// --- АДМИН ПАНЕЛЬ ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('📢 Рассылка', 'global_msg')],
        [Markup.button.callback('🎁 Дать всем дни', 'global_give_days')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('➕ Создать промо', 'admin_add_promo_info')],
        [Markup.button.callback('🖥 Сервера', 'admin_servers'), Markup.button.callback('📊 Стата', 'admin_stats')]
    ]);
    ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

bot.action('admin_users', async (ctx) => {
    const { data: users } = await supabase.from('vpn_subs').select('id, internal_name').limit(20);
    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    await ctx.editMessageText('<b>Выберите пользователя:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_user_(.+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('id', userId).single();
    const text = `<b>Юзер:</b> ${user.internal_name}\n<b>До:</b> <code>${user.expires_at}</code>\n<b>Тариф:</b> ${user.tariff_type.toUpperCase()}`;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Добавить дни', `add_days_ask_${user.id}`), Markup.button.callback('📅 Уст. дату', `set_date_ask_${user.id}`)],
        [Markup.button.callback('💬 Написать', `msg_user_${user.id}`), Markup.button.callback('🗑 Удалить', `del_sub_${user.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
});

// АДМИН-ЭКШЕНЫ (ВОПРОСЫ)
bot.action('global_msg', (ctx) => {
    userStates[ctx.from.id] = { action: 'msg_all' };
    ctx.reply('Введите текст рассылки для ВСЕХ пользователей:');
});

bot.action('global_give_days', (ctx) => {
    userStates[ctx.from.id] = { action: 'give_days_all' };
    ctx.reply('Сколько дней добавить ВСЕМ пользователям? (Введите число)');
});

bot.action(/^add_days_ask_(.+)$/, (ctx) => {
    userStates[ctx.from.id] = { action: 'add_days_manual', targetId: ctx.match[1] };
    ctx.reply('Сколько дней добавить этому юзеру?');
});

bot.action(/^set_date_ask_(.+)$/, (ctx) => {
    userStates[ctx.from.id] = { action: 'set_date_manual', targetId: ctx.match[1] };
    ctx.reply('Введите новую дату в формате ГГГГ-ММ-ДД:');
});

bot.action(/^msg_user_(.+)$/, (ctx) => {
    userStates[ctx.from.id] = { action: 'msg_single', targetId: ctx.match[1] };
    ctx.reply('Введите текст сообщения для юзера:');
});

bot.action('admin_menu_back', async (ctx) => {
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('📢 Рассылка', 'global_msg')],
        [Markup.button.callback('🎁 Дать всем дни', 'global_give_days')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('➕ Создать промо', 'admin_add_promo_info')],
        [Markup.button.callback('🖥 Сервера', 'admin_servers'), Markup.button.callback('📊 Стата', 'admin_stats')]
    ]);
    await ctx.editMessageText('<b>🛠 Панель управления</b>', { parse_mode: 'HTML', ...kb });
});

// (Остальной код: сервера, стата, промокоды) - оставляем логику из прошлых версий
bot.action('admin_stats', async (ctx) => {
    const { count } = await supabase.from('vpn_subs').select('*', { count: 'exact', head: true });
    ctx.reply(`Всего юзеров: ${count}`);
});

bot.hears('🎟 Промокод', (ctx) => ctx.reply('Введите ваш промокод:'));
bot.hears('💎 Покупка', (ctx) => ctx.reply('Админ: @psychosisvpn'));

module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); res.status(200).send('OK'); }
    catch (e) { res.status(500).send('Error'); }
};
