/**
 * FlexyFrame Constants
 * Константы и конфигурация бота
 */

// Статусы заказов
const ORDER_STATUS = {
    NEW: 'new',
    PAID: 'paid',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired'
};

// Эмодзи для статусов
const STATUS_EMOJI = {
    [ORDER_STATUS.NEW]: '⏳',
    [ORDER_STATUS.PAID]: '✅',
    [ORDER_STATUS.IN_PROGRESS]: '🎨',
    [ORDER_STATUS.COMPLETED]: '📦',
    [ORDER_STATUS.CANCELLED]: '❌',
    [ORDER_STATUS.EXPIRED]: '⏰'
};

// Тексты статусов
const STATUS_TEXT = {
    [ORDER_STATUS.NEW]: 'Ожидает оплаты',
    [ORDER_STATUS.PAID]: 'Оплачен, в работе',
    [ORDER_STATUS.IN_PROGRESS]: 'В процессе',
    [ORDER_STATUS.COMPLETED]: 'Готово',
    [ORDER_STATUS.CANCELLED]: 'Отменен',
    [ORDER_STATUS.EXPIRED]: 'Просрочен'
};

// Таймауты (в миллисекундах)
const TIMEOUTS = {
    ORDER_EXPIRY: 15 * 60 * 1000,           // 15 минут
    CLEANUP_INTERVAL: 6 * 60 * 60 * 1000,   // 6 часов
    SESSION_EXPIRY: 24 * 60 * 60 * 1000,    // 24 часа
    MESSAGE_DELAY: 100,                      // Задержка между сообщениями
    CHECK_EXPIRED_INTERVAL: 60000           // 1 минута
};

// Сроки хранения данных
const ARCHIVE = {
    ORDER_DAYS: 30,                          // Дней до архивации заказа
    SESSION_HOURS: 24                        // Часов до удаления сессии
};

// Состояния пользователя
const USER_STATES = {
    CHOOSING_PAINTING: 'choosing_painting',
    PAINTING_SELECTED: 'painting_selected',
    ORDER_CREATED: 'order_created',
    DPD_ENTERING_CITY: 'dpd_entering_city',
    DPD_SELECTING_CITY: 'dpd_selecting_city',
    DPD_SELECTING_DELIVERY_TYPE: 'dpd_selecting_delivery_type',
    DPD_SELECTING_PVZ: 'dpd_selecting_pvz',
    DPD_ENTERING_ADDRESS: 'dpd_entering_address'
};

// Типы доставки DPD
const DELIVERY_TYPES = {
    PICKUP: 'pickup',
    COURIER: 'courier',
    PVZ: 'pvz'
};

