import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.S_URL, process.env.S_KEY)

export default async function handler(req, res) {
  const { id } = req.query;
  const { data: sub } = await supabase.from('vpn_subs').select('*').eq('id', id).single();
  if (!sub) return res.status(404).send('Subscription not found');

  const diff = new Date(sub.expires_at) - new Date();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  const daysText = days > 0 ? `${days} дн.` : "Истекла";

  // Смена названий тарифов
  const tMap = { 'base': 'Впн', 'white': 'Белый список', 'both': 'Обход + Впн' };
  const currentTariff = tMap[sub.tariff_type] || sub.tariff_type;

  // Логика для браузера
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('Mozilla') && !req.headers['x-requested-with']) {
      const subUrl = `https://${req.headers.host}/api/get_sub?id=${id}`;
      const base64Url = Buffer.from(subUrl).toString('base64');
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`
          <body style="background:#050000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;">
              <div style="max-width:400px;width:100%;padding:40px;border:1px solid #200;border-radius:30px;background:#0a0202;text-align:center;box-shadow:0 0 50px rgba(255,0,0,0.1);">
                  <h1 style="color:#f00;margin:0 0 10px 0;font-style:italic;">Psychosis VPN</h1>
                  <p style="opacity:0.6;font-size:14px;">Статус: <span style="color:#0f0;font-weight:bold;">${days > 0 ? 'Действует' : 'Истекла'}</span></p>
                  <div style="background:#110505;padding:15px;border-radius:20px;margin:20px 0;text-align:left;font-size:14px;">
                      <div style="margin-bottom:8px;">Тариф: <b>${currentTariff}</b></div>
                      <div>До: <b>${sub.expires_at}</b> (${daysText})</div>
                  </div>
                  
                  <div style="display:flex;flex-direction:column;gap:12px;">
                      <a href="happ://import/${subUrl}" style="background:#f00;color:#white;text-decoration:none;padding:15px;border-radius:15px;font-weight:bold;font-size:13px;">ОТКРЫТЬ В HAPP</a>
                      <a href="v2raytun://import/${subUrl}" style="background:#fff;color:#000;text-decoration:none;padding:15px;border-radius:15px;font-weight:bold;font-size:13px;">ОТКРЫТЬ В V2RAYTUN</a>
                      <button onclick="navigator.clipboard.writeText('${subUrl}');alert('Скопировано!')" style="background:transparent;color:#666;border:1px solid #222;padding:10px;border-radius:15px;cursor:pointer;font-size:11px;">КОПИРОВАТЬ ССЫЛКУ</button>
                  </div>
              </div>
          </body>
      `);
  }

  // Логика для приложений
  let query = supabase.from('vpn_servers').select('*');
  if (sub.tariff_type === 'base') query = query.eq('tariff_type', 'base');
  else if (sub.tariff_type === 'white') query = query.eq('tariff_type', 'white');
  const { data: servers } = await query;

  let links = (servers || []).map(s => `${s.vless_url}#${encodeURIComponent(s.name)}`).join('\n');
  if (sub.custom_servers) links += '\n' + sub.custom_servers;

  const announce = sub.custom_announce || `@psychosisvpnm | Тариф: ${currentTariff} | До: ${sub.expires_at}`;
  
  const config = [
    `profile-title: Psychosis VPN`,
    `profile-update-interval: 1`,
    `#announce: ${announce}`,
    `subscription-userinfo: upload=0; download=0; total=${(sub.traffic_limit || 0) * 1024**3}; expire=${Math.floor(new Date(sub.expires_at).getTime()/1000)}`,
    ``,
    links
  ].join('\n');
  
  // ЭТИ СТРОКИ ЧИНЯТ НАЗВАНИЕ В ПРИЛОЖЕНИЯХ
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Subscription-Userinfo', `upload=0; download=0; total=${(sub.traffic_limit || 0) * 1024**3}; expire=${Math.floor(new Date(sub.expires_at).getTime()/1000)}`);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('Psychosis VPN')}`);
  
  res.send(Buffer.from(config).toString('base64'));
}
