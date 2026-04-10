const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614]; // Добавлены твои админы

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
            total_gb: 0
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
        // Для админов ищем спец. подписку "test"
        const { data: adminSub } = await supabase.from('vpn_subs').select('*').eq('internal_name', 'test').maybeSingle();
        if (adminSub) subs.push(adminSub);
    } else {
        const { data } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`);
        if (data) subs = data;
    }

    if (subs.length === 0) return ctx.reply('Подписок не найдено.', await getMainMenu(ctx));

    for (const s of subs) {
        const dateObj = new Date(s.expires_at);
        const formattedDate = dateObj.toLocaleDateString('ru-RU');
        const diffDays = Math.ceil((dateObj - new Date()) / (1000 * 60 * 60 * 24));
        
        const report = 
            `👤 Ваш профиль: <b>@${username}</b>\n\n` +
            `🎫 <b>${s.profile_title}</b>\n` +
            `🕗 До: <code>${formattedDate}</code> | <b>${diffDays > 0 ? diffDays : 0} дн.</b>\n` +
            `🎮 Тариф: <code>${s.tariff_type.toUpperCase()}</code>\n\n` +
            `🌊 Ваша подписка:\n` +
            `🔗 <code>https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}</code>`;
            
        await ctx.replyWithHTML(report, await getMainMenu(ctx));
    }
});

// Кнопка ПРОМОКОД (Юзерская часть)
bot.hears('🎟 Промокод', (ctx) => {
    ctx.replyWithHTML('<b>🎟 Активация промокода</b>\n\nВведите ваш промокод текстом в чат:');
});

// Логика активации промокода (обработка любого текста)
bot.on('text', async (ctx, next) => {
    const serviceButtons = ['👤 Профиль', '💎 Покупка', '🎟 Промокод', '🎁 Тест Период', '🛠 Админ-панель'];
    if (ctx.message.text.startsWith('/') || serviceButtons.includes(ctx.message.text)) return next();

    const inputCode = ctx.message.text.trim();
    const username = ctx.from.username || ctx.from.first_name;

    try {
        const { data: promo } = await supabase.from('promocodes').select('*').eq('code', inputCode).maybeSingle();
        if (!promo) return ctx.reply('❌ Промокод не найден.');
        if (promo.used_count >= promo.max_uses) return ctx.reply('❌ Промокод полностью использован.');

        let { data: sub } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`).maybeSingle();
        let newExpDate = new Date();

        if (sub) {
            let currentExp = new Date(sub.expires_at);
            if (currentExp > new Date() && promo.add_to_existing) newExpDate = currentExp;
            newExpDate.setDate(newExpDate.getDate() + promo.days);

            await supabase.from('vpn_subs').update({
                expires_at: newExpDate.toISOString().split('T')[0],
                tariff_type: promo.tariff_type 
            }).eq('id', sub.id);
        } else {
            newExpDate.setDate(newExpDate.getDate() + promo.days);
            await supabase.from('vpn_subs').insert([{
                internal_name: `User @${username}`,
                tariff_type: promo.tariff_type,
                expires_at: newExpDate.toISOString().split('T')[0],
                profile_title: 'Psychosis VPN | Premium',
                total_gb: 0
            }]);
        }

        await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);
        ctx.replyWithHTML(`<b>✅ Активировано!</b>\nДобавлено ${promo.days} дн. тарифа ${promo.tariff_type.toUpperCase()}`);
    } catch (e) { ctx.reply('Ошибка активации.'); }
});

// --- АДМИН-ПАНЕЛЬ (УПРАВЛЕНИЕ) ---

bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    
    const adminKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статистика', 'admin_stats'), Markup.button.callback('🖥 Сервера', 'admin_servers')],
        [Markup.button.callback('🎟 Список промо', 'admin_promo_list'), Markup.button.callback('➕ Создать промо', 'admin_add_promo_info')]
    ]);

    ctx.replyWithHTML('<b>🛠 Панель управления Psychosis VPN</b>', adminKeyboard);
});

