const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

// Главное меню с кнопками
const mainMenu = Markup.keyboard([
    ['👤 Профиль', '💎 Покупка'],
    ['🎁 Тест Период']
]).resize();

// Команда /start
bot.start((ctx) => {
    return ctx.replyWithHTML(
        `<b>Добро пожаловать в Psychosis VPN!</b>\n\n` +
        `Воспользуйся меню ниже для управления подпиской.`,
        mainMenu
    );
});

// Обработка кнопки "Тест Период"
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
            return ctx.reply('Вы уже использовали свой тестовый период! ✋');
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
                total_gb: 0,
                support_url: 'https://t.me/psychosisvpn'
            }])
            .select()
            .single();

        if (error) throw error;

        const link = `https://psychosisvpn.vercel.app/api/get_sub?id=${data.id}`;
        
        await ctx.replyWithHTML(
            `<b>✅ Тест активирован!</b>\n\n` +
            `🚀 Тариф: <b>FULL (Base + White)</b>\n` +
            `📅 До: <code>${data.expires_at}</code>\n\n` +
            `🔗 <b>Твоя ссылка:</b>\n<code>${link}</code>`,
            mainMenu
        );

    } catch (e) {
        console.error(e);
        ctx.reply('Ошибка. Попробуйте позже.');
    }
});

// Кнопка "Профиль"
bot.hears('👤 Профиль', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    
    // Ищем все подписки пользователя (тест и платные)
    const { data: subs } = await supabase
        .from('vpn_subs')
        .select('*')
        .ilike('internal_name', `%${username}%`);

    if (!subs || subs.length === 0) {
        return ctx.replyWithHTML('<b>У вас пока нет активных подписок.</b>\nНажмите "Тест Период" или "Покупка".');
    }

    let report = `<b>👤 Ваш профиль: @${username}</b>\n\n`;
    subs.forEach(s => {
        report += `🎫 <b>${s.profile_title}</b>\n`;
        report += `📅 Истекает: <code>${s.expires_at}</code>\n`;
        report += `🔗 <code>https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}</code>\n\n`;
    });

    ctx.replyWithHTML(report, mainMenu);
});

// Кнопка "Покупка"
bot.hears('💎 Покупка', (ctx) => {
    ctx.replyWithHTML(
        '<b>💎 Оформление подписки</b>\n\n' +
        'Для покупки полноценного доступа напишите нашему менеджеру:\n' +
        '<a href="https://t.me/psychosisvpn">Связаться с администратором</a>',
        mainMenu
    );
});

// Webhook для Vercel
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body);
        }
        res.status(200).send('OK');
    } catch (e) {
        res.status(500).send('Error');
    }
};
