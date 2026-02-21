/**
 * FlexyFrame DPD Integration Test Suite
 * Комплексные тесты для всех компонентов DPD интеграции
 * 
 * Версия: 1.0.0
 * Функционал: Тестирование всех методов DPD API,
 *            проверка валидации данных, обработки ошибок,
 *            производительности и надежности
 */

const { FlexyFrameDPDIntegration } = require('./dpd-integration');
const { DPDClient } = require('./dpd-api');
const { DPDGeography } = require('./dpd-geography');
const { DPDShippingCalculator } = require('./dpd-shipping-calculator');
const { DPDNotifications } = require('./dpd-notifications');
const { DPDAdmin } = require('./dpd-admin');
const { DPDCancellation } = require('./dpd-cancellation');
const { DPDReceiptWarehouseClient } = require('./dpd-receipt-warehouse');
const logger = require('./logger');

// ============================================================
// КОНФИГУРАЦИЯ ТЕСТОВ
// ============================================================
const TEST_CONFIG = {
    clientNumber: process.env.DPD_CLIENT_NUMBER || '1001027795',
    clientKey: process.env.DPD_CLIENT_KEY || '182A17BD6FC5557D1FCA30FA1D56593EB21AEF88',
    testMode: true,
    
    // Тестовые данные
    testOrder: {
        orderNumberInternal: 'TEST_ORDER_' + Date.now(),
        serviceCode: 'PCL',
        serviceVariant: 'ДД',
        cargoNumPack: 1,
        cargoWeight: 2.5,
        cargoVolume: 0.02,
        cargoCategory: 'Тестовый заказ',
        pickupTimePeriod: '9-18',
        paymentType: 'ОУП',
        senderAddress: {
            name: 'Тестовый Отправитель',
            terminalCode: 'M13',
            countryName: 'Россия',
            index: '123456',
            region: 'Московская обл.',
            city: 'Москва',
            street: 'Тестовая',
            streetAbbr: 'ул',
            house: '1',
            contactFio: 'Иванов Иван',
            contactPhone: '89161234567',
            contactEmail: 'test@example.com'
        },
        receiverAddress: {
            name: 'Тестовый Получатель',
            terminalCode: 'LED',
            countryName: 'Россия',
            index: '190000',
            region: 'Ленинградская обл.',
            city: 'Санкт-Петербург',
            street: 'Тестовая',
            streetAbbr: 'ул',
            house: '2',
            contactFio: 'Петров Петр',
            contactPhone: '89111234567',
            contactEmail: 'test2@example.com'
        }
    },
    
    testGeography: {
        countryCode: 'RU',
        regionCode: 77,
        cityName: 'Москва'
    },
    
    testShipping: {
        from: { cityId: 195868771, countryCode: 'RU' },
        to: { cityId: 195901073, countryCode: 'RU' },
        weight: 5,
        volume: 0.05,
        serviceCode: 'PCL'
    }
};

