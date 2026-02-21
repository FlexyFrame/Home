/**
 * FlexyFrame Logger
 * Централизованный модуль логирования
 */

const fs = require('fs');
const path = require('path');
const moment = require('moment');

// === КОНФИГУРАЦИЯ ===
const LOG_DIR = './logs';
const LOG_FILE = 'bot.log';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

// === ИНИЦИАЛИЗАЦИЯ ===
function initLogger() {
    // Создаем директорию для логов
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Создаем файл логов если его нет
    const logFile = path.join(LOG_DIR, LOG_FILE);
    if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '');
    }

    // Проверяем размер файла логов
    const stats = fs.statSync(logFile);
    if (stats.size > MAX_LOG_SIZE) {
        // Архивируем старый лог
        const archiveFile = path.join(LOG_DIR, `bot_${moment().format('YYYYMMDD_HHmmss')}.log`);
        fs.renameSync(logFile, archiveFile);
        fs.writeFileSync(logFile, '');
    }
}

// === ФУНКЦИИ ЛОГИРОВАНИЯ ===
function log(level, message, data = {}) {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const logEntry = `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}\n`;

    // Вывод в консоль
    console.log(logEntry.trim());

    // Запись в файл
    const logFile = path.join(LOG_DIR, LOG_FILE);
    fs.appendFileSync(logFile, logEntry);
}

function info(message, data = {}) {
    log('INFO', message, data);
}

function warn(message, data = {}) {
    log('WARN', message, data);
}

function error(message, data = {}) {
    log('ERROR', message, data);
}

function debug(message, data = {}) {
    log('DEBUG', message, data);
}

// === ЛОГИРОВАНИЕ ЗАКАЗОВ ===
function logOrderCreation(orderId, orderNumber, chatId, paintingTitle, price) {
    info('Создание заказа', {
        orderId: orderId,
        orderNumber: orderNumber,
        chatId: chatId,
        paintingTitle: paintingTitle,
        price: price
    });
}

function logOrderCreationError(error, chatId, paintingId) {
    error('Ошибка создания заказа', {
        error: error.message,
        chatId: chatId,
        paintingId: paintingId
    });
}

function logAutoCancellation(orderId, orderNumber, reason) {
    warn('Автоматическая отмена заказа', {
        orderId: orderId,
        orderNumber: orderNumber,
        reason: reason
    });
}

// === ЭКСПОРТ ===
module.exports = {
    initLogger,
    info,
    warn,
    error,
    debug,
    logOrderCreation,
    logOrderCreationError,
    logAutoCancellation
};

// Инициализация при загрузке модуля
initLogger();