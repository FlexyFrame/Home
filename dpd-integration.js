/**
 * FlexyFrame DPD Integration
 * Комплексная интеграция с DPD API для интернет-магазина
 * 
 * Версия: 1.0.0
 * Функционал: Полная интеграция с DPD API, включая все веб-службы:
 * - География DPD
 * - Расчет стоимости доставки
 * - Создание и управление заказами
 * - Отслеживание статусов
 * - Отчеты и аналитика
 * - Управление доставкой
 * - Хранилище чеков (54-ФЗ)
 * - Уведомления и администрирование
 * 
 * Основано на интеграционном гиде DPD v1.44 (Январь 2026)
 */

const { DPDClient } = require('./dpd-api');
const { DPDGeography } = require('./dpd-geography');
const { DPDShippingCalculator } = require('./dpd-shipping-calculator');
const { DPDNotifications } = require('./dpd-notifications');
const { DPDAdmin } = require('./dpd-admin');
const { DPDCancellation } = require('./dpd-cancellation');
const { DPDReceiptWarehouseClient } = require('./dpd-receipt-warehouse');
const logger = require('./logger');

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const CONFIG = {
    // Основные настройки
    clientNumber: process.env.DPD_CLIENT_NUMBER,
    clientKey: process.env.DPD_CLIENT_KEY,
    testMode: process.env.DPD_TEST_MODE === 'true',
    
    // Настройки уведомлений
    notifications: {
        enabled: true,
        pollInterval: 5 * 60 * 1000, // 5 минут
        notifyStatuses: [
            'Delivering',
            'Delivered', 
            'OnTerminal',
            'Problem',
            'Lost',
            'NotDone'
        ]
    },
    
    // Настройки администрирования
    admin: {
        enabled: true,
        monitoringInterval: 15 * 60 * 1000, // 15 минут
        problemStatuses: [
            'Problem',
            'Lost',
            'NotDone',
            'OnTerminal'
        ]
    },
    
    // Настройки географии
    geography: {
        cacheTTL: 24 * 60 * 60 * 1000, // 24 часа
        updateInterval: 3 * 60 * 60 * 1000 // 3 часа
    }
};

// ============================================================
// КЛАСС FLEXYFRAME DPD INTEGRATION
// ============================================================
class FlexyFrameDPDIntegration {
    constructor(options = {}) {
        // Объединяем настройки
        this.config = { ...CONFIG, ...options };
        
        // Проверяем обязательные параметры
        if (!this.config.clientNumber || !this.config.clientKey) {
            throw new Error('Требуются DPD_CLIENT_NUMBER и DPD_CLIENT_KEY');
        }
        
        // Инициализация компонентов
        this.dpdClient = new DPDClient(this.config);
        this.geography = new DPDGeography(this.config);
        this.calculator = new DPDShippingCalculator(this.config);
        this.notifications = new DPDNotifications(this.config);
        this.admin = new DPDAdmin(this.config);
        this.cancellation = new DPDCancellation(this.config);
        this.receipts = new DPDReceiptWarehouseClient(this.config);
        
        // Состояние системы
        this.isInitialized = false;
        this.isRunning = false;
        
        // Статистика
        this.stats = {
            initializationTime: null,
            uptime: 0,
            totalOperations: 0,
            errors: 0,
            lastError: null
        };
        
        logger.info('FlexyFrame DPD Integration initialized', {
            clientNumber: this.config.clientNumber,
            testMode: this.config.testMode,
            components: ['DPDClient', 'Geography', 'Calculator', 'Notifications', 'Admin', 'Cancellation', 'Receipts']
        });
    }

    // ========================================
    // ИНИЦИАЛИЗАЦИЯ И ЗАПУСК
    // ========================================

