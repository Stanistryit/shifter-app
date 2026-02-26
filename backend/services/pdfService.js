const puppeteer = require('puppeteer');

const ukrainianMonths = [
    'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
    'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'
];

/**
 * Генерує HTML таблицю та перетворює її в PDF-буфер
 * @param {string} storeName - Назва магазину
 * @param {string} monthIndex - Місяць: 01-12
 * @param {string} year - Рік
 * @param {Array<string>} dates - Масив дат (заголовків стовпців)
 * @param {Array<string>} names - Масив імен співробітників
 * @param {Object} matrix - Матриця matrix[name][date]
 * @param {Object} totals - Об'єкт із загальними годинами { name: totalHrs }
 * @returns {Buffer} PDF-буфер
 */
exports.generateSchedulePdf = async (storeName, monthIndex, year, dates, names, matrix, totals) => {
    const monthName = ukrainianMonths[parseInt(monthIndex, 10) - 1];

    // Побудова HTML таблиці
    let tableHtml = `
      <table class="schedule-table">
        <thead>
          <tr>
            <th class="sticky-col">Співробітник</th>
    `;

    // Заголовки днів
    dates.forEach(date => {
        const d = new Date(date);
        const dayNum = String(d.getDate()).padStart(2, '0');
        // Дні тижня: Пн, Вт, Ср, Чт, Пт, Сб, Нд
        const daysUa = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const dayStr = daysUa[d.getDay()];
        const isWeekend = (d.getDay() === 0 || d.getDay() === 6) ? 'red' : '#9ca3af';

        tableHtml += `<th><div style="font-size: 9px; color: ${isWeekend};">${dayStr}</div><div style="font-size: 11px;">${dayNum}</div></th>`;
    });

    tableHtml += `
            <th class="sticky-col-right">Години</th>
          </tr>
        </thead>
        <tbody>
    `;

    // Рядки співробітників
    names.forEach((name, index) => {
        const rowBg = index % 2 === 0 ? '#ffffff' : '#f9fafb';
        tableHtml += `<tr style="background-color: ${rowBg};">`;
        tableHtml += `<td class="sticky-col name-cell">${name}</td>`;

        dates.forEach(date => {
            const shiftVal = matrix[name][date] || '-';
            let cellClass = 'empty-cell';
            let cellContent = '-';

            if (shiftVal !== '-') {
                cellClass = 'shift-cell';

                // Якщо це просто текстовий статус (Відпустка, Лікарняний)
                if (shiftVal.match(/^[a-zA-Zа-яА-ЯёЁіІїЇєЄ]+$/)) {
                    cellClass = 'status-cell';
                    cellContent = shiftVal;
                } else {
                    // Це час (наприклад: "10:00-20:00"). Розбиваємо на два рядки для компактності
                    cellContent = shiftVal.replace('-', '<br>');
                }
            }

            tableHtml += `<td class="${cellClass}">${cellContent}</td>`;
        });

        const userTotalHours = totals && totals[name] !== undefined ? totals[name] : 0;
        tableHtml += `<td class="sticky-col-right name-cell" style="text-align: center; font-weight: bold;">${userTotalHours}</td>`;
        tableHtml += `</tr>`;
    });

    tableHtml += `
        </tbody>
      </table>
    `;

    // Повний HTML документ
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="uk">
    <head>
        <meta charset="UTF-8">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            
            body {
                font-family: 'Inter', sans-serif;
                margin: 0;
                padding: 15px;
                color: #1f2937;
                background-color: #ffffff;
            }
            .header {
                text-align: center;
                margin-bottom: 15px;
            }
            .title {
                font-size: 20px;
                font-weight: 700;
                color: #111827;
                margin: 0;
            }
            .subtitle {
                font-size: 13px;
                color: #6b7280;
                margin-top: 4px;
            }
            .table-container {
                overflow: hidden;
            }
            .schedule-table {
                width: 100%;
                border-collapse: collapse;
                text-align: center;
                /* Дозволити таблиці автоматично стискати стовпці */
                table-layout: auto; 
            }
            .schedule-table th {
                background-color: #f9fafb;
                padding: 4px 1px;
                font-weight: 600;
                color: #374151;
                border-bottom: 1px solid #e5e7eb;
                border-right: 1px solid #e5e7eb;
            }
            .schedule-table td {
                padding: 4px 1px;
                border-bottom: 1px solid #e5e7eb;
                border-right: 1px solid #e5e7eb;
                font-size: 8px; /* Зменшений шрифт для часу, щоб вміщався */
                line-height: 1.2;
            }
            .sticky-col {
                text-align: left;
                padding-left: 6px !important;
                padding-right: 4px !important;
                font-weight: 600;
                color: #111827;
                border-right: 2px solid #e5e7eb !important;
                width: 100px;
                max-width: 100px;
                /* Перенос довгих імен */
                white-space: normal;
                word-wrap: break-word; 
                word-break: break-word;
            }
            .sticky-col-right {
                text-align: center;
                font-weight: 600;
                border-left: 2px solid #e5e7eb !important;
                border-right: none !important;
                width: 40px;
                max-width: 40px;
            }
            .name-cell {
                font-size: 10px !important;
                line-height: 1.1;
            }
            .empty-cell {
                color: #d1d5db;
            }
            .shift-cell {
                font-weight: 600;
                color: #2563eb;
                background-color: #eff6ff;
            }
            .status-cell {
                font-weight: 600;
                color: #d97706;
                background-color: #fef3c7;
                font-size: 7px !important; /* Для відпусток і лікарняних */
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1 class="title">Магазин: ${storeName}</h1>
            <p class="subtitle">Графік роботи на місяць &bull; ${monthName} ${year}</p>
        </div>
        <div class="table-container">
            ${tableHtml}
        </div>
    </body>
    </html>
    `;

    // Запуск Puppeteer
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Генерація PDF у ландшафтній орієнтації
    const pdfBuffer = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        scale: 0.9, // Трохи збільшуємо, бо ми вже стиснули стовпці
        margin: {
            top: '10mm',
            right: '10mm',
            bottom: '10mm',
            left: '10mm'
        }
    });

    await browser.close();

    return pdfBuffer;
};
