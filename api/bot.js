const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {}; 

// --- ПОМОЩНИКИ ДЛЯ ДАТ ---
function addDaysToDate(baseDateStr, days) {
    let baseDate = new Date(baseDateStr);
    let today = new Date();
    if (isNaN(baseDate.getTime()) || baseDate < today) baseDate = today;
    baseDate.setDate(baseDate.getDate() + parseInt(days));
    return baseDate.toISOString().split('T')[0];
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime()) || d.getFullYear() === 2000) return 'Нет подписки';
    // Нормальный формат ДД.ММ.ГГГГ
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function getMainMenu(ctx) {
    const userId = ctx.from.id.toString();
    const { data: user } = await supabase.from('vpn_subs').select('profile_title, expires_at').eq('tg_chat_id', userId).maybeSingle();
    
    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    
    if (!user?.profile_title?.includes('TEST')) {
        buttons.push(['🎁 Тест Период']);
    }
    
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
    const subUrl = `https://psychosisvpn.vercel.app/api/get_sub?id=${s?.id}`;

    // Если юзера нет или подписка неактивна (2000 год или дата в прошлом)
    if (!s || s.expires_at === '2000-01-01' || s.expires_at < today) {
        const report = `👤 Профиль: <b>${s?.internal_name || ctx.from.first_name}</b>\n🕗 До: <b>-</b>\n💎 Тариф: <b>Нету</b>\n\n🔗 <code>${subUrl}</code>`;
        return ctx.replyWithHTML(report, await getMainMenu(ctx));
    }

    // Если подписка активна
    const tMap = { 'both': 'BOTH', 'white': 'WHITE', 'base': 'BASE' };
    const tariff = tMap[s.tariff_type] || (s.tariff_type || 'NONE').toUpperCase();
    
    const report = `👤 Профиль: <b>${s.internal_name}</b>\n🕗 До: <b>${formatDate(s.expires_at)}</b>\n💎 Тариф: <b>${tariff}</b>\n\n🔗 <code>${subUrl}</code>`;
    await ctx.replyWithHTML(report);
});

// --- ТЕСТ ПЕРИОД ---
bot.hears('🎁 Тест Период', async (ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'User');
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    
    if (user?.profile_title?.includes('TEST')) {
        return ctx.reply('Вы уже использовали тестовый период!', await getMainMenu(ctx));
    }

    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 5);
    const dateStr = expDate.toISOString().split('T')[0];

    if (user) {
        await supabase.from('vpn_subs').update({
            tariff_type: 'both',
            expires_at: dateStr,
            profile_title: 'Psychosis VPN | TEST'
        }).eq('tg_chat_id', userId);
    } else {
        await supabase.from('vpn_subs').insert([{
            internal_name: username,
            tg_chat_id: userId,
            tariff_type: 'both',
            expires_at: dateStr,
            profile_title: 'Psychosis VPN | TEST'
        }]);
    }

    const msg = `🎁 Тестовый период 5 дней активирован.\n\nВаша подписка:\nДата окончания: <b>${formatDate(dateStr)}</b>\nТариф: <b>BOTH</b>`;
    ctx.replyWithHTML(msg, await getMainMenu(ctx));
});

