/**
 * FlexyFrame Telegram Bot
 * Уникальные граффити-арты на заказ
 * 
 * @bot @flexyframe_bot
 * @version 2.0
 */

const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const logger = require('./logger');

// === КОНФИГУРАЦИЯ ===
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SITE_URL = process.env.SITE_URL || 'https://flexyframe.github.io/Home';
const PORT = process.env.PORT || 3000;

// YooKassa конфигурация
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

// Валидация токена
if (!TOKEN || TOKEN === 'your_token_here') {
    console.error('❌ Ошибка: TELEGRAM_BOT_TOKEN не установлен в .env');
    process.exit(1);
}

// Инициализация YooKassa
const YooKassa = require('yookassa');
let yookassa = null;

if (YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY && YOOKASSA_SHOP_ID !== 'your_shop_id') {
    yookassa = new YooKassa({
        shopId: YOOKASSA_SHOP_ID,
        secretKey: YOOKASSA_SECRET_KEY
    });
    console.log('✅ YooKassa инициализирована');
} else {
    console.log('⚠️ YooKassa не настроена (используется ручная оплата)');
}

// Функция создания платежа через Юкассу
async function createYookassaPayment(orderId, amount, description = '') {
    if (!yookassa) {
        throw new Error('YooKassa не настроена');
    }

    try {
        const payment = await yookassa.createPayment({
            amount: {
                value: amount.toFixed(2),
                currency: 'RUB',
            },
            confirmation: {
                type: 'redirect',
                return_url: `${SITE_URL}/index.html`,
            },
            capture: true,
            description: description || `Заказ #${orderId}`,
            metadata: {
                order_id: orderId.toString(),
            },
        });

        return {
            success: true,
            payment_id: payment.id,
            status: payment.status,
            confirmation_url: payment.confirmation.confirmation_url,
            amount: payment.amount.value,
            description: payment.description,
        };
    } catch (error) {
        console.error('❌ Ошибка создания платежа:', error);
        return {
            success: false,
            error: error.message,
        };
    }
}

// Функция проверки статуса платежа
async function checkPaymentStatus(paymentId) {
    if (!yookassa) {
        return { status: 'unknown', error: 'YooKassa не настроена' };
    }

    try {
        const payment = await yookassa.getPayment(paymentId);
        return {
            status: payment.status,
            captured: payment.captured,
            refundable: payment.refundable,
        };
    } catch (error) {
        console.error('❌ Ошибка проверки платежа:', error);
        return { status: 'error', error: error.message };
    }
}

// === ИМПОРТ ДАННЫХ ===
const { paintings, getPaintingImagePath, findPaintingById, findPaintingByTitle } = require('./data.js');

// === ИМПОРТ DPD ===
const dpd = require('./dpd-integration');
console.log('📦 DPD модуль загружен');

// === ИНИЦИАЛИЗАЦИЯ БОТА ===
const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

// === БАЗА ДАННЫХ ===
const db = new sqlite3.Database('./flexyframe.db', (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err);
    } else {
        console.log('✅ База данных подключена');
        initDB();
    }
});

