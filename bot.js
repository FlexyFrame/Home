const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const YooKassa = require('yookassa');
require('dotenv').config();

// === КОНФИГУРАЦИЯ ===
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'your_admin_id';
const SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8080';
const PORT = process.env.PORT || 3000;

// === YOOKASSA КОНФИГУРАЦИЯ ===
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

// Инициализация YooKassa (продакшен)
let yookassa = null;
if (YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY && YOOKASSA_SHOP_ID !== 'your_shop_id') {
    yookassa = new YooKassa({
        shopId: YOOKASSA_SHOP_ID,
        secretKey: YOOKASSA_SECRET_KEY
    });
    console.log('✅ YooKassa (продакшен) инициализирована');
} else {
    console.log('❌ YooKassa не настроена! Пожалуйста, укажите YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env');
    console.log('⚠️ Бот не сможет создавать платежи без настройки YooKassa');
}

// Валидация токена
if (!TOKEN || TOKEN === 'your_token_here') {
    console.error('❌ Ошибка: TELEGRAM_BOT_TOKEN не установлен в .env');
    console.error('Пожалуйста, создайте .env файл с правильным токеном');
    process.exit(1);
}

// === ИМПОРТ ДАННЫХ ===
const { paintings, getPaintingImagePath, findPaintingById, findPaintingByTitle } = require('./data.js');

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
            user_id INTEGER,
            user_name TEXT,
            painting_id INTEGER,
            painting_title TEXT,
            price INTEGER,
            status TEXT DEFAULT 'new',
            payment_id TEXT,
            token TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
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