    /**
     * Инициализировать систему
     */
    async initialize() {
        try {
            logger.info('Initializing FlexyFrame DPD Integration');
            
            // Инициализация основного клиента
            await this.dpdClient.initialize();
            
            // Инициализация географии
            await this.geography.initialize();
            
            // Инициализация калькулятора
            await this.calculator.initialize();
            
            // Инициализация уведомлений
            if (this.config.notifications.enabled) {
                this.notifications.setNotificationCallback(this.handleNotification.bind(this));
                this.notifications.start();
            }
            
            // Инициализация администрирования
            if (this.config.admin.enabled) {
                this.admin.setAdminNotificationCallback(this.handleAdminNotification.bind(this));
                this.admin.startMonitoring();
            }
            
            this.isInitialized = true;
            this.stats.initializationTime = new Date();
            
            logger.info('FlexyFrame DPD Integration initialized successfully');
            return { success: true };
        } catch (error) {
            logger.error('Error initializing FlexyFrame DPD Integration', error);
            this.stats.lastError = error.message;
            throw error;
        }
    }

    /**
     * Запустить систему
     */
    async start() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        if (this.isRunning) {
            logger.warn('FlexyFrame DPD Integration already running');
            return;
        }
        
        this.isRunning = true;
        this.stats.uptime = Date.now();
        
