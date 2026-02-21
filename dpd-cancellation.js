/**
 * FlexyFrame DPD Order Cancellation System
 * Система отмены заказов и управления возвратами
 * 
 * Версия: 1.0.0
 * Функционал: Отмена заказов, создание возвратных заказов,
 *            управление возвратами, проверка условий отмены
 * 
 * Основано на интеграционном гиде DPD v1.44 (Январь 2026)
 */

const { DPDClient } = require('./dpd-api');
const logger = require('./logger');

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const CONFIG = {
    // Максимальное время для отмены заказа (в часах)
    maxCancelHours: 24,
    
    // Статусы, при которых можно отменить заказ
    cancelableStatuses: [
        'NewOrderByClient',
        'OnTerminalPickup',
        'OnRoad',
        'OnTerminal'
    ],
    
    // Статусы, при которых нельзя отменить заказ
    nonCancelableStatuses: [
        'Delivering',
        'Delivered',
        'Lost',
        'Problem',
        'NotDone'
    ],
    
    // Причины отмены заказа
    cancellationReasons: {
        'customer_request': 'По запросу клиента',
        'duplicate_order': 'Дубликат заказа',
        'wrong_address': 'Неверный адрес',
        'product_unavailable': 'Товар недоступен',
        'payment_failed': 'Ошибка оплаты',
        'other': 'Другое'
    }
};

// Справочник статусов заказов
const ORDER_STATUSES = {
    'NewOrderByClient': 'Новый заказ клиента',
    'NotDone': 'Отменен',
    'OnTerminalPickup': 'На терминале приема',
    'OnRoad': 'В пути',
    'OnTerminal': 'На терминале доставки',
    'Delivering': 'Доставляется',
    'Delivered': 'Доставлен',
    'Lost': 'Утерян',
    'Problem': 'Проблема'
};

// ============================================================
// КЛАСС DPD CANCELLATION
// ============================================================
class DPDCancellation {
    constructor(options = {}) {
        this.dpdClient = new DPDClient(options);
        
        // Хранилище отмененных заказов
        this.canceledOrders = new Map();
        
        // Хранилище возвратных заказов
        this.returnOrders = new Map();
        
        // Статистика
        this.stats = {
            totalCancellations: 0,
            successfulCancellations: 0,
            failedCancellations: 0,
            totalReturns: 0,
            successfulReturns: 0,
            failedReturns: 0,
            lastCancellationTime: null,
            lastReturnTime: null
        };
        
        logger.info('DPD Cancellation system initialized');
    }

    // ========================================
    // ОТМЕНА ЗАКАЗОВ
    // ========================================

