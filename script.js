/**
 * FlexyFrame - Клиентский скрипт
 * Оптимизированная версия с улучшенной обработкой ошибок и валидацией
 */

// === КОНФИГУРАЦИЯ ===
const API_CONFIG = {
    baseUrl: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://127.0.0.1:8080' 
        : 'https://flexyframe.github.io',
    endpoints: {
        createOrder: '/api/order/create',
        paintings: '/api/paintings',
        orderStatus: '/api/order'
    },
    timeout: 10000 // 10 секунд таймаут
};

// === СОСТОЯНИЕ ПРИЛОЖЕНИЯ ===
const AppState = {
    paintings: [],
    selectedPainting: null,
    isLoading: false,
    apiAvailable: false,
    observer: null,
    sessionData: new Map()
};

// === УТИЛИТЫ ЛОГИРОВАНИЯ (минимизированные) ===
const Logger = {
    info: (...args) => {}, // Отключено в продакшене
    warn: (message, data) => console.warn(`⚠️ ${message}`, data || ''),
    error: (message, error) => console.error(`❌ ${message}`, error || '')
};

// === ВАЛИДАЦИЯ ДАННЫХ ===
const Validators = {
    painting: (painting) => {
        return painting && 
               typeof painting === 'object' &&
               typeof painting.id === 'number' &&
               typeof painting.title === 'string' &&
               typeof painting.price === 'string' || typeof painting.price === 'number';
    },
    
    string: (value, minLength = 1) => {
        return typeof value === 'string' && value.trim().length >= minLength;
    },
    
    number: (value, min = 0) => {
        return typeof value === 'number' && value >= min;
    }
};

// === СИСТЕМА УВЕДОМЛЕНИЙ ===
const Notifications = {
    show(message, type = 'success', duration = 3000) {
        // Пропускаем info уведомления для чистоты лога
        if (type === 'info') return;
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.setAttribute('role', 'alert');
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('visible'), 10);
        
        setTimeout(() => {
            notification.classList.remove('visible');
            setTimeout(() => notification.remove(), 300);
        }, duration);
        
        // Клик для ручного закрытия
        notification.addEventListener('click', () => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        });
    },
    
    success(message) {
        this.show(message, 'success', 3000);
    },
    
    error(message) {
        this.show(message, 'error', 5000);
    },
    
    warn(message) {
        this.show(message, 'warning', 4000);
    }
};

// === ИНДИКАТОР ЗАГРУЗКИ ===
const LoadingIndicator = {
    element: null,
    count: 0,
    
    show(message = 'Загрузка...') {
        if (this.count === 0) {
            this.element = document.createElement('div');
            this.element.className = 'loading-indicator';
            this.element.textContent = message;
            this.element.setAttribute('role', 'status');
            document.body.appendChild(this.element);
            setTimeout(() => this.element.classList.add('visible'), 10);
        }
        this.count++;
    },
    
    hide() {
        this.count = Math.max(0, this.count - 1);
        if (this.count === 0 && this.element) {
            this.element.classList.remove('visible');
            setTimeout(() => {
                if (this.element && this.element.parentNode) {
                    this.element.remove();
                }
                this.element = null;
            }, 300);
        }
    }
};

