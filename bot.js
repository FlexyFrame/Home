/**
 * FlexyFrame Telegram Bot
 * Уникальные граффити-арты на заказ
 * 
 * @bot @flexyframe_bot
 * @version 3.0 (optimized)
 */

const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();
const logger = require('./logger');

// === КОНФИГУРАЦИЯ ===
const CONFIG = {
    TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
    SITE_URL: process.env.SITE_URL || 'https://flexyframe.github.io/Home',
    PORT: process.env.PORT || 3000,
    YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID,
    YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY
};

const { TOKEN, ADMIN_CHAT_ID, SITE_URL, PORT } = CONFIG;

// Валидация токена
if (!TOKEN || TOKEN === 'your_token_here') {
    logger.error('TELEGRAM_BOT_TOKEN не установлен в .env');
    process.exit(1);
}

// === ИМПОРТ МОДУЛЕЙ ===
const { 
    ORDER_STATUS, STATUS_EMOJI, STATUS_TEXT, TIMEOUTS, ARCHIVE, 
    USER_STATES, DELIVERY_TYPES, MESSAGES, KEYBOARDS 
} = require('./constants');
const { 
    getOrderDisplay, getStatusEmoji, getStatusText, formatDate, formatDateTime,
    safeParseInt, isNonEmptyString, isValidOrderId,
    buildPaintingsKeyboard, buildOrderKeyboardYooKassa, buildOrderKeyboardManual,
    buildPaymentConfirmKeyboard, buildSiteKeyboard, buildDPDDeliveryKeyboard, buildPVZKeyboard,
    formatOrderListItem, formatAdminNewOrder, formatAdminPayment, formatAdminCancelled,
    safeAsync, delay, isDPDUnavailable, getDPDErrorMessage, truncateString
} = require('./utils');
const { paintings, getPaintingImagePath, findPaintingById, findPaintingByTitle } = require('./data.js');
const { FlexyFrameDPDIntegration } = require('./dpd-integration');

// === ИНИЦИАЛИЗАЦИЯ YOOKASSA ===
const YooKassa = require('yookassa');
let yookassa = null;

if (CONFIG.YOOKASSA_SHOP_ID && CONFIG.YOOKASSA_SECRET_KEY && CONFIG.YOOKASSA_SHOP_ID !== 'your_shop_id') {
    yookassa = new YooKassa({
        shopId: CONFIG.YOOKASSA_SHOP_ID,
        secretKey: CONFIG.YOOKASSA_SECRET_KEY
    });
    logger.info('YooKassa инициализирована');
} else {
    logger.info('YooKassa не настроена (используется ручная оплата)');
}

// === ИНИЦИАЛИЗАЦИЯ DPD ===
let dpdIntegration = null;

async function initializeDPD() {
    try {
        dpdIntegration = new FlexyFrameDPDIntegration({
            clientNumber: process.env.DPD_CLIENT_NUMBER,
            clientKey: process.env.DPD_CLIENT_KEY,
            testMode: process.env.DPD_TEST_MODE === 'true'
        });
        await dpdIntegration.initialize();
        await dpdIntegration.start();
        logger.info('DPD интеграция инициализирована');
    } catch (error) {
        logger.error('Ошибка инициализации DPD', error);
    }
}

initializeDPD();

// === ИНИЦИАЛИЗАЦИЯ БОТА ===
const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

// === УТИЛИТАРНЫЕ ФУНКЦИИ ===
const isAdminConfigured = () => ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id';

const sendAdminMessage = (message, options = {}) => {
    if (!isAdminConfigured()) return Promise.resolve();
    return bot.sendMessage(ADMIN_CHAT_ID, message, options).catch(err => 
        logger.warn('Ошибка отправки сообщения админу', { error: err.message })
    );
};

// === БАЗА ДАННЫХ ===
const db = new sqlite3.Database('./flexyframe.db', (err) => {
    if (err) {
        logger.error('Ошибка подключения к БД', err);
    } else {
        logger.info('База данных подключена');
        initDB();
    }
});

function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number INTEGER UNIQUE,
            user_id INTEGER,
            user_name TEXT,
            painting_id INTEGER,
            painting_title TEXT,
            price INTEGER,
            status TEXT DEFAULT 'new',
            payment_id TEXT,
            token TEXT,
            user_message_id INTEGER,
            admin_message_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS order_counter (id INTEGER PRIMARY KEY, current_number INTEGER DEFAULT 0)`);
        db.run(`INSERT OR IGNORE INTO order_counter (id, current_number) VALUES (1, 0)`);
        
        db.run(`CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            user_id INTEGER PRIMARY KEY,
            state TEXT,
            data TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            order_id INTEGER,
            status TEXT DEFAULT 'open',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    });
}

// === УПРАВЛЕНИЕ СЕССИЯМИ ===
const userStates = {};

function setUserState(chatId, state, data = {}) {
    userStates[chatId] = { state, data, timestamp: Date.now() };
    db.run(`INSERT OR REPLACE INTO sessions (user_id, state, data) VALUES (?, ?, ?)`,
        [chatId, state, JSON.stringify(data)]
    );
}

function getUserState(chatId) {
    return userStates[chatId];
}

function clearUserState(chatId) {
    delete userStates[chatId];
    db.run(`DELETE FROM sessions WHERE user_id = ?`, [chatId]);
}

