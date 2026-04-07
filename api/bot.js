const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

bot.start((ctx) => ctx.reply('Привет! Напиши /test, чтобы получить бесплатный доступ на 5 дней.'));

bot.command('test', async (ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username || ctx.from.first_name;
    const internalName = `Тест @${username}`;

    try {
        // 1. Проверяем, не брал ли уже этот пользователь тест
        const { data: existing } = await supabase
            .from('vpn_subs') // Твое название таблицы со скриншота
            .select('*')
            .eq('internal_name', internalName)
            .single();

        if (existing) {
            return ctx.reply('Вы уже брали тестовый период! ✋');
        }

        // 2. Считаем дату окончания (+5 дней)
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + 5);

        // 3. Создаем подписку (колонки строго как на твоем скриншоте)
        const { data, error } = await supabase
            .from('vpn_subs')
            .insert([{
                internal_name: internalName,
                tariff_type: 'base',
                expires_at: expDate.toISOString().split('T')[0],
                profile_title: 'Psychosis VPN | TEST', // Название колонки со скриншота
                total_gb: 0,
                support_url: 'https://t.me/psychosisvpn'
            }])
            .select()
            .single();

        if (error) throw error;

        // 4. Формируем ссылку (используем твой домен)
        const link = `https://psychosisvpn.vercel.app/api/get_sub?id=${data.id}`;
        
        ctx.reply(`✅ Твоя тестовая подписка готова!\n\n📅 Действует до: ${data.expires_at}\n\n🔗 Твоя ссылка:\n${link}\n\nПодписка окончена. 😢Надеюсь вы протестировали наш сервис и подумаете о дальнейшей покупке. 🥳`);

    } catch (e) {
        console.error('Ошибка бота:', e);
        ctx.reply('Ошибка при создании теста. Попробуй позже или напиши в поддержку.');
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