// === ЗАГРУЗКА ДАННЫХ ===
async function loadPaintingsData() {
    Logger.info('Загрузка данных картин');
    
    // Всегда используем локальные данные для статической сборки
    AppState.paintings = [
        {
            id: 1,
            title: "Аркейн Триумвират",
            category: "Аркейн",
            price: "4200₽",
            image: "Аркейн/Аркейн Триумвират Заводского Города.jpg",
            badge: "Хит"
        },
        {
            id: 2,
            title: "Глитч-Давид",
            category: "Давид",
            price: "4200₽",
            image: "Давид/Глитч-Давид Рождение в цифровом хаосе.jpg",
            badge: "Новинка"
        },
        {
            id: 3,
            title: "Цифровая Древность",
            category: "Давид",
            price: "4200₽",
            image: "Давид/Цифровая Древность Голубой Давид.jpg"
        },
        {
            id: 4,
            title: "Железный Человек",
            category: "Железный Человек",
            price: "4200₽",
            image: "Железный Человек/Железный Человек Перерыв на обед.jpg"
        },
        {
            id: 5,
            title: "Мысли в облаках",
            category: "Земфира",
            price: "4200₽",
            image: "Земфира/Мысли в облаках.jpg"
        },
        {
            id: 6,
            title: "КэнтоНанами",
            category: "Магическая битва",
            price: "4200₽",
            image: "Магическая битва/КэнтоНанами.png",
            badge: "Хит"
        },
        {
            id: 7,
            title: "Скрудж Макдак",
            category: "Скрудж",
            price: "4200₽",
            image: "Скрудж/Скрудж Макдак Граффити-Миллиардер.jpg"
        },
        {
            id: 8,
            title: "Танос Император",
            category: "Танос",
            price: "4200₽",
            image: "Танос/Танос Император Бесконечности.jpg"
        },
        {
            id: 9,
            title: "Геймерский Энерджи",
            category: "Live",
            price: "4200₽",
            image: "Live/Геймерский Энерджи Граффити на контроллере.jpg",
            badge: "Хит"
        },
        {
            id: 10,
            title: "Ночной Волк",
            category: "Live",
            price: "4200₽",
            image: "Live/Ночной Волк Мастер звуков.jpg"
        },
        {
            id: 11,
            title: "Примат Премиум",
            category: "Live",
            price: "4200₽",
            image: "Live/Примат Премиум Король улицы.jpg"
        }
    ];
    
    AppState.apiAvailable = false;
    return AppState.paintings;
}

// === БЕЗОПАСНАЯ ЗАГРУЗКА ИЗОБРАЖЕНИЙ ===
async function safeLoadImage(img, src, placeholderText = '') {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            img.style.display = 'none';
            const placeholder = img.parentElement.querySelector('.image-placeholder');
            if (placeholder) placeholder.style.display = 'flex';
            resolve(false);
        }, 5000); // Таймаут 5 секунд

        img.onload = () => {
            clearTimeout(timeout);
            img.style.opacity = '1';
            resolve(true);
        };

        img.onerror = () => {
            clearTimeout(timeout);
            img.style.display = 'none';
            const placeholder = img.parentElement.querySelector('.image-placeholder');
            if (placeholder) placeholder.style.display = 'flex';
            Logger.warn('Ошибка загрузки изображения', src);
            resolve(false);
        };

        img.src = src;
    });
}

