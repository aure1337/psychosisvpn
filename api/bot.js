const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.S_URL, process.env.S_KEY);

const ADMINS = [1192691079, 7761584076, 6443614614];
const userStates = {};
const TELEGRAM_ADMIN = '@aure_ember';

const TARIFF_MAP = {
    'both': 'Обход и Впн',
    'white': 'Обход',
    'base': 'Базовый Впн',
    'none': 'Нету'
};

const PRICES = [
    { days: 30, price: 65, label: '1 месяц - 65₽ (-5%)' },
    { days: 90, price: 150, label: '3 месяца - 150₽ (-25%)' },
    { days: 180, price: 350, label: '6 месяцев - 350₽ (-10%)' },
    { days: 365, price: 590, label: '12 месяцев - 590₽ (-25%)' }
];

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
    const buttons = [['👤 Профиль', '💎 Покупка'], ['🎟 Промокод']];
    if (ADMINS.includes(ctx.from.id)) buttons.push(['🛠 Админ-панель']);
    return Markup.keyboard(buttons).resize();
}

function generateGiftCode() {
    return 'GIFT_' + Math.random().toString(36).substring(2, 12).toUpperCase();
}

// --- ФУНКЦИЯ АКТИВАЦИИ ПРОМОКОДА / ПОДАРКА ---
async function processPromoCode(ctx, userId, code) {
    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', code).maybeSingle();
    if (!promo) return ctx.reply('❌ Такого промокода или подарка не существует.');
    
    const { data: sub } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId.toString()).maybeSingle();
    if (promo.used_count >= promo.max_uses) return ctx.reply('❌ Этот промокод/подарок уже был использован.');
    
    const { data: used } = await supabase.from('promo_activations').select('id').eq('user_id', sub.id).eq('promo_id', promo.id).maybeSingle();
    if (used) return ctx.reply('❌ Вы уже активировали этот код.');

    if (promo.bonus_rub && promo.bonus_rub > 0) {
        await supabase.from('vpn_subs').update({ balance: (sub.balance || 0) + promo.bonus_rub }).eq('id', sub.id);
        await ctx.replyWithHTML(`🎉 <b>Подарок активирован!</b>\nНа ваш баланс зачислено: <b>${promo.bonus_rub}₽</b>`);
    } else {
        const newDate = addDaysToDate(sub.expires_at, promo.days);
        await supabase.from('vpn_subs').update({ 
            expires_at: newDate, 
            tariff_type: promo.tariff_type || 'both', 
            profile_title: 'Psychosis VPN | Premium' 
        }).eq('id', sub.id);
        await ctx.replyWithHTML(`🎉 <b>Подарок/Промокод активирован!</b>\nДобавлено: <b>${promo.days} дн.</b>\nДо: <b>${formatDate(newDate)}</b>`);
    }

    await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);
    await supabase.from('promo_activations').insert([{ user_id: sub.id, promo_id: promo.id }]);
}

// --- СТАРТ ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'User');
    const { data: exists } = await supabase.from('vpn_subs').select('id').eq('tg_chat_id', userId).maybeSingle();
    
    if (!exists) {
        await supabase.from('vpn_subs').insert([{
            internal_name: username, tg_chat_id: userId, tariff_type: 'none',
            expires_at: '2000-01-01', profile_title: 'Psychosis VPN | Free',
            test_used: false, balance: 0
        }]);
    } else {
        await supabase.from('vpn_subs').update({ internal_name: username }).eq('tg_chat_id', userId);
    }
    
    await ctx.reply('Psychosis VPN запущен!', await getMainMenu(ctx));

    // Проверяем, есть ли payload (переход по ссылке подарка /start GIFT_...)
    if (ctx.payload) {
        await processPromoCode(ctx, userId, ctx.payload);
    }
});

