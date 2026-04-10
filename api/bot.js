const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

async function getMainMenu(ctx) {
    const username = ctx.from.username || ctx.from.first_name;
    const { data: testExists } = await supabase
        .from('vpn_subs')
        .select('id')
        .eq('internal_name', `Тест @${username}`)
        .maybeSingle();

    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (!testExists) buttons.push(['🎁 Тест Период']);
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);

    return Markup.keyboard(buttons).resize();
}

// --- ОБРАБОТЧИКИ КОМАНД ---

bot.start(async (ctx) => {
    const menu = await getMainMenu(ctx);
    return ctx.replyWithHTML(`<b>Добро пожаловать в Psychosis VPN!</b>`, menu);
});

// Кнопка ТЕСТ ПЕРИОД
bot.hears('🎁 Тест Период', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    const internalName = `Тест @${username}`;
    try {
        const { data: existing } = await supabase.from('vpn_subs').select('*').eq('internal_name', internalName).maybeSingle();
        if (existing) return ctx.reply('Вы уже использовали тест!', await getMainMenu(ctx));

        const expDate = new Date();
        expDate.setDate(expDate.getDate() + 5);
        
        const { data, error } = await supabase.from('vpn_subs').insert([{
            internal_name: internalName,
            tariff_type: 'both',
            expires_at: expDate.toISOString().split('T')[0],
            profile_title: 'Psychosis VPN | TEST',
            total_gb: 0,
            tg_chat_id: ctx.from.id.toString()
        }]).select().single();

        if (error) throw error;
        await ctx.replyWithHTML(`<b>✅ Тест активирован!</b>`, await getMainMenu(ctx));
    } catch (e) { ctx.reply('Ошибка сервера.'); }
});

// Кнопка ПРОФИЛЬ
bot.hears('👤 Профиль', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    let subs = [];
    
    if (ADMINS.includes(ctx.from.id)) {
        const { data: adminSub } = await supabase.from('vpn_subs').select('*').eq('internal_name', 'test').maybeSingle();
        if (adminSub) subs.push(adminSub);
    } else {
        const { data } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`);
        if (data) subs = data;
    }

    if (!subs || subs.length === 0) return ctx.reply('Подписок не найдено.', await getMainMenu(ctx));

    for (const s of subs) {
        const dateObj = new Date(s.expires_at);
        const diffDays = Math.ceil((dateObj - new Date()) / (1000 * 60 * 60 * 24));
        const report = 
            `👤 Ваш профиль: <b>@${username}</b>\n\n` +
            `🎫 <b>${s.profile_title}</b>\n` +
            `🕗 До: <code>${dateObj.toLocaleDateString('ru-RU')}</code> | <b>${diffDays > 0 ? diffDays : 0} дн.</b>\n` +
            `🎮 Тариф: <code>${s.tariff_type.toUpperCase()}</code>\n\n` +
            `🌊 Ваша подписка:\n` +
            `🔗 <code>https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}</code>`;
        await ctx.replyWithHTML(report, await getMainMenu(ctx));
    }
});

// Кнопка ПРОМОКОД (Юзер)
bot.hears('🎟 Промокод', (ctx) => {
    ctx.replyWithHTML('<b>🎟 Активация промокода</b>\n\nВведите ваш код сообщением в чат:');
});

// Логика активации промокода + фикс суммирования дат
bot.on('text', async (ctx, next) => {
    const serviceButtons = ['👤 Профиль', '💎 Покупка', '🎟 Промокод', '🎁 Тест Период', '🛠 Админ-панель'];
    if (ctx.message.text.startsWith('/') || serviceButtons.includes(ctx.message.text)) return next();

    const inputCode = ctx.message.text.trim();
    const username = ctx.from.username || ctx.from.first_name;

    try {
        const { data: promo } = await supabase.from('promocodes').select('*').eq('code', inputCode).maybeSingle();
        if (!promo) return ctx.reply('❌ Промокод не найден.');
        if (promo.used_count >= promo.max_uses) return ctx.reply('❌ Промокод использован.');

        let { data: sub } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`).maybeSingle();
        
        let targetDate = new Date();
        // Если подписка есть и она еще не кончилась — прибавляем к ней
        if (sub && new Date(sub.expires_at) > targetDate && promo.add_to_existing) {
            targetDate = new Date(sub.expires_at);
        }
        targetDate.setDate(targetDate.getDate() + promo.days);
        const finalDateString = targetDate.toISOString().split('T')[0];

        if (sub) {
            await supabase.from('vpn_subs').update({ 
                expires_at: finalDateString, 
                tariff_type: promo.tariff_type 
            }).eq('id', sub.id);
        } else {
            await supabase.from('vpn_subs').insert([{
                internal_name: `User @${username}`,
                tariff_type: promo.tariff_type,
                expires_at: finalDateString,
                profile_title: 'Psychosis VPN | Premium',
                tg_chat_id: ctx.from.id.toString(),
                total_gb: 0
            }]);
        }

        await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);
        ctx.replyWithHTML(`<b>✅ Активировано!</b>\nДобавлено ${promo.days} дн. до <code>${targetDate.toLocaleDateString('ru-RU')}</code>`);
    } catch (e) { ctx.reply('Ошибка активации.'); }
});