function initDB() {
    db.serialize(() => {
        // Таблица заказов
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
        
        // Таблица счётчиков для номеров заказов
        db.run(`CREATE TABLE IF NOT EXISTS order_counter (
            id INTEGER PRIMARY KEY,
            current_number INTEGER DEFAULT 0
        )`);
        
        // Инициализация счётчика
        db.run(`INSERT OR IGNORE INTO order_counter (id, current_number) VALUES (1, 0)`);
        
        // Таблица пользователей
        db.run(`CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Таблица сессий (для отслеживания действий)
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            user_id INTEGER PRIMARY KEY,
            state TEXT,
            data TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Таблица тикетов поддержки
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
const userStates = {}; // Временное хранилище состояний

function setUserState(chatId, state, data = {}) {
    userStates[chatId] = { state, data, timestamp: Date.now() };
    
    // Сохраняем в БД для надежности
    db.run(
        `INSERT OR REPLACE INTO sessions (user_id, state, data) VALUES (?, ?, ?)`,
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

// === ПОЛУЧИТЬ СЛЕДУЮЩИЙ НОМЕР ЗАКАЗА ===
function getNextOrderNumber(callback) {
    db.run(
        `UPDATE order_counter SET current_number = current_number + 1 WHERE id = 1`,
        function(err) {
            if (err) {
                console.error('❌ Ошибка получения номера заказа:', err);
                callback(null);
                return;
            }
            
            db.get(`SELECT current_number FROM order_counter WHERE id = 1`, (err, row) => {
                if (err || !row) {
                    console.error('❌ Ошибка чтения счётчика:', err);
                    callback(null);
                    return;
                }
                
                callback(row.current_number);
            });
        }
    );
}

// === УДАЛЕНИЕ СООБЩЕНИЙ ЗАКАЗА ===
function deleteOrderMessages(orderId) {
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
        if (err || !order) {
            console.log('⚠️ Заказ не найден для удаления сообщений:', orderId);
            return;
        }
        
        // Удаляем сообщение в чате пользователя
        if (order.user_message_id) {
            bot.deleteMessage(order.user_id, order.user_message_id)
                .then(() => console.log(`✅ Сообщение пользователя удалено: ${order.user_message_id}`))
                .catch(err => console.log(`⚠️ Не удалось удалить сообщение пользователя: ${err.message}`));
        }
        
        // Удаляем сообщение в чате админа
        if (order.admin_message_id && ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id') {
            bot.deleteMessage(ADMIN_CHAT_ID, order.admin_message_id)
                .then(() => console.log(`✅ Сообщение админа удалено: ${order.admin_message_id}`))
                .catch(err => console.log(`⚠️ Не удалось удалить сообщение админа: ${err.message}`));
        }
    });
}

// === ГЛАВНОЕ МЕНЮ ===
function showMainMenu(chatId, firstName = 'пользователь') {
    const keyboard = {
        keyboard: [
            [{ text: '🎨 Выбрать картину' }],
            [{ text: '🛒 Открыть сайт' }],
            [{ text: '📍 Выбрать адрес DPD' }],
            [{ text: '📋 Как заказать' }, { text: '💬 О проекте' }],
            [{ text: '🛒 Мои заказы' }]
        ],
        resize_keyboard: true
    };

    const greeting = `👋 <b>Добро пожаловать в FlexyFrame, ${firstName}!</b>\n\n` +
        `🎨 <b>FlexyFrame — где искусство оживает в каждом штрихе</b>\n\n` +
        `Мы создаём уникальные арт-объекты, которые становятся центром вашего интерьера.\n\n` +
        `🎯 <b>Выберите действие:</b>\n` +
        `• 🎨 Выбрать картину\n` +
        `• 🛒 Открыть сайт\n` +
        `• 📍 Адрес доставки\n` +
        `• 📋 Как заказать\n` +
        `• 💬 О проекте\n` +
        `• 🛒 Мои заказы\n\n` +
        `💡 <i>Сайт: ${SITE_URL}/index.html</i>`;
    
    bot.sendMessage(chatId, greeting, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
}

// === СТАРТ БОТА ===
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.chat.first_name;
    const username = msg.chat.username;
    const messageId = msg.message_id;
    
    // Сохраняем пользователя в БД
    db.run(
        `INSERT OR REPLACE INTO users (user_id, username, first_name, last_name) VALUES (?, ?, ?, ?)`,
        [chatId, username, firstName, msg.chat.last_name]
    );
    
    // Удаляем сообщение /start
    bot.deleteMessage(chatId, messageId).catch(() => {});
    
    // Проверяем параметр запуска (из MiniApp)
    const startParam = msg.text.split(' ')[1];
    
    if (startParam) {
        handleStartParameter(chatId, startParam);
        return;
    }
    
    // Обычный старт
    showMainMenu(chatId, firstName);
});

// === ОБРАБОТКА ПАРАМЕТРА ЗАПУСКА ===
function handleStartParameter(chatId, param) {
    // Форматы: "order_1", "order_1_token", "1_5000", или JSON от MiniApp
    
    // Проверяем, не JSON ли это (от MiniApp)
    if (param.startsWith('{') && param.endsWith('}')) {
        try {
            const data = JSON.parse(param);
            if (data.action === 'create_order' && data.painting) {
                // Создаем заказ из данных MiniApp
                const painting = data.painting;
                const paintingData = findPaintingById(painting.id) || {
                    id: painting.id,
                    title: painting.title,
                    category: painting.category,
                    price: painting.price
                };
                createOrder(chatId, paintingData, null);
                return;
            }
        } catch (e) {
            console.error('Ошибка парсинга JSON:', e);
        }
    }
    
    // Обработка quick_order параметров
    if (param.startsWith('quick_order_')) {
        const parts = param.split('_');
        const paintingId = parseInt(parts[2]);
        
        const painting = findPaintingById(paintingId);
        if (!painting) {
            bot.sendMessage(chatId, 
                `❌ <b>Картина не найдена!</b>\n\n` +
                `Возможно, она была удалена или ссылка устарела.\n` +
                `Пожалуйста, выберите другую картину.`,
                { parse_mode: 'HTML' }
            );
            showMainMenu(chatId);
            return;
        }
        
        // Сразу создаем заказ
        createOrder(chatId, painting);
        return;
    }
    
    // Обычная обработка параметров
    let paintingId;
    let token = null;
    
    if (param.startsWith('order_')) {
        const parts = param.split('_');
        paintingId = parseInt(parts[1]);
        if (parts.length >= 3) {
            token = parts[2];
        }
    } else if (param.includes('_')) {
        // Старый формат: 1_5000
        paintingId = parseInt(param.split('_')[0]);
    } else {
        // Просто ID картины
        paintingId = parseInt(param);
    }
    
    const painting = findPaintingById(paintingId);
    if (!painting) {
        bot.sendMessage(chatId, 
            `❌ <b>Картина не найдена!</b>\n\n` +
            `Возможно, она была удалена или ссылка устарела.\n` +
            `Пожалуйста, выберите другую картину.`,
            { parse_mode: 'HTML' }
        );
        showMainMenu(chatId);
        return;
    }
    
    // Если передан токен - проверяем существующий заказ
    if (token) {
        db.get(`SELECT * FROM orders WHERE token = ?`, [token], (err, order) => {
            if (err) {
                console.error('Ошибка проверки токена:', err);
                bot.sendMessage(chatId, '❌ Произошла ошибка при проверке заказа.');
                return;
            }
            
            if (order) {
                showOrderInfo(chatId, order, painting);
            } else {
                // Создаем новый заказ с этим токеном
                createOrder(chatId, painting, token);
            }
        });
    } else {
        // Создаем новый заказ
        createOrder(chatId, painting, null);
    }
}

// === СОЗДАНИЕ ЗАКАЗА ===
function createOrder(chatId, painting, token = null) {
    const orderToken = token || crypto.randomBytes(8).toString('hex');
    
    // Получаем следующий номер заказа
    getNextOrderNumber((orderNumber) => {
        if (!orderNumber) {
            logger.error('Не удалось получить номер заказа', { chatId, paintingId: painting.id });
            bot.sendMessage(chatId, '❌ Произошла ошибка при создании заказа. Попробуйте позже.');
            return;
        }
        
        db.run(
            `INSERT INTO orders (order_number, user_id, painting_id, painting_title, price, status, token) VALUES (?, ?, ?, ?, ?, 'new', ?)`,
            [orderNumber, chatId, painting.id, painting.title, painting.price, orderToken],
            function(err) {
                if (err) {
                    logger.logOrderCreationError(err, chatId, painting.id);
                    bot.sendMessage(chatId, '❌ Произошла ошибка при создании заказа. Попробуйте позже.');
                    return;
                }
                
                const orderId = this.lastID;
                logger.logOrderCreation(orderId, orderNumber, chatId, painting.title, painting.price);
                showOrderInfo(chatId, { id: orderId, order_number: orderNumber, ...painting, token: orderToken, status: 'new' }, painting);
                notifyAdmin(orderId, orderNumber, chatId, painting, orderToken);
            }
        );
    });
}

// === ПОКАЗАТЬ ИНФОРМАЦИЮ О ЗАКАЗЕ ===
async function showOrderInfo(chatId, order, painting) {
    const imagePath = getPaintingImagePath(painting);
    
    // Используем order_number если есть, иначе id
    const orderDisplay = order.order_number || order.id;
    
    const message = 
        `✅ <b>Заказ #${orderDisplay}</b>\n\n` +
        `🎨 Картина: <b>${painting.title}</b>\n` +
        `💰 Сумма: <b>${painting.price}₽</b>\n` +
        `📦 Срок выполнения: 2-4 дня\n` +
        `📊 Статус: ${getStatusEmoji(order.status)} ${getStatusText(order.status)}\n\n` +
        `⚠️ <b>Важно!</b> После оплаты нажмите "✅ Оплатил(а)".\n` +
        `📦 Мы начнем работу сразу после подтверждения.\n\n` +
        `📞 Вопросы: @FlexyFrameSupport\n` +
        `🔑 Токен: <code>${order.token}</code>`;
    
    let keyboard;
    
    // Если YooKassa настроена, создаем платеж и показываем кнопку с ссылкой на Юкассу
    if (yookassa && order.status === 'new') {
        try {
            const paymentResult = await createYookassaPayment(order.id, painting.price, `Заказ #${order.id} - ${painting.title}`);
            
            if (paymentResult.success) {
                // Сохраняем ID платежа в БД
                db.run(`UPDATE orders SET payment_id = ? WHERE id = ?`, [paymentResult.payment_id, order.id]);
                
                keyboard = {
                    inline_keyboard: [
                        [{ text: '💳 Оплатить через ЮКассу', url: paymentResult.confirmation_url }],
                        [{ text: '✅ Оплатил(а)', callback_data: `paid_${order.id}` }],
                        [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
                    ]
                };
                
                console.log('✅ Платеж Юкассы создан:', paymentResult.payment_id);
            } else {
                // Если не удалось создать платеж, показываем ручную оплату
                keyboard = {
                    inline_keyboard: [
                        [{ text: '📱 Оплатить вручную', callback_data: `manual_pay_${order.id}` }],
                        [{ text: '✅ Оплатил(а)', callback_data: `paid_${order.id}` }],
                        [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
                    ]
                };
            }
        } catch (error) {
            console.error('❌ Ошибка создания платежа:', error);
            // Если ошибка, показываем ручную оплату
            keyboard = {
                inline_keyboard: [
                    [{ text: '📱 Оплатить вручную', callback_data: `manual_pay_${order.id}` }],
                    [{ text: '✅ Оплатил(а)', callback_data: `paid_${order.id}` }],
                    [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
                ]
            };
        }
    } else {
        // YooKassa не настроена или заказ уже оплачен
        keyboard = {
            inline_keyboard: [
                [{ text: '📱 Оплатить вручную', callback_data: `manual_pay_${order.id}` }],
                [{ text: '✅ Оплатил(а)', callback_data: `paid_${order.id}` }],
                [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
            ]
        };
    }
    
    // Клавиатура для текстового сообщения (если фото не отправилось)
    const textKeyboard = {
        keyboard: [
            [{ text: '❌ Отменить заказ' }],
            [{ text: '📋 Мои заказы' }]
        ],
        resize_keyboard: true
    };
    
    console.log('📤 ОТПРАВКА ОРДЕРА:', { chatId, orderId: order.id, imagePath });
    
    // Пытаемся отправить фото
    bot.sendPhoto(chatId, imagePath, { 
        caption: message, 
        parse_mode: 'HTML', 
        reply_markup: keyboard 
    }).then((sentMessage) => {
        console.log('✅ ОРДЕР УСПЕШНО ОТПРАВЛЕН:', order.id);
        // Сохраняем ID сообщения в БД
        db.run(`UPDATE orders SET user_message_id = ? WHERE id = ?`, [sentMessage.message_id, order.id]);
        // Устанавливаем состояние "заказ создан"
        setUserState(chatId, 'order_created', { orderId: order.id });
    }).catch((err) => {
        console.log('⚠️ ОШИБКА ОТПРАВКИ ФОТО:', err.message);
        console.log('📤 ПОПЫТКА ОТПРАВИТЬ ТЕКСТОМ...');
        // Если фото не отправилось - текстом
        bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: textKeyboard
        }).then((sentMessage) => {
            console.log('✅ ОРДЕР ОТПРАВЛЕН ТЕКСТОМ:', order.id);
            // Сохраняем ID сообщения в БД
            db.run(`UPDATE orders SET user_message_id = ? WHERE id = ?`, [sentMessage.message_id, order.id]);
            // Устанавливаем состояние "заказ создан"
            setUserState(chatId, 'order_created', { orderId: order.id });
        }).catch((err2) => {
            console.log('❌ ОШИБКА ОТПРАВКИ ТЕКСТА:', err2.message);
        });
    });
}

// === УВЕДОМЛЕНИЕ О ЗАКАЗЕ АДМИНИСТРАТОРУ ===
function notifyAdmin(orderId, orderNumber, chatId, painting, token) {
    if (!ADMIN_CHAT_ID || ADMIN_CHAT_ID === 'your_admin_id') {
        console.log('ℹ️ Админ-чат не настроен');
        return;
    }

    const message = 
        `🔔 <b>Новый заказ #${orderNumber}</b>\n\n` +
        `👤 Пользователь: ID ${chatId}\n` +
        `🎨 Картина: ${painting.title}\n` +
        `💰 Сумма: ${painting.price}₽\n` +
        `📊 Статус: Ожидает оплаты\n` +
        `🔑 Токен: <code>${token}</code>`;

    bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' })
        .then((sentMessage) => {
            console.log('✅ Уведомление администратору отправлено');
            // Сохраняем ID сообщения админа в БД
            db.run(`UPDATE orders SET admin_message_id = ? WHERE id = ?`, [sentMessage.message_id, orderId]);
        })
        .catch(err => console.log('⚠️ Ошибка отправки админ-уведомления:', err.message));
}

// === ПОЛУЧИТЬ СТАТУС ЭМОДЗИ ===
function getStatusEmoji(status) {
    const emojis = {
        'new': '⏳',
        'paid': '✅',
        'in_progress': '🎨',
        'completed': '📦',
        'cancelled': '❌'
    };
    return emojis[status] || '⏳';
}

// === ПОЛУЧИТЬ ТЕКСТ СТАТУСА ===
function getStatusText(status) {
    const texts = {
        'new': 'Ожидает оплаты',
        'paid': 'Оплачен, в работе',
        'in_progress': 'В процессе',
        'completed': 'Готово',
        'cancelled': 'Отменен',
        'expired': 'Просрочен'
    };
    return texts[status] || status;
}

// === ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ===
bot.on('message', (msg) => {
    console.log('📨 ПОЛУЧЕНО СООБЩЕНИЕ:', JSON.stringify(msg, null, 2));
    
    if (msg.text === '/start') return; // Уже обработано
    
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Проверяем данные от MiniApp (web_app_data)
    if (msg.web_app_data && msg.web_app_data.data) {
        console.log('🎯 НАЙДЕНЫ ДАННЫЕ MINIAPP:', msg.web_app_data.data);
        try {
            const data = JSON.parse(msg.web_app_data.data);
            console.log('✅ ДАННЫЕ РАСПАРСЕНЫ:', data);
            
            // Обработка данных от DPD Widget
            if (data.type === 'pickup_point') {
                const chatId = msg.chat.id;
                const pickupPointId = data.pickupPointId;
                const address = data.address;
                const name = data.name;
                
                console.log('📦 Выбран ПВЗ:', name, address);
                
                // Сохраняем данные о ПВЗ
                const addressData = {
                    type: 'pickup',
                    pickupPointId: pickupPointId,
                    address: address,
                    name: name,
                    deliveryType: 'pickup'
                };
                
                saveUserDeliveryAddress(chatId, addressData);
                clearUserState(chatId);
                
                // Подтверждение выбора
                bot.sendMessage(chatId,
                    `✅ <b>Пункт выдачи выбран!</b>\n\n` +
                    `📦 <b>${name}</b>\n` +
                    `📍 ${address}\n\n` +
                    `Теперь выберите картину для заказа.`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🎨 Выбрать картину', callback_data: 'start_painting_menu' }]
                            ]
                        }
                    }
                );
                return;
            }
            
            if (data.action === 'create_order' && data.painting) {
                console.log('📦 СОЗДАЕМ ЗАКАЗ:', data.painting);
                const painting = data.painting;
                const paintingData = findPaintingById(painting.id) || {
                    id: painting.id,
                    title: painting.title,
                    category: painting.category,
                    price: painting.price
                };
                createOrder(chatId, paintingData, null);
                return;
            }
        } catch (e) {
            console.error('❌ ОШИБКА ОБРАБОТКИ web_app_data:', e);
        }
    }
    
    // Проверяем состояние пользователя
    const session = getUserState(chatId);
    
    // Главное меню
    if (text === '🎨 Выбрать картину') {
        showPaintingsMenu(chatId);
        return;
    }
    
    if (text === '🛒 Открыть сайт') {
        showSiteLink(chatId);
        return;
    }
    
    if (text === '📋 Как заказать') {
        showHowItWorks(chatId);
        return;
    }
    
    if (text === '💬 О проекте') {
        showAbout(chatId);
        return;
    }
    
    if (text === '🛒 Мои заказы') {
        showMyOrders(chatId);
        return;
    }
    
    if (text === '📍 Выбрать адрес DPD') {
        startDPDAddressSelection(chatId);
        return;
    }
    
    if (text === '📍 Адрес доставки') {
        showDeliveryAddress(chatId);
        return;
    }
    
    // DPD: Выбор города
    if (session && session.state === 'dpd_selecting_city') {
        handleDPDCitySelection(chatId, text, session);
        return;
    }
    
    // DPD: Выбор способа доставки
    if (session && session.state === 'dpd_selecting_delivery_type') {
        handleDPDDeliveryTypeSelection(chatId, text, session);
        return;
    }
    
    // DPD: Выбор ПВЗ
    if (session && session.state === 'dpd_selecting_pvz') {
        handleDPVPVZSelection(chatId, text, session);
        return;
    }
    
    // DPD: Ввод адреса для курьерской доставки
    if (session && session.state === 'dpd_entering_address') {
        handleDPDAddressInput(chatId, text, session);
        return;
    }
    
    // Обработка кнопки "Назад" ВЫШЕ всех остальных проверок
    if (text === '🔙 Назад') {
        showMainMenu(chatId, msg.chat.first_name);
        clearUserState(chatId);
        return;
    }
    
    // Выбор картины из меню
    if (session && session.state === 'choosing_painting') {
        const painting = paintings.find(p => text.includes(p.title));
        if (painting) {
            console.log('🎯 НАЙДЕНА КАРТИНА:', painting.title);
            setUserState(chatId, 'painting_selected', { paintingId: painting.id });
            
            const keyboard = {
                keyboard: [
                    [{ text: '💳 Оформить заказ' }],
                    [{ text: '🎨 Выбрать другую' }],
                    [{ text: '🔙 Назад' }]
                ],
                resize_keyboard: true
            };
            
            const message = 
                `🎨 <b>${painting.title}</b>\n` +
                `💰 Цена: <b>${painting.price}₽</b>\n` +
                `📦 Срок: 2-4 дня\n\n` +
                `Эта картина создается индивидуально под ваш заказ.`;
            
            const imagePath = getPaintingImagePath(painting);
            console.log('📸 Попытка отправить фото:', imagePath);
            
            bot.sendPhoto(chatId, imagePath, { 
                caption: message, 
                parse_mode: 'HTML', 
                reply_markup: keyboard 
            }).catch((err) => {
                console.log('⚠️ Ошибка отправки фото, отправляем текстом:', err.message);
                bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            });
        } else {
            console.log('❌ Картина не найдена в тексте:', text);
        }
        return;
    }
    
    // Альтернативная проверка: если сообщение содержит цену и не обработано выше
    if (text && text.includes('₽') && !text.includes('🔙')) {
        const painting = paintings.find(p => text.includes(p.title));
        if (painting) {
            console.log('🎯 АЛЬТЕРНАТИВНАЯ ОБРАБОТКА:', painting.title);
            setUserState(chatId, 'painting_selected', { paintingId: painting.id });
            
            const keyboard = {
                keyboard: [
                    [{ text: '💳 Оформить заказ' }],
                    [{ text: '🎨 Выбрать другую' }],
                    [{ text: '🔙 Назад' }]
                ],
                resize_keyboard: true
            };
            
            const message = 
                `🎨 <b>${painting.title}</b>\n` +
                `💰 Цена: <b>${painting.price}₽</b>\n` +
                `📦 Срок: 2-4 дня\n\n` +
                `Эта картина создается индивидуально под ваш заказ.`;
            
            const imagePath = getPaintingImagePath(painting);
            
            bot.sendPhoto(chatId, imagePath, { 
                caption: message, 
                parse_mode: 'HTML', 
                reply_markup: keyboard 
            }).catch(() => {
                bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            });
            return;
        }
    }
    
    // Оформление заказа
    if (text === '💳 Оформить заказ') {
        console.log('💳 НАЖАТА КНОПКА ОФОРМЛЕНИЯ, СЕССИЯ:', session);
        if (session && session.state === 'painting_selected') {
            const paintingId = session.data.paintingId;
            const painting = findPaintingById(paintingId);
            if (painting) {
                console.log('📦 СОЗДАЕМ ЗАКАЗ:', painting.title);
                createOrder(chatId, painting);
                clearUserState(chatId);
            } else {
                console.log('❌ Картина не найдена по ID:', paintingId);
                bot.sendMessage(chatId, '❌ Ошибка: картина не найдена');
            }
        } else {
            console.log('❌ Нет активной сессии или неверный статус');
            bot.sendMessage(chatId, '❌ Сначала выберите картину через "🎨 Выбрать картину"');
        }
        return;
    }
    
    // Выбрать другую картину
    if (session && session.state === 'painting_selected' && text === '🎨 Выбрать другую') {
        clearUserState(chatId);
        showPaintingsMenu(chatId);
        return;
    }
    
    // Отмена заказа (после создания)
    if (session && session.state === 'order_created' && text === '❌ Отменить заказ') {
        const orderId = session.data.orderId;
        
        db.run(`UPDATE orders SET status = 'cancelled' WHERE id = ? AND user_id = ?`, [orderId, chatId], function(err) {
            if (err || this.changes === 0) {
                bot.sendMessage(chatId, '❌ Не удалось отменить заказ. Возможно, он уже обрабатывается.');
                return;
            }
            
            // Получаем информацию о заказе для отображения order_number
            db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
                if (err || !order) {
                    bot.sendMessage(chatId, 
                        `❌ <b>Заказ #${orderId} отменен!</b>\n\n` +
                        `Если вы передумали, можете создать новый заказ.`,
                        { parse_mode: 'HTML' }
                    );
                    return;
                }
                
                // Используем order_number если есть, иначе id
                const orderDisplay = order.order_number || order.id;
                
                bot.sendMessage(chatId, 
                    `❌ <b>Заказ #${orderDisplay} отменен!</b>\n\n` +
                    `Если вы передумали, можете создать новый заказ.`,
                    { parse_mode: 'HTML' }
                );
                
                // Уведомляем администратора
                if (ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id') {
                    bot.sendMessage(ADMIN_CHAT_ID, 
                        `❌ <b>Заказ #${orderDisplay} отменен пользователем!</b>\n\n` +
                        `👤 Пользователь: ${chatId}`,
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                }
                
                // Удаляем сообщения о заказе
                deleteOrderMessages(orderId);
                
                clearUserState(chatId);
                showMainMenu(chatId, msg.chat.first_name);
            });
        });
        return;
    }
    
    // Назад в главное меню (в других состояниях)
    if (text === '🔙 Назад') {
        showMainMenu(chatId, msg.chat.first_name);
        clearUserState(chatId);
        return;
    }
    
    // Сделать новый заказ (из меню моих заказов)
    if (text === '🎨 Сделать новый заказ') {
        showPaintingsMenu(chatId);
        return;
    }
    
    // Выбрать другую картину (после создания заказа)
    if (session && session.state === 'order_created' && text === '🎨 Выбрать другую') {
        clearUserState(chatId);
        showPaintingsMenu(chatId);
        return;
    }
});

// === ПОКАЗАТЬ МЕНЮ КАРТИН ===
function showPaintingsMenu(chatId) {
    const keyboard = paintings.map(p => [{
        text: `${p.title} - ${p.price}₽`
    }]);
    
    keyboard.push([{ text: '🔙 Назад' }]);
    
    console.log('🎨 УСТАНАВЛИВАЮ СЕССИЮ choosing_painting ДЛЯ:', chatId);
    setUserState(chatId, 'choosing_painting');
    
    // Проверяем, что сессия установилась
    const checkSession = getUserState(chatId);
    console.log('✅ ПРОВЕРКА СЕССИИ ПОСЛЕ УСТАНОВКИ:', checkSession);
    
    bot.sendMessage(chatId, '🎨 Выберите картину для заказа:', {
        reply_markup: { keyboard, resize_keyboard: true }
    });
}

// === ПОКАЗАТЬ ССЫЛКУ НА САЙТ ===
function showSiteLink(chatId) {
    const message = 
        `📱 <b>Сайт FlexyFrame</b>\n\n` +
        `Откройте сайт для удобного выбора картин:\n\n` +
        `🔗 <b>${SITE_URL}/index.html</b>\n\n` +
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
            [{ text: '🌐 Открыть сайт', url: `${SITE_URL}/index.html` }]
        ]
    };
    
    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
}

