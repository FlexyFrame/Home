/**
 * FlexyFrame DPD API Client
 * Полноценный клиент для работы с API службы доставки DPD (Russia)
 * 
 * Версия: 5.0.0
 * Покрытие API: География, Расчёт стоимости, Создание/Изменение/Отмена заказа,
 *               Отслеживание статуса, Печать наклеек, Отчёты, Справочная информация,
 *               Управление доставкой, Хранилище чеков
 * 
 * Основано на интеграционном гиде DPD v1.44 (Январь 2026)
 */

const soap = require('soap');
const axios = require('axios');

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const CONFIG = {
    test: {
        hostname: 'wstest.dpd.ru',
        restHost: 'https://wstest.dpd.ru',
        services: {
            geography: 'geography2',
            calculator: 'calculator2',
            order: 'order2',
            tracing: 'tracing1-1',
            eventTracking: 'event-tracking',
            labelPrint: 'label-print',
            reports: 'nl',
            inquiryDesk: 'inquiry-desk'
        }
    },
    prod: {
        hostname: 'ws.dpd.ru',
        restHost: 'https://ws.dpd.ru',
        services: {
            geography: 'geography2',
            calculator: 'calculator2',
            order: 'order2',
            tracing: 'tracing1-1',
            eventTracking: 'event-tracking',
            labelPrint: 'label-print',
            reports: 'nl',
            inquiryDesk: 'inquiry-desk'
        }
    }
};

// Справочник услуг DPD
const DPD_SERVICES = {
    BZP: 'DPD 18:00',
    ECN: 'DPD ECONOMY',
    ECU: 'DPD ECONOMY CU',
    CUR: 'DPD CLASSIC',
    NDY: 'DPD EXPRESS',
    CSM: 'DPD Online Express',
    PCL: 'DPD OPTIMUM',
    PUP: 'DPD SHOP',
    DPI: 'DPD CLASSIC international IMPORT',
    DPE: 'DPD CLASSIC international EXPORT',
    MAX: 'DPD MAX domestic',
    MXO: 'DPD Standart',
    IND: 'DPD Express 13'
};

// Справочник статусов событий
const EVENT_CODES = {
    1001: 'Получена заявка',
    1101: 'В заявке присутствует ошибка',
    1301: 'Отмена заявки',
    1401: 'Заказ создан',
    1501: 'Заказ ожидает дату приема',
    1601: 'Заказ принят у отправителя',
    1801: 'Закончено таможенное оформление',
    1802: 'Прибыл на первый сортировочный комплекс DPD',
    2101: 'Заказ следует по маршруту до терминала доставки',
    2201: 'Заказ готов к выдаче на пункте',
    2202: 'Заказ готов к передаче курьеру для доставки',
    2301: 'Заказ доставляется получателю',
    2309: 'Заказ доставляется отправителю',
    2401: 'Истек срок бесплатного хранения заказа',
    2402: 'Оплата за товар не произведена получателем',
    2404: 'Отказ от заказа в момент доставки',
    2405: 'Отказ от заказа через Управление доставкой',
    2406: 'Отказ от заказа через контакт центр',
    2407: 'Получатель отсутствует на адресе доставки',
    2408: 'Указан неправильный адрес доставки',
    2409: 'Задержано на таможне',
    2410: 'Другие проблемы при доставке',
    2416: 'Отмена заказа клиентом по пути на терминал доставки',
    2501: 'Услуга не оказана',
    2601: 'Произведен предварительный расчет стоимости доставки',
    2602: 'Выставлен счет',
    2701: 'Наложенный платёж принят у получателя',
    2801: 'Наложенный платёж перечислен',
    2901: 'Заказ отменен',
    3201: 'Перенос даты доставки по инициативе DPD',
    3202: 'Изменены условия доставки получателем во время доставки',
    3203: 'Изменены условия доставки через Управление доставкой',
    3204: 'Изменены условия доставки через call-centre',
    3301: 'Заказ утилизирован',
    3302: 'Посылка не востребована',
    3303: 'Заказ утерян',
    3304: 'Заказ доставлен до двери',
    3305: 'Заказ выдан на ПВЗ',
    3306: 'Заказ на возврат доставлен',
    3701: 'Заказ поврежден'
};

