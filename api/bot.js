const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {}; 

const TARIFF_MAP = {
    'both': 'Обход и Впн',
    'white': 'Обход',
    'base': 'Базовый Впн',
    'none': 'Нету'
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function addDaysToDate(baseDateStr, days) {
    let baseDate = new Date(baseDateStr);
    let today = new Date();
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
    // Убрали кнопку Тест из главного меню, теперь она в Профиле
    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);
    return Markup.keyboard(buttons).resize();
}

// --- СТАРТ ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'User');
    const { data: exists } = await supabase.from('vpn_subs').select('id').eq('tg_chat_id', userId).maybeSingle();
    
    if (!exists) {
        await supabase.from('vpn_subs').insert([{
            internal_name: username, tg_chat_id: userId, tariff_type: 'none',
            expires_at: '2000-01-01', profile_title: 'Psychosis VPN | Free'
        }]);
    } else {
        await supabase.from('vpn_subs').update({ internal_name: username }).eq('tg_chat_id', userId);
    }
    ctx.reply('Psychosis VPN запущен!', await getMainMenu(ctx));
});

// --- ПРОФИЛЬ С ИНЛАЙН КНОПКОЙ ТЕСТА ---
bot.hears('👤 Профиль', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    
    const today = new Date().toISOString().split('T')[0];
    const isExpired = !s || s.expires_at === '2000-01-01' || s.expires_at < today;
    const subUrl = `https://psychosisvpn.vercel.app/api/get_sub?id=${s?.id}`;
    
    const report = `👤 Профиль: <b>${s?.internal_name || ctx.from.first_name}</b>\n🕗 До: <b>${isExpired ? '-' : formatDate(s.expires_at)}</b>\n💎 Тариф: <b>${isExpired ? 'Нету' : (TARIFF_MAP[s.tariff_type] || 'Нету')}</b>\n\n🔗 <code>${subUrl}</code>`;
    
    const inlineButtons = [];
    // Если в названии профиля НЕТ слова TEST — показываем кнопку теста
    if (!s?.profile_title?.includes('TEST')) {
        inlineButtons.push([Markup.button.callback('🎁 Взять тест-период (5 дн.)', 'activate_test_profile')]);
    }

    await ctx.replyWithHTML(report, Markup.inlineKeyboard(inlineButtons));
});

// ОБРАБОТКА НАЖАТИЯ КНОПКИ ТЕСТА В ПРОФИЛЕ
bot.action('activate_test_profile', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();

    if (user?.profile_title?.includes('TEST')) {
        return ctx.answerCbQuery('Вы уже использовали тест!', { show_alert: true });
    }

    const testDays = 5;
    const newDate = addDaysToDate('2000-01-01', testDays); // Считаем от сегодня

    await supabase.from('vpn_subs').update({ 
        tariff_type: 'both', 
        expires_at: newDate, 
        profile_title: 'Psychosis VPN | TEST' 
    }).eq('tg_chat_id', userId);

    await ctx.answerCbQuery('✅ Тест на 5 дней активирован!', { show_alert: true });
    
    // Обновляем сообщение профиля, чтобы кнопка исчезла
    const subUrl = `https://psychosisvpn.vercel.app/api/get_sub?id=${user?.id}`;
    const updatedReport = `👤 Профиль: <b>${user?.internal_name}</b>\n🕗 До: <b>${formatDate(newDate)}</b>\n💎 Тариф: <b>${TARIFF_MAP['both']}</b>\n\n🔗 <code>${subUrl}</code>\n\n✅ <i>Тестовый период успешно активирован!</i>`;
    
    try {
        await ctx.editMessageText(updatedReport, { parse_mode: 'HTML' });
    } catch (e) {
        ctx.replyWithHTML('✅ Тест активирован! Перезайдите в профиль для обновления данных.');
    }
});

// --- АДМИН-ПАНЕЛЬ ГЛАВНАЯ ---
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

