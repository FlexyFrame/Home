/**
 * FlexyFrame MCP DPD Server
 * MCP сервер для интеграции с DPD
 * 
 * Версия: 2.0.0 (Февраль 2026)
 * Использует улучшенный dpd-api.js
 */

const { createServer } = require('@modelcontextprotocol/sdk/server/index.js');
const { DPDClient } = require('./dpd-api');

const server = createServer({
  name: 'dpd',
  version: '2.0.0',
});

// Инициализация DPD клиента
let dpdClient = null;

function initDPDClient() {
    const clientNumber = process.env.DPD_CLIENT_NUMBER;
    const clientKey = process.env.DPD_CLIENT_KEY;
    const testMode = process.env.DPD_TEST_MODE === 'true';
    
    if (clientNumber && clientKey && clientNumber !== 'your_dpd_client_number') {
        dpdClient = new DPDClient({
            clientNumber: clientNumber,
            clientKey: clientKey,
            testMode: testMode
        });
        console.log('✅ MCP DPD Server: DPD клиент инициализирован (v2.0)');
        console.log(`   Режим: ${testMode ? 'ТЕСТОВЫЙ' : 'ПРОМЫШЛЕННЫЙ'}`);
        return true;
    }
    console.log('⚠️ MCP DPD Server: DPD не настроен');
    return false;
}

// Провайдер с методами DPD
const dpdProvider = {
    // === География ===
    
    /**
     * Получить пункты выдачи заказов (ПВЗ)
     */
    async getParcelShops(params = {}) {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        return await dpdClient.getParcelShops(params);
    },
    
    /**
     * Получить терминалы для самовывоза
     */
    async getTerminalsSelfDelivery() {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        return await dpdClient.getTerminalsSelfDelivery();
    },
    
    /**
     * Получить список городов с наложенным платежом
     */
    async getCitiesCashPay(countryCode = 'RU') {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        return await dpdClient.getCitiesCashPay(countryCode);
    },
    
    // === Калькулятор ===
    
    /**
     * Рассчитать стоимость доставки
     */
    async getServiceCost(params = {}) {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        return await dpdClient.getServiceCost(params);
    },
    
    // === Заказы ===
    
    /**
     * Создать заказ на доставку
     */
    async createOrder(orderData = {}) {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        return await dpdClient.createOrder(orderData);
    },
    
    /**
     * Получить статус заказа
     */
    async getOrderStatus(orderNumber, datePickup) {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        return await dpdClient.getOrderStatus(orderNumber, datePickup);
    },
    
    /**
     * Отменить заказ
     */
    async cancelOrder(orderNumber, pickupDate) {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        return await dpdClient.cancelOrder(orderNumber, pickupDate);
    },
    
    // === Отслеживание ===
    
    /**
     * Получить ссылку для отслеживания заказа
     */
    async getTrackingLink(orderNumberDPD) {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        return await dpdClient.getTrackingLink(orderNumberDPD);
    },
    
    // === Утилиты ===
    
    /**
     * Получить статистику DPD клиента
     */
    getStats() {
        if (!dpdClient) {
            return { configured: false };
        }
        return {
            configured: true,
            ...dpdClient.getStats()
        };
    },
    
    /**
     * Очистить кэш
     */
    clearCache() {
        if (!dpdClient) throw new Error('DPD не инициализирован');
        dpdClient.clearCache();
        return { success: true, message: 'Кэш очищен' };
    },
    
    /**
     * Проверить статус конфигурации
     */
    isConfigured() {
        return dpdClient !== null;
    },
    
    /**
     * Получить список услуг DPD
     */
    getServiceList() {
        return [
            { code: 'DPD_CLASSIC', name: 'DPD Классик' },
            { code: 'DPD_EXPRESS', name: 'DPD Экспресс' },
            { code: 'DPD_ECONOMY', name: 'DPD Эконом' },
            { code: 'DPD_B2C', name: 'DPD до ПВЗ' },
            { code: 'DPD_B2C_DOC', name: 'DPD Документы до ПВЗ' },
            { code: 'PCL', name: 'Посылка' },
            { code: 'PCL_EXPRESS', name: 'Экспресс посылка' },
            { code: 'OPTIMAL', name: 'Оптимальное' }
        ];
    }
};

server.addProvider(dpdProvider);

// Инициализация при запуске
initDPDClient();

// Запуск сервера
server.listen();

console.log('🚀 MCP DPD Server v2.0 запущен');
console.log('📦 Доступные методы: getParcelShops, getCitiesCashPay, getServiceCost, createOrder, getOrderStatus, cancelOrder, getTrackingLink');