// === YOOKASSA ФУНКЦИИ ===
async function createYookassaPayment(orderId, amount, description = '') {
    if (!yookassa) throw new Error('YooKassa не настроена');

    try {
        const payment = await yookassa.createPayment({
            amount: { value: amount.toFixed(2), currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: `${SITE_URL}/index.html` },
            capture: true,
            description: description || `Заказ #${orderId}`,
            metadata: { order_id: orderId.toString() },
        });

        logger.info('Платеж создан', { orderId, paymentId: payment.id });

        return {
            success: true,
            payment_id: payment.id,
            status: payment.status,
            confirmation_url: payment.confirmation.confirmation_url,
            amount: payment.amount.value,
            description: payment.description,
        };
    } catch (error) {
        logger.error('Ошибка создания платежа', { orderId, error: error.message });
        return { success: false, error: error.message };
    }
}

async function checkPaymentStatus(paymentId) {
    if (!yookassa) return { status: 'unknown', error: 'YooKassa не настроена' };

    try {
        const payment = await yookassa.getPayment(paymentId);
        return {
            status: payment.status,
            captured: payment.captured,
            refundable: payment.refundable,
        };
    } catch (error) {
        logger.error('Ошибка проверки платежа', { paymentId, error: error.message });
        return { status: 'error', error: error.message };
    }
}

// === РАБОТА С ЗАКАЗАМИ ===
function getNextOrderNumber() {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE order_counter SET current_number = current_number + 1 WHERE id = 1`, function(err) {
            if (err) return reject(err);
            db.get(`SELECT current_number FROM order_counter WHERE id = 1`, (err, row) => {
                if (err || !row) return reject(err);
                resolve(row.current_number);
            });
        });
    });
}

function createOrder(chatId, painting, token = null) {
    const orderToken = token || crypto.randomBytes(8).toString('hex');
    
    getNextOrderNumber()
        .then(orderNumber => {
            db.run(
                `INSERT INTO orders (order_number, user_id, painting_id, painting_title, price, status, token) VALUES (?, ?, ?, ?, ?, 'new', ?)`,
                [orderNumber, chatId, painting.id, painting.title, painting.price, orderToken],
                function(err) {
                    if (err) {
                        logger.error('Ошибка создания заказа', { chatId, error: err.message });
                        bot.sendMessage(chatId, MESSAGES.ERROR_GENERIC);
                        return;
                    }
                    
                    const orderId = this.lastID;
                    logger.info('Заказ создан', { orderId, orderNumber, chatId, painting: painting.title });
                    
                    showOrderInfo(chatId, { id: orderId, order_number: orderNumber, ...painting, token: orderToken, status: 'new' }, painting);
                    notifyAdminNewOrder(orderId, orderNumber, chatId, painting, orderToken);
                }
            );
        })
        .catch(err => {
            logger.error('Ошибка получения номера заказа', { error: err.message });
            bot.sendMessage(chatId, MESSAGES.ERROR_GENERIC);
        });
}

async function showOrderInfo(chatId, order, painting) {
    const imagePath = getPaintingImagePath(painting);
    const orderDisplay = getOrderDisplay(order);
    const message = MESSAGES.ORDER_CREATED(orderDisplay, painting, order.token, order.status);
    
    let keyboard;
    
    if (yookassa && order.status === ORDER_STATUS.NEW) {
        try {
            const paymentResult = await createYookassaPayment(order.id, painting.price, `Заказ #${orderDisplay} - ${painting.title}`);
            
            if (paymentResult.success) {
                db.run(`UPDATE orders SET payment_id = ? WHERE id = ?`, [paymentResult.payment_id, order.id]);
                keyboard = buildOrderKeyboardYooKassa(order.id, paymentResult.confirmation_url);
                logger.info('Платеж Юкассы создан', { paymentId: paymentResult.payment_id });
            } else {
                keyboard = buildOrderKeyboardManual(order.id);
            }
        } catch (error) {
            logger.error('Ошибка создания платежа', { error: error.message });
            keyboard = buildOrderKeyboardManual(order.id);
        }
    } else {
        keyboard = buildOrderKeyboardManual(order.id);
    }
    
    bot.sendPhoto(chatId, imagePath, { caption: message, parse_mode: 'HTML', reply_markup: keyboard })
        .then((sentMessage) => {
            db.run(`UPDATE orders SET user_message_id = ? WHERE id = ?`, [sentMessage.message_id, order.id]);
            setUserState(chatId, USER_STATES.ORDER_CREATED, { orderId: order.id });
        })
        .catch(() => {
            bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: KEYBOARDS.ORDER_ACTIONS })
                .then((sentMessage) => {
                    db.run(`UPDATE orders SET user_message_id = ? WHERE id = ?`, [sentMessage.message_id, order.id]);
                    setUserState(chatId, USER_STATES.ORDER_CREATED, { orderId: order.id });
                });
        });
}

function notifyAdminNewOrder(orderId, orderNumber, chatId, painting, token) {
    if (!isAdminConfigured()) return;
    
    const message = formatAdminNewOrder(orderNumber, chatId, painting, token);
    bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' })
        .then((sentMessage) => {
            db.run(`UPDATE orders SET admin_message_id = ? WHERE id = ?`, [sentMessage.message_id, orderId]);
        })
        .catch(err => logger.warn('Ошибка отправки админ-уведомления', { error: err.message }));
}

function deleteOrderMessages(orderId) {
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
        if (err || !order) return;
        
        if (order.user_message_id) {
            bot.deleteMessage(order.user_id, order.user_message_id).catch(() => {});
        }
        
        if (order.admin_message_id && isAdminConfigured()) {
            bot.deleteMessage(ADMIN_CHAT_ID, order.admin_message_id).catch(() => {});
        }
    });
}