// === СОЗДАНИЕ КАРТОЧКИ КАРТИНЫ ===
function createPaintCard(painting, index) {
    const card = document.createElement('div');
    card.className = 'paint-card fade-in';
    card.id = `card-${painting.id}`;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Просмотреть картину: ${painting.title}, категория ${painting.category}, цена ${painting.price}`);
    card.style.opacity = '0';
    
    // Обработчики событий
    const handleClick = () => selectPainting(painting.id);
    card.addEventListener('click', handleClick);
    card.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
        }
    });
    
    // Изображение с lazy loading
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'image-wrapper';
    imgWrapper.style.position = 'relative';
    imgWrapper.style.width = '100%';
    imgWrapper.style.height = '250px';
    imgWrapper.style.background = 'var(--light-gray)';
    
    const img = document.createElement('img');
    img.setAttribute('data-src', painting.image);
    img.alt = painting.title;
    img.loading = 'lazy';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.3s';
    
    // Placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'image-placeholder';
    placeholder.textContent = '🎨';
    placeholder.style.cssText = `
        display: none;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 48px;
        opacity: 0.3;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        background: var(--light-gray);
    `;
    
    imgWrapper.appendChild(img);
    imgWrapper.appendChild(placeholder);
    
    // Информация о картине
    const info = document.createElement('div');
    info.className = 'paint-info';
    
    const title = document.createElement('div');
    title.className = 'paint-title';
    title.textContent = painting.title;
    
    const category = document.createElement('div');
    category.className = 'paint-category';
    category.textContent = painting.category;
    
    const price = document.createElement('div');
    price.className = 'paint-price';
    price.textContent = painting.price;
    
    info.appendChild(title);
    info.appendChild(category);
    info.appendChild(price);
    
    // Бейдж
    if (painting.badge) {
        const badge = document.createElement('span');
        badge.className = 'paint-badge';
        badge.textContent = painting.badge;
        card.appendChild(badge);
    }
    
    card.appendChild(imgWrapper);
    card.appendChild(info);
    
    return card;
}

// === LAZY LOADING ДЛЯ ИЗОБРАЖЕНИЙ ===
function setupLazyLoading() {
    if (AppState.observer) {
        AppState.observer.disconnect();
    }

    AppState.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                
                if (src) {
                    safeLoadImage(img, src, img.alt);
                    img.removeAttribute('data-src');
                    AppState.observer.unobserve(img);
                }
            }
        });
    }, {
        rootMargin: '50px 0px',
        threshold: 0.01
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
        AppState.observer.observe(img);
    });
}

// === ЗАГРУЗКА ГАЛЕРЕИ ===
async function loadGallery() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    LoadingIndicator.show('Загрузка галереи...');
    
    try {
        // Очищаем галерею
        grid.innerHTML = '';
        
        // Загружаем данные
        const paintings = await loadPaintingsData();
        
        // Создаем фрагмент для оптимизации
        const fragment = document.createDocumentFragment();
        
        paintings.forEach((painting, index) => {
            const card = createPaintCard(painting, index);
            fragment.appendChild(card);
        });
        
        grid.appendChild(fragment);
        
        // Настраиваем lazy loading
        setupLazyLoading();
        
        // Анимация появления
        setTimeout(() => {
            const cards = grid.querySelectorAll('.paint-card');
            cards.forEach((card, index) => {
                setTimeout(() => {
                    card.style.opacity = '1';
                }, index * 30); // Ускоренная анимация
            });
        }, 100);
        
        Logger.info('Галерея загружена', { count: paintings.length });
        
    } catch (error) {
        Logger.error('Ошибка загрузки галереи', error);
        Notifications.error('Не удалось загрузить галерею');
    } finally {
        LoadingIndicator.hide();
    }
}

// === ВЫБОР КАРТИНЫ ===
function selectPainting(id) {
    if (!Validators.number(id, 1)) {
        Logger.error('Невалидный ID картины', id);
        return;
    }

    try {
        const painting = AppState.paintings.find(p => p.id === id);
        if (!painting) {
            Logger.error('Картина не найдена', id);
            Notifications.error('Картина не найдена');
            return;
        }

        // Снимаем выделение с предыдущей
        if (AppState.selectedPainting) {
            const prevCard = document.getElementById(`card-${AppState.selectedPainting.id}`);
            if (prevCard) prevCard.classList.remove('selected');
        }

        // Если выбрали ту же картину - снимаем выделение
        if (AppState.selectedPainting && AppState.selectedPainting.id === id) {
            AppState.selectedPainting = null;
            return;
        }

        // Выбираем новую
        AppState.selectedPainting = painting;
        const card = document.getElementById(`card-${id}`);
        if (card) card.classList.add('selected');
        
        // Показываем модальное окно просмотра
        showViewModal(painting);
        
    } catch (error) {
        Logger.error('Ошибка при выборе картины', error);
        Notifications.error('Не удалось открыть картину');
    }
}

// === МОДАЛЬНОЕ ОКНО ПРОСМОТРА ===
let isModalOpen = false;

function showViewModal(painting) {
    if (isModalOpen) return;
    isModalOpen = true;
    
    const modal = document.getElementById('viewModal');
    const content = document.getElementById('viewModalContent');
    
    if (!modal || !content) {
        isModalOpen = false;
        Logger.error('Модальное окно не найдено');
        return;
    }
    
    // Очищаем и создаем контент
    content.innerHTML = '';
    
    // Левая колонка с картиной
    const imageSection = document.createElement('div');
    imageSection.className = 'modal-image-section';
    imageSection.style.cssText = 'cursor: pointer; position: relative;';
    imageSection.setAttribute('role', 'button');
    imageSection.setAttribute('tabindex', '0');
    imageSection.setAttribute('aria-label', 'Открыть в полноэкранном режиме');
    
    const img = document.createElement('img');
    const imageUrl = painting.image;
    img.alt = painting.title;
    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.3s;';
    
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder';
    placeholder.textContent = '🎨';
    placeholder.style.cssText = 'display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 64px; opacity: 0.3;';
    
    imageSection.appendChild(img);
    imageSection.appendChild(placeholder);
    
    // Обработчики для полноэкранного режима
    const openFullscreen = (e) => {
        e.preventDefault();
        showFullscreenGallery(painting);
        setTimeout(() => closeViewModal(), 100);
    };
    
    imageSection.addEventListener('click', openFullscreen);
    imageSection.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            openFullscreen(e);
        }
    });
    
    // Правая колонка с информацией
    const infoSection = document.createElement('div');
    infoSection.className = 'modal-info-section';
    
    const infoContent = document.createElement('div');
    infoContent.className = 'modal-info-content';
    infoContent.innerHTML = `
        <div class="modal-title">Заказ: ${painting.title}</div>
        <div class="modal-category">${painting.category}</div>
        <div class="modal-price">${painting.price}</div>
        <div class="modal-description">
            Эта картина создается индивидуально под ваш заказ. 
            Срок выполнения: 2-4 дня.
        </div>
    `;
    
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    
    const orderBtn = document.createElement('button');
    orderBtn.className = 'btn-primary';
    orderBtn.textContent = 'Оформить заказ';
    orderBtn.setAttribute('aria-label', 'Оформить заказ на эту картину');
    orderBtn.onclick = () => proceedToOrder();
    
    actions.appendChild(orderBtn);
    infoSection.appendChild(infoContent);
    infoSection.appendChild(actions);
    
    // Кнопка закрытия
    const closeContainer = document.createElement('div');
    closeContainer.className = 'modal-close-container';
    closeContainer.setAttribute('role', 'button');
    closeContainer.setAttribute('aria-label', 'Закрыть окно просмотра');
    closeContainer.setAttribute('tabindex', '0');
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => closeViewModal();
    
    closeContainer.appendChild(closeBtn);
    
    // Собираем структуру
    content.appendChild(imageSection);
    content.appendChild(infoSection);
    content.appendChild(closeContainer);
    
    // Обработчик клавиатуры для крестика
    closeContainer.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            closeViewModal();
        }
    });
    
    // Показываем модальное окно
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
    
    // Загружаем изображение
    safeLoadImage(img, imageUrl, painting.title);
    
    // Управление фокусом
    setTimeout(() => closeContainer.focus(), 100);
    
    // ARIA атрибуты
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'modal-title');
    
    // Сбрасываем флаг после анимации
    setTimeout(() => {
        isModalOpen = false;
    }, 300);
}

function closeViewModal() {
    const modal = document.getElementById('viewModal');
    if (!modal || !modal.classList.contains('visible')) return;
    
    modal.classList.remove('visible');
    document.body.style.overflow = 'auto';
    
    // Удаляем ARIA атрибуты
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-labelledby');
    
    // Снимаем выделение только если не переходим в полноэкранный режим или к заказу
    const galleryModal = document.getElementById('fullscreenGallery');
    const isFullscreenOpen = galleryModal && galleryModal.classList.contains('visible');
    const confirmModal = document.getElementById('confirmModal');
    const isConfirmOpen = confirmModal && confirmModal.classList.contains('visible');
    
    if (!isFullscreenOpen && !isConfirmOpen && AppState.selectedPainting) {
        const card = document.getElementById(`card-${AppState.selectedPainting.id}`);
        if (card) {
            card.classList.remove('selected');
            card.focus();
        }
        AppState.selectedPainting = null;
    }
}

// === ПОЛНОЭКРАННАЯ ГАЛЕРЕЯ ===
function showFullscreenGallery(painting) {
    const galleryModal = document.getElementById('fullscreenGallery');
    const galleryImage = document.getElementById('fullscreenImage');
    const galleryOverlay = document.getElementById('galleryOverlay');
    const galleryTitle = document.getElementById('galleryTitle');
    const galleryCategory = document.getElementById('galleryCategory');
    const galleryLoading = document.querySelector('.gallery-loading');
    
    if (!galleryModal || !galleryImage || !galleryOverlay) {
        Logger.error('Галерея не найдена');
        return;
    }
    
    // Показываем индикатор загрузки
    if (galleryLoading) galleryLoading.classList.add('visible');
    
    // Устанавливаем изображение
    const imageUrl = painting.image;
    galleryImage.alt = painting.title;
    galleryImage.style.opacity = '0';
    
    // Обновляем информацию
    if (galleryTitle) galleryTitle.textContent = painting.title;
    if (galleryCategory) galleryCategory.textContent = painting.category;
    
    // Загружаем изображение
    safeLoadImage(galleryImage, imageUrl, painting.title).then(() => {
        if (galleryLoading) galleryLoading.classList.remove('visible');
    });
    
    // Показываем модальное окно
    galleryModal.classList.add('visible');
    galleryOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    
    // ARIA атрибуты
    galleryModal.setAttribute('aria-modal', 'true');
    galleryModal.setAttribute('role', 'dialog');
    galleryModal.setAttribute('aria-label', `Полноэкранное просмотра: ${painting.title}`);
    
    // Управление фокусом
    setTimeout(() => {
        const closeBtn = galleryModal.querySelector('.gallery-close');
        if (closeBtn) closeBtn.focus();
    }, 100);
    
    // Обработчик клавиатуры
    const keyHandler = (e) => {
        if (e.key === 'Escape') {
            closeFullscreenGallery();
        }
    };
    
    // Сохраняем обработчик для удаления
    galleryModal.dataset.keyHandler = 'true';
    document.addEventListener('keydown', keyHandler);
    galleryModal.dataset.keyHandlerFunc = keyHandler;
}

function closeFullscreenGallery() {
    const galleryModal = document.getElementById('fullscreenGallery');
    const galleryOverlay = document.getElementById('galleryOverlay');
    const galleryImage = document.getElementById('fullscreenImage');
    const galleryLoading = document.querySelector('.gallery-loading');
    
    if (!galleryModal || !galleryOverlay) return;
    
    // Удаляем обработчик клавиатуры
    if (galleryModal.dataset.keyHandlerFunc) {
        document.removeEventListener('keydown', galleryModal.dataset.keyHandlerFunc);
        delete galleryModal.dataset.keyHandlerFunc;
        delete galleryModal.dataset.keyHandler;
    }
    
    // Скрываем модальное окно
    galleryModal.classList.remove('visible');
    galleryOverlay.classList.remove('visible');
    document.body.style.overflow = 'auto';
    
    // Удаляем ARIA атрибуты
    galleryModal.removeAttribute('aria-modal');
    galleryModal.removeAttribute('role');
    galleryModal.removeAttribute('aria-label');
    
    // Очищаем изображение
    if (galleryImage) {
        galleryImage.onload = null;
        galleryImage.onerror = null;
        setTimeout(() => {
            galleryImage.src = '';
            galleryImage.style.opacity = '0';
        }, 50);
    }
    
    if (galleryLoading) {
        galleryLoading.classList.remove('visible');
    }
    
    // Возвращаемся к модальному окну просмотра
    if (AppState.selectedPainting) {
        setTimeout(() => {
            showViewModal(AppState.selectedPainting);
        }, 100);
    }
}

// === ПЕРЕХОД К ЗАКАЗУ ===
async function proceedToOrder() {
    if (!AppState.selectedPainting) {
        Notifications.error('Сначала выберите картину');
        return;
    }

    // Закрываем модальное окно просмотра
    const modal = document.getElementById('viewModal');
    if (modal && modal.classList.contains('visible')) {
        modal.classList.remove('visible');
        document.body.style.overflow = 'auto';
        modal.removeAttribute('aria-modal');
        modal.removeAttribute('role');
        modal.removeAttribute('aria-labelledby');
        isModalOpen = false;
    }
    
    LoadingIndicator.show('Создание заказа...');
    
    try {
        const isTelegramWebview = window.Telegram && window.Telegram.WebApp;
        
        if (isTelegramWebview) {
            Logger.info('Режим MiniApp: создаем заказ и закрываем');
            
            // В MiniApp сразу создаем заказ и закрываем
            const orderData = {
                action: 'create_order',
                painting: {
                    id: AppState.selectedPainting.id,
                    title: AppState.selectedPainting.title,
                    category: AppState.selectedPainting.category,
                    price: AppState.selectedPainting.price
                },
                timestamp: Date.now()
            };
            
            // Показываем уведомление пользователю
            Notifications.success('✅ Заказ создан! Открываю бота...');
            
            // Закрываем MiniApp через 1 секунду
            setTimeout(() => {
                window.Telegram.WebApp.close();
            }, 1000);
            
            // Отправляем данные в бот (если поддерживается)
            try {
                window.Telegram.WebApp.sendData(JSON.stringify(orderData));
            } catch (e) {
                // sendData может не работать в некоторых версиях - это нормально
                Logger.warn('sendData не поддерживается, используем close()');
            }
            
        } else {
            Logger.info('Обычный режим: открываем Telegram с quick order');
            
            const param = `quick_order_${AppState.selectedPainting.id}`;
            const url = `https://t.me/flexyframe_bot?start=${encodeURIComponent(param)}`;
            
            Notifications.success('Открываю Telegram для оформления заказа...');
            window.open(url, '_blank');
        }
        
    } catch (error) {
        Logger.error('Ошибка в proceedToOrder:', error);
        Notifications.error('Ошибка при создании заказа');
    } finally {
        LoadingIndicator.hide();
        
        // Сбрасываем выбор
        if (AppState.selectedPainting) {
            const card = document.getElementById(`card-${AppState.selectedPainting.id}`);
            if (card) card.classList.remove('selected');
        }
        AppState.selectedPainting = null;
    }
}