// === ПОКАЗАТЬ КАК ЗАКАЗАТЬ ===
function showHowItWorks(chatId) {
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
        `💡 <b>Сайт:</b> ${SITE_URL}/index.html`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// === ПОКАЗАТЬ О ПРОЕКТЕ ===
function showAbout(chatId) {
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
        `• Поддержка: @FlexyFrameSupport\n` +
        `• Email: designstudioflexyframe@gmail.com\n\n` +
        `🔗 <b>Сайт:</b> ${SITE_URL}/index.html\n\n` +
        `💡 <i>FlexyFrame — это не просто картина. Это история, подсвеченная вашим вкусом.</i>`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// === ПОКАЗАТЬ АДРЕС ДОСТАВКИ ===
function showDeliveryAddress(chatId) {
    const message = 
        `📍 <b>Адрес доставки</b>\n\n` +
        `📦 <b>Самовывоз:</b>\n` +
        `📍 г. Томск, ул. Учебная, 2/2\n` +
        `⏰ Время работы: 10:00 - 20:00\n\n` +
        `🚚 <b>Доставка по Томску:</b>\n` +
        `• Курьерская доставка: 300₽\n` +
        `• При заказе от 3000₽ - бесплатно\n` +
        `📍 Доставка по адресу клиента\n\n` +
        `📦 <b>Доставка в другие города:</b>\n` +
        `• СДЭК\n` +
        `• Почта России\n` +
        `• Деловые Линии\n\n` +
        `💡 <b>Электронная версия:</b>\n` +
        `Мгновенная отправка на email в формате PDF/JPG\n\n` +
        `❓ <b>Вопросы по доставке:</b>\n` +
        `📞 @FlexyFrameSupport`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// === ПОКАЗАТЬ МОИ ЗАКАЗЫ ===
function showMyOrders(chatId) {
    db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [chatId], (err, rows) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка при загрузке заказов');
            return;
        }
        
        if (rows.length === 0) {
            bot.sendMessage(chatId, '📭 У вас пока нет заказов. Начните с выбора картины!');
            return;
        }
        
        const keyboard = {
            keyboard: [
                [{ text: '🎨 Сделать новый заказ' }]
            ],
            resize_keyboard: true
        };
        
        // Отправляем каждый заказ отдельным сообщением (не более 10 за раз)
        let messagesSent = 0;
        
        const sendOrder = (index) => {
            if (index >= rows.length) {
                // Все заказы отправлены, показываем кнопку
                if (messagesSent > 0) {
                    bot.sendMessage(chatId, '👆 Выберите действие:', { reply_markup: keyboard });
                }
                return;
            }
            
            const order = rows[index];
            const orderDisplay = order.order_number || order.id;
            
            const message = 
                `📋 <b>Заказ #${orderDisplay}</b>\n` +
                `${getStatusEmoji(order.status)} ${getStatusText(order.status)}\n` +
                `🎨 ${order.painting_title}\n` +
                `💰 ${order.price}₽\n` +
                `📅 ${new Date(order.created_at).toLocaleDateString('ru-RU')}`;
            
            bot.sendMessage(chatId, message, { parse_mode: 'HTML' })
                .then(() => {
                    messagesSent++;
                    // Небольшая задержка между сообщениями
                    setTimeout(() => sendOrder(index + 1), 100);
                })
                .catch(err => {
                    console.log('❌ Ошибка отправки заказа:', err.message);
                    sendOrder(index + 1);
                });
        };
        
        sendOrder(0);
    });
}

