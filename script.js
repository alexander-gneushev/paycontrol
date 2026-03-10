(function () {
  const pb = new PocketBase('https://paycontrol.dcmr.ru/pb');

  const form = document.getElementById('paymentForm');
  const formMobile = document.getElementById('paymentFormMobile');
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

  // Кнопка "+" и модалка добавления платежа на мобильных
  const addPaymentMobileBtn = document.getElementById('addPaymentMobileBtn');
  const addPaymentModal = document.getElementById('addPaymentModal');
  const addPaymentModalClose = document.getElementById('addPaymentModalClose');

  let payments = [];
  let currentEditingId = null;
  // Текущий активный фильтр категории. 'all' — показывать все платежи.
  let activeCategory = 'all';
  let currentUser = null;

  const submitBtn = form.querySelector('button[type="submit"]');

  // --- Мобильная модалка добавления платежа ---

  addPaymentMobileBtn.addEventListener('click', () => {
    addPaymentModal.classList.add('active');
    formMobile.reset();
  });

  function closeMobileModal() {
    addPaymentModal.classList.remove('active');
    // Сбрасываем заголовок и кнопку обратно в режим добавления
    addPaymentModal.querySelector('.modal-title').textContent = 'Добавить платёж';
    formMobile.querySelector('button[type="submit"]').textContent = 'Сохранить платёж';
    currentEditingId = null;
  }

  addPaymentModalClose.addEventListener('click', closeMobileModal);

  addPaymentModal.addEventListener('click', (e) => {
    if (e.target === addPaymentModal) closeMobileModal();
  });

  // Обработчик мобильной формы — логика та же что и у десктопной,
  // после сохранения модалка закрывается автоматически.
  formMobile.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(formMobile);
    const name = String(formData.get('name') || '').trim();
    const amount = Number(formData.get('amount') || 0);
    const date = String(formData.get('date') || '');
    const category = String(formData.get('category') || 'other');

    if (!name || !date || !amount || amount <= 0) {
      alert('Проверьте корректность введённых данных.');
      return;
    }

    if (currentEditingId) {
      // Режим редактирования — обновляем существующий платёж
      const updated = await updatePayment(currentEditingId, { name, amount, date, category });
      if (updated) {
        await loadPayments();
        closeMobileModal();
      }
    } else {
      // Режим добавления — создаём новый платёж
      const newPayment = await savePayment({ name, amount, date, category });
      if (newPayment) {
        await loadPayments();
        closeMobileModal();
      }
    }
  });

  // --- Десктопная форма ---

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

  // --- Табы фильтрации категорий ---

  const categoryTabs = document.querySelectorAll('.category-tab');

  categoryTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Убираем активный класс со всех табов и ставим на нажатый
      categoryTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeCategory = tab.dataset.category;
      // Перерисовываем таблицу с учётом нового фильтра
      renderTable(searchInput.value);
    });
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

  saveTelegramIdBtn.addEventListener('click', async () => {
    const chatId = parseInt(telegramChatIdInput.value);

    if (!chatId || chatId <= 0) {
      telegramStatus.textContent = 'Введите корректный Telegram ID';
      telegramStatus.className = 'modal-status error';
      return;
    }

    saveTelegramIdBtn.disabled = true;

    try {
      await pb.collection('customers').update(currentUser.id, {
        telegram_chat_id: chatId
      });

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
      const records = await pb.collection('payments').getFullList({
        filter: `user = "${currentUser.id}"`,
        sort: 'payment_date'
      });

      payments = records.map(payment => ({
        id: payment.id,
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
      const record = await pb.collection('payments').update(id, {
        name: paymentData.name,
        amount: paymentData.amount,
        payment_date: paymentData.date,
        category: paymentData.category
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

  // --- Dashboard ---

  function updateDashboard() {
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

  // --- Рендеринг таблицы ---

  function renderTable(filterValue) {
    paymentsBody.innerHTML = '';

    const normalizedFilter = (filterValue || '').trim().toLowerCase();

    // Сначала фильтруем по тексту поиска
    let filtered = normalizedFilter
      ? payments.filter((p) => {
          const text = (p.name + ' ' + p.categoryLabel).toLowerCase();
          return text.includes(normalizedFilter);
        })
      : payments;

    // Затем фильтруем по активной категории (если выбрана не 'all')
    if (activeCategory !== 'all') {
      filtered = filtered.filter(p => p.category === activeCategory);
    }

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
          // Обрезаем дату до yyyy-MM-dd — Pocketbase возвращает '2026-03-10 00:00:00.000Z',
          // а input[type=date] принимает только 'yyyy-MM-dd'
          const dateForInput = (payment.date || '').slice(0, 10);

          // Определяем — мобильный режим (модалка видна) или десктоп
          const isMobile = window.innerWidth <= 879;

          if (isMobile) {
            // На мобильных: заполняем мобильную форму и открываем модалку
            formMobile.elements['name'].value = payment.name;
            formMobile.elements['amount'].value = payment.amount;
            formMobile.elements['date'].value = dateForInput;
            formMobile.elements['category'].value = payment.category;
            // Меняем заголовок модалки и текст кнопки на режим редактирования
            addPaymentModal.querySelector('.modal-title').textContent = 'Редактировать платёж';
            formMobile.querySelector('button[type="submit"]').textContent = 'Сохранить изменения';
            currentEditingId = payment.id;
            addPaymentModal.classList.add('active');
          } else {
            // На десктопе: заполняем десктопную форму
            currentEditingId = payment.id;
            form.name.value = payment.name;
            form.amount.value = payment.amount;
            form.date.value = dateForInput;
            form.category.value = payment.category;
            submitBtn.textContent = 'Сохранить изменения';
            form.name.focus();
          }
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