// === НАВИГАЦИЯ И МЕНЮ ===
async function showPaintingsMenu() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    
    // Прокручиваем к галерее
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Подсвечиваем галерею
    grid.style.animation = 'none';
    setTimeout(() => {
        grid.style.animation = 'pulse 0.6s ease-in-out';
    }, 10);
    
    Logger.info('Переход к выбору картин');
}

async function showSiteLink() {
    const message = 
        `📱 <b>Сайт FlexyFrame</b>\n\n` +
        `Откройте сайт для удобного выбора картин:\n\n` +
        `🔗 <b>${API_CONFIG.baseUrl}/index.html</b>\n\n` +
        `💡 <i>Как открыть в Telegram:</i>\n` +
        `1. Скопируйте ссылку\n` +
        `2. Вставьте в поиске Telegram\n` +
        `3. Или откройте в браузере\n\n` +
        `✅ На сайте можно:\n` +
        `• Выбрать картину\n` +
        `• Увидеть цену\n` +
        `• Нажать "Оформить заказ"\n` +
        `• Автоматически перейти в бота`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🌐 Открыть сайт', url: `${API_CONFIG.baseUrl}/index.html` }]
        ]
    };
    
    // В обычном режиме показываем уведомление
    if (!window.Telegram || !window.Telegram.WebApp) {
        Notifications.show(message, 'info', 8000);
    }
    
    Logger.info('Ссылка на сайт показана');
}