// === ОБРАБОТКА CALLBACK КНОПОК ===
bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;
    
    console.log('📞 CALLBACK QUERY ПОЛУЧЕН:', {
        data: data,
        type: typeof data,
        from: callbackQuery.from.id,
        chatId: chatId
    });
    
    // Убираем "часики"
    bot.answerCallbackQuery(callbackQuery.id);
    
    // Проверяем, является ли data JSON от MiniApp
    if (data && data.startsWith('{') && data.endsWith('}')) {
        try {
            const miniAppData = JSON.parse(data);
            console.log('✅ ДАННЫЕ MINIAPP РАСПАРСЕНЫ:', miniAppData);
            
            if (miniAppData.action === 'create_order' && miniAppData.painting) {
                console.log('📦 СОЗДАЕМ ЗАКАЗ ИЗ MINIAPP:', miniAppData.painting);
                
                const painting = miniAppData.painting;
                const paintingData = findPaintingById(painting.id) || {
                    id: painting.id,
                    title: painting.title,
                    category: painting.category,
                    price: painting.price
                };
                
                createOrder(chatId, paintingData, null);
                return;
            }
        } catch (e) {
            console.error('❌ ОШИБКА ПАРСИНГА JSON:', e);
        }
    }
    
    // Кнопка "✅ Оплатил(а)"
    if (data.startsWith('paid_')) {
        const orderId = parseInt(data.replace('paid_', ''));
        
        db.get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [orderId, chatId], (err, order) => {
            if (err || !order) {
                bot.sendMessage(chatId, '❌ Заказ не найден или не принадлежит вам.');
                return;
            }
            
            if (order.status === 'paid') {
                // Используем order_number если есть, иначе id
                const orderDisplay = order.order_number || order.id;
                bot.sendMessage(chatId, `✅ Заказ #${orderDisplay} уже оплачен и в работе!`);
                return;
            }
            
            // Обновляем статус
            db.run(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId]);
            
            // Используем order_number если есть, иначе id
            const orderDisplay = order.order_number || order.id;
            
            // Отправляем подтверждение
            bot.sendMessage(chatId, 
                `✅ <b>Заказ #${orderDisplay} оплачен!</b>\n\n` +
                `Мы получили подтверждение и начали работу.\n` +
                `Срок выполнения: 2-4 дня.\n\n` +
                `📞 Следить за статусом можно в разделе "Мои заказы".\n` +
                `💬 Вопросы: @FlexyFrameSupport`,
                { parse_mode: 'HTML' }
            );
            
            // Уведомляем администратора
            notifyAdminPayment(orderId, chatId, order);
        });
    }
    
    // Кнопка "📋 Мои заказы"
    else if (data === 'my_orders') {
        showMyOrders(chatId);
    }
    
    // === DPD CALLBACK ОБРАБОТЧИКИ ===
    
    // Выбор города DPD
    else if (data.startsWith('dpd_city_')) {
        const parts = data.replace('dpd_city_', '').split('_');
        const cityName = parts.slice(0, -1).join('_'); // Всё кроме последнего элемента - название города
        const cityCode = parts[parts.length - 1]; // Последний элемент - код
        
        console.log('🏙️ ВЫБОР ГОРОДА:', cityName, 'Код:', cityCode);
        handleDPDCityCallback(chatId, cityName, cityCode);
    }
    
    // Выбор типа доставки (ПВЗ или курьер)
    else if (data.startsWith('dpd_delivery_pvz_')) {
        const parts = data.replace('dpd_delivery_pvz_', '').split('_');
        const cityName = parts.slice(0, -1).join('_');
        const cityCode = parts[parts.length - 1];
        
        console.log('📦 ПВЗ:', cityName, cityCode);
        handleDPVPVZSelection(chatId, cityName, cityCode);
    }
    else if (data.startsWith('dpd_delivery_courier_')) {
        const parts = data.replace('dpd_delivery_courier_', '').split('_');
        const cityName = parts.slice(0, -1).join('_');
        const cityCode = parts[parts.length - 1];
        
        console.log('🚚 КУРЬЕР:', cityName, cityCode);
        handleCourierDelivery(chatId, cityName, cityCode);
    }
    
    // Выбор конкретного ПВЗ
    else if (data.startsWith('dpd_pvz_')) {
        const parts = data.replace('dpd_pvz_', '').split('_');
        const pvzIndex = parseInt(parts[0]);
        const cityName = parts.slice(1, -1).join('_');
        const cityCode = parts[parts.length - 1];
        
        console.log('✅ ПВЗ ВЫБРАН:', pvzIndex, cityName, cityCode);
        confirmPVZSelection(chatId, pvzIndex, cityName, cityCode);
    }
    
    // Назад к выбору города
    else if (data === 'dpd_back_to_cities' || data === 'back_to_main') {
        startDPDAddressSelection(chatId);
    }
    
    // Назад к выбору доставки
    else if (data.startsWith('dpd_back_to_delivery_')) {
        const parts = data.replace('dpd_back_to_delivery_', '').split('_');
        const cityName = parts.slice(0, -1).join('_');
        const cityCode = parts[parts.length - 1];
        
        handleDPDCityCallback(chatId, cityName, cityCode);
    }
    
    // Изменить адрес
    else if (data === 'dpd_change_address') {
        startDPDAddressSelection(chatId);
    }
    
    // Начать выбор картин
    else if (data === 'start_painting_menu') {
        showPaintingsMenu(chatId);
    }
    
    // Кнопка "Оплатить вручную"
    else if (data.startsWith('manual_pay_')) {
        const orderId = parseInt(data.replace('manual_pay_', ''));
        
        db.get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [orderId, chatId], (err, order) => {
            if (err || !order) {
                bot.sendMessage(chatId, '❌ Заказ не найден или не принадлежит вам.');
                return;
            }
            
            // Используем order_number если есть, иначе id
            const orderDisplay = order.order_number || order.id;
            
            const message = 
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
                `📞 Вопросы: @FlexyFrameSupport`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '✅ Оплатил(а)', callback_data: `paid_${order.id}` }],
                    [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
                ]
            };
            
            bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        });
    }
});