// === ГЛАВНОЕ МЕНЮ ===
function showMainMenu(chatId, firstName = 'пользователь') {
    bot.sendMessage(chatId, MESSAGES.GREETING(firstName, SITE_URL), {
        parse_mode: 'HTML',
        reply_markup: KEYBOARDS.MAIN
    });
}

// === СТАРТ БОТА ===
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.chat.first_name;
    
    db.run(`INSERT OR REPLACE INTO users (user_id, username, first_name, last_name) VALUES (?, ?, ?, ?)`,
        [chatId, msg.chat.username, firstName, msg.chat.last_name]
    );
    
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    
    const startParam = msg.text.split(' ')[1];
    if (startParam) {
        handleStartParameter(chatId, startParam);
        return;
    }
    
    showMainMenu(chatId, firstName);
});

function handleStartParameter(chatId, param) {
    // JSON от MiniApp
    if (param.startsWith('{') && param.endsWith('}')) {
        try {
            const data = JSON.parse(param);
            if (data.action === 'create_order' && data.painting) {
                const painting = findPaintingById(data.painting.id) || data.painting;
                createOrder(chatId, painting);
                return;
            }
        } catch (e) {
            logger.error('Ошибка парсинга JSON', { error: e.message });
        }
    }
    
    // Quick order
    if (param.startsWith('quick_order_')) {
        const paintingId = safeParseInt(param.split('_')[2]);
        const painting = findPaintingById(paintingId);
        if (painting) {
            createOrder(chatId, painting);
        } else {
            bot.sendMessage(chatId, MESSAGES.PAINTING_NOT_FOUND, { parse_mode: 'HTML' });
            showMainMenu(chatId);
        }
        return;
    }
    
    // Обычная обработка
    let paintingId = null;
    let token = null;
    
    if (param.startsWith('order_')) {
        const parts = param.split('_');
        paintingId = safeParseInt(parts[1]);
        if (parts.length >= 3) token = parts[2];
    } else if (param.includes('_')) {
        paintingId = safeParseInt(param.split('_')[0]);
    } else {
        paintingId = safeParseInt(param);
    }
    
    const painting = findPaintingById(paintingId);
    if (!painting) {
        bot.sendMessage(chatId, MESSAGES.PAINTING_NOT_FOUND, { parse_mode: 'HTML' });
        showMainMenu(chatId);
        return;
    }
    
    if (token) {
        db.get(`SELECT * FROM orders WHERE token = ?`, [token], (err, order) => {
            if (order) {
                showOrderInfo(chatId, order, painting);
            } else {
                createOrder(chatId, painting, token);
            }
        });
    } else {
        createOrder(chatId, painting);
    }
}

// === МЕНЮ КАРТИН ===
function showPaintingsMenu(chatId) {
    setUserState(chatId, USER_STATES.CHOOSING_PAINTING);
    bot.sendMessage(chatId, '🎨 Выберите картину для заказа:', {
        reply_markup: buildPaintingsKeyboard(paintings)
    });
}

// === ИНФОРМАЦИОННЫЕ СТРАНИЦЫ ===
function showSiteLink(chatId) {
    bot.sendMessage(chatId, 
        `📱 <b>Сайт FlexyFrame</b>\n\n` +
        `Откройте сайт для удобного выбора картин:\n\n` +
        `🔗 <b>${SITE_URL}/index.html</b>`,
        { parse_mode: 'HTML', reply_markup: buildSiteKeyboard(SITE_URL) }
    );
}

function showHowItWorks(chatId) {
    bot.sendMessage(chatId, 
        `📋 <b>Как сделать заказ:</b>\n\n` +
        `1️⃣ <b>Выберите картину</b> из галереи\n` +
        `2️⃣ <b>Оформите заказ</b> в боте\n` +
        `3️⃣ <b>Оплатите</b> удобным способом\n` +
        `4️⃣ <b>Получите работу</b> через 2-4 дня\n\n` +
        `💳 <b>Способы оплаты:</b>\n` +
        `• ЮMoney\n• Тинькофф\n• Сбербанк\n\n` +
        `📦 <b>Доставка:</b>\n` +
        `• Электронная версия - мгновенно\n` +
        `• Физическая печать - 2-4 дня + доставка\n\n` +
        `💡 <b>Сайт:</b> ${SITE_URL}/index.html`,
        { parse_mode: 'HTML' }
    );
}

function showAbout(chatId) {
    bot.sendMessage(chatId, 
        `🎨 <b>FlexyFrame — где искусство оживает</b>\n\n` +
        `Мы создаём уникальные арт-объекты, которые становятся центром вашего интерьера.\n\n` +
        `✨ <b>Наши преимущества:</b>\n` +
        `🖼️ Печать на премиальном холсте\n` +
        `📏 Идеальный формат 60×50 см\n` +
        `🖌️ Ручная роспись по запросу\n` +
        `🌲 Авторские рамы из натуральной сосны\n\n` +
        `📩 <b>Контакты:</b>\n` +
        `• Telegram: @flexyframe_bot\n` +
        `• Поддержка: @FlexyFrameSupport\n` +
        `• Email: designstudioflexyframe@gmail.com\n\n` +
        `🔗 <b>Сайт:</b> ${SITE_URL}/index.html`,
        { parse_mode: 'HTML' }
    );
}

