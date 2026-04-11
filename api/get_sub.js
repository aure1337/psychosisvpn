import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.S_URL, process.env.S_KEY)

export default async function handler(req, res) {
  const { id } = req.query;
  const { data: sub } = await supabase.from('vpn_subs').select('*').eq('id', id).single();
  
  if (!sub) return res.status(404).send('Subscription not found');

  const expiryDate = new Date(sub.expires_at);
  const now = new Date();
  const diff = expiryDate - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  const expireTimestamp = Math.floor(expiryDate.getTime() / 1000);
  
  // Проверка на активность
  const todayStr = new Date().toISOString().split('T')[0];
  const isExpired = sub.expires_at === '2000-01-01' || sub.expires_at < todayStr;

  const dateFormatted = expiryDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const tMap = { 'both': 'Обход и Впн', 'white': 'Обход', 'base': 'Базовый Впн' };
  const currentTariff = isExpired ? 'Нету' : (tMap[sub.tariff_type] || sub.tariff_type);
  
  const subUrl = `https://${req.headers.host}/api/get_sub?id=${id}`;

  if (req.headers['user-agent']?.includes('Mozilla') && !req.headers['x-requested-with']) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`
          <body style="background:#050000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
              <div style="max-width:400px;width:90%;padding:40px;border:1px solid #200;border-radius:30px;background:#0a0202;text-align:center;box-shadow:0 0 50px rgba(255,0,0,0.2);">
                  <h1 style="color:#f00;margin-bottom:10px;font-style:italic;">Psychosis VPN</h1>
                  <p style="opacity:0.7;">Юзер: <span style="color:#fff;">${sub.internal_name}</span></p>
                  <p style="opacity:0.7;">Статус: <span style="color:${isExpired ? '#f00' : '#0f0'};font-weight:bold;">${isExpired ? 'Истекла' : 'Действует'}</span></p>
                  <div style="background:#110505;padding:15px;border-radius:20px;margin:20px 0;text-align:left;font-size:14px;border:1px solid #200;">
                      <div style="margin-bottom:8px;">Тариф: <b>${currentTariff}</b></div>
                      <div>До: <b>${isExpired ? '-' : dateFormatted}</b></div>
                  </div>
                  <a href="v2raytun://import/${subUrl}" style="background:#fff;color:#000;text-decoration:none;padding:15px;border-radius:15px;font-weight:900;display:block;">ОТКРЫТЬ В V2RAYTUN</a>
              </div>
          </body>
      `);
  }

  let links = "";
  let announce = "";

  if (isExpired) {
    // Если подписка кончилась
    announce = `Ваша подписка закончилась, оплатите ее в боте: @psychosisvpn_bot | Поддержка @aure_ember`;
    links = `vless://95557ad5-5d90-4f80-a1e2-a72fda60ca4b@tr2.psychosis.online:443?type=xhttp&path=%2Fapi%2Fv1%2Fupdate&host=www.amd.com&mode=packet-up&security=reality&fp=chrome&pbk=tUPkeHSKsD6p2HxTzEsco7vwStKP96ZmsWxaiLL6LXQ&sni=www.amd.com&sid=3c6a9a085be490f2#Оплатите подписку - @psychosisvpn_bot`;
  } else {
    // Если всё ок — грузим реальные сервера
    let query = supabase.from('vpn_servers').select('*').order('sort_index', { ascending: true });
    if (sub.tariff_type === 'base') query = query.eq('tariff_type', 'base');
    else if (sub.tariff_type === 'white') query = query.eq('tariff_type', 'white');
    const { data: servers } = await query;
    links = (servers || []).map(s => `${s.vless_url}#${encodeURIComponent(s.name)}`).join('\n');
    if (sub.custom_servers) links = sub.custom_servers + '\n' + links;
    announce = `${sub.internal_name} | Тариф: ${currentTariff} | Осталось: ${days} дн. | Поддержка: @aure_ember`;
  }
  
  const totalBytes = (sub.total_gb || 0) * 1024 * 1024 * 1024;
  const config = [
    `#profile-title: Psychosis VPN`,
    `#profile-web-page-url: ${subUrl}`,
    `#announce: ${announce}`,
    `#subscription-userinfo: upload=0; download=0; total=${totalBytes}; expire=${expireTimestamp}`,
    ``,
    links
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(Buffer.from(config).toString('base64'));
}
