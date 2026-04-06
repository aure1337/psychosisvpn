import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.S_URL, process.env.S_KEY)

export default async function handler(req, res) {
  const { id } = req.query;
  const { data: sub } = await supabase.from('vpn_subs').select('*').eq('id', id).single();
  if (!sub) return res.status(404).send('Subscription not found');

  const diff = new Date(sub.expires_at) - new Date();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  const daysText = days > 0 ? `${days} дн.` : "Истекла";

  // Собираем сервера (Глобальные + Личные)
  let query = supabase.from('vpn_servers').select('*');
  if (sub.tariff_type === 'base') query = query.eq('tariff_type', 'base');
  else if (sub.tariff_type === 'white') query = query.eq('tariff_type', 'white');
  const { data: servers } = await query;

  let links = (servers || []).map(s => `${s.vless_url}#${encodeURIComponent(s.name)}`).join('\n');
  if (sub.custom_servers) links += '\n' + sub.custom_servers;

  // Красивые названия тарифов для анонса
  const tMap = { 'base': 'Впн', 'white': 'Белый список', 'both': 'Обход+Впн' };
  const currentTariff = tMap[sub.tariff_type] || sub.tariff_type;

  const announce = sub.custom_announce || `Тариф: ${currentTariff} | Осталось: ${daysText} | Support: @aure_ember`;
  
  // profile-title теперь жестко Psychosis VPN
  const config = [
    `profile-title: Psychosis VPN`,
    `profile-update-interval: 1`,
    `#announce: ${announce}`,
    `subscription-userinfo: upload=0; download=0; total=${(sub.traffic_limit || 0) * 1024**3}; expire=${Math.floor(new Date(sub.expires_at).getTime()/1000)}`,
    ``,
    links
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(Buffer.from(config).toString('base64'));
}
