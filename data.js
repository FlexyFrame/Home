/**
 * FlexyFrame - Централизованное хранилище данных
 * Оптимизированная версия с валидацией и кэшированием
 */

// === ЦЕНТРАЛИЗОВАННЫЙ СПИСОК КАРТИН ===
const PAINTINGS_DATA = [
    {
        id: 1,
        title: "Аркейн Триумвират",
        fullTitle: "Аркейн Триумвират Заводского Города",
        category: "Аркейн",
        price: 4200,
        file: "Аркейн Триумвират Заводского Города.jpg",
        badge: "Хит",
        description: "Уникальный арт в стиле стрит-арта с элементами киберпанка"
    },
    {
        id: 2,
        title: "Глитч-Давид",
        fullTitle: "Глитч-Давид Рождение в цифровом хаосе",
        category: "Давид",
        price: 4200,
        file: "Глитч-Давид Рождение в цифровом хаосе.jpg",
        badge: "Новинка",
        description: "Дигитальная интерпретация классической скульптуры"
    },
    {
        id: 3,
        title: "Цифровая Древность",
        fullTitle: "Цифровая Древность Голубой Давид",
        category: "Давид",
        price: 4200,
        file: "Цифровая Древность Голубой Давид.jpg",
        description: "Сочетание античности и современных технологий"
    },
    {
        id: 4,
        title: "Железный Человек",
        fullTitle: "Железный Человек Перерыв на обед",
        category: "Железный Человек",
        price: 4200,
        file: "Железный Человек Перерыв на обед.jpg",
        description: "Ироничный взгляд на супергероя в повседневной ситуации"
    },
    {
        id: 5,
        title: "Мысли в облаках",
        fullTitle: "Мысли в облаках",
        category: "Земфира",
        price: 4200,
        file: "Мысли в облаках.jpg",
        description: "Абстрактная композиция с элементами поп-арта"
    },
    {
        id: 6,
        title: "КэнтоНанами",
        fullTitle: "КэнтоНанами",
        category: "Магическая битва",
        price: 4200,
        file: "КэнтоНанами.png",
        badge: "Хит",
        description: "Динамичный арт в стиле аниме"
    },
    {
        id: 7,
        title: "Скрудж Макдак",
        fullTitle: "Скрудж Макдак Граффити-Миллиардер",
        category: "Скрудж",
        price: 4200,
        file: "Скрудж Макдак Граффити-Миллиардер.jpg",
        description: "Уличное искусство meets бизнес-империя"
    },
    {
        id: 8,
        title: "Танос Император",
        fullTitle: "Танос Император Бесконечности",
        category: "Танос",
        price: 4200,
        file: "Танос Император Бесконечности.jpg",
        description: "Эпический портрет с разрушением четвертой стены"
    },
    {
        id: 9,
        title: "Геймерский Энерджи",
        fullTitle: "Геймерский Энерджи Граффити на контроллере",
        category: "Live",
        price: 4200,
        file: "Геймерский Энерджи Граффити на контроллере.jpg",
        badge: "Хит",
        description: "Культура гейминга в граффити-исполнении"
    },
    {
        id: 10,
        title: "Ночной Волк",
        fullTitle: "Ночной Волк Мастер звуков",
        category: "Live",
        price: 4200,
        file: "Ночной Волк Мастер звуков.jpg",
        description: "Музыка и уличное искусство в одном полотне"
    },
    {
        id: 11,
        title: "Примат Премиум",
        fullTitle: "Примат Премиум Король улицы",
        category: "Live",
        price: 4200,
        file: "Примат Премиум Король улицы.jpg",
        description: "Сила и статус в граффити-интерпретации"
    }
];

// === КЭШ ПУТЕЙ К ИЗОБРАЖЕНИЯМ ===
const imagePathsCache = new Map();

// === ВАЛИДАЦИЯ И УТИЛИТЫ ===
const validators = {
    painting: (painting) => {
        return painting && 
               typeof painting === 'object' &&
               typeof painting.id === 'number' &&
               typeof painting.title === 'string' &&
               typeof painting.price === 'number' &&
               painting.id > 0 &&
               painting.price > 0;
    },
    
    paintingId: (id) => {
        return typeof id === 'number' && id > 0 && id <= PAINTINGS_DATA.length;
    },
    
    category: (category) => {
        return typeof category === 'string' && category.length > 0;
    }
};

// === ОСНОВНЫЕ ФУНКЦИИ ===

/**
 * Получить все картины с валидацией
 */
function getAllPaintings() {
    return PAINTINGS_DATA.filter(p => validators.painting(p));
}

/**
 * Найти картину по ID с кэшированием
 */
