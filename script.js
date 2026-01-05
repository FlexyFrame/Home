// === ДАННЫЕ КАРТИН ===
let paintings = [];
let apiAvailable = false;

// Загрузка данных с сервера
async function loadPaintingsData() {
    // Всегда используем локальные данные для статической сборки
    console.log('⚠️ Используем локальные данные (статический режим)');
    paintings = [
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
    apiAvailable = false;
}

let selectedPainting = null;
let isLoading = false;
let observer = null;

// === УПРАВЛЕНИЕ УВЕДОМЛЕНИЯМИ (ТОЛЬКО ОШИБКИ И УСПЕХ) ===
function showNotification(message, type = 'success', duration = 3000) {
    // Пропускаем info уведомления
    if (type === 'info') return;
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'polite');
    
    document.body.appendChild(notification);
    
    // Активация анимации
    setTimeout(() => notification.classList.add('visible'), 10);
    
    // Автоматическое скрытие
    const hideTimeout = setTimeout(() => {
        notification.classList.remove('visible');
        setTimeout(() => notification.remove(), 300);
    }, duration);
    
    // Клик для ручного закрытия
    notification.addEventListener('click', () => {
        clearTimeout(hideTimeout);
        notification.classList.remove('visible');
        setTimeout(() => notification.remove(), 300);
    });
    
    return notification;
}

// === ИНДИКАТОР ЗАГРУЗКИ ===
function showLoading(message = 'Загрузка...') {
    if (isLoading) return;
    isLoading = true;
    
    const indicator = document.createElement('div');
    indicator.className = 'loading-indicator';
    indicator.textContent = message;
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    
    document.body.appendChild(indicator);
    
    setTimeout(() => indicator.classList.add('visible'), 10);
}

function hideLoading() {
    const indicator = document.querySelector('.loading-indicator');
    if (indicator) {
        indicator.classList.remove('visible');
        setTimeout(() => indicator.remove(), 300);
    }
    isLoading = false;
}

// === ОБРАБОТКА ОШИБОК ===
function handleError(error, userMessage = 'Произошла ошибка') {
    console.error('Error:', error);
    showNotification(userMessage, 'error', 5000);
    hideLoading();
}

// === ПРОВЕРКА ДОСТУПНОСТИ ИЗОБРАЖЕНИЯ ===
async function checkImageAvailability(src) {
    try {
        const response = await fetch(src, { method: 'HEAD', mode: 'no-cors' });
        return true; // Если нет ошибки - изображение доступно
    } catch (error) {
        console.warn('Image not available:', src);
        return false;
    }
}

// === БЕЗОПАСНАЯ ЗАГРУЗКА ИЗОБРАЖЕНИЯ ===
function safeLoadImage(img, src, placeholderText = '') {
    // Проверяем доступность
    checkImageAvailability(src).then(available => {
        if (available) {
            img.src = src;
        } else {
            // Используем плейсхолдер
            const svgPlaceholder = `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22250%22%3E%3Crect width=%22300%22 height=%22250%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-family=%22Arial%22 font-size=%2216%22%3E${encodeURIComponent(placeholderText)}%3C/text%3E%3C/svg%3E`;
            img.src = svgPlaceholder;
            img.style.objectFit = 'contain';
            img.style.padding = '20px';
            
            // Показываем уведомление один раз
            if (!sessionStorage.getItem('image_error_shown')) {
                showNotification('Некоторые изображения недоступны', 'error', 3000);
                sessionStorage.setItem('image_error_shown', 'true');
            }
        }
    }).catch(() => {
        // Fallback на случай ошибки сети
        const svgPlaceholder = `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22250%22%3E%3Crect width=%22300%22 height=%22250%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-family=%22Arial%22 font-size=%2216%22%3E${encodeURIComponent(placeholderText)}%3C/text%3E%3C/svg%3E`;
        img.src = svgPlaceholder;
        img.style.objectFit = 'contain';
        img.style.padding = '20px';
    });
}

