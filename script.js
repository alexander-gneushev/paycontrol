(function () {
  // Инициализация Supabase — подключаемся к нашей базе данных
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

  let payments = [];
  let currentEditingId = null;

  // Здесь будем хранить данные текущего пользователя после проверки авторизации
  // Изначально null — заполнится в функции init()
  let currentUser = null;

  const submitBtn = form.querySelector('button[type="submit"]');

  // Обработчик отправки формы
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

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

  // --- Telegram модальное окно ---

  const telegramModal = document.getElementById('telegramModal');
  const telegramModalClose = document.getElementById('telegramModalClose');
  const saveTelegramIdBtn = document.getElementById('saveTelegramId');
  const editTelegramIdBtn = document.getElementById('editTelegramId');
  const telegramChatIdInput = document.getElementById('telegramChatIdInput');
  const telegramStatus = document.getElementById('telegramStatus');

  // Функция управляет состоянием поля:
  // locked=true: поле заблокировано, кнопка сохранения неактивна, карандаш виден
  // locked=false: поле активно, кнопка сохранения активна, карандаш скрыт
  function setInputLocked(locked) {
    telegramChatIdInput.disabled = locked;
    telegramChatIdInput.style.opacity = locked ? '0.5' : '1';
    saveTelegramIdBtn.disabled = locked;
    saveTelegramIdBtn.style.opacity = locked ? '0.5' : '1';
    editTelegramIdBtn.style.display = locked ? 'inline-flex' : 'none';
  }

  // Открыть модальное окно и загрузить текущий chat_id если есть
  telegramNotifyBtn.addEventListener('click', async () => {
    telegramModal.classList.add('active');
    telegramStatus.textContent = '';
    telegramStatus.className = 'modal-status';
    telegramChatIdInput.value = '';
    setInputLocked(false); // по умолчанию поле активно

    // Загружаем сохранённый chat_id из профиля
    const { data } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (data?.telegram_chat_id) {
      // ID уже есть — показываем его и блокируем поле
      telegramChatIdInput.value = data.telegram_chat_id;
      setInputLocked(true);
      telegramStatus.textContent = '✅ Telegram ID подключён. Нажмите ✒️ чтобы изменить.';
      telegramStatus.className = 'modal-status success';
    }
  });

  // Клик на карандаш — разблокируем поле для редактирования
  editTelegramIdBtn.addEventListener('click', () => {
    setInputLocked(false);
    telegramChatIdInput.focus();
    telegramStatus.textContent = '';
    telegramStatus.className = 'modal-status';
  });

  // Закрыть по кнопке ×
  telegramModalClose.addEventListener('click', () => {
    telegramModal.classList.remove('active');
  });

  // Закрыть по клику на фон
  telegramModal.addEventListener('click', (e) => {
    if (e.target === telegramModal) telegramModal.classList.remove('active');
  });

  // Сохранить chat_id в таблицу profiles
  saveTelegramIdBtn.addEventListener('click', async () => {
    const chatId = parseInt(telegramChatIdInput.value);

    if (!chatId || chatId <= 0) {
      telegramStatus.textContent = 'Введите корректный Telegram ID';
      telegramStatus.className = 'modal-status error';
      return;
    }

    saveTelegramIdBtn.disabled = true;

    // upsert = insert если записи нет, update если есть
    const { error } = await supabase
      .from('profiles')
      .upsert({ user_id: currentUser.id, telegram_chat_id: chatId }, { onConflict: 'user_id' });

    saveTelegramIdBtn.disabled = false;

    if (error) {
      telegramStatus.textContent = 'Ошибка: ' + error.message;
      telegramStatus.className = 'modal-status error';
      return;
    }

    // После сохранения снова блокируем поле
    setInputLocked(true);
    telegramStatus.textContent = '✅ Telegram ID сохранён! Уведомления будут приходить автоматически.';
    telegramStatus.className = 'modal-status success';
  });

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
      // Благодаря RLS Supabase автоматически вернёт только платежи текущего пользователя.
      // Нам не нужно явно фильтровать по user_id — база делает это сама через политики.
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
          category: paymentData.category,
          // Подставляем user_id текущего пользователя.
          // Без этого RLS-политика на INSERT отклонит запрос,
          // потому что условие (auth.uid() = user_id) не выполнится для NULL.
          user_id: currentUser.id
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
          // user_id при обновлении не трогаем — он уже правильно установлен
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

  // Функция выхода из аккаунта
  async function signOut() {
    await supabase.auth.signOut();
    // После выхода перенаправляем на страницу входа
    window.location.href = 'login.html';
  }

  // Добавляем кнопку "Выйти" в хедер динамически
  // Это позволяет не трогать HTML — всё делается из JS
  function addSignOutButton(user) {
    const headerActions = document.querySelector('.header-actions');

    // Показываем email пользователя, чтобы было понятно кто залогинен
    const userEmail = document.createElement('span');
    userEmail.className = 'user-email';
    userEmail.textContent = user.email;
    userEmail.style.cssText = 'font-size: 13px; color: var(--text-secondary); margin-right: 4px;';

    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'btn btn-ghost';
    signOutBtn.textContent = '🚪 Выйти';
    signOutBtn.type = 'button';
    signOutBtn.addEventListener('click', signOut);

    headerActions.appendChild(userEmail);
    headerActions.appendChild(signOutBtn);
  }

  async function init() {
    currentYearEl.textContent = new Date().getFullYear();
    initTheme();

    // Проверяем есть ли активная сессия у пользователя.
    // getSession() читает сессию из localStorage — это быстро, без запроса к серверу.
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      // Сессии нет — пользователь не залогинен.
      // Перенаправляем на страницу входа и прекращаем выполнение кода.
      window.location.href = 'login.html';
      return; // важно: без return код продолжит выполняться пока идёт редирект
    }

    // Сессия есть — сохраняем данные пользователя в переменную currentUser.
    // Теперь currentUser.id доступен везде в этом файле, в том числе в savePayment().
    currentUser = session.user;

    // Добавляем кнопку выхода и показываем email пользователя
    addSignOutButton(currentUser);

    // Загружаем платежи — теперь RLS автоматически отфильтрует только нужные
    loadPayments();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