async function showHowItWorks() {
    const message = 
        `📋 <b>Как сделать заказ:</b>\n\n` +
        `1️⃣ <b>Выберите картину</b> из галереи\n` +
        `2️⃣ <b>Оформите заказ</b> в боте\n` +
        `3️⃣ <b>Оплатите</b> удобным способом\n` +
        `4️⃣ <b>Получите работу</b> через 2-4 дня\n\n` +
        `💳 <b>Способы оплаты:</b>\n` +
        `• ЮMoney\n` +
        `• Тинькофф\n` +
        `• Сбербанк\n\n` +
        `📦 <b>Доставка:</b>\n` +
        `• Электронная версия (PDF/JPG) - мгновенно\n` +
        `• Физическая печать - 2-4 дня + доставка\n\n` +
        `💡 <b>Сайт:</b> ${API_CONFIG.baseUrl}/index.html`;
    
    Notifications.show(message, 'info', 8000);
    Logger.info('Инструкция показана');
}

async function showAbout() {
    const message = 
        `🎨 <b>FlexyFrame — где искусство оживает в каждом штрихе</b>\n\n` +
        `Добро пожаловать в FlexyFrame — пространство, где цифровая эстетика встречается с ручной росписью, где ваши воспоминания становятся произведениями искусства, а любимые персонажи обретают новую жизнь на холсте.\n\n` +
        `Мы не просто печатаем картины — мы создаём уникальные арт-объекты, которые становятся центром вашего интерьера и отражением вашего вкуса.\n\n` +
        `✨ <b>Наши преимущества:</b>\n` +
        `🖼️ Печать на премиальном холсте\n` +
        `📏 Идеальный формат 60×50 см\n` +
        `🖌️ Ручная роспись по запросу\n` +
        `🌲 Авторские рамы из натуральной сосны\n\n` +
        `✅ <b>У нас вы можете:</b>\n` +
        `• Заказать картину по собственному макету\n` +
        `• Выбрать из авторской коллекции\n` +
        `• Превратить фотографию в музейный экспонат\n\n` +
        `📩 <b>Контакты:</b>\n` +
        `• Telegram: @flexyframe_bot\n` +
        `• Email: art@flexyframe.ru\n\n` +
        `🔗 <b>Сайт:</b> ${API_CONFIG.baseUrl}/index.html\n\n` +
        `💡 <i>FlexyFrame — это не просто картина. Это история, подсвеченная вашим вкусом.</i>`;
    
    Notifications.show(message, 'info', 10000);
    Logger.info('Информация о проекте показана');
}