// === УВЕДОМЛЕНИЕ ОБ ОПЛАТЕ АДМИНИСТРАТОРУ ===
function notifyAdminPayment(orderId, chatId, order) {
    if (!ADMIN_CHAT_ID || ADMIN_CHAT_ID === 'your_admin_id') {
        console.log('ℹ️ Админ-чат не настроен');
        return;
    }

    // Используем order_number если есть, иначе id
    const orderDisplay = order.order_number || order.id;
    
    const message = 
        `💰 <b>Оплата подтверждена!</b>\n\n` +
        `Заказ #${orderDisplay}\n` +
        `👤 Пользователь: ID ${chatId}\n` +
        `🎨 ${order.painting_title}\n` +
        `💰 ${order.price}₽\n` +
        `📊 Статус: Оплачен\n\n` +
        `🎫 Тикет поддержки создан автоматически`;

    bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' })
        .then(() => {
            console.log('✅ Уведомление об оплате администратору отправлено');
            createSupportTicket(orderId, chatId, order.painting_title);
        })
        .catch(err => console.log('⚠️ Ошибка отправки уведомления об оплате:', err.message));
}

// === АВТОМАТИЧЕСКАЯ ОТМЕНА ПРОСРОЧЕННЫХ ЗАКАЗОВ ===
// Эта функция отменяет заказы, которые не были оплачены в течение 15 минут.
// Важно: если заказ отменён по таймауту, то событие payment.canceled от Юкассы
// не будет получено, потому что платеж в Юкассе не был создан.
// Это нормальное поведение, когда пользователь не оплатил заказ вовремя.
async function checkExpiredOrders() {
    const now = Date.now();
    const fifteenMinutes = 15 * 60 * 1000; // 15 минут
    
    db.all(`SELECT * FROM orders WHERE status = 'new' AND created_at < datetime('now', '-15 minutes')`, [], async (err, orders) => {
        if (err) {
            logger.error('Ошибка проверки просроченных заказов', err);
            return;
        }
        
        if (orders.length === 0) {
            return;
        }
        
        logger.info(`Найдено ${orders.length} просроченных заказов`);
        
        for (const order of orders) {
            // Проверяем статус платежа в Юкассе, если заказ имеет payment_id
            if (order.payment_id && yookassa) {
                try {
                    const paymentStatus = await checkPaymentStatus(order.payment_id);
                    logger.info(`Проверка статуса платежа`, { paymentId: order.payment_id, status: paymentStatus.status });
                    
                    // Если оплата прошла или в процессе - не отменяем
                    if (paymentStatus.status === 'succeeded' || paymentStatus.status === 'waiting_for_capture') {
                        logger.info(`Заказ оплачен, пропускаем отмену`, { orderId: order.id, orderNumber: order.order_number });
                        continue;
                    }
                    
                    // Если платеж отменен - обновляем статус
                    if (paymentStatus.status === 'canceled') {
                        logger.warn(`Платеж отменен в Юкассе`, { orderId: order.id, orderNumber: order.order_number });
                        db.run(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [order.id]);
                        continue;
                    }
                    
                    // Если платеж истек - отменяем заказ
                    if (paymentStatus.status === 'expired') {
                        logger.warn(`Платеж истек в Юкассе`, { orderId: order.id, orderNumber: order.order_number });
                        // Отменяем в Юкассе
                        try {
                            await yookassa.cancelPayment(order.payment_id);
                            logger.info(`Платеж отменён в Юкассе`, { paymentId: order.payment_id });
                        } catch (e) {
                            logger.warn(`Не удалось отменить платеж в Юкассе`, { error: e.message });
                        }
                    }
                } catch (error) {
                    logger.error(`Ошибка проверки платежа`, { paymentId: order.payment_id, error: error.message });
                }
            }
            
            // Обновляем статус на expired
            db.run(`UPDATE orders SET status = 'expired' WHERE id = ?`, [order.id], function(err) {
                if (err) {
                    logger.error(`Ошибка обновления статуса заказа`, { orderId: order.id, error: err.message });
                    return;
                }
                
                if (this.changes > 0) {
                    logger.logAutoCancellation(order.id, order.order_number, 'Просрочен');
                    
                    // Используем order_number если есть, иначе id
                    const orderDisplay = order.order_number || order.id;
                    
                    // Уведомляем пользователя
                    bot.sendMessage(order.user_id, 
                        `⏰ <b>Заказ #${orderDisplay} автоматически отменен!</b>\n\n` +
                        `Ссылка на оплату истекла (15 минут).\n` +
                        `Если вы все еще хотите оформить заказ, создайте новый.\n\n` +
                        `🎨 ${order.painting_title}\n` +
                        `💰 ${order.price}₽`,
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                    
                    // Уведомляем администратора
                    if (ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id') {
                        bot.sendMessage(ADMIN_CHAT_ID, 
                            `⏰ <b>Заказ #${orderDisplay} автоматически отменен (просрочен)</b>\n\n` +
                            `👤 Пользователь: ID ${order.user_id}\n` +
                            `🎨 Картина: ${order.painting_title}\n` +
                            `💰 Сумма: ${order.price}₽\n` +
                            `⏰ Время создания: ${new Date(order.created_at).toLocaleString('ru-RU')}`,
                            { parse_mode: 'HTML' }
                        ).catch(() => {});
                    }
                }
            });
        }
    });
}

// Запуск проверки просроченных заказов каждую минуту
setInterval(checkExpiredOrders, 60000);
console.log('✅ Автоматическая отмена просроченных заказов активирована (каждую минуту)');

// === ПЕРИОДИЧЕСКАЯ ОЧИСТКА СТАРЫХ ЗАПИСЕЙ ===
function cleanupOldRecords() {
    // Архивируем заказы старше 30 дней в таблицу orders_archive
    db.run(`CREATE TABLE IF NOT EXISTS orders_archive AS SELECT * FROM orders WHERE 1=0`, [], function(err) {
        if (err) {
            console.error('❌ Ошибка создания таблицы архива:', err);
            return;
        }
        
        // Копируем старые заказы в архив
        db.run(`INSERT INTO orders_archive SELECT * FROM orders WHERE created_at < datetime('now', '-30 days')`, [], function(err) {
            if (err) {
                console.error('❌ Ошибка архивирования заказов:', err);
                return;
            }
            
            if (this.changes > 0) {
                console.log(`📦 Заархивировано ${this.changes} старых заказов (старше 30 дней)`);
                
                // Удаляем из основной таблицы
                db.run(`DELETE FROM orders WHERE created_at < datetime('now', '-30 days')`, [], function(err) {
                    if (err) {
                        console.error('❌ Ошибка удаления старых заказов:', err);
                        return;
                    }
                    
                    if (this.changes > 0) {
                        console.log(`🗑️ Удалено ${this.changes} старых заказов из основной таблицы`);
                    }
                });
            }
        });
    });
    
    // Удаляем сессии старше 24 часов
    db.run(`DELETE FROM sessions WHERE updated_at < datetime('now', '-24 hours')`, [], function(err) {
        if (err) {
            console.error('❌ Ошибка очистки старых сессий:', err);
            return;
        }
        
        if (this.changes > 0) {
            console.log(`🗑️ Удалено ${this.changes} старых сессий (старше 24 часов)`);
        }
    });
}

// Запуск очистки каждые 6 часов
setInterval(cleanupOldRecords, 6 * 60 * 60 * 1000);
console.log('✅ Периодическая очистка старых записей активирована (каждые 6 часов)');

// === СОЗДАНИЕ ТИКЕТА ПОДДЕРЖКИ ===
function createSupportTicket(orderId, userId, paintingTitle) {
    db.run(
        `INSERT INTO tickets (user_id, order_id, status) VALUES (?, ?, 'open')`,
        [userId, orderId],
        function(err) {
            if (err) {
                console.error('❌ Ошибка создания тикета:', err);
                return;
            }

            const ticketId = this.lastID;
            console.log(`✅ Тикет #${ticketId} создан для заказа #${orderId}`);

            // Уведомление пользователю
            bot.sendMessage(userId,
                `🎫 <b>Создан тикет поддержки #${ticketId}</b>\n\n` +
                `💬 Теперь вы можете общаться с нашей командой по поводу заказа #${orderId}\n` +
                `🎨 ${paintingTitle}\n\n` +
                `Для общения используйте бота поддержки: @FlexyFrameSupport\n` +
                `Отправьте /start и выберите тикет #${ticketId}`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
    );
}

// === API ENDPOINTS ===

// Статус заказа
app.get('/api/order/:id/status', (req, res) => {
    const orderId = req.params.id;
    db.get('SELECT status FROM orders WHERE id = ?', [orderId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Order not found' });
        res.json({ status: row.status });
    });
});

// Информация о заказе
app.get('/api/order/:id', (req, res) => {
    const orderId = req.params.id;
    db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Order not found' });
        res.json(row);
    });
});

// Создание заказа через API
app.post('/api/order/create', express.json(), (req, res) => {
    const { user_id, painting_id, painting_title, price } = req.body;
    
    if (!user_id || !painting_id || !painting_title || !price) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const painting = findPaintingById(painting_id);
    if (!painting) {
        return res.status(404).json({ error: 'Painting not found' });
    }
    
    const token = crypto.randomBytes(8).toString('hex');
    
    // Получаем следующий номер заказа
    getNextOrderNumber((orderNumber) => {
        if (!orderNumber) {
            return res.status(500).json({ error: 'Failed to generate order number' });
        }
        
        db.run(
            `INSERT INTO orders (order_number, user_id, painting_id, painting_title, price, status, token) VALUES (?, ?, ?, ?, ?, 'new', ?)`,
            [orderNumber, user_id, painting_id, painting_title, price, token],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                
                const orderId = this.lastID;
                
                res.json({
                    success: true,
                    order_id: orderId,
                    order_number: orderNumber,
                    token: token
                });
                
                // Уведомляем администратора
                notifyAdmin(orderId, orderNumber, user_id, painting, token);
            }
        );
    });
});

