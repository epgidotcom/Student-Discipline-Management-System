import startDispatcher from '../services/smsDispatcher.js';

(async () => {
  try {
    await startDispatcher();
  } catch (err) {
    // If the dispatcher throws an unrecoverable error, log and exit.
    // Supervisor (PM2/systemd) can restart based on exit code.
    // eslint-disable-next-line no-console
    console.error('SMS dispatcher crashed', err);
    process.exit(1);
  }
})();