// === ЗАГРУЗКА ГАЛЕРЕИ С ОПТИМИЗАЦИЕЙ ===
function loadGallery() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    // Очищаем галерею
    grid.innerHTML = '';
    
    // Создаем фрагмент для оптимизации
    const fragment = document.createDocumentFragment();
    
    paintings.forEach((painting, index) => {
        const card = createPaintCard(painting, index);
        fragment.appendChild(card);
    });
    
    grid.appendChild(fragment);
    
    // Настройка Intersection Observer для lazy loading
    setupLazyLoading();
    
    // Анимация появления
    setTimeout(() => {
        const cards = grid.querySelectorAll('.paint-card');
        cards.forEach((card, index) => {
            setTimeout(() => {
                card.style.opacity = '1';
            }, index * 50); // Ускоренная анимация
        });
    }, 100);
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
    card.addEventListener('click', () => selectPainting(painting.id));
    card.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectPainting(painting.id);
        }
    });
    
    // Изображение с lazy loading
    const img = document.createElement('img');
    img.setAttribute('data-src', painting.image);
    img.alt = painting.title;
    img.loading = 'lazy';
    
    // Обработчик ошибки загрузки
    img.addEventListener('error', function() {
        this.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22250%22%3E%3Crect width=%22300%22 height=%22250%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-family=%22Arial%22 font-size=%2216%22%3E' + painting.title + '%3C/text%3E%3C/svg%3E';
        this.style.objectFit = 'contain';
        this.style.padding = '20px';
    });
    
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
    
    card.appendChild(img);
    card.appendChild(info);
    
    return card;
}

// === LAZY LOADING ДЛЯ ИЗОБРАЖЕНИЙ ===
function setupLazyLoading() {
    // Удаляем старый observer если есть
    if (observer) {
        observer.disconnect();
    }
    
    // Создаем новый Intersection Observer
    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                
                if (src) {
                    img.src = src;
                    img.removeAttribute('data-src');
                    observer.unobserve(img);
                }
            }
        });
    }, {
        rootMargin: '50px 0px',
        threshold: 0.01
    });
    
    // Наблюдаем за всеми изображениями
    document.querySelectorAll('img[data-src]').forEach(img => {
        observer.observe(img);
    });
}

// === ВЫБОР КАРТИНЫ ===
function selectPainting(id) {
    try {
        const painting = paintings.find(p => p.id === id);
        if (!painting) {
            throw new Error('Картина не найдена');
        }

        // Снимаем выделение с предыдущей
        if (selectedPainting) {
            const prevCard = document.getElementById(`card-${selectedPainting.id}`);
            if (prevCard) prevCard.classList.remove('selected');
        }

        // Если выбрали ту же картину - снимаем выделение
        if (selectedPainting && selectedPainting.id === id) {
            selectedPainting = null;
            return;
        }

        // Выбираем новую
        selectedPainting = painting;
        const card = document.getElementById(`card-${id}`);
        if (card) card.classList.add('selected');
        
        // Показываем модальное окно просмотра
        showViewModal(painting);
        
    } catch (error) {
        handleError(error, 'Не удалось открыть картину');
    }
}

// === МОДАЛЬНОЕ ОКНО ПРОСМОТРА ===
let isModalOpen = false; // Флаг для предотвращения множественных вызовов