// Обновление статуса оплаты через API
app.post('/api/order/:id/paid', (req, res) => {
    const orderId = req.params.id;
    
    db.run(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ success: true, message: 'Order marked as paid' });
        
        // Уведомляем администратора
        db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
            if (order) {
                notifyAdminPayment(orderId, order.user_id, order);
            }
        });
    });
});

// Список картин
app.get('/api/paintings', (req, res) => {
    res.json(paintings);
});

// Статус бота
app.get('/api/bot-status', (req, res) => {
    res.json({ 
        online: true, 
        bot_username: '@flexyframe_bot',
        miniapp_url: `${SITE_URL}/index.html`
    });
});

// === DPD API ENDPOINTS ===

// Получить список ПВЗ для карты
app.get('/api/dpd/pickup-points', async (req, res) => {
    const { city } = req.query;
    
    if (!city) {
        return res.json({ error: true, message: 'Укажите город' });
    }
    
    try {
        // Используем DPD интеграцию
        const pickupPointsResult = await dpd.getPickupPoints(city);
        
        // Проверяем на ошибку
        if (pickupPointsResult && pickupPointsResult.error) {
            return res.json({ error: true, message: pickupPointsResult.message });
        }
        
        // Проверяем, что получили массив
        const pickupPoints = Array.isArray(pickupPointsResult) ? pickupPointsResult : [];
        
        // Форматируем для карты
        const formattedPoints = pickupPoints.map(point => ({
            id: point.id,
            name: point.name,
            address: point.address,
            schedule: point.schedule,
            lat: point.coordinates?.latitude,
            lon: point.coordinates?.longitude,
            type: point.type
        })).filter(p => p.lat && p.lon); // Только с координатами
        
        res.json({ points: formattedPoints });
    } catch (error) {
        console.error('Ошибка получения ПВЗ:', error);
        res.json({ error: true, message: 'Ошибка получения данных' });
    }
});

