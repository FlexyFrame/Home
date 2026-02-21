/**
 * FlexyFrame Utilities
 * Общие утилиты для бота
 */

const { STATUS_EMOJI, STATUS_TEXT, KEYBOARDS, MESSAGES, USER_STATES } = require('./constants');

// === ФОРМАТИРОВАНИЕ ===

/**
 * Получить отображаемый номер заказа
 */
const getOrderDisplay = (order) => order.order_number || order.id;

/**
 * Получить эмодзи статуса
 */
const getStatusEmoji = (status) => STATUS_EMOJI[status] || '⏳';

/**
 * Получить текст статуса
 */
const getStatusText = (status) => STATUS_TEXT[status] || status;

/**
 * Форматировать дату для отображения
 */
const formatDate = (date) => new Date(date).toLocaleDateString('ru-RU');

/**
 * Форматировать дату и время для отображения
 */
const formatDateTime = (date) => new Date(date).toLocaleString('ru-RU');

// === ВАЛИДАЦИЯ ===

/**
 * Безопасный парсинг целого числа
 */
const safeParseInt = (value, defaultValue = null) => {
    const parsed = parseInt(value);
    return isNaN(parsed) ? defaultValue : parsed;
};

/**
 * Проверить, что строка не пустая
 */
const isNonEmptyString = (str) => typeof str === 'string' && str.trim().length > 0;

/**
 * Проверить валидность ID заказа
 */
const isValidOrderId = (id) => {
    const parsed = safeParseInt(id);
    return parsed !== null && parsed > 0;
};

// === ГЕНЕРАЦИЯ КЛАВИАТУР ===

/**
 * Клавиатура для выбора картины
 */
const buildPaintingsKeyboard = (paintings) => {
    const keyboard = paintings.map(p => [{ text: `${p.title} - ${p.price}₽` }]);
    keyboard.push([{ text: '🔙 Назад' }]);
    return { keyboard, resize_keyboard: true };
};

/**
 * Inline клавиатура для заказа (с YooKassa)
 */
const buildOrderKeyboardYooKassa = (orderId, confirmationUrl) => ({
    inline_keyboard: [
        [{ text: '💳 Оплатить через ЮКассу', url: confirmationUrl }],
        [{ text: '✅ Оплатил(а)', callback_data: `paid_${orderId}` }],
        [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
    ]
});

/**
 * Inline клавиатура для заказа (ручная оплата)
 */
const buildOrderKeyboardManual = (orderId) => ({
    inline_keyboard: [
        [{ text: '📱 Оплатить вручную', callback_data: `manual_pay_${orderId}` }],
        [{ text: '✅ Оплатил(а)', callback_data: `paid_${orderId}` }],
        [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
    ]
});

/**
 * Inline клавиатура для подтверждения оплаты
 */
const buildPaymentConfirmKeyboard = (orderId) => ({
    inline_keyboard: [
        [{ text: '✅ Оплатил(а)', callback_data: `paid_${orderId}` }],
        [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
    ]
});

/**
 * Inline клавиатура для сайта
 */
const buildSiteKeyboard = (siteUrl) => ({
    inline_keyboard: [
        [{ text: '🌐 Открыть сайт', url: `${siteUrl}/index.html` }]
    ]
});

/**
 * Inline клавиатура для DPD выбора доставки
 */
const buildDPDDeliveryKeyboard = (siteUrl, cityName, cityCode) => ({
    inline_keyboard: [
        [{ text: '📍 Выбрать ПВЗ на карте', web_app: { url: `${siteUrl}/dpd-widget.html?city=${encodeURIComponent(cityName)}` } }],
        [{ text: '📦 Список ПВЗ', callback_data: `dpd_delivery_pvz_${cityName}_${cityCode}` }],
        [{ text: '🚚 Курьерская доставка', callback_data: `dpd_delivery_courier_${cityName}_${cityCode}` }],
        [{ text: '🔙 Назад к выбору города', callback_data: 'dpd_back_to_cities' }]
    ]
});

/**
 * Inline клавиатура для выбора ПВЗ
 */
const buildPVZKeyboard = (pickupPoints, cityName, cityCode, maxDisplay = 10) => {
    const keyboard = { inline_keyboard: [] };
    
    pickupPoints.slice(0, maxDisplay).forEach((point, index) => {
        const shortName = point.name.length > 30 ? point.name.substring(0, 27) + '...' : point.name;
        keyboard.inline_keyboard.push([{
            text: `${index + 1}. ${point.type === 'П' ? '📮' : '📦'} ${shortName}`,
            callback_data: `dpd_pvz_${index}_${cityName}_${cityCode}`
        }]);
    });
    
    keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: `dpd_back_to_delivery_${cityName}_${cityCode}` }]);
    
    return keyboard;
};

