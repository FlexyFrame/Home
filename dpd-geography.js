/**
 * DPD Geography Module
 * Модуль для работы с географией DPD
 * 
 * Версия: 1.0.0
 * Функционал:
 * - Получение списка городов с наложенным платежом
 * - Получение списка пунктов выдачи (ПВП)
 * - Получение списка терминалов
 * - Кэширование и обновление данных
 */

const { DPDClient } = require('./dpd-api');
const logger = require('./logger');

class DPDGeography {
    constructor(config) {
        this.config = config;
        this.dpdClient = new DPDClient(config);
        
        // Кэш данных
        this.cache = {
            citiesCashPay: null,
            parcelShops: null,
            terminals: null,
            lastUpdate: {
                citiesCashPay: null,
                parcelShops: null,
                terminals: null
            }
        };
        
        // Настройки кэширования
        this.cacheConfig = {
            citiesCashPay: 24 * 60 * 60 * 1000, // 24 часа
            parcelShops: 3 * 60 * 60 * 1000,    // 3 часа
            terminals: 3 * 60 * 60 * 1000       // 3 часа
        };
    }

    /**
     * Инициализировать модуль
     */
    async initialize() {
        try {
            await this.dpdClient.initialize();
            logger.info('DPD Geography module initialized');
        } catch (error) {
            logger.error('Error initializing DPD Geography module', error);
            throw error;
        }
    }

    /**
     * Получить города с наложенным платежом
     */
    async getCitiesCashPay(countryCode = 'RU') {
        try {
            // Проверяем кэш
            if (this.cache.citiesCashPay && this.isCacheValid('citiesCashPay')) {
                logger.debug('Returning cached cities cash pay data');
                return this.cache.citiesCashPay;
            }
            
            // Получаем данные с сервера
            const result = await this.dpdClient.getCitiesCashPay(countryCode);
            
            // Кэшируем результат
            this.cache.citiesCashPay = result;
            this.cache.lastUpdate.citiesCashPay = Date.now();
            
            logger.info('Cities cash pay data updated', { count: result.length });
            
            return result;
        } catch (error) {
            logger.error('Error getting cities cash pay', error);
            throw error;
        }
    }

    /**
     * Получить пункты выдачи
     */
    async getParcelShops(options = {}) {
        try {
            // Проверяем кэш
            if (this.cache.parcelShops && this.isCacheValid('parcelShops')) {
                logger.debug('Returning cached parcel shops data');
                return this.cache.parcelShops;
            }
            
            // Получаем данные с сервера
            const result = await this.dpdClient.getParcelShops(options);
            
            // Кэшируем результат
            this.cache.parcelShops = result;
            this.cache.lastUpdate.parcelShops = Date.now();
            
            logger.info('Parcel shops data updated', { count: result.length });
            
            return result;
        } catch (error) {
            logger.error('Error getting parcel shops', error);
            throw error;
        }
    }

    /**
     * Получить терминалы
     */
    async getTerminalsSelfDelivery(options = {}) {
        try {
            // Проверяем кэш
            if (this.cache.terminals && this.isCacheValid('terminals')) {
                logger.debug('Returning cached terminals data');
                return this.cache.terminals;
            }
            
            // Получаем данные с сервера
            const result = await this.dpdClient.getTerminalsSelfDelivery(options);
            
            // Кэшируем результат
            this.cache.terminals = result;
            this.cache.lastUpdate.terminals = Date.now();
            
            logger.info('Terminals data updated', { count: result.length });
            
            return result;
        } catch (error) {
            logger.error('Error getting terminals', error);
            throw error;
        }
    }

    /**
     * Получить срок хранения
     */
    async getStoragePeriod(terminalCodes, serviceCodes) {
        try {
            const result = await this.dpdClient.getStoragePeriod(terminalCodes, serviceCodes);
            logger.info('Storage period data retrieved', { terminalCodes, serviceCodes });
            return result;
        } catch (error) {
            logger.error('Error getting storage period', error);
            throw error;
        }
    }

