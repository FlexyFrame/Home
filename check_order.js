const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./flexyframe.db');

db.get('SELECT * FROM orders WHERE id = 63', (err, row) => {
    if (err) {
        console.error('Ошибка:', err);
        return;
    }
    if (row) {
        console.log('Заказ найден:', row);
    } else {
        console.log('Заказ не найден');
    }
    db.close();
});