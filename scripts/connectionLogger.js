// Middleware to log connections to a JSON file
import fs from 'fs';
import path from 'path';

export function connectionLogger(req, res, next) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        method: req.method,
        url: req.url,
        headers: req.headers,
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'] || '',
    };

    // Log file by day: logs/connections-YYYY-MM-DD.log.json
    const day = new Date().toISOString().slice(0, 10);
    const logPath = path.resolve(process.cwd(), 'logs', `connections-${day}.log.json`);

    // Ensure log directory exists
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    // Append log entry to file
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');

    next();
}