// --- АДМИНКА: ЮЗЕРЫ ---
bot.action('admin_users', async (ctx) => {
    const { data: users } = await supabase.from('vpn_subs').select('id, internal_name').limit(30);
    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    await ctx.editMessageText('<b>Список юзеров:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_user_(.+)$/, async (ctx) => {
    const { data: u } = await supabase.from('vpn_subs').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('💎 Выдать / Изменить тариф', `adm_sel_trf_${u.id}`)],
        [Markup.button.callback('💬 Написать', `msg_user_${u.id}`), Markup.button.callback('🗑 Аннулировать', `del_sub_final_${u.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    ctx.editMessageText(`<b>Юзер:</b> ${u.internal_name}\n<b>До:</b> ${formatDate(u.expires_at)}`, { parse_mode: 'HTML', ...kb });
});

bot.action(/^adm_sel_trf_(.+)$/, async (ctx) => {
    const uid = ctx.match[1];
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Обход и Впн', `trf_step2_${uid}_both`)],
        [Markup.button.callback('Обход', `trf_step2_${uid}_white`)],
        [Markup.button.callback('Базовый Впн', `trf_step2_${uid}_base`)],
        [Markup.button.callback('⬅️ Отмена', `manage_user_${uid}`)]
    ]);
    ctx.editMessageText('<b>Выберите тариф:</b>', { parse_mode: 'HTML', ...kb });
});

bot.action(/^trf_step2_(.+?)_(.+)$/, async (ctx) => {
    const [_, uid, trf] = ctx.match;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Добавить дни', `final_add_${uid}_${trf}`)],
        [Markup.button.callback('📅 Установить дату', `final_set_${uid}_${trf}`)],
        [Markup.button.callback('🔄 Только сменить тип', `final_change_${uid}_${trf}`)],
        [Markup.button.callback('⬅️ Назад', `adm_sel_trf_${uid}`)]
    ]);
    ctx.editMessageText(`Тариф: <b>${TARIFF_MAP[trf]}</b>. Что сделать?`, { parse_mode: 'HTML', ...kb });
});

bot.action(/^final_(add|set|change)_(.+?)_(.+)$/, async (ctx) => {
    const [_, act, uid, trf] = ctx.match;
    if (act === 'change') {
        await supabase.from('vpn_subs').update({ tariff_type: trf }).eq('id', uid);
        return ctx.reply('✅ Тип тарифа изменен.');
    }
    userStates[ctx.from.id] = { action: act === 'add' ? 'add_days_manual' : 'set_date_manual', targetId: uid, tariff: trf };
    ctx.reply(act === 'add' ? 'Сколько дней добавить?' : 'Введите дату (ГГГГ-ММ-ДД):');
});

// --- АДМИНКА: ПРОМОКОДЫ ---
bot.action('admin_promo_list', async (ctx) => {
    const { data: promos } = await supabase.from('promocodes').select('*');
    const buttons = (promos || []).map(p => [Markup.button.callback(`${p.code} (${p.used_count}/${p.max_uses})`, `manage_promo_${p.id}`)]);
    buttons.push([Markup.button.callback('➕ Создать новый', 'admin_promo_add')]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('<b>Управление промокодами:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_promo_(.+)$/, async (ctx) => {
    const { data: p } = await supabase.from('promocodes').select('*').eq('id', ctx.match[1]).single();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Обнулить активации', `promo_res_${p.id}`)],
        [Markup.button.callback('⚙️ Изменить лимит', `promo_lim_${p.id}`), Markup.button.callback('📅 Дни', `promo_day_${p.id}`)],
        [Markup.button.callback('🗑 Удалить', `promo_del_${p.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_promo_list')]
    ]);
    ctx.editMessageText(`🎟 <b>${p.code}</b>\nДает: ${p.days} дн.\nЮзов: ${p.used_count}/${p.max_uses}\nТариф: ${TARIFF_MAP[p.tariff_type]}`, { parse_mode: 'HTML', ...kb });
});

bot.action('admin_promo_add', (ctx) => {
    ctx.reply('Для создания используй команду:\n`/add_promo КОД | both | ДНИ | КОЛ_ВО`\n\nПример:\n`/add_promo TEST30 | both | 30 | 50`', { parse_mode: 'Markdown' });
});

bot.action(/^promo_res_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').update({ used_count: 0 }).eq('id', ctx.match[1]);
    await supabase.from('promo_activations').delete().eq('promo_id', ctx.match[1]);
    ctx.answerCbQuery('Обнулено');
    ctx.editMessageText('✅ Промокод обнулен.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_promo_list')]]));
});

bot.action(/^promo_lim_(.+)$/, (ctx) => { userStates[ctx.from.id] = { action: 'promo_limit', targetId: ctx.match[1] }; ctx.reply('Введите НОВОЕ общее количество активаций:'); });
bot.action(/^promo_day_(.+)$/, (ctx) => { userStates[ctx.from.id] = { action: 'promo_days', targetId: ctx.match[1] }; ctx.reply('Сколько дней теперь будет давать промо?'); });
bot.action(/^promo_del_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    ctx.editMessageText('✅ Удалено.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_promo_list')]]));
});