    /**
     * Отменить заказ
     */
    async cancelOrder(clientOrderNr, reason = 'other', pickupDate = null) {
        try {
            // Проверяем возможность отмены
            const canCancel = await this.canCancelOrder(clientOrderNr, pickupDate);
            
            if (!canCancel.allowed) {
                return {
                    success: false,
                    error: `Нельзя отменить заказ: ${canCancel.reason}`,
                    reason: canCancel.reason
                };
            }
            
            // Выполняем отмену
            const result = await this.dpdClient.cancelOrder({
                clientOrderNr,
                pickupDate
            });
            
            this.stats.totalCancellations++;
            this.stats.lastCancellationTime = new Date();
            
            if (result && result[0]) {
                const orderResult = result[0];
                
                if (orderResult.status === 'Canceled') {
                    this.stats.successfulCancellations++;
                    
                    // Сохраняем информацию об отмене
                    this.canceledOrders.set(clientOrderNr, {
                        reason,
                        status: 'canceled',
                        timestamp: new Date(),
                        dpdOrderNr: orderResult.orderNum,
                        errorMessage: orderResult.errorMessage
                    });
                    
                    logger.info('Order canceled successfully', { 
                        clientOrderNr, 
                        reason, 
                        dpdOrderNr: orderResult.orderNum 
                    });
                    
                    return {
                        success: true,
                        status: orderResult.status,
                        dpdOrderNr: orderResult.orderNum,
                        reason,
                        message: 'Заказ успешно отменен'
                    };
                } else {
                    this.stats.failedCancellations++;
                    
                    logger.warn('Order cancellation failed', { 
                        clientOrderNr, 
                        reason, 
                        status: orderResult.status,
                        errorMessage: orderResult.errorMessage 
                    });
                    
                    return {
                        success: false,
                        status: orderResult.status,
                        reason,
                        error: orderResult.errorMessage || 'Неизвестная ошибка отмены'
                    };
                }
            } else {
                this.stats.failedCancellations++;
                return {
                    success: false,
                    error: 'Нет данных о результате отмены'
                };
            }
        } catch (error) {
            this.stats.failedCancellations++;
            logger.error('Error canceling order', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Проверить возможность отмены заказа
     */
    async canCancelOrder(clientOrderNr, pickupDate = null) {
        try {
            // Проверяем, не отменен ли уже заказ
            if (this.canceledOrders.has(clientOrderNr)) {
                return {
                    allowed: false,
                    reason: 'Заказ уже отменен'
                };
            }
            
            // Получаем статус заказа
            const statusResult = await this.dpdClient.getOrderStatus(clientOrderNr, pickupDate);
            
            if (!statusResult || !statusResult.status) {
                return {
                    allowed: false,
                    reason: 'Не удалось получить статус заказа'
                };
            }
            
            const currentStatus = statusResult.status;
            
            // Проверяем, можно ли отменить по статусу
            if (CONFIG.nonCancelableStatuses.includes(currentStatus)) {
                return {
                    allowed: false,
                    reason: `Нельзя отменить заказ со статусом: ${ORDER_STATUSES[currentStatus] || currentStatus}`
                };
            }
            
            if (!CONFIG.cancelableStatuses.includes(currentStatus)) {
                return {
                    allowed: false,
                    reason: `Статус заказа не поддерживает отмену: ${ORDER_STATUSES[currentStatus] || currentStatus}`
                };
            }
            
            // Проверяем время с момента создания заказа
            if (pickupDate) {
                const pickupTime = new Date(pickupDate);
                const now = new Date();
                const hoursDiff = (now - pickupTime) / (1000 * 60 * 60);
                
                if (hoursDiff > CONFIG.maxCancelHours) {
                    return {
                        allowed: false,
                        reason: `Превышено максимальное время для отмены заказа (${CONFIG.maxCancelHours} часов)`
                    };
                }
            }
            
            return {
                allowed: true,
                reason: 'Можно отменить',
                currentStatus
            };
        } catch (error) {
            logger.error('Error checking cancellation possibility', error);
            return {
                allowed: false,
                reason: `Ошибка проверки: ${error.message}`
            };
        }
    }

    /**
     * Отменить несколько заказов
     */
    async cancelMultipleOrders(orders) {
        const results = [];
        
        for (const order of orders) {
            const result = await this.cancelOrder(
                order.clientOrderNr, 
                order.reason || 'other', 
                order.pickupDate
            );
            
            results.push({
                clientOrderNr: order.clientOrderNr,
                ...result
            });
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        logger.info('Multiple orders cancellation completed', { 
            total: orders.length, 
            successful, 
            failed 
        });
        
        return {
            success: true,
            results,
            summary: {
                total: orders.length,
                successful,
                failed
            }
        };
    }

    // ========================================
    // УПРАВЛЕНИЕ ВОЗВРАТАМИ
    // ========================================

    /**
     * Создать возвратный заказ
     */
    async createReturnOrder(originalOrder, returnData) {
        try {
            // Проверяем, доставлен ли исходный заказ
            const statusResult = await this.dpdClient.getOrderStatus(
                originalOrder.clientOrderNr, 
                originalOrder.pickupDate
            );
            
            if (statusResult.status !== 'Delivered') {
                return {
                    success: false,
                    error: 'Нельзя создать возврат для недоставленного заказа'
                };
            }
            
            // Формируем данные для возвратного заказа
            const returnOrderData = {
                ...originalOrder,
                orderNumberInternal: returnData.returnOrderNumber || `${originalOrder.orderNumberInternal}_RETURN`,
                serviceCode: returnData.serviceCode || originalOrder.serviceCode,
                deliveryTimePeriod: returnData.deliveryTimePeriod || originalOrder.deliveryTimePeriod,
                paymentType: returnData.paymentType || 'ОУП', // Оплата у получателя
                extraService: returnData.extraService || [],
                
                // Меняем адреса местами
                receiverAddress: originalOrder.senderAddress,
                senderAddress: originalOrder.receiverAddress,
                
                // Добавляем информацию о возврате
                returnInfo: {
                    originalOrderNumber: originalOrder.orderNumberInternal,
                    returnReason: returnData.returnReason || 'Возврат товара',
                    returnDate: new Date().toISOString(),
                    returnItems: returnData.returnItems || []
                }
            };
            
            // Создаем возвратный заказ
            const result = await this.dpdClient.createOrder(returnOrderData);
            
            this.stats.totalReturns++;
            this.stats.lastReturnTime = new Date();
            
            if (result && result.orderNum) {
                this.stats.successfulReturns++;
                
                // Сохраняем информацию о возврате
                this.returnOrders.set(returnOrderData.orderNumberInternal, {
                    originalOrderNumber: originalOrder.orderNumberInternal,
                    returnOrderNumber: result.orderNum,
                    status: 'created',
                    timestamp: new Date(),
                    returnReason: returnData.returnReason,
                    returnItems: returnData.returnItems
                });
                
                logger.info('Return order created successfully', { 
                    originalOrder: originalOrder.orderNumberInternal,
                    returnOrder: result.orderNum,
                    returnReason: returnData.returnReason 
                });
                
                return {
                    success: true,
                    returnOrderNumber: result.orderNum,
                    originalOrderNumber: originalOrder.orderNumberInternal,
                    message: 'Возвратный заказ успешно создан'
                };
            } else {
                this.stats.failedReturns++;
                return {
                    success: false,
                    error: 'Не удалось создать возвратный заказ'
                };
            }
        } catch (error) {
            this.stats.failedReturns++;
            logger.error('Error creating return order', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Получить информацию о возврате
     */
    getReturnInfo(returnOrderNumber) {
        return this.returnOrders.get(returnOrderNumber) || null;
    }

    /**
     * Получить все возвраты для заказа
     */
    getReturnsForOrder(originalOrderNumber) {
        const returns = [];
        
        for (const [returnNumber, returnInfo] of this.returnOrders.entries()) {
            if (returnInfo.originalOrderNumber === originalOrderNumber) {
                returns.push({
                    returnOrderNumber: returnNumber,
                    ...returnInfo
                });
            }
        }
        
        return returns;
    }

    // ========================================
    // МОНИТОРИНГ И АНАЛИТИКА
    // ========================================

    /**
     * Получить статистику по отменам
     */
    getStatistics() {
        const cancellationRate = this.stats.totalCancellations > 0 
            ? (this.stats.successfulCancellations / this.stats.totalCancellations) * 100 
            : 0;
            
        const returnRate = this.stats.totalReturns > 0 
            ? (this.stats.successfulReturns / this.stats.totalReturns) * 100 
            : 0;
        
        return {
            cancellations: {
                total: this.stats.totalCancellations,
                successful: this.stats.successfulCancellations,
                failed: this.stats.failedCancellations,
                successRate: Math.round(cancellationRate * 100) / 100,
                lastCancellationTime: this.stats.lastCancellationTime
            },
            returns: {
                total: this.stats.totalReturns,
                successful: this.stats.successfulReturns,
                failed: this.stats.failedReturns,
                successRate: Math.round(returnRate * 100) / 100,
                lastReturnTime: this.stats.lastReturnTime
            },
            summary: {
                totalOperations: this.stats.totalCancellations + this.stats.totalReturns,
                totalSuccessful: this.stats.successfulCancellations + this.stats.successfulReturns,
                totalFailed: this.stats.failedCancellations + this.stats.failedReturns
            }
        };
    }

    /**
     * Получить список отмененных заказов
     */
    getCanceledOrders() {
        return Array.from(this.canceledOrders.entries()).map(([clientOrderNr, info]) => ({
            clientOrderNr,
            ...info
        }));
    }

    /**
     * Получить список возвратных заказов
     */
    getReturnOrders() {
        return Array.from(this.returnOrders.entries()).map(([returnOrderNumber, info]) => ({
            returnOrderNumber,
            ...info
        }));
    }

    /**
     * Очистить историю операций
     */
    clearHistory() {
        this.canceledOrders.clear();
        this.returnOrders.clear();
        
        this.stats = {
            totalCancellations: 0,
            successfulCancellations: 0,
            failedCancellations: 0,
            totalReturns: 0,
            successfulReturns: 0,
            failedReturns: 0,
            lastCancellationTime: null,
            lastReturnTime: null
        };
        
        logger.info('Cancellation history cleared');
    }

    // ========================================
    // УТИЛИТЫ
    // ========================================

    /**
     * Проверить статус заказа для отмены
     */
    async checkOrderStatusForCancellation(clientOrderNr, pickupDate = null) {
        try {
            const statusResult = await this.dpdClient.getOrderStatus(clientOrderNr, pickupDate);
            
            if (!statusResult || !statusResult.status) {
                return {
                    valid: false,
                    error: 'Не удалось получить статус заказа'
                };
            }
            
            const currentStatus = statusResult.status;
            const canCancel = CONFIG.cancelableStatuses.includes(currentStatus);
            const cannotCancel = CONFIG.nonCancelableStatuses.includes(currentStatus);
            
            return {
                valid: true,
                status: currentStatus,
                statusName: ORDER_STATUSES[currentStatus] || currentStatus,
                canCancel,
                cannotCancel,
                message: canCancel 
                    ? 'Заказ можно отменить' 
                    : (cannotCancel 
                        ? `Нельзя отменить: ${ORDER_STATUSES[currentStatus] || currentStatus}` 
                        : 'Статус не поддерживает отмену')
            };
        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }

    /**
     * Получить справочник причин отмены
     */
    static getCancellationReasons() {
        return CONFIG.cancellationReasons;
    }

    /**
     * Получить справочник статусов заказов
     */
    static getOrderStatuses() {
        return ORDER_STATUSES;
    }

    /**
     * Получить конфигурацию
     */
    static getConfig() {
        return CONFIG;
    }
}

module.exports = { DPDCancellation, CONFIG, ORDER_STATUSES };