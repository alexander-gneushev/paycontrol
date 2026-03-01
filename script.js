(function () {
  // Инициализация Supabase
  const supabaseUrl = 'https://dlhmcrmwndlwzaaogyoy.supabase.co';
  const supabaseKey = 'sb_publishable_h6w08Q0zo8C1ZRRU0xX5lQ_zN7wJnOF';
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

  const form = document.getElementById('paymentForm');
  const paymentsBody = document.getElementById('paymentsBody');
  const tableEmptyState = document.getElementById('tableEmptyState');
  const totalMonthlyEl = document.getElementById('totalMonthly');
  const nextPaymentEl = document.getElementById('nextPayment');
  const nextPaymentMetaEl = document.getElementById('nextPaymentMeta');
  const searchInput = document.getElementById('searchInput');

  const countSubscriptionEl = document.getElementById('countSubscription');
  const countUtilitiesEl = document.getElementById('countUtilities');
  const countCreditEl = document.getElementById('countCredit');
  const countOtherEl = document.getElementById('countOther');

  const currentYearEl = document.getElementById('currentYear');
  const themeToggleBtn = document.getElementById('themeToggle');
  const telegramNotifyBtn = document.getElementById('telegramNotify');

  // Telegram настройки
  const telegramBotToken = '8035741485:AAFGXxbJSqLOnhdeFKuEgpZtvnIejvaAJqU';
  const telegramChatId = '250941181';

  let payments = [];
  let currentEditingId = null;

  const submitBtn = form.querySelector('button[type="submit"]');

  // Обработчик отправки формы
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // Предотвращаем стандартную отправку формы

    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const amount = Number(formData.get('amount') || 0);
    const date = String(formData.get('date') || '');
    const category = String(formData.get('category') || 'other');

    if (!name || !date || !amount || amount <= 0) {
      alert('Проверьте корректность введённых данных.');
      return;
    }

    if (currentEditingId) {
      const updatedPayment = await updatePayment(currentEditingId, {
        name,
        amount,
        date,
        category
      });

      if (updatedPayment) {
        currentEditingId = null;
        submitBtn.textContent = 'Добавить платёж';
        await loadPayments();
      }
    } else {
      const newPayment = await savePayment({
        name,
        amount,
        date,
        category
      });

      if (newPayment) {
        await loadPayments();
      }
    }

    form.reset();
  });

  form.addEventListener('reset', () => {
    currentEditingId = null;
    submitBtn.textContent = 'Добавить платёж';
  });

  searchInput.addEventListener('input', () => {
    renderTable(searchInput.value);
  });

  // Функция отправки сообщения в Telegram
  async function sendTelegramMessage(message) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.description || 'Ошибка отправки сообщения');
      }

      return true;
    } catch (error) {
      console.error('Ошибка отправки в Telegram:', error);
      return false;
    }
  }

  // Функция отправки уведомлений о платежах
  async function sendPaymentNotifications() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const urgentPayments = [];
    const upcomingPayments = [];

    payments.forEach(payment => {
      const paymentDate = new Date(payment.date);
      paymentDate.setHours(0, 0, 0, 0);
      
      const daysDiff = Math.ceil((paymentDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff <= 0) {
        urgentPayments.push(payment);
      } else if (daysDiff >= 1 && daysDiff <= 7) {
        upcomingPayments.push(payment);
      }
    });

    let message = '<b>📊 Уведомления о платежах</b>\n\n';

    if (urgentPayments.length > 0) {
      message += '<b>⚠️ Срочные платежи:</b>\n';
      urgentPayments.forEach(payment => {
        message += `• ${payment.name} — ${formatCurrency(payment.amount)}, списание ${formatDate(payment.date)}\n`;
      });
      message += '\n';
    }

    if (upcomingPayments.length > 0) {
      message += '<b>📅 Предстоящие платежи:</b>\n';
      upcomingPayments.forEach(payment => {
        message += `• ${payment.name} — ${formatCurrency(payment.amount)}, списание ${formatDate(payment.date)}\n`;
      });
      message += '\n';
    }

    if (urgentPayments.length === 0 && upcomingPayments.length === 0) {
      message += '✅ Ближайших платежей нет\n\n';
    }

    const totalMonthly = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    message += `<b>💰 Общая сумма платежей в месяц: ${formatCurrency(totalMonthly)}</b>`;

    const success = await sendTelegramMessage(message);
    
    if (success) {
      // Показываем уведомление пользователю
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #22c55e, #16a34a);
        color: white;
        padding: 12px 20px;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(34, 197, 94, 0.3);
        z-index: 1000;
        font-weight: 500;
        animation: slideIn 0.3s ease-out;
      `;
      notification.textContent = '📬 Уведомления отправлены в Telegram!';
      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
          document.body.removeChild(notification);
        }, 300);
      }, 3000);
    } else {
      alert('Ошибка отправки уведомлений. Проверьте консоль для деталей.');
    }
  }

  // Обработчик кнопки уведомлений
  telegramNotifyBtn.addEventListener('click', sendPaymentNotifications);

  function formatCurrency(value) {
    const number = Number(value) || 0;
    return number.toLocaleString('ru-RU', {
      style: 'currency',
      currency: 'RUB'
    });
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  async function loadPayments() {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('payment_date', { ascending: true });

      if (error) {
        console.error('Ошибка загрузки платежей:', error);
        return;
      }

      payments = data.map(payment => ({
        id: payment.id.toString(),
        name: payment.name,
        amount: payment.amount,
        date: payment.payment_date,
        category: payment.category,
        categoryLabel: categoryLabel(payment.category)
      }));

      updateDashboard();
      renderTable('');
    } catch (e) {
      console.error('Ошибка при загрузке данных:', e);
    }
  }

  async function savePayment(paymentData) {
    try {
      console.log('Сохранение платежа:', paymentData);
      
      const { data, error } = await supabase
        .from('payments')
        .insert([{
          name: paymentData.name,
          amount: paymentData.amount,
          payment_date: paymentData.date,
          category: paymentData.category
        }])
        .select()
        .single();

      if (error) {
        console.error('Ошибка сохранения платежа:', error);
        alert('Ошибка сохранения: ' + error.message);
        return null;
      }

      console.log('Платеж успешно сохранен:', data);
      return data;
    } catch (e) {
      console.error('Ошибка при сохранении:', e);
      alert('Ошибка при сохранении: ' + e.message);
      return null;
    }
  }

  async function updatePayment(id, paymentData) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .update({
          name: paymentData.name,
          amount: paymentData.amount,
          payment_date: paymentData.date,
          category: paymentData.category
        })
        .eq('id', parseInt(id))
        .select()
        .single();

      if (error) {
        console.error('Ошибка обновления платежа:', error);
        return null;
      }

      return data;
    } catch (e) {
      console.error('Ошибка при обновлении:', e);
      return null;
    }
  }

  async function deletePayment(id) {
    try {
      const { error } = await supabase
        .from('payments')
        .delete()
        .eq('id', parseInt(id));

      if (error) {
        console.error('Ошибка удаления платежа:', error);
        return false;
      }

      return true;
    } catch (e) {
      console.error('Ошибка при удалении:', e);
      return false;
    }
  }

  function updateDashboard() {
    const now = new Date();

    const total = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    totalMonthlyEl.textContent = formatCurrency(total);

    const allPayments = payments
      .map((p) => ({ ...p, dateObj: new Date(p.date) }))
      .filter((p) => !Number.isNaN(p.dateObj.getTime()))
      .sort((a, b) => a.dateObj - b.dateObj);

    if (allPayments.length === 0) {
      nextPaymentEl.textContent = '—';
      nextPaymentMetaEl.textContent = 'Ближайших платежей нет';
    } else {
      const next = allPayments[0];
      nextPaymentEl.textContent = `${formatCurrency(next.amount)}`;
      nextPaymentMetaEl.textContent = `${next.name} — ${formatDate(next.date)}`;
    }

    const counts = {
      subscription: 0,
      utilities: 0,
      credit: 0,
      other: 0
    };

    payments.forEach((p) => {
      if (counts[p.category] !== undefined) {
        counts[p.category] += 1;
      }
    });

    countSubscriptionEl.textContent = counts.subscription;
    countUtilitiesEl.textContent = counts.utilities;
    countCreditEl.textContent = counts.credit;
    countOtherEl.textContent = counts.other;
  }

  function renderTable(filterValue) {
    paymentsBody.innerHTML = '';

    const normalizedFilter = (filterValue || '').trim().toLowerCase();
    const filtered = normalizedFilter
      ? payments.filter((p) => {
          const text = (p.name + ' ' + p.categoryLabel).toLowerCase();
          return text.includes(normalizedFilter);
        })
      : payments;

    if (filtered.length === 0) {
      tableEmptyState.style.display = 'flex';
      return;
    }

    tableEmptyState.style.display = 'none';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    filtered
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .forEach((payment) => {
        const tr = document.createElement('tr');

        const dueDate = new Date(payment.date);
        dueDate.setHours(0, 0, 0, 0);
        const msDiff = dueDate.getTime() - today.getTime();
        const daysDiff = msDiff / (1000 * 60 * 60 * 24);

        if (daysDiff <= 0) {
          tr.classList.add('row-warning');
        }

        const nameTd = document.createElement('td');
        const nameText = document.createElement('span');
        nameText.textContent = payment.name;
        nameTd.appendChild(nameText);

        const amountTd = document.createElement('td');
        amountTd.textContent = formatCurrency(payment.amount);

        const dateTd = document.createElement('td');
        dateTd.textContent = formatDate(payment.date);

        const categoryTd = document.createElement('td');
        categoryTd.textContent = payment.categoryLabel;

        const actionsTd = document.createElement('td');
        actionsTd.className = 'table-actions-cell';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'icon-btn icon-btn-edit';
        editBtn.title = 'Редактировать платёж';
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', async () => {
          currentEditingId = payment.id;
          form.name.value = payment.name;
          form.amount.value = payment.amount;
          form.date.value = payment.date;
          form.category.value = payment.category;
          submitBtn.textContent = 'Сохранить изменения';
          form.name.focus();
        });

        const paidBtn = document.createElement('button');
        paidBtn.type = 'button';
        paidBtn.className = 'icon-btn icon-btn-success';
        paidBtn.title = 'Отметить как оплачено и перенести дату';
        paidBtn.textContent = '✔';
        paidBtn.addEventListener('click', async () => {
          const currentDate = new Date(payment.date);
          if (Number.isNaN(currentDate.getTime())) return;

          const nextMonthDate = new Date(currentDate);
          nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);

          const year = nextMonthDate.getFullYear();
          const month = String(nextMonthDate.getMonth() + 1).padStart(2, '0');
          const day = String(nextMonthDate.getDate()).padStart(2, '0');

          const updatedPayment = await updatePayment(payment.id, {
            name: payment.name,
            amount: payment.amount,
            date: `${year}-${month}-${day}`,
            category: payment.category
          });

          if (updatedPayment) {
            await loadPayments();
          }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'icon-btn icon-btn-danger';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Удалить платёж';
        deleteBtn.addEventListener('click', async () => {
          const success = await deletePayment(payment.id);
          if (success) {
            await loadPayments();
          }
        });

        actionsTd.appendChild(editBtn);
        actionsTd.appendChild(paidBtn);
        actionsTd.appendChild(deleteBtn);

        tr.appendChild(nameTd);
        tr.appendChild(amountTd);
        tr.appendChild(dateTd);
        tr.appendChild(categoryTd);
        tr.appendChild(actionsTd);

        paymentsBody.appendChild(tr);
      });
  }

  function categoryLabel(value) {
    switch (value) {
      case 'subscription':
        return 'Подписка';
      case 'utilities':
        return 'ЖКХ';
      case 'credit':
        return 'Кредит';
      default:
        return 'Другое';
    }
  }

  function initTheme() {
    const stored = localStorage.getItem('paycontrol_theme');
    const prefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    const theme = stored || (prefersDark ? 'dark' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
    themeToggleBtn.textContent = theme === 'dark' ? 'Тёмная тема' : 'Светлая тема';
  }

  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    themeToggleBtn.textContent = next === 'dark' ? 'Тёмная тема' : 'Светлая тема';
    try {
      localStorage.setItem('paycontrol_theme', next);
    } catch (e) {
      console.warn('Не удалось сохранить тему', e);
    }
  });

  function init() {
    currentYearEl.textContent = new Date().getFullYear();
    initTheme();
    loadPayments();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
