/**
 * Utility function to catch errors in Express async route handlers.
 * It wraps the async function and automatically passes any rejected promises
 * to the next() middleware (the global error handler).
 */
const catchAsync = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((err) => next(err));
    };
};

module.exports = catchAsync;