// --- АДМИН-ПАНЕЛЬ ---

bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Список юзеров', 'admin_users')],
        [Markup.button.callback('📊 Статистика', 'admin_stats'), Markup.button.callback('🖥 Сервера', 'admin_servers')],
        [Markup.button.callback('🎟 Список промо', 'admin_promo_list'), Markup.button.callback('➕ Создать промо', 'admin_add_promo_info')]
    ]);
    ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

// Список пользователей
bot.action('admin_users', async (ctx) => {
    const { data: users } = await supabase.from('vpn_subs').select('id, internal_name').limit(50);
    await ctx.answerCbQuery();
    if (!users?.length) return ctx.reply('Юзеров пока нет.');

    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    ctx.replyWithHTML('<b>👥 Список пользователей (последние 50):</b>', Markup.inlineKeyboard(buttons));
});

// Карточка управления пользователем
bot.action(/^manage_user_(.+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('id', userId).single();
    await ctx.answerCbQuery();

    const text = 
        `<b>👤 Юзер:</b> ${user.internal_name}\n` +
        `<b>🎮 Тариф:</b> ${user.tariff_type}\n` +
        `<b>📅 До:</b> <code>${user.expires_at}</code>\n` +
        `<b>🆔 ID:</b> <code>${user.id}</code>\n\n` +
        `<b>Изменить дату:</b>\n<code>/set_date ${user.id} ГГГГ-ММ-ДД</code>\n\n` +
        `<b>Написать:</b>\n<code>/send ${user.id} Текст</code>`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('💎 Тариф: BOTH', `set_tariff_${user.id}_both`)],
        [Markup.button.callback('⚪️ Тариф: WHITE', `set_tariff_${user.id}_white`)],
        [Markup.button.callback('🗑 Удалить подписку', `del_sub_${user.id}`)]
    ]);
    ctx.replyWithHTML(text, kb);
});

// Админ команды: Изменение даты и Рассылка
bot.command('set_date', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const [_, id, date] = ctx.message.text.split(' ');
    if (!id || !date) return ctx.reply('Формат: /set_date ID ГГГГ-ММ-ДД');
    await supabase.from('vpn_subs').update({ expires_at: date }).eq('id', id);
    ctx.reply('✅ Дата обновлена: ' + date);
});

bot.command('send', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split(' ');
    const id = parts[1];
    const text = parts.slice(2).join(' ');
    const { data } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', id).single();
    if (data?.tg_chat_id) {
        try {
            await bot.telegram.sendMessage(data.tg_chat_id, `🔔 <b>Сообщение от Psychosis VPN:</b>\n\n${text}`, { parse_mode: 'HTML' });
            ctx.reply('✅ Отправлено!');
        } catch (e) { ctx.reply('❌ Ошибка (бот заблокирован).'); }
    } else { ctx.reply('❌ Нет Chat ID.'); }
});