function findPaintingById(id) {
    if (!validators.paintingId(id)) {
        console.warn(`Невалидный ID картины: ${id}`);
        return null;
    }
    
    const painting = PAINTINGS_DATA.find(p => p.id === id);
    
    if (!painting) {
        console.warn(`Картина с ID ${id} не найдена`);
        return null;
    }
    
    if (!validators.painting(painting)) {
        console.error(`Картина с ID ${id} не прошла валидацию`);
        return null;
    }
    
    return painting;
}

/**
 * Найти картину по названию
 */
function findPaintingByTitle(title) {
    if (typeof title !== 'string' || title.length < 2) {
        return null;
    }
    
    const lowerTitle = title.toLowerCase();
    return PAINTINGS_DATA.find(p => 
        p.title.toLowerCase().includes(lowerTitle) || 
        p.fullTitle.toLowerCase().includes(lowerTitle)
    );
}

/**
 * Получить путь к изображению с кэшированием
 */
function getPaintingImagePath(painting) {
    if (!validators.painting(painting)) {
        return getLogoPath(); // Fallback на логотип
    }
    
    // Проверяем кэш
    const cacheKey = `${painting.category}_${painting.file}`;
    if (imagePathsCache.has(cacheKey)) {
        return imagePathsCache.get(cacheKey);
    }
    
    const path = require('path');
    const fs = require('fs');
    
    // Попытка найти файл в указанной категории
    const fullPath = path.join(__dirname, painting.category, painting.file);
    
    if (fs.existsSync(fullPath)) {
        imagePathsCache.set(cacheKey, fullPath);
        return fullPath;
    }
    
    // Fallback: попробовать другие расширения
    const extensions = ['.jpg', '.png', '.jpeg', '.webp'];
    for (const ext of extensions) {
        const altPath = path.join(__dirname, painting.category, 
            painting.file.replace(/\.(jpg|png|jpeg|webp)$/i, ext));
        
        if (fs.existsSync(altPath)) {
            imagePathsCache.set(cacheKey, altPath);
            return altPath;
        }
    }
    
    // Если ничего не найдено - возвращаем логотип
    console.warn(`Изображение не найдено: ${painting.title}, используется логотип`);
    return getLogoPath();
}

/**
 * Получить путь к логотипу
 */
function getLogoPath() {
    const path = require('path');
    const fs = require('fs');
    
    const logoPath = path.join(__dirname, 'ЛОГОТИП', 'Logo.png');
    const fallbackPath = path.join(__dirname, 'ЛОГОТИП', 'Logo.jpg');
    
    if (fs.existsSync(logoPath)) return logoPath;
    if (fs.existsSync(fallbackPath)) return fallbackPath;
    
    // Последний fallback
    return path.join(__dirname, 'ЛОГОТИП', 'Logo.png');
}

/**
 * Получить категории картин
 */
function getCategories() {
    const categories = new Set(PAINTINGS_DATA.map(p => p.category));
    return Array.from(categories).sort();
}

/**
 * Получить картины по категории
 */
function getPaintingsByCategory(category) {
    if (!validators.category(category)) {
        return [];
    }
    
    return PAINTINGS_DATA.filter(p => 
        p.category.toLowerCase() === category.toLowerCase()
    );
}

/**
 * Получить картины с бейджем
 */
function getPaintingsWithBadge(badge = null) {
    if (badge) {
        return PAINTINGS_DATA.filter(p => p.badge === badge);
    }
    return PAINTINGS_DATA.filter(p => p.badge);
}

/**
 * Поиск картин по ключевым словам
 */
function searchPaintings(query) {
    if (typeof query !== 'string' || query.length < 2) {
        return [];
    }
    
    const lowerQuery = query.toLowerCase();
    return PAINTINGS_DATA.filter(p => 
        p.title.toLowerCase().includes(lowerQuery) ||
        p.fullTitle.toLowerCase().includes(lowerQuery) ||
        p.category.toLowerCase().includes(lowerQuery) ||
        (p.description && p.description.toLowerCase().includes(lowerQuery))
    );
}

/**
 * Получить статистику
 */
function getStats() {
    return {
        total: PAINTINGS_DATA.length,
        categories: getCategories().length,
        withBadge: PAINTINGS_DATA.filter(p => p.badge).length,
        priceRange: {
            min: Math.min(...PAINTINGS_DATA.map(p => p.price)),
            max: Math.max(...PAINTINGS_DATA.map(p => p.price))
        }
    };
}

// === ЭКСПОРТ ===
module.exports = {
    // Данные
    paintings: getAllPaintings(),
    
    // Функции
    getAllPaintings,
    findPaintingById,
    findPaintingByTitle,
    getPaintingImagePath,
    getLogoPath,
    getCategories,
    getPaintingsByCategory,
    getPaintingsWithBadge,
    searchPaintings,
    getStats,
    
    // Валидаторы
    validators
};