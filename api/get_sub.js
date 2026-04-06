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
  
  // Если зашли через браузер — показываем статус
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('Mozilla') && !req.headers['x-requested-with']) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(`
          <body style="background:#050000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
              <div style="padding:40px;border:1px solid #200;border-radius:30px;background:#0a0202;text-align:center;">
                  <h1 style="color:#f00;margin-bottom:10px;">Psychosis VPN</h1>
                  <p>Статус: <span style="color:#0f0">${days > 0 ? 'Действует' : 'Истекла'}</span></p>
                  <p>Тариф: <b>${sub.tariff_type.toUpperCase()}</b></p>
                  <p>Окончание: <b>${sub.expires_at}</b></p>
                  <p>Осталось: <b>${days > 0 ? days : 0} дн.</b></p>
                  <hr style="border:0;border-top:1px solid #200;margin:20px 0;">
                  <small style="opacity:0.5">ID: ${sub.id}</small>
              </div>
          </body>
      `);
  }

  // Если запрос от приложения — выдаем конфиг
  let query = supabase.from('vpn_servers').select('*');
  if (sub.tariff_type === 'base') query = query.eq('tariff_type', 'base');
  else if (sub.tariff_type === 'white') query = query.eq('tariff_type', 'white');
  const { data: servers } = await query;

  const links = (servers || []).map(s => `${s.vless_url}#${encodeURIComponent(s.name)}`).join('\n');
  
  const totalBytes = (sub.total_gb || 0) * 1024 * 1024 * 1024;
  const announce = sub.custom_announce || `Тариф: ${sub.tariff_type} | Осталось: ${days} дн. | Support: @aure_ember`;
  
  const config = [
    `profile-title: ${sub.profile_title}`,
    `profile-update-interval: 1`,
    `support-url: ${sub.support_url}`,
    `#announce: ${announce}`,
    `subscription-userinfo: upload=0; download=0; total=${totalBytes}; expire=${expireTimestamp}`,
    ``,
    links
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(Buffer.from(config).toString('base64'));
}
