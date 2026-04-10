const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 6443614614, 7761584076];

// --- МЕНЮ ---
async function getMainMenu(ctx) {
    const username = ctx.from.username || ctx.from.first_name;
    const { data: testExists } = await supabase.from('vpn_subs').select('id').eq('internal_name', `Тест @${username}`).maybeSingle();

    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (!testExists) buttons.push(['🎁 Тест Период']);
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);

    return Markup.keyboard(buttons).resize();
}

// --- ЛОГИКА ПРОМОКОДОВ ДЛЯ ЮЗЕРОВ ---
bot.hears('🎟 Промокод', (ctx) => {
    ctx.replyWithHTML('<b>🎟 Активация промокода</b>\n\nВведите ваш промокод в чат:');
});

// Слушаем ввод текста (если это не команда и не кнопка, значит это может быть промокод)
bot.on('text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/') || ['👤 Профиль', '💎 Покупка', '🎟 Промокод', '🎁 Тест Период', '🛠 Админ-панель'].includes(ctx.message.text)) {
        return next();
    }

    const inputCode = ctx.message.text.trim();
    const username = ctx.from.username || ctx.from.first_name;

    try {
        // 1. Ищем промокод
        const { data: promo } = await supabase.from('promocodes').select('*').eq('code', inputCode).maybeSingle();

        if (!promo) return ctx.reply('❌ Промокод не найден или истек.');
        if (promo.used_count >= promo.max_uses) return ctx.reply('❌ Этот промокод уже закончился.');

        // 2. Ищем подписку юзера
        let { data: sub } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`).maybeSingle();

        let newExpDate = new Date();

        if (sub) {
            let currentExp = new Date(sub.expires_at);
            // Если подписка еще жива и разрешено складывать
            if (currentExp > new Date() && promo.add_to_existing) {
                newExpDate = currentExp;
            }
            newExpDate.setDate(newExpDate.getDate() + promo.days);

            await supabase.from('vpn_subs').update({
                expires_at: newExpDate.toISOString().split('T')[0],
                tariff_type: promo.tariff_type 
            }).eq('id', sub.id);
        } else {
            // Если подписки нет — создаем новую
            newExpDate.setDate(newExpDate.getDate() + promo.days);
            await supabase.from('vpn_subs').insert([{
                internal_name: `User @${username}`,
                tariff_type: promo.tariff_type,
                expires_at: newExpDate.toISOString().split('T')[0],
                profile_title: 'Psychosis VPN | Premium'
            }]);
        }

        // 3. Обновляем счетчик промокода
        await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);

        ctx.replyWithHTML(`<b>✅ Успех!</b>\nПромокод активирован. Добавлено <b>${promo.days} дней</b> тарифа <b>${promo.tariff_type.toUpperCase()}</b>.`);
    } catch (e) { ctx.reply('Ошибка активации.'); }
});

// --- АДМИНКА ПРОМОКОДОВ ---
bot.action('admin_promo_list', async (ctx) => {
    const { data: promos } = await supabase.from('promocodes').select('*');
    await ctx.answerCbQuery();
    if (!promos?.length) return ctx.reply('Промокодов нет.');

    for (const p of promos) {
        const text = `🎟 <code>${p.code}</code> (${p.tariff_type})\n➕ Дней: ${p.days} | Использовано: ${p.used_count}/${p.max_uses}`;
        const kb = Markup.inlineKeyboard([Markup.button.callback('🗑 Удалить', `del_promo_${p.id}`)]);
        await ctx.replyWithHTML(text, kb);
    }
});

bot.action('admin_promo_create', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.replyWithHTML('<b>Создание промокода</b>\nИспользуй команду:\n<code>/add_promo КОД | ТАРИФ | ДНИ | КОЛ-ВО | СУММИРОВАТЬ(true/false)</code>\n\nПример:\n<code>/add_promo FREE5 | both | 5 | 100 | true</code>');
});

bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add_promo ')[1]?.split('|').map(p => p.trim());
    if (parts.length < 5) return ctx.reply('Ошибка формата!');

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

// Добавь кнопки в основной обработчик админ-панели
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🎟 Список промо', 'admin_promo_list'), Markup.button.callback('➕ Создать промо', 'admin_promo_create')],
        [Markup.button.callback('📊 Статистика', 'admin_stats'), Markup.button.callback('🖥 Сервера', 'admin_servers')]
    ]);
    ctx.replyWithHTML('<b>Админка</b>', kb);
});

// Заглушка старта и остального кода (как в прошлых ответах)
bot.start(async (ctx) => ctx.reply('Привет Psychosis Vpn', await getMainMenu(ctx)));

module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); res.status(200).send('OK'); }
    catch (e) { res.status(500).send('Error'); }
};
