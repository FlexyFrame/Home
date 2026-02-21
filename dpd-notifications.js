/**
 * FlexyFrame DPD Notifications System
 * Система уведомлений о статусе заказов для клиентов
 * 
 * Версия: 1.0.0
 * Функционал: Отслеживание статусов, push-уведомления в Telegram,
 *            периодический опрос DPD API, обработка изменений статусов
 * 
 * Основано на интеграционном гиде DPD v1.44 (Январь 2026)
 */

const { DPDClient } = require('./dpd-api');
const { DPDReceiptWarehouseClient } = require('./dpd-receipt-warehouse');
const logger = require('./logger');

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const CONFIG = {
    // Период опроса статусов (в миллисекундах)
    pollInterval: 5 * 60 * 1000, // 5 минут
    
    // Максимальное количество попыток опроса
    maxRetries: 3,
    
    // Задержка между попытками (в миллисекундах)
    retryDelay: 2000,
    
    // Статусы, при которых отправлять уведомления
    notifyStatuses: [
        'Delivering',      // Доставляется
        'Delivered',       // Доставлено
        'OnTerminal',      // Готов к выдаче
        'Problem',         // Проблема
        'Lost',            // Утеряно
        'NotDone'          // Отменено
    ],
    
    // Статусы, при которых отправлять уведомления о проблемах
    problemStatuses: [
        'Problem',
        'Lost',
        'NotDone'
    ]
};

// Справочник сообщений для статусов
const STATUS_MESSAGES = {
    'Delivering': '📦 Ваш заказ в пути! Курьер уже выехал к вам.',
    'Delivered': '✅ Ваш заказ успешно доставлен!',
    'OnTerminal': '📍 Ваш заказ прибыл на пункт выдачи. Готов к получению.',
    'Problem': '⚠️ Возникла проблема с вашим заказом. Свяжитесь с нами.',
    'Lost': '❌ К сожалению, ваш заказ утерян. Мы уже работаем над решением.',
    'NotDone': '🚫 Заказ был отменен. Подробности уточните у менеджера.'
};

// ============================================================
// КЛАСС DPD NOTIFICATIONS
// ============================================================
class DPDNotifications {
    constructor(options = {}) {
        this.dpdClient = new DPDClient(options);
        this.receiptClient = new DPDReceiptWarehouseClient(options);
        
        // Хранилище последних статусов
        this.lastStatuses = new Map();
        
        // Хранилище активных заказов для отслеживания
        this.trackedOrders = new Set();
        
        // Таймер опроса
        this.pollTimer = null;
        
        // Функция отправки уведомлений
        this.notificationCallback = null;
        
        // Статистика
        this.stats = {
            totalChecks: 0,
            statusChanges: 0,
            notificationsSent: 0,
            errors: 0,
            lastCheckTime: null
        };
        
        logger.info('DPD Notifications system initialized', { 
            pollInterval: CONFIG.pollInterval,
            notifyStatuses: CONFIG.notifyStatuses 
        });
    }

    // ========================================
    // ОСНОВНЫЕ МЕТОДЫ
    // ========================================

    /**
     * Запустить систему уведомлений
     */
    start() {
        if (this.pollTimer) {
            logger.warn('DPD Notifications already running');
            return;
        }
        
        logger.info('Starting DPD Notifications system');
        this.pollTimer = setInterval(() => {
            this.pollStatuses().catch(error => {
                logger.error('Error in DPD notifications poll', error);
                this.stats.errors++;
            });
        }, CONFIG.pollInterval);
        
        // Сразу выполнить первый опрос
        this.pollStatuses().catch(error => {
            logger.error('Error in initial DPD notifications poll', error);
            this.stats.errors++;
        });
    }