function showViewModal(painting) {
    console.log('showViewModal called with painting:', painting); // ОТЛАДКА
    
    // Защита от множественных вызовов
    if (isModalOpen) return;
    isModalOpen = true;
    
    const modal = document.getElementById('viewModal');
    const content = document.getElementById('viewModalContent');
    
    if (!modal || !content) {
        isModalOpen = false;
        handleError(new Error('Модальное окно не найдено'), 'Ошибка открытия окна');
        return;
    }
    
    // Очищаем контент и создаем новую структуру каждый раз
    content.innerHTML = '';
    
    // ЛЕВАЯ КОЛОНКА С КАРТИНОЙ (кликабельная)
    const imageSection = document.createElement('div');
    imageSection.className = 'modal-image-section';
    imageSection.style.cursor = 'pointer';
    imageSection.setAttribute('role', 'button');
    imageSection.setAttribute('tabindex', '0');
    imageSection.setAttribute('aria-label', 'Открыть в полноэкранном режиме');
    
    const img = document.createElement('img');
    // Используем полный URL для MiniApp
    const imageUrl = window.location.pathname.includes('miniapp') || window.location.pathname.includes('index') 
        ? painting.image 
        : painting.image;
    img.src = imageUrl;
    img.alt = painting.title;
    
    // Обработчик ошибки загрузки
    img.onerror = function() {
        console.warn('Ошибка загрузки изображения:', imageUrl);
        this.style.display = 'none';
        const placeholder = this.parentElement.querySelector('.placeholder');
        if (placeholder) {
            placeholder.style.display = 'flex';
        }
    };
    
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder';
    placeholder.textContent = '🎨';
    placeholder.style.display = 'none';
    
    imageSection.appendChild(img);
    imageSection.appendChild(placeholder);
    
    // ОБРАБОТЧИК КЛИКА НА КАРТИНУ (открытие полноэкранного режима)
    imageSection.addEventListener('click', function(e) {
        console.log('Клик на картину! painting:', painting); // ОТЛАДКА
        e.preventDefault();
        
        // Сохраняем выбранную картину
        selectedPainting = painting;
        
        // Открываем полноэкранный режим
        showFullscreenGallery(painting);
        
        // Закрываем модальное окно просмотра
        setTimeout(() => {
            closeViewModal();
        }, 100);
    });
    
    // ОБРАБОТЧИК КЛАВИАТУРЫ (Enter/Space)
    imageSection.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            console.log('Клавиша на картину! painting:', painting); // ОТЛАДКА
            e.preventDefault();
            
            // Сохраняем выбранную картину
            selectedPainting = painting;
            
            // Открываем полноэкранный режим
            showFullscreenGallery(painting);
            
            // Закрываем модальное окно просмотра
            setTimeout(() => {
                closeViewModal();
            }, 100);
        }
    });
    
    // ПРАВАЯ КОЛОНКА С ИНФОРМАЦИЕЙ
    const infoSection = document.createElement('div');
    infoSection.className = 'modal-info-section';
    
    const infoContentDiv = document.createElement('div');
    infoContentDiv.className = 'modal-info-content';
    infoContentDiv.innerHTML = `
        <div class="modal-title">Заказ: ${painting.title}</div>
        <div class="modal-category">${painting.category}</div>
        <div class="modal-price">${painting.price}</div>
        <div class="modal-description">
            Эта картина создается индивидуально под ваш заказ. 
            Срок выполнения: 2-4 дня.
        </div>
    `;
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'modal-actions';
    
    // Кнопка "Оформить заказ"
    const orderBtn = document.createElement('button');
    orderBtn.className = 'btn-primary';
    orderBtn.textContent = 'Оформить заказ';
    orderBtn.setAttribute('aria-label', 'Оформить заказ на эту картину');
    orderBtn.onclick = () => proceedToOrder();
    
    actionsDiv.appendChild(orderBtn);
    infoSection.appendChild(infoContentDiv);
    infoSection.appendChild(actionsDiv);
    
    // КНОПКА ЗАКРЫТИЯ (крестик)
    const closeBtnContainer = document.createElement('div');
    closeBtnContainer.className = 'modal-close-container';
    closeBtnContainer.setAttribute('role', 'button');
    closeBtnContainer.setAttribute('aria-label', 'Закрыть окно просмотра');
    closeBtnContainer.setAttribute('tabindex', '0');
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => closeViewModal();
    
    closeBtnContainer.appendChild(closeBtn);
    
    // СОБИРАЕМ ВСЮ СТРУКТУРУ
    content.appendChild(imageSection);
    content.appendChild(infoSection);
    content.appendChild(closeBtnContainer);
    
    // Обработчик клавиатуры для крестика
    closeBtnContainer.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            closeViewModal();
        }
    });
    
    // Показываем модальное окно
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
    
    // Управление фокусом
    setTimeout(() => {
        closeBtnContainer.focus();
    }, 100);
    
    // Добавляем ARIA атрибуты
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'modal-title');
    
    // Сбрасываем флаг после завершения анимации
    setTimeout(() => {
        isModalOpen = false;
    }, 300);
}

function closeViewModal() {
    const modal = document.getElementById('viewModal');
    if (!modal) return;
    
    // Предотвращаем множественные вызовы
    if (!modal.classList.contains('visible')) return;
    
    modal.classList.remove('visible');
    document.body.style.overflow = 'auto';
    
    // Удаляем ARIA атрибуты
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('role');
    modal.removeAttribute('aria-labelledby');
    
    // Снимаем выделение только если не переходим в полноэкранный режим И не переходим к заказу
    const galleryModal = document.getElementById('fullscreenGallery');
    const isFullscreenOpen = galleryModal && galleryModal.classList.contains('visible');
    const confirmModal = document.getElementById('confirmModal');
    const isConfirmOpen = confirmModal && confirmModal.classList.contains('visible');
    
    if (!isFullscreenOpen && !isFullscreenOpen && selectedPainting) {
        const card = document.getElementById(`card-${selectedPainting.id}`);
        if (card) {
            card.classList.remove('selected');
            // Возвращаем фокус на карточку
            card.focus();
        }
        // НЕ сбрасываем selectedPainting если переходим к заказу
        if (!isConfirmOpen) {
            selectedPainting = null;
        }
    }
    
    isModalOpen = false;
}

