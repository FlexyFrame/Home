/**
 * DPD Shipping Calculator Module
 * Модуль для расчета стоимости доставки DPD
 * 
 * Версия: 1.0.0
 * Функционал:
 * - Расчет стоимости доставки по России и странам ТС
 * - Расчет стоимости с учетом опций
 * - Расчет по параметрам посылок
 * - Кэширование тарифов
 */

const { DPDClient } = require('./dpd-api');
const logger = require('./logger');

class DPDShippingCalculator {
    constructor(config) {
        this.config = config;
        this.dpdClient = new DPDClient(config);
        
        // Кэш тарифов
        this.cache = new Map();
        
        // Настройки кэширования
        this.cacheConfig = {
            ttl: 60 * 60 * 1000, // 1 час
            maxSize: 1000 // Максимальное количество записей в кэше
        };
    }

    /**
     * Инициализировать модуль
     */
    async initialize() {
        try {
            await this.dpdClient.initialize();
            logger.info('DPD Shipping Calculator module initialized');
        } catch (error) {
            logger.error('Error initializing DPD Shipping Calculator module', error);
            throw error;
        }
    }

    /**
     * Рассчитать стоимость доставки
     */
    async calculate(options) {
        try {
            // Валидация входных данных
            this.validateCalculationOptions(options);
            
            // Проверяем кэш
            const cacheKey = this.generateCacheKey(options);
            const cachedResult = this.getCachedResult(cacheKey);
            
            if (cachedResult) {
                logger.debug('Returning cached calculation result');
                return cachedResult;
            }
            
            // Выполняем расчет
            let result;
            
            if (options.international) {
                result = await this.calculateInternational(options);
            } else {
                result = await this.calculateDomestic(options);
            }
            
            // Кэшируем результат
            this.setCachedResult(cacheKey, result);
            
            logger.info('Shipping calculation completed', {
                from: options.from,
                to: options.to,
                weight: options.weight,
                cost: result.totalCost
            });
            
            return result;
        } catch (error) {
            logger.error('Error calculating shipping', error);
            throw error;
        }
    }

    /**
     * Рассчитать стоимость доставки по России и странам ТС
     */
    async calculateDomestic(options) {
        const params = {
            pickup: {
                cityId: options.from.cityId,
                index: options.from.index,
                cityName: options.from.cityName,
                regionCode: options.from.regionCode,
                countryCode: options.from.countryCode || 'RU'
            },
            delivery: {
                cityId: options.to.cityId,
                index: options.to.index,
                cityName: options.to.cityName,
                regionCode: options.to.regionCode,
                countryCode: options.to.countryCode || 'RU'
            },
            selfPickup: options.selfPickup || false,
            selfDelivery: options.selfDelivery || false,
            weight: options.weight,
            volume: options.volume,
            serviceCode: options.serviceCode,
            pickupDate: options.pickupDate,
            maxDays: options.maxDays,
            maxCost: options.maxCost,
            declaredValue: options.declaredValue,
            extraService: options.extraServices || []
        };
        
        const result = await this.dpdClient.getServiceCost(params);
        
        return {
            success: true,
            totalCost: result.cost,
            currency: 'RUB',
            serviceCode: result.serviceCode,
            serviceName: result.serviceName,
            deliveryDays: result.days,
            pickupDate: options.pickupDate,
            breakdown: {
                baseCost: result.cost,
                extraServices: result.costExtraService || [],
                totalExtraCost: this.calculateExtraServicesCost(result.costExtraService || [])
            },
            options: options
        };
    }

    /**
     * Рассчитать стоимость международной доставки
     */
    async calculateInternational(options) {
        const params = {
            pickup: {
                countryName: options.from.countryName,
                cityName: options.from.cityName,
                cityId: options.from.cityId
            },
            delivery: {
                countryName: options.to.countryName,
                cityName: options.to.cityName,
                cityId: options.to.cityId
            },
            selfPickup: options.selfPickup || false,
            selfDelivery: options.selfDelivery || false,
            weight: options.weight,
            length: options.length,
            width: options.width,
            height: options.height,
            declaredValue: options.declaredValue,
            insurance: options.insurance || false,
            extraService: options.extraServices || []
        };
        
        const result = await this.dpdClient.getServiceCostInternational(params);
        
        return {
            success: true,
            totalCost: result.cost,
            currency: result.currency || 'RUB',
            serviceCode: result.serviceCode,
            serviceName: result.serviceName,
            deliveryDays: result.days,
            pickupDate: options.pickupDate,
            breakdown: {
                baseCost: result.cost,
                extraServices: result.costExtraService || [],
                totalExtraCost: this.calculateExtraServicesCost(result.costExtraService || [])
            },
            options: options
        };
    }