function showDeliveryAddress(chatId) {
    bot.sendMessage(chatId, 
        `📍 <b>Адрес доставки</b>\n\n` +
        `📦 <b>Самовывоз:</b>\n` +
        `📍 г. Томск, ул. Учебная, 2/2\n` +
        `⏰ Время работы: 10:00 - 20:00\n\n` +
        `🚚 <b>Доставка по Томску:</b>\n` +
        `• Курьерская доставка: 300₽\n` +
        `• При заказе от 3000₽ - бесплатно\n\n` +
        `📦 <b>Доставка в другие города:</b>\n` +
        `• СДЭК\n• Почта России\n• Деловые Линии\n\n` +
        `❓ <b>Вопросы:</b> @FlexyFrameSupport`,
        { parse_mode: 'HTML' }
    );
}

// === МОИ ЗАКАЗЫ ===
function showMyOrders(chatId) {
    db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [chatId], (err, rows) => {
        if (err) {
            bot.sendMessage(chatId, MESSAGES.ERROR_GENERIC);
            return;
        }
        
        if (rows.length === 0) {
            bot.sendMessage(chatId, MESSAGES.NO_ORDERS);
            return;
        }
        
        rows.forEach((order, index) => {
            setTimeout(() => {
                bot.sendMessage(chatId, formatOrderListItem(order), { parse_mode: 'HTML' });
            }, index * TIMEOUTS.MESSAGE_DELAY);
        });
        
        setTimeout(() => {
            bot.sendMessage(chatId, '👆 Выберите действие:', { reply_markup: KEYBOARDS.NEW_ORDER });
        }, rows.length * TIMEOUTS.MESSAGE_DELAY);
    });
}

// === ОБРАБОТКА СООБЩЕНИЙ ===
bot.on('message', (msg) => {
    if (msg.text === '/start') return;
    
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Web App Data
    if (msg.web_app_data?.data) {
        handleWebAppData(chatId, msg.web_app_data.data);
        return;
    }
    
    const session = getUserState(chatId);
    
    // Обработка кнопок меню
    switch (text) {
        case '🎨 Выбрать картину':
            showPaintingsMenu(chatId);
            return;
        case '🛒 Открыть сайт':
            showSiteLink(chatId);
            return;
        case '📋 Как заказать':
            showHowItWorks(chatId);
            return;
        case '💬 О проекте':
            showAbout(chatId);
            return;
        case '🛒 Мои заказы':
            showMyOrders(chatId);
            return;
        case '📍 Выбрать адрес DPD':
            startDPDAddressSelection(chatId);
            return;
        case '📍 Адрес доставки':
            showDeliveryAddress(chatId);
            return;
        case '🔙 Назад':
        case '🔙 Назад в меню':
            showMainMenu(chatId, msg.chat.first_name);
            clearUserState(chatId);
            return;
        case '💳 Оформить заказ':
            handleOrderRequest(chatId, session);
            return;
        case '🎨 Выбрать другую':
            clearUserState(chatId);
            showPaintingsMenu(chatId);
            return;
        case '🎨 Сделать новый заказ':
            showPaintingsMenu(chatId);
            return;
        case '❌ Отменить заказ':
            handleCancelOrder(chatId, session, msg.chat.first_name);
            return;
    }
    
    // Обработка состояний
    if (session) {
        handleStateMessage(chatId, text, session, msg.chat.first_name);
    }
});

function handleWebAppData(chatId, data) {
    try {
        const parsed = JSON.parse(data);
        
        if (parsed.type === 'pickup_point') {
            saveUserDeliveryAddress(chatId, {
                type: 'pickup',
                pickupPointId: parsed.pickupPointId,
                address: parsed.address,
                name: parsed.name,
                deliveryType: 'pickup'
            });
            clearUserState(chatId);
            
            bot.sendMessage(chatId,
                `✅ <b>Пункт выдачи выбран!</b>\n\n📦 <b>${parsed.name}</b>\n📍 ${parsed.address}\n\nТеперь выберите картину для заказа.`,
                { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🎨 Выбрать картину', callback_data: 'start_painting_menu' }]] } }
            );
        } else if (parsed.action === 'create_order' && parsed.painting) {
            const painting = findPaintingById(parsed.painting.id) || parsed.painting;
            createOrder(chatId, painting);
        }
    } catch (e) {
        logger.error('Ошибка обработки web_app_data', { error: e.message });
    }
}

function handleStateMessage(chatId, text, session, firstName) {
    switch (session.state) {
        case USER_STATES.CHOOSING_PAINTING:
            const painting = paintings.find(p => text.includes(p.title));
            if (painting) {
                setUserState(chatId, USER_STATES.PAINTING_SELECTED, { paintingId: painting.id });
                const imagePath = getPaintingImagePath(painting);
                const message = `🎨 <b>${painting.title}</b>\n💰 Цена: <b>${painting.price}₽</b>\n📦 Срок: 2-4 дня`;
                
                bot.sendPhoto(chatId, imagePath, { caption: message, parse_mode: 'HTML', reply_markup: KEYBOARDS.PAINTING_SELECTED })
                    .catch(() => bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: KEYBOARDS.PAINTING_SELECTED }));
            }
            break;
            
        case USER_STATES.DPD_ENTERING_CITY:
            handleDPDCityInput(chatId, text);
            break;
            
        case USER_STATES.DPD_ENTERING_ADDRESS:
            handleDPDAddressInput(chatId, text, session);
            break;
    }
}

function handleOrderRequest(chatId, session) {
    if (session?.state === USER_STATES.PAINTING_SELECTED) {
        const painting = findPaintingById(session.data.paintingId);
        if (painting) {
            createOrder(chatId, painting);
            clearUserState(chatId);
        } else {
            bot.sendMessage(chatId, '❌ Картина не найдена');
        }
    } else {
        bot.sendMessage(chatId, '❌ Сначала выберите картину через "🎨 Выбрать картину"');
    }
}

