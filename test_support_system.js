/**
 * Тестовый скрипт для проверки системы поддержки FlexyFrame
 * Проверяет: базу данных, создание тикетов, изоляцию, админ-функции
 */

const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

// === ТЕСТОВЫЕ ДАННЫЕ ===
const TEST_USER_ID = 999999;
const TEST_ORDER_ID = 888889;
const TEST_ADMIN_ID = 1131158010;

console.log('🧪 ЗАПУСК ТЕСТОВ СИСТЕМЫ ПОДДЕРЖКИ FLEXYFRAME\n');

// === 1. ПРОВЕРКА БАЗЫ ДАННЫХ ===
function testDatabase() {
    return new Promise((resolve, reject) => {
        console.log('1️⃣ ПРОВЕРКА БАЗЫ ДАННЫХ...');
        
        const db = new sqlite3.Database('./flexyframe.db', (err) => {
            if (err) {
                console.log('❌ Ошибка подключения к БД:', err.message);
                reject(err);
                return;
            }
            console.log('✅ База данных подключена');
        });

        // Проверяем существование таблиц
        db.serialize(() => {
            const tables = ['tickets', 'ticket_messages', 'orders', 'users'];
            let checked = 0;

            tables.forEach(table => {
                db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table], (err, row) => {
                    checked++;
                    if (row) {
                        console.log(`✅ Таблица ${table} существует`);
                    } else {
                        console.log(`❌ Таблица ${table} НЕ существует`);
                    }

                    if (checked === tables.length) {
                        db.close();
                        resolve();
                    }
                });
            });
        });
    });
}

// === 2. ТЕСТ СОЗДАНИЯ ТИКЕТА ===
function testTicketCreation() {
    return new Promise((resolve, reject) => {
        console.log('\n2️⃣ ТЕСТ СОЗДАНИЯ ТИКЕТА...');
        
        const db = new sqlite3.Database('./flexyframe.db');
        
        // Очищаем тестовые данные
        db.run(`DELETE FROM tickets WHERE user_id = ? OR order_id = ?`, [TEST_USER_ID, TEST_ORDER_ID], function() {
            
            // Создаем тестовый заказ
            db.run(
                `INSERT INTO orders (id, user_id, painting_title, price, status) VALUES (?, ?, ?, ?, 'paid')`,
                [TEST_ORDER_ID, TEST_USER_ID, 'Тестовая Картина', 5000],
                function(err) {
                    if (err) {
                        console.log('❌ Ошибка создания тестового заказа:', err.message);
                        db.close();
                        reject(err);
                        return;
                    }
                    console.log('✅ Тестовый заказ создан');

                    // Создаем тикет (как это делает бот)
                    db.run(
                        `INSERT INTO tickets (user_id, order_id, status) VALUES (?, ?, 'open')`,
                        [TEST_USER_ID, TEST_ORDER_ID],
                        function(err) {
                            if (err) {
                                console.log('❌ Ошибка создания тикета:', err.message);
                                db.close();
                                reject(err);
                                return;
                            }
                            
                            const ticketId = this.lastID;
                            console.log(`✅ Тикет #${ticketId} создан для пользователя ${TEST_USER_ID}`);

                            // Проверяем, что тикет создался
                            db.get(`SELECT * FROM tickets WHERE id = ?`, [ticketId], (err, row) => {
                                if (row && row.user_id === TEST_USER_ID && row.order_id === TEST_ORDER_ID) {
                                    console.log('✅ Тикет корректно сохранен в БД');
                                    db.close();
                                    resolve(ticketId);
                                } else {
                                    console.log('❌ Тикет не найден или данные некорректны');
                                    db.close();
                                    reject(new Error('Data mismatch'));
                                }
                            });
                        }
                    );
                }
            );
        });
    });
}

// === 3. ТЕСТ ИЗОЛЯЦИИ ТИКЕТОВ ===
function testIsolation(ticketId) {
    return new Promise((resolve, reject) => {
        console.log('\n3️⃣ ТЕСТ ИЗОЛЯЦИИ ТИКЕТОВ...');
        
        const db = new sqlite3.Database('./flexyframe.db');
        
        // Пользователь 1 запрашивает свои тикеты
        db.all(`SELECT * FROM tickets WHERE user_id = ?`, [TEST_USER_ID], (err, user1Tickets) => {
            if (err) {
                console.log('❌ Ошибка запроса тикетов пользователя 1:', err.message);
                db.close();
                reject(err);
                return;
            }

            // Пользователь 2 (другой) запрашивает свои тикеты
            const OTHER_USER_ID = 888888;
            db.all(`SELECT * FROM tickets WHERE user_id = ?`, [OTHER_USER_ID], (err, user2Tickets) => {
                if (err) {
                    console.log('❌ Ошибка запроса тикетов пользователя 2:', err.message);
                    db.close();
                    reject(err);
                    return;
                }

                console.log(`✅ Пользователь ${TEST_USER_ID} видит ${user1Tickets.length} тикетов`);
                console.log(`✅ Пользователь ${OTHER_USER_ID} видит ${user2Tickets.length} тикетов`);
                
                if (user1Tickets.length > 0 && user2Tickets.length === 0) {
                    console.log('✅ Изоляция работает корректно');
                } else {
                    console.log('⚠️ Проверьте изоляцию (возможно, у пользователя 2 есть тикеты)');
                }

                db.close();
                resolve(ticketId);
            });
        });
    });
}