// === ПОЛНОЭКРАННАЯ ГАЛЕРЕЯ С ЗАТЕМНЕНИЕМ ===
function showFullscreenGallery(painting) {
    const galleryModal = document.getElementById('fullscreenGallery');
    const galleryImage = document.getElementById('fullscreenImage');
    const galleryOverlay = document.getElementById('galleryOverlay');
    const galleryTitle = document.getElementById('galleryTitle');
    const galleryCategory = document.getElementById('galleryCategory');
    const galleryLoading = document.querySelector('.gallery-loading');
    
    if (!galleryModal || !galleryImage || !galleryOverlay) {
        handleError(new Error('Галерея не найдена'), 'Ошибка открытия галереи');
        return;
    }
    
    // Показываем индикатор загрузки
    if (galleryLoading) galleryLoading.classList.add('visible');
    
    // Устанавливаем изображение (используем полный путь)
    const imageUrl = painting.image;
    galleryImage.src = imageUrl;
    galleryImage.alt = painting.title;
    
    // Обновляем информацию
    if (galleryTitle) galleryTitle.textContent = painting.title;
    if (galleryCategory) galleryCategory.textContent = painting.category;
    
    // Обработчик загрузки изображения
    galleryImage.onload = function() {
        if (galleryLoading) galleryLoading.classList.remove('visible');
        galleryImage.style.opacity = '1';
    };
    
    // Обработчик ошибки загрузки
    galleryImage.onerror = function() {
        if (galleryLoading) galleryLoading.classList.remove('visible');
        showNotification('Не удалось загрузить изображение', 'error');
        closeFullscreenGallery();
    };
    
    // Показываем модальное окно
    galleryModal.classList.add('visible');
    galleryOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    
    // Добавляем ARIA атрибуты
    galleryModal.setAttribute('aria-modal', 'true');
    galleryModal.setAttribute('role', 'dialog');
    galleryModal.setAttribute('aria-label', `Полноэкранное просмотра: ${painting.title}`);
    
    // Управление фокусом
    setTimeout(() => {
        const closeBtn = galleryModal.querySelector('.gallery-close');
        if (closeBtn) closeBtn.focus();
    }, 100);
    
    // Добавляем обработчики клавиатуры для галереи
    setupGalleryKeyboardNavigation();
}

function closeFullscreenGallery() {
    const galleryModal = document.getElementById('fullscreenGallery');
    const galleryOverlay = document.getElementById('galleryOverlay');
    const galleryImage = document.getElementById('fullscreenImage');
    const galleryLoading = document.querySelector('.gallery-loading');
    
    if (!galleryModal || !galleryOverlay) return;
    
    // Сначала скрываем модальное окно
    galleryModal.classList.remove('visible');
    galleryOverlay.classList.remove('visible');
    document.body.style.overflow = 'auto';
    
    // Удаляем ARIA атрибуты
    galleryModal.removeAttribute('aria-modal');
    galleryModal.removeAttribute('role');
    galleryModal.removeAttribute('aria-label');
    
    // Удаляем обработчики клавиатуры
    removeGalleryKeyboardNavigation();
    
    // Очищаем изображение и скрываем индикатор загрузки
    if (galleryImage) {
        // Удаляем обработчики событий чтобы предотвратить повторные вызовы
        galleryImage.onload = null;
        galleryImage.onerror = null;
        
        // Очищаем src только после небольшой задержки
        setTimeout(() => {
            if (galleryImage) {
                galleryImage.src = '';
                galleryImage.style.opacity = '0';
            }
            if (galleryLoading) {
                galleryLoading.classList.remove('visible');
            }
        }, 50);
    }
    
    // Возвращаемся на страницу заказа (открываем модальное окно просмотра снова)
    if (selectedPainting) {
        setTimeout(() => {
            showViewModal(selectedPainting);
        }, 100);
    }
}