// --- ВВОД ТЕКСТА (РАССЫЛКА, АДМИНКА, ПРОМО) ---
bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates[userId];

    if (state) {
        const input = ctx.message.text.trim();
        
        if (state.action === 'msg_all') {
            const { data: users } = await supabase.from('vpn_subs').select('tg_chat_id');
            let success = 0;
            ctx.reply('⏳ Начинаю рассылку...');
            for (const u of users) {
                if (u.tg_chat_id) {
                    try { 
                        await bot.telegram.sendMessage(u.tg_chat_id, input); 
                        success++;
                        await new Promise(r => setTimeout(r, 40)); 
                    } catch(e){}
                }
            }
            ctx.reply(`✅ Рассылка завершена. Доставлено: ${success} чел.`);
        } 
        else if (state.action === 'msg_single') {
            const { data: t } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', state.targetId).single();
            if (t?.tg_chat_id) await bot.telegram.sendMessage(t.tg_chat_id, `🔔 <b>Сообщение от админа:</b>\n\n${input}`, { parse_mode: 'HTML' });
            ctx.reply('✅ Отправлено.');
        }
        else if (state.action === 'add_days_manual') {
            const { data: s } = await supabase.from('vpn_subs').select('expires_at').eq('id', state.targetId).single();
            const newDate = addDaysToDate(s.expires_at === '2000-01-01' ? new Date() : s.expires_at, input);
            await supabase.from('vpn_subs').update({ expires_at: newDate, tariff_type: 'both', profile_title: 'Psychosis VPN | Premium' }).eq('id', state.targetId);
            ctx.reply(`✅ Подписка выдана. До: ${formatDate(newDate)}`);
        }
        else if (state.action === 'set_date_manual') {
            await supabase.from('vpn_subs').update({ expires_at: input, tariff_type: 'both', profile_title: 'Psychosis VPN | Premium' }).eq('id', state.targetId);
            ctx.reply(`✅ Новая дата: ${formatDate(input)}`);
        }
        else if (state.action === 'srv_add_step1') {
            userStates[userId] = { action: 'srv_add_step2', vless: input };
            return ctx.reply('Введите название сервера:');
        }
        else if (state.action === 'srv_add_step2') {
            await supabase.from('vpn_servers').insert([{ vless_url: state.vless, name: input, tariff_type: 'both' }]);
            ctx.reply('✅ Сервер добавлен.');
        }
        delete userStates[userId]; return;
    }

    const serviceButtons = ['👤 Профиль', '💎 Покупка', '🎟 Промокод', '🎁 Тест Период', '🛠 Админ-панель'];
    if (ctx.message.text.startsWith('/') || serviceButtons.includes(ctx.message.text)) return next();

    // --- ЛОГИКА ПРОМОКОДА (ИСПРАВЛЕННАЯ) ---
    const codeInput = ctx.message.text.trim();
    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', codeInput).maybeSingle();

    if (promo) {
        // 1. Проверяем общий лимит активаций промокода
        if (promo.used_count >= promo.max_uses) {
            return ctx.reply('❌ Этот промокод закончился (превышен лимит активаций).');
        }

        // 2. Ищем юзера или создаем, если зашел в первый раз
        let { data: sub } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', ctx.from.id.toString()).maybeSingle();
        if (!sub) {
            const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
            const { data: newSub } = await supabase.from('vpn_subs').insert([{
                internal_name: username,
                tg_chat_id: ctx.from.id.toString(),
                expires_at: '2000-01-01',
                profile_title: 'Psychosis VPN | Free'
            }]).select().single();
            sub = newSub;
        }

        // 3. Проверяем, не использовал ли ЭТОТ юзер ЭТОТ промокод ранее
        const { data: alreadyUsed } = await supabase.from('promo_activations')
            .select('id')
            .eq('user_id', sub.id)
            .eq('promo_id', promo.id)
            .maybeSingle();

        if (alreadyUsed) {
            return ctx.reply('❌ Вы уже активировали этот промокод ранее!');
        }

        // 4. Если всё ок — начисляем дни
        const todayStr = new Date().toISOString().split('T')[0];
        const currentExp = (sub.expires_at === '2000-01-01' || sub.expires_at < todayStr) ? todayStr : sub.expires_at;
        const newDate = addDaysToDate(currentExp, promo.days);

        // Обновляем подписку
        await supabase.from('vpn_subs').update({ 
            expires_at: newDate, 
            tariff_type: promo.tariff_type || 'both',
            profile_title: 'Psychosis VPN | Premium' 
        }).eq('id', sub.id);
        
        // Увеличиваем счетчик в промокодах
        await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);

        // Записываем факт использования, чтобы не было повтора
        await supabase.from('promo_activations').insert([{ user_id: sub.id, promo_id: promo.id }]);

        return ctx.replyWithHTML(`✅ Промокод активирован!\nНачислено: <b>${promo.days}</b> дн.\nПодписка до: <b>${formatDate(newDate)}</b>`);
    } else if (ctx.message.text === '🎟 Промокод') {
        return ctx.reply('Введите ваш промокод:');
    }
});

// --- АДМИН ПАНЕЛЬ ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

bot.action('admin_menu_back', async (ctx) => {
    await ctx.answerCbQuery().catch(()=>{});
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    await ctx.editMessageText('<b>🛠 Панель управления</b>', { parse_mode: 'HTML', ...kb });
});

