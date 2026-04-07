const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076];

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

// --- АДМИН-ПАНЕЛЬ (УПРАВЛЕНИЕ) ---

bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    
    const adminKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Статистика', 'admin_stats')],
        [Markup.button.callback('🖥 Список серверов', 'admin_servers')],
        [Markup.button.callback('➕ Добавить сервер', 'admin_add_start')]
    ]);

    ctx.replyWithHTML('<b>🛠 Панель управления Psychosis VPN</b>\nВыберите действие:', adminKeyboard);
});

// 1. Статистика
bot.action('admin_stats', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const { count } = await supabase.from('vpn_subs').select('*', { count: 'exact', head: true });
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(`<b>📊 Всего пользователей:</b> <code>${count}</code>`);
});

// 2. Список серверов с кнопками управления
bot.action('admin_servers', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const { data: servers } = await supabase.from('vpn_servers').select('*').order('sort_index', { ascending: true });
    
    await ctx.answerCbQuery();
    if (!servers || servers.length === 0) return ctx.reply('Серверов пока нет.');

    for (const srv of servers) {
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('📝 Имя', `edit_name_${srv.id}`),
                Markup.button.callback('🗑 Удалить', `confirm_del_${srv.id}`)
            ]
        ]);
        
        await ctx.replyWithHTML(
            `${srv.tariff_type === 'base' ? '🔴' : '⚪️'} <b>${srv.name}</b>\n<code>${srv.vless_url.substring(0, 40)}...</code>`,
            keyboard
        );
    }
});

// 3. Удаление сервера
bot.action(/^confirm_del_(.+)$/, async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const srvId = ctx.match[1];
    
    const { error } = await supabase.from('vpn_servers').delete().eq('id', srvId);
    
    await ctx.answerCbQuery('Удалено!');
    if (error) return ctx.reply('Ошибка при удалении.');
    ctx.editMessageText('✅ Сервер успешно удален.');
});

// 4. Логика добавления и переименования (через текстовые команды)
bot.action('admin_add_start', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.replyWithHTML('Чтобы добавить сервер, используй команду:\n<code>/add_srv ИМЯ | ТИП | ССЫЛКА</code>\n\nПример:\n<code>/add_srv Германия | base | vless://...</code>');
});

bot.command('add_srv', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add_srv ')[1]?.split('|').map(p => p.trim());
    
    if (!parts || parts.length < 3) return ctx.reply('❌ Неверный формат. Используй: Имя | Тип | Ссылка');

    const { error } = await supabase.from('vpn_servers').insert([{
        name: parts[0],
        tariff_type: parts[1],
        vless_url: parts[2],
        sort_index: 0
    }]);

    if (error) return ctx.reply('Ошибка базы: ' + error.message);
    ctx.reply('✅ Сервер "' + parts[0] + '" добавлен!');
});

bot.action(/^edit_name_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const srvId = ctx.match[1];
    ctx.replyWithHTML(`Чтобы изменить имя этого сервера, введи:\n<code>/rename ${srvId} Новое Имя</code>`);
});

bot.command('rename', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const args = ctx.message.text.split('/rename ')[1]?.split(' ');
    const id = args?.shift();
    const newName = args?.join(' ');

    if (!id || !newName) return ctx.reply('❌ Формат: /rename ID Новое_Имя');

    const { error } = await supabase.from('vpn_servers').update({ name: newName }).eq('id', id);
    
    if (error) return ctx.reply('Ошибка: ' + error.message);
    ctx.reply('✅ Имя изменено на: ' + newName);
});

bot.hears('💎 Покупка', (ctx) => ctx.replyWithHTML('Свяжитесь с нами: <a href="https://t.me/psychosisvpn">Админ</a>'));

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (e) { res.status(500).send('Error'); }
};