// === ГЛАВНОЕ МЕНЮ ===
function showMainMenu(chatId, firstName = 'пользователь') {
    const keyboard = {
        keyboard: [
            [{ text: '🎨 Выбрать картину' }],
            [{ text: '🛒 Открыть сайт' }],
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

// === СОЗДАНИЕ ЗАКАЗА С YOOKASSA ===
async function createOrder(chatId, painting, token = null) {
    const orderToken = token || crypto.randomBytes(8).toString('hex');
    
    // Создаем заказ в базе данных
    db.run(
        `INSERT INTO orders (user_id, painting_id, painting_title, price, status, token) VALUES (?, ?, ?, ?, 'new', ?)`,
        [chatId, painting.id, painting.title, painting.price, orderToken],
        async function(err) {
            if (err) {
                console.error('❌ Ошибка создания заказа:', err);
                bot.sendMessage(chatId, '❌ Произошла ошибка при создании заказа. Попробуйте позже.');
                return;
            }
            
            const orderId = this.lastID;
            console.log('✅ Заказ создан в БД, ID:', orderId);
            
            // Создаем платеж в YooKassa (если настроена)
            let paymentUrl = null;
            
            if (yookassa) {
                // Продакшен оплата через YooKassa
                try {
                    const payment = await yookassa.createPayment({
                        amount: {
                            value: painting.price.toFixed(2),
                            currency: 'RUB'
                        },
                        confirmation: {
                            type: 'redirect',
                            return_url: `${SITE_URL}/index.html`
                        },
                        capture: true,
                        description: `Заказ #${orderId} - ${painting.title}`,
                        metadata: {
                            order_id: orderId,
                            user_id: chatId,
                            painting_id: painting.id
                        }
                    });
                    
                    paymentUrl = payment.confirmation.confirmation_url;
                    console.log('✅ Платеж создан:', payment.id, paymentUrl);
                    
                    // Сохраняем ID платежа в БД
                    db.run(`UPDATE orders SET payment_id = ? WHERE id = ?`, [payment.id, orderId]);
                    
                } catch (error) {
                    console.error('❌ Ошибка создания платежа YooKassa:', error);
                }
            }
            
            showOrderInfo(chatId, { id: orderId, ...painting, token: orderToken, status: 'new' }, painting, paymentUrl);
            notifyAdmin(orderId, chatId, painting, orderToken);
        }
    );
}

// === ПОКАЗАТЬ ИНФОРМАЦИЮ О ЗАКАЗЕ ===
function showOrderInfo(chatId, order, painting, paymentUrl = null, paymentSystem = 'yookassa') {
    const imagePath = getPaintingImagePath(painting);
    const fs = require('fs');
    
    console.log('📸 ПОДГОТОВКА К ОТПРАВКЕ ФОТО:', {
        chatId,
        orderId: order.id,
        paintingTitle: painting.title,
        imagePath,
        fileExists: fs.existsSync(imagePath),
        paymentSystem
    });
    
    let message = 
        `✅ <b>Заказ #${order.id} создан!</b>\n\n` +
        `🎨 Картина: <b>${painting.title}</b>\n` +
        `💰 Сумма: <b>${painting.price}₽</b>\n` +
        `📦 Срок выполнения: 2-4 дня\n` +
        `📊 Статус: ${getStatusEmoji(order.status)} ${getStatusText(order.status)}\n\n`;
    
    let keyboard;
    
    // ВСЕГДА добавляем кнопки оплаты
    if (paymentUrl) {
        if (paymentSystem === 'test_yookassa') {
            // Тестовая оплата
            message += `💳 <b>Для ТЕСТОВОЙ оплаты:</b>\n` +
                       `• Перейдите по ссылке ниже\n` +
                       `• Оплатите удобным способом\n` +
                       `• Это тестовый платеж!\n\n` +
                       `🔑 Токен: <code>${order.token}</code>`;
            
            keyboard = {
                inline_keyboard: [
                    [{ text: '💳 Тестовая оплата', url: paymentUrl }]
                ]
            };
        } else {
            // Продакшен оплата
            message += `💳 <b>Для оплаты:</b>\n` +
                       `• Перейдите по ссылке ниже\n` +
                       `• Оплатите удобным способом\n\n` +
                       `🔑 Токен: <code>${order.token}</code>`;
            
            keyboard = {
                inline_keyboard: [
                    [{ text: '💳 Оплатить', url: paymentUrl }]
                ]
            };
        }
    } else {
        // Нет платежной ссылки (ошибка или демо-режим)
        message += `⚠️ <b>Оплата недоступна</b>\n\n` +
                   `Приносим извинения, в данный момент оплата недоступна.\n` +
                   `Пожалуйста, попробуйте позже или свяжитесь с поддержкой.\n\n` +
                   `💰 Сумма: ${painting.price}₽\n\n` +
                   `🔑 Токен: <code>${order.token}</code>`;
        
        keyboard = {
            inline_keyboard: [
                [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
            ]
        };
    }
    
    // ВСЕГДА пытаемся отправить фото
    console.log('📸 ПОПЫТКА ОТПРАВИТЬ ФОТО:', imagePath);
    
    bot.sendPhoto(chatId, imagePath, { 
        caption: message, 
        parse_mode: 'HTML', 
        reply_markup: keyboard 
    }).then(() => {
        console.log('✅ ФОТО ОТПРАВЛЕНО:', order.id);
        setUserState(chatId, 'order_created', { orderId: order.id });
    }).catch((err) => {
        console.log('⚠️ ОШИБКА ОТПРАВКИ ФОТО:', err.message);
        console.log('📤 ПОПЫТКА ОТПРАВИТЬ ТЕКСТОМ...');
        
        // Fallback: если фото не отправилось - текстом
        const textKeyboard = {
            keyboard: [
                [{ text: '❌ Отменить заказ' }],
                [{ text: '📋 Мои заказы' }]
            ],
            resize_keyboard: true
        };
        
        bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: textKeyboard
        }).then(() => {
            console.log('✅ ОРДЕР ОТПРАВЛЕН ТЕКСТОМ:', order.id);
            setUserState(chatId, 'order_created', { orderId: order.id });
        }).catch((err2) => {
            console.log('❌ ОШИБКА ОТПРАВКИ ТЕКСТА:', err2.message);
        });
    });
}

// === УВЕДОМЛЕНИЕ АДМИНИСТРАТОРА ===
function notifyAdmin(orderId, chatId, painting, token) {
    const adminToken = process.env.ADMIN_BOT_TOKEN;
    const adminChatId = process.env.ADMIN_CHAT_ID;
    
    if (!adminToken || !adminChatId || adminChatId === 'your_admin_id') {
        console.log('ℹ️ Админ-бот не настроен, уведомление не отправлено');
        return;
    }
    
    // Получаем информацию о пользователе из БД
    db.get(`SELECT username, first_name FROM users WHERE user_id = ?`, [chatId], (err, user) => {
        if (err) {
            console.log('⚠️ Ошибка получения данных пользователя:', err.message);
            return;
        }
        
        const userName = user ? 
            (user.first_name || user.username || 'Пользователь') : 
            `ID: ${chatId}`;
        
        const userUsername = user ? user.username : null;
        
        const message = 
            `🔔 <b>Новый заказ #${orderId}</b>\n\n` +
            `👤 Пользователь: ${userName}\n` +
            `🆔 ID: ${chatId}\n` +
            (userUsername ? `🔗 Профиль: @${userUsername}\n` : '') +
            `🎨 Картина: ${painting.title}\n` +
            `💰 Сумма: ${painting.price}₽\n` +
            `📊 Статус: Ожидает оплаты\n` +
            `🔑 Токен: ${token}`;
        
        // Создаем отдельного бота для админ-чата
        const adminBot = new TelegramBot(adminToken, { polling: false });
        
        adminBot.sendMessage(adminChatId, message, { parse_mode: 'HTML' })
            .then(() => console.log('✅ Уведомление администратору отправлено'))
            .catch(err => console.log('⚠️ Ошибка отправки админ-уведомления:', err.message));
    });
}

// === УВЕДОМЛЕНИЕ АДМИНИСТРАТОРА ОБ ОПЛАТЕ ===
function notifyAdminPayment(orderId, chatId, order) {
    const adminToken = process.env.ADMIN_BOT_TOKEN;
    const adminChatId = process.env.ADMIN_CHAT_ID;
    
    if (!adminToken || !adminChatId || adminChatId === 'your_admin_id') {
        console.log('ℹ️ Админ-бот не настроен, уведомление не отправлено');
        return;
    }
    
    // Получаем информацию о пользователе из БД
    db.get(`SELECT username, first_name FROM users WHERE user_id = ?`, [chatId], (err, user) => {
        if (err) {
            console.log('⚠️ Ошибка получения данных пользователя:', err.message);
            return;
        }
        
        const userName = user ? 
            (user.first_name || user.username || 'Пользователь') : 
            `ID: ${chatId}`;
        
        const userUsername = user ? user.username : null;
        
        const message = 
            `💰 <b>Оплата получена #${orderId}</b>\n\n` +
            `👤 Пользователь: ${userName}\n` +
            `🆔 ID: ${chatId}\n` +
            (userUsername ? `🔗 Профиль: @${userUsername}\n` : '') +
            `🎨 Картина: ${order.painting_title}\n` +
            `💰 Сумма: ${order.price}₽\n` +
            `📊 Статус: Оплачен, в работе`;
        
        // Создаем отдельного бота для админ-чата
        const adminBot = new TelegramBot(adminToken, { polling: false });
        
        adminBot.sendMessage(adminChatId, message, { parse_mode: 'HTML' })
            .then(() => console.log('✅ Уведомление об оплате администратору отправлено'))
            .catch(err => console.log('⚠️ Ошибка отправки админ-уведомления об оплате:', err.message));
    });
}

// === УВЕДОМЛЕНИЕ АДМИНИСТРАТОРА О ВЫБОРЕ КАРТИНЫ ===
function notifyAdminPaintingSelection(chatId, painting) {
    const adminToken = process.env.ADMIN_BOT_TOKEN;
    const adminChatId = process.env.ADMIN_CHAT_ID;
    
    if (!adminToken || !adminChatId || adminChatId === 'your_admin_id') {
        return; // Админ-бот не настроен
    }
    
    // Получаем информацию о пользователе из БД
    db.get(`SELECT username, first_name FROM users WHERE user_id = ?`, [chatId], (err, user) => {
        if (err) {
            console.log('⚠️ Ошибка получения данных пользователя:', err.message);
            return;
        }
        
        const userName = user ? 
            (user.first_name || user.username || 'Пользователь') : 
            `ID: ${chatId}`;
        
        const message = 
            `🎨 <b>Пользователь выбрал картину</b>\n\n` +
            `👤 Пользователь: ${userName}\n` +
            `🆔 ID: ${chatId}\n` +
            `🎨 Картина: ${painting.title}\n` +
            `💰 Цена: ${painting.price}₽`;
        
        // Создаем отдельного бота для админ-чата
        const adminBot = new TelegramBot(adminToken, { polling: false });
        
        adminBot.sendMessage(adminChatId, message, { parse_mode: 'HTML' })
            .then(() => console.log('✅ Уведомление о выборе картины администратору отправлено'))
            .catch(err => console.log('⚠️ Ошибка отправки админ-уведомления о выборе картины:', err.message));
    });
}

// === ГЕНЕРАЦИЯ ССЫЛКИ НА ОПЛАТУ ===
function generatePaymentLink(orderId, paintingTitle, price) {
    const baseUrl = SITE_URL.endsWith('/') ? SITE_URL.slice(0, -1) : SITE_URL;
    return `${baseUrl}/payment.html?order=${orderId}&title=${encodeURIComponent(paintingTitle)}&price=${price}`;
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
        'cancelled': 'Отменен'
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
            
            // Уведомление администратора о выборе картины (не требуется)
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
                createOrder(chatId, painting, null);
                clearUserState(chatId);
                return;
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
            
            bot.sendMessage(chatId, 
                `❌ <b>Заказ #${orderId} отменен!</b>\n\n` +
                `Если вы передумали, можете создать новый заказ.`,
                { parse_mode: 'HTML' }
            );
            
            // Уведомляем администратора
            if (ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id') {
                bot.sendMessage(ADMIN_CHAT_ID, 
                    `❌ <b>Заказ #${orderId} отменен пользователем!</b>\n\n` +
                    `👤 Пользователь: ${chatId}`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
            
            clearUserState(chatId);
            showMainMenu(chatId, msg.chat.first_name);
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
        `• Email: designstudioflexyframe@gmail.com\n\n` +
        `🔗 <b>Сайт:</b> ${SITE_URL}/index.html\n\n` +
        `💡 <i>FlexyFrame — это не просто картина. Это история, подсвеченная вашим вкусом.</i>`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// === ПОКАЗАТЬ МОИ ЗАКАЗЫ ===
function showMyOrders(chatId) {
    db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`, [chatId], (err, rows) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка при загрузке заказов');
            return;
        }
        
        if (rows.length === 0) {
            bot.sendMessage(chatId, '📭 У вас пока нет заказов. Начните с выбора картины!');
            return;
        }
        
        let message = `📋 <b>Ваши заказы:</b>\n\n`;
        
        rows.forEach(order => {
            message += 
                `#${order.id} - ${getStatusEmoji(order.status)} ${getStatusText(order.status)}\n` +
                `🎨 ${order.painting_title} - ${order.price}₽\n` +
                `📅 ${new Date(order.created_at).toLocaleDateString('ru-RU')}\n` +
                `🔑 Токен: <code>${order.token}</code>\n\n`;
        });
        
        const keyboard = {
            keyboard: [
                [{ text: '🎨 Сделать новый заказ' }]
            ],
            resize_keyboard: true
        };
        
        bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: keyboard });
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
    
    // Кнопка "📋 Мои заказы"
    if (data === 'my_orders') {
        showMyOrders(chatId);
    }
});


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
    
    db.run(
        `INSERT INTO orders (user_id, painting_id, painting_title, price, status, token) VALUES (?, ?, ?, ?, 'new', ?)`,
        [user_id, painting_id, painting_title, price, token],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            const orderId = this.lastID;
            const paymentLink = generatePaymentLink(orderId, painting_title, price);
            
            res.json({
                success: true,
                order_id: orderId,
                payment_link: paymentLink,
                token: token
            });
            
            // Уведомляем администратора
            notifyAdmin(orderId, user_id, painting, token);
        }
    );
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