// Вебхук для получения уведомлений от Юкассы
app.post('/api/webhook/yookassa', express.json(), (req, res) => {
    const event = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    
    console.log('🔔 Получен вебхук от Юкассы:', event);
    logger.info('Получен вебхук от Юкассы', { 
        event: event.event, 
        paymentId: event.object?.id,
        clientIP: clientIP 
    });
    
    // Проверка IP-адреса
    try {
        const { YooKassaIPValidator } = require('./check_yookassa_ips');
        const validator = new YooKassaIPValidator();
        
        if (!validator.isValid(clientIP)) {
            logger.warn('⚠️ Попытка доступа с непроверенного IP', { 
                ip: clientIP,
                event: event.event 
            });
            console.log(`❌ Доступ запрещен: IP ${clientIP} не доверенный`);
            return res.status(403).json({ 
                error: 'Access denied',
                message: 'IP address not trusted'
            });
        }
        
        console.log(`✅ IP ${clientIP} прошел проверку доверенности`);
    } catch (error) {
        console.error('❌ Ошибка проверки IP:', error.message);
        logger.error('Ошибка проверки IP-адреса', { ip: clientIP, error: error.message });
        // Продолжаем обработку, если проверка не удалась
    }
    
    // Проверяем тип события
    if (event.event === 'payment.succeeded') {
        const payment = event.object;
        const orderId = payment.metadata?.order_id;
        
        if (orderId) {
            // Обновляем статус заказа
            db.run(`UPDATE orders SET status = 'paid', payment_id = ? WHERE id = ?`, [payment.id, orderId], function(err) {
                if (err) {
                    console.error('❌ Ошибка обновления статуса заказа:', err);
                    return res.status(500).json({ error: err.message });
                }
                
                if (this.changes > 0) {
                    console.log(`✅ Заказ #${orderId} автоматически оплачен через Юкассу`);
                    
                    // Получаем информацию о заказе для уведомления
                    db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
                        if (order) {
                            // Используем order_number если есть, иначе id
                            const orderDisplay = order.order_number || order.id;
                            
                            // Уведомляем пользователя
                            bot.sendMessage(order.user_id, 
                                `✅ <b>Заказ #${orderDisplay} оплачен через ЮКассу!</b>\n\n` +
                                `Мы получили подтверждение и начали работу.\n` +
                                `Срок выполнения: 2-4 дня.\n\n` +
                                `📞 Следить за статусом можно в разделе "Мои заказы".\n` +
                                `💬 Вопросы: @FlexyFrameSupport`,
                                { parse_mode: 'HTML' }
                            ).catch(() => {});
                            
                            // Уведомляем администратора
                            notifyAdminPayment(orderId, order.user_id, order);
                        }
                    });
                }
            });
        }
    } else if (event.event === 'payment.canceled') {
        const payment = event.object;
        const orderId = payment.metadata?.order_id;
        
        logger.info('Получено событие payment.canceled', { 
            paymentId: payment.id, 
            orderId: orderId,
            status: payment.status 
        });
        
        if (orderId) {
            // Обновляем статус заказа на отменен
            db.run(`UPDATE orders SET status = 'cancelled', payment_id = ? WHERE id = ?`, [payment.id, orderId], function(err) {
                if (err) {
                    console.error('❌ Ошибка обновления статуса заказа:', err);
                    logger.error('Ошибка обновления статуса заказа при отмене', { orderId: orderId, error: err.message });
                    return res.status(500).json({ error: err.message });
                }
                
                if (this.changes > 0) {
                    console.log(`❌ Заказ #${orderId} отменен (отказ от оплаты)`);
                    logger.info('Заказ отменен через вебхук Юкассы', { orderId: orderId });
                    
                    // Получаем информацию о заказе для уведомления
                    db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
                        if (order) {
                            // Используем order_number если есть, иначе id
                            const orderDisplay = order.order_number || order.id;
                            
                            // Уведомляем пользователя
                            bot.sendMessage(order.user_id, 
                                `❌ <b>Заказ #${orderDisplay} отменен!</b>\n\n` +
                                `Вы отказались от оплаты.\n` +
                                `Если передумали, можете создать новый заказ.`,
                                { parse_mode: 'HTML' }
                            ).catch(() => {});
                            
                            // Уведомляем администратора
                            if (ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id') {
                                bot.sendMessage(ADMIN_CHAT_ID, 
                                    `❌ <b>Заказ #${orderDisplay} отменен (отказ от оплаты)</b>\n\n` +
                                    `👤 Пользователь: ID ${order.user_id}\n` +
                                    `🎨 Картина: ${order.painting_title}\n` +
                                    `💰 Сумма: ${order.price}₽`,
                                    { parse_mode: 'HTML' }
                                ).catch(() => {});
                            }
                        }
                    });
                } else {
                    logger.warn('Заказ не найден или уже имеет статус cancelled', { orderId: orderId });
                }
            });
        } else {
            logger.warn('В событии payment.canceled отсутствует order_id', { paymentId: payment.id });
        }
    } else if (event.event === 'payment.waiting_for_capture') {
        const payment = event.object;
        const orderId = payment.metadata?.order_id;
        
        logger.info('Получено событие payment.waiting_for_capture', { 
            paymentId: payment.id, 
            orderId: orderId 
        });
        
        if (orderId) {
            console.log(`⏳ Заказ #${orderId} ожидает подтверждения`);
            
            // Получаем информацию о заказе для уведомления
            db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
                if (order) {
                    // Используем order_number если есть, иначе id
                    const orderDisplay = order.order_number || order.id;
                    
                    // Уведомляем администратора
                    if (ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id') {
                        bot.sendMessage(ADMIN_CHAT_ID, 
                            `⏳ <b>Заказ #${orderDisplay} ожидает подтверждения</b>\n\n` +
                            `👤 Пользователь: ID ${order.user_id}\n` +
                            `🎨 Картина: ${order.painting_title}\n` +
                            `💰 Сумма: ${order.price}₽\n` +
                            `🔗 Ссылка на оплату: ${payment.confirmation.confirmation_url}`,
                            { parse_mode: 'HTML' }
                        ).catch(() => {});
                    }
                }
            });
        }
    } else if (event.event === 'payment.expired') {
        const payment = event.object;
        const orderId = payment.metadata?.order_id;
        
        logger.info('Получено событие payment.expired', { 
            paymentId: payment.id, 
            orderId: orderId 
        });
        
        if (orderId) {
            console.log(`⏰ Заказ #${orderId} - срок действия ссылки на оплату истек`);
            
            // Обновляем статус заказа на expired
            db.run(`UPDATE orders SET status = 'expired', payment_id = ? WHERE id = ?`, [payment.id, orderId], function(err) {
                if (err) {
                    console.error('❌ Ошибка обновления статуса заказа:', err);
                    logger.error('Ошибка обновления статуса заказа при истечении срока', { orderId: orderId, error: err.message });
                    return res.status(500).json({ error: err.message });
                }
                
                if (this.changes > 0) {
                    console.log(`⏰ Заказ #${orderId} автоматически отменен (истек срок оплаты)`);
                    logger.info('Заказ отменен по истечении срока оплаты', { orderId: orderId });
                    
                    // Получаем информацию о заказе для уведомления
                    db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
                        if (order) {
                            // Используем order_number если есть, иначе id
                            const orderDisplay = order.order_number || order.id;
                            
                            // Уведомляем пользователя
                            bot.sendMessage(order.user_id, 
                                `⏰ <b>Заказ #${orderDisplay} автоматически отменен!</b>\n\n` +
                                `Ссылка на оплату истекла.\n` +
                                `Если вы все еще хотите оформить заказ, создайте новый.\n\n` +
                                `🎨 ${order.painting_title}\n` +
                                `💰 ${order.price}₽`,
                                { parse_mode: 'HTML' }
                            ).catch(() => {});
                            
                            // Уведомляем администратора
                            if (ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id') {
                                bot.sendMessage(ADMIN_CHAT_ID, 
                                    `⏰ <b>Заказ #${orderDisplay} автоматически отменен (истек срок оплаты)</b>\n\n` +
                                    `👤 Пользователь: ID ${order.user_id}\n` +
                                    `🎨 Картина: ${order.painting_title}\n` +
                                    `💰 Сумма: ${order.price}₽\n` +
                                    `⏰ Время создания: ${new Date(order.created_at).toLocaleString('ru-RU')}`,
                                    { parse_mode: 'HTML' }
                                ).catch(() => {});
                            }
                        }
                    });
                } else {
                    logger.warn('Заказ не найден или уже имеет статус expired', { orderId: orderId });
                }
            });
        } else {
            logger.warn('В событии payment.expired отсутствует order_id', { paymentId: payment.id });
        }
    }

    res.json({ success: true });
});

// === СТАТИЧЕСКИЕ ФАЙЛЫ ===
app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// === ЗАПУСК СЕРВЕРА ===
app.listen(PORT, () => {
    console.log('🌐 Веб-сервер запущен на порту', PORT);
    console.log('🔗 Доступно: http://127.0.0.1:' + PORT);
});

// === ОБРАБОТКА ОШИБОК ===
bot.on('polling_error', (error) => {
    console.error('Ошибка поллинга:', error.message);
});

bot.on('webhook_error', (error) => {
    console.error('Ошибка вебхука:', error.message);
});

// === УСТАНОВКА КНОПКИ MINIAPP ===
function setupMiniAppButton() {
    const menuButton = {
        type: 'web_app',
        text: '🎨 FlexyFrame',
        web_app: {
            url: `${SITE_URL}/index.html`
        }
    };

    bot.setChatMenuButton({ menu_button: menuButton })
        .then(() => {
            console.log('✅ Кнопка MiniApp установлена в чате');
        })
        .catch(err => {
            console.error('❌ Ошибка установки кнопки MiniApp:', err.message);
        });
}

// === DPD ФУНКЦИИ ===

// === ПРОВЕРКА DPD ===
function isDPDUnavailable(result) {
    return result && result.error === true;
}

function getDPDErrorMessage(result) {
    return result?.message || 'Технические неполадки. Попробуйте позже.';
}

// === НАЧАТЬ ВЫБОР АДРЕСА DPD ===
async function startDPDAddressSelection(chatId) {
    // Проверяем доступность DPD
    if (!dpd.isDPDConfigured()) {
        bot.sendMessage(chatId, 
            `📦 <b>Доставка DPD временно недоступна</b>\n\n` +
            `⚠️ Технические неполадки с сервисом доставки.\n\n` +
            `📬 <b>Для оформления заказа свяжитесь с нами:</b>\n` +
            `📞 @FlexyFrameSupport\n\n` +
            `💡 Или выберите <b>Самовывоз</b> в Томске:\n` +
            `📍 г. Томск, ул. Учебная, 2/2`,
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    setUserState(chatId, 'dpd_selecting_city');
    
    // Пытаемся получить список городов
    const citiesResult = await dpd.searchCities('');
    
    // Проверяем на ошибку
    if (isDPDUnavailable(citiesResult)) {
        bot.sendMessage(chatId, 
            `⚠️ <b>Технические неполадки</b>\n\n` +
            `Не удалось загрузить список городов.\n` +
            `Попробуйте позже или свяжитесь с поддержкой @FlexyFrameSupport`,
            { parse_mode: 'HTML' }
        );
        clearUserState(chatId);
        return;
    }
    
    // Проверяем, что получили массив
    const cities = Array.isArray(citiesResult) ? citiesResult : [];
    
    if (cities.length === 0) {
        bot.sendMessage(chatId, 
            `⚠️ <b>Технические неполадки</b>\n\n` +
            `Список городов недоступен.\n` +
            `Свяжитесь с поддержкой: @FlexyFrameSupport`,
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    const popularCities = cities.slice(0, 10);
    
    const message = 
        `📍 <b>Выбор адреса доставки DPD</b>\n\n` +
        `🚚 <b>Доставка по всей России</b>\n\n` +
        `Выберите город из списка:\n`;
    
    // Создаём inline клавиатуру с городами
    const keyboard = {
        inline_keyboard: []
    };
    
    // Добавляем города по 2 в ряд
    for (let i = 0; i < popularCities.length; i += 2) {
        const row = [];
        row.push({ text: popularCities[i].name, callback_data: `dpd_city_${popularCities[i].name}_${popularCities[i].code || ''}` });
        
        if (i + 1 < popularCities.length) {
            row.push({ text: popularCities[i + 1].name, callback_data: `dpd_city_${popularCities[i + 1].name}_${popularCities[i + 1].code || ''}` });
        }
        
        keyboard.inline_keyboard.push(row);
    }
    
    keyboard.inline_keyboard.push([{ text: '🔙 Назад в меню', callback_data: 'back_to_main' }]);
    
    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
}

// === ОБРАБОТКА ВЫБОРА ГОРОДА ЧЕРЕЗ CALLBACK ===
async function handleDPDCityCallback(chatId, cityName, cityCode) {
    // Сохраняем город в сессии
    setUserState(chatId, 'dpd_selecting_delivery_type', {
        city: cityName,
        cityCode: cityCode,
        region: ''
    });
    
    // Показываем выбор типа доставки
    const message = 
        `🏙️ <b>${cityName}</b>\n\n` +
        `📦 <b>Выберите способ доставки:</b>\n\n` +
        `1️⃣ <b>Самовывоз из ПВЗ</b>\n` +
        `   📍 Пункт выдачи в вашем городе\n\n` +
        `2️⃣ <b>Курьерская доставка</b>\n` +
        `   🚚 Доставка до двери\n\n` +
        `💡 <i>Стоимость будет рассчитана при оформлении заказа</i>`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '📍 Выбрать ПВЗ на карте', web_app: { url: `${SITE_URL}/dpd-widget.html?city=${encodeURIComponent(cityName)}` } }],
            [{ text: '📦 Список ПВЗ', callback_data: `dpd_delivery_pvz_${cityName}_${cityCode}` }],
            [{ text: '🚚 Курьерская доставка', callback_data: `dpd_delivery_courier_${cityName}_${cityCode}` }],
            [{ text: '🔙 Назад к выбору города', callback_data: 'dpd_back_to_cities' }]
        ]
    };
    
    // Удаляем предыдущее сообщение
    bot.editMessageText(message, {
        chat_id: chatId,
        parse_mode: 'HTML',
        reply_markup: keyboard
    }).catch(() => {
        bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    });
}