// === СООБЩЕНИЯ ===

/**
 * Сообщение о заказе для списка
 */
const formatOrderListItem = (order) => {
    const orderDisplay = getOrderDisplay(order);
    return `📋 <b>Заказ #${orderDisplay}</b>\n` +
        `${getStatusEmoji(order.status)} ${getStatusText(order.status)}\n` +
        `🎨 ${order.painting_title}\n` +
        `💰 ${order.price}₽\n` +
        `📅 ${formatDate(order.created_at)}`;
};

/**
 * Сообщение для админа о новом заказе
 */
const formatAdminNewOrder = (orderNumber, chatId, painting, token) => 
    `🔔 <b>Новый заказ #${orderNumber}</b>\n\n` +
    `👤 Пользователь: ID ${chatId}\n` +
    `🎨 Картина: ${painting.title}\n` +
    `💰 Сумма: ${painting.price}₽\n` +
    `📊 Статус: Ожидает оплаты\n` +
    `🔑 Токен: <code>${token}</code>`;

/**
 * Сообщение для админа об оплате
 */
const formatAdminPayment = (orderDisplay, chatId, order) => 
    `💰 <b>Оплата подтверждена!</b>\n\n` +
    `Заказ #${orderDisplay}\n` +
    `👤 Пользователь: ID ${chatId}\n` +
    `🎨 ${order.painting_title}\n` +
    `💰 ${order.price}₽\n` +
    `📊 Статус: Оплачен\n\n` +
    `🎫 Тикет поддержки создан автоматически`;

/**
 * Сообщение для админа об отмене
 */
const formatAdminCancelled = (orderDisplay, chatId, order, reason = '') => 
    `❌ <b>Заказ #${orderDisplay} отменен${reason ? ` (${reason})` : ''}</b>\n\n` +
    `👤 Пользователь: ID ${chatId}\n` +
    `🎨 Картина: ${order.painting_title}\n` +
    `💰 Сумма: ${order.price}₽`;

// === АСИНХРОННЫЕ УТИЛИТЫ ===

/**
 * Обёртка для безопасного выполнения асинхронных операций
 */
const safeAsync = async (fn, fallback = null) => {
    try {
        return await fn();
    } catch (error) {
        console.error('Ошибка в safeAsync:', error.message);
        return fallback;
    }
};

/**
 * Задержка (sleep)
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Выполнение с ретраями
 */
const retry = async (fn, maxRetries = 3, delayMs = 1000) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                await delay(delayMs);
            }
        }
    }
    throw lastError;
};

// === РАБОТА С ОБЪЕКТАМИ ===

/**
 * Безопасное получение вложенного свойства
 */
const safeGet = (obj, path, defaultValue = undefined) => {
    const keys = path.split('.');
    let result = obj;
    for (const key of keys) {
        if (result === null || result === undefined) {
            return defaultValue;
        }
        result = result[key];
    }
    return result !== undefined ? result : defaultValue;
};

/**
 * Проверка на пустой объект
 */
const isEmptyObject = (obj) => {
    return obj && typeof obj === 'object' && Object.keys(obj).length === 0;
};

// === DPD УТИЛИТЫ ===

/**
 * Проверка недоступности DPD
 */
const isDPDUnavailable = (result) => result && result.error === true;

/**
 * Получение сообщения об ошибке DPD
 */
const getDPDErrorMessage = (result) => result?.message || 'Технические неполадки. Попробуйте позже.';

/**
 * Сокращение строки
 */
const truncateString = (str, maxLength) => {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
};

module.exports = {
    // Форматирование
    getOrderDisplay,
    getStatusEmoji,
    getStatusText,
    formatDate,
    formatDateTime,
    
    // Валидация
    safeParseInt,
    isNonEmptyString,
    isValidOrderId,
    
    // Клавиатуры
    buildPaintingsKeyboard,
    buildOrderKeyboardYooKassa,
    buildOrderKeyboardManual,
    buildPaymentConfirmKeyboard,
    buildSiteKeyboard,
    buildDPDDeliveryKeyboard,
    buildPVZKeyboard,
    
    // Сообщения
    formatOrderListItem,
    formatAdminNewOrder,
    formatAdminPayment,
    formatAdminCancelled,
    
    // Асинхронные утилиты
    safeAsync,
    delay,
    retry,
    
    // Работа с объектами
    safeGet,
    isEmptyObject,
    
    // DPD утилиты
    isDPDUnavailable,
    getDPDErrorMessage,
    truncateString
};