// === НАВИГАЦИЯ В ПОЛНОЭКРАННОЙ ГАЛЕРЕЕ (ТОЛЬКО ESCAPE) ===
function setupGalleryKeyboardNavigation() {
    document.addEventListener('keydown', galleryKeyHandler);
}

function removeGalleryKeyboardNavigation() {
    document.removeEventListener('keydown', galleryKeyHandler);
}

function galleryKeyHandler(e) {
    const galleryModal = document.getElementById('fullscreenGallery');
    if (!galleryModal || !galleryModal.classList.contains('visible')) return;
    
    // Только закрытие по ESCAPE
    if (e.key === 'Escape') {
        closeFullscreenGallery();
    }
    // Убираем навигацию стрелками
}

// === НАВИГАЦИЯ МЕЖДУ КАРТИНАМИ (УБРАНА) ===
// Функции navigateToPrevious и navigateToNext удалены
// Функция updateFullscreenGallery удалена

// === ПЕРЕХОД К ЗАКАЗУ ===
function proceedToOrder() {
    if (!selectedPainting) {
        showNotification('Сначала выберите картину', 'error');
        return;
    }

    // Закрываем модальное окно просмотра (но НЕ сбрасываем selectedPainting)
    const modal = document.getElementById('viewModal');
    if (modal && modal.classList.contains('visible')) {
        modal.classList.remove('visible');
        document.body.style.overflow = 'auto';
        
        // Удаляем ARIA атрибуты
        modal.removeAttribute('aria-modal');
        modal.removeAttribute('role');
        modal.removeAttribute('aria-labelledby');
        
        isModalOpen = false;
    }
    
    // Показываем модальное окно подтверждения
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) {
        confirmModal.classList.add('visible');
        document.body.style.overflow = 'hidden';
        
        // Управление фокусом
        setTimeout(() => {
            const confirmBtn = confirmModal.querySelector('.btn-primary');
            if (confirmBtn) confirmBtn.focus();
        }, 100);
        
        // ARIA атрибуты
        confirmModal.setAttribute('aria-modal', 'true');
        confirmModal.setAttribute('role', 'dialog');
    }
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;
    
    modal.classList.remove('visible');
    document.body.style.overflow = 'auto';
    
    // Удаляем ARIA атрибуты
    modal.removeAttribute('aria-modal');
    modal.removeAttribute('role');
}

// === TELEGRAM БОТ (СТАТИЧЕСКИЙ РЕЖИМ) ===
async function openTelegramBot() {
    console.log('🎯 openTelegramBot() вызвана');
    
    if (!selectedPainting) {
        showNotification('Сначала выберите картину', 'error');
        return;
    }

    // Проверяем, находимся ли мы в Telegram MiniApp
    const isTelegramWebview = window.Telegram && window.Telegram.WebApp;
    console.log('📱 Telegram WebApp:', isTelegramWebview);
    console.log('🎨 Выбранная картина:', selectedPainting);
    
    try {
        closeConfirmModal();
        
        // В MiniApp не показываем индикатор загрузки
        if (!isTelegramWebview) {
            showLoading('Подготовка заказа...');
        }
        
        // В статическом режиме всегда используем fallback
        console.log('⚠️ Статический режим: используем прямую ссылку');
        
        if (isTelegramWebview) {
            console.log('🔒 Закрываем MiniApp...');
            // В MiniApp просто закрываем
            window.Telegram.WebApp.close();
            console.log('✅ MiniApp закрыта');
        } else {
            // В обычном браузере открываем Telegram с информацией о заказе
            const message = `Здравствуйте! Хочу заказать картину "${selectedPainting.title}" (${selectedPainting.category}) - ${selectedPainting.price}`;
            const url = `https://t.me/flexyframe_bot?text=${encodeURIComponent(message)}`;
            
            hideLoading();
            showNotification('Открываю Telegram...', 'success');
            window.open(url, '_blank');
        }
        
        // Сбрасываем выбор
        if (selectedPainting) {
            const card = document.getElementById(`card-${selectedPainting.id}`);
            if (card) card.classList.remove('selected');
        }
        selectedPainting = null;
        
    } catch (error) {
        console.error('❌ Ошибка в openTelegramBot():', error);
        
        // В MiniApp не показываем ошибки
        if (!isTelegramWebview) {
            hideLoading();
            handleError(error, 'Ошибка при создании заказа');
            
            setTimeout(() => {
                if (confirm('Не удалось открыть Telegram. Попробовать снова?')) {
                    const message = `Здравствуйте! Хочу заказать картину "${selectedPainting.title}"`;
                    const url = `https://t.me/flexyframe_bot?text=${encodeURIComponent(message)}`;
                    window.open(url, '_blank');
                }
            }, 1000);
        } else {
            // В MiniApp просто закрываем при ошибке
            console.log('🔒 Закрываем MiniApp при ошибке...');
            window.Telegram.WebApp.close();
        }
    }
}

