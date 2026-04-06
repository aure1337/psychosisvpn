import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.S_URL, process.env.S_KEY)

export default async function handler(req, res) {
  const { action, id, name, url, type, sort_index, vless_url } = 
    req.method === 'POST' ? JSON.parse(req.body) : req.query;

  // 1. ПОЛУЧЕНИЕ СПИСКА
  if (action === 'list') {
    const { data } = await supabase
      .from('vpn_servers')
      .select('*')
      .order('sort_index', { ascending: true }); // Важно: сортируем по индексу
    return res.json(data || []);
  }

  // 2. ОБНОВЛЕНИЕ ПОРЯДКА (Для кнопки "Вверх")
  if (action === 'update_sort') {
    const { data, error } = await supabase
      .from('vpn_servers')
      .update({ sort_index: parseInt(sort_index) })
      .eq('id', id);
    
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // 3. ДОБАВЛЕНИЕ СЕРВЕРА
  if (action === 'add') {
    const { data } = await supabase.from('vpn_servers').insert([{
      name: name,
      vless_url: url,
      tariff_type: type,
      sort_index: sort_index || 0
    }]);
    return res.json({ success: true });
  }

  // 4. УДАЛЕНИЕ
  if (action === 'delete') {
    await supabase.from('vpn_servers').delete().eq('id', id);
    return res.json({ success: true });
  }

  // 5. ПЕРЕИМЕНОВАНИЕ / ОБНОВЛЕНИЕ ДАННЫХ
if (action === 'rename') {
    const { data, error } = await supabase
      .from('vpn_servers')
      .update({ 
        name: name, 
        vless_url: vless_url // Обновляем и ссылку тоже
      })
      .eq('id', id);
    
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  res.status(404).send('Not found');
}