function handleCancelOrder(chatId, session, firstName) {
    if (session?.state !== USER_STATES.ORDER_CREATED) return;
    
    const orderId = session.data.orderId;
    
    db.run(`UPDATE orders SET status = ? WHERE id = ? AND user_id = ?`, [ORDER_STATUS.CANCELLED, orderId, chatId], function(err) {
        if (err || this.changes === 0) {
            bot.sendMessage(chatId, '❌ Не удалось отменить заказ.');
            return;
        }
        
        db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
            const orderDisplay = getOrderDisplay(order);
            bot.sendMessage(chatId, MESSAGES.ORDER_CANCELLED(orderDisplay), { parse_mode: 'HTML' });
            
            sendAdminMessage(formatAdminCancelled(orderDisplay, chatId, order, 'пользователем'), { parse_mode: 'HTML' });
            deleteOrderMessages(orderId);
            clearUserState(chatId);
            showMainMenu(chatId, firstName);
        });
    });
}

// === CALLBACK QUERY ===
bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    bot.answerCallbackQuery(callbackQuery.id);
    
    // JSON от MiniApp
    if (data.startsWith('{') && data.endsWith('}')) {
        try {
            const parsed = JSON.parse(data);
            if (parsed.action === 'create_order' && parsed.painting) {
                const painting = findPaintingById(parsed.painting.id) || parsed.painting;
                createOrder(chatId, painting);
            }
        } catch (e) {}
        return;
    }
    
    // Обработка callback
    if (data.startsWith('paid_')) {
        handlePaymentConfirm(chatId, safeParseInt(data.replace('paid_', '')));
    } else if (data === 'my_orders') {
        showMyOrders(chatId);
    } else if (data === 'start_painting_menu') {
        showPaintingsMenu(chatId);
    } else if (data.startsWith('manual_pay_')) {
        handleManualPay(chatId, safeParseInt(data.replace('manual_pay_', '')));
    } else if (data.startsWith('dpd_')) {
        handleDPDCallback(chatId, data);
    }
});

function handlePaymentConfirm(chatId, orderId) {
    db.get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [orderId, chatId], (err, order) => {
        if (err || !order) {
            bot.sendMessage(chatId, MESSAGES.ORDER_NOT_FOUND);
            return;
        }
        
        if (order.status === ORDER_STATUS.PAID) {
            bot.sendMessage(chatId, `✅ Заказ #${getOrderDisplay(order)} уже оплачен и в работе!`);
            return;
        }
        
        db.run(`UPDATE orders SET status = ? WHERE id = ?`, [ORDER_STATUS.PAID, orderId]);
        
        const orderDisplay = getOrderDisplay(order);
        bot.sendMessage(chatId, MESSAGES.ORDER_PAID(orderDisplay), { parse_mode: 'HTML' });
        
        notifyAdminPayment(orderId, chatId, order);
    });
}

function notifyAdminPayment(orderId, chatId, order) {
    if (!isAdminConfigured()) return;
    
    const orderDisplay = getOrderDisplay(order);
    sendAdminMessage(formatAdminPayment(orderDisplay, chatId, order), { parse_mode: 'HTML' })
        .then(() => createSupportTicket(orderId, chatId, order.painting_title));
}

function handleManualPay(chatId, orderId) {
    db.get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [orderId, chatId], (err, order) => {
        if (err || !order) {
            bot.sendMessage(chatId, MESSAGES.ORDER_NOT_FOUND);
            return;
        }
        
        const orderDisplay = getOrderDisplay(order);
        bot.sendMessage(chatId, MESSAGES.PAYMENT_MANUAL(orderDisplay, order), {
            parse_mode: 'HTML',
            reply_markup: buildPaymentConfirmKeyboard(orderId)
        });
    });
}

function createSupportTicket(orderId, userId, paintingTitle) {
    db.run(`INSERT INTO tickets (user_id, order_id, status) VALUES (?, ?, 'open')`, [userId, orderId], function(err) {
        if (err) return;
        
        const ticketId = this.lastID;
        bot.sendMessage(userId,
            `🎫 <b>Создан тикет поддержки #${ticketId}</b>\n\n` +
            `💬 Теперь вы можете общаться с нашей командой по поводу заказа #${orderId}\n` +
            `🎨 ${paintingTitle}\n\n` +
            `Для общения используйте: @FlexyFrameSupport`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    });
}

// === DPD ФУНКЦИИ ===

async function startDPDAddressSelection(chatId) {
    if (!dpdIntegration) {
        bot.sendMessage(chatId, 
            `📦 <b>Доставка DPD временно недоступна</b>\n\n` +
            `📬 Для оформления заказа свяжитесь с нами:\n📞 @FlexyFrameSupport\n\n` +
            `💡 Или выберите <b>Самовывоз</b> в Томске:\n📍 г. Томск, ул. Учебная, 2/2`,
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    setUserState(chatId, USER_STATES.DPD_ENTERING_CITY);
    
    bot.sendMessage(chatId,
        `📍 <b>Выбор адреса доставки DPD</b>\n\n` +
        `🚚 <b>Доставка по всей России</b>\n\n` +
        `Напишите название города в чат или отправьте геолокацию.`,
        { parse_mode: 'HTML', reply_markup: { keyboard: [[{ text: '📍 Отправить геолокацию', request_location: true }], [{ text: '🔙 Назад в меню' }]], resize_keyboard: true } }
    );
}

async function handleDPDCityInput(chatId, cityName) {
    if (cityName.length < 2) {
        bot.sendMessage(chatId, '⚠️ Название города слишком короткое.');
        return;
    }
    
    bot.sendChatAction(chatId, 'typing');
    
    const cities = await dpdIntegration.searchCities(cityName);
    
    if (isDPDUnavailable(cities) || !Array.isArray(cities) || cities.length === 0) {
        showDeliveryTypeOptions(chatId, cityName, '');
        return;
    }
    
    if (cities.length === 1) {
        const city = cities[0];
        setUserState(chatId, USER_STATES.DPD_SELECTING_DELIVERY_TYPE, { city: city.name, cityCode: city.code });
        showDeliveryTypeOptions(chatId, city.name, city.code);
        return;
    }
    
    const keyboard = { inline_keyboard: [] };
    cities.slice(0, 10).forEach(city => {
        keyboard.inline_keyboard.push([{
            text: `${city.name}${city.region ? ` (${city.region})` : ''}`,
            callback_data: `dpd_city_${city.name}_${city.code || ''}`
        }]);
    });
    keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: 'dpd_back_to_cities' }]);
    
    bot.sendMessage(chatId, '🏙️ Найдено несколько городов. Выберите ваш:', { reply_markup: keyboard });
}

