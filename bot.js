const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// === КОНФИГУРАЦИЯ ===
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'your_admin_id';
const SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8080';
const PORT = process.env.PORT || 3000;

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
    
    db.run(
        `INSERT INTO orders (user_id, painting_id, painting_title, price, status, token) VALUES (?, ?, ?, ?, 'new', ?)`,
        [chatId, painting.id, painting.title, painting.price, orderToken],
        function(err) {
            if (err) {
                console.error('Ошибка создания заказа:', err);
                bot.sendMessage(chatId, '❌ Произошла ошибка при создании заказа. Попробуйте позже.');
                return;
            }
            
            const orderId = this.lastID;
            showOrderInfo(chatId, { id: orderId, ...painting, token: orderToken, status: 'new' }, painting);
            notifyAdmin(orderId, chatId, painting, orderToken);
        }
    );
}

// === ПОКАЗАТЬ ИНФОРМАЦИЮ О ЗАКАЗЕ ===
function showOrderInfo(chatId, order, painting) {
    const paymentLink = generatePaymentLink(order.id, painting.title, painting.price);
    const imagePath = getPaintingImagePath(painting);
    
    const message = 
        `✅ <b>Заказ #${order.id}</b>\n\n` +
        `🎨 Картина: <b>${painting.title}</b>\n` +
        `💰 Сумма: <b>${painting.price}₽</b>\n` +
        `📦 Срок выполнения: 2-4 дня\n` +
        `📊 Статус: ${getStatusEmoji(order.status)} ${getStatusText(order.status)}\n\n` +
        `💳 <b>Для оплаты:</b>\n` +
        `• Нажмите "💳 Оплатить онлайн"\n` +
        `• Заполните данные карты\n` +
        `• В комментарии указан ваш заказ\n\n` +
        `⚠️ <b>Важно!</b> После оплаты нажмите "✅ Оплатил(а)".\n` +
        `📦 Мы начнем работу сразу после подтверждения.\n\n` +
        `📞 Вопросы: @flexyframe_bot_admin\n` +
        `🔑 Токен: <code>${order.token}</code>`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '💳 Оплатить онлайн', url: paymentLink }],
            [{ text: '✅ Оплатил(а)', callback_data: `paid_${order.id}` }],
            [{ text: '📋 Мои заказы', callback_data: 'my_orders' }]
        ]
    };
    
    // Пытаемся отправить фото
    bot.sendPhoto(chatId, imagePath, { 
        caption: message, 
        parse_mode: 'HTML', 
        reply_markup: keyboard 
    }).catch(() => {
        // Если фото не отправилось - текстом
        bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    });
}

// === УВЕДОМЛЕНИЕ АДМИНИСТРАТОРА ===
function notifyAdmin(orderId, chatId, painting, token) {
    if (!ADMIN_CHAT_ID || ADMIN_CHAT_ID === 'your_admin_id') {
        console.log('ℹ️ Администратор не указан, уведомление не отправлено');
        return;
    }
    
    const message = 
        `🔔 <b>Новый заказ #${orderId}</b>\n\n` +
        `👤 Пользователь: ${chatId}\n` +
        `🎨 Картина: ${painting.title}\n` +
        `💰 Сумма: ${painting.price}₽\n` +
        `📊 Статус: Ожидает оплаты\n` +
        `🔑 Токен: ${token}`;
    
    bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' })
        .catch(err => console.log('⚠️ Не удалось отправить уведомление:', err.message));
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
    if (msg.text === '/start') return; // Уже обработано
    
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Проверяем данные от MiniApp (web_app_data)
    if (msg.web_app_data && msg.web_app_data.data) {
        try {
            const data = JSON.parse(msg.web_app_data.data);
            console.log('📱 Данные от MiniApp:', data);
            
            if (data.action === 'create_order' && data.painting) {
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
            console.error('Ошибка парсинга данных MiniApp:', e);
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
    
    // Выбор картины из меню
    if (session && session.state === 'choosing_painting') {
        const painting = paintings.find(p => text.includes(p.title));
        if (painting) {
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
        }
        return;
    }
    
    // Оформление заказа
    if (session && session.state === 'painting_selected' && text === '💳 Оформить заказ') {
        const paintingId = session.data.paintingId;
        const painting = findPaintingById(paintingId);
        if (painting) {
            createOrder(chatId, painting);
            clearUserState(chatId);
        }
        return;
    }
    
    // Выбрать другую картину
    if (session && session.state === 'painting_selected' && text === '🎨 Выбрать другую') {
        showPaintingsMenu(chatId);
        clearUserState(chatId);
        return;
    }
    
    // Назад в главное меню
    if (text === '🔙 Назад') {
        showMainMenu(chatId, msg.chat.first_name);
        clearUserState(chatId);
        return;
    }
});

// === ПОКАЗАТЬ МЕНЮ КАРТИН ===
function showPaintingsMenu(chatId) {
    const keyboard = paintings.map(p => [{
        text: `${p.title} - ${p.price}₽`
    }]);
    
    keyboard.push([{ text: '🔙 Назад' }]);
    
    setUserState(chatId, 'choosing_painting');
    
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
        `• Email: art@flexyframe.ru\n\n` +
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
    
    // Убираем "часики"
    bot.answerCallbackQuery(callbackQuery.id);
    
    // Кнопка "✅ Оплатил(а)"
    if (data.startsWith('paid_')) {
        const orderId = parseInt(data.replace('paid_', ''));
        
        db.get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [orderId, chatId], (err, order) => {
            if (err || !order) {
                bot.sendMessage(chatId, '❌ Заказ не найден или не принадлежит вам.');
                return;
            }
            
            if (order.status === 'paid') {
                bot.sendMessage(chatId, `✅ Заказ #${orderId} уже оплачен и в работе!`);
                return;
            }
            
            // Обновляем статус
            db.run(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId]);
            
            // Отправляем подтверждение
            bot.sendMessage(chatId, 
                `✅ <b>Заказ #${orderId} оплачен!</b>\n\n` +
                `Мы получили подтверждение и начали работу.\n` +
                `Срок выполнения: 2-4 дня.\n\n` +
                `📞 Следить за статусом можно в разделе "Мои заказы".`,
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
});

// === УВЕДОМЛЕНИЕ ОБ ОПЛАТЕ ===
function notifyAdminPayment(orderId, chatId, order) {
    if (!ADMIN_CHAT_ID || ADMIN_CHAT_ID === 'your_admin_id') return;
    
    const message = 
        `💰 <b>Оплата подтверждена!</b>\n\n` +
        `Заказ #${orderId}\n` +
        `👤 Пользователь: ${chatId}\n` +
        `🎨 ${order.painting_title}\n` +
        `💰 ${order.price}₽\n` +
        `📊 Статус: Оплачен`;
    
    bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' })
        .catch(() => {});
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
app.listen(8080, () => {
    console.log('🌐 Веб-сервер запущен на порту 8080');
    console.log('🔗 Доступно: http://127.0.0.1:8080');
});

const webhookApp = express();
webhookApp.use(express.json());
webhookApp.post('/webhook/payment', (req, res) => {
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

webhookApp.listen(3000, () => {
    console.log('🌐 Вебхук сервер запущен на порту 3000');
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