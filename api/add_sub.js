import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.S_URL, process.env.S_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Only POST');
  const { title, internal, tariff, gb, exp, announce } = req.body;
  
  const { data } = await supabase.from('vpn_subs').insert([{
    profile_title: title,
    internal_name: internal,
    tariff_type: tariff,
    total_gb: parseInt(gb) || 0,
    expires_at: exp,
    custom_announce: announce
  }]).select().single();
  
  res.status(200).json(data);
}