    /**
     * Остановить систему уведомлений
     */
    stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            logger.info('DPD Notifications system stopped');
        }
    }

    /**
     * Добавить заказ в отслеживание
     */
    addOrderTracking(clientOrderNr, chatId, userId = null) {
        this.trackedOrders.add(clientOrderNr);
        this.lastStatuses.set(clientOrderNr, {
            chatId,
            userId,
            lastStatus: null,
            lastCheck: null
        });
        
        logger.info('Added order to tracking', { clientOrderNr, chatId, userId });
    }

    /**
     * Удалить заказ из отслеживания
     */
    removeOrderTracking(clientOrderNr) {
        this.trackedOrders.delete(clientOrderNr);
        this.lastStatuses.delete(clientOrderNr);
        logger.info('Removed order from tracking', { clientOrderNr });
    }

    /**
     * Установить callback для отправки уведомлений
     */
    setNotificationCallback(callback) {
        this.notificationCallback = callback;
        logger.info('Notification callback set');
    }

    // ========================================
    // ОПРОС СТАТУСОВ
    // ========================================

    /**
     * Основной метод опроса статусов
     */
    async pollStatuses() {
        this.stats.totalChecks++;
        this.stats.lastCheckTime = new Date();
        
        if (this.trackedOrders.size === 0) {
            logger.debug('No orders to track');
            return;
        }
        
        try {
            // Получить все изменённые статусы
            const result = await this.dpdClient.getStatesByClient();
            
            if (!result.states || result.states.length === 0) {
                logger.debug('No status changes found');
                return;
            }
            
            // Обработать изменения статусов
            await this.processStatusChanges(result.states);
            
            // Подтвердить получение статусов
            if (result.docId) {
                await this.dpdClient.confirmTracking(result.docId);
                logger.debug('Confirmed status receipt', { docId: result.docId });
            }
            
        } catch (error) {
            this.stats.errors++;
            logger.error('Error polling DPD statuses', error);
            throw error;
        }
    }

    /**
     * Обработать изменения статусов
     */
    async processStatusChanges(states) {
        for (const state of states) {
            const clientOrderNr = state.clientOrderNr;
            
            // Проверяем, отслеживаем ли мы этот заказ
            if (!this.trackedOrders.has(clientOrderNr)) {
                continue;
            }
            
            const trackingInfo = this.lastStatuses.get(clientOrderNr);
            const currentStatus = state.newState;
            const lastStatus = trackingInfo.lastStatus;
            
            // Обновляем последний статус
            trackingInfo.lastStatus = currentStatus;
            trackingInfo.lastCheck = new Date();
            
            // Проверяем, изменился ли статус
            if (currentStatus !== lastStatus) {
                this.stats.statusChanges++;
                logger.info('Status changed', { 
                    clientOrderNr, 
                    from: lastStatus, 
                    to: currentStatus 
                });
                
                // Отправляем уведомление, если нужно
                if (this.shouldNotify(currentStatus)) {
                    await this.sendNotification(clientOrderNr, currentStatus, state);
                }
            }
        }
    }

    /**
     * Проверить, нужно ли отправлять уведомление для статуса
     */
    shouldNotify(status) {
        return CONFIG.notifyStatuses.includes(status);
    }

    /**
     * Отправить уведомление
     */
    async sendNotification(clientOrderNr, status, state) {
        if (!this.notificationCallback) {
            logger.warn('No notification callback set');
            return;
        }
        
        const trackingInfo = this.lastStatuses.get(clientOrderNr);
        const message = this.buildNotificationMessage(clientOrderNr, status, state);
        
        try {
            await this.notificationCallback({
                chatId: trackingInfo.chatId,
                userId: trackingInfo.userId,
                message: message.text,
                options: message.options
            });
            
            this.stats.notificationsSent++;
            logger.info('Notification sent', { 
                clientOrderNr, 
                status, 
                chatId: trackingInfo.chatId 
            });
            
        } catch (error) {
            logger.error('Error sending notification', error);
            this.stats.errors++;
        }
    }

    /**
     * Сформировать сообщение уведомления
     */
    buildNotificationMessage(clientOrderNr, status, state) {
        const baseMessage = STATUS_MESSAGES[status] || `Статус вашего заказа изменился: ${status}`;
        
        let text = `${baseMessage}\n\n`;
        text += `📦 Заказ: ${clientOrderNr}\n`;
        text += `📅 Время: ${new Date(state.transitionTime).toLocaleString('ru-RU')}\n`;
        
        if (state.terminalCity) {
            text += `📍 Терминал: ${state.terminalCity}\n`;
        }
        
        if (state.consignee) {
            text += `👤 Получатель: ${state.consignee}\n`;
        }
        
        if (state.incidentName) {
            text += `⚠️ Проблема: ${state.incidentName}\n`;
        }
        
        // Добавляем кнопки управления доставкой для активных статусов
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📍 Отслеживание', callback_data: `track_${clientOrderNr}` },
                        { text: '📞 Связаться', callback_data: 'contact_support' }
                    ]
                ]
            }
        };
        
        // Для проблемных статусов добавляем кнопку срочной связи
        if (CONFIG.problemStatuses.includes(status)) {
            options.reply_markup.inline_keyboard.push([
                { text: '🆘 Срочная помощь', callback_data: `urgent_${clientOrderNr}` }
            ]);
        }
        
        return { text, options };
    }

    // ========================================
    // РАБОТА С ЧЕКАМИ
    // ========================================

    /**
     * Проверить наличие новых чеков для заказа
     */
    async checkReceiptsForOrder(clientOrderNr) {
        try {
            // Получаем чеки за последние 24 часа
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            
            const result = await this.receiptClient.range(yesterday, now);
            
            if (result.dataReceipts && result.dataReceipts.length > 0) {
                const orderReceipts = result.dataReceipts.filter(r => 
                    r.clientOrderNum === clientOrderNr
                );
                
                if (orderReceipts.length > 0) {
                    return orderReceipts;
                }
            }
            
            return [];
        } catch (error) {
            logger.error('Error checking receipts for order', error);
            return [];
        }
    }

    /**
     * Подтвердить получение чеков
     */
    async confirmReceipts(receiptIds) {
        try {
            const result = await this.receiptClient.confirm(receiptIds);
            logger.info('Receipts confirmed', { receiptIds, result });
            return result;
        } catch (error) {
            logger.error('Error confirming receipts', error);
            throw error;
        }
    }

    // ========================================
    // УТИЛИТЫ
    // ========================================

    /**
     * Получить статистику
     */
    getStats() {
        return {
            ...this.stats,
            trackedOrdersCount: this.trackedOrders.size,
            activeOrders: Array.from(this.trackedOrders),
            lastStatuses: Object.fromEntries(this.lastStatuses)
        };
    }

    /**
     * Получить информацию о заказе
     */
    getOrderInfo(clientOrderNr) {
        return this.lastStatuses.get(clientOrderNr) || null;
    }

    /**
     * Получить все отслеживаемые заказы
     */
    getTrackedOrders() {
        return Array.from(this.trackedOrders);
    }

    /**
     * Очистить историю статусов
     */
    clearHistory() {
        this.lastStatuses.clear();
        this.trackedOrders.clear();
        logger.info('Tracking history cleared');
    }

    /**
     * Принудительный опрос статусов (для ручного вызова)
     */
    async forcePoll() {
        logger.info('Force polling DPD statuses');
        return this.pollStatuses();
    }
}

module.exports = { DPDNotifications, CONFIG, STATUS_MESSAGES };