async function showMyOrders() {
    // В статическом режиме показываем сообщение
    const message = 
        `📋 <b>Ваши заказы</b>\n\n` +
        `Для просмотра истории заказов пожалуйста:\n` +
        `1. Откройте бота @flexyframe_bot\n` +
        `2. Введите команду /start\n` +
        `3. Выберите "🛒 Мои заказы"\n\n` +
        `💡 Все ваши заказы сохраняются в нашей системе и доступны в любое время.`;
    
    Notifications.show(message, 'info', 8000);
    Logger.info('Запрос истории заказов');
}

// === ОБРАБОТКА ОШИБОК И ИСКЛЮЧЕНИЙ ===
function setupErrorHandling() {
    // Обработка необработанных Promise
    window.addEventListener('unhandledrejection', (event) => {
        Logger.error('Unhandled promise rejection', event.reason);
        Notifications.error('Произошла ошибка сети');
        event.preventDefault();
    });
    
    // Обработка глобальных ошибок
    window.addEventListener('error', (event) => {
        // Игнорируем ошибки ResizeObserver
        if (event.error && event.error.message && event.error.message.includes('ResizeObserver')) {
            return;
        }
        
        Logger.error('Global error', event.error);
        // Не показываем уведомление для всех ошибок, только для критических
    });
    
    // Обработка изменения сетевого статуса
    window.addEventListener('online', () => {
        Notifications.success('Интернет-соединение восстановлено');
    });
    
    window.addEventListener('offline', () => {
        Notifications.error('Потеряно интернет-соединение');
    });
}

