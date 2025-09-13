# Система управления клавиатурами

## 🎯 Зачем нужна консолидация?

### **Проблемы старого подхода:**
- ❌ Дублирование кода - одни кнопки в разных местах
- ❌ Несогласованность - хардкод vs mkCb()
- ❌ Разбросанность - кнопки в 6+ файлах
- ❌ Сложность поддержки - изменение требует правок везде

### **Преимущества нового подхода:**
- ✅ Единое место для всех кнопок
- ✅ Консистентность через константы
- ✅ Легкость изменений
- ✅ TypeScript поддержка
- ✅ Переиспользование кода

## 📁 Структура

```
src/ui/
├── keyboards.ts    # 🎯 Основная система клавиатур
├── buttons.ts      # 🔄 Устаревший файл (можно удалить)
├── cb.ts          # Утилиты для callback_data
└── text.ts        # Тексты сообщений
```

## 🚀 Использование

### **Основные клавиатуры:**
```typescript
import { Keyboards } from "../ui/keyboards";

// Главное меню
const keyboard = Keyboards.mainMenu();

// Профиль с навигацией по фото
const keyboard = Keyboards.profileWithNav(totalPhotos, currentIndex);

// Просмотр анкет
const keyboard = Keyboards.browseCard(candidateId);
```

### **Константы кнопок:**
```typescript
import { BUTTONS } from "../ui/keyboards";

// Использование констант
const text = BUTTONS.FIND_PAIR; // "💞 Найти пару"
const text = BUTTONS.ACCEPT;    // "✅ Принять"
```

### **Утилиты:**
```typescript
import { KeyboardUtils } from "../ui/keyboards";

// Добавить кнопку "Назад в меню"
const keyboard = KeyboardUtils.withBackToMenu(existingKeyboard);

// Создать произвольную кнопку
const button = KeyboardUtils.button("Мой текст", "my:callback");

// Создать ряд кнопок
const row = KeyboardUtils.row(
  KeyboardUtils.button("Кнопка 1", "btn1"),
  KeyboardUtils.button("Кнопка 2", "btn2")
);
```

## 📋 Доступные клавиатуры

### **Основные:**
- `mainMenu()` - Главное меню
- `profile()` - Профиль пользователя
- `profileWithNav(total, current)` - Профиль с навигацией по фото

### **Регистрация:**
- `regGender()` - Выбор пола
- `regSeek()` - Кого ищет
- `regPhotoActions()` - Действия с фото
- `regPhotoRetryActions()` - Повторные действия

### **Функционал:**
- `browseCard(candidateId)` - Карточка анкеты
- `requestIncoming(crId)` - Входящий запрос
- `favoritesList()` - Список избранного
- `rouletteWaiting()` - Ожидание в рулетке
- `rouletteChat()` - Чат в рулетке

### **Утилиты:**
- `backToMenu()` - Кнопка "Назад в меню"
- `empty()` - Пустая клавиатура
- `restartConfirm()` - Подтверждение пересоздания

## 🔧 Добавление новых кнопок

### **1. Добавить константу:**
```typescript
// В src/ui/keyboards.ts
export const BUTTONS = {
  // ... существующие
  MY_NEW_BUTTON: "🆕 Моя кнопка",
} as const;
```

### **2. Создать клавиатуру:**
```typescript
// В src/ui/keyboards.ts
export const Keyboards = {
  // ... существующие
  myNewKeyboard(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.MY_NEW_BUTTON, callback_data: mkCb(CB.MY, "action") }]
    ];
  }
};
```

### **3. Использовать:**
```typescript
const keyboard = Keyboards.myNewKeyboard();
```

## 🎨 Кастомизация

### **Изменение текста кнопки:**
```typescript
// В src/ui/keyboards.ts
export const BUTTONS = {
  FIND_PAIR: "💕 Найти любовь", // Было: "💞 Найти пару"
} as const;
```

### **Изменение порядка кнопок:**
```typescript
// В src/ui/keyboards.ts
profile(): InlineKeyboardButton[][] {
  return [
    [{ text: BUTTONS.PHOTOS, callback_data: mkCb(CB.PRF, "photo") }], // Перенесли фото вверх
    [{ text: BUTTONS.FIND_PAIR, callback_data: mkCb(CB.BRW, "start") }],
    // ... остальные
  ];
}
```

## 🔄 Миграция

Скрипт автоматической миграции уже выполнен:
```bash
node scripts/migrate-keyboards.js
```

## ✅ Результат

Теперь все кнопки:
- 🎯 В одном месте (`src/ui/keyboards.ts`)
- 🔧 Легко изменяются
- 📝 Хорошо документированы
- 🚀 Переиспользуются
- 💪 TypeScript безопасны

**Старый файл `src/ui/buttons.ts` можно удалить!**
