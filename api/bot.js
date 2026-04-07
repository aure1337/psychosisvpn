const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 6443614614, 7761584076];

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

async function getMainMenu(ctx) {
    const username = ctx.from.username || ctx.from.first_name;
    const { data: testExists } = await supabase
        .from('vpn_subs')
        .select('id')
        .eq('internal_name', `Тест @${username}`)
        .maybeSingle();

    const buttons = [['👤 Профиль', '💎 Покупка']];
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
        const { data: adminSub } = await supabase.from('vpn_subs').select('*').eq('internal_name', 'test').maybeSingle();
        if (adminSub) subs.push(adminSub);
    } else {
        const { data } = await supabase.from('vpn_subs').select('*').ilike('internal_name', `%${username}%`);
        if (data) subs = data;
    }

    if (subs.length === 0) return ctx.reply('Подписок не найдено.');

    for (const s of subs) {
        const dateObj = new Date(s.expires_at);
        const diffDays = Math.ceil((dateObj - new Date()) / (1000 * 60 * 60 * 24));
        const report = `👤 Профиль: <b>@${username}</b>\n\n🎫 <b>${s.profile_title}</b>\n🕗 До: <code>${dateObj.toLocaleDateString('ru-RU')}</code> | <b>${diffDays > 0 ? diffDays : 0} дн.</b>\n🎮 Тариф: <code>${s.tariff_type.toUpperCase()}</code>\n\n🔗 <code>https://psychosisvpn.vercel.app/api/get_sub?id=${s.id}</code>`;
        await ctx.replyWithHTML(report);
    }
});

// --- АДМИН-ПАНЕЛЬ (ВНУТРИ БОТА) ---

bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    
    const adminKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статистика', 'admin_stats')],
        [Markup.button.callback('🖥 Список серверов', 'admin_servers')],
        [Markup.button.url('🌐 Открыть Web-админку', 'https://psychosisvpn.vercel.app/admin-Jao38jOej2Pd.html')]
    ]);

    ctx.replyWithHTML('<b>🛠 Панель управления Psychosis VPN</b>\nВыберите действие:', adminKeyboard);
});

// Обработка инлайновых кнопок админки
bot.action('admin_stats', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const { count } = await supabase.from('vpn_subs').select('*', { count: 'exact', head: true });
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(`<b>📊 Статистика:</b>\n\nВсего пользователей в базе: <code>${count}</code>`);
});

bot.action('admin_servers', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const { data: servers, error } = await supabase.from('vpn_servers').select('*').order('sort_index', { ascending: true });
    
    await ctx.answerCbQuery();
    if (error || !servers) return ctx.reply('Ошибка загрузки серверов.');

    let list = '<b>🖥 Список активных серверов:</b>\n\n';
    servers.forEach(srv => {
        list += `${srv.tariff_type === 'base' ? '🔴' : '⚪️'} <b>${srv.name}</b> (Индекс: ${srv.sort_index || 0})\n`;
    });

    ctx.replyWithHTML(list);
});

bot.hears('💎 Покупка', (ctx) => ctx.replyWithHTML('Свяжитесь с нами: <a href="https://t.me/psychosisvpn">Админ</a>'));

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (e) { res.status(500).send('Error'); }
};
