const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {}; 

// Красивые названия тарифов для интерфейса
const TARIFF_MAP = {
    'both': 'Обход и Впн',
    'white': 'Обход',
    'base': 'Базовый Впн',
    'none': 'Нету'
};

// --- ПОМОЩНИКИ ДЛЯ ДАТ ---
function addDaysToDate(baseDateStr, days) {
    let baseDate = new Date(baseDateStr);
    let today = new Date();
    // Если дата старая (2000 год) или уже прошла — считаем от "сегодня"
    if (isNaN(baseDate.getTime()) || baseDate < today || baseDate.getFullYear() === 2000) baseDate = today;
    baseDate.setDate(baseDate.getDate() + parseInt(days));
    return baseDate.toISOString().split('T')[0];
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime()) || d.getFullYear() === 2000) return 'Нет подписки';
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function getMainMenu(ctx) {
    const userId = ctx.from.id.toString();
    const { data: user } = await supabase.from('vpn_subs').select('profile_title').eq('tg_chat_id', userId).maybeSingle();
    
    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (!user?.profile_title?.includes('TEST')) buttons.push(['🎁 Тест Период']);
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);
    
    return Markup.keyboard(buttons).resize();
}

// --- СТАРТ И РЕГИСТРАЦИЯ ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'User');

    const { data: exists } = await supabase.from('vpn_subs').select('id').eq('tg_chat_id', userId).maybeSingle();
    if (!exists) {
        await supabase.from('vpn_subs').insert([{
            internal_name: username,
            tg_chat_id: userId,
            tariff_type: 'none',
            expires_at: '2000-01-01',
            profile_title: 'Psychosis VPN | Free'
        }]);
    } else {
        await supabase.from('vpn_subs').update({ internal_name: username }).eq('tg_chat_id', userId);
    }
    ctx.reply('Psychosis VPN запущен!', await getMainMenu(ctx));
});

// --- ПРОФИЛЬ ---
bot.hears('👤 Профиль', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    
    const today = new Date().toISOString().split('T')[0];
    const isExpired = !s || s.expires_at === '2000-01-01' || s.expires_at < today;
    const subUrl = `https://psychosisvpn.vercel.app/api/get_sub?id=${s?.id}`;

    const tariffName = isExpired ? 'Нету' : (TARIFF_MAP[s.tariff_type] || 'Нету');
    const dateText = isExpired ? '-' : formatDate(s.expires_at);

    const report = `👤 Профиль: <b>${s?.internal_name || ctx.from.first_name}</b>\n🕗 До: <b>${dateText}</b>\n💎 Тариф: <b>${tariffName}</b>\n\n🔗 <code>${subUrl}</code>`;
    await ctx.replyWithHTML(report, await getMainMenu(ctx));
});

// --- ТЕСТ ПЕРИОД ---
bot.hears('🎁 Тест Период', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    
    if (user?.profile_title?.includes('TEST')) {
        return ctx.reply('Вы уже использовали тестовый период!', await getMainMenu(ctx));
    }

    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 5);
    const dateStr = expDate.toISOString().split('T')[0];

    await supabase.from('vpn_subs').update({
        tariff_type: 'both',
        expires_at: dateStr,
        profile_title: 'Psychosis VPN | TEST'
    }).eq('tg_chat_id', userId);

    ctx.replyWithHTML(`🎁 Тестовый период 5 дней активирован!\nДо: <b>${formatDate(dateStr)}</b>\nТариф: <b>${TARIFF_MAP['both']}</b>`, await getMainMenu(ctx));
});

// --- АДМИН ПАНЕЛЬ (ГЛАВНАЯ) ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

bot.action('admin_menu_back', async (ctx) => {
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    await ctx.editMessageText('<b>🛠 Панель управления</b>', { parse_mode: 'HTML', ...kb });
});

