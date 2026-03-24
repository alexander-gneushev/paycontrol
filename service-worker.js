// Service Worker для PayControl PWA
// Версия кэша — при обновлении файлов меняй эту строку,
// чтобы браузер скачал свежие файлы вместо старых из кэша.
const CACHE_NAME = 'paycontrol-v5';

const STATIC_FILES = [
  '/',
  '/index.html',
  '/login.html',
  '/style.css',
  '/login.css',
  '/script.js',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  console.log('[SW] install: начало, версия кэша =', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        STATIC_FILES.map(url =>
          fetch(url).then(response => {
            if (!response.ok) {
              console.error('[SW] ОШИБКА: не удалось загрузить', url, '— статус:', response.status);
              return;
            }
            console.log('[SW] закешировано:', url);
            return cache.put(url, response);
          }).catch(err => {
            console.error('[SW] ИСКЛЮЧЕНИЕ при загрузке', url, err);
          })
        )
      );
    }).then(() => {
      console.log('[SW] install: завершено, вызываем skipWaiting');
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/pb/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});

// ============================================================
// Web Push — обработка входящих уведомлений
// ============================================================
//
// Событие 'push' срабатывает когда наш сервер (notify.js) отправляет
// уведомление через push-сервис браузера. Service Worker получает его
// в фоне — даже если сайт закрыт — и показывает системное уведомление.
//
// Аналогия: SW — это курьер, который дежурит у двери 24/7.
// Когда приходит посылка (push), он принимает её и кладёт на видное место
// (показывает уведомление), не будя хозяина (не открывая браузер).

self.addEventListener('push', event => {
  // Если данных нет — показываем дефолтное уведомление
  let data = {
    title: '📅 PayControl',
    body:  'Есть предстоящие платежи',
    url:   'https://paycontrol.dcmr.ru',
    icon:  '/icons/icon-192.png',
    badge: '/icons/icon-192.png'
  };

  // Пробуем распарсить JSON который прислал наш notify.js
  if (event.data) {
    try {
      data = JSON.parse(event.data.text());
    } catch (e) {
      console.error('[SW] Ошибка парсинга push-данных:', e);
    }
  }

  const options = {
    body:             data.body,
    icon:             data.icon  || '/icons/icon-192.png',
    badge:            data.badge || '/icons/icon-192.png',
    // tag позволяет браузеру заменять старое уведомление новым,
    // а не накапливать несколько одинаковых — удобно для ежедневных сводок
    tag:              'paycontrol-daily',
    // renotify: true — воспроизводить звук/вибрацию даже если уведомление
    // с таким tag уже показано (т.е. при повторной отправке)
    renotify:         true,
    // data сохраняется внутри уведомления и доступна в обработчике notificationclick
    data:             { url: data.url || 'https://paycontrol.dcmr.ru' },
    requireInteraction: false
  };

  // waitUntil гарантирует что SW не завершится раньше чем уведомление покажется
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ============================================================
// Обработка клика по уведомлению
// ============================================================
//
// Когда пользователь нажимает на уведомление — открываем приложение.
// Если вкладка с PayControl уже открыта — фокусируемся на ней.
// Если нет — открываем новую вкладку.

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || 'https://paycontrol.dcmr.ru';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Ищем уже открытую вкладку с нашим приложением
      for (const client of windowClients) {
        if (client.url.startsWith('https://paycontrol.dcmr.ru') && 'focus' in client) {
          return client.focus();
        }
      }
      // Открытой вкладки нет — открываем новую
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
