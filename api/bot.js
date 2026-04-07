const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Инициализация бота и базы данных через переменные окружения Vercel
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

// Команда /start
bot.start((ctx) => {
    return ctx.replyWithHTML(
        '<b>Добро пожаловать в Psychosis VPN!</b>\n\n' +
        'Нажми /test, чтобы получить бесплатный доступ на 5 дней с полным функционалом.'
    );
});

// Команда /test
bot.command('test', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    const internalName = `Тест @${username}`;

    try {
        // 1. Проверяем, не брал ли пользователь тест ранее
        const { data: existing, error: fetchError } = await supabase
            .from('vpn_subs')
            .select('*')
            .eq('internal_name', internalName)
            .maybeSingle();

        if (existing) {
            return ctx.reply('Вы уже использовали свой тестовый период. Мы ждем вас с платной подпиской! @aure_ember');
        }

        // 2. Рассчитываем дату окончания (сегодня + 5 дней)
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + 5);
        const dateString = expDate.toISOString().split('T')[0];

        // 3. Создаем запись в базе данных
        const { data, error: insertError } = await supabase
            .from('vpn_subs')
            .insert([{
                internal_name: internalName,
                tariff_type: 'both', // Тариф FULL
                expires_at: dateString,
                profile_title: 'Psychosis VPN | TEST',
                total_gb: 0,
                support_url: 'https://t.me/psychosisvpn'
            }])
            .select()
            .single();

        if (insertError) throw insertError;

        // 4. Формируем красивое сообщение через HTML
        const link = `https://psychosisvpn.vercel.app/api/get_sub?id=${data.id}`;
        
        const welcomeMessage = `
<b>✅ Тестовая подписка готова!</b>

🚀 Тариф: <b>FULL (Vpn + White List)</b>
📅 Действует до: <code>${data.expires_at}</code>

🔗 <b>Твоя ссылка для подключения:</b>
<code>${link}</code>

<i>Приятного пользования! Если возникнут вопросы — пиши @aure_ember</i> 🔥`;

        await ctx.replyWithHTML(welcomeMessage);

    } catch (e) {
        console.error('Ошибка в боте:', e);
        ctx.reply('Произошла ошибка при создании теста. Пожалуйста, попробуйте позже или свяжитесь с администратором.');
    }
});

// Экспорт обработчика для Vercel (Webhook)
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body);
        }
        res.status(200).send('OK');
    } catch (e) {
        console.error('Webhook Error:', e);
        res.status(500).send('Error');
    }
};