// --- ПРОФИЛЬ ---
bot.hears('👤 Профиль', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();
    
    const today = new Date().toISOString().split('T')[0];
    const isExpired = !s || s.expires_at === '2000-01-01' || s.expires_at < today;
    const subUrl = `https://psychosisvpn.vercel.app/api/get_sub?id=${s?.id}`;
    
    const report = `👤 Профиль: <b>${s?.internal_name || ctx.from.first_name}</b>\n💰 Баланс: <b>${s?.balance || 0}₽</b>\n🕗 До: <b>${isExpired ? '-' : formatDate(s.expires_at)}</b>\n💎 Тариф: <b>${isExpired ? 'Нету' : (TARIFF_MAP[s.tariff_type] || 'Нету')}</b>\n\n🔗 <code>${subUrl}</code>`;
    
    const inlineButtons = [];
    inlineButtons.push([Markup.button.callback('💳 Пополнить баланс', 'topup_init')]);

    if (!s?.test_used && (isExpired || s?.tariff_type === 'none')) {
        inlineButtons.push([Markup.button.callback('🎁 Взять тест-период (5 дн.)', 'activate_test_profile')]);
    }
    inlineButtons.push([Markup.button.callback('🎟 Ввести промокод', 'enter_promo_inline')]);

    await ctx.replyWithHTML(report, Markup.inlineKeyboard(inlineButtons));
});

bot.action('topup_init', async (ctx) => {
    ctx.answerCbQuery();
    const adminUsername = TELEGRAM_ADMIN.replace('@', '');
    ctx.replyWithHTML(
        `💳 <b>Пополнение баланса</b>\n\n` +
        `Напиши в личные сообщения:\n` +
        `<code>${TELEGRAM_ADMIN}</code>\n\n` +
        `Укажи сумму пополнения, и мы добавим деньги на твой баланс! 💰`,
        Markup.inlineKeyboard([[Markup.button.url('💬 Написать в Telegram', `https://t.me/${adminUsername}`)]])
    );
});

bot.action('activate_test_profile', async (ctx) => {
    const userId = ctx.from.id.toString();
    const { data: user } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();

    if (user?.test_used) return ctx.answerCbQuery('❌ Вы уже использовали тестовый период!', { show_alert: true });

    const newDate = addDaysToDate('2000-01-01', 5); 
    await supabase.from('vpn_subs').update({ 
        tariff_type: 'both', expires_at: newDate, profile_title: 'Psychosis VPN | TEST', test_used: true 
    }).eq('tg_chat_id', userId);

    await ctx.answerCbQuery('✅ Тест на 5 дней активирован!', { show_alert: true });
    ctx.replyWithHTML('✅ Тест активирован! Перезайдите в 👤 Профиль.');
});

bot.action('enter_promo_inline', (ctx) => {
    ctx.reply('🎟 Введите ваш промокод:');
    ctx.answerCbQuery();
});

// --- ПОКУПКА ---
bot.hears('💎 Покупка', async (ctx) => {
    const buttons = PRICES.map((p, i) => [Markup.button.callback(p.label, `buy_select_${i}`)]);
    buttons.push([Markup.button.callback('💳 Пополнить баланс', 'topup_init')]);
    ctx.replyWithHTML('<b>Выберите период подписки:</b>\n<i>Тариф: Обход и Впн</i>', Markup.inlineKeyboard(buttons));
});

// Шаг 1: Выбор тарифа
bot.action(/^buy_select_(\d+)$/, async (ctx) => {
    const idx = ctx.match[1];
    const pkg = PRICES[idx];
    ctx.editMessageText(`Вы выбрали: <b>${pkg.label}</b> за ${pkg.price}₽.\n\nЧто вы хотите сделать?`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Купить себе', `buy_confirm_${idx}`)],
            [Markup.button.callback('🎁 Купить в подарок', `buy_gift_${idx}`)],
            [Markup.button.callback('⬅️ Назад', 'buy_menu_back')]
        ])
    });
});