// Смена тарифа через кнопку
bot.action(/^set_tariff_(.+)_(.+)$/, async (ctx) => {
    const [_, id, tariff] = ctx.match;
    await supabase.from('vpn_subs').update({ tariff_type: tariff }).eq('id', id);
    await ctx.answerCbQuery('Готово');
    ctx.reply(`✅ Тариф изменен на ${tariff.toUpperCase()}`);
});

// --- СЕРВЕРА И СТАТИСТИКА ---

bot.action('admin_stats', async (ctx) => {
    const { count } = await supabase.from('vpn_subs').select('*', { count: 'exact', head: true });
    await ctx.answerCbQuery();
    ctx.replyWithHTML(`<b>📊 Всего пользователей:</b> <code>${count}</code>`);
});

bot.action('admin_servers', async (ctx) => {
    const { data: servers } = await supabase.from('vpn_servers').select('*').order('sort_index', { ascending: true });
    await ctx.answerCbQuery();
    for (const srv of servers) {
        const kb = Markup.inlineKeyboard([[Markup.button.callback('📝 Имя', `edit_name_${srv.id}`), Markup.button.callback('🗑 Удалить', `confirm_del_${srv.id}`)]]);
        await ctx.replyWithHTML(`${srv.tariff_type === 'base' ? '🔴' : '⚪️'} <b>${srv.name}</b>`, kb);
    }
});

// --- ПРОМОКОДЫ (Админ) ---

bot.action('admin_promo_list', async (ctx) => {
    const { data: promos } = await supabase.from('promocodes').select('*');
    await ctx.answerCbQuery();
    if (!promos?.length) return ctx.reply('Промокодов нет.');
    for (const p of promos) {
        const kb = Markup.inlineKeyboard([Markup.button.callback('🗑 Удалить', `del_promo_${p.id}`)]);
        ctx.replyWithHTML(`🎟 <code>${p.code}</code> | ${p.days}дн | ${p.used_count}/${p.max_uses}`, kb);
    }
});

bot.action('admin_add_promo_info', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.replyWithHTML('<b>Создать промо:</b>\n<code>/add_promo КОД | ТАРИФ | ДНИ | КОЛ-ВО | true/false</code>');
});

bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add_promo ')[1]?.split('|').map(p => p.trim());
    if (parts.length < 5) return ctx.reply('Ошибка формата!');
    await supabase.from('promocodes').insert([{ code: parts[0], tariff_type: parts[1], days: parseInt(parts[2]), max_uses: parseInt(parts[3]), add_to_existing: parts[4] === 'true' }]);
    ctx.reply(`✅ Промокод ${parts[0]} создан!`);
});

bot.action(/^del_promo_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.deleteMessage();
});

// --- УДАЛЕНИЕ / РЕНЕЙМ СЕРВЕРОВ ---
bot.action(/^confirm_del_(.+)$/, async (ctx) => {
    await supabase.from('vpn_servers').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.editMessageText('✅ Сервер удален.');
});

bot.action(/^edit_name_(.+)$/, async (ctx) => {
    ctx.replyWithHTML(`Введи: <code>/rename ${ctx.match[1]} Новое Имя</code>`);
    await ctx.answerCbQuery();
});

bot.command('rename', async (ctx) => {
    const args = ctx.message.text.split(' ');
    await supabase.from('vpn_servers').update({ name: args.slice(2).join(' ') }).eq('id', args[1]);
    ctx.reply('✅ Имя изменено.');
});

bot.hears('💎 Покупка', (ctx) => ctx.replyWithHTML('Свяжитесь с админом: @psychosisvpn'));

module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); res.status(200).send('OK'); }
    catch (e) { res.status(500).send('Error'); }
};