    /**
     * Рассчитать стоимость по параметрам посылок
     */
    async calculateByParcels(options) {
        const params = {
            pickup: {
                cityId: options.from.cityId,
                index: options.from.index,
                cityName: options.from.cityName,
                regionCode: options.from.regionCode,
                countryCode: options.from.countryCode || 'RU'
            },
            delivery: {
                cityId: options.to.cityId,
                index: options.to.index,
                cityName: options.to.cityName,
                regionCode: options.to.regionCode,
                countryCode: options.to.countryCode || 'RU'
            },
            selfPickup: options.selfPickup || false,
            selfDelivery: options.selfDelivery || false,
            serviceCode: options.serviceCode,
            pickupDate: options.pickupDate,
            maxDays: options.maxDays,
            maxCost: options.maxCost,
            declaredValue: options.declaredValue,
            extraService: options.extraServices || [],
            parcel: options.parcels || []
        };
        
        const result = await this.dpdClient.getServiceCostByParcels(params);
        
        return {
            success: true,
            totalCost: result.cost,
            currency: 'RUB',
            serviceCode: result.serviceCode,
            serviceName: result.serviceName,
            deliveryDays: result.days,
            pickupDate: options.pickupDate,
            breakdown: {
                baseCost: result.cost,
                extraServices: result.costExtraService || [],
                totalExtraCost: this.calculateExtraServicesCost(result.costExtraService || [])
            },
            options: options
        };
    }

    /**
     * Валидация параметров расчета
     */
    validateCalculationOptions(options) {
        const required = ['from', 'to', 'weight'];
        
        for (const field of required) {
            if (!options[field]) {
                throw new Error(`Обязательное поле отсутствует: ${field}`);
            }
        }
        
        if (!options.from.cityId && !options.from.cityName) {
            throw new Error('Необходимо указать cityId или cityName для пункта отправления');
        }
        
        if (!options.to.cityId && !options.to.cityName) {
            throw new Error('Необходимо указать cityId или cityName для пункта назначения');
        }
        
        if (options.weight <= 0) {
            throw new Error('Вес должен быть больше 0');
        }
    }

    /**
     * Генерация ключа для кэша
     */
    generateCacheKey(options) {
        const keyData = {
            from: options.from,
            to: options.to,
            weight: options.weight,
            volume: options.volume,
            serviceCode: options.serviceCode,
            pickupDate: options.pickupDate,
            extraServices: options.extraServices || []
        };
        
        return JSON.stringify(keyData);
    }

    /**
     * Получить результат из кэша
     */
    getCachedResult(key) {
        const cached = this.cache.get(key);
        
        if (!cached) return null;
        
        // Проверяем срок действия кэша
        if (Date.now() - cached.timestamp > this.cacheConfig.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    /**
     * Сохранить результат в кэш
     */
    setCachedResult(key, data) {
        // Ограничиваем размер кэша
        if (this.cache.size >= this.cacheConfig.maxSize) {
            // Удаляем самую старую запись
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    /**
     * Рассчитать стоимость дополнительных услуг
     */
    calculateExtraServicesCost(extraServices) {
        return extraServices.reduce((total, service) => {
            return total + (service.cost || 0);
        }, 0);
    }

    /**
     * Получить доступные услуги для направления
     */
    async getAvailableServices(from, to) {
        try {
            const options = {
                from,
                to,
                weight: 1,
                serviceCode: null // Запрашиваем все доступные услуги
            };
            
            const result = await this.calculate(options);
            
            return {
                success: true,
                services: [{
                    code: result.serviceCode,
                    name: result.serviceName,
                    cost: result.totalCost,
                    currency: result.currency,
                    deliveryDays: result.deliveryDays
                }]
            };
        } catch (error) {
            logger.error('Error getting available services', error);
            throw error;
        }
    }

    /**
     * Получить доступные опции для услуги
     */
    async getAvailableOptions(serviceCode, from, to) {
        try {
            const result = await this.dpdClient.getPossibleExtraService({
                pickup: from,
                delivery: to,
                serviceCode: serviceCode
            });
            
            return {
                success: true,
                options: result.extraService || []
            };
        } catch (error) {
            logger.error('Error getting available options', error);
            throw error;
        }
    }

    /**
     * Очистить кэш
     */
    clearCache() {
        this.cache.clear();
        logger.info('Shipping calculator cache cleared');
    }

    /**
     * Получить статистику модуля
     */
    getStats() {
        return {
            cache: {
                size: this.cache.size,
                maxSize: this.cacheConfig.maxSize,
                hitRate: this.calculateHitRate()
            }
        };
    }

    /**
     * Рассчитать hit rate кэша
     */
    calculateHitRate() {
        // В реальной реализации нужно вести статистику запросов
        // Пока возвращаем заглушку
        return 0;
    }

    /**
     * Диагностика модуля
     */
    async diagnose() {
        const results = {
            module: 'DPD Shipping Calculator',
            status: 'unknown',
            errors: [],
            stats: this.getStats()
        };
        
        try {
            // Проверяем подключение к DPD API
            await this.dpdClient.getServiceCost({
                pickup: { cityId: 49694102 }, // Москва
                delivery: { cityId: 49265227 }, // Челябинск
                weight: 1,
                selfPickup: false,
                selfDelivery: true
            });
            results.status = 'ok';
        } catch (error) {
            results.status = 'error';
            results.errors.push(error.message);
        }
        
        return results;
    }
}

module.exports = { DPDShippingCalculator };