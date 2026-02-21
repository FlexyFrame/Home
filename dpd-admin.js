/**
 * FlexyFrame DPD Admin System
 * Административные функции для управления DPD интеграцией
 * 
 * Версия: 1.0.0
 * Функционал: Отчёты, массовое управление заказами, печать наклеек,
 *            мониторинг проблемных заказов, управление возвратами
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
    // Период мониторинга проблемных заказов (в миллисекундах)
    monitoringInterval: 15 * 60 * 1000, // 15 минут
    
    // Статусы, которые считаются проблемными
    problemStatuses: [
        'Problem',
        'Lost',
        'NotDone',
        'OnTerminal' // Долгое хранение
    ],
    
    // Максимальное время хранения на терминале (в часах)
    maxStorageHours: 72,
    
    // Статусы, доступные для массового управления
    manageableStatuses: [
        'OnTerminal',
        'Delivering',
        'Problem'
    ]
};

// Справочник причин отказа
const REJECTION_REASONS = {
    'long_wait': 'Долгое ожидание заказа',
    'quality': 'Качество, брак товара',
    'not_fit': 'Не подошел товар',
    'delivery_terms': 'Не устраивают условия доставки',
    'no_money': 'Нет денег',
    'no_need': 'Нет необходимости в заказе',
    'wrong_address': 'Указан неправильный адрес доставки',
    'partial_delivery': 'Неполная комплектация, неверное вложение',
    'technical_issue': 'Техническая проблема'
};

// ============================================================
// КЛАСС DPD ADMIN
// ============================================================
class DPDAdmin {
    constructor(options = {}) {
        this.dpdClient = new DPDClient(options);
        this.receiptClient = new DPDReceiptWarehouseClient(options);
        
        // Мониторинг проблемных заказов
        this.monitoringTimer = null;
        
        // Callback для уведомлений администратору
        this.adminNotificationCallback = null;
        
        // Статистика
        this.stats = {
            totalReports: 0,
            problemOrders: 0,
            resolvedOrders: 0,
            labelPrints: 0,
            lastReportTime: null
        };
        
        logger.info('DPD Admin system initialized');
    }

    // ========================================
    // ОТЧЁТЫ
    // ========================================

    /**
     * Получить предварительную стоимость перевозки за период
     */
    async getNLAmountReport(dateFrom, dateTo) {
        try {
            const result = await this.dpdClient.getNLAmount(dateFrom, dateTo);
            this.stats.totalReports++;
            this.stats.lastReportTime = new Date();
            
            logger.info('NL Amount report generated', { 
                dateFrom, 
                dateTo, 
                count: result.length 
            });
            
            return {
                success: true,
                data: result,
                summary: this._calculateAmountSummary(result)
            };
        } catch (error) {
            logger.error('Error generating NL Amount report', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Получить окончательную стоимость перевозки со счетами
     */
    async getNLInvoiceReport(dateFrom, dateTo) {
        try {
            const result = await this.dpdClient.getNLInvoice(dateFrom, dateTo);
            this.stats.totalReports++;
            this.stats.lastReportTime = new Date();
            
            logger.info('NL Invoice report generated', { 
                dateFrom, 
                dateTo, 
                count: result.length 
            });
            
            return {
                success: true,
                data: result,
                summary: this._calculateInvoiceSummary(result)
            };
        } catch (error) {
            logger.error('Error generating NL Invoice report', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Получить скан накладной подписанной получателем
     */
    async getWaybillReport(orderNum, year) {
        try {
            const result = await this.dpdClient.getWaybill(orderNum, year);
            
            logger.info('Waybill report generated', { orderNum, year });
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            logger.error('Error generating Waybill report', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Получить ссылки на чеки за период
     */
    async getLinkCheckReport(dateFrom, dateTo) {
        try {
            const result = await this.dpdClient.getLinkCheck(dateFrom, dateTo);
            this.stats.totalReports++;
            this.stats.lastReportTime = new Date();
            
            logger.info('Link Check report generated', { 
                dateFrom, 
                dateTo, 
                count: result.length 
            });
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            logger.error('Error generating Link Check report', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Получить статистику по чекам
     */
    async getReceiptsStatistics(dateFrom, dateTo) {
        try {
            await this.receiptClient.authorization();
            
            // Получаем количество новых чеков
            const quantityResult = await this.receiptClient.quantity();
            
            // Получаем чеки за период
            const receiptsResult = await this.receiptClient.range(dateFrom, dateTo);
            
            const stats = {
                newReceipts: quantityResult.numberOfReceipts || 0,
                periodReceipts: receiptsResult.numberOfReceipts || 0,
                totalAmount: 0,
                byStatus: {},
                byOperationType: {},
                problematicReceipts: []
            };
            
            if (receiptsResult.dataReceipts) {
                for (const receipt of receiptsResult.dataReceipts) {
                    // Суммируем общую сумму
                    stats.totalAmount += receipt.totalAmount || 0;
                    
                    // Группируем по статусам
                    const status = receipt.status || 0;
                    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
                    
                    // Группируем по типам операций
                    const opType = receipt.operationType || 'unknown';
                    stats.byOperationType[opType] = (stats.byOperationType[opType] || 0) + 1;
                    
                    // Ищем проблемные чеки
                    if (receipt.status === 0) { // Не подтвержденные
                        stats.problematicReceipts.push({
                            receiptId: receipt.receiptId,
                            clientOrderNum: receipt.clientOrderNum,
                            totalAmount: receipt.totalAmount,
                            createDate: receipt.createDate
                        });
                    }
                }
            }
            
            return {
                success: true,
                data: stats
            };
        } catch (error) {
            logger.error('Error generating receipts statistics', error);
            return { success: false, error: error.message };
        }
    }

    // ========================================
    // МАССОВОЕ УПРАВЛЕНИЕ ЗАКАЗАМИ
    // ========================================

    /**
     * Получить список проблемных заказов
     */
    async getProblemOrders(options = {}) {
        try {
            // Получаем все статусы за последний день
            const now = new Date();
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            
            const result = await this.dpdClient.getEvents({
                dateFrom: yesterday,
                dateTo: now,
                maxRowCount: 1000
            });
            
            const problemOrders = [];
            
            if (result.events) {
                for (const event of result.events) {
                    if (CONFIG.problemStatuses.includes(event.eventCode)) {
                        problemOrders.push({
                            clientOrderNr: event.clientOrderNr,
                            dpdOrderNr: event.dpdOrderNr,
                            eventCode: event.eventCode,
                            eventName: event.eventName,
                            eventDate: event.eventDate,
                            parameters: event.parameters,
                            terminalCode: this._extractTerminalCode(event.parameters)
                        });
                    }
                }
            }
            
            this.stats.problemOrders = problemOrders.length;
            
            logger.info('Problem orders retrieved', { count: problemOrders.length });
            
            return {
                success: true,
                data: problemOrders,
                summary: this._generateProblemOrdersSummary(problemOrders)
            };
        } catch (error) {
            logger.error('Error getting problem orders', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Отменить заказы массово
     */
    async cancelOrders(orderNumbers) {
        const results = [];
        
        for (const orderNum of orderNumbers) {
            try {
                const result = await this.dpdClient.cancelOrder({ orderNum });
                results.push({
                    orderNum,
                    success: true,
                    status: result[0]?.status,
                    errorMessage: result[0]?.errorMessage
                });
                
                if (result[0]?.status === 'Canceled') {
                    this.stats.resolvedOrders++;
                }
                
                logger.info('Order canceled', { orderNum, result: result[0] });
            } catch (error) {
                results.push({
                    orderNum,
                    success: false,
                    error: error.message
                });
                
                logger.error('Error canceling order', { orderNum, error: error.message });
            }
        }
        
        return {
            success: true,
            results,
            summary: {
                total: orderNumbers.length,
                canceled: results.filter(r => r.success && r.status === 'Canceled').length,
                failed: results.filter(r => !r.success).length
            }
        };
    }

    /**
     * Изменить параметры заказов массово
     */
    async changeOrdersParams(ordersParams) {
        const results = [];
        
        for (const orderParams of ordersParams) {
            try {
                const result = await this.dpdClient.changeOrderParams(orderParams);
                results.push({
                    orderNum: orderParams.order_num,
                    success: true,
                    status: result.paramResult?.status,
                    errorMessage: result.paramResult?.message
                });
                
                logger.info('Order parameters changed', { 
                    orderNum: orderParams.order_num, 
                    result 
                });
            } catch (error) {
                results.push({
                    orderNum: orderParams.order_num,
                    success: false,
                    error: error.message
                });
                
                logger.error('Error changing order parameters', { 
                    orderNum: orderParams.order_num, 
                    error: error.message 
                });
            }
        }
        
        return {
            success: true,
            results,
            summary: {
                total: ordersParams.length,
                changed: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length
            }
        };
    }

    // ========================================
    // ПЕЧАТЬ НАКЛЕЕК
    // ========================================

    /**
     * Сформировать файл с наклейками DPD
     */
    async createLabelFile(orders, options = {}) {
        try {
            const result = await this.dpdClient.createLabelFile(orders, options.fileFormat, options.pageSize);
            
            this.stats.labelPrints++;
            
            logger.info('Label file created', { 
                ordersCount: orders.length, 
                fileFormat: options.fileFormat,
                pageSize: options.pageSize 
            });
            
            return {
                success: true,
                data: result,
                summary: {
                    ordersCount: orders.length,
                    successfulOrders: result.orders.filter(o => o.status === 'OK').length,
                    failedOrders: result.orders.filter(o => o.status !== 'OK').length
                }
            };
        } catch (error) {
            logger.error('Error creating label file', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Получить параметры для печати наклейки
     */
    async getParcelLabelParams(parcels) {
        try {
            const result = await this.dpdClient.createParcelLabel(parcels);
            
            logger.info('Parcel label parameters retrieved', { parcelsCount: parcels.length });
            
            return {
                success: true,
                data: result
            };
        } catch (error) {
            logger.error('Error getting parcel label parameters', error);
            return { success: false, error: error.message };
        }
    }

    // ========================================
    // МОНИТОРИНГ И УВЕДОМЛЕНИЯ
    // ========================================

    /**
     * Запустить мониторинг проблемных заказов
     */
    startMonitoring() {
        if (this.monitoringTimer) {
            logger.warn('DPD Admin monitoring already running');
            return;
        }
        
        logger.info('Starting DPD Admin monitoring');
        this.monitoringTimer = setInterval(() => {
            this.monitorProblemOrders().catch(error => {
                logger.error('Error in DPD admin monitoring', error);
            });
        }, CONFIG.monitoringInterval);
    }

    /**
     * Остановить мониторинг
     */
    stopMonitoring() {
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
            this.monitoringTimer = null;
            logger.info('DPD Admin monitoring stopped');
        }
    }

    /**
     * Мониторинг проблемных заказов
     */
    async monitorProblemOrders() {
        try {
            const result = await this.getProblemOrders();
            
            if (result.success && result.data.length > 0) {
                // Отправляем уведомление администратору
                if (this.adminNotificationCallback) {
                    await this.adminNotificationCallback({
                        type: 'problem_orders',
                        count: result.data.length,
                        orders: result.data.slice(0, 5), // Первые 5 заказов
                        summary: result.summary
                    });
                }
                
                logger.info('Problem orders detected', { count: result.data.length });
            }
        } catch (error) {
            logger.error('Error in problem orders monitoring', error);
        }
    }

    /**
     * Установить callback для уведомлений администратору
     */
    setAdminNotificationCallback(callback) {
        this.adminNotificationCallback = callback;
        logger.info('Admin notification callback set');
    }

    // ========================================
    // УТИЛИТЫ
    // ========================================

    /**
     * Рассчитать сводку по суммам
     */
    _calculateAmountSummary(data) {
        let totalAmount = 0;
        const byService = {};
        
        for (const item of data) {
            totalAmount += parseFloat(item.amount || 0);
            const service = item.serviceCode || 'unknown';
            byService[service] = (byService[service] || 0) + parseFloat(item.amount || 0);
        }
        
        return {
            totalAmount,
            byService,
            count: data.length
        };
    }

    /**
     * Рассчитать сводку по счетам
     */
    _calculateInvoiceSummary(data) {
        let totalAmount = 0;
        const byInvoice = {};
        const byService = {};
        
        for (const item of data) {
            const amount = parseFloat(item.amount || 0);
            totalAmount += amount;
            
            const invoice = item.invoiceNum || 'unknown';
            byInvoice[invoice] = (byInvoice[invoice] || 0) + amount;
            
            const service = item.serviceCode || 'unknown';
            byService[service] = (byService[service] || 0) + amount;
        }
        
        return {
            totalAmount,
            invoicesCount: Object.keys(byInvoice).length,
            byInvoice,
            byService,
            count: data.length
        };
    }

    /**
     * Сгенерировать сводку по проблемным заказам
     */
    _generateProblemOrdersSummary(problemOrders) {
        const byStatus = {};
        const byTerminal = {};
        
        for (const order of problemOrders) {
            const status = order.eventCode;
            byStatus[status] = (byStatus[status] || 0) + 1;
            
            if (order.terminalCode) {
                byTerminal[order.terminalCode] = (byTerminal[order.terminalCode] || 0) + 1;
            }
        }
        
        return {
            total: problemOrders.length,
            byStatus,
            byTerminal,
            topTerminals: Object.entries(byTerminal)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5)
        };
    }

    /**
     * Извлечь код терминала из параметров события
     */
    _extractTerminalCode(parameters) {
        if (!parameters) return null;
        
        for (const param of parameters) {
            if (param.name === 'CodeDepartment') {
                return param.value;
            }
        }
        
        return null;
    }

    /**
     * Получить статистику
     */
    getStats() {
        return {
            ...this.stats,
            dpdClientStats: this.dpdClient.getStats(),
            receiptClientStats: this.receiptClient.getStats(),
            monitoringActive: !!this.monitoringTimer
        };
    }

    /**
     * Получить справочник причин отказа
     */
    static getRejectionReasons() {
        return REJECTION_REASONS;
    }

    /**
     * Получить конфигурацию
     */
    static getConfig() {
        return CONFIG;
    }
}

module.exports = { DPDAdmin, REJECTION_REASONS, CONFIG };