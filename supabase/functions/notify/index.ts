import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Эта функция запускается по расписанию через pg_cron.
// Она читает профили пользователей, находит платежи в ближайшие 3 дня
// и отправляет уведомления в Telegram.

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Сервисный ключ обходит RLS — нам это нужно чтобы читать
// платежи и профили ВСЕХ пользователей, а не только одного
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async () => {
  try {
    // Шаг 1: получаем всех пользователей у которых есть telegram_chat_id
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, telegram_chat_id')
      .not('telegram_chat_id', 'is', null);

    if (profilesError) throw profilesError;
    if (!profiles || profiles.length === 0) {
      return new Response('Нет пользователей с Telegram ID', { status: 200 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Дата через 3 дня — будем искать платежи в этом диапазоне
    const in3Days = new Date(today);
    in3Days.setDate(in3Days.getDate() + 3);

    const todayStr = today.toISOString().split('T')[0];
    const in3DaysStr = in3Days.toISOString().split('T')[0];

    let notificationsSent = 0;

    // Шаг 2: для каждого пользователя ищем его платежи и отправляем уведомление
    for (const profile of profiles) {
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('name, amount, payment_date, category')
        .eq('user_id', profile.user_id)
        .gte('payment_date', todayStr)
        .lte('payment_date', in3DaysStr)
        .order('payment_date', { ascending: true });

      if (paymentsError) {
        console.error(`Ошибка загрузки платежей для ${profile.user_id}:`, paymentsError);
        continue;
      }

      // Если платежей в ближайшие 3 дня нет — не беспокоим пользователя
      if (!payments || payments.length === 0) continue;

      // Шаг 3: формируем текст сообщения
      let message = `📬 <b>PayControl — напоминание о платежах</b>\n\n`;
      message += `⚠️ В ближайшие 3 дня:\n\n`;

      for (const p of payments) {
        const date = new Date(p.payment_date);
        const dateStr = date.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        const amount = Number(p.amount).toLocaleString('ru-RU', {
          style: 'currency',
          currency: 'RUB'
        });
        message += `• <b>${p.name}</b> — ${amount}\n`;
        message += `  📅 ${dateStr}\n\n`;
      }

      message += `Откройте PayControl чтобы отметить оплату.`;

      // Шаг 4: отправляем сообщение в Telegram
      const tgResponse = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: profile.telegram_chat_id,
            text: message,
            parse_mode: 'HTML'
          })
        }
      );

      const tgData = await tgResponse.json();
      if (tgData.ok) {
        notificationsSent++;
      } else {
        console.error(`Ошибка отправки в Telegram для ${profile.telegram_chat_id}:`, tgData);
      }
    }

    return new Response(
      JSON.stringify({ success: true, notificationsSent }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Ошибка функции:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
