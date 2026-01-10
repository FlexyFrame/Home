const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// === КОНФИГУРАЦИЯ БОТА ПОДДЕРЖКИ ===
const SUPPORT_TOKEN = process.env.SUPPORT_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Валидация токена
if (!SUPPORT_TOKEN || SUPPORT_TOKEN === 'your_support_token_here') {
    console.error('❌ Ошибка: SUPPORT_BOT_TOKEN не установлен в .env');
    console.error('Пожалуйста, добавьте SUPPORT_BOT_TOKEN в .env файл');
    process.exit(1);
}

// === БАЗА ДАННЫХ ===
const db = new sqlite3.Database('./flexyframe.db', (err) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err);
    } else {
        console.log('✅ База данных подключена');
    }
});

// === ИНИЦИАЛИЗАЦИЯ БОТА ПОДДЕРЖКИ ===
const supportBot = new TelegramBot(SUPPORT_TOKEN, { polling: true });

// === ПРОВЕРКА АДМИНА ===
function isAdmin(chatId) {
    return chatId.toString() === ADMIN_CHAT_ID;
}

// === СТАРТ БОТА ПОДДЕРЖКИ ===
supportBot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.chat.first_name;
    
    if (!isAdmin(chatId)) {
        // Это обычный пользователь - показываем его тикеты
        showUserTickets(chatId, firstName);
        return;
    }
    
    // Это админ - показываем админ-панель
    showAdminPanel(chatId);
});

