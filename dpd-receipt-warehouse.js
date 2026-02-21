/**
 * FlexyFrame DPD Receipt Warehouse Client
 * Клиент для работы с хранилищем чеков DPD (54-ФЗ)
 * 
 * Версия: 1.0.0
 * Покрытие API: Авторизация, получение чеков, подтверждение получения, 
 *               запрос по диапазону дат, запрос по ID чеков
 * 
 * Основано на интеграционном гиде DPD v1.44 (Январь 2026)
 */

const axios = require('axios');

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const CONFIG = {
    test: {
        restHost: 'https://dpd-receipt-warehouse-worker-stage.dpd.ru',
        apiPath: '/api/v1'
    },
    prod: {
        restHost: 'https://dpd-receipt-warehouse-external-api-prod.dpd.ru',
        apiPath: '/api/v1'
    }
};

// Справочник типов вложений
const UNIT_LOAD_TYPES = {
    0: 'Товар',
    1: 'Услуга'
};

// Справочник видов кодов товара
const PRODUCT_CODE_KINDS = {
    UNKNOWN: 'Не идентифицирован',
    GS1M: 'DataMatrix',
    JEWELRY: 'Ювелирные изделия',
    SHORT: 'Короткий',
    EAN13: 'EAN-13',
    EAN8: 'EAN-8',
    EGAIS20: 'ЕГАИС-2.0',
    EGAIS30: 'ЕГАИС-3.0',
    FUR: 'Меховые изделия',
    GS1: 'GS1',
    ITF14: 'ITF-14',
    KTF1: 'Ф.1',
    KTF2: 'Ф.2',
    KTF3: 'Ф.3',
    KTF4: 'Ф.4',
    KTF5: 'Ф.5',
    KTF6: 'Ф.6'
};

// Справочник статусов чеков
const RECEIPT_STATUSES = {
    0: 'Не подтвержден',
    1: 'Подтвержден'
};

// ============================================================
// КЛАСС DPD RECEIPT WAREHOUSE КЛИЕНТ
// ============================================================
class DPDReceiptWarehouseClient {
    constructor(options = {}) {
        this.clientNumber = options.clientNumber || process.env.DPD_CLIENT_NUMBER;
        this.clientKey = options.clientKey || process.env.DPD_CLIENT_KEY;
        this.testMode = options.testMode !== undefined ? options.testMode : (process.env.DPD_TEST_MODE === 'true');
        
        const env = this.testMode ? CONFIG.test : CONFIG.prod;
        this.restHost = env.restHost;
        this.apiPath = env.apiPath;
        
        // Сессия
        this.sessionId = null;
        this.sessionExpiry = null;
        
        // Статистика
        this.stats = {
            totalCalls: 0,
            successCalls: 0,
            failedCalls: 0,
            lastCallTime: null
        };
        
        if (!this.clientNumber || !this.clientKey) {
            throw new Error('Требуются clientNumber и clientKey для DPD Receipt Warehouse API');
        }
    }

    // ========================================
    // ВНУТРЕННИЕ МЕТОДЫ
    // ========================================

