/**
 * ==============================================================================
 * Shifter App - Google Apps Script для парсингу графіку роботи
 * ==============================================================================
 * 
 * Встановлення:
 * 1. Відкрийте вашу Google Таблицю з графіком.
 * 2. У верхньому меню оберіть: Розширення (Extensions) -> Apps Script.
 * 3. Видаліть усе з файлу Code.gs та вставте цей код.
 * 4. Натисніть "Зберегти" (Ctrl+S / Cmd+S).
 * 5. Для перевірки: оберіть функцію `testParser` і натисніть "Виконати" (Run).
 *    Перегляньте Журнал виконання (Execution log) внизу.
 * 6. Для розгортання:
 *    - Натисніть кнопку "Розгорнути" (Deploy) -> "Нове розгортання" (New deployment).
 *    - Тип: "Веб-додаток" (Web app).
 *    - Конфігурація:
 *      - Опис: "Shifter Schedule API"
 *      - Виконувати як (Execute as): "Я" (Me)
 *      - Хто має доступ (Who has access): "Усі" (Anyone)
 *    - Натисніть "Розгорнути" (Deploy) та скопіюйте отриманий Web App URL.
 */

/**
 * Головна точка входу для HTTP GET запитів від Shifter App
 */
function doGet(e) {
  try {
    const params = e ? e.parameter || {} : {};
    const sheetName = params.sheet || 'Графік';
    const year = params.year || new Date().getFullYear();
    const month = params.month || null; // наприклад, "10" або "2026-10"

    const result = parseSchedule(sheetName, year, month);

    return ContentService
      .createTextOutput(JSON.stringify(result, null, 2))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      }, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Тестова функція: запустіть її прямо в редакторі Apps Script (кнопка "Run"),
 * щоб побачити розпарсені дані без веб-запитів!
 */
function testParser() {
  const result = parseSchedule('Графік');
  Logger.log('====================================================');
  Logger.log('РЕЗУЛЬТАТ ТЕСТУВАННЯ ПАРСИНГУ ГРАФІКА');
  Logger.log('====================================================');
  Logger.log('Успішно: ' + result.success);
  Logger.log('Магазин: ' + result.storeName);
  Logger.log('Дат розпізнано: ' + (result.dates ? result.dates.length : 0));
  Logger.log('Перша / остання дати: ' + (result.dates ? result.dates[0] + ' ... ' + result.dates[result.dates.length - 1] : ''));
  Logger.log('Всього записів змін: ' + (result.shifts ? result.shifts.length : 0));
  Logger.log('Помилок у клітинках: ' + (result.errors ? result.errors.length : 0));

  if (result.errors && result.errors.length > 0) {
    Logger.log('--- СПИСОК ПОМИЛОК ---');
    result.errors.forEach((err, idx) => {
      Logger.log(`${idx + 1}. [${err.cell}] ${err.employee} (${err.date}): ${err.message}`);
    });
  }

  // Виведемо зразок підмін
  const substitutes = (result.shifts || []).filter(s => s.isSubstitute);
  Logger.log(`Всього знайдено підмін: ${substitutes.length}`);
  if (substitutes.length > 0) {
    Logger.log('--- ЗРАЗОК ПІДМІН ---');
    substitutes.slice(0, 5).forEach(s => {
      const direction = s.isGuest 
        ? `Гість з ${s.homeStoreName} -> працює в ${s.storeName}` 
        : `Наш співробітник -> підміна в ${s.substituteStoreName}`;
      Logger.log(`- ${s.date} | ${s.name}: ${s.start}-${s.end} (${direction})`);
    });
  }

  // Виведемо перші 5 звичайних змін як зразок
  const sampleShifts = (result.shifts || []).filter(s => s.type !== 'OFF' && !s.isSubstitute).slice(0, 5);
  Logger.log('--- ЗРАЗОК ОСНОВНИХ ЗМІН ---');
  sampleShifts.forEach(s => {
    Logger.log(`- ${s.date} | ${s.name}: ${s.start}-${s.end} | ${s.type} ${s.note ? '(' + s.note + ')' : ''}`);
  });

  return result;
}

/**
 * Основна функція парсингу аркуша
 */
function parseSchedule(sheetName, yearInput, monthFilter) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = sheetName ? ss.getSheetByName(sheetName) : null;
  if (!sheet) {
    sheet = ss.getActiveSheet();
  }

  if (!sheet) {
    return { success: false, error: 'Аркуш не знайдено' };
  }

  // Отримуємо текстові значення саме так, як вони відображаються користувачу
  const data = sheet.getDataRange().getDisplayValues();
  if (!data || data.length < 3) {
    return { success: false, error: 'Таблиця містить замало рядків' };
  }

  const currentYear = parseInt(yearInput, 10) || new Date().getFullYear();

  // 1. Назва магазину з комірки B1 (рядок 0, стовпець 1)
  const storeName = String(data[0][1] || 'Проспект').trim();

  // 2. Парсинг дат (Рядок 1, починаючи з колонки C / індекс 2)
  const dateCols = [];
  const dates = [];

  for (let col = 2; col < data[0].length; col++) {
    const header = String(data[0][col] || '').trim();
    if (!header) continue;

    // Шаблон: "четвер, 1 10", "п'ятниця, 2 10", "1 10", "01.10", "1/10"
    const match = header.match(/(\d{1,2})[\s./]+(\d{1,2})/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);

      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const dateStr = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Якщо передано фільтр місяця (наприклад, "10" або "2026-10")
        if (monthFilter) {
          const cleanFilter = String(monthFilter).replace('-', '');
          const cleanDate = dateStr.slice(0, 7).replace('-', '');
          if (!cleanDate.includes(cleanFilter) && month !== parseInt(monthFilter, 10)) {
            continue;
          }
        }

        dateCols.push({
          colIndex: col,
          dateStr: dateStr,
          day: day,
          month: month,
          rawHeader: header
        });
        dates.push(dateStr);
      }
    }
  }

  if (dateCols.length === 0) {
    return { success: false, error: 'Не знайдено жодної дати в 1-му рядку таблиці' };
  }

  // 3. Сканування рядків співробітників
  const shifts = [];
  const errors = [];
  let isUnderSubstitutesSection = false;
  let r = 2; // Починаємо з 3-го рядка (індекс 2), після заголовків та рядка "На зміні"

  while (r < data.length) {
    const colB = String(data[r][1] || '').trim();

    // Пропускаємо порожні рядки
    if (!colB) {
      r++;
      continue;
    }

    const lowerB = colB.toLowerCase();

    // ДИНАМІЧНИЙ ПОШУК: перевіряємо виключно колонку B на слово "підмін"
    // (Колонку A не перевіряємо, оскільки там вертикально об'єднана комірка "ПІДМІНИ З ІНШИХ ТОЧОК")
    if (lowerB.includes('підмін')) {
      isUnderSubstitutesSection = true;
      r++;
      continue;
    }

    // Службові рядки ("На зміні", "Всього") пропускаємо
    if (lowerB.includes('на зміні') || lowerB.includes('всього')) {
      r++;
      continue;
    }

    // Це співробітник!
    const employeeName = colB;
    const subtitle = (r + 1 < data.length) ? String(data[r + 1][1] || '').trim() : '';

    // Обходимо кожну дату для цього співробітника
    for (let i = 0; i < dateCols.length; i++) {
      const dCol = dateCols[i];
      const col = dCol.colIndex;

      const valUpper = String(data[r][col] || '').trim();
      const valLower = (r + 1 < data.length) ? String(data[r + 1][col] || '').trim() : '';

      const cellAddrUpper = columnToLetter(col + 1) + (r + 1);
      const cellAddrLower = columnToLetter(col + 1) + (r + 2);
      const cellDisplay = `${cellAddrUpper}/${cellAddrLower}`;

      // Порожні клітинки -> Вихідний
      if (!valUpper && !valLower) {
        shifts.push({
          date: dCol.dateStr,
          name: employeeName,
          type: 'OFF'
        });
        continue;
      }

      const combined = `${valUpper} ${valLower}`.trim();

      // 1. Відпустка
      if (valUpper.includes('🌴') || valLower.includes('🌴') || /відпустк/i.test(combined)) {
        shifts.push({
          date: dCol.dateStr,
          name: employeeName,
          type: 'VACATION',
          start: 'Відпустка',
          end: 'Відпустка',
          storeName: storeName,
          isSubstitute: false
        });
        continue;
      }

      // 2. Лікарняний
      if (valUpper.includes('💊') || valLower.includes('💊') || /лікарнян/i.test(combined)) {
        shifts.push({
          date: dCol.dateStr,
          name: employeeName,
          type: 'SICK',
          start: 'Лікарняний',
          end: 'Лікарняний',
          storeName: storeName,
          isSubstitute: false
        });
        continue;
      }

      // 3. Донорство
      if (valUpper.includes('🩸') || valLower.includes('🩸') || /донор/i.test(combined)) {
        shifts.push({
          date: dCol.dateStr,
          name: employeeName,
          type: 'DONOR',
          start: 'Донорство',
          end: 'Донорство',
          storeName: storeName,
          isSubstitute: false
        });
        continue;
      }

      // 4. Пошук годин зміни (наприклад "11:30 - 20:30", "11.30 - 20.30", "09:00 − 18:00")
      const timeRegex = /(?:(\d{1,2}[:.]\d{2})\s*[-–—−\u2212\u2010-\u2015~]\s*(\d{1,2}[:.]\d{2}))/;
      const timeMatch = valLower.match(timeRegex) || valUpper.match(timeRegex);

      if (timeMatch) {
        const start = normalizeTime(timeMatch[1]);
        const end = normalizeTime(timeMatch[2]);

        if (!isUnderSubstitutesSection) {
          // --- ОСНОВНИЙ ШТАТ МАГАЗИНУ (Проспект) ---
          let locText = valUpper
            .replace(timeMatch[0], '')
            .replace(/🏠/g, '')
            .trim();

          const isTraining = /навчанн/i.test(locText);
          const isOtherStore = locText.length > 0 && !isTraining;

          if (isOtherStore) {
            // Наш співробітник поїхав на підміну в інший магазин (наприклад, "СкайМолл")
            shifts.push({
              date: dCol.dateStr,
              name: employeeName,
              type: 'WORK',
              start: start,
              end: end,
              isSubstitute: true,
              substituteStoreName: locText,
              storeName: locText,
              targetStoreName: locText
            });
          } else {
            // Звичайна зміна в рідному магазині
            shifts.push({
              date: dCol.dateStr,
              name: employeeName,
              type: 'WORK',
              start: start,
              end: end,
              isSubstitute: false,
              storeName: storeName,
              targetStoreName: storeName,
              note: isTraining ? 'Навчання в полі' : ''
            });
          }
        } else {
          // --- ЗОВНІШНЯ ПІДМІНА (Гість, що приїхав у Проспект) ---
          // Працює в цьому магазині, а рідний магазин вказано в subtitle (колонці B)
          shifts.push({
            date: dCol.dateStr,
            name: employeeName,
            type: 'WORK',
            start: start,
            end: end,
            isSubstitute: true,
            homeStoreName: subtitle, // наприклад "ХРЕЩАТИК", "СКАЙ", "РІВЕР"
            storeName: storeName,    // фактично працює в Проспекті
            targetStoreName: storeName,
            isGuest: true
          });
        }

      } else {
        // Годин не знайдено: перевіряємо, чи є в клітинці текст без іконок
        const cleanText = combined.replace(/[🏠🌴💊🩸\s]/g, '');
        if (cleanText.length > 0) {
          errors.push({
            cell: cellDisplay,
            row: r + 1,
            col: col + 1,
            date: dCol.dateStr,
            employee: employeeName,
            valUpper: valUpper,
            valLower: valLower,
            message: `Вказано текст "${combined}", але не знайдено коректних годин (формат "ГГ:ХХ - ГГ:ХХ")`
          });
        } else {
          shifts.push({
            date: dCol.dateStr,
            name: employeeName,
            type: 'OFF'
          });
        }
      }
    }

    // Переходимо до наступного співробітника (кожен займає 2 рядки)
    r += 2;
  }

  return {
    success: true,
    sheetName: sheet.getName(),
    storeName: storeName,
    year: currentYear,
    dates: dates,
    shifts: shifts,
    errors: errors,
    totalEmployees: Math.floor((r - 2) / 2)
  };
}

/**
 * Нормалізація часу: "9:30" -> "09:30", "11.30" -> "11:30"
 */
function normalizeTime(t) {
  if (!t) return '';
  let clean = t.replace('.', ':').trim();
  const parts = clean.split(':');
  if (parts.length === 2) {
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    return `${h}:${m}`;
  }
  return clean;
}

/**
 * Перетворення індексу колонки в букву: 1 -> "A", 2 -> "B", 3 -> "C", 27 -> "AA"
 */
function columnToLetter(column) {
  let temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}
