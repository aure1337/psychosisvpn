// Настройка в vercel.json: "crons": [{"path": "/api/check_expired", "schedule": "0 10 * * *"}]
export default async function handler(req, res) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('subscriptions').select('*').eq('expires_at', today);
    
    for (const sub of data) {
        // Тут логика отправки сообщения, если у тебя в базе сохранен chat_id пользователя
    }
    res.send('Checked');
}
