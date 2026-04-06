import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.S_URL, process.env.S_KEY)

export default async function handler(req, res) {
  const body = req.body ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) : {};
  const { action, id, name, vless_url, url, type } = { ...req.query, ...body };

  if (action === 'list') {
    const { data } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    return res.status(200).json(data || []);
  }
  if (action === 'rename') {
    // ТУТ ИСПРАВЛЕНО: теперь сохраняет и имя, и ссылку
    await supabase.from('vpn_servers').update({ name, vless_url }).eq('id', id);
    return res.status(200).json({ success: true });
  }
  if (action === 'add') {
    await supabase.from('vpn_servers').insert([{ vless_url: url, name, tariff_type: type }]);
    return res.status(200).json({ success: true });
  }
  if (action === 'delete') {
    await supabase.from('vpn_servers').delete().eq('id', id);
    return res.status(200).json({ success: true });
  }
}