        logger.info('FlexyFrame DPD Integration started');
    }

    /**
     * Остановить систему
     */
    async stop() {
        if (!this.isRunning) {
            logger.warn('FlexyFrame DPD Integration already stopped');
            return;
        }
        
        // Останавливаем компоненты
        if (this.config.notifications.enabled) {
            this.notifications.stop();
        }
        
        if (this.config.admin.enabled) {
            this.admin.stopMonitoring();
        }
        
        this.isRunning = false;
        this.stats.uptime = 0;
        
        logger.info('FlexyFrame DPD Integration stopped');
    }

    // ========================================
    // ОСНОВНЫЕ МЕТОДЫ ДЛЯ ИНТЕРНЕТ-МАГАЗИНА
    // ========================================

    /**
     * Рассчитать стоимость доставки
     */
    async calculateShipping(options) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.calculator.calculate(options);
            
            logger.info('Shipping calculation completed', { 
                from: options.from, 
                to: options.to, 
                weight: options.weight,
                cost: result.totalCost 
            });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error calculating shipping', error);
            throw error;
        }
    }

    /**
     * Создать заказ
     */
    async createOrder(orderData) {
        try {
            this.stats.totalOperations++;
            
            // Валидация данных заказа
            const validation = this.validateOrderData(orderData);
            if (!validation.valid) {
                throw new Error(`Ошибка валидации заказа: ${validation.error}`);
            }
            
            // Создание заказа
            const result = await this.dpdClient.createOrder(orderData);
            
            // Добавляем заказ в отслеживание
            if (result.success && result.orderNum) {
                this.notifications.addOrderTracking(
                    orderData.orderNumberInternal, 
                    orderData.customerChatId,
                    orderData.customerUserId
                );
            }
            
            logger.info('Order created successfully', { 
                orderNumber: orderData.orderNumberInternal,
                dpdOrderNumber: result.orderNum 
            });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error creating order', error);
            throw error;
        }
    }

    /**
     * Отследить заказ
     */
    async trackOrder(clientOrderNr, pickupDate = null) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.dpdClient.getOrderStatus(clientOrderNr, pickupDate);
            
            logger.info('Order tracking completed', { 
                clientOrderNr, 
                status: result.status 
            });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error tracking order', error);
            throw error;
        }
    }

    /**
     * Отменить заказ
     */
    async cancelOrder(clientOrderNr, reason = 'other', pickupDate = null) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.cancellation.cancelOrder(clientOrderNr, reason, pickupDate);
            
            logger.info('Order cancellation completed', { 
                clientOrderNr, 
                reason, 
                success: result.success 
            });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error canceling order', error);
            throw error;
        }
    }

    /**
     * Получить отчет
     */
    async getReport(type, options) {
        try {
            this.stats.totalOperations++;
            
            let result;
            
            switch (type) {
                case 'nl_amount':
                    result = await this.admin.getNLAmountReport(options.dateFrom, options.dateTo);
                    break;
                case 'nl_invoice':
                    result = await this.admin.getNLInvoiceReport(options.dateFrom, options.dateTo);
                    break;
                case 'waybill':
                    result = await this.admin.getWaybillReport(options.orderNum, options.year);
                    break;
                case 'link_check':
                    result = await this.admin.getLinkCheckReport(options.dateFrom, options.dateTo);
                    break;
                case 'receipts_statistics':
                    result = await this.admin.getReceiptsStatistics(options.dateFrom, options.dateTo);
                    break;
                default:
                    throw new Error(`Неизвестный тип отчета: ${type}`);
            }
            
            logger.info('Report generated', { type, options });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error generating report', error);
            throw error;
        }
    }

    /**
     * Получить географию
     */
    async getGeography(type, options = {}) {
        try {
            this.stats.totalOperations++;
            
            let result;
            
            switch (type) {
                case 'cities_cash_pay':
                    result = await this.geography.getCitiesCashPay(options.countryCode);
                    break;
                case 'parcel_shops':
                    result = await this.geography.getParcelShops(options);
                    break;
                case 'terminals':
                    result = await this.geography.getTerminalsSelfDelivery(options);
                    break;
                case 'storage_period':
                    result = await this.geography.getStoragePeriod(options);
                    break;
                default:
                    throw new Error(`Неизвестный тип географии: ${type}`);
            }
            
            logger.info('Geography data retrieved', { type, options });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error getting geography', error);
            throw error;
        }
    }

    // ========================================
    // УПРАВЛЕНИЕ ДОСТАВКОЙ
    // ========================================

    /**
     * Изменить дату доставки
     */
    async changeDeliveryDate(clientOrderNr, newDate, newIntervalId = null) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.dpdClient.changeDeliveryDate(clientOrderNr, newDate, newIntervalId);
            
            logger.info('Delivery date changed', { 
                clientOrderNr, 
                newDate, 
                newIntervalId 
            });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error changing delivery date', error);
            throw error;
        }
    }

    /**
     * Изменить адрес доставки
     */
    async changeDeliveryAddress(clientOrderNr, newAddress) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.dpdClient.changeDeliveryAddress(clientOrderNr, newAddress);
            
            logger.info('Delivery address changed', { 
                clientOrderNr, 
                newAddress 
            });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error changing delivery address', error);
            throw error;
        }
    }

    /**
     * Изменить пункт выдачи
     */
    async changeParcelShop(clientOrderNr, newParcelShopId) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.dpdClient.changeParcelShop(clientOrderNr, newParcelShopId);
            
            logger.info('Parcel shop changed', { 
                clientOrderNr, 
                newParcelShopId 
            });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error changing parcel shop', error);
            throw error;
        }
    }

    /**
     * Отказаться от получения заказа
     */
    async cancelOrderDelivery(clientOrderNr, reason) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.dpdClient.cancelOrderDelivery(clientOrderNr, reason);
            
            logger.info('Order delivery canceled', { 
                clientOrderNr, 
                reason 
            });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error canceling order delivery', error);
            throw error;
        }
    }

    // ========================================
    // РАБОТА С ЧЕКАМИ (54-ФЗ)
    // ========================================

    /**
     * Получить чеки для заказа
     */
    async getReceiptsForOrder(clientOrderNr) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.receipts.checkReceiptsForOrder(clientOrderNr);
            
            logger.info('Receipts retrieved for order', { clientOrderNr });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error getting receipts for order', error);
            throw error;
        }
    }

    /**
     * Подтвердить получение чеков
     */
    async confirmReceipts(receiptIds) {
        try {
            this.stats.totalOperations++;
            
            const result = await this.receipts.confirmReceipts(receiptIds);
            
            logger.info('Receipts confirmed', { receiptIds });
            
            return result;
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            logger.error('Error confirming receipts', error);
            throw error;
        }
    }

    // ========================================
    // УТИЛИТЫ И ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ========================================

    /**
     * Валидация данных заказа
     */
    validateOrderData(orderData) {
        const required = [
            'orderNumberInternal',
            'serviceCode',
            'serviceVariant',
            'cargoNumPack',
            'cargoWeight',
            'cargoCategory',
            'senderAddress',
            'receiverAddress'
        ];
        
        const missing = required.filter(field => !orderData[field]);
        
        if (missing.length > 0) {
            return {
                valid: false,
                error: `Отсутствуют обязательные поля: ${missing.join(', ')}`
            };
        }
        
        // Проверка адресов
        const senderValidation = this.validateAddress(orderData.senderAddress);
        if (!senderValidation.valid) {
            return senderValidation;
        }
        
        const receiverValidation = this.validateAddress(orderData.receiverAddress);
        if (!receiverValidation.valid) {
            return receiverValidation;
        }
        
        return { valid: true };
    }

    /**
     * Валидация адреса
     */
    validateAddress(address) {
        const required = ['name', 'terminalCode', 'countryName', 'city', 'street', 'contactFio', 'contactPhone'];
        
        const missing = required.filter(field => !address[field]);
        
        if (missing.length > 0) {
            return {
                valid: false,
                error: `В адресе отсутствуют обязательные поля: ${missing.join(', ')}`
            };
        }
        
        return { valid: true };
    }

    /**
     * Обработчик уведомлений для клиентов
     */
    async handleNotification(notification) {
        try {
            // Здесь можно реализовать логику отправки уведомлений клиенту
            // Например, через Telegram, SMS, email и т.д.
            
            logger.info('Customer notification handled', notification);
        } catch (error) {
            logger.error('Error handling customer notification', error);
        }
    }

    /**
     * Обработчик уведомлений для администраторов
     */
    async handleAdminNotification(notification) {
        try {
            // Здесь можно реализовать логику отправки уведомлений администратору
            // Например, через Telegram, email, Slack и т.д.
            
            logger.info('Admin notification handled', notification);
        } catch (error) {
            logger.error('Error handling admin notification', error);
        }
    }

    /**
     * Получить статистику системы
     */
    getSystemStats() {
        const uptime = this.stats.uptime ? (Date.now() - this.stats.uptime) : 0;
        
        return {
            system: {
                isInitialized: this.isInitialized,
                isRunning: this.isRunning,
                uptime: uptime,
                initializationTime: this.stats.initializationTime
            },
            operations: {
                total: this.stats.totalOperations,
                errors: this.stats.errors,
                errorRate: this.stats.totalOperations > 0 
                    ? Math.round((this.stats.errors / this.stats.totalOperations) * 100) 
                    : 0,
                lastError: this.stats.lastError
            },
            components: {
                dpdClient: this.dpdClient.getStats(),
                geography: this.geography.getStats(),
                calculator: this.calculator.getStats(),
                notifications: this.notifications.getStats(),
                admin: this.admin.getStats(),
                cancellation: this.cancellation.getStats(),
                receipts: this.receipts.getStats()
            }
        };
    }

    /**
     * Получить конфигурацию системы
     */
    getConfig() {
        return this.config;
    }

    /**
     * Обновить конфигурацию
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger.info('Configuration updated', newConfig);
    }

    /**
     * Выполнить диагностику системы
     */
    async diagnose() {
        const results = {
            system: {
                isInitialized: this.isInitialized,
                isRunning: this.isRunning,
                uptime: this.stats.uptime ? (Date.now() - this.stats.uptime) : 0
            },
            components: {},
            errors: []
        };
        
        try {
            // Диагностика основного клиента
            results.components.dpdClient = await this.dpdClient.diagnose();
        } catch (error) {
            results.errors.push({ component: 'dpdClient', error: error.message });
        }
        
        try {
            // Диагностика географии
            results.components.geography = await this.geography.diagnose();
        } catch (error) {
            results.errors.push({ component: 'geography', error: error.message });
        }
        
        try {
            // Диагностика калькулятора
            results.components.calculator = await this.calculator.diagnose();
        } catch (error) {
            results.errors.push({ component: 'calculator', error: error.message });
        }
        
        return results;
    }
}

module.exports = { 
    FlexyFrameDPDIntegration, 
    CONFIG,
    // Экспортируем все компоненты для гибкого использования
    DPDClient,
    DPDGeography,
    DPDShippingCalculator,
    DPDNotifications,
    DPDAdmin,
    DPDCancellation,
    DPDReceiptWarehouseClient
};