// Кнопка Назад в покупках
bot.action('buy_menu_back', async (ctx) => {
    const buttons = PRICES.map((p, i) => [Markup.button.callback(p.label, `buy_select_${i}`)]);
    buttons.push([Markup.button.callback('💳 Пополнить баланс', 'topup_init')]);
    ctx.editMessageText('<b>Выберите период подписки:</b>\n<i>Тариф: Обход и Впн</i>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

// Шаг 2А: Подтверждение покупки себе
bot.action(/^buy_confirm_(\d+)$/, async (ctx) => {
    const pkg = PRICES[ctx.match[1]];
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();

    if ((s.balance || 0) < pkg.price) return ctx.answerCbQuery(`❌ Недостаточно средств! Ваш баланс: ${s.balance || 0}₽`, { show_alert: true });

    const newDate = addDaysToDate(s.expires_at, pkg.days);
    await supabase.from('vpn_subs').update({ 
        balance: s.balance - pkg.price, expires_at: newDate, tariff_type: 'both', profile_title: 'Psychosis VPN | Premium'
    }).eq('id', s.id);

    ctx.editMessageText(`✅ Вы успешно приобрели тариф "Обход и Впн" на ${pkg.days} дн.!\nСписано: ${pkg.price}₽\nВаша подписка активна до: ${formatDate(newDate)}`);
});

// Шаг 2Б: Покупка в подарок
bot.action(/^buy_gift_(\d+)$/, async (ctx) => {
    const pkg = PRICES[ctx.match[1]];
    const userId = ctx.from.id.toString();
    const { data: s } = await supabase.from('vpn_subs').select('*').eq('tg_chat_id', userId).maybeSingle();

    if ((s.balance || 0) < pkg.price) return ctx.answerCbQuery(`❌ Недостаточно средств! Ваш баланс: ${s.balance || 0}₽`, { show_alert: true });

    // Списываем баланс
    await supabase.from('vpn_subs').update({ balance: s.balance - pkg.price }).eq('id', s.id);
    
    // Генерируем подарок
    const giftCode = generateGiftCode();
    await supabase.from('promocodes').insert([{ 
        code: giftCode, tariff_type: 'both', days: pkg.days, max_uses: 1, bonus_rub: 0, used_count: 0 
    }]);

    const botInfo = await ctx.telegram.getMe();
    const giftLink = `https://t.me/${botInfo.username}?start=${giftCode}`;

    ctx.editMessageText(
        `🎁 <b>Подарок успешно создан!</b>\n\nСписано: ${pkg.price}₽\nТариф: Обход и Впн (${pkg.days} дн.)\n\nПерешлите эту ссылку другу для активации:\n👉 <code>${giftLink}</code>`, 
        { parse_mode: 'HTML' }
    );
});

// --- АДМИН-ПАНЕЛЬ ГЛАВНАЯ ---
bot.hears('🛠 Админ-панель', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('🎁 Создать подарок', 'admin_create_gift_menu')],
        [Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    ctx.replyWithHTML('<b>🛠 Панель управления</b>', kb);
});

bot.action('admin_menu_back', async (ctx) => {
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Юзеры', 'admin_users'), Markup.button.callback('🖥 Сервера', 'admin_servers_list')],
        [Markup.button.callback('🎟 Промокоды', 'admin_promo_list'), Markup.button.callback('🎁 Создать подарок', 'admin_create_gift_menu')],
        [Markup.button.callback('📢 Рассылка', 'global_msg')]
    ]);
    await ctx.editMessageText('<b>🛠 Панель управления</b>', { parse_mode: 'HTML', ...kb });
});

// --- АДМИНКА: СОЗДАНИЕ ПОДАРКОВ ---
bot.action('admin_create_gift_menu', (ctx) => {
    ctx.editMessageText('<b>Что будем дарить?</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⏳ Дни подписки', 'adm_gift_type_days'), Markup.button.callback('💰 Рубли', 'adm_gift_type_rub')],
            [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]
        ])
    });
});

bot.action('adm_gift_type_days', (ctx) => {
    userStates[ctx.from.id] = { action: 'admin_gift_days_create' };
    ctx.reply('Введите количество дней для подарка (тариф Both):');
    ctx.answerCbQuery();
});