// Кэш для SOAP клиентов
const soapClientCache = new Map();

// Кэш данных (география, ПВЗ)
const dataCache = new Map();
const CACHE_TTL = {
    geography: 24 * 60 * 60 * 1000,  // 24 часа
    parcelShops: 8 * 60 * 60 * 1000, // 8 часов
    terminals: 24 * 60 * 60 * 1000,  // 24 часа
    default: 60 * 60 * 1000          // 1 час
};

// ============================================================
// КЛАСС DPD КЛИЕНТ
// ============================================================
class DPDClient {
    constructor(options = {}) {
        this.clientNumber = options.clientNumber || process.env.DPD_CLIENT_NUMBER;
        this.clientKey = options.clientKey || process.env.DPD_CLIENT_KEY;
        this.testMode = options.testMode !== undefined ? options.testMode : (process.env.DPD_TEST_MODE === 'true');
        
        const env = this.testMode ? CONFIG.test : CONFIG.prod;
        this.hostname = env.hostname;
        this.restHost = env.restHost;
        this.services = env.services;
        
        // Retry настройки
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000;
        
        // Статистика
        this.stats = {
            totalCalls: 0,
            successCalls: 0,
            failedCalls: 0,
            lastCallTime: null
        };
        
        if (!this.clientNumber || !this.clientKey) {
            throw new Error('Требуются clientNumber и clientKey для DPD API');
        }
    }

    // ========================================
    // ВНУТРЕННИЕ МЕТОДЫ
    // ========================================

    _getAuth() {
        return {
            clientNumber: parseInt(this.clientNumber),
            clientKey: this.clientKey
        };
    }

    _getRestAuth() {
        return {
            clientNumber: parseInt(this.clientNumber),
            clientKey: this.clientKey
        };
    }

    /**
     * Получить SOAP клиент с кэшированием
     */
    async _getClient(serviceName) {
        const cacheKey = `${this.hostname}:${serviceName}`;
        
        if (soapClientCache.has(cacheKey)) {
            return soapClientCache.get(cacheKey);
        }
        
        const serviceEndpoint = this.services[serviceName];
        if (!serviceEndpoint) {
            throw new Error(`Неизвестный сервис DPD: ${serviceName}`);
        }
        
        const wsdlUrl = `https://${this.hostname}/services/${serviceEndpoint}?wsdl`;
        
        return new Promise((resolve, reject) => {
            soap.createClient(wsdlUrl, {
                ignoredNamespaces: {
                    override: true,
                    namespaces: ['targetNamespace', 'typedNamespace']
                }
            }, (err, client) => {
                if (err) {
                    reject(new Error(`Не удалось подключиться к DPD сервису ${serviceName}: ${err.message}`));
                } else {
                    soapClientCache.set(cacheKey, client);
                    resolve(client);
                }
            });
        });
    }

