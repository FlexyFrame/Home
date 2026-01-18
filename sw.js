// Service Worker для FlexyFrame PWA
const CACHE_NAME = 'flexyframe-v1.0.0';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/ЛОГОТИП/Logo.png'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching files');
                return cache.addAll(urlsToCache);
            })
            .then(() => {
                console.log('Service Worker: Cached successfully');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.log('Service Worker: Caching failed', error);
            })
    );
});

// Активация и очистка старых кэшей
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Deleting old cache', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker: Activated');
            return self.clients.claim();
        })
    );
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
    // Игнорируем POST запросы и запросы к другим доменам
    if (event.request.method !== 'GET' || 
        !event.request.url.startsWith(self.location.origin)) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                // Возвращаем кэшированную версию, если она есть
                if (cachedResponse) {
                    return cachedResponse;
                }

                // Иначе делаем сетевой запрос
                return fetch(event.request)
                    .then((response) => {
                        // Кэшируем только успешные ответы
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Клонируем ответ для кэширования
                        const responseToCache = response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(() => {
                        // Возвращаем заглушку при отсутствии интернета
                        if (event.request.destination === 'image') {
                            return caches.match('/ЛОГОТИП/Logo.png');
                        }
                        if (event.request.destination === 'document') {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});

// Обработка фоновой синхронизации (если потребуется)
self.addEventListener('sync', (event) => {
    console.log('Background sync:', event.tag);
});

// Обработка уведомлений
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow('/')
    );
});

// Обработка push уведомлений
self.addEventListener('push', (event) => {
    const options = {
        body: event.data ? event.data.text() : 'Новое обновление от FlexyFrame!',
        icon: '/ЛОГОТИП/Logo.png',
        badge: '/ЛОГОТИП/Logo.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'open',
                title: 'Открыть сайт',
                icon: '/ЛОГОТИП/Logo.png'
            },
            {
                action: 'close',
                title: 'Закрыть'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('FlexyFrame', options)
    );
});