function showDeliveryTypeOptions(chatId, cityName, cityCode) {
    bot.sendMessage(chatId,
        `🏙️ <b>${cityName}</b>\n\n` +
        `📦 <b>Выберите способ доставки:</b>\n\n` +
        `1️⃣ <b>Самовывоз из ПВЗ</b>\n📍 Пункт выдачи в вашем городе\n\n` +
        `2️⃣ <b>Курьерская доставка</b>\n🚚 Доставка до двери`,
        { parse_mode: 'HTML', reply_markup: buildDPDDeliveryKeyboard(SITE_URL, cityName, cityCode) }
    );
}

async function handleDPDCallback(chatId, data) {
    if (data === 'dpd_back_to_cities' || data === 'back_to_main') {
        startDPDAddressSelection(chatId);
        return;
    }
    
    if (data === 'dpd_change_address') {
        startDPDAddressSelection(chatId);
        return;
    }
    
    if (data.startsWith('dpd_city_')) {
        const parts = data.replace('dpd_city_', '').split('_');
        const cityCode = parts.pop();
        const cityName = parts.join('_');
        setUserState(chatId, USER_STATES.DPD_SELECTING_DELIVERY_TYPE, { city: cityName, cityCode });
        showDeliveryTypeOptions(chatId, cityName, cityCode);
        return;
    }
    
    if (data.startsWith('dpd_delivery_pvz_')) {
        const parts = data.replace('dpd_delivery_pvz_', '').split('_');
        const cityCode = parts.pop();
        const cityName = parts.join('_');
        handleDPVPVZSelection(chatId, cityName, cityCode);
        return;
    }
    
    if (data.startsWith('dpd_delivery_courier_')) {
        const parts = data.replace('dpd_delivery_courier_', '').split('_');
        const cityCode = parts.pop();
        const cityName = parts.join('_');
        handleCourierDelivery(chatId, cityName, cityCode);
        return;
    }
    
    if (data.startsWith('dpd_pvz_')) {
        const parts = data.replace('dpd_pvz_', '').split('_');
        const pvzIndex = safeParseInt(parts[0]);
        const cityCode = parts.pop();
        const cityName = parts.slice(1).join('_');
        confirmPVZSelection(chatId, pvzIndex, cityName, cityCode);
        return;
    }
    
    if (data.startsWith('dpd_back_to_delivery_')) {
        const parts = data.replace('dpd_back_to_delivery_', '').split('_');
        const cityCode = parts.pop();
        const cityName = parts.join('_');
        showDeliveryTypeOptions(chatId, cityName, cityCode);
        return;
    }
}

async function handleDPVPVZSelection(chatId, cityName, cityCode) {
    bot.sendChatAction(chatId, 'typing');
    
    const pickupPoints = await dpdIntegration.getPickupPoints(cityCode || cityName);
    
    if (isDPDUnavailable(pickupPoints) || !Array.isArray(pickupPoints) || pickupPoints.length === 0) {
        bot.sendMessage(chatId, `📭 В городе ${cityName} нет пунктов выдачи DPD.\n\nПопробуйте выбрать <b>Курьерскую доставку</b>.`, { parse_mode: 'HTML' });
        return;
    }
    
    let message = `📦 <b>Пункты выдачи в ${cityName}</b>\n\n`;
    const displayPoints = pickupPoints.slice(0, 10);
    
    displayPoints.forEach((point, index) => {
        message += `${index + 1}. <b>${truncateString(point.name, 30)}</b>\n   📍 ${truncateString(point.address, 40)}\n\n`;
    });
    
    if (pickupPoints.length > 10) {
        message += `\n📝 Показаны первые 10 из ${pickupPoints.length}`;
    }
    
    bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: buildPVZKeyboard(displayPoints, cityName, cityCode) });
}

