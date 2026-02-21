const { z } = require('zod');

// Middleware для валідації запитів
const validate = (schema) => (req, res, next) => {
    try {
        schema.parse({
            body: req.body,
            query: req.query,
            params: req.params
        });
        next();
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: err.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
            });
        }
        next(err);
    }
};

// Схеми для Zod
const schemas = {
    // 1. Валідація додавання зміни (Shift)
    addShift: z.object({
        body: z.object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
            name: z.string().min(2, "Name is too short"),
            start: z.string(), // Може бути час '10:00' або текст 'Відпустка'
            end: z.string()
        }).strict() // Забороняє передавати ліві поля, наприклад `role: 'admin'`
    }),

    // 2. Валідація додавання задачі (Task)
    addTask: z.object({
        body: z.object({
            title: z.string().min(1, "Title is required").max(100, "Title is too long"),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
            name: z.string(),
            description: z.string().optional(),
            isFullDay: z.boolean().optional(),
            start: z.string().optional(),
            end: z.string().optional()
        }).strict()
    }),

    // 3. Валідація для збереження графіку (масив змін)
    saveSchedule: z.object({
        body: z.object({
            updates: z.array(z.object({
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                name: z.string(),
                start: z.string(),
                end: z.string()
            }))
        })
    }),

    // 4. Логін
    login: z.object({
        body: z.object({
            username: z.string().min(3),
            password: z.string().min(4),
            telegramId: z.number().optional().nullable()
        })
    }),

    // 5. Запит на скидання пароля
    forgotPassword: z.object({
        body: z.object({
            username: z.string().min(3)
        })
    }),

    // 6. Скидання пароля з токеном
    resetPassword: z.object({
        body: z.object({
            token: z.string().min(10),
            newPassword: z.string().min(4)
        })
    })
};

module.exports = { validate, schemas };