bot.action('adm_gift_type_rub', (ctx) => {
    userStates[ctx.from.id] = { action: 'admin_gift_rub_create' };
    ctx.reply('Введите сумму в рублях для подарка:');
    ctx.answerCbQuery();
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
        [Markup.button.callback('💰 Выдать рубли', `adm_add_bal_${u.id}`), Markup.button.callback('💎 Изменить тариф', `adm_sel_trf_${u.id}`)],
        [Markup.button.callback('💬 Написать', `msg_user_${u.id}`), Markup.button.callback('🗑 Аннулировать', `del_sub_final_${u.id}`)],
        [Markup.button.callback('⬅️ Назад', 'admin_users')]
    ]);
    ctx.editMessageText(`<b>Юзер:</b> ${u.internal_name}\n<b>До:</b> ${formatDate(u.expires_at)}\n<b>Баланс:</b> ${u.balance || 0}₽`, { parse_mode: 'HTML', ...kb });
});

bot.action(/^adm_add_bal_(.+)$/, (ctx) => {
    userStates[ctx.from.id] = { action: 'add_balance_manual', targetId: ctx.match[1] };
    ctx.reply('Введите сумму в рублях для зачисления:');
    ctx.answerCbQuery();
});

bot.action(/^msg_user_(.+)$/, async (ctx) => {
    const uid = ctx.match[1];
    userStates[ctx.from.id] = { action: 'msg_single_user', targetId: uid };
    ctx.reply('Введите сообщение для пользователя:');
    ctx.answerCbQuery();
});

bot.action(/^del_sub_final_(.+)$/, async (ctx) => {
    const uid = ctx.match[1];
    await supabase.from('vpn_subs').update({ expires_at: '2000-01-01', tariff_type: 'none', profile_title: 'Psychosis VPN | Free' }).eq('id', uid);
    ctx.answerCbQuery('✅ Подписка аннулирована');
    ctx.editMessageText('✅ Подписка аннулирована.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ К юзерам', 'admin_users')]]));
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

// --- АДМИНКА: ПРОМОКОДЫ И СЕРВЕРА ---
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
    ctx.editMessageText(`🎟 <b>${p.code}</b>\nДает: ${p.days} дн. | ${p.bonus_rub || 0}₽\nЮзов: ${p.used_count}/${p.max_uses}\nТариф: ${TARIFF_MAP[p.tariff_type]}`, { parse_mode: 'HTML', ...kb });
});

bot.action('admin_promo_add', (ctx) => {
    ctx.reply('Для создания используй команду:\n`/add_promo КОД | both | ДНИ | КОЛ_ВО | РУБЛИ`', { parse_mode: 'Markdown' });
});

bot.action(/^promo_res_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').update({ used_count: 0 }).eq('id', ctx.match[1]);
    await supabase.from('promo_activations').delete().eq('promo_id', ctx.match[1]);
    ctx.editMessageText('✅ Промокод обнулен.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_promo_list')]]));
});

