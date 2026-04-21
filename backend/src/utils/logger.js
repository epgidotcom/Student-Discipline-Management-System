// Central logger utility.
// Connection: used by server startup, request logging, and global error middleware.

function formatMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return '';
  }

  const keys = Object.keys(meta);
  if (!keys.length) {
    return '';
  }

  return ` ${JSON.stringify(meta)}`;
}

function write(level, message, meta) {
  const timestamp = new Date().toISOString();
  const output = `[${timestamp}] [${level}] ${message}${formatMeta(meta)}`;

  if (level === 'ERROR' || level === 'WARN') {
    console.error(output);
    return;
  }

  console.log(output);
}

export const logger = {
  info(message, meta) {
    write('INFO', message, meta);
  },
  warn(message, meta) {
    write('WARN', message, meta);
  },
  error(message, meta) {
    write('ERROR', message, meta);
  }
};