function openTelegram(paintingTitle = '') {
    try {
        const message = paintingTitle 
            ? `Здравствуйте! Хочу заказать картину "${paintingTitle}"`
            : 'Здравствуйте! Хочу заказать уникальную граффити-арт работу';
        
        const url = `https://t.me/flexyframe_bot?text=${encodeURIComponent(message)}`;
        
        showNotification('Открываю Telegram...', 'success');
        window.open(url, '_blank');
        
    } catch (error) {
        handleError(error, 'Не удалось открыть Telegram');
    }
}

// === АНИМАЦИИ ПРИ СКРОЛЛЕ ===
function setupScrollAnimations() {
    // Удаляем старый observer если есть
    if (window.scrollObserver) {
        window.scrollObserver.disconnect();
    }
    
    const scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('fade-in');
                // Оптимизация: перестаем наблюдать после появления
                scrollObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '50px 0px'
    });

    document.querySelectorAll('section').forEach(section => {
        scrollObserver.observe(section);
    });
    
    window.scrollObserver = scrollObserver;
}

// === ПЛАВНАЯ НАВИГАЦИЯ ===
function setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// === НАВИГАЦИЯ КЛАВИШАМИ И СВАЙПЫ ===
let currentPaintingIndex = 0;
let touchStartX = 0;
let touchEndX = 0;

// Навигация клавишами для модального окна просмотра (заказы)
function setupKeyboardNavigation() {
    document.addEventListener('keydown', function(e) {
        const viewModal = document.getElementById('viewModal');
        const isViewModalOpen = viewModal && viewModal.classList.contains('visible');
        
        // Если открыто модальное окно просмотра - навигация стрелками для заказов
        if (isViewModalOpen) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigateToPrevious();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigateToNext();
            }
        }
        
        // Закрытие по ESC
        if (e.key === 'Escape') {
            closeViewModal();
            closeConfirmModal();
            closeFullscreenGallery();
        }
    });
}

