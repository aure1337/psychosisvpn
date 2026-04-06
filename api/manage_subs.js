import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.S_URL, process.env.S_KEY)

export default async function handler(req, res) {
  const method = req.method;
  const body = req.body ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) : {};
  const { action, id, data } = { ...req.query, ...body };

  if (action === 'list') {
    const { data: list } = await supabase.from('vpn_subs').select('*').order('created_at', { ascending: false });
    return res.status(200).json(list || []);
  }
  if (action === 'update') {
    await supabase.from('vpn_subs').update(data).eq('id', id);
    return res.status(200).json({ success: true });
  }
  if (action === 'delete') {
    await supabase.from('vpn_subs').delete().eq('id', id);
    return res.status(200).json({ success: true });
  }
}