function confirmPVZSelection(chatId, pvzIndex, cityName, cityCode) {
    saveUserDeliveryAddress(chatId, { type: 'pickup', city: cityName, pvzIndex, deliveryType: 'pvz' });
    clearUserState(chatId);
    
    bot.sendMessage(chatId,
        `✅ <b>Адрес доставки выбран!</b>\n\n` +
        `📦 <b>Самовывоз из ПВЗ</b>\n🏙️ Город: ${cityName}\n\n` +
        `Стоимость доставки рассчитывается индивидуально.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
            [{ text: '🎨 Выбрать картину', callback_data: 'start_painting_menu' }],
            [{ text: '📍 Изменить адрес', callback_data: 'dpd_change_address' }]
        ]}}
    );
}

function handleCourierDelivery(chatId, cityName, cityCode) {
    setUserState(chatId, USER_STATES.DPD_ENTERING_ADDRESS, { city: cityName, cityCode, deliveryType: 'courier' });
    
    bot.sendMessage(chatId,
        `🚚 <b>Курьерская доставка в ${cityName}</b>\n\n` +
        `📝 <b>Введите адрес доставки:</b>\n` +
        `📍 Пример: ул. Ленина, 10, 25`,
        { parse_mode: 'HTML', reply_markup: KEYBOARDS.BACK }
    );
}

function handleDPDAddressInput(chatId, text, session) {
    const city = session.data.city;
    
    saveUserDeliveryAddress(chatId, { type: 'courier', city, address: text, deliveryType: 'courier' });
    clearUserState(chatId);
    
    bot.sendMessage(chatId,
        `✅ <b>Адрес доставки сохранён!</b>\n\n` +
        `🚚 <b>Курьерская доставка</b>\n🏙️ Город: ${city}\n📍 Адрес: ${text}\n\n` +
        `Курьер свяжется с вами перед доставкой.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
            [{ text: '🎨 Выбрать картину', callback_data: 'start_painting_menu' }],
            [{ text: '📍 Изменить адрес', callback_data: 'dpd_change_address' }]
        ]}}
    );
}

function saveUserDeliveryAddress(chatId, addressData) {
    db.run(`CREATE TABLE IF NOT EXISTS user_delivery_addresses (
        user_id INTEGER PRIMARY KEY,
        address_data TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`INSERT OR REPLACE INTO user_delivery_addresses (user_id, address_data) VALUES (?, ?)`,
        [chatId, JSON.stringify(addressData)]
    );
}

// === ГЕОЛОКАЦИЯ ===
bot.on('location', (msg) => {
    const chatId = msg.chat.id;
    const session = getUserState(chatId);
    
    if (session?.state !== USER_STATES.DPD_ENTERING_CITY) return;
    
    bot.sendMessage(chatId,
        `📍 Геолокация получена!\n\n` +
        `К сожалению, автоматическое определение города временно недоступно.\n` +
        `📝 Пожалуйста, напишите название вашего города.`,
        { parse_mode: 'HTML' }
    );
});

// === АВТОМАТИЧЕСКАЯ ОТМЕНА ПРОСРОЧЕННЫХ ЗАКАЗОВ ===
async function checkExpiredOrders() {
    db.all(`SELECT * FROM orders WHERE status = ? AND created_at < datetime('now', '-15 minutes')`, [ORDER_STATUS.NEW], async (err, orders) => {
        if (err || orders.length === 0) return;
        
        logger.info(`Найдено ${orders.length} просроченных заказов`);
        
        for (const order of orders) {
            if (order.payment_id && yookassa) {
                try {
                    const paymentStatus = await checkPaymentStatus(order.payment_id);
                    if (['succeeded', 'waiting_for_capture'].includes(paymentStatus.status)) continue;
                } catch (e) {}
            }
            
            db.run(`UPDATE orders SET status = ? WHERE id = ?`, [ORDER_STATUS.EXPIRED, order.id], function(err) {
                if (err || this.changes === 0) return;
                
                const orderDisplay = getOrderDisplay(order);
                logger.info('Заказ просрочен', { orderId: order.id, orderNumber: order.order_number });
                
                bot.sendMessage(order.user_id, MESSAGES.ORDER_EXPIRED(orderDisplay, order), { parse_mode: 'HTML' }).catch(() => {});
                
                if (isAdminConfigured()) {
                    sendAdminMessage(
                        `⏰ <b>Заказ #${orderDisplay} автоматически отменен (просрочен)</b>\n\n` +
                        `👤 Пользователь: ID ${order.user_id}\n🎨 Картина: ${order.painting_title}\n💰 Сумма: ${order.price}₽`,
                        { parse_mode: 'HTML' }
                    );
                }
            });
        }
    });
}

setInterval(checkExpiredOrders, TIMEOUTS.CHECK_EXPIRED_INTERVAL);
logger.info('Автоматическая отмена просроченных заказов активирована');

// === ОЧИСТКА СТАРЫХ ЗАПИСЕЙ ===
function cleanupOldRecords() {
    db.run(`CREATE TABLE IF NOT EXISTS orders_archive AS SELECT * FROM orders WHERE 1=0`, [], (err) => {
        if (err) return;
        
        db.run(`INSERT INTO orders_archive SELECT * FROM orders WHERE created_at < datetime('now', '-30 days')`, [], function(err) {
            if (err || this.changes === 0) return;
            
            logger.info(`Заархивировано ${this.changes} старых заказов`);
            db.run(`DELETE FROM orders WHERE created_at < datetime('now', '-30 days')`);
        });
    });
    
    db.run(`DELETE FROM sessions WHERE updated_at < datetime('now', '-24 hours')`, [], function(err) {
        if (!err && this.changes > 0) {
            logger.info(`Удалено ${this.changes} старых сессий`);
        }
    });
}

setInterval(cleanupOldRecords, TIMEOUTS.CLEANUP_INTERVAL);
logger.info('Периодическая очистка старых записей активирована');

// === API ENDPOINTS ===