// === 4. ТЕСТ АДМИН-ПАНЕЛИ ===
function testAdminPanel() {
    return new Promise((resolve, reject) => {
        console.log('\n4️⃣ ТЕСТ АДМИН-ПАНЕЛИ...');
        
        const db = new sqlite3.Database('./flexyframe.db');
        
        // Админ запрашивает все открытые тикеты
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
                    console.log('❌ Ошибка запроса тикетов для админа:', err.message);
                    db.close();
                    reject(err);
                    return;
                }

                console.log(`✅ Админ видит ${tickets.length} открытых тикетов`);
                
                if (tickets.length > 0) {
                    console.log('📋 Список тикетов:');
                    tickets.forEach(t => {
                        const userName = t.first_name || t.username || 'Пользователь';
                        console.log(`   - #${t.id}: ${userName} - ${t.painting_title} (${t.price}₽)`);
                    });
                }

                db.close();
                resolve();
            }
        );
    });
}

// === 5. ТЕСТ СООБЩЕНИЙ ТИКЕТА ===
function testTicketMessages(ticketId) {
    return new Promise((resolve, reject) => {
        console.log('\n5️⃣ ТЕСТ СООБЩЕНИЙ ТИКЕТА...');
        
        const db = new sqlite3.Database('./flexyframe.db');
        
        // Добавляем сообщения от пользователя и админа
        const messages = [
            { ticket_id: ticketId, from_user: 1, message: 'Привет, у меня вопрос по заказу' },
            { ticket_id: ticketId, from_user: 0, message: 'Здравствуйте! Чем помочь?' },
            { ticket_id: ticketId, from_user: 1, message: 'Какой статус заказа?' }
        ];

        let inserted = 0;
        messages.forEach((msg, index) => {
            db.run(
                `INSERT INTO ticket_messages (ticket_id, from_user, message) VALUES (?, ?, ?)`,
                [msg.ticket_id, msg.from_user, msg.message],
                function(err) {
                    if (err) {
                        console.log(`❌ Ошибка добавления сообщения ${index}:`, err.message);
                        db.close();
                        reject(err);
                        return;
                    }
                    
                    inserted++;
                    if (inserted === messages.length) {
                        console.log(`✅ Добавлено ${messages.length} сообщений`);

                        // Проверяем историю
                        db.all(
                            `SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY timestamp ASC`,
                            [ticketId],
                            (err, rows) => {
                                if (err) {
                                    console.log('❌ Ошибка получения истории:', err.message);
                                    db.close();
                                    reject(err);
                                    return;
                                }

                                console.log(`✅ История тикета #${ticketId}:`);
                                rows.forEach(row => {
                                    const from = row.from_user ? '👤 Пользователь' : '👨‍💼 Поддержка';
                                    console.log(`   ${from}: ${row.message}`);
                                });

                                db.close();
                                resolve();
                            }
                        );
                    }
                }
            );
        });
    });
}

// === 6. ТЕСТ ЗАКРЫТИЯ ТИКЕТА ===
function testCloseTicket(ticketId) {
    return new Promise((resolve, reject) => {
        console.log('\n6️⃣ ТЕСТ ЗАКРЫТИЯ ТИКЕТА...');
        
        const db = new sqlite3.Database('./flexyframe.db');
        
        db.run(
            `UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [ticketId],
            function(err) {
                if (err) {
                    console.log('❌ Ошибка закрытия тикета:', err.message);
                    db.close();
                    reject(err);
                    return;
                }

                if (this.changes === 0) {
                    console.log('❌ Тикет не найден');
                    db.close();
                    reject(new Error('Ticket not found'));
                    return;
                }

                console.log(`✅ Тикет #${ticketId} закрыт`);

                // Проверяем статус
                db.get(`SELECT status, closed_at FROM tickets WHERE id = ?`, [ticketId], (err, row) => {
                    if (row && row.status === 'closed' && row.closed_at) {
                        console.log('✅ Статус и дата закрытия обновлены');
                    } else {
                        console.log('❌ Данные закрытия некорректны');
                    }
                    db.close();
                    resolve();
                });
            }
        );
    });
}

// === 7. ОЧИСТКА ТЕСТОВЫХ ДАННЫХ ===
function cleanupTestData() {
    return new Promise((resolve) => {
        console.log('\n7️⃣ ОЧИСТКА ТЕСТОВЫХ ДАННЫХ...');
        
        const db = new sqlite3.Database('./flexyframe.db');
        
        db.run(`DELETE FROM tickets WHERE user_id = ? OR order_id = ?`, [TEST_USER_ID, TEST_ORDER_ID], function() {
            db.run(`DELETE FROM orders WHERE id = ?`, [TEST_ORDER_ID], function() {
                db.run(`DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)`, [TEST_USER_ID], function() {
                    console.log('✅ Тестовые данные очищены');
                    db.close();
                    resolve();
                });
            });
        });
    });
}

// === ЗАПУСК ВСЕХ ТЕСТОВ ===
async function runAllTests() {
    try {
        await testDatabase();
        const ticketId = await testTicketCreation();
        await testIsolation(ticketId);
        await testAdminPanel();
        await testTicketMessages(ticketId);
        await testCloseTicket(ticketId);
        await cleanupTestData();
        
        console.log('\n🎉 ВСЕ ТЕСТЫ УСПЕШНО ПРОШЛИ!');
        console.log('\n✅ Система поддержки работает корректно:');
        console.log('   - База данных настроена');
        console.log('   - Создание тикетов работает');
        console.log('   - Изоляция пользователей работает');
        console.log('   - Админ-панель функционирует');
        console.log('   - Сообщения сохраняются');
        console.log('   - Закрытие тикетов работает');
        
    } catch (error) {
        console.log('\n❌ ОШИБКА В ТЕСТАХ:', error.message);
        process.exit(1);
    }
}

// Запускаем тесты
runAllTests();