bot.action('admin_users', async (ctx) => {
    const { data: users } = await supabase.from('vpn_subs').select('id, internal_name').limit(30);
    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    await ctx.editMessageText('<b>Список юзеров:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

// --- УПРАВЛЕНИЕ ЮЗЕРОМ (НОВАЯ ЛОГИКА) ---
bot.action(/^manage_user_(.+)$/, async (ctx) => {
    const { data: u } = await supabase.from('vpn_subs').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('💎 Выдать / Изменить тариф', `adm_sel_trf_${u.id}`)],
        [Markup.button.callback('💬 Написать', `msg_user_${u.id}`), Markup.button.callback('🗑 Аннулировать', `del_sub_final_${u.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    ctx.editMessageText(`<b>Юзер:</b> ${u.internal_name}\n<b>Тариф:</b> ${TARIFF_MAP[u.tariff_type] || 'Нет'}\n<b>До:</b> ${formatDate(u.expires_at)}`, { parse_mode: 'HTML', ...kb });
});

// 1. Выбор типа тарифа
bot.action(/^adm_sel_trf_(.+)$/, async (ctx) => {
    const uid = ctx.match[1];
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Обход и Впн', `trf_step2_${uid}_both`)],
        [Markup.button.callback('Обход', `trf_step2_${uid}_white`)],
        [Markup.button.callback('Базовый Впн', `trf_step2_${uid}_base`)],
        [Markup.button.callback('⬅️ Отмена', `manage_user_${uid}`)]
    ]);
    ctx.editMessageText('<b>Выберите тариф, который хотите выдать:</b>', { parse_mode: 'HTML', ...kb });
});

// 2. Выбор действия (установить дату, продлить или просто сменить)
bot.action(/^trf_step2_(.+?)_(.+)$/, async (ctx) => {
    const uid = ctx.match[1];
    const trf = ctx.match[2];
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Добавить дни', `final_add_${uid}_${trf}`)],
        [Markup.button.callback('📅 Установить дату', `final_set_${uid}_${trf}`)],
        [Markup.button.callback('🔄 Только сменить тип', `final_change_${uid}_${trf}`)],
        [Markup.button.callback('⬅️ Назад к выбору', `adm_sel_trf_${uid}`)]
    ]);
    ctx.editMessageText(`Выбран тариф: <b>${TARIFF_MAP[trf]}</b>\nЧто именно сделать?`, { parse_mode: 'HTML', ...kb });
});

// 3. Финальные экшены
bot.action(/^final_(add|set|change)_(.+?)_(.+)$/, async (ctx) => {
    const [_, act, uid, trf] = ctx.match;

    if (act === 'change') {
        await supabase.from('vpn_subs').update({ tariff_type: trf }).eq('id', uid);
        return ctx.reply(`✅ Тип тарифа изменен на "${TARIFF_MAP[trf]}". Срок остался прежним.`);
    }

    userStates[ctx.from.id] = { 
        action: act === 'add' ? 'add_days_manual' : 'set_date_manual', 
        targetId: uid, 
        tariff: trf 
    };
    ctx.reply(act === 'add' ? 'Сколько дней добавить?' : 'Введите дату (ГГГГ-ММ-ДД):');
});

// --- ОБРАБОТКА ТЕКСТА (ВВОД ДАННЫХ) ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates[userId];
    const input = ctx.message.text.trim();

    if (state) {
        if (state.action === 'add_days_manual') {
            const { data: s } = await supabase.from('vpn_subs').select('expires_at').eq('id', state.targetId).single();
            const newDate = addDaysToDate(s.expires_at, input);
            await supabase.from('vpn_subs').update({ expires_at: newDate, tariff_type: state.tariff, profile_title: 'Psychosis VPN | Premium' }).eq('id', state.targetId);
            ctx.reply(`✅ Выдано: ${TARIFF_MAP[state.tariff]}. До: ${formatDate(newDate)}`);
        } 
        else if (state.action === 'set_date_manual') {
            await supabase.from('vpn_subs').update({ expires_at: input, tariff_type: state.tariff, profile_title: 'Psychosis VPN | Premium' }).eq('id', state.targetId);
            ctx.reply(`✅ Установлено: ${TARIFF_MAP[state.tariff]}. До: ${formatDate(input)}`);
        }
        else if (state.action === 'msg_single') {
            const { data: t } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', state.targetId).single();
            if (t?.tg_chat_id) await bot.telegram.sendMessage(t.tg_chat_id, `🔔 <b>Сообщение от админа:</b>\n\n${input}`, { parse_mode: 'HTML' });
            ctx.reply('✅ Отправлено.');
        }
        else if (state.action === 'msg_all') {
            const { data: users } = await supabase.from('vpn_subs').select('tg_chat_id');
            for (const u of users) { try { await bot.telegram.sendMessage(u.tg_chat_id, input); } catch(e){} }
            ctx.reply('✅ Рассылка завершена.');
        }
        delete userStates[userId]; return;
    }

    // Логика промокодов
    if (input === '🎟 Промокод') return ctx.reply('Введите промокод:');
    
    // Простая проверка промокода (твоя база)
    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', input).maybeSingle();
    if (promo) {
        const { data: sub } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId.toString()).maybeSingle();
        const newDate = addDaysToDate(sub.expires_at, promo.days);
        await supabase.from('vpn_subs').update({ expires_at: newDate, tariff_type: promo.tariff_type || 'both', profile_title: 'Psychosis VPN | Premium' }).eq('id', sub.id);
        return ctx.replyWithHTML(`✅ Промокод активирован!\nДо: <b>${formatDate(newDate)}</b>`);
    }

    return next();
});

// --- СЕРВЕРА И ПРОЧЕЕ (ОСТАВЛЕНО БЕЗ ИЗМЕНЕНИЙ) ---
bot.action('admin_servers_list', async (ctx) => {
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const buttons = servers.map(s => [Markup.button.callback(s.name, `manage_srv_${s.id}`)]);
    buttons.push([Markup.button.callback('➕ Добавить сервер', 'srv_add_new')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('<b>Сервера:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action('global_msg', (ctx) => { userStates[ctx.from.id] = { action: 'msg_all' }; ctx.reply('Введите текст рассылки:'); });
bot.action(/^msg_user_(.+)$/, (ctx) => { userStates[ctx.from.id] = { action: 'msg_single', targetId: ctx.match[1] }; ctx.reply('Текст сообщения юзеру:'); });
bot.action(/^del_sub_final_(.+)$/, async (ctx) => {
    await supabase.from('vpn_subs').update({ expires_at: '2000-01-01', tariff_type: 'none', profile_title: 'Psychosis VPN | Free' }).eq('id', ctx.match[1]);
    ctx.reply('✅ Подписка обнулена.');
});

bot.hears('💎 Покупка', (ctx) => ctx.reply('Для покупки обращаться к: @psychosisvpn'));

// Обработчик для Vercel / Cloudflare
module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); } 
    catch (e) { console.error('Error:', e); } 
    finally { res.status(200).send('OK'); }
};