    _getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.sessionId) {
            headers['session-ID'] = this.sessionId;
        }
        return headers;
    }

    _makeRequest(method, path, data = null) {
        const url = `${this.restHost}${this.apiPath}${path}`;
        
        this.stats.totalCalls++;
        this.stats.lastCallTime = new Date();
        
        return axios({
            method,
            url,
            data,
            headers: this._getHeaders(),
            timeout: 30000
        }).then(response => {
            this.stats.successCalls++;
            return response.data;
        }).catch(error => {
            this.stats.failedCalls++;
            const status = error.response?.status;
            const msg = error.response?.data?.message || error.message;
            throw new Error(`DPD Receipt Warehouse ${path} [${status}]: ${msg}`);
        });
    }

    _ensureAuth() {
        if (!this.sessionId || (this.sessionExpiry && Date.now() > this.sessionExpiry)) {
            return this.authorization();
        }
        return Promise.resolve();
    }

    // ========================================
    // 1. АВТОРИЗАЦИЯ
    // ========================================

    /**
     * Авторизация, получение sessionID
     */
    async authorization() {
        const headers = {
            'Client-Number': this.clientNumber,
            'Client-Key': this.clientKey
        };
        
        const response = await axios({
            method: 'POST',
            url: `${this.restHost}${this.apiPath}/authorization`,
            headers
        });
        
        const result = response.data;
        if (result.sessionID) {
            this.sessionId = result.sessionID;
            // Сессия живет 12 часов
            this.sessionExpiry = Date.now() + (12 * 60 * 60 * 1000);
        }
        
        return result;
    }

    // ========================================
    // 2. ПОЛУЧЕНИЕ КОЛИЧЕСТВА ЧЕКОВ
    // ========================================

    /**
     * Получение количества новых (неподтверждённых) чеков
     */
    async quantity() {
        await this._ensureAuth();
        return this._makeRequest('GET', '/quantity');
    }

    // ========================================
    // 3. ЗАПРОС ЧЕКОВ
    // ========================================

    /**
     * Запросить получение чеков
     */
    async request(maxNumberOfReceipts = null) {
        await this._ensureAuth();
        
        const data = {};
        if (maxNumberOfReceipts) {
            data.maxNumberOfReceipts = maxNumberOfReceipts;
        }
        
        return this._makeRequest('POST', '/request', data);
    }

    /**
     * Запросить чеки за период (для сверки)
     */
    async range(dateFrom, dateTo) {
        await this._ensureAuth();
        
        const params = new URLSearchParams({
            dateFrom: dateFrom.toISOString(),
            dateTo: dateTo.toISOString()
        });
        
        return this._makeRequest('GET', `/range?${params.toString()}`);
    }

    /**
     * Запросить чеки по ID
     */
    async requestByIds(receiptIds) {
        await this._ensureAuth();
        
        const params = new URLSearchParams({
            requestReceipts: receiptIds.join(',')
        });
        
        return this._makeRequest('GET', `/request-by-ids?${params.toString()}`);
    }

    // ========================================
    // 4. ПОДТВЕРЖДЕНИЕ ПОЛУЧЕНИЯ ЧЕКОВ
    // ========================================

    /**
     * Подтверждение получения чеков по ID чека
     */
    async confirm(receiptIds, requestId = null) {
        await this._ensureAuth();
        
        const data = {
            dataConfirm: {}
        };
        
        if (requestId) {
            data.dataConfirm.requestID = requestId;
        }
        if (receiptIds && receiptIds.length > 0) {
            data.dataConfirm.receiptsID = receiptIds;
        }
        
        return this._makeRequest('POST', '/confirm', data);
    }

    // ========================================
    // 5. УТИЛИТЫ И ПОМОЩЬ
    // ========================================

    /**
     * Получить статистику
     */
    getStats() {
        return {
            ...this.stats,
            sessionId: this.sessionId,
            sessionExpiry: this.sessionExpiry,
            testMode: this.testMode,
            restHost: this.restHost
        };
    }

    /**
     * Очистить сессию
     */
    clearSession() {
        this.sessionId = null;
        this.sessionExpiry = null;
    }

    /**
     * Получить справочник типов вложений
     */
    static getUnitLoadTypes() {
        return UNIT_LOAD_TYPES;
    }

    /**
     * Получить справочник видов кодов товара
     */
    static getProductCodeKinds() {
        return PRODUCT_CODE_KINDS;
    }

    /**
     * Получить справочник статусов чеков
     */
    static getReceiptStatuses() {
        return RECEIPT_STATUSES;
    }

    /**
     * Форматировать дату для API
     */
    static formatDate(date) {
        if (date instanceof Date) {
            return date.toISOString();
        }
        return new Date(date).toISOString();
    }

    /**
     * Проверить валидность чека
     */
    static validateReceipt(receipt) {
        const required = ['receiptId', 'status', 'totalAmount', 'createDate'];
        const missing = required.filter(field => !receipt[field]);
        
        if (missing.length > 0) {
            return { valid: false, error: `Отсутствуют обязательные поля: ${missing.join(', ')}` };
        }
        
        if (receipt.unitLoad && Array.isArray(receipt.unitLoad)) {
            for (let i = 0; i < receipt.unitLoad.length; i++) {
                const item = receipt.unitLoad[i];
                const itemRequired = ['type', 'name', 'quantity', 'price', 'amount'];
                const itemMissing = itemRequired.filter(field => !item[field]);
                
                if (itemMissing.length > 0) {
                    return { valid: false, error: `Вложение ${i + 1}: отсутствуют поля: ${itemMissing.join(', ')}` };
                }
            }
        }
        
        return { valid: true };
    }
}

module.exports = { DPDReceiptWarehouseClient, UNIT_LOAD_TYPES, PRODUCT_CODE_KINDS, RECEIPT_STATUSES, CONFIG };