// === ОБРАБОТКА ВЫБОРА ПВЗ ===
async function handleDPVPVZSelection(chatId, cityName, cityCode) {
    bot.sendChatAction(chatId, 'typing');
    
    // Получаем список ПВЗ
    const pickupPointsResult = await dpd.getPickupPoints(cityCode || cityName);
    
    // Проверяем на ошибку
    if (isDPDUnavailable(pickupPointsResult)) {
        bot.sendMessage(chatId, 
            `⚠️ <b>Технические неполадки</b>\n\n` +
            `${getDPDErrorMessage(pickupPointsResult)}\n\n` +
            `Попробуйте выбрать <b>Курьерскую доставку</b>.`,
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    const pickupPoints = Array.isArray(pickupPointsResult) ? pickupPointsResult : [];
    
    if (pickupPoints.length === 0) {
        bot.sendMessage(chatId, 
            `📭 В городе ${cityName} нет пунктов выдачи DPD.\n\n` +
            `Попробуйте выбрать <b>Курьерскую доставку</b>.`,
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    let message = `📦 <b>Пункты выдачи заказов в ${cityName}</b>\n\n`;
    message += `Выберите удобный пункт:\n\n`;
    
    const displayPoints = pickupPoints.slice(0, 10);
    
    const keyboard = {
        inline_keyboard: []
    };
    
    displayPoints.forEach((point, index) => {
        const shortName = point.name.length > 30 ? point.name.substring(0, 27) + '...' : point.name;
        message += `${index + 1}. <b>${point.name}</b>\n`;
        
        const shortAddress = point.address.length > 40 ? point.address.substring(0, 37) + '...' : point.address;
        message += `   📍 ${shortAddress}\n`;
        message += `   ⏰ ${point.schedule || 'Уточняйте'}\n\n`;
        
        keyboard.inline_keyboard.push([{
            text: `${index + 1}. ${point.type === 'П' ? '📮' : '📦'} ${shortName}`,
            callback_data: `dpd_pvz_${index}_${cityName}_${cityCode}`
        }]);
    });
    
    if (pickupPoints.length > 10) {
        message += `\n📝 Показаны первые 10 из ${pickupPoints.length} пунктов`;
    }
    
    keyboard.inline_keyboard.push([{ text: '🔙 Назад', callback_data: `dpd_back_to_delivery_${cityName}_${cityCode}` }]);
    
    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
}

// === ПОДТВЕРЖДЕНИЕ ВЫБОРА ПВЗ ===
function confirmPVZSelection(chatId, pvzIndex, cityName, cityCode) {
    const message = 
        `✅ <b>Адрес доставки выбран!</b>\n\n` +
        `📦 <b>Самовывоз из ПВЗ</b>\n\n` +
        `🏙️ Город: ${cityName}\n\n` +
        `📝 Адрес и расписание будут показаны при оформлении заказа.\n\n` +
        `Стоимость доставки рассчитывается индивидуально.`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🎨 Выбрать картину', callback_data: 'start_painting_menu' }],
            [{ text: '📍 Изменить адрес', callback_data: 'dpd_change_address' }]
        ]
    };
    
    const addressData = {
        type: 'pickup',
        city: cityName,
        pvzIndex: pvzIndex,
        deliveryType: 'pvz'
    };
    saveUserDeliveryAddress(chatId, addressData);
    
    clearUserState(chatId);
    
    bot.editMessageText(message, {
        chat_id: chatId,
        parse_mode: 'HTML',
        reply_markup: keyboard
    }).catch(() => {
        bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    });
}

// === ОБРАБОТКА КУРЬЕРСКОЙ ДОСТАВКИ ===
function handleCourierDelivery(chatId, cityName, cityCode) {
    setUserState(chatId, 'dpd_entering_address', {
        city: cityName,
        cityCode: cityCode,
        deliveryType: 'courier'
    });
    
    const message = 
        `🚚 <b>Курьерская доставка в ${cityName}</b>\n\n` +
        `📝 <b>Введите адрес доставки:</b>\n\n` +
        `📍 <b>Пример:</b>\n` +
        `ул. Ленина, 10, 25\n\n` +
        `Или только улицу и дом:\n` +
        `Кирова 15\n\n` +
        `💡 <i>Курьер свяжется с вами перед доставкой</i>`;
    
    const keyboard = {
        keyboard: [
            [{ text: '🔙 Назад' }]
        ],
        resize_keyboard: true
    };
    
    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
}

// === ОБРАБОТКА ВВОДА АДРЕСА ДЛЯ КУРЬЕРСКОЙ ДОСТАВКИ ===
function handleDPDAddressInput(chatId, text, session) {
    const city = session.data.city;
    
    const addressData = {
        type: 'courier',
        city: city,
        address: text,
        deliveryType: 'courier'
    };
    
    const message = 
        `✅ <b>Адрес доставки сохранён!</b>\n\n` +
        `🚚 <b>Курьерская доставка</b>\n\n` +
        `🏙️ Город: ${city}\n` +
        `📍 Адрес: ${text}\n\n` +
        `📝 Стоимость и срок доставки будут рассчитаны при оформлении заказа.\n\n` +
        `Курьер свяжется с вами перед доставкой.`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🎨 Выбрать картину', callback_data: 'start_painting_menu' }],
            [{ text: '📍 Изменить адрес', callback_data: 'dpd_change_address' }]
        ]
    };
    
    saveUserDeliveryAddress(chatId, addressData);
    clearUserState(chatId);
    
    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
    });
}

// === ЛЕГАСИ ФУНКЦИИ (для совместимости) ===

// Обработка выбора города (старый формат)
function handleDPDCitySelection(chatId, text, session) {
    // Просто перенаправляем на startDPDAddressSelection
    startDPDAddressSelection(chatId);
}

// Обработка выбора типа доставки (старый формат)
function handleDPDDeliveryTypeSelection(chatId, text, session) {
    const city = session.data.city;
    const cityCode = session.data.cityCode;
    
    if (text === '📦 Самовывоз из ПВЗ') {
        handleDPVPVZSelection(chatId, city, cityCode);
    } else if (text === '🚚 Курьерская доставка') {
        handleCourierDelivery(chatId, city, cityCode);
    }
}

// === СОХРАНЕНИЕ АДРЕСА ДОСТАВКИ ПОЛЬЗОВАТЕЛЯ ===
function saveUserDeliveryAddress(chatId, addressData) {
    // Создаём таблицу если не существует
    db.run(`CREATE TABLE IF NOT EXISTS user_delivery_addresses (
        user_id INTEGER PRIMARY KEY,
        address_data TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, [], function(err) {
        if (err) {
            console.error('❌ Ошибка создания таблицы адресов:', err);
            return;
        }
        
        // Сохраняем адрес
        db.run(
            `INSERT OR REPLACE INTO user_delivery_addresses (user_id, address_data) VALUES (?, ?)`,
            [chatId, JSON.stringify(addressData)],
            function(err) {
                if (err) {
                    console.error('❌ Ошибка сохранения адреса:', err);
                } else {
                    console.log('✅ Адрес доставки сохранён для пользователя:', chatId);
                }
            }
        );
    });
}

// === ПОЛУЧИТЬ СОХРАНЁННЫЙ АДРЕС ПОЛЬЗОВАТЕЛЯ ===
function getUserDeliveryAddress(chatId, callback) {
    db.get(`SELECT address_data FROM user_delivery_addresses WHERE user_id = ?`, [chatId], (err, row) => {
        if (err || !row) {
            callback(null);
            return;
        }
        
        try {
            const addressData = JSON.parse(row.address_data);
            callback(addressData);
        } catch (e) {
            console.error('❌ Ошибка парсинга адреса:', e);
            callback(null);
        }
    });
}

// === ЗАПУСК БОТА ===
console.log('🚀 FlexyFrame Bot запущен!');
console.log('📱 Бот: @flexyframe_bot');
console.log('🔑 Токен:', TOKEN.substring(0, 10) + '...');
console.log('🌐 Сайт:', `${SITE_URL}/index.html`);
console.log('📊 Администратор:', ADMIN_CHAT_ID);

// Вызываем установку кнопки MiniApp после запуска бота
setupMiniAppButton();