// Тексты сообщений
const MESSAGES = {
    GREETING: (firstName, siteUrl) => 
        `👋 <b>Добро пожаловать в FlexyFrame, ${firstName}!</b>\n\n` +
        `🎨 <b>FlexyFrame — где искусство оживает в каждом штрихе</b>\n\n` +
        `Мы создаём уникальные арт-объекты, которые становятся центром вашего интерьера.\n\n` +
        `🎯 <b>Выберите действие:</b>\n` +
        `• 🎨 Выбрать картину\n` +
        `• 🛒 Открыть сайт\n` +
        `• 📍 Адрес доставки\n` +
        `• 📋 Как заказать\n` +
        `• 💬 О проекте\n` +
        `• 🛒 Мои заказы\n\n` +
        `💡 <i>Сайт: ${siteUrl}/index.html</i>`,
    
    ORDER_CREATED: (orderDisplay, painting, token, status) => 
        `✅ <b>Заказ #${orderDisplay}</b>\n\n` +
        `🎨 Картина: <b>${painting.title}</b>\n` +
        `💰 Сумма: <b>${painting.price}₽</b>\n` +
        `📦 Срок выполнения: 2-4 дня\n` +
        `📊 Статус: ${STATUS_EMOJI[status] || '⏳'} ${STATUS_TEXT[status] || status}\n\n` +
        `⚠️ <b>Важно!</b> После оплаты нажмите "✅ Оплатил(а)".\n` +
        `📦 Мы начнем работу сразу после подтверждения.\n\n` +
        `📞 Вопросы: @FlexyFrameSupport\n` +
        `🔑 Токен: <code>${token}</code>`,
    
    PAYMENT_MANUAL: (orderDisplay, order) => 
        `📱 <b>Инструкция по оплате</b>\n\n` +
        `Заказ #${orderDisplay}\n` +
        `🎨 ${order.painting_title}\n` +
        `💰 Сумма: ${order.price}₽\n\n` +
        `💳 <b>Способы оплаты:</b>\n` +
        `• ЮMoney\n` +
        `• Тинькофф\n` +
        `• Сбербанк\n\n` +
        `⚠️ <b>Важно!</b> После оплаты нажмите кнопку "✅ Оплатил(а)"\n` +
        `📦 Мы начнем работу сразу после подтверждения.\n\n` +
        `📞 Вопросы: @FlexyFrameSupport`,
    
    ORDER_CANCELLED: (orderDisplay) => 
        `❌ <b>Заказ #${orderDisplay} отменен!</b>\n\n` +
        `Если вы передумали, можете создать новый заказ.`,
    
    ORDER_EXPIRED: (orderDisplay, painting) => 
        `⏰ <b>Заказ #${orderDisplay} автоматически отменен!</b>\n\n` +
        `Ссылка на оплату истекла (15 минут).\n` +
        `Если вы все еще хотите оформить заказ, создайте новый.\n\n` +
        `🎨 ${painting.title}\n` +
        `💰 ${painting.price}₽`,
    
    ORDER_PAID: (orderDisplay) => 
        `✅ <b>Заказ #${orderDisplay} оплачен!</b>\n\n` +
        `Мы получили подтверждение и начали работу.\n` +
        `Срок выполнения: 2-4 дня.\n\n` +
        `📞 Следить за статусом можно в разделе "Мои заказы".\n` +
        `💬 Вопросы: @FlexyFrameSupport`,
    
    PAINTING_NOT_FOUND: 
        `❌ <b>Картина не найдена!</b>\n\n` +
        `Возможно, она была удалена или ссылка устарела.\n` +
        `Пожалуйста, выберите другую картину.`,
    
    ORDER_NOT_FOUND: '❌ Заказ не найден или не принадлежит вам.',
    
    ERROR_GENERIC: '❌ Произошла ошибка. Попробуйте позже.',
    
    NO_ORDERS: '📭 У вас пока нет заказов. Начните с выбора картины!'
};

// Клавиатуры
const KEYBOARDS = {
    MAIN: {
        keyboard: [
            [{ text: '🎨 Выбрать картину' }],
            [{ text: '🛒 Открыть сайт' }],
            [{ text: '📍 Выбрать адрес DPD' }],
            [{ text: '📋 Как заказать' }, { text: '💬 О проекте' }],
            [{ text: '🛒 Мои заказы' }]
        ],
        resize_keyboard: true
    },
    
    BACK: {
        keyboard: [[{ text: '🔙 Назад' }]],
        resize_keyboard: true
    },
    
    ORDER_ACTIONS: {
        keyboard: [
            [{ text: '❌ Отменить заказ' }],
            [{ text: '📋 Мои заказы' }]
        ],
        resize_keyboard: true
    },
    
    NEW_ORDER: {
        keyboard: [[{ text: '🎨 Сделать новый заказ' }]],
        resize_keyboard: true
    },
    
    PAINTING_SELECTED: {
        keyboard: [
            [{ text: '💳 Оформить заказ' }],
            [{ text: '🎨 Выбрать другую' }],
            [{ text: '🔙 Назад' }]
        ],
        resize_keyboard: true
    }
};

module.exports = {
    ORDER_STATUS,
    STATUS_EMOJI,
    STATUS_TEXT,
    TIMEOUTS,
    ARCHIVE,
    USER_STATES,
    DELIVERY_TYPES,
    MESSAGES,
    KEYBOARDS
};