bot.action(/^promo_lim_(.+)$/, (ctx) => { userStates[ctx.from.id] = { action: 'promo_limit', targetId: ctx.match[1] }; ctx.reply('Введите НОВОЕ общее количество активаций:'); });
bot.action(/^promo_day_(.+)$/, (ctx) => { userStates[ctx.from.id] = { action: 'promo_days', targetId: ctx.match[1] }; ctx.reply('Сколько дней теперь будет давать промо?'); });
bot.action(/^promo_del_(.+)$/, async (ctx) => {
    await supabase.from('promocodes').delete().eq('id', ctx.match[1]);
    ctx.editMessageText('✅ Удалено.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'admin_promo_list')]]));
});

bot.action('admin_servers_list', async (ctx) => {
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const buttons = (servers || []).map(s => [Markup.button.callback(s.name, `manage_srv_${s.id}`)]);
    buttons.push([Markup.button.callback('➕ Добавить сервер', 'srv_add_new')], [Markup.button.callback('⬅️ Назад', 'admin_menu_back')]);
    ctx.editMessageText('<b>Сервера:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
});

bot.action('global_msg', (ctx) => { 
    userStates[ctx.from.id] = { action: 'msg_all' }; 
    ctx.reply('Введите текст рассылки:'); 
    ctx.answerCbQuery();
});

// --- ОБРАБОТКА ТЕКСТА (STATE MACHINE) ---
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
        else if (state.action === 'add_balance_manual') {
            const amount = parseInt(input);
            if (isNaN(amount)) return ctx.reply('Введите корректное число:');
            const { data: u } = await supabase.from('vpn_subs').select('balance').eq('id', state.targetId).single();
            await supabase.from('vpn_subs').update({ balance: (u.balance || 0) + amount }).eq('id', state.targetId);
            ctx.reply(`✅ Баланс юзера успешно пополнен на ${amount}₽.`);
        }
        else if (state.action === 'admin_gift_days_create') {
            const days = parseInt(input);
            if (isNaN(days)) return ctx.reply('Введите число:');
            const giftCode = generateGiftCode();
            await supabase.from('promocodes').insert([{ code: giftCode, tariff_type: 'both', days: days, max_uses: 1, bonus_rub: 0, used_count: 0 }]);
            const botInfo = await ctx.telegram.getMe();
            ctx.replyWithHTML(`✅ <b>Подарок на ${days} дней создан!</b>\n\nСсылка: <code>https://t.me/${botInfo.username}?start=${giftCode}</code>`);
        }
        else if (state.action === 'admin_gift_rub_create') {
            const rub = parseInt(input);
            if (isNaN(rub)) return ctx.reply('Введите число:');
            const giftCode = generateGiftCode();
            await supabase.from('promocodes').insert([{ code: giftCode, tariff_type: 'none', days: 0, max_uses: 1, bonus_rub: rub, used_count: 0 }]);
            const botInfo = await ctx.telegram.getMe();
            ctx.replyWithHTML(`✅ <b>Подарок на ${rub}₽ создан!</b>\n\nСсылка: <code>https://t.me/${botInfo.username}?start=${giftCode}</code>`);
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
            let successCount = 0;
            for (const u of users) { 
                try { 
                    await bot.telegram.sendMessage(u.tg_chat_id, `📢 Рассылка:\n\n${input}`); 
                    successCount++;
                } catch(e){}  
            }
            ctx.reply(`✅ Рассылка завершена. Доставлено: ${successCount}`);
        }
        else if (state.action === 'msg_single_user') {
            const { data: u } = await supabase.from('vpn_subs').select('tg_chat_id').eq('id', state.targetId).single();
            if (u) {
                try {
                    await bot.telegram.sendMessage(u.tg_chat_id, `✉️ Сообщение от администрации:\n\n${input}`);
                    ctx.reply('✅ Сообщение успешно отправлено пользователю.');
                } catch(e) {
                    ctx.reply('❌ Ошибка отправки. Возможно, юзер заблокировал бота.');
                }
            }
        }
        delete userStates[userId];
        return;
    }

    if (input === '🎟 Промокод') return ctx.reply('Введите ваш промокод:');

    // Активация промокода текстом (вызываем ту же функцию)
    await processPromoCode(ctx, userId, input);

    return next();
});

bot.command('add_promo', async (ctx) => {
    if (!ADMINS.includes(ctx.from.id)) return;
    const p = ctx.message.text.split('/add_promo ')[1]?.split('|').map(x => x.trim());
    if (!p || p.length < 5) return ctx.reply('Формат: /add_promo КОД | ТАРИФ | ДНИ | КОЛ_ВО | РУБЛИ');
    await supabase.from('promocodes').insert([{ 
        code: p[0], tariff_type: p[1], days: parseInt(p[2]), max_uses: parseInt(p[3]), bonus_rub: parseInt(p[4]), used_count: 0 
    }]);
    ctx.reply(`✅ Промокод ${p[0]} создан!`);
});

// --- ВЕБХУК VERCEL ---
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') await bot.handleUpdate(req.body); 
    } 
    catch (e) { console.error('Error:', e); } 
    finally { res.status(200).send('OK'); }
};