// Админ: Статистика
bot.action('admin_stats', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const { count } = await supabase.from('vpn_subs').select('*', { count: 'exact', head: true });
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(`<b>📊 Всего пользователей:</b> <code>${count}</code>`);
});

// Админ: Список серверов
bot.action('admin_servers', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const { data: servers } = await supabase.from('vpn_servers').select('*').order('sort_index', { ascending: true });
    await ctx.answerCbQuery();
    if (!servers || servers.length === 0) return ctx.reply('Серверов нет.');

    for (const srv of servers) {
        const kb = Markup.inlineKeyboard([[Markup.button.callback('📝 Имя', `edit_name_${srv.id}`), Markup.button.callback('🗑 Удалить', `confirm_del_${srv.id}`)]]);
        await ctx.replyWithHTML(`${srv.tariff_type === 'base' ? '🔴' : '⚪️'} <b>${srv.name}</b>`, kb);
    }
});

// Админ: Промокоды
bot.action('admin_promo_list', async (ctx) => {
    const { data: promos } = await supabase.from('promocodes').select('*');
    await ctx.answerCbQuery();
    if (!promos?.length) return ctx.reply('Промокодов нет.');

    for (const p of promos) {
        const text = `🎟 <code>${p.code}</code> (${p.tariff_type})\n➕ Дней: ${p.days} | Использовано: ${p.used_count}/${p.max_uses}\nСкладывать дни: ${p.add_to_existing ? 'Да' : 'Нет'}`;
        const kb = Markup.inlineKeyboard([Markup.button.callback('🗑 Удалить промо', `del_promo_${p.id}`)]);
        await ctx.replyWithHTML(text, kb);
    }
});

bot.action('admin_add_promo_info', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.replyWithHTML('<b>Создание промокода:</b>\nКоманда:\n<code>/add_promo КОД | ТАРИФ | ДНИ | КОЛ-ВО | СУММИРОВАТЬ(true/false)</code>\n\nПример:\n<code>/add_promo MEGA2026 | both | 30 | 50 | true</code>');
});

bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add_promo ')[1]?.split('|').map(p => p.trim());
    if (!parts || parts.length < 5) return ctx.reply('❌ Ошибка! Формат: Код | Тариф | Дни | Кол-во | true/false');

    const { error } = await supabase.from('promocodes').insert([{
        code: parts[0],
        tariff_type: parts[1],
        days: parseInt(parts[2]),
        max_uses: parseInt(parts[3]),
        add_to_existing: parts[4] === 'true'
    }]);

    if (error) return ctx.reply('Ошибка: ' + error.message);
    ctx.reply(`✅ Промокод ${parts[0]} создан!`);
});

bot.action(/^del_promo_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.deleteMessage();
});

// Остальные действия (удаление серверов, ренейм)
bot.action(/^confirm_del_(.+)$/, async (ctx) => {
    const { error } = await supabase.from('vpn_servers').delete().eq('id', ctx.match[1]);
    await ctx.answerCbQuery('Удалено');
    ctx.editMessageText('✅ Удалено');
});

bot.action(/^edit_name_(.+)$/, async (ctx) => {
    ctx.replyWithHTML(`Введи: <code>/rename ${ctx.match[1]} Новое Имя</code>`);
    await ctx.answerCbQuery();
});

bot.command('rename', async (ctx) => {
    const args = ctx.message.text.split('/rename ')[1]?.split(' ');
    const id = args?.shift();
    const newName = args?.join(' ');
    await supabase.from('vpn_servers').update({ name: newName }).eq('id', id);
    ctx.reply('✅ Имя изменено.');
});

bot.hears('💎 Покупка', (ctx) => ctx.replyWithHTML('Свяжитесь с нами: <a href="https://t.me/psychosisvpn">Админ</a>'));

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (e) { res.status(500).send('Error'); }
};
