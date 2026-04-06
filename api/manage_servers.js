import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.S_URL, process.env.S_KEY)

export default async function handler(req, res) {
  // Добавляем заголовки, чтобы избежать проблем с CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Определяем параметры из запроса
    const body = req.body || {};
    const query = req.query || {};
    
    const action = body.action || query.action;
    const id = body.id || query.id;
    const name = body.name;
    const url = body.url; // для vless_url при добавлении
    const vless_url = body.vless_url; // для vless_url при обновлении (rename)
    const type = body.type;
    const sort_index = body.sort_index;

    // 1. ПОЛУЧЕНИЕ СПИСКА
    if (action === 'list') {
      const { data, error } = await supabase
        .from('vpn_servers')
        .select('*')
        .order('sort_index', { ascending: true });
      
      if (error) throw error;
      return res.status(200).json(data || []);
    }

    // 2. ОБНОВЛЕНИЕ ПОРЯДКА
    if (action === 'update_sort') {
      const { error } = await supabase
        .from('vpn_servers')
        .update({ sort_index: parseInt(sort_index) })
        .eq('id', id);
      
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    // 3. ДОБАВЛЕНИЕ СЕРВЕРА
    if (action === 'add') {
      const { error } = await supabase.from('vpn_servers').insert([{
        name: name,
        vless_url: url,
        tariff_type: type,
        sort_index: sort_index || 0
      }]);
      
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    // 4. УДАЛЕНИЕ
    if (action === 'delete') {
      const { error } = await supabase.from('vpn_servers').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    // 5. ПЕРЕИМЕНОВАНИЕ И ОБНОВЛЕНИЕ ДАННЫХ (Ваша ошибка была тут)
    if (action === 'rename') {
      if (!id) return res.status(400).json({ error: 'Missing ID' });

      const { error } = await supabase
        .from('vpn_servers')
        .update({ 
          name: name, 
          vless_url: vless_url 
        })
        .eq('id', id);
      
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(404).json({ error: 'Action not found' });

  } catch (err) {
    console.error('Server Error:', err);
    // Отправляем чистый JSON даже при ошибке, чтобы админка не ругалась на синтаксис
    return res.status(500).json({ error: err.message });
  }
}