// Поддержка свайпов для мобильных устройств (ТОЛЬКО ДЛЯ МОДАЛЬНОГО ОКНА ПРОСМОТРА)
function setupSwipeNavigation() {
    const viewModal = document.getElementById('viewModal');
    if (!viewModal) return;
    
    // Обработчики касаний
    viewModal.addEventListener('touchstart', function(e) {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    
    viewModal.addEventListener('touchend', function(e) {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });
}

// Обработка свайпа (только для модального окна просмотра)
function handleSwipe() {
    const swipeThreshold = 50; // Минимальное расстояние для свайпа
    
    if (touchEndX < touchStartX - swipeThreshold) {
        // Свайп влево -> следующая картинка
        navigateToNext();
    }
    
    if (touchEndX > touchStartX + swipeThreshold) {
        // Свайп вправо -> предыдущая картинка
        navigateToPrevious();
    }
}

// === НАВИГАЦИЯ МЕЖДУ КАРТИНАМИ (ТОЛЬКО ДЛЯ МОДАЛЬНОГО ОКНА ПРОСМОТРА) ===
function navigateToPrevious() {
    if (!selectedPainting) return;
    
    try {
        const currentIndex = paintings.findIndex(p => p.id === selectedPainting.id);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : paintings.length - 1;
        
        const prevPainting = paintings[prevIndex];
        if (prevPainting) {
            // Обновляем выделение
            const prevCard = document.getElementById(`card-${selectedPainting.id}`);
            if (prevCard) prevCard.classList.remove('selected');
            
            selectedPainting = prevPainting;
            const newCard = document.getElementById(`card-${prevPainting.id}`);
            if (newCard) newCard.classList.add('selected');
            
            // Проверяем, открыта ли полноэкранная галерея
            const galleryModal = document.getElementById('fullscreenGallery');
            const isFullscreenOpen = galleryModal && galleryModal.classList.contains('visible');
            
            if (isFullscreenOpen) {
                // Обновляем полноэкранную галерею
                updateFullscreenGallery(prevPainting);
            } else {
                // Обновляем обычное модальное окно
                updateViewModal(prevPainting);
            }
            
            // Показываем уведомление
            showNotification(`Переключено на: ${prevPainting.title}`, 'info', 1500);
        }
    } catch (error) {
        handleError(error, 'Ошибка навигации');
    }
}

function navigateToNext() {
    if (!selectedPainting) return;
    
    try {
        const currentIndex = paintings.findIndex(p => p.id === selectedPainting.id);
        const nextIndex = currentIndex < paintings.length - 1 ? currentIndex + 1 : 0;
        
        const nextPainting = paintings[nextIndex];
        if (nextPainting) {
            // Обновляем выделение
            const prevCard = document.getElementById(`card-${selectedPainting.id}`);
            if (prevCard) prevCard.classList.remove('selected');
            
            selectedPainting = nextPainting;
            const newCard = document.getElementById(`card-${nextPainting.id}`);
            if (newCard) newCard.classList.add('selected');
            
            // Проверяем, открыта ли полноэкранная галерея
            const galleryModal = document.getElementById('fullscreenGallery');
            const isFullscreenOpen = galleryModal && galleryModal.classList.contains('visible');
            
            if (isFullscreenOpen) {
                // Обновляем полноэкранную галерею
                updateFullscreenGallery(nextPainting);
            } else {
                // Обновляем обычное модальное окно
                updateViewModal(nextPainting);
            }
            
            // Показываем уведомление
            showNotification(`Переключено на: ${nextPainting.title}`, 'info', 1500);
        }
    } catch (error) {
        handleError(error, 'Ошибка навигации');
    }
}

// === ОБНОВЛЕНИЕ ПОЛНОЭКРАННОЙ ГАЛЕРЕИ ===
function updateFullscreenGallery(painting) {
    const galleryImage = document.getElementById('fullscreenImage');
    const galleryTitle = document.getElementById('galleryTitle');
    const galleryCategory = document.getElementById('galleryCategory');
    const galleryLoading = document.querySelector('.gallery-loading');
    
    if (!galleryImage) return;
    
    // Показываем индикатор загрузки
    if (galleryLoading) galleryLoading.classList.add('visible');
    
    // Обновляем информацию
    if (galleryTitle) galleryTitle.textContent = painting.title;
    if (galleryCategory) galleryCategory.textContent = painting.category;
    
    // Предзагрузка нового изображения
    const tempImg = new Image();
    tempImg.onload = function() {
        galleryImage.src = painting.image;
        galleryImage.alt = painting.title;
        if (galleryLoading) galleryLoading.classList.remove('visible');
    };
    tempImg.onerror = function() {
        if (galleryLoading) galleryLoading.classList.remove('visible');
        showNotification('Не удалось загрузить изображение', 'error');
    };
    tempImg.src = painting.image;
}

// === ОБНОВЛЕНИЕ МОДАЛЬНОГО ОКНА ПРОСМОТРА ===
function updateViewModal(painting) {
    const content = document.getElementById('viewModalContent');
    if (!content) return;
    
    // Обновляем картинку
    const img = content.querySelector('img');
    if (img) {
        img.src = painting.image;
        img.alt = painting.title;
    }
    
    // Обновляем информацию
    const title = content.querySelector('.modal-title');
    const category = content.querySelector('.modal-category');
    const price = content.querySelector('.modal-price');
    
    if (title) title.textContent = `Заказ: ${painting.title}`;
    if (category) category.textContent = painting.category;
    if (price) price.textContent = painting.price;
}

// === СКРЫТИЕ ШАПКИ ПРИ ПРОКРУТКЕ ===
function setupHeaderScroll() {
    let lastScroll = 0;
    const header = document.querySelector('header');
    const scrollThreshold = 200;
    
    if (!header) return;
    
    // Используем requestAnimationFrame для оптимизации
    let ticking = false;
    
    window.addEventListener('scroll', function() {
        if (!ticking) {
            window.requestAnimationFrame(function() {
                const currentScroll = window.pageYOffset;
                
                if (currentScroll > scrollThreshold) {
                    if (currentScroll > lastScroll) {
                        // Прокрутка вниз - скрываем шапку
                        header.classList.add('hidden');
                    }
                    // При прокрутке вверх НЕ показываем шапку
                } else {
                    // Если мало прокрутки (меньше 200px) - показываем шапку
                    header.classList.remove('hidden');
                }
                
                lastScroll = currentScroll;
                ticking = false;
            });
            
            ticking = true;
        }
    });
}

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Проверка поддержки API
        if (!('IntersectionObserver' in window)) {
            showNotification('Обновите браузер для лучшего опыта', 'info', 5000);
        }
        
        // Проверка сетевого соединения
        if (!navigator.onLine) {
            showNotification('Отсутствует интернет-соединение', 'error', 5000);
        }
        
        // Загружаем данные с сервера
        await loadPaintingsData();
        
        // Загружаем галерею
        loadGallery();
        
        // Настраиваем анимации и навигацию
        setupScrollAnimations();
        setupSmoothScroll();
        setupKeyboardNavigation();
        setupSwipeNavigation();
        setupHeaderScroll();
        
        // Закрытие модальных окон по клику на фон
        const viewModal = document.getElementById('viewModal');
        const confirmModal = document.getElementById('confirmModal');
        const fullscreenGallery = document.getElementById('fullscreenGallery');
        
        if (viewModal) {
            viewModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    closeViewModal();
                }
            });
        }
        
        if (confirmModal) {
            confirmModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    closeConfirmModal();
                }
            });
        }
        
        if (fullscreenGallery) {
            fullscreenGallery.addEventListener('click', function(e) {
                if (e.target === this || e.target.classList.contains('gallery-overlay')) {
                    closeFullscreenGallery();
                }
            });
        }
        
        // Предотвращение утечек памяти при закрытии страницы
        window.addEventListener('beforeunload', function() {
            if (observer) observer.disconnect();
            if (window.scrollObserver) window.scrollObserver.disconnect();
            // Очистка sessionStorage
            sessionStorage.removeItem('image_error_shown');
        });
        
        // Обработка ошибок Promise
        window.addEventListener('unhandledrejection', function(event) {
            console.error('Unhandled promise rejection:', event.reason);
            showNotification('Произошла ошибка сети', 'error', 5000);
        });
        
        // Обработка ошибок JavaScript
        window.addEventListener('error', function(event) {
            console.error('Global error:', event.error);
            // Не показываем уведомление для всех ошибок, только для критических
            if (event.error && event.error.message && !event.error.message.includes('ResizeObserver')) {
                showNotification('Произошла ошибка', 'error', 3000);
            }
        });
        
        // Оптимизация: предзагрузка первых 3 изображений
        setTimeout(() => {
            preloadImages();
        }, 1000);
        
    } catch (error) {
        handleError(error, 'Ошибка инициализации');
    }
});

