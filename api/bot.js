const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

bot.start((ctx) => ctx.reply('Привет! Напиши /test, чтобы получить бесплатный доступ на 5 дней (Тариф FULL).'));

bot.command('test', async (ctx) => {
    const username = ctx.from.username || ctx.from.first_name;
    const internalName = `Тест @${username}`;

    try {
        // 1. Проверка на существующий тест
        const { data: existing } = await supabase
            .from('vpn_subs')
            .select('*')
            .eq('internal_name', internalName)
            .single();

        if (existing) {
            return ctx.reply('Вы уже брали тестовый период. Ждем вас снова но уже с платной подпиской!');
        }

        // 2. Срок на 5 дней
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + 5);

        // 3. Создание подписки с тарифом 'both'
        const { data, error } = await supabase
            .from('vpn_subs')
            .insert([{
                internal_name: internalName,
                tariff_type: 'both', // Установлен тариф FULL (Base + White)
                expires_at: expDate.toISOString().split('T')[0],
                profile_title: 'Psychosis VPN | TEST',
                total_gb: 0,
                support_url: 'https://t.me/psychosisvpn'
            }])
            .select()
            .single();

        if (error) throw error;

        // 4. Чистое сообщение без лишнего текста об окончании
        const link = `https://psychosisvpn.vercel.app/api/get_sub?id=${data.id}`;
        
        const message = [
            `✅ **Твоя тестовая подписка готова!**`,
            `🚀 Тариф: **FULL (Base + White List)**`,
            `📅 Действует до: \`${data.expires_at}\``,
            ``,
            `🔗 **Твоя ссылка для подключения:**`,
            `${link}`,
            ``,
            `Приятного пользования! 🔥`
        ].join('\n');

        ctx.replyWithMarkdown(message);

    } catch (e) {
        console.error('Ошибка бота:', e);
        ctx.reply('Ошибка при создании теста. Попробуй позже.');
    }
});

module.exports = async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (e) {
        res.status(500).send('Error');
    }
};