    /**
     * Вызвать SOAP метод с retry-логикой
     */
    async _call(serviceName, methodName, args, retryCount = 0) {
        this.stats.totalCalls++;
        this.stats.lastCallTime = new Date();
        
        try {
            const client = await this._getClient(serviceName);
            
            const result = await new Promise((resolve, reject) => {
                client[methodName](args, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
            
            this.stats.successCalls++;
            return result;
        } catch (error) {
            if (retryCount < this.maxRetries && this._isRetryableError(error)) {
                const delay = this.retryDelay * Math.pow(2, retryCount);
                console.warn(`DPD API retry ${retryCount + 1}/${this.maxRetries} для ${methodName} через ${delay}ms`);
                await this._sleep(delay);
                
                // Очистить кэш клиента при ошибке подключения
                const cacheKey = `${this.hostname}:${serviceName}`;
                soapClientCache.delete(cacheKey);
                
                return this._call(serviceName, methodName, args, retryCount + 1);
            }
            
            this.stats.failedCalls++;
            throw error;
        }
    }

    /**
     * REST вызов (для Управления доставкой)
     */
    async _restCall(method, path, data = null) {
        const url = `${this.restHost}/rest/predict/${path}`;
        
        try {
            const response = await axios({
                method,
                url,
                data: data ? { request: { Auth: this._getRestAuth(), ...data } } : undefined,
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const msg = error.response?.data?.message || error.message;
            throw new Error(`DPD REST ${path} [${status}]: ${msg}`);
        }
    }

    _isRetryableError(error) {
        const msg = (error.message || '').toLowerCase();
        return msg.includes('econnrefused') || 
               msg.includes('econnreset') || 
               msg.includes('etimedout') ||
               msg.includes('socket hang up') ||
               msg.includes('call-client-twin');
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Кэширование данных
     */
    _getCached(key) {
        const cached = dataCache.get(key);
        if (cached && Date.now() - cached.timestamp < cached.ttl) {
            return cached.data;
        }
        dataCache.delete(key);
        return null;
    }

    _setCache(key, data, ttl) {
        dataCache.set(key, { data, timestamp: Date.now(), ttl });
    }

    /**
     * Нормализация массива из SOAP ответа
     */
    _toArray(data) {
        if (!data) return [];
        return Array.isArray(data) ? data : [data];
    }

    // ========================================
    // 1. ГЕОГРАФИЯ DPD
    // ========================================

    /**
     * Получить список городов с наложенным платежом
     */
    async getCitiesCashPay(countryCode = 'RU') {
        const cacheKey = `cities_cash_pay_${countryCode}`;
        const cached = this._getCached(cacheKey);
        if (cached) return cached;

        const result = await this._call('geography', 'getCitiesCashPay', {
            request: { auth: this._getAuth(), countryCode }
        });
        
        const cities = this._toArray(result?.return);
        this._setCache(cacheKey, cities, CACHE_TTL.geography);
        return cities;
    }

    /**
     * Получить список ПВЗ (пунктов выдачи заказов)
     */
    async getParcelShops(params = {}) {
        const cacheKey = `parcel_shops_${JSON.stringify(params)}`;
        const cached = this._getCached(cacheKey);
        if (cached) return cached;

        const result = await this._call('geography', 'getParcelShops', {
            request: { auth: this._getAuth(), ...params }
        });
        
        const shops = this._toArray(result?.return?.parcelShop || result?.return);
        this._setCache(cacheKey, shops, CACHE_TTL.parcelShops);
        return shops;
    }

    /**
     * Получить список терминалов DPD (без ограничений по габаритам)
     */
    async getTerminalsSelfDelivery2() {
        const cacheKey = 'terminals_self_delivery';
        const cached = this._getCached(cacheKey);
        if (cached) return cached;

        const result = await this._call('geography', 'getTerminalsSelfDelivery2', {
            request: { auth: this._getAuth() }
        });
        
        const terminals = this._toArray(result?.return?.terminal);
        this._setCache(cacheKey, terminals, CACHE_TTL.terminals);
        return terminals;
    }

    /**
     * Получить срок бесплатного хранения на ПВЗ
     */
    async getStoragePeriod(terminalCodes, serviceCodes = null) {
        const args = {
            request: {
                auth: this._getAuth(),
                terminalCode: Array.isArray(terminalCodes) ? terminalCodes.join(',') : terminalCodes
            }
        };
        if (serviceCodes) {
            args.request.serviceCode = Array.isArray(serviceCodes) ? serviceCodes.join(',') : serviceCodes;
        }
        
        const result = await this._call('geography', 'getStoragePeriod', args);
        return this._toArray(result?.return?.terminal);
    }

    /**
     * Получить список возможных доп. услуг
     */
    async getPossibleExtraService(params) {
        const result = await this._call('geography', 'getPossibleExtraService', {
            request: { auth: this._getAuth(), ...params }
        });
        return this._toArray(result?.return?.extraService || result?.return);
    }

    // ========================================
    // 2. РАСЧЁТ СТОИМОСТИ
    // ========================================

    /**
     * Рассчитать стоимость доставки (Россия и ТС)
     */
    async getServiceCost2(params) {
        const result = await this._call('calculator', 'getServiceCost2', {
            request: { auth: this._getAuth(), ...params }
        });
        return this._parseCalculatorResult(result);
    }

    /**
     * Рассчитать стоимость с учётом доп. услуг (опций)
     */
    async getServiceCost3(params) {
        const result = await this._call('calculator', 'getServiceCost3', {
            request: { auth: this._getAuth(), ...params }
        });
        return this._parseCalculatorResult(result);
    }

    /**
     * Рассчитать стоимость по параметрам посылок
     */
    async getServiceCostByParcels2(params) {
        const result = await this._call('calculator', 'getServiceCostByParcels2', {
            request: { auth: this._getAuth(), ...params }
        });
        return this._parseCalculatorResult(result);
    }

    /**
     * Рассчитать стоимость по параметрам посылок с опциями
     */
    async getServiceCostByParcels3(params) {
        const result = await this._call('calculator', 'getServiceCostByParcels3', {
            request: { auth: this._getAuth(), ...params }
        });
        return this._parseCalculatorResult(result);
    }

    /**
     * Рассчитать стоимость международной доставки
     */
    async getServiceCostInternational(params) {
        const result = await this._call('calculator', 'getServiceCostInternational', {
            request: { auth: this._getAuth(), ...params }
        });
        return this._parseCalculatorResult(result);
    }

    /**
     * Рассчитать стоимость международной доставки с опциями
     */
    async getServiceCostInternational2(params) {
        const result = await this._call('calculator', 'getServiceCostInternational2', {
            request: { auth: this._getAuth(), ...params }
        });
        return this._parseCalculatorResult(result);
    }

    /**
     * Универсальный расчёт стоимости (обёртка)
     */
    async calculateCost(params) {
        try {
            // Если есть extraService — используем v3 методы
            const hasExtras = params.extraService && params.extraService.length > 0;
            const hasParcels = params.parcel && params.parcel.length > 0;
            
            let result;
            if (hasParcels && hasExtras) {
                result = await this.getServiceCostByParcels3(params);
            } else if (hasParcels) {
                result = await this.getServiceCostByParcels2(params);
            } else if (hasExtras) {
                result = await this.getServiceCost3(params);
            } else {
                result = await this.getServiceCost2(params);
            }
            
            return result;
        } catch (error) {
            return { success: false, error: error.message, services: [], duplicates: null };
        }
    }

    _parseCalculatorResult(result) {
        // Проверка на ошибку too-many-rows
        if (result?.return?.code === 'too-many-rows') {
            return {
                success: false,
                error: 'too-many-rows',
                message: result.return.message || 'Неоднозначно задан населенный пункт',
                pickupDups: this._toArray(result.return.pickupDups),
                deliveryDups: this._toArray(result.return.deliveryDups),
                services: []
            };
        }

        if (!result?.return) {
            return { success: true, services: [] };
        }

        const services = this._toArray(result.return);
        return {
            success: true,
            services: services.map(s => ({
                serviceCode: s.serviceCode || s.serviceCоde,
                serviceName: s.serviceName || DPD_SERVICES[s.serviceCode] || '',
                cost: parseFloat(s.cost) || 0,
                totalCost: parseFloat(s.totalCost2 || s.cost) || 0,
                minDays: parseInt(s.minDays2 || s.days) || 0,
                maxDays: parseInt(s.maxDays2 || s.days) || 0,
                days: parseInt(s.days) || 0,
                weight: parseFloat(s.weight) || 0,
                volume: parseFloat(s.volume1) || 0,
                costExtraServices: this._toArray(s.costExtraService2).map(es => ({
                    name: es.name,
                    cost: parseFloat(es.cost) || 0
                }))
            }))
        };
    }

    // ========================================
    // 3. СОЗДАНИЕ ЗАКАЗА
    // ========================================

    /**
     * Создать заказ на доставку
     */
    async createOrder(orderData) {
        const result = await this._call('order', 'createOrder', {
            orders: {
                auth: this._getAuth(),
                header: orderData.header,
                order: orderData.order || orderData
            }
        });
        
        const orders = this._toArray(result?.return);
        return orders.map(o => ({
            orderNumberInternal: o.orderNumberInternal,
            orderNum: o.orderNum,
            status: o.status,
            errorMessage: o.errorMessage,
            pickupDate: o.pickupDate
        }));
    }

    /**
     * Создать заказ v2 (с расширенным ответом)
     */
    async createOrder2(orderData) {
        const result = await this._call('order', 'createOrder2', {
            orders: {
                auth: this._getAuth(),
                header: orderData.header,
                order: orderData.order || orderData
            }
        });
        
        const orders = this._toArray(result?.return);
        return orders.map(o => ({
            orderNumberInternal: o.orderNumberInternal,
            orderNum: o.orderNum,
            status: o.status,
            errorMessage: o.errorMessage,
            pickupDate: o.pickupDate,
            dateFlag: o.dateFlag
        }));
    }

    /**
     * Получить статус создания заказа
     */
    async getOrderStatus(orderNumberInternal, datePickup = null) {
        const args = {
            orderStatus: {
                auth: this._getAuth(),
                order: {
                    orderNumberInternal
                }
            }
        };
        if (datePickup) {
            args.orderStatus.order.datePickup = datePickup;
        }
        
        const result = await this._call('order', 'getOrderStatus', args);
        const orders = this._toArray(result?.return);
        return orders.map(o => ({
            orderNumberInternal: o.orderNumberInternal,
            orderNum: o.orderNum,
            status: o.status,
            errorMessage: o.errorMessage
        }));
    }

    /**
     * Получить файл накладной (PDF)
     */
    async getInvoiceFile(orderNum, parcelCount = null, cargoValue = null) {
        const args = { request: { auth: this._getAuth(), orderNum } };
        if (parcelCount) args.request.parcelCount = parcelCount;
        if (cargoValue) args.request.cargoValue = cargoValue;
        
        const result = await this._call('order', 'getInvoiceFile', args);
        return result?.return?.file || null;
    }

    /**
     * Получить реестр заказов (XLS)
     */
    async getRegisterFile(datePickup, options = {}) {
        const args = {
            request: {
                auth: this._getAuth(),
                datePickup,
                ...options
            }
        };
        
        const result = await this._call('order', 'getRegisterFile', args);
        return result?.return?.file || null;
    }

    /**
     * Изменить вложения в заказе
     */
    async changeUnitLoad(orderNum, unitLoads, options = {}) {
        const args = {
            request: {
                auth: this._getAuth(),
                order: {
                    orderNum,
                    ...options,
                    unitLoad: unitLoads
                }
            }
        };
        
        const result = await this._call('order', 'changeUnitLoad', args);
        return {
            status: result?.return?.status,
            errorMessage: result?.return?.errorMessage
        };
    }

    /**
     * Добавить авианакладную к международному заказу
     */
    async addAirwayBill(orderNumberDPD, carrierNumber) {
        const result = await this._call('order', 'addAirwayBill', {
            request: {
                auth: this._getAuth(),
                Order: {
                    OrderNumberDPD: orderNumberDPD,
                    Param: {
                        Param_name: 'Carrier_Number',
                        Param_value: carrierNumber
                    }
                }
            }
        });
        return result?.return;
    }

    // ========================================
    // 4. ИЗМЕНЕНИЕ ЗАКАЗА
    // ========================================

    /**
     * Добавить посылки в заказ
     */
    async addParcels(orderNum, parcels, options = {}) {
        const result = await this._call('order', 'addParcels', {
            parcels: {
                auth: this._getAuth(),
                orderNum,
                ...options,
                parcel: parcels
            }
        });
        return {
            orderNum: result?.return?.orderNum,
            status: result?.return?.status,
            parcelStatus: this._toArray(result?.return?.parcelStatus)
        };
    }

    /**
     * Удалить посылки из заказа
     */
    async removeParcels(orderNum, parcels) {
        const result = await this._call('order', 'removeParcels', {
            parcels: {
                auth: this._getAuth(),
                orderNum,
                parcel: parcels
            }
        });
        return {
            orderNum: result?.return?.orderNum,
            status: result?.return?.status,
            parcelStatus: this._toArray(result?.return?.parcelStatus)
        };
    }

    // ========================================
    // 5. ОТСЛЕЖИВАНИЕ СТАТУСА
    // ========================================

    /**
     * Получить все изменённые статусы посылок клиента
     */
    async getStatesByClient() {
        const result = await this._call('tracing', 'getStatesByClient', {
            request: { auth: this._getAuth() }
        });
        
        return {
            docId: result?.return?.docId,
            docDate: result?.return?.docDate,
            resultComplete: result?.return?.resultComplete,
            states: this._toArray(result?.return?.states).map(s => this._parseTrackingState(s))
        };
    }

    /**
     * Подтвердить получение статусов
     */
    async confirmTracking(docId) {
        const result = await this._call('tracing', 'confirm', {
            request: {
                auth: this._getAuth(),
                docId: docId
            }
        });
        return result?.return;
    }

    /**
     * Получить историю по номеру заказа клиента
     */
    async getStatesByClientOrder(clientOrderNr, pickupDate = null) {
        const args = {
            request: {
                auth: this._getAuth(),
                clientOrderNr
            }
        };
        if (pickupDate) args.request.pickupDate = pickupDate;
        
        const result = await this._call('tracing', 'getStatesByClientOrder', args);
        return {
            docId: result?.return?.docId,
            states: this._toArray(result?.return?.states).map(s => this._parseTrackingState(s))
        };
    }

    /**
     * Получить историю по номеру заказа DPD
     */
    async getStatesByDPDOrder(dpdOrderNr, pickupYear = null) {
        const args = {
            request: {
                auth: this._getAuth(),
                dpdOrderNr
            }
        };
        if (pickupYear) args.request.pickupYear = pickupYear;
        
        const result = await this._call('tracing', 'getStatesByDPDOrder', args);
        return {
            docId: result?.return?.docId,
            states: this._toArray(result?.return?.states).map(s => this._parseTrackingState(s))
        };
    }

    /**
     * Получить историю по номеру посылки клиента
     */
    async getStatesByClientParcel(clientParcelNr, pickupDate = null) {
        const args = {
            request: {
                auth: this._getAuth(),
                clientParcelNr
            }
        };
        if (pickupDate) args.request.pickupDate = pickupDate;
        
        const result = await this._call('tracing', 'getStatesByClientParcel', args);
        return {
            docId: result?.return?.docId,
            states: this._toArray(result?.return?.states).map(s => this._parseTrackingState(s))
        };
    }

    /**
     * Получить события по заказам (расширенное отслеживание)
     */
    async getEvents(options = {}) {
        const args = {
            request: {
                auth: this._getAuth()
            }
        };
        if (options.dateFrom) args.request.dateFrom = options.dateFrom;
        if (options.dateTo) args.request.dateTo = options.dateTo;
        if (options.maxRowCount) args.request.maxRowCount = options.maxRowCount;
        
        const result = await this._call('eventTracking', 'getEvents', args);
        
        return {
            docId: result?.return?.docId,
            docDate: result?.return?.docDate,
            resultComplete: result?.return?.resultComplete,
            events: this._toArray(result?.return?.event || result?.return?.events).map(e => ({
                clientOrderNr: e.clientOrderNr,
                dpdOrderNr: e.dpdOrderNr,
                eventCode: e.eventCode,
                eventName: e.eventName || EVENT_CODES[e.eventCode] || '',
                reasonCode: e.reasonCode,
                reasonName: e.reasonName,
                eventDate: e.EventDate || e.eventDate,
                parameters: this._toArray(e.parameter).map(p => ({
                    name: p.paramName,
                    value: p.valueString || p.valueDecimal || p.valueDateTime
                }))
            }))
        };
    }

    /**
     * Подтвердить получение событий
     */
    async confirmEvents(docId) {
        const result = await this._call('eventTracking', 'confirm', {
            request: {
                auth: this._getAuth(),
                docId
            }
        });
        return result?.return;
    }

    /**
     * Получить короткую ссылку для отслеживания
     */
    async getTrackingOrderLink(orderParams) {
        const args = {
            trackingOrder: {
                auth: this._getAuth(),
                Order: orderParams
            }
        };
        
        const result = await this._call('tracing', 'getTrakingOrderLink', args);
        const links = this._toArray(result?.return);
        return links.map(l => ({
            link: l.link,
            status: l.status
        }));
    }

    _parseTrackingState(s) {
        return {
            clientOrderNr: s.clientOrderNr,
            clientParcelNr: s.clientParcelNr,
            dpdOrderNr: s.dpdOrderNr,
            dpdParcelNr: s.dpdParcelNr,
            pickupDate: s.pickupDate,
            planDeliveryDate: s.planDeliveryDate,
            newState: s.newState,
            transitionTime: s.transitionTime,
            terminalCode: s.terminalCode,
            terminalCity: s.terminalCity,
            incidentCode: s.incidentCode,
            incidentName: s.incidentName,
            consignee: s.consignee,
            isReturn: s.isReturn,
            orderPhysicalWeight: s.orderPhysicalWeight,
            orderCost: s.orderCost,
            parcelPhysicalWeight: s.parcelPhysicalWeight
        };
    }

    // ========================================
    // 6. ОТЧЁТЫ
    // ========================================

    /**
     * Предварительная стоимость перевозки за период
     */
    async getNLAmount(dateFrom, dateTo) {
        const result = await this._call('reports', 'getNLAmount', {
            arg0: { auth: this._getAuth(), dateFrom, dateTo }
        });
        return this._toArray(result?.return);
    }

    /**
     * Окончательная стоимость перевозки со счетами
     */
    async getNLInvoice(dateFrom, dateTo) {
        const result = await this._call('reports', 'getNLInvoice', {
            arg0: { auth: this._getAuth(), dateFrom, dateTo }
        });
        return this._toArray(result?.return);
    }

    /**
     * Скан накладной подписанной получателем
     */
    async getWaybill(orderNum, year) {
        const result = await this._call('reports', 'getWaybill', {
            getWaybill: { auth: this._getAuth(), orderNum, year }
        });
        return {
            dpdOrderNum: result?.return?.dpdOrderNum,
            clientOrderNum: result?.return?.clientOrderNum,
            status: result?.return?.Status || result?.return?.status,
            pdfFile: result?.return?.pdfFile,
            errorMessage: result?.return?.errorMessage
        };
    }

    /**
     * Получить ссылку на чек
     */
    async getLinkCheck(dateFrom, dateTo) {
        const result = await this._call('reports', 'getLinkCheck', {
            arg0: { auth: this._getAuth(), dateFrom, dateTo }
        });
        return this._toArray(result?.return).map(r => ({
            orderNum: r.orderNum,
            linkCheck: r.linkCheck
        }));
    }

    // ========================================
    // 7. ПЕЧАТЬ НАКЛЕЕК
    // ========================================

    /**
     * Сформировать файл с наклейками DPD (PDF/FP3)
     */
    async createLabelFile(orders, fileFormat = 'PDF', pageSize = 'A5') {
        const result = await this._call('labelPrint', 'createLabelFile', {
            getLabelFile: {
                Auth: this._getAuth(),
                fileFormat,
                pageSize,
                order: orders.map(o => ({
                    orderNum: o.orderNum,
                    parcelsNumber: o.parcelsNumber || 1
                }))
            }
        });
        
        return {
            file: result?.return?.file,
            orders: this._toArray(result?.return?.order).map(o => ({
                orderNum: o.orderNum,
                status: o.status,
                errorMessage: o.errorMessage
            }))
        };
    }

    /**
     * Получить параметры для печати наклейки
     */
    async createParcelLabel(parcels) {
        const result = await this._call('labelPrint', 'createParcelLabel', {
            getLabel: {
                Auth: this._getAuth(),
                parcel: parcels.map(p => ({
                    orderNum: p.orderNum,
                    parcelNum: p.parcelNum
                }))
            }
        });
        return this._toArray(result?.return?.order);
    }

    // ========================================
    // 8. ОТМЕНА ЗАКАЗА
    // ========================================

    /**
     * Отменить заказ
     */
    async cancelOrder(params) {
        const cancel = {};
        if (params.orderNumberInternal) cancel.orderNumberInternal = params.orderNumberInternal;
        if (params.orderNum) cancel.orderNum = params.orderNum;
        if (params.pickupDate) cancel.pickupdate = params.pickupDate;
        
        const result = await this._call('order', 'cancelOrder', {
            orders: {
                auth: this._getAuth(),
                cancel
            }
        });
        
        const orders = this._toArray(result?.return);
        return orders.map(o => ({
            orderNumberInternal: o.orderNumberInternal,
            orderNum: o.orderNum,
            status: o.status,
            errorMessage: o.errorMassage || o.errorMessage
        }));
    }

    // ========================================
    // 9. СПРАВОЧНАЯ ИНФОРМАЦИЯ
    // ========================================

    /**
     * Определить клиентский номер по ИНН
     */
    async getClientNumByINN(clientINN) {
        const result = await this._call('inquiryDesk', 'getClientNumByINN', {
            request: { auth: this._getAuth(), clientINN }
        });
        return {
            clientINN: result?.return?.clientINN,
            clientNumber: result?.return?.clientNumber,
            status: result?.return?.status,
            errorMessage: result?.return?.errorMassage
        };
    }

    /**
     * Получить короткую ссылку на Управление доставкой
     */
    async getClientPredictSms(params) {
        const args = { request: { auth: this._getAuth() } };
        if (params.dpdOrderNum) args.request.dpdOrderNum = params.dpdOrderNum;
        if (params.clientOrderNum) args.request.clientOrderNum = params.clientOrderNum;
        
        const result = await this._call('inquiryDesk', 'getClientPredictSms', args);
        return {
            predictLink: result?.return?.predictLink,
            errorMessage: result?.return?.errorMassage
        };
    }

    // ========================================
    // 10. УПРАВЛЕНИЕ ДОСТАВКОЙ (REST API)
    // ========================================

    /**
     * Получить список заказов (авторизация получателя)
     */
    async getShipmentList(params) {
        return this._restCall('POST', 'getShipmentList', params);
    }

    /**
     * Проверить доступность адреса к изменению
     */
    async isAddressChangeable(sessionId, orderId) {
        return this._restCall('POST', 'isAddressChangeable', { sessionId, orderId });
    }

    /**
     * Получить планируемую дату доставки
     */
    async getDeliveryDate(sessionId, orderId) {
        return this._restCall('POST', 'getDeliveryDate', { sessionId, orderId });
    }

    /**
     * Получить список дат для переноса доставки
     */
    async getDeliveryDateList(sessionId, orderId) {
        return this._restCall('POST', 'getDeliveryDateList', { sessionId, orderId });
    }

    /**
     * Получить список интервалов доставки
     */
    async getDeliveryIntervalList(sessionId, orderId) {
        return this._restCall('POST', 'getDeliveryIntervalList', { sessionId, orderId });
    }

    /**
     * Сохранить новую дату доставки
     */
    async saveDeliveryDate(sessionId, orderId, newDate, newIntervalId) {
        return this._restCall('POST', 'saveDeliveryDate', {
            sessionId, orderId, newDate, newIntervalId
        });
    }

    /**
     * Получить адрес доставки из заказа
     */
    async getAddress(sessionId, orderId) {
        return this._restCall('POST', 'getAddress', { sessionId, orderId });
    }

    /**
     * Сохранить новый адрес доставки
     */
    async saveAddress(sessionId, orderId, addressData) {
        return this._restCall('POST', 'saveAddress', {
            sessionId, orderId, ...addressData
        });
    }

    /**
     * Получить список ПВЗ для самовывоза
     */
    async getParcelShopList(sessionId, orderId) {
        return this._restCall('POST', 'getParcelShopList', { sessionId, orderId });
    }

    /**
     * Сменить пункт выдачи
     */
    async saveParcelShop(sessionId, orderId, newDepartmentId) {
        return this._restCall('POST', 'saveParcelShop', {
            sessionId, orderId, newDepartmentId
        });
    }

    /**
     * Отказ от получения заказа (REST)
     */
    async cancelOrderPredict(sessionId, orderId, descript) {
        return this._restCall('POST', 'cancelOrder', {
            sessionId, orderId, descript
        });
    }

    // ========================================
    // УТИЛИТЫ
    // ========================================

    /**
     * Очистить кэш
     */
    clearCache(type = 'all') {
        if (type === 'all') {
            soapClientCache.clear();
            dataCache.clear();
        } else if (type === 'soap') {
            soapClientCache.clear();
        } else if (type === 'data') {
            dataCache.clear();
        }
    }

    /**
     * Получить статистику
     */
    getStats() {
        return {
            ...this.stats,
            cacheSize: {
                soap: soapClientCache.size,
                data: dataCache.size
            },
            testMode: this.testMode,
            hostname: this.hostname
        };
    }

    /**
     * Получить справочник услуг
     */
    static getServiceList() {
        return DPD_SERVICES;
    }

    /**
     * Получить справочник событий
     */
    static getEventCodes() {
        return EVENT_CODES;
    }
}

module.exports = { DPDClient, DPD_SERVICES, EVENT_CODES, CONFIG };