// === СТАТИЧЕСКИЕ ФАЙЛЫ ===
app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// === ВЕБХУК ДЛЯ ПЛАТЕЖЕЙ ===
app.post('/webhook/payment', express.json(), (req, res) => {
    const { event, object } = req.body;
    
    if (event === 'payment.succeeded') {
        const orderId = object.description?.match(/Заказ #(\d+)/)?.[1];
        if (orderId) {
            db.run(`UPDATE orders SET status = 'paid', payment_id = ? WHERE id = ?`, 
                [object.id, orderId]);
        }
    }
    
    res.status(200).send('OK');
});

// === ЗАПУСК СЕРВЕРОВ ===
// Для GitHub Pages используем порт из переменной окружения
const serverPort = process.env.PORT || 8080;

app.listen(serverPort, () => {
    console.log('🌐 Веб-сервер запущен на порту', serverPort);
    console.log('🔗 Доступно: http://127.0.0.1:' + serverPort);
    console.log('✅ Готово для GitHub Pages');
});

// Вебхук для платежей (объединенный)
app.post('/webhook/payment', express.json(), (req, res) => {
    const { event, object } = req.body;
    
    // Валидация подписи YooKassa
    if (process.env.YOOKASSA_SECRET_KEY && process.env.YOOKASSA_SECRET_KEY !== 'your_secret_key') {
        const signature = req.headers['x-yookassa-signature'];
        const crypto = require('crypto');
        const hash = crypto.createHmac('sha256', process.env.YOOKASSA_SECRET_KEY)
            .update(JSON.stringify(req.body))
            .digest('hex');
        
        if (signature !== hash) {
            console.log('❌ Неверная подпись вебхука');
            return res.status(403).send('Invalid signature');
        }
    }
    
    if (event === 'payment.succeeded') {
        const orderId = object.description?.match(/Заказ #(\d+)/)?.[1];
        if (orderId) {
            db.run(`UPDATE orders SET status = 'paid', payment_id = ? WHERE id = ?`, 
                [object.id, orderId], (err) => {
                    if (err) {
                        console.error('❌ Ошибка обновления статуса:', err);
                    } else {
                        console.log('✅ Платеж подтвержден, заказ #' + orderId);
                        
                        // Уведомление администратора
                        db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
                            if (order) {
                                notifyAdminPayment(orderId, order.user_id, order);
                            }
                        });
                    }
                });
        }
    }
    
    res.status(200).send('OK');
});

// API endpoint для проверки статуса бота (для GitHub Actions)
app.get('/api/bot-status', (req, res) => {
    res.json({ 
        online: true, 
        bot_username: '@flexyframe_bot',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// API endpoint для статистики
app.get('/api/stats', (req, res) => {
    db.get('SELECT COUNT(*) as total_orders FROM orders', (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get('SELECT COUNT(*) as total_users FROM users', (err2, row2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            
            res.json({
                total_orders: row.total_orders,
                total_users: row2.total_users,
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            });
        });
    });
});

// === ОБРАБОТКА ОШИБОК ===
bot.on('polling_error', (error) => {
    console.error('Ошибка поллинга:', error.message);
});

bot.on('webhook_error', (error) => {
    console.error('Ошибка вебхука:', error.message);
});

// === ЗАПУСК БОТА ===
console.log('🚀 FlexyFrame Bot запущен!');
console.log('📱 Бот: @flexyframe_bot');
console.log('🔑 Токен:', TOKEN.substring(0, 10) + '...');
console.log('🌐 Сайт:', `${SITE_URL}/index.html`);
console.log('📊 Администратор:', ADMIN_CHAT_ID);