app.get('/api/order/:id/status', (req, res) => {
    db.get('SELECT status FROM orders WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Order not found' });
        res.json({ status: row.status });
    });
});

app.get('/api/order/:id', (req, res) => {
    db.get('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Order not found' });
        res.json(row);
    });
});

app.post('/api/order/create', express.json(), (req, res) => {
    const { user_id, painting_id, painting_title, price } = req.body;
    
    if (!user_id || !painting_id || !painting_title || !price) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const painting = findPaintingById(painting_id);
    if (!painting) return res.status(404).json({ error: 'Painting not found' });
    
    const token = crypto.randomBytes(8).toString('hex');
    
    getNextOrderNumber()
        .then(orderNumber => {
            db.run(
                `INSERT INTO orders (order_number, user_id, painting_id, painting_title, price, status, token) VALUES (?, ?, ?, ?, ?, 'new', ?)`,
                [orderNumber, user_id, painting_id, painting_title, price, token],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    res.json({ success: true, order_id: this.lastID, order_number: orderNumber, token });
                    notifyAdminNewOrder(this.lastID, orderNumber, user_id, painting, token);
                }
            );
        })
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/order/:id/paid', (req, res) => {
    db.run(`UPDATE orders SET status = ? WHERE id = ?`, [ORDER_STATUS.PAID, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Order not found' });
        
        res.json({ success: true });
        
        db.get('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, order) => {
            if (order) notifyAdminPayment(req.params.id, order.user_id, order);
        });
    });
});

app.get('/api/paintings', (req, res) => res.json(paintings));

app.get('/api/bot-status', (req, res) => res.json({ 
    online: true, 
    bot_username: '@flexyframe_bot',
    miniapp_url: `${SITE_URL}/index.html`
}));

app.get('/api/dpd/pickup-points', async (req, res) => {
    const { city } = req.query;
    if (!city) return res.json({ error: true, message: 'Укажите город' });
    
    try {
        const points = await dpdIntegration.getPickupPoints(city);
        if (isDPDUnavailable(points)) return res.json({ error: true, message: getDPDErrorMessage(points) });
        
        const formattedPoints = (Array.isArray(points) ? points : [])
            .map(p => ({ id: p.id, name: p.name, address: p.address, schedule: p.schedule, lat: p.coordinates?.latitude, lon: p.coordinates?.longitude }))
            .filter(p => p.lat && p.lon);
        
        res.json({ points: formattedPoints });
    } catch (error) {
        res.json({ error: true, message: 'Ошибка получения данных' });
    }
});

// === YOOKASSA WEBHOOK ===
app.post('/api/webhook/yookassa', express.json(), (req, res) => {
    const event = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    
    logger.info('Вебхук от Юкассы', { event: event.event, paymentId: event.object?.id, clientIP });
    
    // Проверка IP
    try {
        const { YooKassaIPValidator } = require('./check_yookassa_ips');
        if (!new YooKassaIPValidator().isValid(clientIP)) {
            logger.warn('Доступ с непроверенного IP', { ip: clientIP });
            return res.status(403).json({ error: 'Access denied' });
        }
    } catch (e) {}
    
    const payment = event.object;
    const orderId = payment?.metadata?.order_id;
    
    if (event.event === 'payment.succeeded' && orderId) {
        db.run(`UPDATE orders SET status = ?, payment_id = ? WHERE id = ?`, [ORDER_STATUS.PAID, payment.id, orderId], function(err) {
            if (err || this.changes === 0) return;
            
            logger.info('Заказ оплачен через Юкассу', { orderId });
            
            db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
                if (order) {
                    bot.sendMessage(order.user_id, MESSAGES.ORDER_PAID(getOrderDisplay(order)), { parse_mode: 'HTML' }).catch(() => {});
                    notifyAdminPayment(orderId, order.user_id, order);
                }
            });
        });
    } else if (event.event === 'payment.canceled' && orderId) {
        db.run(`UPDATE orders SET status = ?, payment_id = ? WHERE id = ?`, [ORDER_STATUS.CANCELLED, payment.id, orderId]);
        logger.info('Заказ отменен через Юкассу', { orderId });
    } else if (event.event === 'payment.expired' && orderId) {
        db.run(`UPDATE orders SET status = ? WHERE id = ?`, [ORDER_STATUS.EXPIRED, orderId]);
        logger.info('Срок оплаты истек', { orderId });
    }
    
    res.json({ success: true });
});

// === СТАТИЧЕСКИЕ ФАЙЛЫ ===
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// === ЗАПУСК СЕРВЕРА ===
app.listen(PORT, () => logger.info(`Веб-сервер запущен на порту ${PORT}`));

// === ОБРАБОТКА ОШИБОК ===
bot.on('polling_error', (error) => logger.error('Ошибка поллинга', { error: error.message }));
bot.on('webhook_error', (error) => logger.error('Ошибка вебхука', { error: error.message }));

// === MINIAPP КНОПКА ===
function setupMiniAppButton() {
    bot.setChatMenuButton({ menu_button: { type: 'web_app', text: '🎨 FlexyFrame', web_app: { url: `${SITE_URL}/index.html` } } })
        .then(() => logger.info('Кнопка MiniApp установлена'))
        .catch(err => logger.error('Ошибка установки кнопки MiniApp', { error: err.message }));
}

// === ЗАПУСК ===
logger.info('FlexyFrame Bot запущен', {
    bot: '@flexyframe_bot',
    site: `${SITE_URL}/index.html`,
    admin: ADMIN_CHAT_ID || 'не настроен'
});

setupMiniAppButton();