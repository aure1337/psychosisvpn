const { createClient } = require('@supabase/supabase-js');

if (!process.env.S_URL || !process.env.S_KEY) {
  throw new Error('Missing Supabase credentials: S_URL or S_KEY');
}

const supabase = createClient(process.env.S_URL, process.env.S_KEY);

module.exports = async function handler(req, res) {
  try {
    const { id } = req.query;
    
    if (!id) {
      console.error('Missing id parameter');
      return res.status(400).send('Missing id parameter');
    }

    console.log('Fetching subscription with id:', id);
    const { data: sub, error: subError } = await supabase
      .from('vpn_subs')
      .select('*')
      .eq('id', id)
      .single();
    
    if (subError) {
      console.error('Supabase error:', subError);
      return res.status(404).send(`Subscription not found: ${subError.message}`);
    }

    if (!sub) {
      console.error('No subscription found for id:', id);
      return res.status(404).send('Subscription not found');
    }

    console.log('Subscription found:', sub.id);

    const expiryDate = new Date(sub.expires_at);
    const now = new Date();
    const diff = expiryDate - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    const expireTimestamp = Math.floor(expiryDate.getTime() / 1000);

    // Формат даты ДД.ММ.ГГГГ
    const dateFormatted = expiryDate.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const tMap = { 'both': 'Обход+Впн', 'white': 'Обход', 'base': 'Базовый Впн' };
    const currentTariff = tMap[sub.tariff_type] || sub.tariff_type;
    
    // СОРТИРОВКА ПО sort_index (чтобы порядок был как в админке)
    let query = supabase.from('vpn_servers').select('*').order('sort_index', { ascending: true });
    if (sub.tariff_type === 'base') query = query.eq('tariff_type', 'base');
    else if (sub.tariff_type === 'white') query = query.eq('tariff_type', 'white');
    const { data: servers, error: serverError } = await query;

    if (serverError) {
      console.error('Server fetch error:', serverError);
      return res.status(500).send('Error fetching servers');
    }

    let serverLinks = (servers || []).map(s => `${s.vless_url}#${encodeURIComponent(s.name)}`).join('\n');
    let links = sub.custom_servers ? sub.custom_servers + '\n' + serverLinks : serverLinks;
    
    const totalBytes = (sub.total_gb || 0) * 1024 * 1024 * 1024;
    const announce = sub.custom_announce || `@psychosisvpnm | Тариф: ${currentTariff} | До: ${dateFormatted}`;
    
    // Динамический profile-title со статусом и тарифом
    const profileTitle = `Psychosis VPN - ${currentTariff} (${days > 0 ? days : 0}д)`;
    
    const config = [
      `#profile-title: ${profileTitle}`,
      `#profile-update-interval: 1`,
      `#support-url: https://t.me/aure_ember`,
      `#announce: ${announce}`,
      `#subscription-userinfo: upload=0; download=0; total=${totalBytes}; expire=${expireTimestamp}`,
      ``,
      links
    ].join('\n');
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // Filename без кириллицы чтобы избежать ошибки
    res.setHeader('Content-Disposition', `inline; filename="Psychosis VPN.txt"`);
    res.send(config);
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).send('Internal server error: ' + error.message);
  }
};
