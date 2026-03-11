// Service Worker для PayControl PWA
// Версия кэша — при обновлении файлов меняй эту строку,
// чтобы браузер скачал свежие файлы вместо старых из кэша.
const CACHE_NAME = 'paycontrol-v4';

// Список файлов которые кэшируются при установке приложения.
// Это все статические ресурсы — HTML, CSS, JS, иконки.
// После кэширования приложение открывается мгновенно даже при медленном интернете.
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

// Событие install — срабатывает один раз когда браузер устанавливает сервис-воркер.
// Здесь мы скачиваем и сохраняем все статические файлы в кэш.
self.addEventListener('install', event => {
  console.log('[SW] install: начало, версия кэша =', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Кешируем каждый файл по отдельности — так одна ошибка не убьёт весь процесс
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

// Событие activate — срабатывает когда новый сервис-воркер берёт управление.
// Здесь удаляем старые кэши если версия изменилась.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME) // Оставляем только текущую версию кэша
          .map(key => caches.delete(key))    // Удаляем все старые версии
      )
    ).then(() => self.clients.claim()) // Берём управление над всеми открытыми вкладками
  );
});

// Событие fetch — срабатывает на каждый сетевой запрос из приложения.
// Стратегия: Network First — сначала пробуем получить свежие данные из сети,
// при неудаче (нет интернета) — отдаём из кэша.
// Для API-запросов к Pocketbase кэш не используем — там всегда нужны живые данные.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Запросы к Pocketbase API (/pb/) — всегда идём в сеть, кэш не трогаем
  if (url.pathname.startsWith('/pb/')) {
    return; // Пропускаем — браузер сам обработает запрос напрямую
  }

  // Для статических файлов используем стратегию Cache First:
  // сначала ищем в кэше, если нет — идём в сеть и сохраняем результат
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached; // Нашли в кэше — отдаём сразу

      // Не нашли в кэше — идём в сеть
      return fetch(event.request).then(response => {
        // Сохраняем успешный ответ в кэш для следующего раза
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});
