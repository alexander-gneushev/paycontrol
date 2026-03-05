(function () {
  // Инициализация PocketBase — подключаемся к нашему серверу.
  // В Supabase был отдельный URL и anon key, здесь только URL нашего сервера.
  // PocketBase сам хранит токен авторизации в localStorage и добавляет его к каждому запросу.
  const pb = new PocketBase('https://paycontrol.dcmr.ru/pb');

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

  // currentUser — данные залогиненного пользователя.
  // В Supabase это был session.user, в PocketBase это pb.authStore.model —
  // объект с полями id, email, telegram_chat_id и т.д.
  let currentUser = null;

  const submitBtn = form.querySelector('button[type="submit"]');

  // Обработчик отправки формы — без изменений в логике, только вызовы функций те же
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
      const updatedPayment = await updatePayment(currentEditingId, { name, amount, date, category });
      if (updatedPayment) {
        currentEditingId = null;
        submitBtn.textContent = 'Добавить платёж';
        await loadPayments();
      }
    } else {
      const newPayment = await savePayment({ name, amount, date, category });
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

  function setInputLocked(locked) {
    telegramChatIdInput.disabled = locked;
    telegramChatIdInput.style.opacity = locked ? '0.5' : '1';
    saveTelegramIdBtn.disabled = locked;
    saveTelegramIdBtn.style.opacity = locked ? '0.5' : '1';
    editTelegramIdBtn.style.display = locked ? 'inline-flex' : 'none';
  }

  // Открыть модальное окно.
  // В Supabase telegram_chat_id хранился в отдельной таблице profiles и нужен был отдельный запрос.
  // В PocketBase это просто поле на записи пользователя — pb.authStore.model.telegram_chat_id.
  // Данные уже есть в памяти, запрос к серверу не нужен.
  telegramNotifyBtn.addEventListener('click', () => {
    telegramModal.classList.add('active');
    telegramStatus.textContent = '';
    telegramStatus.className = 'modal-status';
    telegramChatIdInput.value = '';
    setInputLocked(false);

    const savedId = pb.authStore.model?.telegram_chat_id;
    if (savedId) {
      telegramChatIdInput.value = savedId;
      setInputLocked(true);
      telegramStatus.textContent = '✅ Telegram ID подключён. Нажмите ✏️ чтобы изменить.';
      telegramStatus.className = 'modal-status success';
    }
  });

  editTelegramIdBtn.addEventListener('click', () => {
    setInputLocked(false);
    telegramChatIdInput.focus();
    telegramStatus.textContent = '';
    telegramStatus.className = 'modal-status';
  });

  telegramModalClose.addEventListener('click', () => {
    telegramModal.classList.remove('active');
  });

  telegramModal.addEventListener('click', (e) => {
    if (e.target === telegramModal) telegramModal.classList.remove('active');
  });

  // Сохранить telegram_chat_id.
  // В Supabase делали upsert в таблицу profiles.
  // В PocketBase просто обновляем запись пользователя в коллекции customers.
  saveTelegramIdBtn.addEventListener('click', async () => {
    const chatId = parseInt(telegramChatIdInput.value);

    if (!chatId || chatId <= 0) {
      telegramStatus.textContent = 'Введите корректный Telegram ID';
      telegramStatus.className = 'modal-status error';
      return;
    }

    saveTelegramIdBtn.disabled = true;

    try {
      // Обновляем поле telegram_chat_id у текущего пользователя в коллекции customers
      await pb.collection('customers').update(currentUser.id, {
        telegram_chat_id: chatId
      });

      // Обновляем локальный кэш authStore, чтобы не делать лишний запрос
      pb.authStore.model.telegram_chat_id = chatId;

      setInputLocked(true);
      telegramStatus.textContent = '✅ Telegram ID сохранён! Уведомления будут приходить автоматически.';
      telegramStatus.className = 'modal-status success';
    } catch (e) {
      telegramStatus.textContent = 'Ошибка: ' + e.message;
      telegramStatus.className = 'modal-status error';
    }

    saveTelegramIdBtn.disabled = false;
  });

  // --- Работа с данными ---

  function formatCurrency(value) {
    const number = Number(value) || 0;
    return number.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  async function loadPayments() {
    try {
      // В Supabase фильтрация по user_id происходила автоматически через RLS.
      // В PocketBase мы явно указываем фильтр: поле user должно совпадать с ID текущего пользователя.
      // @request.auth.id — это специальная переменная PocketBase, которая читается из токена авторизации.
      // Это безопасно: подделать токен клиент не может, значит нельзя запросить чужие платежи.
      const records = await pb.collection('payments').getFullList({
        filter: `user = "${currentUser.id}"`,
        sort: 'payment_date'
      });

      payments = records.map(payment => ({
        id: payment.id,
        name: payment.name,
        amount: payment.amount,
        // В Supabase поле называлось payment_date, в PocketBase мы тоже назвали его payment_date
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
      // В Supabase передавали user_id как UUID.
      // В PocketBase поле называется user и содержит ID записи из коллекции customers.
      const record = await pb.collection('payments').create({
        name: paymentData.name,
        amount: paymentData.amount,
        payment_date: paymentData.date,
        category: paymentData.category,
        user: currentUser.id
      });

      return record;
    } catch (e) {
      console.error('Ошибка при сохранении:', e);
      alert('Ошибка при сохранении: ' + e.message);
      return null;
    }
  }

  async function updatePayment(id, paymentData) {
    try {
      // ID в PocketBase — это строка вида "abc123xyz789" (15 символов).
      // В Supabase был числовой bigint, parseInt() здесь не нужен.
      const record = await pb.collection('payments').update(id, {
        name: paymentData.name,
        amount: paymentData.amount,
        payment_date: paymentData.date,
        category: paymentData.category
        // user не трогаем — он уже правильно установлен при создании
      });

      return record;
    } catch (e) {
      console.error('Ошибка при обновлении:', e);
      return null;
    }
  }

  async function deletePayment(id) {
    try {
      await pb.collection('payments').delete(id);
      return true;
    } catch (e) {
      console.error('Ошибка при удалении:', e);
      return false;
    }
  }

  // --- Dashboard и рендеринг таблицы — без изменений ---

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

    const counts = { subscription: 0, utilities: 0, credit: 0, other: 0 };
    payments.forEach((p) => {
      if (counts[p.category] !== undefined) counts[p.category] += 1;
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

        if (daysDiff <= 0) tr.classList.add('row-warning');

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

          if (updatedPayment) await loadPayments();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'icon-btn icon-btn-danger';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Удалить платёж';
        deleteBtn.addEventListener('click', async () => {
          const success = await deletePayment(payment.id);
          if (success) await loadPayments();
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
      case 'subscription': return 'Подписка';
      case 'utilities': return 'ЖКХ';
      case 'credit': return 'Кредит';
      default: return 'Другое';
    }
  }

  // --- Тема ---

  function initTheme() {
    const stored = localStorage.getItem('paycontrol_theme');
    const theme = stored || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    themeToggleBtn.textContent = theme === 'dark' ? 'Тёмная тема' : 'Светлая тема';
  }

  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    themeToggleBtn.textContent = next === 'dark' ? 'Тёмная тема' : 'Светлая тема';
    try { localStorage.setItem('paycontrol_theme', next); } catch (e) {}
  });

  // --- Авторизация ---

  // Выход из аккаунта.
  // В Supabase: supabase.auth.signOut() — запрос к серверу для инвалидации токена.
  // В PocketBase: pb.authStore.clear() — просто очищаем токен из localStorage, без запроса.
  async function signOut() {
    pb.authStore.clear();
    window.location.href = 'login.html';
  }

  function addSignOutButton(user) {
    const headerActions = document.querySelector('.header-actions');

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

    // Проверяем авторизацию.
    // В Supabase: supabase.auth.getSession() — асинхронный запрос.
    // В PocketBase: pb.authStore.isValid — мгновенная синхронная проверка токена из localStorage.
    // Если токен есть и не просрочен — пользователь считается залогиненным.
    if (!pb.authStore.isValid) {
      window.location.href = 'login.html';
      return;
    }

    currentUser = pb.authStore.model;
    addSignOutButton(currentUser);
    loadPayments();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
// тест автодеплоя
