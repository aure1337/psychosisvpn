const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

bot.start((ctx) => ctx.reply('Привет! Напиши /test, чтобы получить бесплатный доступ на 5 дней.'));

bot.command('test', async (ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username || ctx.from.first_name;

    try {
        // 1. Проверяем, был ли уже тест (опционально)
        const { data: existing } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('internal_name', `Тест @${username}`)
            .single();

        if (existing) {
            return ctx.reply('Вы уже брали тестовый период! ✋');
        }

        //// 2. Считаем дату окончания (+5 дней)
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + 5);

        // 3. Создаем подписку в базе
        const { data, error } = await supabase
            .from('subscriptions')
            .insert([{
                internal_name: `Тест @${username}`,
                tariff_type: 'base', // или 'both', смотря что даешь на тест
                expires_at: expDate.toISOString().split('T')[0],
                title: 'Psychosis VPN | TEST'
            }])
            .select()
            .single();

        if (error) throw error;

        // 4. Отправляем ссылку
        const link = `https://${process.env.VERCEL_URL}/api/get_sub?id=${data.id}`;
        ctx.reply(`✅ Твоя тестовая подписка готова!\n\n📅 Годна до: ${data.expires_at}\n🔗 Ссылка для подключения:\n${link}`);

    } catch (e) {
        console.error(e);
        ctx.reply('Ошибка при создании теста. Попробуй позже.');
    }
});

// Экспорт для Vercel
module.exports = async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (e) {
        res.status(500).send('Error');
    }
};