// ============================================================
// КЛАСС ТЕСТОВОГО СЮИТА
// ============================================================
class DPDIntegrationTestSuite {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            skipped: 0,
            total: 0,
            tests: [],
            startTime: null,
            endTime: null
        };
        
        this.integration = null;
    }

    // ========================================
    // ЗАПУСК ТЕСТОВ
    // ========================================

    /**
     * Запустить все тесты
     */
    async runAllTests() {
        this.results.startTime = new Date();
        
        logger.info('Starting DPD Integration Test Suite');
        
        try {
            // Инициализация
            await this.testInitialization();
            
            // Тесты основного клиента
            await this.testDPDClient();
            
            // Тесты географии
            await this.testGeography();
            
            // Тесты калькулятора
            await this.testCalculator();
            
            // Тесты уведомлений
            await this.testNotifications();
            
            // Тесты администрирования
            await this.testAdmin();
            
            // Тесты отмены
            await this.testCancellation();
            
            // Тесты чеков
            await this.testReceipts();
            
            // Тесты интеграции
            await this.testIntegration();
            
        } catch (error) {
            logger.error('Error running test suite', error);
            this.addTestResult('Test Suite', false, error.message);
        }
        
        this.results.endTime = new Date();
        this.printResults();
        
        return this.results;
    }

    // ========================================
    // ТЕСТЫ ИНИЦИАЛИЗАЦИИ
    // ========================================

    async testInitialization() {
        logger.info('Testing initialization...');
        
        try {
            this.integration = new FlexyFrameDPDIntegration(TEST_CONFIG);
            
            // Проверка создания компонентов
            this.addTestResult('Integration Creation', true, 'Integration created successfully');
            
            // Проверка конфигурации
            const config = this.integration.getConfig();
            this.addTestResult('Configuration', 
                config.clientNumber === TEST_CONFIG.clientNumber && 
                config.clientKey === TEST_CONFIG.clientKey,
                'Configuration loaded correctly'
            );
            
        } catch (error) {
            this.addTestResult('Initialization', false, error.message);
        }
    }

    // ========================================
    // ТЕСТЫ ОСНОВНОГО КЛИЕНТА
    // ========================================

    async testDPDClient() {
        logger.info('Testing DPD Client...');
        
        try {
            // Тест географии
            await this.testGetCitiesCashPay();
            await this.testGetParcelShops();
            await this.testGetTerminals();
            
            // Тест расчета стоимости
            await this.testGetServiceCost();
            await this.testGetServiceCostByParcels();
            
            // Тест создания заказа
            await this.testCreateOrder();
            
            // Тест отслеживания
            await this.testGetOrderStatus();
            await this.testGetStatesByClient();
            
            // Тест отчетов
            await this.testGetNLAmount();
            await this.testGetNLInvoice();
            await this.testGetWaybill();
            await this.testGetLinkCheck();
            
            // Тест печати наклеек
            await this.testCreateLabelFile();
            
            // Тест отмены заказа
            await this.testCancelOrder();
            
        } catch (error) {
            logger.error('Error in DPD Client tests', error);
            this.addTestResult('DPD Client Tests', false, error.message);
        }
    }

    async testGetCitiesCashPay() {
        try {
            const result = await this.integration.geography.getCitiesCashPay('RU');
            this.addTestResult('Get Cities Cash Pay', 
                result && Array.isArray(result.cities) && result.cities.length > 0,
                'Cities with cash payment retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Get Cities Cash Pay', false, error.message);
        }
    }

    async testGetParcelShops() {
        try {
            const result = await this.integration.geography.getParcelShops({
                countryCode: 'RU',
                regionCode: 77,
                cityName: 'Москва'
            });
            this.addTestResult('Get Parcel Shops', 
                result && Array.isArray(result.parcelShops),
                'Parcel shops retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Get Parcel Shops', false, error.message);
        }
    }

    async testGetTerminals() {
        try {
            const result = await this.integration.geography.getTerminalsSelfDelivery();
            this.addTestResult('Get Terminals', 
                result && Array.isArray(result.terminals),
                'Terminals retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Get Terminals', false, error.message);
        }
    }

    async testGetServiceCost() {
        try {
            const result = await this.integration.calculator.calculate({
                from: { cityId: 195868771, countryCode: 'RU' },
                to: { cityId: 195901073, countryCode: 'RU' },
                weight: 5,
                volume: 0.05,
                serviceCode: 'PCL'
            });
            this.addTestResult('Get Service Cost', 
                result && result.totalCost > 0,
                'Service cost calculated successfully'
            );
        } catch (error) {
            this.addTestResult('Get Service Cost', false, error.message);
        }
    }

    async testGetServiceCostByParcels() {
        try {
            const result = await this.integration.calculator.calculate({
                from: { cityId: 195868771, countryCode: 'RU' },
                to: { cityId: 195901073, countryCode: 'RU' },
                parcels: [
                    { weight: 2, length: 30, width: 20, height: 15 },
                    { weight: 3, length: 40, width: 30, height: 20 }
                ],
                serviceCode: 'PCL'
            });
            this.addTestResult('Get Service Cost By Parcels', 
                result && result.totalCost > 0,
                'Service cost by parcels calculated successfully'
            );
        } catch (error) {
            this.addTestResult('Get Service Cost By Parcels', false, error.message);
        }
    }

    async testCreateOrder() {
        try {
            // Создаем тестовый заказ
            const orderData = { ...TEST_CONFIG.testOrder };
            orderData.orderNumberInternal = 'TEST_ORDER_' + Date.now();
            
            const result = await this.integration.createOrder(orderData);
            this.addTestResult('Create Order', 
                result && result.success && result.orderNum,
                'Order created successfully'
            );
            
            // Сохраняем номер заказа для последующих тестов
            this.testOrderNumber = result.orderNum;
            
        } catch (error) {
            this.addTestResult('Create Order', false, error.message);
        }
    }

    async testGetOrderStatus() {
        if (!this.testOrderNumber) {
            this.addTestResult('Get Order Status', false, 'No test order number available');
            return;
        }
        
        try {
            const result = await this.integration.trackOrder(this.testOrderNumber);
            this.addTestResult('Get Order Status', 
                result && result.status,
                'Order status retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Get Order Status', false, error.message);
        }
    }

    async testGetStatesByClient() {
        try {
            const result = await this.integration.dpdClient.getStatesByClient();
            this.addTestResult('Get States By Client', 
                result && result.states,
                'States retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Get States By Client', false, error.message);
        }
    }

    async testGetNLAmount() {
        try {
            const dateFrom = new Date();
            dateFrom.setDate(dateFrom.getDate() - 7);
            const dateTo = new Date();
            
            const result = await this.integration.getReport('nl_amount', {
                dateFrom, dateTo
            });
            this.addTestResult('Get NL Amount', 
                result && result.success,
                'NL Amount report generated successfully'
            );
        } catch (error) {
            this.addTestResult('Get NL Amount', false, error.message);
        }
    }

    async testGetNLInvoice() {
        try {
            const dateFrom = new Date();
            dateFrom.setDate(dateFrom.getDate() - 7);
            const dateTo = new Date();
            
            const result = await this.integration.getReport('nl_invoice', {
                dateFrom, dateTo
            });
            this.addTestResult('Get NL Invoice', 
                result && result.success,
                'NL Invoice report generated successfully'
            );
        } catch (error) {
            this.addTestResult('Get NL Invoice', false, error.message);
        }
    }

    async testGetWaybill() {
        if (!this.testOrderNumber) {
            this.addTestResult('Get Waybill', false, 'No test order number available');
            return;
        }
        
        try {
            const result = await this.integration.getReport('waybill', {
                orderNum: this.testOrderNumber,
                year: new Date().getFullYear()
            });
            this.addTestResult('Get Waybill', 
                result && result.success,
                'Waybill retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Get Waybill', false, error.message);
        }
    }

    async testGetLinkCheck() {
        try {
            const dateFrom = new Date();
            dateFrom.setDate(dateFrom.getDate() - 7);
            const dateTo = new Date();
            
            const result = await this.integration.getReport('link_check', {
                dateFrom, dateTo
            });
            this.addTestResult('Get Link Check', 
                result && result.success,
                'Link check report generated successfully'
            );
        } catch (error) {
            this.addTestResult('Get Link Check', false, error.message);
        }
    }

    async testCreateLabelFile() {
        if (!this.testOrderNumber) {
            this.addTestResult('Create Label File', false, 'No test order number available');
            return;
        }
        
        try {
            const result = await this.integration.admin.createLabelFile([
                { orderNum: this.testOrderNumber, parcelsNumber: 1 }
            ], { fileFormat: 'PDF', pageSize: 'A5' });
            this.addTestResult('Create Label File', 
                result && result.success,
                'Label file created successfully'
            );
        } catch (error) {
            this.addTestResult('Create Label File', false, error.message);
        }
    }

    async testCancelOrder() {
        if (!this.testOrderNumber) {
            this.addTestResult('Cancel Order', false, 'No test order number available');
            return;
        }
        
        try {
            const result = await this.integration.cancelOrder(this.testOrderNumber, 'test');
            this.addTestResult('Cancel Order', 
                result && result.success,
                'Order canceled successfully'
            );
        } catch (error) {
            this.addTestResult('Cancel Order', false, error.message);
        }
    }

    // ========================================
    // ТЕСТЫ ГЕОГРАФИИ
    // ========================================

    async testGeography() {
        logger.info('Testing Geography...');
        
        try {
            // Тест кэширования
            await this.testGeographyCaching();
            
            // Тест валидации
            await this.testGeographyValidation();
            
        } catch (error) {
            logger.error('Error in Geography tests', error);
            this.addTestResult('Geography Tests', false, error.message);
        }
    }

    async testGeographyCaching() {
        try {
            // Первый вызов
            const result1 = await this.integration.geography.getCitiesCashPay('RU');
            
            // Второй вызов (должен быть из кэша)
            const result2 = await this.integration.geography.getCitiesCashPay('RU');
            
            this.addTestResult('Geography Caching', 
                result1 && result2 && result1.cities.length === result2.cities.length,
                'Geography caching works correctly'
            );
        } catch (error) {
            this.addTestResult('Geography Caching', false, error.message);
        }
    }

    async testGeographyValidation() {
        try {
            // Тест с неверными параметрами
            const result = await this.integration.geography.getCitiesCashPay('INVALID');
            
            this.addTestResult('Geography Validation', 
                result && result.cities && Array.isArray(result.cities),
                'Geography validation works correctly'
            );
        } catch (error) {
            this.addTestResult('Geography Validation', false, error.message);
        }
    }

    // ========================================
    // ТЕСТЫ КАЛЬКУЛЯТОРА
    // ========================================

    async testCalculator() {
        logger.info('Testing Calculator...');
        
        try {
            // Тест валидации параметров
            await this.testCalculatorValidation();
            
            // Тест кэширования
            await this.testCalculatorCaching();
            
        } catch (error) {
            logger.error('Error in Calculator tests', error);
            this.addTestResult('Calculator Tests', false, error.message);
        }
    }

    async testCalculatorValidation() {
        try {
            // Тест с недостающими параметрами
            const result = await this.integration.calculator.calculate({
                from: { cityId: 195868771 },
                to: { cityId: 195901073 }
                // Нет weight и volume
            });
            
            this.addTestResult('Calculator Validation', 
                result && result.error,
                'Calculator validation works correctly'
            );
        } catch (error) {
            this.addTestResult('Calculator Validation', false, error.message);
        }
    }

    async testCalculatorCaching() {
        try {
            const options = {
                from: { cityId: 195868771, countryCode: 'RU' },
                to: { cityId: 195901073, countryCode: 'RU' },
                weight: 5,
                volume: 0.05,
                serviceCode: 'PCL'
            };
            
            // Первый вызов
            const result1 = await this.integration.calculator.calculate(options);
            
            // Второй вызов (должен быть из кэша)
            const result2 = await this.integration.calculator.calculate(options);
            
            this.addTestResult('Calculator Caching', 
                result1 && result2 && result1.totalCost === result2.totalCost,
                'Calculator caching works correctly'
            );
        } catch (error) {
            this.addTestResult('Calculator Caching', false, error.message);
        }
    }

    // ========================================
    // ТЕСТЫ УВЕДОМЛЕНИЙ
    // ========================================

    async testNotifications() {
        logger.info('Testing Notifications...');
        
        try {
            // Тест добавления в отслеживание
            await this.testAddOrderTracking();
            
            // Тест получения статистики
            await this.testNotificationsStats();
            
        } catch (error) {
            logger.error('Error in Notifications tests', error);
            this.addTestResult('Notifications Tests', false, error.message);
        }
    }

    async testAddOrderTracking() {
        try {
            this.integration.notifications.addOrderTracking(
                'TEST_ORDER_123',
                '123456789',
                'user123'
            );
            
            const orders = this.integration.notifications.getTrackedOrders();
            
            this.addTestResult('Add Order Tracking', 
                orders.includes('TEST_ORDER_123'),
                'Order tracking added successfully'
            );
        } catch (error) {
            this.addTestResult('Add Order Tracking', false, error.message);
        }
    }

    async testNotificationsStats() {
        try {
            const stats = this.integration.notifications.getStats();
            
            this.addTestResult('Notifications Stats', 
                stats && typeof stats.totalChecks === 'number',
                'Notifications stats retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Notifications Stats', false, error.message);
        }
    }

    // ========================================
    // ТЕСТЫ АДМИНИСТРИРОВАНИЯ
    // ========================================

    async testAdmin() {
        logger.info('Testing Admin...');
        
        try {
            // Тест получения статистики
            await this.testAdminStats();
            
            // Тест получения проблемных заказов
            await this.testGetProblemOrders();
            
        } catch (error) {
            logger.error('Error in Admin tests', error);
            this.addTestResult('Admin Tests', false, error.message);
        }
    }

    async testAdminStats() {
        try {
            const stats = this.integration.admin.getStats();
            
            this.addTestResult('Admin Stats', 
                stats && typeof stats.totalReports === 'number',
                'Admin stats retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Admin Stats', false, error.message);
        }
    }

    async testGetProblemOrders() {
        try {
            const result = await this.integration.admin.getProblemOrders();
            
            this.addTestResult('Get Problem Orders', 
                result && result.success,
                'Problem orders retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Get Problem Orders', false, error.message);
        }
    }

    // ========================================
    // ТЕСТЫ ОТМЕНЫ
    // ========================================

    async testCancellation() {
        logger.info('Testing Cancellation...');
        
        try {
            // Тест валидации условий отмены
            await this.testCancellationValidation();
            
            // Тест получения статистики
            await this.testCancellationStats();
            
        } catch (error) {
            logger.error('Error in Cancellation tests', error);
            this.addTestResult('Cancellation Tests', false, error.message);
        }
    }

    async testCancellationValidation() {
        try {
            const result = await this.integration.cancellation.canCancelOrder('INVALID_ORDER');
            
            this.addTestResult('Cancellation Validation', 
                result && result.allowed === false,
                'Cancellation validation works correctly'
            );
        } catch (error) {
            this.addTestResult('Cancellation Validation', false, error.message);
        }
    }

    async testCancellationStats() {
        try {
            const stats = this.integration.cancellation.getStatistics();
            
            this.addTestResult('Cancellation Stats', 
                stats && typeof stats.cancellations === 'object',
                'Cancellation stats retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Cancellation Stats', false, error.message);
        }
    }

    // ========================================
    // ТЕСТЫ ЧЕКОВ
    // ========================================

    async testReceipts() {
        logger.info('Testing Receipts...');
        
        try {
            // Тест авторизации
            await this.testReceiptsAuthorization();
            
            // Тест получения количества чеков
            await this.testReceiptsQuantity();
            
        } catch (error) {
            logger.error('Error in Receipts tests', error);
            this.addTestResult('Receipts Tests', false, error.message);
        }
    }

    async testReceiptsAuthorization() {
        try {
            const result = await this.integration.receipts.authorization();
            
            this.addTestResult('Receipts Authorization', 
                result && result.sessionID,
                'Receipts authorization successful'
            );
        } catch (error) {
            this.addTestResult('Receipts Authorization', false, error.message);
        }
    }

    async testReceiptsQuantity() {
        try {
            const result = await this.integration.receipts.quantity();
            
            this.addTestResult('Receipts Quantity', 
                result && typeof result.numberOfReceipts === 'number',
                'Receipts quantity retrieved successfully'
            );
        } catch (error) {
            this.addTestResult('Receipts Quantity', false, error.message);
        }
    }

    // ========================================
    // ТЕСТЫ ИНТЕГРАЦИИ
    // ========================================

    async testIntegration() {
        logger.info('Testing Integration...');
        
        try {
            // Тест комплексной работы системы
            await this.testFullOrderFlow();
            
            // Тест производительности
            await this.testPerformance();
            
            // Тест обработки ошибок
            await this.testErrorHandling();
            
        } catch (error) {
            logger.error('Error in Integration tests', error);
            this.addTestResult('Integration Tests', false, error.message);
        }
    }

    async testFullOrderFlow() {
        try {
            // 1. Рассчитать стоимость доставки
            const costResult = await this.integration.calculateShipping({
                from: { cityId: 195868771, countryCode: 'RU' },
                to: { cityId: 195901073, countryCode: 'RU' },
                weight: 5,
                volume: 0.05,
                serviceCode: 'PCL'
            });
            
            if (!costResult.success) {
                throw new Error('Failed to calculate shipping cost');
            }
            
            // 2. Создать заказ
            const orderData = { ...TEST_CONFIG.testOrder };
            orderData.orderNumberInternal = 'TEST_FLOW_' + Date.now();
            
            const createResult = await this.integration.createOrder(orderData);
            
            if (!createResult.success) {
                throw new Error('Failed to create order');
            }
            
            // 3. Отследить заказ
            const trackResult = await this.integration.trackOrder(orderData.orderNumberInternal);
            
            // 4. Отменить заказ
            const cancelResult = await this.integration.cancelOrder(orderData.orderNumberInternal, 'test');
            
            this.addTestResult('Full Order Flow', 
                costResult.success && createResult.success && trackResult && cancelResult.success,
                'Full order flow completed successfully'
            );
            
        } catch (error) {
            this.addTestResult('Full Order Flow', false, error.message);
        }
    }

    async testPerformance() {
        try {
            const startTime = Date.now();
            
            // Выполняем несколько операций для тестирования производительности
            for (let i = 0; i < 10; i++) {
                await this.integration.calculator.calculate({
                    from: { cityId: 195868771, countryCode: 'RU' },
                    to: { cityId: 195901073, countryCode: 'RU' },
                    weight: 5,
                    volume: 0.05,
                    serviceCode: 'PCL'
                });
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            this.addTestResult('Performance', 
                duration < 30000, // Меньше 30 секунд для 10 операций
                `Performance test completed in ${duration}ms`
            );
            
        } catch (error) {
            this.addTestResult('Performance', false, error.message);
        }
    }

    async testErrorHandling() {
        try {
            // Тест обработки ошибок при неверных данных
            const result = await this.integration.createOrder({
                // Неполные данные
                orderNumberInternal: 'INVALID_ORDER'
            });
            
            this.addTestResult('Error Handling', 
                result && result.error,
                'Error handling works correctly'
            );
            
        } catch (error) {
            this.addTestResult('Error Handling', false, error.message);
        }
    }

    // ========================================
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ========================================

    /**
     * Добавить результат теста
     */
    addTestResult(testName, passed, message) {
        this.results.tests.push({
            name: testName,
            passed,
            message,
            timestamp: new Date()
        });
        
        this.results.total++;
        
        if (passed) {
            this.results.passed++;
        } else {
            this.results.failed++;
        }
        
        logger.info(`Test ${testName}: ${passed ? 'PASSED' : 'FAILED'} - ${message}`);
    }

    /**
     * Вывести результаты тестов
     */
    printResults() {
        const duration = this.results.endTime - this.results.startTime;
        
        console.log('\n' + '='.repeat(60));
        console.log('DPD INTEGRATION TEST SUITE RESULTS');
        console.log('='.repeat(60));
        console.log(`Total tests: ${this.results.total}`);
        console.log(`Passed: ${this.results.passed}`);
        console.log(`Failed: ${this.results.failed}`);
        console.log(`Skipped: ${this.results.skipped}`);
        console.log(`Duration: ${duration}ms`);
        console.log(`Success rate: ${this.results.total > 0 ? Math.round((this.results.passed / this.results.total) * 100) : 0}%`);
        console.log('='.repeat(60));
        
        // Выводим детали по каждому тесту
        this.results.tests.forEach(test => {
            const status = test.passed ? '✓' : '✗';
            console.log(`${status} ${test.name}: ${test.message}`);
        });
        
        console.log('='.repeat(60));
    }

    /**
     * Получить результаты тестов
     */
    getResults() {
        return this.results;
    }
}

// ============================================================
// ЗАПУСК ТЕСТОВ
// ============================================================
if (require.main === module) {
    const testSuite = new DPDIntegrationTestSuite();
    testSuite.runAllTests().then(results => {
        process.exit(results.failed > 0 ? 1 : 0);
    }).catch(error => {
        console.error('Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = { DPDIntegrationTestSuite, TEST_CONFIG };