// === ПОКАЗАТЬ ТИКЕТЫ ПОЛЬЗОВАТЕЛЯ ===
function showUserTickets(chatId, firstName) {
    db.all(
        `SELECT t.*, o.painting_title, o.price 
         FROM tickets t 
         JOIN orders o ON t.order_id = o.id 
         WHERE t.user_id = ? 
         ORDER BY t.created_at DESC`,
        [chatId],
        (err, tickets) => {
            if (err) {
                supportBot.sendMessage(chatId, '❌ Ошибка при загрузке тикетов');
                return;
            }
            
            if (tickets.length === 0) {
                supportBot.sendMessage(chatId, 
                    `👋 <b>Добро пожаловать в поддержку FlexyFrame, ${firstName}!</b>\n\n` +
                    `У вас пока нет активных тикетов.\n\n` +
                    `💡 <i>Тикет создается автоматически после оплаты заказа.</i>`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
            
            let message = `📋 <b>Ваши тикеты:</b>\n\n`;
            
            tickets.forEach(ticket => {
                const statusEmoji = ticket.status === 'open' ? '🟢' : '🔴';
                message += 
                    `#${ticket.id} - ${statusEmoji} ${ticket.status}\n` +
                    `🎨 ${ticket.painting_title} - ${ticket.price}₽\n` +
                    `📅 ${new Date(ticket.created_at).toLocaleDateString('ru-RU')}\n\n`;
            });
            
            message += `💬 Отправьте сообщение с номером тикета (например: #1) для обсуждения.`;
            
            supportBot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        }
    );
}

// === ПОКАЗАТЬ АДМИН-ПАНЕЛЬ ===
function showAdminPanel(chatId) {
    db.all(
        `SELECT t.*, u.first_name, u.username, o.painting_title, o.price 
         FROM tickets t 
         JOIN users u ON t.user_id = u.user_id 
         JOIN orders o ON t.order_id = o.id 
         WHERE t.status = 'open' 
         ORDER BY t.created_at ASC`,
        [],
        (err, tickets) => {
            if (err) {
                supportBot.sendMessage(chatId, '❌ Ошибка при загрузке тикетов');
                return;
            }
            
            if (tickets.length === 0) {
                supportBot.sendMessage(chatId, 
                    `👨‍💼 <b>Админ-панель поддержки</b>\n\n` +
                    `🟢 Активных тикетов: 0\n\n` +
                    `✅ Все тикеты обработаны!`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
            
            let message = `👨‍💼 <b>Админ-панель поддержки</b>\n\n` +
                         `🟢 Активных тикетов: ${tickets.length}\n\n`;
            
            tickets.forEach(ticket => {
                const userName = ticket.first_name || ticket.username || 'Пользователь';
                message += 
                    `🎫 #${ticket.id}\n` +
                    `👤 ${userName} (ID: ${ticket.user_id})\n` +
                    `🎨 ${ticket.painting_title} - ${ticket.price}₽\n` +
                    `📅 ${new Date(ticket.created_at).toLocaleDateString('ru-RU')}\n\n`;
            });
            
            message += `💬 Отправьте сообщение в формате:\n` +
                      `<code>#1 Ваш ответ</code>\n\n` +
                      `Закрыть тикет: <code>close 1</code>`;
            
            supportBot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        }
    );
}

// === ОБРАБОТКА СООБЩЕНИЙ ===
supportBot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text === '/start') return;
    
    // Проверяем, админ это или пользователь
    if (isAdmin(chatId)) {
        // === ОБРАБОТКА АДМИНА ===
        
        // Закрытие тикета: close 1
        if (text.toLowerCase().startsWith('close ')) {
            const ticketId = parseInt(text.split(' ')[1]);
            
            if (!ticketId || isNaN(ticketId)) {
                supportBot.sendMessage(chatId, '❌ Неверный формат. Используйте: close 1');
                return;
            }
            
            // Проверяем, что тикет существует
            db.get(`SELECT * FROM tickets WHERE id = ?`, [ticketId], (err, ticket) => {
                if (err || !ticket) {
                    supportBot.sendMessage(chatId, '❌ Тикет не найден');
                    return;
                }
                
                // Закрываем тикет
                db.run(`UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`, [ticketId]);
                
                // Уведомляем пользователя
                supportBot.sendMessage(ticket.user_id, 
                    `✅ <b>Тикет #${ticketId} закрыт</b>\n\n` +
                    `Ваш вопрос решен. Спасибо за обращение!`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
                
                supportBot.sendMessage(chatId, `✅ Тикет #${ticketId} закрыт`);
                
                // Обновляем админ-панель
                setTimeout(() => showAdminPanel(chatId), 500);
            });
            return;
        }
        
        // Ответ пользователю: #1 Ваш ответ
        if (text.startsWith('#')) {
            const match = text.match(/^#(\d+)\s+(.+)$/);
            if (!match) {
                supportBot.sendMessage(chatId, '❌ Неверный формат. Используйте: #1 Ваш ответ');
                return;
            }
            
            const ticketId = parseInt(match[1]);
            const response = match[2];
            
            // Получаем информацию о тикете
            db.get(`SELECT * FROM tickets WHERE id = ?`, [ticketId], (err, ticket) => {
                if (err || !ticket) {
                    supportBot.sendMessage(chatId, '❌ Тикет не найден');
                    return;
                }
                
                if (ticket.status === 'closed') {
                    supportBot.sendMessage(chatId, '❌ Тикет уже закрыт');
                    return;
                }
                
                // Сохраняем сообщение
                db.run(
                    `INSERT INTO ticket_messages (ticket_id, from_user, message) VALUES (?, 0, ?)`,
                    [ticketId, response]
                );
                
                // Отправляем пользователю
                supportBot.sendMessage(ticket.user_id, 
                    `👨‍💼 <b>Ответ от поддержки:</b>\n\n` +
                    `${response}\n\n` +
                    `🎫 Тикет #${ticketId}`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
                
                supportBot.sendMessage(chatId, `✅ Ответ отправлен пользователю`);
            });
            return;
        }
        
        // Показать список тикетов
        if (text === '/tickets' || text === 'tickets') {
            showAdminPanel(chatId);
            return;
        }
        
        // Показать историю тикета
        if (text.startsWith('/history ')) {
            const ticketId = parseInt(text.split(' ')[1]);
            
            db.all(
                `SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY timestamp ASC`,
                [ticketId],
                (err, messages) => {
                    if (err || messages.length === 0) {
                        supportBot.sendMessage(chatId, '❌ Сообщений не найдено');
                        return;
                    }
                    
                    let history = `📜 <b>История тикета #${ticketId}</b>\n\n`;
                    messages.forEach(msg => {
                        const from = msg.from_user ? '👤 Пользователь' : '👨‍💼 Поддержка';
                        const time = new Date(msg.timestamp).toLocaleString('ru-RU');
                        history += `${from} (${time}):\n${msg.message}\n\n`;
                    });
                    
                    supportBot.sendMessage(chatId, history, { parse_mode: 'HTML' });
                }
            );
            return;
        }
        
    } else {
        // === ОБРАБОТКА ПОЛЬЗОВАТЕЛЯ ===
        
        // Пользователь может отвечать на тикет
        // Формат: #1 Привет, у меня вопрос...
        if (text.startsWith('#')) {
            const match = text.match(/^#(\d+)\s+(.+)$/);
            if (!match) {
                supportBot.sendMessage(chatId, 
                    `❌ Неверный формат.\n\n` +
                    `Используйте: <code>#1 Ваше сообщение</code>\n\n` +
                    `Чтобы посмотреть ваши тикеты, отправьте /start`,
                    { parse_mode: 'HTML' }
                );
                return;
            }
            
            const ticketId = parseInt(match[1]);
            const message = match[2];
            
            // Проверяем, что тикет принадлежит пользователю
            db.get(`SELECT * FROM tickets WHERE id = ? AND user_id = ?`, [ticketId, chatId], (err, ticket) => {
                if (err || !ticket) {
                    supportBot.sendMessage(chatId, '❌ Тикет не найден или не принадлежит вам');
                    return;
                }
                
                if (ticket.status === 'closed') {
                    supportBot.sendMessage(chatId, '❌ Тикет закрыт');
                    return;
                }
                
                // Сохраняем сообщение
                db.run(
                    `INSERT INTO ticket_messages (ticket_id, from_user, message) VALUES (?, 1, ?)`,
                    [ticketId, message]
                );
                
                // Уведомляем админа
                if (ADMIN_CHAT_ID && ADMIN_CHAT_ID !== 'your_admin_id') {
                    supportBot.sendMessage(ADMIN_CHAT_ID, 
                        `💬 <b>Новое сообщение в тикете #${ticketId}</b>\n\n` +
                        `От: Пользователь (ID: ${chatId})\n` +
                        `Сообщение: ${message}\n\n` +
                        `Ответьте: #${ticketId} Ваш ответ`,
                        { parse_mode: 'HTML' }
                    ).catch(() => {});
                }
                
                supportBot.sendMessage(chatId, 
                    `✅ <b>Сообщение отправлено</b>\n\n` +
                    `Мы получили ваш ответ. Поддержка ответит вам в ближайшее время.`,
                    { parse_mode: 'HTML' }
                );
            });
            return;
        }
        
        // Если пользователь просто пишет без хештега
        supportBot.sendMessage(chatId, 
            `💬 Для общения с поддержкой используйте формат:\n\n` +
            `<code>#1 Ваше сообщение</code>\n\n` +
            `Где 1 - номер вашего тикета.\n` +
            `Чтобы посмотреть тикеты, отправьте /start`,
            { parse_mode: 'HTML' }
        );
    }
});

// === ОБРАБОТКА CALLBACK КНОПОК ===
supportBot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    supportBot.answerCallbackQuery(callbackQuery.id);
    
    if (!isAdmin(chatId)) {
        supportBot.sendMessage(chatId, '❌ Доступ запрещен');
        return;
    }
    
    // Обработка кнопок админ-панели
    if (data.startsWith('ticket_')) {
        const ticketId = parseInt(data.split('_')[1]);
        showTicketDetails(chatId, ticketId);
    }
});

// === ПОКАЗАТЬ ДЕТАЛИ ТИКЕТА ===
function showTicketDetails(chatId, ticketId) {
    db.get(
        `SELECT t.*, u.first_name, u.username, u.user_id, o.painting_title, o.price 
         FROM tickets t 
         JOIN users u ON t.user_id = u.user_id 
         JOIN orders o ON t.order_id = o.id 
         WHERE t.id = ?`,
        [ticketId],
        (err, ticket) => {
            if (err || !ticket) {
                supportBot.sendMessage(chatId, '❌ Тикет не найден');
                return;
            }
            
            const userName = ticket.first_name || ticket.username || 'Пользователь';
            
            let message = `🎫 <b>Тикет #${ticket.id}</b>\n\n` +
                         `👤 Пользователь: ${userName}\n` +
                         `🆔 ID: ${ticket.user_id}\n` +
                         `🎨 Заказ: ${ticket.painting_title} - ${ticket.price}₽\n` +
                         `📊 Статус: ${ticket.status}\n` +
                         `📅 Создан: ${new Date(ticket.created_at).toLocaleString('ru-RU')}\n\n`;
            
            // Показать последние сообщения
            db.all(
                `SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY timestamp DESC LIMIT 5`,
                [ticketId],
                (err, messages) => {
                    if (messages && messages.length > 0) {
                        message += `💬 <b>Последние сообщения:</b>\n\n`;
                        messages.reverse().forEach(msg => {
                            const from = msg.from_user ? '👤 Пользователь' : '👨‍💼 Поддержка';
                            message += `${from}:\n${msg.message}\n\n`;
                        });
                    }
                    
                    message += `Ответить: <code>#${ticket.id} Ваш ответ</code>\n` +
                              `Закрыть: <code>close ${ticket.id}</code>`;
                    
                    supportBot.sendMessage(chatId, message, { parse_mode: 'HTML' });
                }
            );
        }
    );
}

// === ЗАПУСК БОТА ПОДДЕРЖКИ ===
console.log('🚀 Support Bot запущен!');
console.log('📱 Бот поддержки:', '@FlexyFrameSupportBot');
console.log('🔑 Токен:', SUPPORT_TOKEN.substring(0, 10) + '...');
console.log('📊 Администратор:', ADMIN_CHAT_ID);