bot.action('admin_users', async (ctx) => {
    await ctx.answerCbQuery().catch(()=>{});
    const { data: users, count } = await supabase.from('vpn_subs').select('id, internal_name', { count: 'exact' }).limit(30);
    const buttons = users.map(u => [Markup.button.callback(u.internal_name, `manage_user_${u.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    
    await ctx.editMessageText(`<b>Список юзеров (Всего: ${count || 0}):</b>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_user_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(()=>{});
    const { data: u } = await supabase.from('vpn_subs').select('*').eq('id', ctx.match[1]).single();
    
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Выдать / Продлить (дни)', `add_days_ask_${u.id}`)],
        [Markup.button.callback('📅 Установить дату', `set_date_ask_${u.id}`), Markup.button.callback('💬 Написать', `msg_user_${u.id}`)],
        [Markup.button.callback('🗑 Аннулировать подписку', `del_sub_final_${u.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    
    ctx.editMessageText(`<b>Юзер:</b> ${u.internal_name}\n<b>Статус подписки до:</b> ${formatDate(u.expires_at)}`, { parse_mode: 'HTML', ...kb });
});

bot.action(/^del_sub_final_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Подписка аннулирована').catch(()=>{});
    await supabase.from('vpn_subs').update({ expires_at: '2000-01-01', tariff_type: 'none', profile_title: 'Psychosis VPN | Free' }).eq('id', ctx.match[1]);
    ctx.editMessageText('✅ Подписка юзера обнулена.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ К списку', 'admin_users')]]));
});

// --- СЕРВЕРА И ПРОМОКОДЫ ---
bot.action('admin_servers_list', async (ctx) => {
    await ctx.answerCbQuery().catch(()=>{});
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const buttons = servers.map(s => [Markup.button.callback(s.name, `manage_srv_${s.id}`)]);
    buttons.push([Markup.button.callback('➕ Добавить сервер', 'srv_add_new')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('<b>Управление серверами:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^manage_srv_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(()=>{});
    const { data: s } = await supabase.from('vpn_servers').select('*').eq('id', ctx.match[1]).single();
    ctx.editMessageText(`<b>Сервер:</b> ${s.name}\nVLESS: <code>${s.vless_url.substring(0, 30)}...</code>`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🗑 Удалить сервер', `srv_del_${s.id}`)], [Markup.button.callback('⬅️ Назад', 'admin_servers_list')]])
    });
});

bot.action(/^srv_del_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Удалено').catch(()=>{});
    await supabase.from('vpn_servers').delete().eq('id', ctx.match[1]);
    ctx.editMessageText('✅ Сервер удален.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_servers_list')]]));
});

bot.action('admin_promo_list', async (ctx) => {
    await ctx.answerCbQuery().catch(()=>{});
    const { data: promos } = await supabase.from('promocodes').select('*');
    if (!promos || promos.length === 0) {
        return ctx.editMessageText('Нет активных промокодов.', Markup.inlineKeyboard([[Markup.button.callback('➕ Создать', 'admin_add_promo_info')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]]));
    }
    
    ctx.deleteMessage().catch(()=>{});
    for (const p of promos) {
        await ctx.reply(`🎟 <b>${p.code}</b> | ${p.days}дн | Юзов: ${p.used_count}/${p.max_uses}`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🗑 Удалить', `del_promo_${p.id}`)]])
        });
    }
    ctx.reply('Управление:', Markup.inlineKeyboard([[Markup.button.callback('➕ Создать новый', 'admin_add_promo_info')], [Markup.button.callback('⬅️ В админку', 'admin_menu_back')]]));
});

bot.action('admin_add_promo_info', async (ctx) => {
    await ctx.answerCbQuery().catch(()=>{});
    ctx.reply('Для создания введи команду так:\n`/add_promo КОД | ТАРИФ | ДНИ | КОЛ-ВО`', { parse_mode: 'Markdown' });
});

bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add_promo ')[1]?.split('|').map(p => p.trim());
    if (!parts || parts.length < 4) return ctx.reply('❌ Ошибка! Формат: /add_promo КОД | both | 30 | 10');
    await supabase.from('promocodes').insert([{ code: parts[0], tariff_type: parts[1], days: parseInt(parts[2]), max_uses: parseInt(parts[3]), used_count: 0 }]);
    ctx.reply(`✅ Промокод ${parts[0]} успешно создан.`);
});

bot.action(/^del_promo_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Удалено').catch(()=>{});
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    ctx.deleteMessage().catch(()=>{});
});

// --- ЭКШЕНЫ СОБЫТИЙ ---
bot.action('global_msg', async (ctx) => { await ctx.answerCbQuery().catch(()=>{}); userStates[ctx.from.id] = { action: 'msg_all' }; ctx.reply('Введите текст рассылки для всех:'); });
bot.action('srv_add_new', async (ctx) => { await ctx.answerCbQuery().catch(()=>{}); userStates[ctx.from.id] = { action: 'srv_add_step1' }; ctx.reply('Пришлите VLESS ссылку нового сервер:'); });
bot.action(/^add_days_ask_(.+)$/, async (ctx) => { await ctx.answerCbQuery().catch(()=>{}); userStates[ctx.from.id] = { action: 'add_days_manual', targetId: ctx.match[1] }; ctx.reply('Сколько дней выдать/добавить?'); });
bot.action(/^set_date_ask_(.+)$/, async (ctx) => { await ctx.answerCbQuery().catch(()=>{}); userStates[ctx.from.id] = { action: 'set_date_manual', targetId: ctx.match[1] }; ctx.reply('Введите точную дату (ГГГГ-ММ-ДД):'); });
bot.action(/^msg_user_(.+)$/, async (ctx) => { await ctx.answerCbQuery().catch(()=>{}); userStates[ctx.from.id] = { action: 'msg_single', targetId: ctx.match[1] }; ctx.reply('Введите текст сообщения юзеру:'); });

bot.hears('💎 Покупка', (ctx) => ctx.reply('Для покупки обращаться к: @psychosisvpn'));
bot.hears('🎟 Промокод', (ctx) => ctx.reply('Введите ваш промокод:'));

// --- ГЛАВНЫЙ ОБРАБОТЧИК ---
module.exports = async (req, res) => {
    try { 
        if (req.method === 'POST') await bot.handleUpdate(req.body); 
    } catch (e) { 
        console.error('Bot Error:', e); 
    } finally {
        // ЭТА СТРОЧКА СПАСАЕТ ОТ ЛАГОВ. Она говорит Телеграму "Всё ок, хватит долбить сервер".
        res.status(200).send('OK'); 
    }
};
