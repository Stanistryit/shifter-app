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
 * @returns {Buffer} PDF-буфер
 */
exports.generateSchedulePdf = async (storeName, monthIndex, year, dates, names, matrix) => {
    const monthName = ukrainianMonths[parseInt(monthIndex, 10) - 1];

    // Побудова HTML таблиці
    let tableHtml = `
      <table class="schedule-table">
        <thead>
          <tr>
            <th class="sticky-col">Співробітник / Дата</th>
    `;

    // Заголовки днів
    dates.forEach(date => {
        const d = new Date(date);
        const dayNum = String(d.getDate()).padStart(2, '0');
        // Дні тижня: Пн, Вт, Ср, Чт, Пт, Сб, Нд
        const daysUa = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const dayStr = daysUa[d.getDay()];
        const isWeekend = (d.getDay() === 0 || d.getDay() === 6) ? 'red' : '#9ca3af';

        tableHtml += `<th><div style="font-size: 10px; color: ${isWeekend};">${dayStr}</div><div>${dayNum}</div></th>`;
    });

    tableHtml += `
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
            // Якщо є зміна, зробити фон легким синім, або іншим, щоб виділити
            let cellClass = 'empty-cell';
            let cellContent = '-';

            if (shiftVal !== '-') {
                cellClass = 'shift-cell';
                // Обробка випадкових типів статусів типу "Відпустка" чи "Лікарняний"
                if (shiftVal.match(/^[a-zA-Zа-яА-ЯёЁіІїЇєЄ]+$/)) {
                    cellClass = 'status-cell';
                }
                cellContent = shiftVal;
            }

            tableHtml += `<td class="${cellClass}">${cellContent}</td>`;
        });

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
                padding: 20px;
                color: #1f2937;
                background-color: #f3f4f6;
            }
            .header {
                text-align: center;
                margin-bottom: 20px;
            }
            .title {
                font-size: 24px;
                font-weight: 700;
                color: #111827;
                margin: 0;
            }
            .subtitle {
                font-size: 14px;
                color: #6b7280;
                margin-top: 5px;
            }
            .table-container {
                background: white;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            }
            .schedule-table {
                width: 100%;
                border-collapse: collapse;
                text-align: center;
                font-size: 11px;
            }
            .schedule-table th {
                background-color: #f9fafb;
                padding: 10px 4px;
                font-weight: 600;
                color: #374151;
                border-bottom: 1px solid #e5e7eb;
                border-right: 1px solid #e5e7eb;
            }
            .schedule-table td {
                padding: 8px 4px;
                border-bottom: 1px solid #e5e7eb;
                border-right: 1px solid #e5e7eb;
                white-space: nowrap;
            }
            .schedule-table th:last-child,
            .schedule-table td:last-child {
                border-right: none;
            }
            .sticky-col {
                text-align: left;
                padding-left: 12px !important;
                font-weight: 600;
                color: #111827;
                background-color: #ffffff;
                border-right: 2px solid #e5e7eb !important;
            }
            .name-cell {
                font-size: 12px;
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
            }
            /* Сховати полоси прокрутки, оскільки це PDF */
            ::-webkit-scrollbar {
                display: none;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1 class="title">Магазин: ${storeName}</h1>
            <p class="subtitle">Графік роботи на місяць: ${monthName} ${year}</p>
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
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Необхідно для Render та інших хмарних сервісів
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Генерація PDF у ландшафтній орієнтації, щоб таблиця вмістилась
    const pdfBuffer = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true, // Включає фонові кольори CSS
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
