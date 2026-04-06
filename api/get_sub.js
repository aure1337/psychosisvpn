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

  // Формат даты ДД.ММ.ГГГГ
  const dateFormatted = expiryDate.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const tMap = { 'both': 'Обход+Впн', 'white': 'Обход', 'base': 'Базовый Впн' };
  const currentTariff = tMap[sub.tariff_type] || sub.tariff_type;
  
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('Mozilla') && !req.headers['x-requested-with']) {
      const subUrl = `https://${req.headers.host}/api/get_sub?id=${id}`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`
          <body style="background:#050000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
              <div style="max-width:400px;width:90%;padding:40px;border:1px solid #200;border-radius:30px;background:#0a0202;text-align:center;box-shadow:0 0 50px rgba(255,0,0,0.2);">
                  <h1 style="color:#f00;margin-bottom:10px;font-style:italic;">Psychosis VPN</h1>
                  <p style="opacity:0.7;">Статус: <span style="color:#0f0;font-weight:bold;">${days > 0 ? 'Действует' : 'Истекла'}</span></p>
                  <div style="background:#110505;padding:15px;border-radius:20px;margin:20px 0;text-align:left;font-size:14px;border:1px solid #200;">
                      <div style="margin-bottom:8px;">Тариф: <b>${currentTariff}</b></div>
                      <div>До: <b>${dateFormatted}</b> (${days > 0 ? days : 0} дн.)</div>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:12px;">
                      <a href="happ://import/${subUrl}" style="background:#f00;color:#fff;text-decoration:none;padding:15px;border-radius:15px;font-weight:900;font-size:13px;">ОТКРЫТЬ В HAPP (iOS/Andr)</a>
                      <a href="v2raytun://import/${subUrl}" style="background:#fff;color:#000;text-decoration:none;padding:15px;border-radius:15px;font-weight:900;font-size:13px;">ОТКРЫТЬ В V2RAYTUN</a>
                  </div>
              </div>
          </body>
      `);
  }

  // СОРТИРОВКА ПО sort_index (чтобы порядок был как в админке)
  let query = supabase.from('vpn_servers').select('*').order('sort_index', { ascending: true });
  if (sub.tariff_type === 'base') query = query.eq('tariff_type', 'base');
  else if (sub.tariff_type === 'white') query = query.eq('tariff_type', 'white');
  const { data: servers } = await query;

  let serverLinks = (servers || []).map(s => `${s.vless_url}#${encodeURIComponent(s.name)}`).join('\n');
  let links = sub.custom_servers ? sub.custom_servers + '\n' + serverLinks : serverLinks;
  
  const totalBytes = (sub.total_gb || 0) * 1024 * 1024 * 1024;
  const announce = sub.custom_announce || `@psychosisvpnm | Тариф: ${currentTariff} | До: ${dateFormatted}`;
  
  const config = [
    `profile-title: Psychosis VPN`,
    `profile-update-interval: 1`,
    `support-url: https://t.me/aure_ember`,
    `#announce: ${announce}`,
    `subscription-userinfo: upload=0; download=0; total=${totalBytes}; expire=${expireTimestamp}`,
    ``,
    links
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  // Чтобы title менялся в приложении, имя файла тоже должно быть Psychosis VPN
  res.setHeader('Content-Disposition', `attachment; filename="Psychosis VPN"`);
  res.send(Buffer.from(config).toString('base64'));
}