// --- ОБРАБОТКА ТЕКСТА ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates[userId];
    const input = ctx.message.text.trim();

    if (state) {
        if (state.action === 'add_days_manual') {
            const { data: s } = await supabase.from('vpn_subs').select('expires_at').eq('id', state.targetId).single();
            const newDate = addDaysToDate(s.expires_at, input);
            await supabase.from('vpn_subs').update({ expires_at: newDate, tariff_type: state.tariff, profile_title: 'Psychosis VPN | Premium' }).eq('id', state.targetId);
            ctx.reply('✅ Подписка продлена.');
        } 
        else if (state.action === 'set_date_manual') {
            await supabase.from('vpn_subs').update({ expires_at: input, tariff_type: state.tariff, profile_title: 'Psychosis VPN | Premium' }).eq('id', state.targetId);
            ctx.reply('✅ Дата установлена.');
        }
        else if (state.action === 'promo_limit') {
            await supabase.from('promocodes').update({ max_uses: parseInt(input) }).eq('id', state.targetId);
            ctx.reply(`✅ Новый лимит установлен: ${input}`);
        }
        else if (state.action === 'promo_days') {
            await supabase.from('promocodes').update({ days: parseInt(input) }).eq('id', state.targetId);
            ctx.reply('✅ Дни обновлены.');
        }
        else if (state.action === 'msg_all') {
            const { data: users } = await supabase.from('vpn_subs').select('tg_chat_id');
            for (const u of users) { try { await bot.telegram.sendMessage(u.tg_chat_id, input); } catch(e){} }
            ctx.reply('✅ Рассылка завершена.');
        }
        delete userStates[userId]; return;
    }

    if (input === '🎟 Промокод') return ctx.reply('Введите ваш промокод:');

    // ЛОГИКА АКТИВАЦИИ ПРОМОКОДА
    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', input).maybeSingle();
    if (promo) {
        const { data: sub } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId.toString()).maybeSingle();
        if (promo.used_count >= promo.max_uses) return ctx.reply('❌ Этот промокод закончился.');
        
        const { data: used } = await supabase.from('promo_activations').select('id').eq('user_id', sub.id).eq('promo_id', promo.id).maybeSingle();
        if (used) return ctx.reply('❌ Вы уже вводили этот код.');

        const newDate = addDaysToDate(sub.expires_at, promo.days);
        await supabase.from('vpn_subs').update({ expires_at: newDate, tariff_type: promo.tariff_type || 'both', profile_title: 'Psychosis VPN | Premium' }).eq('id', sub.id);
        await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);
        await supabase.from('promo_activations').insert([{ user_id: sub.id, promo_id: promo.id }]);
        
        return ctx.replyWithHTML(`✅ Промокод активирован!\nДобавлено: <b>${promo.days} дн.</b>\nДо: <b>${formatDate(newDate)}</b>`);
    }

    return next();
});

// --- КОМАНДЫ И СЕРВЕРА ---
bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const p = ctx.message.text.split('/add_promo ')[1]?.split('|').map(x => x.trim());
    if (!p || p.length < 4) return ctx.reply('Формат: /add_promo КОД | both | ДНИ | КОЛ_ВО');
    await supabase.from('promocodes').insert([{ code: p[0], tariff_type: p[1], days: parseInt(p[2]), max_uses: parseInt(p[3]), used_count: 0 }]);
    ctx.reply(`✅ Промокод ${p[0]} создан!`);
});

bot.action('admin_servers_list', async (ctx) => {
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const buttons = (servers || []).map(s => [Markup.button.callback(s.name, `manage_srv_${s.id}`)]);
    buttons.push([Markup.button.callback('➕ Добавить сервер', 'srv_add_new')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('<b>Сервера:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action('global_msg', (ctx) => { userStates[ctx.from.id] = { action: 'msg_all' }; ctx.reply('Введите текст рассылки:'); });
bot.hears('💎 Покупка', (ctx) => ctx.reply('Для покупки: @psychosisvpn'));

module.exports = async (req, res) => {
    try { if (req.method === 'POST') await bot.handleUpdate(req.body); } 
    catch (e) { console.error('Error:', e); } 
    finally { res.status(200).send('OK'); }
};