// === ОТПРАВКА АНАЛИТИКИ (опционально) ===
function trackEvent(eventName, data) {
    // Безопасная отправка аналитики
    try {
        console.log('Track:', eventName, data);
        
        // Здесь можно добавить отправку в Google Analytics или другие системы
        // Например: gtag('event', eventName, data);
        
    } catch (error) {
        // Не показываем ошибку пользователю, только в консоль
        console.warn('Analytics error:', error);
    }
}

// === ДОПОЛНИТЕЛЬНЫЕ УТИЛИТЫ ===

// Функция для предзагрузки изображений
function preloadImages() {
    const imagesToPreload = paintings.slice(0, 3).map(p => p.image);
    
    imagesToPreload.forEach(src => {
        const img = new Image();
        img.src = src;
    });
}

// Функция для проверки сетевого соединения
function checkConnection() {
    if (!navigator.onLine) {
        showNotification('Отсутствует интернет-соединение', 'error', 5000);
        return false;
    }
    return true;
}

// Добавляем обработчик изменения сетевого статуса
window.addEventListener('online', () => {
    showNotification('Интернет-соединение восстановлено', 'success');
});

window.addEventListener('offline', () => {
    showNotification('Потеряно интернет-соединение', 'error');
});

// Экспорт функций для глобального доступа (если нужно)
window.FlexyFrame = {
    selectPainting,
    proceedToOrder,
    openTelegramBot,
    openTelegram,
    closeViewModal,
    closeConfirmModal,
    showNotification,
    trackEvent
};