const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 6443614614, 7761584076];

// Функция для генерации меню (динамическая кнопка Теста)
async function getMainMenu(ctx) {
    const username = ctx.from.username || ctx.from.first_name;
    
    // Проверяем, есть ли уже тест в базе
    const { data: testExists } = await supabase
        .from('vpn_subs')
        .select('id')
        .eq('internal_name', `Тест @${username}`)
        .maybeSingle();

    const buttons = [['👤 Профиль', '💎 Покупка']];
    
    // Если теста нет — добавляем кнопку
    if (!testExists) {
        buttons.push(['🎁 Тест Период']);
    }

    // Если админ — добавляем кнопку управления
    if (ADMINS.includes(ctx.from.id)) {
        buttons.push(['🛠 Админ-панель']);
    }

    return Markup.keyboard(buttons).resize();
}

// Старт
bot.start(async (ctx) => {
    const menu = await getMainMenu(ctx);
    return ctx.replyWithHTML(
        `<b>Добро пожаловать в Psychosis VPN!</b>\n\n` +
        `Используй меню ниже для управления доступом.`,
        menu
    );
});

// Кнопка ТЕСТ ПЕРИОД
bot.hears('🎁 Тест Период', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    const internalName = `Тест @${username}`;

    try {
        const { data: existing } = await supabase
            .from('vpn_subs')
            .select('*')
            .eq('internal_name', internalName)
            .maybeSingle();

        if (existing) {
            const menu = await getMainMenu(ctx);
            return ctx.reply('Вы уже использовали свой тестовый период! ✋', menu);
        }

        const expDate = new Date();
        expDate.setDate(expDate.getDate() + 5);
        const dateString = expDate.toISOString().split('T')[0];

        const { data, error } = await supabase
            .from('vpn_subs')
            .insert([{
                internal_name: internalName,
                tariff_type: 'both',
                expires_at: dateString,
                profile_title: 'Psychosis VPN | TEST',
                total_gb: 0
            }])
            .select().single();

        if (error) throw error;

        const menu = await getMainMenu(ctx); // Кнопка исчезнет после обновления меню
        await ctx.replyWithHTML(
            `<b>✅ Тест активирован!</b>\n` +
            `Теперь кнопка теста скрыта в твоем меню.`,
            menu
        );

    } catch (e) {
        ctx.reply('Ошибка. Попробуйте позже.');
    }
});

// Кнопка ПРОФИЛЬ (с твоим дизайном)
bot.hears('👤 Профиль', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    const userId = ctx.from.id;

    let subs = [];
    
    // Если это админ — выдаем спец. подписку
    if (ADMINS.includes(userId)) {
        const { data: adminSub } = await supabase
            .from('vpn_subs')
            .select('*')
            .eq('internal_name', 'test')
            .maybeSingle();
        if (adminSub) subs.push(adminSub);
    } else {
        // Обычный поиск по имени
        const { data } = await supabase
            .from('vpn_subs')
            .select('*')
            .ilike('internal_name', `%${username}%`);
        if (data) subs = data;
    }

    if (subs.length === 0) {
        return ctx.replyWithHTML('<b>У вас пока нет подписок.</b>', await getMainMenu(ctx));
    }

    for (const s of subs) {
        const dateObj = new Date(s.expires_at);
        const formattedDate = dateObj.toLocaleDateString('ru-RU');
        
        // Считаем остаток дней
        const diffTime = dateObj - new Date();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const daysLeft = diffDays > 0 ? `${diffDays} дней` : 'Истекла';

        const report = 
            `👤 Ваш профиль: <b>@${username}</b>\n\n` +
            `🎫 <b>${s.profile_title}</b>\n` +
            `🕗 До: <code>${formattedDate}</code> | <b>${daysLeft}</b>\n` +
            `🎮 Тариф: <code>${s.tariff_type.toUpperCase()}</code>\n\n` +
            `🌊 Ваша подписка:\n` +
            `🔗 <code>https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}</code>`;

        await ctx.replyWithHTML(report, await getMainMenu(ctx));
    }
});

// АДМИН-ПАНЕЛЬ (только для ID из списка)
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    
    ctx.replyWithHTML(
        `<b>🛠 Панель администратора</b>\n\n` +
        `Здесь ты можешь управлять серверами и подписками через веб-интерфейс:\n` +
        `🔗 <a href="https://psychosisvpn.vercel.app/admin-Jao38jOej2Pd.html">Открыть Админку</a>`
    );
});

bot.hears('💎 Покупка', async (ctx) => {
    ctx.replyWithHTML(
        '<b>💎 Оформление подписки</b>\n\n' +
        'Свяжитесь с нами для покупки:\n' +
        '👉 <a href="https://t.me/psychosisvpn">Менеджер Psychosis</a>',
        await getMainMenu(ctx)
    );
});

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (e) { res.status(500).send('Error'); }
};
