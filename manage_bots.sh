#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "🤖 УПРАВЛЕНИЕ БОТАМИ FLEXYFRAME"
echo -e "${BLUE}========================================${NC}"
echo

# Функция для проверки запущен ли бот
check_status() {
    if pgrep -f "node.*bot" > /dev/null; then
        echo -e "${GREEN}✅ Бот ЗАПУЩЕН${NC}"
        echo
        echo "Активные процессы:"
        ps aux | grep "node.*bot" | grep -v grep
        return 0
    else
        echo -e "${RED}❌ Бот НЕ ЗАПУЩЕН${NC}"
        return 1
    fi
}

# Функция остановки бота
stop_bot() {
    echo -e "${YELLOW}⏹️  ОСТАНОВКА БОТА...${NC}"
    pkill -f "node.*bot" 2>/dev/null
    sleep 1
    echo -e "${GREEN}✅ Бот остановлен!${NC}"
    echo
}

# Функция запуска бота
start_bot() {
    echo -e "${GREEN}🚀 ЗАПУСК БОТА...${NC}"
    echo
    
    # Останавливаем если запущен
    stop_bot
    
    # Запускаем основного бота
    echo "Запуск основного бота (bot.js)..."
    nohup node bot.js > bot.log 2>&1 &
    sleep 2
    
    echo
    echo -e "${GREEN}✅ БОТ ЗАПУЩЕН!${NC}"
    echo -e "   - Основной бот: @flexyframe_bot"
    echo
}

# Функция перезапуска
restart_bot() {
    echo -e "${YELLOW}🔄 ПЕРЕЗАПУСК БОТА...${NC}"
    stop_bot
    sleep 2
    start_bot
}

# Главное меню
while true; do
    echo -e "${BLUE}[1]${NC} ЗАПУСТИТЬ БОТА"
    echo -e "${BLUE}[2]${NC} ОСТАНОВИТЬ БОТА"
    echo -e "${BLUE}[3]${NC} ПЕРЕЗАПУСТИТЬ БОТА"
    echo -e "${BLUE}[4]${NC} ПРОВЕРИТЬ СТАТУС БОТА"
    echo -e "${BLUE}[5]${NC} ПОСМОТРЕТЬ ЛОГИ БОТА"
    echo -e "${BLUE}[6]${NC} ВЫХОД"
    echo
    read -p "ВАШ ВЫБОР (1-6): " choice

    case $choice in
        1)
            start_bot
            ;;
        2)
            stop_bot
            ;;
        3)
            restart_bot
            ;;
        4)
            check_status
            ;;
        5)
            echo -e "${BLUE}📊 ЛОГИ БОТА:${NC}"
            if [ -f "bot.log" ]; then
                tail -20 bot.log
            else
                echo -e "${RED}Лог файл не найден${NC}"
            fi
            echo
            ;;
        6)
            echo -e "${GREEN}До свидания!${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Неверный выбор!${NC}"
            echo
            ;;
    esac
    
    read -p "Нажмите Enter для продолжения..."
    echo
done