// === СКРЫТИЕ ХЕДЕРА ПРИ ПРОКРУТКЕ ===
function setupHeaderScroll() {
    let lastScroll = 0;
    const header = document.querySelector('header');
    const logo = document.querySelector('.logo-image');
    const nav = document.querySelector('nav');
    
    if (!header || !logo) {
        console.log('❌ Header elements not found');
        return;
    }
    
    console.log('✅ Header scroll initialized', { header, logo, nav });
    
    // Проверяем, мобильная ли версия
    const isMobile = () => window.innerWidth <= 768;
    
    // Проверяем, MiniApp ли это
    const isMiniApp = () => {
        return window.Telegram && window.Telegram.WebApp;
    };
    
    // Обработчик прокрутки
    const handleScroll = () => {
        const currentScroll = window.scrollY;
        const isMobileView = isMobile();
        const isTelegramMiniApp = isMiniApp();
        
        console.log('Scroll:', currentScroll, 'Mobile:', isMobileView, 'MiniApp:', isTelegramMiniApp);
        
        if (isTelegramMiniApp) {
            // В MiniApp: скрываем ВЕСЬ header полностью
            if (currentScroll > 30) {
                header.style.transform = 'translateY(-100%)';
                header.style.opacity = '0';
                header.style.pointerEvents = 'none';
                console.log('📱 MiniApp: Скрываем header полностью');
            } else {
                header.style.transform = 'translateY(0)';
                header.style.opacity = '1';
                header.style.pointerEvents = 'auto';
                console.log('📱 MiniApp: Показываем header');
            }
        } else if (isMobileView) {
            // На мобильной версии сайта: скрываем только логотип и навигацию
            if (currentScroll > 30) {
                // Скрываем содержимое
                if (logo) {
                    logo.style.opacity = '0';
                    logo.style.transform = 'translateY(-20px)';
                    logo.style.pointerEvents = 'none';
                    console.log('📱 Мобильная: Скрываем логотип');
                }
                if (nav) {
                    nav.style.opacity = '0';
                    nav.style.transform = 'translateY(-20px)';
                    nav.style.pointerEvents = 'none';
                    console.log('📱 Мобильная: Скрываем навигацию');
                }
            } else {
                // Показываем содержимое
                if (logo) {
                    logo.style.opacity = '1';
                    logo.style.transform = 'translateY(0)';
                    logo.style.pointerEvents = 'auto';
                    console.log('📱 Мобильная: Показываем логотип');
                }
                if (nav) {
                    nav.style.opacity = '1';
                    nav.style.transform = 'translateY(0)';
                    nav.style.pointerEvents = 'auto';
                    console.log('📱 Мобильная: Показываем навигацию');
                }
            }
        } else {
            // На десктопе: скрываем только логотип и навигацию, header остается видимым
            if (currentScroll > 50) {
                // Скрываем содержимое header
                if (logo) {
                    logo.style.opacity = '0';
                    logo.style.transform = 'translateY(-20px)';
                    logo.style.pointerEvents = 'none';
                    console.log('🖥️ Десктоп: Скрываем логотип');
                }
                if (nav) {
                    nav.style.opacity = '0';
                    nav.style.transform = 'translateY(-20px)';
                    nav.style.pointerEvents = 'none';
                    console.log('🖥️ Десктоп: Скрываем навигацию');
                }
            } else {
                // Показываем содержимое header
                if (logo) {
                    logo.style.opacity = '1';
                    logo.style.transform = 'translateY(0)';
                    logo.style.pointerEvents = 'auto';
                    console.log('🖥️ Десктоп: Показываем логотип');
                }
                if (nav) {
                    nav.style.opacity = '1';
                    nav.style.transform = 'translateY(0)';
                    nav.style.pointerEvents = 'auto';
                    console.log('🖥️ Десктоп: Показываем навигацию');
                }
            }
        }
        
        lastScroll = currentScroll;
    };
    
    // Добавляем стили для плавных переходов
    if (logo) {
        logo.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        logo.style.willChange = 'opacity, transform';
    }
    
    if (nav) {
        nav.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        nav.style.willChange = 'opacity, transform';
    }
    
    // Для MiniApp добавляем transition к header
    if (window.Telegram && window.Telegram.WebApp && header) {
        header.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        header.style.willChange = 'transform, opacity';
    }
    
    // Подписываемся на событие прокрутки
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    // Обработчик изменения размера окна
    window.addEventListener('resize', () => {
        console.log('Resize:', window.innerWidth);
        // Сбрасываем стили при изменении размера
        if (!isMobile() && !isMiniApp()) {
            if (logo) {
                logo.style.opacity = '1';
                logo.style.transform = '';
            }
            if (nav) {
                nav.style.opacity = '1';
                nav.style.transform = '';
            }
            if (header) {
                header.style.transform = '';
                header.style.opacity = '';
                header.style.pointerEvents = '';
            }
        }
    });
    
    console.log('✅ Header scroll setup complete');
}

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Проверка поддержки API
        if (!('IntersectionObserver' in window)) {
            Notifications.warn('Обновите браузер для лучшего опыта');
        }
        
        // Проверка сетевого соединения
        if (!navigator.onLine) {
            Notifications.error('Отсутствует интернет-соединение');
        }
        
        // Загружаем галерею
        await loadGallery();
        
        // Настраиваем обработку ошибок
        setupErrorHandling();
        
        // Настраиваем скрытие хедера при прокрутке
        setupHeaderScroll();
        
        // Настраиваем плавную навигацию
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
        
        // Закрытие модальных окон по клику на фон
        const viewModal = document.getElementById('viewModal');
        const fullscreenGallery = document.getElementById('fullscreenGallery');
        
        if (viewModal) {
            viewModal.addEventListener('click', (e) => {
                if (e.target === viewModal) closeViewModal();
            });
        }
        
        if (fullscreenGallery) {
            fullscreenGallery.addEventListener('click', (e) => {
                if (e.target === fullscreenGallery || e.target.classList.contains('gallery-overlay')) {
                    closeFullscreenGallery();
                }
            });
        }
        
        // Предзагрузка первых изображений
        setTimeout(() => {
            const imagesToPreload = AppState.paintings.slice(0, 3).map(p => p.image);
            imagesToPreload.forEach(src => {
                const img = new Image();
                img.src = src;
            });
        }, 1000);
        
        Logger.info('Приложение инициализировано');
        
    } catch (error) {
        Logger.error('Ошибка инициализации', error);
        Notifications.error('Ошибка при запуске приложения');
    }
});

// === ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ HTML ===
window.FlexyFrame = {
    showPaintingsMenu,
    showSiteLink,
    showHowItWorks,
    showAbout,
    showMyOrders,
    proceedToOrder,
    closeViewModal,
    closeFullscreenGallery,
    selectPainting
};