    /**
     * Проверить валидность кэша
     */
    isCacheValid(type) {
        const lastUpdate = this.cache.lastUpdate[type];
        if (!lastUpdate) return false;
        
        const cacheTTL = this.cacheConfig[type];
        const now = Date.now();
        
        return (now - lastUpdate) < cacheTTL;
    }

    /**
     * Очистить кэш
     */
    clearCache(type = null) {
        if (type) {
            this.cache[type] = null;
            this.cache.lastUpdate[type] = null;
            logger.info(`Cache cleared for ${type}`);
        } else {
            this.cache = {
                citiesCashPay: null,
                parcelShops: null,
                terminals: null,
                lastUpdate: {
                    citiesCashPay: null,
                    parcelShops: null,
                    terminals: null
                }
            };
            logger.info('All cache cleared');
        }
    }

    /**
     * Принудительно обновить данные
     */
    async refreshData(type = null) {
        try {
            if (type === 'citiesCashPay' || !type) {
                await this.getCitiesCashPay();
            }
            
            if (type === 'parcelShops' || !type) {
                await this.getParcelShops();
            }
            
            if (type === 'terminals' || !type) {
                await this.getTerminalsSelfDelivery();
            }
            
            logger.info('Data refreshed', { type: type || 'all' });
        } catch (error) {
            logger.error('Error refreshing data', error);
            throw error;
        }
    }

    /**
     * Найти ближайшие пункты выдачи
     */
    async findNearestParcelShops(cityId, coordinates = null, limit = 5) {
        try {
            const parcelShops = await this.getParcelShops({ cityId });
            
            if (!coordinates) {
                // Если координаты не заданы, возвращаем первые N пунктов
                return parcelShops.slice(0, limit);
            }
            
            // Рассчитываем расстояния до всех пунктов
            const shopsWithDistance = parcelShops.map(shop => {
                if (!shop.geoCoordinates) return null;
                
                const distance = this.calculateDistance(
                    coordinates.lat, 
                    coordinates.lng, 
                    shop.geoCoordinates.latitude, 
                    shop.geoCoordinates.longitude
                );
                
                return { ...shop, distance };
            }).filter(shop => shop !== null);
            
            // Сортируем по расстоянию и возвращаем первые N
            return shopsWithDistance
                .sort((a, b) => a.distance - b.distance)
                .slice(0, limit);
        } catch (error) {
            logger.error('Error finding nearest parcel shops', error);
            throw error;
        }
    }

    /**
     * Рассчитать расстояние между двумя точками (в километрах)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Радиус Земли в километрах
        const dLat = this.deg2rad(lat2 - lat1);
        const dLon = this.deg2rad(lon2 - lon1);
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Преобразовать градусы в радианы
     */
    deg2rad(deg) {
        return deg * (Math.PI / 180);
    }

    /**
     * Получить статистику модуля
     */
    getStats() {
        return {
            cache: {
                citiesCashPay: this.cache.citiesCashPay ? this.cache.citiesCashPay.length : 0,
                parcelShops: this.cache.parcelShops ? this.cache.parcelShops.length : 0,
                terminals: this.cache.terminals ? this.cache.terminals.length : 0
            },
            lastUpdate: this.cache.lastUpdate,
            cacheValid: {
                citiesCashPay: this.isCacheValid('citiesCashPay'),
                parcelShops: this.isCacheValid('parcelShops'),
                terminals: this.isCacheValid('terminals')
            }
        };
    }

    /**
     * Диагностика модуля
     */
    async diagnose() {
        const results = {
            module: 'DPD Geography',
            status: 'unknown',
            errors: [],
            stats: this.getStats()
        };
        
        try {
            // Проверяем подключение к DPD API
            await this.dpdClient.getCitiesCashPay('RU');
            results.status = 'ok';
        } catch (error) {
            results.status = 'error';
            results.errors.push(error.message);
        }
        
        return results;
    }
}

module.exports = { DPDGeography };