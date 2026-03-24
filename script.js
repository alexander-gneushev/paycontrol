(function () {
  const pb = new PocketBase('https://paycontrol.dcmr.ru/pb');

  // VAPID Public Key — браузер использует его для шифрования подписки.
  // Это публичный ключ, его безопасно хранить в коде фронтенда.
  // Приватный ключ хранится только на сервере в .env
  const VAPID_PUBLIC_KEY = 'BO_vLRtkH2LBWun_6cjOb3dNfmU1PwMVAF3s0VR6f31xrPT4_V4OJtRS_QycXg2TMfWvL1Ua_00Fj2od6eB5Q4o';

  const form             = document.getElementById('paymentForm');
  const formMobile       = document.getElementById('paymentFormMobile');
  const paymentsBody     = document.getElementById('paymentsBody');
  const tableEmptyState  = document.getElementById('tableEmptyState');
  const totalMonthlyEl   = document.getElementById('totalMonthly');
  const nextPaymentEl    = document.getElementById('nextPayment');
  const nextPaymentMetaEl = document.getElementById('nextPaymentMeta');
  const searchInput      = document.getElementById('searchInput');

  const countSubscriptionEl = document.getElementById('countSubscription');
  const countUtilitiesEl    = document.getElementById('countUtilities');
  const countCreditEl       = document.getElementById('countCredit');
  const countOtherEl        = document.getElementById('countOther');

  const currentYearEl    = document.getElementById('currentYear');
  const themeToggleBtn   = document.getElementById('themeToggle');
  const telegramNotifyBtn = document.getElementById('telegramNotify');

  const addPaymentMobileBtn  = document.getElementById('addPaymentMobileBtn');
  const addPaymentModal      = document.getElementById('addPaymentModal');
  const addPaymentModalClose = document.getElementById('addPaymentModalClose');

  let payments = [];
  let currentEditingId = null;
  let activeCategory   = 'all';
  let currentUser      = null;

  // Флаг — показывали ли мы уже промо-модалку в этой сессии.
  // Нужен чтобы не показывать её несколько раз при добавлении нескольких платежей подряд.
  let pushPromoShownThisSession = false;

  const submitBtn = form.querySelector('button[type="submit"]');

  // ============================================================
  // Мобильная модалка добавления платежа
  // ============================================================

  addPaymentMobileBtn.addEventListener('click', () => {
    addPaymentModal.classList.add('active');
    formMobile.reset();
  });

  function closeMobileModal() {
    addPaymentModal.classList.remove('active');
    addPaymentModal.querySelector('.modal-title').textContent = 'Добавить платёж';
    formMobile.querySelector('button[type="submit"]').textContent = 'Сохранить платёж';
    currentEditingId = null;
  }

  addPaymentModalClose.addEventListener('click', closeMobileModal);
  addPaymentModal.addEventListener('click', (e) => {
    if (e.target === addPaymentModal) closeMobileModal();
  });

  formMobile.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(formMobile);
    const name     = String(formData.get('name') || '').trim();
    const amount   = Number(formData.get('amount') || 0);
    const date     = String(formData.get('date') || '');
    const category = String(formData.get('category') || 'other');

    if (!name || !date || !amount || amount <= 0) {
      alert('Проверьте корректность введённых данных.');
      return;
    }

    if (currentEditingId) {
      const updated = await updatePayment(currentEditingId, { name, amount, date, category });
      if (updated) { await loadPayments(); closeMobileModal(); }
    } else {
      const newPayment = await savePayment({ name, amount, date, category });
      if (newPayment) {
        await loadPayments();
        closeMobileModal();
        // После первого платежа предлагаем включить push
        await maybeShowPushPromo();
      }
    }
  });

  // ============================================================
  // Десктопная форма
  // ============================================================

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name     = String(formData.get('name') || '').trim();
    const amount   = Number(formData.get('amount') || 0);
    const date     = String(formData.get('date') || '');
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
        // После первого платежа предлагаем включить push
        await maybeShowPushPromo();
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

  // ============================================================
  // Табы фильтрации
  // ============================================================

  const categoryTabs = document.querySelectorAll('.category-tab');
  categoryTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      categoryTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeCategory = tab.dataset.category;
      renderTable(searchInput.value);
    });
  });

  // ============================================================
  // Telegram модальное окно
  // ============================================================

  const telegramModal      = document.getElementById('telegramModal');
  const telegramModalClose = document.getElementById('telegramModalClose');
  const saveTelegramIdBtn  = document.getElementById('saveTelegramId');
  const editTelegramIdBtn  = document.getElementById('editTelegramId');
  const telegramChatIdInput = document.getElementById('telegramChatIdInput');
  const telegramStatus     = document.getElementById('telegramStatus');

  function setInputLocked(locked) {
    telegramChatIdInput.disabled     = locked;
    telegramChatIdInput.style.opacity = locked ? '0.5' : '1';
    saveTelegramIdBtn.disabled       = locked;
    saveTelegramIdBtn.style.opacity  = locked ? '0.5' : '1';
    editTelegramIdBtn.style.display  = locked ? 'inline-flex' : 'none';
  }

  telegramNotifyBtn.addEventListener('click', () => {
    telegramModal.classList.add('active');
    telegramStatus.textContent = '';
    telegramStatus.className   = 'modal-status';
    telegramChatIdInput.value  = '';
    setInputLocked(false);

    const savedId = pb.authStore.model?.telegram_chat_id;
    if (savedId) {
      telegramChatIdInput.value = savedId;
      setInputLocked(true);
      telegramStatus.textContent = '✅ Telegram ID подключён. Нажмите ✏️ чтобы изменить.';
      telegramStatus.className   = 'modal-status success';
    }

    // Обновляем состояние свитча при открытии модалки
    updatePushToggleUI();
  });

  editTelegramIdBtn.addEventListener('click', () => {
    setInputLocked(false);
    telegramChatIdInput.focus();
    telegramStatus.textContent = '';
    telegramStatus.className   = 'modal-status';
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
      telegramStatus.className   = 'modal-status error';
      return;
    }

    saveTelegramIdBtn.disabled = true;
    try {
      await pb.collection('customers').update(currentUser.id, { telegram_chat_id: chatId });
      pb.authStore.model.telegram_chat_id = chatId;
      setInputLocked(true);
      telegramStatus.textContent = '✅ Telegram ID сохранён! Уведомления будут приходить автоматически.';
      telegramStatus.className   = 'modal-status success';
    } catch (e) {
      telegramStatus.textContent = 'Ошибка: ' + e.message;
      telegramStatus.className   = 'modal-status error';
    }
    saveTelegramIdBtn.disabled = false;
  });

  // ============================================================
  // Push-уведомления
  // ============================================================
  //
  // Схема работы:
  // 1. Пользователь нажимает свитч → браузер запрашивает разрешение
  // 2. Если разрешение дано → браузер генерирует подписку (endpoint + ключи)
  // 3. Подписка сохраняется в Pocketbase (коллекция push_subscriptions)
  // 4. notify.js каждый день читает подписки и отправляет push через web-push
  //
  // Ключевое понятие — PushSubscription. Это объект который браузер выдаёт
  // когда мы вызываем pushManager.subscribe(). Он содержит:
  // - endpoint: уникальный URL на сервере Google/Mozilla/Apple — туда наш
  //   сервер отправит зашифрованное сообщение
  // - p256dh и auth: криптографические ключи именно этого браузера.
  //   Без них сервер не сможет зашифровать сообщение так чтобы браузер
  //   мог его расшифровать.

  const pushToggle     = document.getElementById('pushToggle');
  const pushStatusText = document.getElementById('pushStatusText');

  // Конвертирует base64url строку в Uint8Array.
  // Это нужно потому что pushManager.subscribe() ожидает applicationServerKey
  // в виде бинарных данных (Uint8Array), а наш VAPID_PUBLIC_KEY хранится как строка.
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  }

  // Проверяем текущее состояние подписки и обновляем UI свитча.
  // Вызывается при открытии модалки и после изменения статуса.
  async function updatePushToggleUI() {
    if (!('PushManager' in window)) {
      // Браузер не поддерживает Push API (Safari до iOS 16, некоторые старые браузеры)
      pushStatusText.textContent = 'Push-уведомления не поддерживаются вашим браузером';
      pushToggle.disabled = true;
      return;
    }

    const permission = Notification.permission;

    if (permission === 'denied') {
      // Пользователь заблокировал уведомления в настройках браузера.
      // Программно разблокировать нельзя — нужна ручная настройка.
      pushStatusText.textContent = 'Уведомления заблокированы в настройках браузера. Разрешите их в настройках сайта и перезагрузите страницу.';
      pushToggle.setAttribute('aria-checked', 'false');
      pushToggle.classList.remove('active');
      return;
    }

    try {
      const registration   = await navigator.serviceWorker.ready;
      const subscription   = await registration.pushManager.getSubscription();
      const isSubscribed   = subscription !== null;

      pushToggle.setAttribute('aria-checked', String(isSubscribed));
      pushToggle.classList.toggle('active', isSubscribed);
      pushStatusText.textContent = isSubscribed
        ? '✅ Push-уведомления включены на этом устройстве'
        : 'Уведомления прямо в браузере — без Telegram и без лишних шагов';
    } catch (e) {
      console.error('Ошибка проверки подписки:', e);
    }
  }

  // Подписываемся на push-уведомления.
  // Этот вызов делает две вещи: запрашивает разрешение у пользователя (если не дано)
  // и создаёт подписку в браузере. Затем мы сохраняем подписку в Pocketbase.
  async function subscribeToPush() {
    try {
      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        // userVisibleOnly: true обязательный параметр — говорит браузеру что
        // каждый push будет показываться пользователю (не тихий фоновый пуш).
        // Без этого Chrome откажет в подписке.
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      // Извлекаем ключи из объекта подписки
      const p256dh = btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh'))));
      const auth   = btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth'))));

      // Сохраняем подписку в Pocketbase
      await pb.collection('push_subscriptions').create({
        user:       currentUser.id,
        endpoint:   subscription.endpoint,
        p256dh:     p256dh,
        auth:       auth,
        user_agent: navigator.userAgent.slice(0, 200)
      });

      console.log('Push-подписка сохранена');
      return true;
    } catch (e) {
      // Пользователь нажал "Блокировать" в диалоге браузера
      if (e.name === 'NotAllowedError') {
        pushStatusText.textContent = 'Вы отказали в разрешении. Включите уведомления в настройках браузера.';
      } else {
        console.error('Ошибка подписки на push:', e);
        pushStatusText.textContent = 'Ошибка при подключении уведомлений: ' + e.message;
      }
      return false;
    }
  }

  // Отписываемся от push-уведомлений.
  // Удаляем подписку в браузере И в Pocketbase.
  async function unsubscribeFromPush() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Удаляем подписку из Pocketbase по endpoint —
        // он уникален для каждого браузера/устройства
        const encoded = encodeURIComponent(`endpoint="${subscription.endpoint}" && user="${currentUser.id}"`);
        const result  = await pb.collection('push_subscriptions').getList(1, 1, {
          filter: `endpoint="${subscription.endpoint}" && user="${currentUser.id}"`
        });

        if (result.items.length > 0) {
          await pb.collection('push_subscriptions').delete(result.items[0].id);
        }

        // Отписываемся в браузере
        await subscription.unsubscribe();
      }

      return true;
    } catch (e) {
      console.error('Ошибка отписки:', e);
      return false;
    }
  }

  // Обработчик клика по свитчу
  pushToggle.addEventListener('click', async () => {
    if (pushToggle.disabled) return;

    const isCurrentlyOn = pushToggle.getAttribute('aria-checked') === 'true';

    pushToggle.disabled = true;
    pushStatusText.textContent = 'Пожалуйста, подождите...';

    if (isCurrentlyOn) {
      // Выключаем
      const success = await unsubscribeFromPush();
      if (success) {
        pushToggle.setAttribute('aria-checked', 'false');
        pushToggle.classList.remove('active');
        pushStatusText.textContent = 'Push-уведомления отключены';
      } else {
        pushStatusText.textContent = 'Не удалось отключить уведомления';
      }
    } else {
      // Включаем
      const success = await subscribeToPush();
      if (success) {
        pushToggle.setAttribute('aria-checked', 'true');
        pushToggle.classList.add('active');
        pushStatusText.textContent = '✅ Push-уведомления включены на этом устройстве';
      }
    }

    pushToggle.disabled = false;
  });

  // ============================================================
  // Промо-модалка после первого платежа
  // ============================================================
  //
  // Логика: показываем один раз, только если:
  // 1. Браузер поддерживает Push API
  // 2. Разрешение ещё не дано (не denied и не granted)
  // 3. Это первый платёж пользователя (payments.length === 1 после добавления)
  // 4. Ещё не показывали в этой сессии

  const pushPromoModal   = document.getElementById('pushPromoModal');
  const pushPromoClose   = document.getElementById('pushPromoClose');
  const pushPromoEnable  = document.getElementById('pushPromoEnable');
  const pushPromoSkip    = document.getElementById('pushPromoSkip');

  async function maybeShowPushPromo() {
    // Уже показывали в этой сессии — не повторяем
    if (pushPromoShownThisSession) return;

    // Браузер не поддерживает push или уже дано/отклонено разрешение
    if (!('PushManager' in window)) return;
    if (Notification.permission !== 'default') return;

    // Показываем только после первого платежа
    if (payments.length !== 1) return;

    pushPromoShownThisSession = true;
    pushPromoModal.classList.add('active');
  }

  function closePushPromo() {
    pushPromoModal.classList.remove('active');
  }

  pushPromoClose.addEventListener('click', closePushPromo);
  pushPromoSkip.addEventListener('click', closePushPromo);
  pushPromoModal.addEventListener('click', (e) => {
    if (e.target === pushPromoModal) closePushPromo();
  });

  pushPromoEnable.addEventListener('click', async () => {
    closePushPromo();
    pushPromoEnable.disabled = true;

    const success = await subscribeToPush();
    if (success) {
      // Небольшая задержка чтобы модалка успела закрыться
      setTimeout(() => {
        pushStatusText.textContent = '✅ Push-уведомления включены на этом устройстве';
      }, 300);
    }

    pushPromoEnable.disabled = false;
  });

  // ============================================================
  // Работа с данными
  // ============================================================

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
        sort:   'payment_date'
      });

      payments = records.map(payment => ({
        id:            payment.id,
        name:          payment.name,
        amount:        payment.amount,
        date:          payment.payment_date,
        category:      payment.category,
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
        name:         paymentData.name,
        amount:       paymentData.amount,
        payment_date: paymentData.date,
        category:     paymentData.category,
        user:         currentUser.id
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
        name:         paymentData.name,
        amount:       paymentData.amount,
        payment_date: paymentData.date,
        category:     paymentData.category
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

  // ============================================================
  // Dashboard
  // ============================================================

  function updateDashboard() {
    const total = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    totalMonthlyEl.textContent = formatCurrency(total);

    const allPayments = payments
      .map((p)  => ({ ...p, dateObj: new Date(p.date) }))
      .filter((p) => !Number.isNaN(p.dateObj.getTime()))
      .sort((a, b) => a.dateObj - b.dateObj);

    if (allPayments.length === 0) {
      nextPaymentEl.textContent    = '—';
      nextPaymentMetaEl.textContent = 'Ближайших платежей нет';
    } else {
      const next = allPayments[0];
      nextPaymentEl.textContent    = `${formatCurrency(next.amount)}`;
      nextPaymentMetaEl.textContent = `${next.name} — ${formatDate(next.date)}`;
    }

    const counts = { subscription: 0, utilities: 0, credit: 0, other: 0 };
    payments.forEach((p) => {
      if (counts[p.category] !== undefined) counts[p.category] += 1;
    });

    countSubscriptionEl.textContent = counts.subscription;
    countUtilitiesEl.textContent    = counts.utilities;
    countCreditEl.textContent       = counts.credit;
    countOtherEl.textContent        = counts.other;
  }

  // ============================================================
  // Рендеринг таблицы
  // ============================================================

  function renderTable(filterValue) {
    paymentsBody.innerHTML = '';

    const normalizedFilter = (filterValue || '').trim().toLowerCase();

    let filtered = normalizedFilter
      ? payments.filter((p) => {
          const text = (p.name + ' ' + p.categoryLabel).toLowerCase();
          return text.includes(normalizedFilter);
        })
      : payments;

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
        const msDiff  = dueDate.getTime() - today.getTime();
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
        editBtn.type      = 'button';
        editBtn.className = 'icon-btn icon-btn-edit';
        editBtn.title     = 'Редактировать платёж';
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', async () => {
          const dateForInput = (payment.date || '').slice(0, 10);
          const isMobile     = window.innerWidth <= 879;

          if (isMobile) {
            formMobile.elements['name'].value     = payment.name;
            formMobile.elements['amount'].value   = payment.amount;
            formMobile.elements['date'].value     = dateForInput;
            formMobile.elements['category'].value = payment.category;
            addPaymentModal.querySelector('.modal-title').textContent = 'Редактировать платёж';
            formMobile.querySelector('button[type="submit"]').textContent = 'Сохранить изменения';
            currentEditingId = payment.id;
            addPaymentModal.classList.add('active');
          } else {
            currentEditingId  = payment.id;
            form.name.value   = payment.name;
            form.amount.value = payment.amount;
            form.date.value   = dateForInput;
            form.category.value = payment.category;
            submitBtn.textContent = 'Сохранить изменения';
            form.name.focus();
          }
        });

        const paidBtn = document.createElement('button');
        paidBtn.type      = 'button';
        paidBtn.className = 'icon-btn icon-btn-success';
        paidBtn.title     = 'Отметить как оплачено и перенести дату';
        paidBtn.textContent = '✔';
        paidBtn.addEventListener('click', async () => {
          const currentDate = new Date(payment.date);
          if (Number.isNaN(currentDate.getTime())) return;

          const nextMonthDate = new Date(currentDate);
          nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);

          const year  = nextMonthDate.getFullYear();
          const month = String(nextMonthDate.getMonth() + 1).padStart(2, '0');
          const day   = String(nextMonthDate.getDate()).padStart(2, '0');

          const updatedPayment = await updatePayment(payment.id, {
            name: payment.name, amount: payment.amount,
            date: `${year}-${month}-${day}`, category: payment.category
          });
          if (updatedPayment) await loadPayments();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type      = 'button';
        deleteBtn.className = 'icon-btn icon-btn-danger';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title     = 'Удалить платёж';
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
      case 'utilities':    return 'ЖКХ';
      case 'credit':       return 'Кредит';
      default:             return 'Другое';
    }
  }

  // ============================================================
  // Тема
  // ============================================================

  function initTheme() {
    const stored = localStorage.getItem('paycontrol_theme');
    const theme  = stored || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    themeToggleBtn.textContent = theme === 'dark' ? 'Тёмная тема' : 'Светлая тема';
  }

  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    themeToggleBtn.textContent = next === 'dark' ? 'Тёмная тема' : 'Светлая тема';
    try { localStorage.setItem('paycontrol_theme', next); } catch (e) {}
  });

  // ============================================================
  // Авторизация
  // ============================================================

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
    signOutBtn.className  = 'btn btn-ghost';
    signOutBtn.textContent = '🚪 Выйти';
    signOutBtn.type       = 'button';
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
    await loadPayments();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
